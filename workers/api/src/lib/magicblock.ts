import { AppError } from './errors.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
} from './provider-utils.js';
import { acquireRedisLock, releaseRedisLock } from './redis-lock.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const MAGICBLOCK_API_BASE_URL = 'https://payments.magicblock.app';
const MAGICBLOCK_AUTH_CHALLENGE_KEY_PREFIX = 'magicblock-auth-challenge:v1';
const MAGICBLOCK_AUTH_TOKEN_KEY_PREFIX = 'magicblock-auth-token:v1';
const MAGICBLOCK_AUTH_LOGIN_LOCK_KEY_PREFIX = 'magicblock-auth-login-lock:v1';
const MAGICBLOCK_AUTH_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MAGICBLOCK_AUTH_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAGICBLOCK_AUTH_LOGIN_LOCK_TTL_SECONDS = 30;

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
  fees: MagicBlockTransactionFees | null;
}

interface MagicBlockTransactionFees {
  lamports: string;
  tokens: string;
}

type MagicBlockBalanceLocation = 'base' | 'ephemeral';

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

interface MagicBlockQueueInitializationRequest {
  payerWallet: string;
  mint: string;
  network: Network;
  validator: string;
}

interface MagicBlockPrivatePaymentRequest {
  senderWallet: string;
  recipientWallet: string;
  mint: string;
  amount: string;
  network: Network;
  validator: string;
  memo?: string;
}

interface MagicBlockBalanceRequest {
  address: string;
  mint: string;
  network: Network;
}

interface MagicBlockBalanceResponse {
  address: string;
  mint: string;
  ata: string | null;
  location: MagicBlockBalanceLocation;
  balance: string;
}

interface MagicBlockHttpResult {
  response: Response;
  payload: unknown;
}

interface MagicBlockAuthChallengeRequest {
  walletAddress: string;
  network: Network;
}

interface MagicBlockAuthChallengeResponse {
  challenge: string;
  expiresAt: number;
}

interface MagicBlockAuthLoginRequest extends MagicBlockAuthChallengeRequest {
  challenge: string;
  signature: string;
}

interface MagicBlockAuthLoginResponse {
  authenticated: true;
  expiresAt: number;
}

interface StoredMagicBlockAuthChallenge extends MagicBlockAuthChallengeResponse {
  walletAddress: string;
  network: Network;
}

interface StoredMagicBlockAuthToken {
  walletAddress: string;
  network: Network;
  token: string;
  expiresAt: number;
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

function readNonnegativeIntegerString(value: unknown): string | null {
  const text = readTrimmedString(value);
  if (text != null && /^\d+$/.test(text)) return text;
  const numeric = readFiniteNumber(value);
  return numeric != null && Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric) : null;
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

function resolveMagicBlockPrimaryValidator(bindings: Bindings, network: Network): string {
  return parseMagicBlockValidators(bindings, network)[0]!;
}

function buildMagicBlockHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json');

  return headers;
}

function buildMagicBlockAuthChallengeKey(network: Network, walletAddress: string): string {
  return `${MAGICBLOCK_AUTH_CHALLENGE_KEY_PREFIX}:${network}:${walletAddress}`;
}

function buildMagicBlockAuthTokenKey(network: Network, walletAddress: string): string {
  return `${MAGICBLOCK_AUTH_TOKEN_KEY_PREFIX}:${network}:${walletAddress}`;
}

function buildMagicBlockAuthLoginLockKey(network: Network, walletAddress: string): string {
  return `${MAGICBLOCK_AUTH_LOGIN_LOCK_KEY_PREFIX}:${network}:${walletAddress}`;
}

