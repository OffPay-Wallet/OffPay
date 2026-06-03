import { AppError } from './errors.js';
import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { getFeeForMessage, getLatestBlockhash } from './helius.js';
import {
  createMagicBlockInitializeMintTransaction,
  createMagicBlockTransferTransaction,
  getMagicBlockMintInitializationStatus,
  resolveMagicBlockValidator,
  type MagicBlockUnsignedTransaction,
} from './magicblock.js';
import { createSwapQuote, executeSwapQuoteDetailed, type SwapQuoteResponse } from './jupiter.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
} from './provider-utils.js';
import { writeOperationalLog } from './logging.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const PRIVACY_SWAP_SESSION_KEY_PREFIX = 'swap-privacy:v1';
const PRIVACY_SWAP_FINALIZE_LOCK_KEY_PREFIX = 'swap-privacy-finalize-lock:v1';
const PRIVACY_SWAP_SESSION_TTL_MS = 30 * 60 * 1000;
const PRIVACY_SWAP_FINALIZE_LOCK_TTL_SEC = 120;
const NATIVE_SOL_ADDRESS = '11111111111111111111111111111111';

interface StoredPrivacySwapSession {
  sessionId: string;
  ownerWallet: string;
  executorWallet: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  validator: string;
  quoteId: string | null;
  network: Network;
  expiresAt: number;
  stage: 'prepared' | 'executed';
  swapSignature: string | null;
  outputAmount: string | null;
}

interface SwapPrivacyInitializationTransaction {
  mint: string;
  role: 'funding' | 'settlement';
  transaction: MagicBlockUnsignedTransaction;
}

interface PrepareSwapPrivacyEnvelopeRequest {
  ownerWallet: string;
  executorWallet: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  network: Network;
  fundingMemo?: string;
}

interface PrepareSwapPrivacyEnvelopeResponse {
  sessionId: string;
  validator: string;
  fundingTransaction: MagicBlockUnsignedTransaction;
  swapQuote: SwapQuoteResponse | null;
  initializationTransactions: SwapPrivacyInitializationTransaction[];
}

interface FinalizeSwapPrivacyEnvelopeRequest {
  ownerWallet: string;
  sessionId: string;
  signedTransaction: string;
  network: Network;
  settlementMemo?: string;
}

interface FinalizeSwapPrivacyEnvelopeResponse {
  sessionId: string;
  validator: string;
  outputMint: string;
  settledAmount: string;
  swapSignature: string;
  settlementTransaction: MagicBlockUnsignedTransaction;
}

interface RefreshSwapPrivacyEnvelopeQuoteRequest {
  ownerWallet: string;
  sessionId: string;
  network: Network;
}

interface RefreshSwapPrivacyEnvelopeQuoteResponse {
  sessionId: string;
  validator: string;
  swapQuote: SwapQuoteResponse;
}

function assertWalletAddress(value: string, message: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertPositiveIntegerAmount(value: string, message: string): void {
  if (!/^\d+$/.test(value) || value === '0') {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function buildPrivacySwapSessionKey(sessionId: string): string {
  return `${PRIVACY_SWAP_SESSION_KEY_PREFIX}:${sessionId}`;
}

function buildPrivacySwapFinalizeLockKey(sessionId: string): string {
  return `${PRIVACY_SWAP_FINALIZE_LOCK_KEY_PREFIX}:${sessionId}`;
}

async function storePrivacySwapSession(
  bindings: Bindings,
  session: StoredPrivacySwapSession,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [
      [
        'SET',
        buildPrivacySwapSessionKey(session.sessionId),
        JSON.stringify(session),
        'EX',
        ttlSeconds,
      ],
    ],
    'Privacy swap session storage is unavailable.',
  );
}

async function getPrivacySwapSession(
  bindings: Bindings,
  sessionId: string,
): Promise<StoredPrivacySwapSession | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildPrivacySwapSessionKey(sessionId)]],
    'Privacy swap session storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const storedSessionId = readTrimmedString(parsed.sessionId);
  const ownerWallet = readTrimmedString(parsed.ownerWallet);
  const executorWallet = readTrimmedString(parsed.executorWallet);
  const inputMint = readTrimmedString(parsed.inputMint);
  const outputMint = readTrimmedString(parsed.outputMint);
  const amount = readTrimmedString(parsed.amount);
  const slippageBps = readFiniteNumber(parsed.slippageBps);
  const validator = readTrimmedString(parsed.validator);
  const quoteId = readTrimmedString(parsed.quoteId);
  const network = readTrimmedString(parsed.network);
  const expiresAt = readFiniteNumber(parsed.expiresAt);
  const stage = readTrimmedString(parsed.stage);
  const swapSignature = readTrimmedString(parsed.swapSignature);
  const outputAmount = readTrimmedString(parsed.outputAmount);

  if (
    !storedSessionId ||
    !ownerWallet ||
    !executorWallet ||
    !inputMint ||
    !outputMint ||
    !amount ||
    slippageBps === null ||
    !validator ||
    (network !== 'devnet' && network !== 'mainnet') ||
    expiresAt === null ||
    (stage !== 'prepared' && stage !== 'executed')
  ) {
    return null;
  }

  return {
    sessionId: storedSessionId,
    ownerWallet,
    executorWallet,
    inputMint,
    outputMint,
    amount,
    slippageBps,
    validator,
    quoteId,
    network,
    expiresAt,
    stage,
    swapSignature,
    outputAmount,
  };
}

