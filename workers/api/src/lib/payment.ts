import bs58 from 'bs58';
import { AppError } from './errors.js';
import {
  broadcastRawTransaction,
  getTransactionExecutionStatus,
  getWalletMintRawBalance,
} from './helius.js';
import { writeOperationalLog } from './logging.js';
import {
  createMagicBlockPrivatePaymentTransaction,
  createMagicBlockQueueInitializationTransaction,
  getMagicBlockMintInitializationStatus,
  getMagicBlockPrivateBalance,
  resolveMagicBlockPrimaryValidator,
  type MagicBlockUnsignedTransaction,
} from './magicblock.js';
import { getSupportedStablecoins } from './offline.js';
import { readFiniteNumber, readTrimmedString, runKvPipeline } from './provider-utils.js';
import { acquireRedisLock, releaseRedisLock } from './redis-lock.js';
import { readBoundTransactionMessage } from './solana-transaction-binding.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const MAINNET_PAYMENT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_PAYMENT_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const NATIVE_SOL_ADDRESS = '11111111111111111111111111111111';
const PAYMENT_SETTLEMENT_MAX_BATCH_SIZE = 50;
const PAYMENT_SETTLEMENT_BATCH_DELAY_MS = 500;
const MAX_SHORTVEC_BYTES = 5;
const MAX_TRANSACTION_SIGNATURE_COUNT = 64;
const PRIVATE_SEND_INTENT_KEY_PREFIX = 'magicblock-private-send-intent:v1';
const PRIVATE_SEND_EXECUTE_LOCK_KEY_PREFIX = 'magicblock-private-send-execute-lock:v1';
const PRIVATE_SEND_INTENT_TTL_MS = 90_000;
const PRIVATE_SEND_EXECUTE_LOCK_TTL_SECONDS = 30;
const MAGICBLOCK_PRIVATE_TRANSFER_FEE_DIVISOR = 1_000n;

interface InitializePrivatePaymentMintRequest {
  walletAddress: string;
  mintAddress: string;
  network: Network;
}

interface InitializePrivatePaymentMintResponse {
  queueId: string;
  validator: string;
  status: 'initialized' | 'requires_signature';
  unsignedTransaction?: string;
  transaction?: MagicBlockUnsignedTransaction;
}

interface GetPrivatePaymentBalanceRequest {
  walletAddress: string;
  mintAddress?: string;
  network: Network;
}

interface GetPrivatePaymentBalanceResponse {
  address: string;
  baseBalance: string;
  privateBalance: string;
  mint: string;
}

interface PreparePrivatePaymentRequest {
  walletAddress: string;
  recipient: string;
  amount: string;
  mint: string;
  network: Network;
}

interface PreparePrivatePaymentResponse {
  intentId: string;
  expiresAt: number;
  unsignedTransaction: string;
  transaction: MagicBlockUnsignedTransaction;
}

interface ExecutePrivatePaymentRequest {
  intentId: string;
  walletAddress: string;
  signedTransaction: string;
  network: Network;
}

interface ExecutePrivatePaymentResponse {
  intentId: string;
  signature: string;
  status: 'confirmed' | 'pending';
}

interface StoredPrivatePaymentIntent {
  intentId: string;
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: Network;
  transactionMessageBase64: string;
  expiresAt: number;
}

interface SettlePrivatePaymentsRequest {
  signedBlobs: string[];
  network: Network;
}

interface SettlePrivatePaymentsResult {
  txId: string;
  signature: string | null;
  status: 'confirmed' | 'pending' | 'failed';
}

interface SettlePrivatePaymentsResponse {
  batchId: string;
  results: SettlePrivatePaymentsResult[];
}

function getDefaultPaymentMint(network: Network): string {
  return network === 'mainnet' ? MAINNET_PAYMENT_MINT : DEVNET_PAYMENT_MINT;
}