async function storeMagicBlockAuthValue(
  bindings: Bindings,
  key: string,
  value: StoredMagicBlockAuthChallenge | StoredMagicBlockAuthToken,
  unavailableMessage: string,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((value.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [['SET', key, JSON.stringify(value), 'EX', ttlSeconds]],
    unavailableMessage,
  );
}

async function readMagicBlockAuthValue(
  bindings: Bindings,
  key: string,
  unavailableMessage: string,
): Promise<Record<string, unknown> | null> {
  const [result] = await runKvPipeline(bindings, [['GET', key]], unavailableMessage);
  if (typeof result !== 'string' || result.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(result) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteMagicBlockAuthValue(
  bindings: Bindings,
  key: string,
  unavailableMessage: string,
): Promise<void> {
  await runKvPipeline(bindings, [['DEL', key]], unavailableMessage);
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
      headers: buildMagicBlockHeaders(init.headers),
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
      fees: null,
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
  const feePayload = isRecord(payload.fees) ? payload.fees : null;
  const feeLamports = readNonnegativeIntegerString(feePayload?.lamports);
  const feeTokens = readNonnegativeIntegerString(feePayload?.tokens);
  const fees = feeLamports != null && feeTokens != null ? { lamports: feeLamports, tokens: feeTokens } : null;
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
    fees,
  };
}

function parseBalancePayload(
  payload: unknown,
  expectedLocation: MagicBlockBalanceLocation,
  fallbackAddress: string,
  fallbackMint: string,
): MagicBlockBalanceResponse {
  if (!isRecord(payload)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock balance lookup is currently unavailable.',
      retryable: true,
    });
  }

  const address = readTrimmedString(payload.address) ?? readTrimmedString(payload.owner);
  const mint = readTrimmedString(payload.mint);
  const ata = readTrimmedString(payload.ata);
  const location =
    readTrimmedString(payload.location) === 'ephemeral'
      ? 'ephemeral'
      : readTrimmedString(payload.location) === 'base'
        ? 'base'
        : null;
  const balance =
    readTrimmedString(payload.balance) ??
    readTrimmedString(payload.amount) ??
    (readFiniteNumber(payload.balance) !== null ? String(readFiniteNumber(payload.balance)) : null);

  if (
    address !== fallbackAddress ||
    mint !== fallbackMint ||
    location !== expectedLocation ||
    !balance ||
    !/^\d+$/.test(balance) ||
    (ata != null && !isValidSolanaAddress(ata))
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'MagicBlock balance lookup is currently unavailable.',
      retryable: true,
    });
  }

  return {
    address,
    mint,
    ata,
    location,
    balance,
  };
}

async function requestMagicBlockAuthChallenge(
  bindings: Bindings,
  request: MagicBlockAuthChallengeRequest,
): Promise<MagicBlockAuthChallengeResponse> {
  assertSupportedWallet(request.walletAddress, 'Wallet address is invalid.');
  const params = new URLSearchParams({
    pubkey: request.walletAddress,
    cluster: request.network,
  });
  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    `/v1/spl/challenge?${params.toString()}`,
    { method: 'GET' },
    'MagicBlock authentication is currently unavailable.',
  );
  const challenge = isRecord(payload) ? readTrimmedString(payload.challenge) : null;
  if (!response.ok || !challenge || challenge.length > 4_096) {
    throw new AppError({
      status: response.status === 400 || response.status === 422 ? 400 : 503,
      code:
        response.status === 400 || response.status === 422
          ? 'INVALID_REQUEST'
          : 'UPSTREAM_UNAVAILABLE',
      message: extractProviderMessage(payload) ?? 'MagicBlock authentication is unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  const stored: StoredMagicBlockAuthChallenge = {
    walletAddress: request.walletAddress,
    network: request.network,
    challenge,
    expiresAt: Date.now() + MAGICBLOCK_AUTH_CHALLENGE_TTL_MS,
  };
  await storeMagicBlockAuthValue(
    bindings,
    buildMagicBlockAuthChallengeKey(request.network, request.walletAddress),
    stored,
    'MagicBlock authentication state is unavailable.',
  );
  return { challenge: stored.challenge, expiresAt: stored.expiresAt };
}

async function loginMagicBlockAuth(
  bindings: Bindings,
  request: MagicBlockAuthLoginRequest,
): Promise<MagicBlockAuthLoginResponse> {
  assertSupportedWallet(request.walletAddress, 'Wallet address is invalid.');
  const lockKey = buildMagicBlockAuthLoginLockKey(request.network, request.walletAddress);
  const lockToken = await acquireRedisLock({
    bindings,
    key: lockKey,
    ttlSeconds: MAGICBLOCK_AUTH_LOGIN_LOCK_TTL_SECONDS,
    unavailableMessage: 'MagicBlock authentication state is unavailable.',
  });
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'MagicBlock authentication is already in progress.',
      retryable: true,
      retryAfterMs: 500,
    });
  }

  try {
    const challengeKey = buildMagicBlockAuthChallengeKey(request.network, request.walletAddress);
    const stored = await readMagicBlockAuthValue(
      bindings,
      challengeKey,
      'MagicBlock authentication state is unavailable.',
    );
    if (
      readTrimmedString(stored?.walletAddress) !== request.walletAddress ||
      readTrimmedString(stored?.network) !== request.network ||
      readTrimmedString(stored?.challenge) !== request.challenge ||
      (readFiniteNumber(stored?.expiresAt) ?? 0) <= Date.now()
    ) {
      throw new AppError({
        status: 401,
        code: 'MAGICBLOCK_AUTH_REQUIRED',
        message: 'MagicBlock authentication challenge expired. Request a fresh challenge.',
        retryable: true,
      });
    }

    const { response, payload } = await fetchMagicBlockJson(
      bindings,
      request.network,
      '/v1/spl/login',
      {
        method: 'POST',
        body: JSON.stringify({
          pubkey: request.walletAddress,
          challenge: request.challenge,
          signature: request.signature,
          cluster: request.network,
          mock: false,
        }),
      },
      'MagicBlock authentication is currently unavailable.',
    );
    const token = isRecord(payload) ? readTrimmedString(payload.token) : null;
    if (!response.ok || !token || token.length > 16_384) {
      throw new AppError({
        status:
          response.status === 400 || response.status === 401 || response.status === 422 ? 401 : 503,
        code:
          response.status === 400 || response.status === 401 || response.status === 422
            ? 'SIGNATURE_INVALID'
            : 'UPSTREAM_UNAVAILABLE',
        message: extractProviderMessage(payload) ?? 'MagicBlock authentication failed.',
        retryable: response.status >= 500,
      });
    }

    const authToken: StoredMagicBlockAuthToken = {
      walletAddress: request.walletAddress,
      network: request.network,
      token,
      expiresAt: Date.now() + MAGICBLOCK_AUTH_TOKEN_TTL_MS,
    };
    await storeMagicBlockAuthValue(
      bindings,
      buildMagicBlockAuthTokenKey(request.network, request.walletAddress),
      authToken,
      'MagicBlock authentication state is unavailable.',
    );
    await deleteMagicBlockAuthValue(
      bindings,
      challengeKey,
      'MagicBlock authentication state is unavailable.',
    );
    return { authenticated: true, expiresAt: authToken.expiresAt };
  } finally {
    await releaseRedisLock({
      bindings,
      key: lockKey,
      token: lockToken,
      unavailableMessage: 'MagicBlock authentication state is unavailable.',
    });
  }
}