async function requirePrivacySwapSession(
  bindings: Bindings,
  sessionId: string,
  ownerWallet: string,
  network: Network,
): Promise<StoredPrivacySwapSession> {
  const session = await getPrivacySwapSession(bindings, sessionId);
  if (
    !session ||
    session.ownerWallet !== ownerWallet ||
    session.network !== network ||
    session.expiresAt <= Date.now()
  ) {
    throw new AppError({
      status: 410,
      code: 'SESSION_EXPIRED',
      message: 'The private swap session has expired. Please prepare a new private swap.',
      retryable: true,
    });
  }

  return session;
}

async function acquirePrivacySwapFinalizeLock(
  bindings: Bindings,
  sessionId: string,
): Promise<string | null> {
  const lockKey = buildPrivacySwapFinalizeLockKey(sessionId);
  const lockToken = crypto.randomUUID();
  const [result] = await runKvPipeline(
    bindings,
    [['SET', lockKey, lockToken, 'NX', 'EX', PRIVACY_SWAP_FINALIZE_LOCK_TTL_SEC]],
    'Privacy swap session storage is unavailable.',
  );

  return result === 'OK' ? lockToken : null;
}

async function releasePrivacySwapFinalizeLock(
  bindings: Bindings,
  sessionId: string,
  lockToken: string,
): Promise<void> {
  const lockKey = buildPrivacySwapFinalizeLockKey(sessionId);
  const [currentValue] = await runKvPipeline(
    bindings,
    [['GET', lockKey]],
    'Privacy swap session storage is unavailable.',
  );

  if (currentValue === lockToken) {
    await runKvPipeline(
      bindings,
      [['DEL', lockKey]],
      'Privacy swap session storage is unavailable.',
    );
  }
}

async function createFreshPrivacySwapQuote(
  bindings: Bindings,
  session: StoredPrivacySwapSession,
): Promise<SwapQuoteResponse> {
  const swapQuote = await createSwapQuote(bindings, {
    takerAddress: session.executorWallet,
    inputMint: session.inputMint,
    outputMint: session.outputMint,
    amount: session.amount,
    slippageBps: session.slippageBps,
    useManualSlippage: true,
    network: session.network,
  });

  await storePrivacySwapSession(bindings, {
    ...session,
    quoteId: swapQuote.quoteId,
    stage: 'prepared',
    swapSignature: null,
    outputAmount: null,
  });

  return swapQuote;
}

async function buildFinalizeResponse(
  bindings: Bindings,
  session: StoredPrivacySwapSession,
  request: FinalizeSwapPrivacyEnvelopeRequest,
  swapSignature: string,
  outputAmount: string,
): Promise<FinalizeSwapPrivacyEnvelopeResponse> {
  const settlementMemo =
    sanitizeText(request.settlementMemo, 120) ??
    `offpay privacy swap settle ${request.sessionId.slice(0, 8)}`;

  const settlementTransaction = await createMagicBlockTransferTransaction(bindings, {
    ownerWallet: session.executorWallet,
    destinationWallet: session.ownerWallet,
    mint: session.outputMint,
    amount: outputAmount,
    network: request.network,
    validator: session.validator,
    privacy: 'private',
    memo: settlementMemo,
  });

  return {
    sessionId: request.sessionId,
    validator: session.validator,
    outputMint: session.outputMint,
    settledAmount: outputAmount,
    swapSignature,
    settlementTransaction,
  };
}