function assertPrivatePaymentMintSupported(
  bindings: Bindings,
  network: Network,
  mint: string,
): void {
  if (mint === NATIVE_SOL_ADDRESS) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Native SOL is not supported by the private payment flow. Use USDC or USDT.',
    });
  }

  const supportedStablecoin = getSupportedStablecoins(bindings, network).find(
    (stablecoin) => stablecoin.enabled && stablecoin.mint === mint,
  );
  if (!supportedStablecoin) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `Private payments support only configured USDC/USDT mints on ${network}.`,
    });
  }
}

function splitIntoChunks<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function buildSyntheticSettlementTxId(
  batchId: string,
  chunkIndex: number,
  itemIndex: number,
): string {
  return `synthetic:${batchId}:${chunkIndex}:${itemIndex}`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readShortvec(
  bytes: Uint8Array,
  offset: number,
): {
  value: number;
  nextOffset: number;
} {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  let consumedBytes = 0;

  while (cursor < bytes.length) {
    const byte = bytes[cursor]!;
    value |= (byte & 0x7f) << shift;
    cursor += 1;
    consumedBytes += 1;

    if ((byte & 0x80) === 0) {
      return {
        value,
        nextOffset: cursor,
      };
    }

    shift += 7;
    if (consumedBytes >= MAX_SHORTVEC_BYTES) {
      break;
    }
  }

  throw new Error('Invalid shortvec length.');
}

function deriveTransactionSignature(rawTransaction: string, fallback: string): string {
  try {
    const bytes = decodeBase64(rawTransaction);
    const { value: signatureCount, nextOffset } = readShortvec(bytes, 0);
    if (
      signatureCount < 1 ||
      signatureCount > MAX_TRANSACTION_SIGNATURE_COUNT ||
      bytes.length < nextOffset + 64
    ) {
      return fallback;
    }

    return bs58.encode(bytes.slice(nextOffset, nextOffset + 64));
  } catch {
    return fallback;
  }
}

/**
 * MagicBlock's public private-balance API does not expose a validator selector,
 * so the payment module pins initialization and send flows to the primary
 * allowlisted validator per network. Environment allowlists should be ordered
 * with the preferred/default payment validator first.
 */
function resolvePaymentValidator(bindings: Bindings, network: Network): string {
  return resolveMagicBlockPrimaryValidator(bindings, network);
}

function buildPrivatePaymentIntentKey(intentId: string): string {
  return `${PRIVATE_SEND_INTENT_KEY_PREFIX}:${intentId}`;
}

function buildPrivatePaymentExecuteLockKey(intentId: string): string {
  return `${PRIVATE_SEND_EXECUTE_LOCK_KEY_PREFIX}:${intentId}`;
}

async function storePrivatePaymentIntent(
  bindings: Bindings,
  intent: StoredPrivatePaymentIntent,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((intent.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [['SET', buildPrivatePaymentIntentKey(intent.intentId), JSON.stringify(intent), 'EX', ttlSeconds]],
    'Private payment intent storage is unavailable.',
  );
}

async function getPrivatePaymentIntent(
  bindings: Bindings,
  intentId: string,
): Promise<StoredPrivatePaymentIntent | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildPrivatePaymentIntentKey(intentId)]],
    'Private payment intent storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isRecord(parsed)) return null;
    const parsedIntentId = readTrimmedString(parsed.intentId);
    const walletAddress = readTrimmedString(parsed.walletAddress);
    const recipient = readTrimmedString(parsed.recipient);
    const mint = readTrimmedString(parsed.mint);
    const amount = readTrimmedString(parsed.amount);
    const network = readTrimmedString(parsed.network);
    const transactionMessageBase64 = readTrimmedString(parsed.transactionMessageBase64);
    const expiresAt = readFiniteNumber(parsed.expiresAt);
    if (
      parsedIntentId !== intentId ||
      !walletAddress ||
      !recipient ||
      !mint ||
      !isValidSolanaAddress(walletAddress) ||
      !isValidSolanaAddress(recipient) ||
      !isValidSolanaAddress(mint) ||
      !amount ||
      !/^\d+$/.test(amount) ||
      (network !== 'mainnet' && network !== 'devnet') ||
      !transactionMessageBase64 ||
      expiresAt == null
    ) {
      return null;
    }
    return {
      intentId,
      walletAddress,
      recipient,
      mint,
      amount,
      network,
      transactionMessageBase64,
      expiresAt,
    };
  } catch {
    return null;
  }
}

