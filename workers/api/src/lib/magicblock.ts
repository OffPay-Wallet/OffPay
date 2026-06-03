import { AppError } from './errors.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  sanitizeText,
} from './provider-utils.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const MAGICBLOCK_API_BASE_URL = 'https://payments.magicblock.app';

interface MagicBlockUnsignedTransaction {
  kind: string;
  version: string | null;
  transactionBase64: string;
  sendTo: string | null;
  recentBlockhash: string | null;
  lastValidBlockHeight: number | null;
  instructionCount: number | null;
  requiredSigners: string[];
  validator: string | null;
  transferQueue: string | null;
  rentPda: string | null;
}

interface MagicBlockMintInitializationStatusRequest {
  mint: string;
  network: Network;
  validator: string;
}

interface MagicBlockMintInitializationStatusResponse {
  mint: string;
  validator: string;
  transferQueue: string | null;
  initialized: boolean;
}

interface MagicBlockInitializeMintRequest {
  ownerWallet: string;
  mint: string;
  network: Network;
  validator: string;
}

interface MagicBlockTransferRequest {
  ownerWallet: string;
  destinationWallet: string;
  mint: string;
  amount: string;
  network: Network;
  validator: string;
  privacy: 'private' | 'public';
  memo?: string;
}

interface MagicBlockHttpResult {
  response: Response;
  payload: unknown;
}

function extractProviderMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const nestedError = isRecord(payload.error) ? payload.error : null;

  return sanitizeText(
    readTrimmedString(payload.error) ??
      readTrimmedString(nestedError?.message) ??
      readTrimmedString(nestedError?.error) ??
      readTrimmedString(nestedError?.cause) ??
      readTrimmedString(payload.message) ??
      readTrimmedString(payload.cause) ??
      readTrimmedString(payload.status),
    160,
  );
}