async function buildInitializationTransactions(
  bindings: Bindings,
  ownerWallet: string,
  executorWallet: string,
  inputMint: string,
  outputMint: string,
  network: Network,
  validator: string,
): Promise<SwapPrivacyInitializationTransaction[]> {
  const transactions: SwapPrivacyInitializationTransaction[] = [];

  const inputStatus = await getMagicBlockMintInitializationStatus(bindings, {
    mint: inputMint,
    network,
    validator,
  });

  if (!inputStatus.initialized) {
    transactions.push({
      mint: inputMint,
      role: 'funding',
      transaction: await createMagicBlockInitializeMintTransaction(bindings, {
        ownerWallet,
        mint: inputMint,
        network,
        validator,
      }),
    });
  }

  if (outputMint !== inputMint) {
    const outputStatus = await getMagicBlockMintInitializationStatus(bindings, {
      mint: outputMint,
      network,
      validator,
    });

    if (!outputStatus.initialized) {
      transactions.push({
        mint: outputMint,
        role: 'settlement',
        transaction: await createMagicBlockInitializeMintTransaction(bindings, {
          ownerWallet: executorWallet,
          mint: outputMint,
          network,
          validator,
        }),
      });
    }
  }

  return transactions;
}

function getSerializedTransactionMessageBase64(transactionBase64: string): string {
  const transactionBytes = Buffer.from(transactionBase64, 'base64');

  try {
    return Transaction.from(transactionBytes).serializeMessage().toString('base64');
  } catch {
    return Buffer.from(
      VersionedTransaction.deserialize(transactionBytes).message.serialize(),
    ).toString('base64');
  }
}

async function getSerializedTransactionFeeLamports(
  bindings: Bindings,
  network: Network,
  transactionBase64: string,
): Promise<bigint> {
  const messageBase64 = getSerializedTransactionMessageBase64(transactionBase64);
  const feeLamports = await getFeeForMessage(bindings, {
    messageBase64,
    network,
  });

  return BigInt(feeLamports);
}

async function getExecutorProbeFeeLamports(params: {
  bindings: Bindings;
  network: Network;
  executorWallet: string;
  blockhash: string;
}): Promise<bigint> {
  const probeTransaction = new Transaction({
    feePayer: new PublicKey(params.executorWallet),
    recentBlockhash: params.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(params.executorWallet),
      toPubkey: new PublicKey(params.executorWallet),
      lamports: 0,
    }),
  );

  const feeLamports = await getFeeForMessage(params.bindings, {
    messageBase64: probeTransaction.serializeMessage().toString('base64'),
    network: params.network,
  });

  return BigInt(feeLamports);
}

function toSafeLamportsNumber(lamports: bigint): number {
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Private swap executor network fee estimate is too large to encode safely.',
      retryable: true,
    });
  }

  return Number(lamports);
}

