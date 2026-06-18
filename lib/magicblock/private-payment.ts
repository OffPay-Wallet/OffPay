import { Buffer } from 'buffer';

import { sha256 } from '@noble/hashes/sha2.js';

import {
  broadcastRawTransaction,
  getRpcFeeForMessage,
  initializePrivatePaymentMint,
  preparePrivateSend,
  OffpayApiError,
} from '@/lib/api/offpay-api-client';
import {
  instructionHasTokenTransferAmount,
  resolveMessageAccountKeys,
  verifyExpectedRecipient,
  verifyRequestedTokenMint,
} from '@/lib/magicblock/instruction-inspector';
import {
  assertInstructionIndexesAreSafe,
  assertRange,
  decodeBase64Transaction,
  instructionContainsAmount,
  normalizeAtomicAmount,
  parseSerializedTransaction,
  readShortVec,
} from '@/lib/magicblock/tx-parsing';
import { enqueuePendingPaymentBackup } from '@/lib/payments/pending-backup-queue';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { signSerializedTransactionForWallet } from '@/lib/crypto/solana-transaction-signing';
import { mark, measure } from '@/lib/perf/perf-marks';
import {
  PRIVATE_PAYMENT_LAYER_LABEL,
  STABLECOIN_ONLY_PAYMENT_MESSAGE,
  isSupportedStablecoinToken,
} from '@/lib/policy/stablecoin-policy';

import type {
  OffpayNetwork,
  PreparedTransaction,
  PrivateInitMintResponse,
  PrivateSendResponse,
  PrivateSendRequest,
} from '@/types/offpay-api';

const NATIVE_SOL_SYSTEM_MINT = '11111111111111111111111111111111';

export interface PrivatePaymentVerification {
  requiredSigners: string[];
  instructionCount: number;
  verifiedAmount: boolean;
  verifiedRecipient: boolean;
  recipientVerification: 'explicit' | 'private-route';
  verifiedMint: boolean;
}

export type PrivatePaymentSubmitResult =
  | {
      status: 'submitted';
      signature: string;
      initSignature: string | null;
      verification: PrivatePaymentVerification;
    }
  | {
      status: 'queued';
      txId: string;
      uploaded: boolean;
      reason: string;
      initSignature: string | null;
      verification: PrivatePaymentVerification;
    };

export interface SubmitPrivatePaymentParams extends PrivateSendRequest {
  walletId?: string | null;
  preparedPlan?: PreparedPrivatePaymentPlan | null;
}

export interface PreparedPrivatePaymentPlan {
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: OffpayNetwork;
  unsignedTransaction: string;
  transaction: PreparedTransaction | null;
  verification: PrivatePaymentVerification;
  feeLamports: number | null;
  preparedAt: number;
}

function assertPrivatePaymentInputs(params: {
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: OffpayNetwork;
}): bigint {
  if (!isValidSolanaAddress(params.walletAddress)) {
    throw new Error('Unlock a valid Solana wallet before sending a private payment.');
  }

  if (!isValidSolanaAddress(params.recipient)) {
    throw new Error('Enter a valid Solana recipient address.');
  }

  if (!isValidSolanaAddress(params.mint)) {
    throw new Error('Enter a valid Solana token mint address.');
  }

  if (params.mint === NATIVE_SOL_SYSTEM_MINT) {
    throw new Error('Native SOL is not supported for private payments. Use a token mint instead.');
  }

  if (!isSupportedStablecoinToken({ network: params.network, token: params.mint })) {
    throw new Error(
      `${STABLECOIN_ONLY_PAYMENT_MESSAGE} ${PRIVATE_PAYMENT_LAYER_LABEL} does not protect this token.`,
    );
  }

  return normalizeAtomicAmount(params.amount);
}

function verifyPrivateRouteMetadata(params: {
  unsignedTransaction: string;
  transaction: PreparedTransaction | null;
}): boolean {
  if (params.transaction == null) {
    return false;
  }

  const transaction = params.transaction;
  if (transaction.transactionBase64.trim() !== params.unsignedTransaction.trim()) {
    throw new Error('Private payment response metadata does not match the unsigned transaction.');
  }

  const routeKind = transaction.kind.toLowerCase();
  const hasRouteMarker =
    transaction.validator != null ||
    transaction.transferQueue != null ||
    transaction.rentPda != null ||
    transaction.sendTo != null;

  if (!routeKind.includes('private') && !routeKind.includes('transfer')) {
    throw new Error('Private payment response metadata is not a MagicBlock private transfer.');
  }

  if (!hasRouteMarker) {
    throw new Error('Private payment response metadata does not include MagicBlock route details.');
  }

  return true;
}