function assertSupportedWallet(value: string, message: string): void {
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

function toProviderSafeInteger(value: string, fieldLabel: string): number {
  assertPositiveIntegerAmount(value, `${fieldLabel} must be a positive integer string.`);

  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${fieldLabel} exceeds the safe integer range supported by the provider API.`,
    });
  }

  return numericValue;
}

function parseMagicBlockValidators(bindings: Bindings, network: Network): string[] {
  const key =
    network === 'mainnet' ? 'MAGICBLOCK_MAINNET_VALIDATORS' : 'MAGICBLOCK_DEVNET_VALIDATORS';
  const rawValue = getRequiredBinding(bindings, key);
  const validators = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (validators.length === 0 || validators.some((value) => !isValidSolanaAddress(value))) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock validator configuration is unavailable.',
      retryable: true,
    });
  }

  return validators;
}

function resolveMagicBlockValidator(bindings: Bindings, network: Network, seed: string): string {
  const validators = parseMagicBlockValidators(bindings, network);
  let hash = 0x811c9dc5;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return validators[hash % validators.length] ?? validators[0]!;
}

function buildMagicBlockHeaders(bindings: Bindings, network: Network, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json');

  const apiKey =
    network === 'mainnet'
      ? bindings.MAGICBLOCK_MAINNET_API_KEY?.trim()
      : bindings.MAGICBLOCK_DEVNET_API_KEY?.trim();

  if (apiKey) {
    headers.set('x-api-key', apiKey);
  }

  return headers;
}

async function fetchMagicBlockJson(
  bindings: Bindings,
  network: Network,
  path: string,
  init: RequestInit,
  errorMessage: string,
): Promise<MagicBlockHttpResult> {
  let response: Response;
  try {
    response = await fetch(`${MAGICBLOCK_API_BASE_URL}${path}`, {
      ...init,
      headers: buildMagicBlockHeaders(bindings, network, init.headers),
    });
  } catch (error) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: errorMessage,
      retryable: true,
      cause: error,
    });
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { response, payload };
}

function parseUnsignedTransactionPayload(
  payload: unknown,
  fallbackKind: string,
  validator: string | null,
): MagicBlockUnsignedTransaction {
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
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock transaction preparation is currently unavailable.',
      retryable: true,
    });
  }

  const kind = readTrimmedString(payload.kind) ?? fallbackKind;
  const version = readTrimmedString(payload.version);
  const transactionBase64 =
    readTrimmedString(payload.transactionBase64) ?? readTrimmedString(payload.transaction);
  const sendTo = readTrimmedString(payload.sendTo);
  const recentBlockhash = readTrimmedString(payload.recentBlockhash);
  const lastValidBlockHeight = readFiniteNumber(payload.lastValidBlockHeight);
  const instructionCount = readFiniteNumber(payload.instructionCount);
  const providerValidator = readTrimmedString(payload.validator) ?? validator;
  const transferQueue = readTrimmedString(payload.transferQueue);
  const rentPda = readTrimmedString(payload.rentPda);
  const requiredSigners = Array.isArray(payload.requiredSigners)
    ? payload.requiredSigners.flatMap((signer) => {
        const value = readTrimmedString(signer);
        return value ? [value] : [];
      })
    : [];

  if (!transactionBase64) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock transaction preparation is currently unavailable.',
      retryable: true,
    });
  }

  return {
    kind,
    version,
    transactionBase64,
    sendTo,
    recentBlockhash,
    lastValidBlockHeight,
    instructionCount,
    requiredSigners,
    validator: providerValidator,
    transferQueue,
    rentPda,
  };
}

async function getMagicBlockMintInitializationStatus(
  bindings: Bindings,
  request: MagicBlockMintInitializationStatusRequest,
): Promise<MagicBlockMintInitializationStatusResponse> {
  assertSupportedWallet(request.mint, 'Mint address is invalid.');
  assertSupportedWallet(request.validator, 'MagicBlock validator address is invalid.');

  const params = new URLSearchParams({
    mint: request.mint,
    cluster: request.network,
    validator: request.validator,
  });

  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    `/v1/spl/is-mint-initialized?${params.toString()}`,
    {
      method: 'GET',
    },
    'MagicBlock mint status is currently unavailable.',
  );

  if (!response.ok || !isRecord(payload)) {
    throw new AppError({
      status: response.status === 400 || response.status === 422 ? 400 : 503,
      code: response.status === 400 || response.status === 422 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'MagicBlock mint status is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  const mint = readTrimmedString(payload.mint);
  const validator = readTrimmedString(payload.validator);
  const transferQueue = readTrimmedString(payload.transferQueue);
  const initialized = payload.initialized === true;

  if (!mint || !validator) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock mint status is currently unavailable.',
      retryable: true,
    });
  }

  return {
    mint,
    validator,
    transferQueue,
    initialized,
  };
}

async function createMagicBlockInitializeMintTransaction(
  bindings: Bindings,
  request: MagicBlockInitializeMintRequest,
): Promise<MagicBlockUnsignedTransaction> {
  assertSupportedWallet(request.ownerWallet, 'Owner wallet address is invalid.');
  assertSupportedWallet(request.mint, 'Mint address is invalid.');
  assertSupportedWallet(request.validator, 'MagicBlock validator address is invalid.');

  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    '/v1/spl/initialize-mint',
    {
      method: 'POST',
      body: JSON.stringify({
        payer: request.ownerWallet,
        mint: request.mint,
        cluster: request.network,
        validator: request.validator,
      }),
    },
    'MagicBlock mint initialization is currently unavailable.',
  );

  if (!response.ok) {
    throw new AppError({
      status: response.status === 400 || response.status === 422 ? 400 : 503,
      code:
        response.status === 400 || response.status === 422
          ? 'INVALID_REQUEST'
          : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'MagicBlock mint initialization is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseUnsignedTransactionPayload(payload, 'initialize_mint', request.validator);
}

async function createMagicBlockTransferTransaction(
  bindings: Bindings,
  request: MagicBlockTransferRequest,
): Promise<MagicBlockUnsignedTransaction> {
  assertSupportedWallet(request.ownerWallet, 'Owner wallet address is invalid.');
  assertSupportedWallet(request.destinationWallet, 'Destination wallet address is invalid.');
  assertSupportedWallet(request.mint, 'Mint address is invalid.');
  assertSupportedWallet(request.validator, 'MagicBlock validator address is invalid.');

  const amount = toProviderSafeInteger(request.amount, 'MagicBlock transfer amount');
  const memo = sanitizeText(request.memo, 120);

  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    '/v1/spl/transfer',
    {
      method: 'POST',
      body: JSON.stringify({
        from: request.ownerWallet,
        to: request.destinationWallet,
        amount,
        cluster: request.network,
        mint: request.mint,
        visibility: request.privacy,
        fromBalance: 'base',
        toBalance: 'base',
        validator: request.validator,
        ...(memo ? { memo } : {}),
      }),
    },
    'MagicBlock transfer preparation is currently unavailable.',
  );

  if (!response.ok) {
    throw new AppError({
      status: response.status === 400 || response.status === 422 ? 400 : 503,
      code:
        response.status === 400 || response.status === 422
          ? 'INVALID_REQUEST'
          : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'MagicBlock transfer preparation is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseUnsignedTransactionPayload(payload, 'transfer', request.validator);
}

export {
  createMagicBlockInitializeMintTransaction,
  createMagicBlockTransferTransaction,
  getMagicBlockMintInitializationStatus,
  resolveMagicBlockValidator,
  type MagicBlockInitializeMintRequest,
  type MagicBlockMintInitializationStatusRequest,
  type MagicBlockMintInitializationStatusResponse,
  type MagicBlockTransferRequest,
  type MagicBlockUnsignedTransaction,
};