async function buildExecutorFeeTopUpTransaction(params: {
  bindings: Bindings;
  ownerWallet: string;
  executorWallet: string;
  initializationTransactions: SwapPrivacyInitializationTransaction[];
  swapQuote: SwapQuoteResponse | null;
  network: Network;
}): Promise<SwapPrivacyInitializationTransaction | null> {
  const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(
    params.bindings,
    params.network,
  );
  const probeFeeLamports = await getExecutorProbeFeeLamports({
    bindings: params.bindings,
    network: params.network,
    executorWallet: params.executorWallet,
    blockhash,
  });
  let topUpLamports = 0n;

  for (const initializationTransaction of params.initializationTransactions) {
    if (initializationTransaction.transaction.requiredSigners.includes(params.executorWallet)) {
      topUpLamports += await getSerializedTransactionFeeLamports(
        params.bindings,
        params.network,
        initializationTransaction.transaction.transactionBase64,
      );
    }
  }

  topUpLamports += params.swapQuote
    ? await getSerializedTransactionFeeLamports(
        params.bindings,
        params.network,
        params.swapQuote.unsignedTransaction,
      )
    : probeFeeLamports;
  topUpLamports += probeFeeLamports;

  if (topUpLamports <= 0n) {
    return null;
  }

  const feeTopUpTransaction = new Transaction({
    feePayer: new PublicKey(params.ownerWallet),
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(params.ownerWallet),
      toPubkey: new PublicKey(params.executorWallet),
      lamports: toSafeLamportsNumber(topUpLamports),
    }),
  );
  feeTopUpTransaction.lastValidBlockHeight = lastValidBlockHeight;

  return {
    mint: NATIVE_SOL_ADDRESS,
    role: 'funding',
    transaction: {
      kind: 'executor_fee_topup',
      version: 'legacy',
      transactionBase64: Buffer.from(
        feeTopUpTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      ).toString('base64'),
      sendTo: params.executorWallet,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      instructionCount: 1,
      requiredSigners: [params.ownerWallet],
      validator: null,
      transferQueue: null,
      rentPda: null,
    },
  };
}

async function prepareSwapPrivacyEnvelope(
  bindings: Bindings,
  request: PrepareSwapPrivacyEnvelopeRequest,
): Promise<PrepareSwapPrivacyEnvelopeResponse> {
  assertWalletAddress(request.ownerWallet, 'Authenticated wallet address is invalid.');
  assertWalletAddress(request.executorWallet, 'Executor wallet address is invalid.');
  assertWalletAddress(request.inputMint, 'Input mint address is invalid.');
  assertWalletAddress(request.outputMint, 'Output mint address is invalid.');
  assertPositiveIntegerAmount(
    request.amount,
    'Private swap amount must be a positive integer string.',
  );

  if (request.ownerWallet === request.executorWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Executor wallet must differ from the authenticated wallet for privacy-mode swaps.',
    });
  }

  const sessionId = crypto.randomUUID();
  const validator = resolveMagicBlockValidator(
    bindings,
    request.network,
    `${request.ownerWallet}:${request.executorWallet}:${request.inputMint}:${request.outputMint}`,
  );

  const initializationTransactions = await buildInitializationTransactions(
    bindings,
    request.ownerWallet,
    request.executorWallet,
    request.inputMint,
    request.outputMint,
    request.network,
    validator,
  );

  const fundingMemo =
    sanitizeText(request.fundingMemo, 120) ??
    `offpay privacy swap funding ${sessionId.slice(0, 8)}`;

  const fundingTransaction = await createMagicBlockTransferTransaction(bindings, {
    ownerWallet: request.ownerWallet,
    destinationWallet: request.executorWallet,
    mint: request.inputMint,
    amount: request.amount,
    network: request.network,
    validator,
    privacy: 'private',
    memo: fundingMemo,
  });

  let swapQuote: SwapQuoteResponse | null = null;
  try {
    swapQuote = await createSwapQuote(bindings, {
      takerAddress: request.executorWallet,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amount: request.amount,
      slippageBps: request.slippageBps,
      useManualSlippage: true,
      network: request.network,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.status === 400 &&
      error.code === 'INVALID_REQUEST' &&
      /insufficient funds/i.test(error.message)
    ) {
      swapQuote = null;
    } else {
      throw error;
    }
  }

  const feeTopUpTransaction = await buildExecutorFeeTopUpTransaction({
    bindings,
    ownerWallet: request.ownerWallet,
    executorWallet: request.executorWallet,
    initializationTransactions,
    swapQuote,
    network: request.network,
  });
  if (feeTopUpTransaction !== null) {
    initializationTransactions.unshift(feeTopUpTransaction);
  }

  await storePrivacySwapSession(bindings, {
    sessionId,
    ownerWallet: request.ownerWallet,
    executorWallet: request.executorWallet,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: request.slippageBps,
    validator,
    quoteId: swapQuote?.quoteId ?? null,
    network: request.network,
    expiresAt: Date.now() + PRIVACY_SWAP_SESSION_TTL_MS,
    stage: 'prepared',
    swapSignature: null,
    outputAmount: null,
  });

  return {
    sessionId,
    validator,
    fundingTransaction,
    swapQuote,
    initializationTransactions,
  };
}