async function requireMagicBlockAuthToken(
  bindings: Bindings,
  request: MagicBlockAuthChallengeRequest,
): Promise<string> {
  const key = buildMagicBlockAuthTokenKey(request.network, request.walletAddress);
  const stored = await readMagicBlockAuthValue(
    bindings,
    key,
    'MagicBlock authentication state is unavailable.',
  );
  const expiresAt = readFiniteNumber(stored?.expiresAt) ?? 0;
  const token = readTrimmedString(stored?.token);
  if (
    readTrimmedString(stored?.walletAddress) !== request.walletAddress ||
    readTrimmedString(stored?.network) !== request.network ||
    !token ||
    expiresAt <= Date.now()
  ) {
    if (stored != null) {
      await deleteMagicBlockAuthValue(
        bindings,
        key,
        'MagicBlock authentication state is unavailable.',
      );
    }
    throw new AppError({
      status: 401,
      code: 'MAGICBLOCK_AUTH_REQUIRED',
      message: 'Authenticate the wallet with MagicBlock before reading private balances.',
      retryable: true,
    });
  }
  return token;
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
      code:
        response.status === 400 || response.status === 422
          ? 'INVALID_REQUEST'
          : 'UPSTREAM_UNAVAILABLE',
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
        extractProviderMessage(payload) ??
        'MagicBlock mint initialization is currently unavailable.',
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
        extractProviderMessage(payload) ??
        'MagicBlock transfer preparation is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseUnsignedTransactionPayload(payload, 'transfer', request.validator);
}