export async function verifyPrivatePaymentUnsignedTransaction(params: {
  unsignedTransaction: string;
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: OffpayNetwork;
  allowHiddenPrivateRecipient?: boolean;
  privateRouteTransaction?: PreparedTransaction | null;
}): Promise<PrivatePaymentVerification> {
  const startedAt = mark();
  try {
    const amount = assertPrivatePaymentInputs(params);
    const parsed = parseSerializedTransaction(params.unsignedTransaction);
    const accountKeys = await resolveMessageAccountKeys(parsed, params.network);

    if (!parsed.requiredSigners.includes(params.walletAddress)) {
      throw new Error('Private payment transaction is not signed by the active wallet.');
    }

    const recipientIsExplicit = verifyExpectedRecipient({
      parsed,
      accountKeys,
      recipient: params.recipient,
      mint: params.mint,
      amount,
    });
    const privateRouteIsAllowed =
      !recipientIsExplicit && params.allowHiddenPrivateRecipient === true;
    const privateRouteHasMetadata = privateRouteIsAllowed
      ? verifyPrivateRouteMetadata({
          unsignedTransaction: params.unsignedTransaction,
          transaction: params.privateRouteTransaction ?? null,
        })
      : false;
    const recipientVerification = recipientIsExplicit
      ? 'explicit'
      : privateRouteIsAllowed || privateRouteHasMetadata
        ? 'private-route'
        : null;
    if (recipientVerification == null) {
      throw new Error('Private payment transaction does not include the intended recipient.');
    }

    const verifiedMint = await verifyRequestedTokenMint({
      parsed,
      accountKeys,
      mint: params.mint,
      amount,
      network: params.network,
      allowInstructionDataMint: recipientVerification === 'private-route',
    });
    if (!verifiedMint) {
      throw new Error('Private payment transaction does not use the requested token mint.');
    }

    assertInstructionIndexesAreSafe(parsed, accountKeys.length);

    const verifiedAmount = parsed.instructions.some((instruction) => {
      return (
        instructionHasTokenTransferAmount({
          instruction,
          accountKeys,
          amount,
        }) || instructionContainsAmount(instruction.data, amount)
      );
    });

    if (!verifiedAmount) {
      throw new Error('Private payment transaction does not encode the requested amount.');
    }

    return {
      requiredSigners: parsed.requiredSigners,
      instructionCount: parsed.instructions.length,
      verifiedAmount,
      verifiedRecipient: true,
      recipientVerification,
      verifiedMint,
    };
  } finally {
    measure('magicblock.private.verify', startedAt, { network: params.network });
  }
}

function verifyMintInitTransaction(params: {
  unsignedTransaction: string;
  walletAddress: string;
  mint: string;
}): void {
  const parsed = parseSerializedTransaction(params.unsignedTransaction);

  if (!parsed.requiredSigners.includes(params.walletAddress)) {
    throw new Error('Private mint init transaction is not signed by the active wallet.');
  }

  if (!parsed.accountKeys.includes(params.mint)) {
    throw new Error('Private mint init transaction does not include the requested mint.');
  }

  assertInstructionIndexesAreSafe(parsed);
}

function resolveInitTransactionBase64(response: PrivateInitMintResponse): string | null {
  return response.unsignedTransaction ?? response.transaction?.transactionBase64 ?? null;
}

function resolvePrivateSendTransaction(response: PrivateSendResponse): {
  unsignedTransaction: string;
  transaction: PreparedTransaction | null;
} {
  const unsignedTransaction =
    response.unsignedTransaction ?? response.transaction?.transactionBase64 ?? null;

  if (unsignedTransaction == null || unsignedTransaction.trim().length === 0) {
    throw new Error('Private payment response did not include an unsigned transaction.');
  }

  return {
    unsignedTransaction,
    transaction: response.transaction ?? null,
  };
}

function extractMessageBase64FromSerializedTransaction(transactionBase64: string): string {
  const transaction = decodeBase64Transaction(transactionBase64);
  const signatureCount = readShortVec(transaction, 0);
  const messageOffset = signatureCount.offset + signatureCount.value * 64;

  assertRange(transaction, signatureCount.offset, signatureCount.value * 64, 'signatures');
  assertRange(transaction, messageOffset, transaction.length - messageOffset, 'message');

  return Buffer.from(transaction.subarray(messageOffset)).toString('base64');
}

