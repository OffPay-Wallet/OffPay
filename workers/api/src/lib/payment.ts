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
import type { Bindings, Network } from './types.js';

const MAINNET_PAYMENT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_PAYMENT_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const NATIVE_SOL_ADDRESS = '11111111111111111111111111111111';
const PAYMENT_SETTLEMENT_MAX_BATCH_SIZE = 50;
const PAYMENT_SETTLEMENT_BATCH_DELAY_MS = 500;
const MAX_SHORTVEC_BYTES = 5;
const MAX_TRANSACTION_SIGNATURE_COUNT = 64;

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
  unsignedTransaction: string;
  transaction: MagicBlockUnsignedTransaction;
}

interface SettlePrivatePaymentsRequest {
  signedBlobs: string[];
  network: Network;
}

interface SettlePrivatePaymentsResult {
  txId: string;
  signature: string;
  status: 'confirmed' | 'failed';
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

async function readMagicBlockBalanceOrZero(
  loader: () => Promise<{ balance: string }>,
): Promise<string> {
  try {
    const resolvedBalance = await loader();
    return resolvedBalance.balance;
  } catch (error) {
    if (error instanceof AppError && error.status === 400 && error.code === 'INVALID_REQUEST') {
      return '0';
    }

    throw error;
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
    readMagicBlockBalanceOrZero(() =>
      getMagicBlockPrivateBalance(bindings, {
        address: request.walletAddress,
        mint,
        network: request.network,
      }),
    ),
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

  return {
    unsignedTransaction: transaction.transactionBase64,
    transaction,
  };
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

        try {
          const { signature } = await broadcastRawTransaction(bindings, {
            rawTransaction: signedBlob,
            network: request.network,
          });

          const executionStatus = await getTransactionExecutionStatus(bindings, {
            signature,
            network: request.network,
            attempts: 12,
            delayMs: 1_000,
          });

          if (executionStatus.success === false) {
            return {
              txId,
              signature,
              status: 'failed' as const,
            };
          }

          return {
            txId,
            signature,
            status: 'confirmed' as const,
          };
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
            signature: txId,
            status: 'failed' as const,
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
  initializePrivatePaymentMint,
  preparePrivatePayment,
  settlePrivatePayments,
  type GetPrivatePaymentBalanceRequest,
  type GetPrivatePaymentBalanceResponse,
  type InitializePrivatePaymentMintRequest,
  type InitializePrivatePaymentMintResponse,
  type PreparePrivatePaymentRequest,
  type PreparePrivatePaymentResponse,
  type SettlePrivatePaymentsRequest,
  type SettlePrivatePaymentsResponse,
  type SettlePrivatePaymentsResult,
};