async function createMagicBlockQueueInitializationTransaction(
  bindings: Bindings,
  request: MagicBlockQueueInitializationRequest,
): Promise<MagicBlockUnsignedTransaction> {
  assertSupportedWallet(request.payerWallet, 'Owner wallet address is invalid.');
  assertSupportedWallet(request.mint, 'Mint address is invalid.');
  assertSupportedWallet(request.validator, 'MagicBlock validator address is invalid.');

  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    '/v1/spl/initialize-mint',
    {
      method: 'POST',
      body: JSON.stringify({
        payer: request.payerWallet,
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
        extractProviderMessage(payload) ??
        'MagicBlock mint initialization is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseUnsignedTransactionPayload(payload, 'initializeMint', request.validator);
}

async function createMagicBlockPrivatePaymentTransaction(
  bindings: Bindings,
  request: MagicBlockPrivatePaymentRequest,
): Promise<MagicBlockUnsignedTransaction> {
  assertSupportedWallet(request.senderWallet, 'Owner wallet address is invalid.');
  assertSupportedWallet(request.recipientWallet, 'Recipient wallet address is invalid.');
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
        from: request.senderWallet,
        to: request.recipientWallet,
        amount,
        cluster: request.network,
        mint: request.mint,
        visibility: 'private',
        fromBalance: 'base',
        toBalance: 'base',
        validator: request.validator,
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: false,
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
        extractProviderMessage(payload) ??
        'MagicBlock transfer preparation is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseUnsignedTransactionPayload(payload, 'transfer', request.validator);
}

async function getMagicBlockBalance(
  bindings: Bindings,
  request: MagicBlockBalanceRequest,
): Promise<MagicBlockBalanceResponse> {
  assertSupportedWallet(request.address, 'Wallet address is invalid.');
  assertSupportedWallet(request.mint, 'Mint address is invalid.');

  const params = new URLSearchParams({
    address: request.address,
    cluster: request.network,
    mint: request.mint,
  });

  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    `/v1/spl/balance?${params.toString()}`,
    {
      method: 'GET',
    },
    'MagicBlock balance lookup is currently unavailable.',
  );

  if (!response.ok) {
    throw new AppError({
      status: response.status === 400 || response.status === 422 ? 400 : 503,
      code:
        response.status === 400 || response.status === 422
          ? 'INVALID_REQUEST'
          : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'MagicBlock balance lookup is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseBalancePayload(payload, 'base', request.address, request.mint);
}

async function getMagicBlockPrivateBalance(
  bindings: Bindings,
  request: MagicBlockBalanceRequest,
): Promise<MagicBlockBalanceResponse> {
  assertSupportedWallet(request.address, 'Wallet address is invalid.');
  assertSupportedWallet(request.mint, 'Mint address is invalid.');

  const params = new URLSearchParams({
    address: request.address,
    cluster: request.network,
    mint: request.mint,
  });

  const token = await requireMagicBlockAuthToken(bindings, {
    walletAddress: request.address,
    network: request.network,
  });
  const { response, payload } = await fetchMagicBlockJson(
    bindings,
    request.network,
    `/v1/spl/private-balance?${params.toString()}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
    'MagicBlock balance lookup is currently unavailable.',
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await deleteMagicBlockAuthValue(
        bindings,
        buildMagicBlockAuthTokenKey(request.network, request.address),
        'MagicBlock authentication state is unavailable.',
      );
      throw new AppError({
        status: 401,
        code: 'MAGICBLOCK_AUTH_REQUIRED',
        message: 'MagicBlock authentication expired. Authenticate the wallet again.',
        retryable: true,
      });
    }
    throw new AppError({
      status: response.status === 400 || response.status === 422 ? 400 : 503,
      code:
        response.status === 400 || response.status === 422
          ? 'INVALID_REQUEST'
          : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'MagicBlock balance lookup is currently unavailable.',
      retryable: response.status !== 400 && response.status !== 422,
    });
  }

  return parseBalancePayload(payload, 'ephemeral', request.address, request.mint);
}

export {
  MAGICBLOCK_API_BASE_URL,
  createMagicBlockPrivatePaymentTransaction,
  createMagicBlockInitializeMintTransaction,
  createMagicBlockQueueInitializationTransaction,
  createMagicBlockTransferTransaction,
  getMagicBlockBalance,
  getMagicBlockMintInitializationStatus,
  getMagicBlockPrivateBalance,
  loginMagicBlockAuth,
  requestMagicBlockAuthChallenge,
  resolveMagicBlockPrimaryValidator,
  resolveMagicBlockValidator,
  type MagicBlockBalanceLocation,
  type MagicBlockBalanceRequest,
  type MagicBlockBalanceResponse,
  type MagicBlockAuthChallengeRequest,
  type MagicBlockAuthChallengeResponse,
  type MagicBlockAuthLoginRequest,
  type MagicBlockAuthLoginResponse,
  type MagicBlockInitializeMintRequest,
  type MagicBlockMintInitializationStatusRequest,
  type MagicBlockMintInitializationStatusResponse,
  type MagicBlockPrivatePaymentRequest,
  type MagicBlockQueueInitializationRequest,
  type MagicBlockTransferRequest,
  type MagicBlockUnsignedTransaction,
  type MagicBlockTransactionFees,
};