function preparedPlanMatchesParams(
  params: SubmitPrivatePaymentParams,
  plan: PreparedPrivatePaymentPlan | null | undefined,
): plan is PreparedPrivatePaymentPlan {
  return (
    plan != null &&
    plan.walletAddress === params.walletAddress &&
    plan.recipient === params.recipient &&
    plan.mint === params.mint &&
    plan.amount === params.amount &&
    plan.network === params.network &&
    Date.now() - plan.preparedAt < 30_000
  );
}

function isBlockhashExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /blockhash not found|blockhash expired|expired blockhash/i.test(message);
}

function shouldQueueSignedPayment(error: unknown): boolean {
  if (!(error instanceof OffpayApiError)) return true;
  return error.retryable || error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM_UNAVAILABLE';
}

function buildPrivatePaymentTxId(signedTransaction: string): string {
  const digest = sha256(Uint8Array.from(Buffer.from(signedTransaction, 'base64')));
  const uuidBytes = Uint8Array.from(digest.slice(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(uuidBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function prepareVerifySignPrivateSend(
  params: SubmitPrivatePaymentParams,
  options?: { ignorePreparedPlan?: boolean },
): Promise<{ signedTransaction: string; verification: PrivatePaymentVerification }> {
  const startedAt = mark();
  let stage: 'prepare' | 'verify' | 'sign' = 'prepare';
  try {
    const plan =
      options?.ignorePreparedPlan !== true && preparedPlanMatchesParams(params, params.preparedPlan)
        ? params.preparedPlan
        : await preparePrivatePaymentPlanInternal(params, { estimateFee: false });
    if (plan === params.preparedPlan) {
      measure('magicblock.private.prepare.cached', mark(), { network: params.network });
    }

    stage = 'sign';
    const signStartedAt = mark();
    const signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: plan.unsignedTransaction,
      walletAddress: params.walletAddress,
      walletId: params.walletId,
    });
    measure('magicblock.private.sign', signStartedAt, { network: params.network });

    return { signedTransaction, verification: plan.verification };
  } finally {
    measure('magicblock.private.prepareVerifySign', startedAt, {
      network: params.network,
      stage,
    });
  }
}

export async function preparePrivatePaymentPlan(
  params: PrivateSendRequest,
): Promise<PreparedPrivatePaymentPlan> {
  return preparePrivatePaymentPlanInternal(params, { estimateFee: true });
}

async function preparePrivatePaymentPlanInternal(
  params: PrivateSendRequest,
  options: { estimateFee: boolean },
): Promise<PreparedPrivatePaymentPlan> {
  assertPrivatePaymentInputs(params);
  const startedAt = mark();
  let stage: 'prepare' | 'verify' | 'fee' = 'prepare';
  try {
    const prepareStartedAt = mark();
    const prepared = await preparePrivateSend({
      walletAddress: params.walletAddress,
      recipient: params.recipient,
      amount: params.amount,
      mint: params.mint,
      network: params.network,
    });
    measure('magicblock.private.prepare', prepareStartedAt, { network: params.network });

    const preparedTransaction = resolvePrivateSendTransaction(prepared);
    stage = 'verify';
    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction: preparedTransaction.unsignedTransaction,
      walletAddress: params.walletAddress,
      recipient: params.recipient,
      amount: params.amount,
      mint: params.mint,
      network: params.network,
      allowHiddenPrivateRecipient: true,
      privateRouteTransaction: preparedTransaction.transaction,
    });

    let feeLamports: number | null = null;
    if (options.estimateFee) {
      stage = 'fee';
      const feeStartedAt = mark();
      const fee = await getRpcFeeForMessage({
        network: params.network,
        messageBase64: extractMessageBase64FromSerializedTransaction(
          preparedTransaction.unsignedTransaction,
        ),
      });
      feeLamports = fee.lamports;
      measure('magicblock.private.feeForMessage', feeStartedAt, { network: params.network });
    }

    return {
      walletAddress: params.walletAddress,
      recipient: params.recipient,
      mint: params.mint,
      amount: params.amount,
      network: params.network,
      unsignedTransaction: preparedTransaction.unsignedTransaction,
      transaction: preparedTransaction.transaction,
      verification,
      feeLamports,
      preparedAt: Date.now(),
    };
  } finally {
    measure('magicblock.private.preparePlan', startedAt, {
      network: params.network,
      stage,
    });
  }
}