async function deletePrivatePaymentIntent(bindings: Bindings, intentId: string): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildPrivatePaymentIntentKey(intentId)]],
    'Private payment intent storage is unavailable.',
  );
}

async function initializePrivatePaymentMint(
  bindings: Bindings,
  request: InitializePrivatePaymentMintRequest,
): Promise<InitializePrivatePaymentMintResponse> {
  assertPrivatePaymentMintSupported(bindings, request.network, request.mintAddress);
  const validator = resolvePaymentValidator(bindings, request.network);
  const status = await getMagicBlockMintInitializationStatus(bindings, {
    mint: request.mintAddress,
    network: request.network,
    validator,
  });

  if (status.initialized) {
    if (!status.transferQueue) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message:
          'MagicBlock mint initialization is inconsistent because the transfer queue ID is missing.',
        retryable: true,
      });
    }

    return {
      queueId: status.transferQueue,
      validator: status.validator,
      status: 'initialized',
    };
  }

  const transaction = await createMagicBlockQueueInitializationTransaction(bindings, {
    payerWallet: request.walletAddress,
    mint: request.mintAddress,
    network: request.network,
    validator,
  });

  const queueId = status.transferQueue ?? transaction.transferQueue;
  if (!queueId) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock mint initialization is currently unavailable.',
      retryable: true,
    });
  }

  return {
    queueId,
    validator: transaction.validator ?? status.validator,
    status: 'requires_signature',
    unsignedTransaction: transaction.transactionBase64,
    transaction,
  };
}

async function getPrivatePaymentBalance(
  bindings: Bindings,
  request: GetPrivatePaymentBalanceRequest,
): Promise<GetPrivatePaymentBalanceResponse> {
  const mint = request.mintAddress ?? getDefaultPaymentMint(request.network);
  assertPrivatePaymentMintSupported(bindings, request.network, mint);
  const [baseBalance, privateBalance] = await Promise.all([
    getWalletMintRawBalance(bindings, {
      address: request.walletAddress,
      mint,
      network: request.network,
    }),
    getMagicBlockPrivateBalance(bindings, {
      address: request.walletAddress,
      mint,
      network: request.network,
    }).then((response) => response.balance),
  ]);

  return {
    address: request.walletAddress,
    baseBalance,
    privateBalance,
    mint,
  };
}