async function finalizeSwapPrivacyEnvelope(
  bindings: Bindings,
  request: FinalizeSwapPrivacyEnvelopeRequest,
): Promise<FinalizeSwapPrivacyEnvelopeResponse> {
  const lockToken = await acquirePrivacySwapFinalizeLock(bindings, request.sessionId);
  if (!lockToken) {
    const latestSession = await requirePrivacySwapSession(
      bindings,
      request.sessionId,
      request.ownerWallet,
      request.network,
    );

    if (
      latestSession.stage === 'executed' &&
      latestSession.swapSignature &&
      latestSession.outputAmount
    ) {
      return buildFinalizeResponse(
        bindings,
        latestSession,
        request,
        latestSession.swapSignature,
        latestSession.outputAmount,
      );
    }

    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'Private swap finalization is already in progress. Please retry shortly.',
      retryable: true,
      retryAfterMs: 2_000,
    });
  }

  try {
    const session = await requirePrivacySwapSession(
      bindings,
      request.sessionId,
      request.ownerWallet,
      request.network,
    );

    if (session.stage === 'executed' && session.swapSignature && session.outputAmount) {
      return buildFinalizeResponse(
        bindings,
        session,
        request,
        session.swapSignature,
        session.outputAmount,
      );
    }

    let outputAmount: string;
    let swapSignature: string;

    if (!session.quoteId) {
      throw new AppError({
        status: 409,
        code: 'INVALID_REQUEST',
        message:
          'Private swap quote is not ready yet. Fund the executor wallet, call /api/swap/privacy-envelope/refresh-quote, then retry finalize.',
        retryable: true,
      });
    }

    const executionResult = await executeSwapQuoteDetailed(bindings, {
      takerAddress: session.executorWallet,
      quoteId: session.quoteId,
      signedTransaction: request.signedTransaction,
      network: request.network,
    });

    outputAmount = executionResult.outputAmountResult ?? executionResult.totalOutputAmount ?? '';
    swapSignature = executionResult.signature;

    if (!outputAmount) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message:
          'The swap completed without a settlement amount. Please prepare a new private swap.',
        retryable: true,
      });
    }

    const executedSession: StoredPrivacySwapSession = {
      ...session,
      stage: 'executed',
      swapSignature,
      outputAmount,
    };

    await storePrivacySwapSession(bindings, executedSession);

    return buildFinalizeResponse(bindings, executedSession, request, swapSignature, outputAmount);
  } finally {
    try {
      await releasePrivacySwapFinalizeLock(bindings, request.sessionId, lockToken);
    } catch (error) {
      writeOperationalLog('error', {
        event: 'privacy_swap_finalize_lock_release_failed',
        network: request.network,
        details: {
          sessionId: request.sessionId,
          error,
        },
      });
    }
  }
}

async function refreshSwapPrivacyEnvelopeQuote(
  bindings: Bindings,
  request: RefreshSwapPrivacyEnvelopeQuoteRequest,
): Promise<RefreshSwapPrivacyEnvelopeQuoteResponse> {
  const session = await requirePrivacySwapSession(
    bindings,
    request.sessionId,
    request.ownerWallet,
    request.network,
  );

  if (session.stage === 'executed') {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This private swap session has already executed and cannot be re-quoted.',
    });
  }

  const swapQuote = await createFreshPrivacySwapQuote(bindings, session);
  return {
    sessionId: request.sessionId,
    validator: session.validator,
    swapQuote,
  };
}

export {
  PRIVACY_SWAP_SESSION_TTL_MS,
  finalizeSwapPrivacyEnvelope,
  prepareSwapPrivacyEnvelope,
  refreshSwapPrivacyEnvelopeQuote,
  type FinalizeSwapPrivacyEnvelopeRequest,
  type FinalizeSwapPrivacyEnvelopeResponse,
  type PrepareSwapPrivacyEnvelopeRequest,
  type PrepareSwapPrivacyEnvelopeResponse,
  type RefreshSwapPrivacyEnvelopeQuoteRequest,
  type RefreshSwapPrivacyEnvelopeQuoteResponse,
  type SwapPrivacyInitializationTransaction,
};