async function queueSignedPrivatePayment(params: {
  request: SubmitPrivatePaymentParams;
  signedTransaction: string;
  verification: PrivatePaymentVerification;
  initSignature: string | null;
  error: unknown;
}): Promise<PrivatePaymentSubmitResult> {
  const txId = buildPrivatePaymentTxId(params.signedTransaction);
  const backup = await enqueuePendingPaymentBackup({
    walletAddress: params.request.walletAddress,
    walletId: params.request.walletId ?? undefined,
    network: params.request.network,
    txId,
    signedBlob: params.signedTransaction,
    kind: 'private-payment',
    metadata: {
      recipient: params.request.recipient,
      mint: params.request.mint,
      amount: params.request.amount,
    },
    uploadImmediately: true,
  });

  return {
    status: 'queued',
    txId,
    uploaded: backup.uploaded,
    reason:
      params.error instanceof Error
        ? params.error.message
        : 'Payment submission could not complete.',
    initSignature: params.initSignature,
    verification: params.verification,
  };
}

async function initializeMintIfNeeded(params: SubmitPrivatePaymentParams): Promise<string | null> {
  const startedAt = mark();
  let status: PrivateInitMintResponse['status'] | 'unknown' = 'unknown';
  try {
    const initStartedAt = mark();
    const init = await initializePrivatePaymentMint({
      walletAddress: params.walletAddress,
      mintAddress: params.mint,
      network: params.network,
    });
    status = init.status;
    measure('magicblock.private.initMint.request', initStartedAt, {
      network: params.network,
      status,
    });

    if (init.status !== 'requires_signature') {
      return null;
    }

    const initTransaction = resolveInitTransactionBase64(init);
    if (initTransaction == null) {
      throw new Error(
        'Private mint initialization requires a signature but no transaction was returned.',
      );
    }

    verifyMintInitTransaction({
      unsignedTransaction: initTransaction,
      walletAddress: params.walletAddress,
      mint: params.mint,
    });

    const signStartedAt = mark();
    const signedInitTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: initTransaction,
      walletAddress: params.walletAddress,
      walletId: params.walletId,
    });
    measure('magicblock.private.initMint.sign', signStartedAt, { network: params.network });

    const broadcastStartedAt = mark();
    const result = await broadcastRawTransaction({
      rawTransaction: signedInitTransaction,
      network: params.network,
    });
    measure('magicblock.private.initMint.broadcast', broadcastStartedAt, {
      network: params.network,
    });

    return result.signature;
  } finally {
    measure('magicblock.private.initMint.total', startedAt, {
      network: params.network,
      status,
    });
  }
}

export async function submitPrivatePayment(
  params: SubmitPrivatePaymentParams,
): Promise<PrivatePaymentSubmitResult> {
  const startedAt = mark();
  let status: PrivatePaymentSubmitResult['status'] | 'error' = 'error';
  try {
    assertPrivatePaymentInputs(params);

    const initSignature = await initializeMintIfNeeded(params);
    let signed = await prepareVerifySignPrivateSend(params);

    try {
      const broadcastStartedAt = mark();
      const submitted = await broadcastRawTransaction({
        rawTransaction: signed.signedTransaction,
        network: params.network,
      });
      measure('magicblock.private.broadcast', broadcastStartedAt, { network: params.network });

      status = 'submitted';
      return {
        status: 'submitted',
        signature: submitted.signature,
        initSignature,
        verification: signed.verification,
      };
    } catch (error) {
      if (isBlockhashExpiredError(error)) {
        signed = await prepareVerifySignPrivateSend(params, { ignorePreparedPlan: true });
        try {
          const retryBroadcastStartedAt = mark();
          const submitted = await broadcastRawTransaction({
            rawTransaction: signed.signedTransaction,
            network: params.network,
          });
          measure('magicblock.private.broadcast.retry', retryBroadcastStartedAt, {
            network: params.network,
          });

          status = 'submitted';
          return {
            status: 'submitted',
            signature: submitted.signature,
            initSignature,
            verification: signed.verification,
          };
        } catch (retryError) {
          if (!shouldQueueSignedPayment(retryError)) {
            throw retryError;
          }

          status = 'queued';
          return queueSignedPrivatePayment({
            request: params,
            signedTransaction: signed.signedTransaction,
            verification: signed.verification,
            initSignature,
            error: retryError,
          });
        }
      }

      if (!shouldQueueSignedPayment(error)) {
        throw error;
      }

      status = 'queued';
      return queueSignedPrivatePayment({
        request: params,
        signedTransaction: signed.signedTransaction,
        verification: signed.verification,
        initSignature,
        error,
      });
    }
  } finally {
    measure('magicblock.private.submit.total', startedAt, {
      network: params.network,
      status,
    });
  }
}

export function isNativeSolPrivatePaymentMint(mint: string): boolean {
  return mint.trim() === NATIVE_SOL_SYSTEM_MINT;
}
