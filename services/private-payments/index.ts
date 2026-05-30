import { Buffer } from 'buffer';

import bs58 from 'bs58';

import { broadcastRawTransaction, getWalletMintRawBalance } from '@/services/rpc';
import { getStablecoinSymbolForMint, isKnownStablecoinMint } from '@/lib/policy/stablecoin-policy';
import { readJsonResponseAdaptive, stringifyJsonAdaptive } from '@/lib/perf/ui-work-scheduler';

import type {
  OffpayNetwork,
  PaymentSettleRequest,
  PaymentSettleResponse,
  PreparedTransaction,
  PrivateBalanceResponse,
  PrivateInitMintRequest,
  PrivateInitMintResponse,
  PrivateSendRequest,
  PrivateSendResponse,
} from '@/types/offpay-api';

const MAGICBLOCK_API_BASE_URL = 'https://payments.magicblock.app';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SAFE_PROVIDER_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);
const PUBLIC_MAGICBLOCK_ENV = {
  EXPO_PUBLIC_MAGICBLOCK_MAINNET_VALIDATORS: process.env.EXPO_PUBLIC_MAGICBLOCK_MAINNET_VALIDATORS,
  EXPO_PUBLIC_MAGICBLOCK_DEVNET_VALIDATORS: process.env.EXPO_PUBLIC_MAGICBLOCK_DEVNET_VALIDATORS,
} satisfies Record<string, string | undefined>;