async function preparePrivatePayment(
  bindings: Bindings,
  request: PreparePrivatePaymentRequest,
): Promise<PreparePrivatePaymentResponse> {
  assertPrivatePaymentMintSupported(bindings, request.network, request.mint);
  const baseBalance = await getWalletMintRawBalance(bindings, {
    address: request.walletAddress,
    mint: request.mint,
    network: request.network,
  });

  if (BigInt(baseBalance) < BigInt(request.amount)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Sender public payment balance is insufficient for this transfer.',
    });
  }

  const transaction = await createMagicBlockPrivatePaymentTransaction(bindings, {
    senderWallet: request.walletAddress,
    recipientWallet: request.recipient,
    mint: request.mint,
    amount: request.amount,
    network: request.network,
    validator: resolvePaymentValidator(bindings, request.network),
  });

  if (
    transaction.kind !== 'transfer' ||
    transaction.version !== 'v0' ||
    transaction.sendTo !== 'base' ||
    transaction.instructionCount !== 4 ||
    transaction.requiredSigners.length !== 1 ||
    transaction.requiredSigners[0] !== request.walletAddress ||
    transaction.validator !== resolvePaymentValidator(bindings, request.network) ||
    transaction.fees == null ||
    !/^\d+$/.test(transaction.fees.lamports) ||
    !/^\d+$/.test(transaction.fees.tokens)
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock returned an incompatible private transfer transaction.',
      retryable: true,
    });
  }

  const tokenFee = BigInt(transaction.fees.tokens);
  const expectedTokenFee = BigInt(request.amount) / MAGICBLOCK_PRIVATE_TRANSFER_FEE_DIVISOR;
  if (tokenFee !== expectedTokenFee) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock returned an unexpected private transfer fee.',
      retryable: true,
    });
  }
  if (BigInt(baseBalance) < BigInt(request.amount) + tokenFee) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Sender public payment balance is insufficient for the amount and protocol fee.',
    });
  }

  const intentId = crypto.randomUUID();
  const expiresAt = Date.now() + PRIVATE_SEND_INTENT_TTL_MS;
  await storePrivatePaymentIntent(bindings, {
    intentId,
    walletAddress: request.walletAddress,
    recipient: request.recipient,
    mint: request.mint,
    amount: request.amount,
    network: request.network,
    transactionMessageBase64: readBoundTransactionMessage({
      transactionBase64: transaction.transactionBase64,
      requiredSignerAddress: request.walletAddress,
      requireSignerSignature: false,
      label: 'Private payment',
    }),
    expiresAt,
  });

  return {
    intentId,
    expiresAt,
    unsignedTransaction: transaction.transactionBase64,
    transaction,
  };
}

async function executePrivatePayment(
  bindings: Bindings,
  request: ExecutePrivatePaymentRequest,
): Promise<ExecutePrivatePaymentResponse> {
  const lockKey = buildPrivatePaymentExecuteLockKey(request.intentId);
  const lockToken = await acquireRedisLock({
    bindings,
    key: lockKey,
    ttlSeconds: PRIVATE_SEND_EXECUTE_LOCK_TTL_SECONDS,
    unavailableMessage: 'Private payment execution state is unavailable.',
  });
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This private payment is already being submitted.',
      retryable: true,
      retryAfterMs: 750,
    });
  }

  try {
    const intent = await getPrivatePaymentIntent(bindings, request.intentId);
    if (
      intent == null ||
      intent.walletAddress !== request.walletAddress ||
      intent.network !== request.network ||
      intent.expiresAt <= Date.now()
    ) {
      if (intent != null) await deletePrivatePaymentIntent(bindings, request.intentId);
      throw new AppError({
        status: 410,
        code: 'QUOTE_EXPIRED',
        message: 'Private payment preparation expired. Prepare the payment again.',
        retryable: true,
      });
    }

    const signedMessage = readBoundTransactionMessage({
      transactionBase64: request.signedTransaction,
      requiredSignerAddress: request.walletAddress,
      requireSignerSignature: true,
      label: 'Private payment',
    });
    if (signedMessage !== intent.transactionMessageBase64) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed private payment does not match the prepared transaction.',
      });
    }

    const broadcast = await broadcastRawTransaction(bindings, {
      rawTransaction: request.signedTransaction,
      network: request.network,
    });
    await deletePrivatePaymentIntent(bindings, request.intentId);

    let executionStatus: Awaited<ReturnType<typeof getTransactionExecutionStatus>>;
    try {
      executionStatus = await getTransactionExecutionStatus(bindings, {
        signature: broadcast.signature,
        network: request.network,
        attempts: 12,
        delayMs: 1_000,
      });
    } catch (error) {
      writeOperationalLog('warn', {
        event: 'private_payment_confirmation_deferred',
        network: request.network,
        details: { intentId: request.intentId, signature: broadcast.signature, error },
      });
      return {
        intentId: request.intentId,
        signature: broadcast.signature,
        status: 'pending',
      };
    }

    if (executionStatus.success === false) {
      throw new AppError({
        status: 422,
        code: 'INVALID_REQUEST',
        message: 'The private payment transaction failed on-chain.',
      });
    }
    return {
      intentId: request.intentId,
      signature: broadcast.signature,
      status: executionStatus.success === true ? 'confirmed' : 'pending',
    };
  } finally {
    await releaseRedisLock({
      bindings,
      key: lockKey,
      token: lockToken,
      unavailableMessage: 'Private payment execution state is unavailable.',
    });
  }
}