function publicEnv(key: keyof typeof PUBLIC_MAGICBLOCK_ENV): string | null {
  const value = PUBLIC_MAGICBLOCK_ENV[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function validatorList(network: OffpayNetwork): string[] {
  const raw =
    network === 'mainnet'
      ? publicEnv('EXPO_PUBLIC_MAGICBLOCK_MAINNET_VALIDATORS')
      : publicEnv('EXPO_PUBLIC_MAGICBLOCK_DEVNET_VALIDATORS');
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function primaryValidator(network: OffpayNetwork): string {
  const validator = validatorList(network)[0];
  if (validator == null) {
    throw new Error('MagicBlock validator configuration is missing from Expo public env.');
  }
  return validator;
}

/**
 * Whether MagicBlock has at least one configured validator for the network.
 * Used by payroll route preflight to gate the MagicBlock route without
 * throwing.
 */
export function hasMagicBlockValidatorConfig(network: OffpayNetwork): boolean {
  return validatorList(network).length > 0;
}

function assertSupportedMint(network: OffpayNetwork, mint: string): void {
  if (!isKnownStablecoinMint(network, mint)) {
    throw new Error(`Private payments support only configured USDC/USDT mints on ${network}.`);
  }
}

function assertProviderSafeAmount(amount: string): void {
  if (!/^\d+$/.test(amount) || amount === '0') {
    throw new Error('Amount must be a positive integer string.');
  }
  if (BigInt(amount) > MAX_SAFE_PROVIDER_AMOUNT) {
    throw new Error('Amount exceeds the safe integer range supported by MagicBlock.');
  }
}

function withTimeout(
  upstream?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let upstreamAbort: (() => void) | null = null;
  if (upstream != null) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      upstreamAbort = () => controller.abort(upstream.reason);
      upstream.addEventListener('abort', upstreamAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`MagicBlock request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (upstream != null && upstreamAbort != null) {
        upstream.removeEventListener('abort', upstreamAbort);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function providerMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const nested = isRecord(payload.error) ? payload.error : null;
  return (
    stringValue(payload.message) ??
    stringValue(payload.error) ??
    stringValue(payload.cause) ??
    stringValue(payload.status) ??
    stringValue(nested?.message) ??
    stringValue(nested?.error) ??
    null
  );
}

async function parseProviderJson(response: Response): Promise<unknown> {
  try {
    return await readJsonResponseAdaptive(response);
  } catch {
    return null;
  }
}

async function stringifyJsonBody(value: unknown): Promise<string> {
  return stringifyJsonAdaptive(value);
}

async function magicBlockJson(
  path: string,
  init: RequestInit,
  network: OffpayNetwork,
  signal?: AbortSignal,
): Promise<unknown> {
  const handle = withTimeout(signal);
  try {
    const response = await fetch(`${MAGICBLOCK_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: handle.signal,
    });
    const payload = await parseProviderJson(response);
    if (!response.ok) {
      const retryable = response.status !== 400 && response.status !== 422;
      throw new Error(
        providerMessage(payload) ??
          (retryable
            ? `MagicBlock ${network} provider is temporarily unavailable.`
            : 'MagicBlock request was rejected.'),
      );
    }
    return payload;
  } finally {
    handle.cleanup();
  }
}

function parsePreparedTransaction(
  payload: unknown,
  fallbackKind: string,
  validator: string | null,
): PreparedTransaction {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return {
      kind: fallbackKind,
      version: null,
      transactionBase64: payload.trim(),
      sendTo: null,
      recentBlockhash: null,
      lastValidBlockHeight: null,
      instructionCount: null,
      requiredSigners: [],
      validator,
      transferQueue: null,
      rentPda: null,
    };
  }
  if (!isRecord(payload)) {
    throw new Error('MagicBlock transaction preparation returned an unreadable response.');
  }
  const transactionBase64 =
    stringValue(payload.transactionBase64) ?? stringValue(payload.transaction);
  if (transactionBase64 == null) {
    throw new Error('MagicBlock transaction preparation did not include a transaction.');
  }
  return {
    kind: stringValue(payload.kind) ?? fallbackKind,
    version: stringValue(payload.version),
    transactionBase64,
    sendTo: stringValue(payload.sendTo),
    recentBlockhash: stringValue(payload.recentBlockhash),
    lastValidBlockHeight: numberValue(payload.lastValidBlockHeight),
    instructionCount: numberValue(payload.instructionCount),
    requiredSigners: Array.isArray(payload.requiredSigners)
      ? payload.requiredSigners.flatMap((entry) => {
          const signer = stringValue(entry);
          return signer == null ? [] : [signer];
        })
      : [],
    validator: stringValue(payload.validator) ?? validator,
    transferQueue: stringValue(payload.transferQueue),
    rentPda: stringValue(payload.rentPda),
  };
}

function parseBalance(payload: unknown): string {
  if (!isRecord(payload)) return '0';
  const balance = stringValue(payload.balance) ?? stringValue(payload.amount);
  if (balance != null && /^\d+$/.test(balance)) return balance;
  const numeric = numberValue(payload.balance) ?? numberValue(payload.amount);
  return numeric == null ? '0' : Math.trunc(numeric).toString();
}

function primarySignature(rawTransactionBase64: string, fallback: string): string {
  try {
    const bytes = Uint8Array.from(Buffer.from(rawTransactionBase64, 'base64'));
    let cursor = 0;
    let signatureCount = 0;
    let shift = 0;
    while (cursor < bytes.length) {
      const byte = bytes[cursor] ?? 0;
      signatureCount |= (byte & 0x7f) << shift;
      cursor += 1;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    if (signatureCount < 1 || bytes.length < cursor + 64) return fallback;
    return bs58.encode(bytes.subarray(cursor, cursor + 64));
  } catch {
    return fallback;
  }
}

export async function initializePrivatePaymentMint(
  request: PrivateInitMintRequest,
): Promise<PrivateInitMintResponse> {
  assertSupportedMint(request.network, request.mintAddress);
  const validator = primaryValidator(request.network);
  const params = new URLSearchParams({
    mint: request.mintAddress,
    cluster: request.network,
    validator,
  });
  const statusPayload = await magicBlockJson(
    `/v1/spl/is-mint-initialized?${params.toString()}`,
    { method: 'GET' },
    request.network,
  );
  const transferQueue = isRecord(statusPayload) ? stringValue(statusPayload.transferQueue) : null;
  const initialized = isRecord(statusPayload) && statusPayload.initialized === true;

  if (initialized && transferQueue != null) {
    return {
      queueId: transferQueue,
      validator: stringValue(isRecord(statusPayload) ? statusPayload.validator : null) ?? validator,
      status: 'initialized',
    };
  }

  const transactionPayload = await magicBlockJson(
    '/v1/spl/initialize-mint',
    {
      method: 'POST',
      body: await stringifyJsonBody({
        payer: request.walletAddress,
        mint: request.mintAddress,
        cluster: request.network,
        validator,
      }),
    },
    request.network,
  );
  const transaction = parsePreparedTransaction(transactionPayload, 'initializeMint', validator);
  return {
    queueId: transferQueue ?? transaction.transferQueue ?? '',
    validator: transaction.validator ?? validator,
    status: 'requires_signature',
    unsignedTransaction: transaction.transactionBase64,
    transaction,
  };
}

export async function getPrivatePaymentBalance(
  walletAddress: string,
  network: OffpayNetwork,
  mint?: string,
): Promise<PrivateBalanceResponse> {
  const selectedMint = mint?.trim();
  if (selectedMint == null || selectedMint.length === 0) {
    throw new Error('Private payment balance requires a token mint.');
  }
  assertSupportedMint(network, selectedMint);
  const params = new URLSearchParams({
    owner: walletAddress,
    cluster: network,
    mint: selectedMint,
  });
  const [baseBalance, privatePayload] = await Promise.all([
    getWalletMintRawBalance({ address: walletAddress, mint: selectedMint, network }),
    magicBlockJson(
      `/v1/spl/private-balance?${params.toString()}`,
      { method: 'GET' },
      network,
    ).catch(() => ({ balance: '0' })),
  ]);
  return {
    address: walletAddress,
    baseBalance,
    privateBalance: parseBalance(privatePayload),
    mint: selectedMint,
    symbol: getStablecoinSymbolForMint(network, selectedMint) ?? undefined,
    decimals: 6,
  };
}

export async function preparePrivateSend(
  request: PrivateSendRequest,
): Promise<PrivateSendResponse> {
  assertSupportedMint(request.network, request.mint);
  assertProviderSafeAmount(request.amount);
  const baseBalance = await getWalletMintRawBalance({
    address: request.walletAddress,
    mint: request.mint,
    network: request.network,
  });
  if (BigInt(baseBalance) < BigInt(request.amount)) {
    throw new Error('Sender public payment balance is insufficient for this transfer.');
  }

  const validator = primaryValidator(request.network);
  const payload = await magicBlockJson(
    '/v1/spl/transfer',
    {
      method: 'POST',
      body: await stringifyJsonBody({
        from: request.walletAddress,
        to: request.recipient,
        amount: Number(request.amount),
        cluster: request.network,
        mint: request.mint,
        visibility: 'private',
        fromBalance: 'base',
        toBalance: 'base',
        validator,
      }),
    },
    request.network,
  );
  const transaction = parsePreparedTransaction(payload, 'transfer', validator);
  return {
    unsignedTransaction: transaction.transactionBase64,
    transaction,
  };
}

export async function settlePrivatePayments(
  request: PaymentSettleRequest,
): Promise<PaymentSettleResponse> {
  const batchId = `client:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const results: PaymentSettleResponse['results'] = [];

  for (const [index, signedBlob] of request.signedBlobs.entries()) {
    const txId = primarySignature(signedBlob, `${batchId}:${index}`);
    try {
      const { signature } = await broadcastRawTransaction({
        rawTransaction: signedBlob,
        network: request.network,
      });
      results.push({ txId, signature, status: 'confirmed' });
    } catch {
      results.push({ txId, signature: null, status: 'failed' });
    }
  }

  return { batchId, results };
}