async function settlePrivatePayments(
  bindings: Bindings,
  request: SettlePrivatePaymentsRequest,
): Promise<SettlePrivatePaymentsResponse> {
  const batchId = crypto.randomUUID();
  const chunks = splitIntoChunks(request.signedBlobs, PAYMENT_SETTLEMENT_MAX_BATCH_SIZE);
  const results: SettlePrivatePaymentsResult[] = [];

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    if (chunkIndex > 0) {
      await sleep(PAYMENT_SETTLEMENT_BATCH_DELAY_MS);
    }

    const chunk = chunks[chunkIndex]!;
    const chunkResults = await Promise.all(
      chunk.map(async (signedBlob, itemIndex) => {
        const fallbackId = buildSyntheticSettlementTxId(batchId, chunkIndex, itemIndex);
        const txId = deriveTransactionSignature(signedBlob, fallbackId);
        let signature: string | null = null;

        try {
          const broadcast = await broadcastRawTransaction(bindings, {
            rawTransaction: signedBlob,
            network: request.network,
          });
          signature = broadcast.signature;

          let executionStatus: Awaited<ReturnType<typeof getTransactionExecutionStatus>>;
          try {
            executionStatus = await getTransactionExecutionStatus(bindings, {
              signature,
              network: request.network,
              attempts: 12,
              delayMs: 1_000,
            });
          } catch (error) {
            writeOperationalLog('warn', {
              event: 'private_payment_settlement_confirmation_deferred',
              network: request.network,
              details: { batchId, txId, signature, chunkIndex, itemIndex, error },
            });
            return { txId, signature, status: 'pending' as const };
          }

          if (executionStatus.success === false) {
            return { txId, signature, status: 'failed' as const };
          }
          if (executionStatus.success === null) {
            return { txId, signature, status: 'pending' as const };
          }
          return { txId, signature, status: 'confirmed' as const };
        } catch (error) {
          writeOperationalLog('error', {
            event: 'private_payment_settlement_broadcast_failed',
            network: request.network,
            details: {
              batchId,
              txId,
              chunkIndex,
              itemIndex,
              error,
            },
          });

          return {
            txId,
            signature,
            status: signature == null ? ('failed' as const) : ('pending' as const),
          };
        }
      }),
    );

    results.push(...chunkResults);
  }

  return {
    batchId,
    results,
  };
}

export {
  DEVNET_PAYMENT_MINT,
  MAINNET_PAYMENT_MINT,
  PAYMENT_SETTLEMENT_BATCH_DELAY_MS,
  PAYMENT_SETTLEMENT_MAX_BATCH_SIZE,
  getDefaultPaymentMint,
  getPrivatePaymentBalance,
  executePrivatePayment,
  initializePrivatePaymentMint,
  preparePrivatePayment,
  settlePrivatePayments,
  type GetPrivatePaymentBalanceRequest,
  type GetPrivatePaymentBalanceResponse,
  type ExecutePrivatePaymentRequest,
  type ExecutePrivatePaymentResponse,
  type InitializePrivatePaymentMintRequest,
  type InitializePrivatePaymentMintResponse,
  type PreparePrivatePaymentRequest,
  type PreparePrivatePaymentResponse,
  type SettlePrivatePaymentsRequest,
  type SettlePrivatePaymentsResponse,
  type SettlePrivatePaymentsResult,
};
