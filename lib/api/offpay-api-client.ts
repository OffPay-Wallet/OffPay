import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  buildOffpayAuthHeadersAsync,
  buildOffpayAuthHeadersWithSignature,
  signBootstrapNonce,
  zeroOutBytes,
} from '@/lib/crypto/offpay-api-auth';
import { signMessageForWallet } from '@/lib/crypto/solana-transaction-signing';
import { getCachedOrSign, invalidateSignCacheForWallet } from '@/lib/crypto/sign-cache';
import Constants from 'expo-constants';
import {
  clearOffpayBootstrapCredentials,
  getOffpayBootstrapVersion,
  getOffpayRequestSecret,
  getOrCreateOffpayDeviceId,
  storeOffpayBootstrapCredentials,
} from '@/lib/api/offpay-api-storage';
import {
  getStoredWalletSigningMaterialWithAuth,
  getStoredWalletInfo,
} from '@/lib/wallet/secure-wallet-store';
import {
  decodeSigningSeedFromPrivateKey,
  deriveSigningSeedFromMnemonic,
} from '@/lib/wallet/wallet';
import { getOrDeriveSigningSeed } from '@/lib/wallet/signing-seed-cache';
import {
  getWalletSigningBlocker,
  walletHasLocalSigningMaterial,
} from '@/lib/wallet/wallet-capabilities';
import {
  readJsonResponseAdaptive,
  stringifyJsonAdaptive,
} from '@/lib/perf/ui-work-scheduler';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type {
  BackendErrorCode,
  BackendErrorEnvelope,
  BootstrapNonceResponse,
  BootstrapProvisionAttestedBody,
  BootstrapProvisionBody,
  BootstrapProvisionInput,
  BootstrapProvisionPrototypeBypassBody,
  BootstrapProvisionResponse,
  CapabilitiesResponse,
  FxRateResponse,
  InviteVerifyResponse,
  OffpayApiMethod,
  OffpayNetwork,
  PaymentSettleRequest,
  PaymentSettleResponse,
  PendingBackupListResponse,
  PendingBackupUploadBody,
  OfflineNoncePoolAdvanceRequest,
  OfflineNoncePoolAdvanceResponse,
  OfflineNoncePoolPrepareRequest,
  OfflineNoncePoolPrepareResponse,
  OfflineNoncePoolStatusResponse,
  OfflineRentEstimateResponse,
  OfflineTokenContextResponse,
  PrivateBalanceResponse,
  PrivateInitMintRequest,
  PrivateInitMintResponse,
  PrivateSendRequest,
  PrivateSendResponse,
  DevnetAirdropRequest,
  DevnetAirdropResponse,
  QueryParams,
  RpcAccountsRequest,
  RpcAccountsResponse,
  RpcBroadcastRequest,
  RpcBroadcastResponse,
  RpcEpochInfoResponse,
  RpcLatestBlockhashResponse,
  RpcSignatureStatusesRequest,
  RpcSignatureStatusesResponse,
  RpcSignaturesForAddressRequest,
  RpcSignaturesForAddressResponse,
  RpcSlotResponse,
  RpcTokenLargestAccountsRequest,
  RpcTokenLargestAccountsResponse,
  StreamCapabilitiesResponse,
  SwapExecuteRequest,
  SwapExecuteResponse,
  PrivacySwapFinalizeRequest,
  PrivacySwapFinalizeResponse,
  PrivacySwapPrepareRequest,
  PrivacySwapPrepareResponse,
  PrivacySwapRefreshQuoteRequest,
  PrivacySwapRefreshQuoteResponse,
  SwapPriceResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRecurringCreateRequest,
  SwapRecurringCreateResponse,
  SwapRecurringExecuteRequest,
  SwapRecurringExecuteResponse,
  SwapTriggerChallengeRequest,
  SwapTriggerChallengeResponse,
  SwapTriggerCreateRequest,
  SwapTriggerCreateResponse,
  SwapTriggerPrepareRequest,
  SwapTriggerPrepareResponse,
  SwapTriggerVerifyRequest,
  SwapTriggerVerifyResponse,
  SwapTokensResponse,
  UmbraClaimRequest,
  UmbraClaimResponse,
  UmbraClaimStatusResponse,
  UmbraRelayerInfoResponse,
  UmbraTreeSummariesResponse,
  UmbraTreeProofsRequest,
  UmbraTreeProofsResponse,
  UmbraUtxosRequest,
  UmbraUtxosResponse,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isLocalDevelopmentOrigin(url: URL): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  );
}

function normalizeApiOrigin(rawValue: string, envKey: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${envKey} must be a valid absolute URL.`);
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error(`${envKey} must be an origin only, for example https://api.offpay.app.`);
  }

  if (parsed.protocol !== 'https:' && !isLocalDevelopmentOrigin(parsed)) {
    throw new Error(`${envKey} must use HTTPS outside local development.`);
  }

  return parsed.origin;
}

function resolveOffpayApiOrigin(): string {
  const rawOrigin = process.env.EXPO_PUBLIC_OFFPAY_API_ORIGIN?.trim();
  if (!rawOrigin) {
    throw new Error('EXPO_PUBLIC_OFFPAY_API_ORIGIN must be configured.');
  }

  const origin = normalizeApiOrigin(rawOrigin, 'EXPO_PUBLIC_OFFPAY_API_ORIGIN');
  const allowedOrigins = splitCsv(process.env.EXPO_PUBLIC_OFFPAY_API_ALLOWED_ORIGINS).map((entry) =>
    normalizeApiOrigin(entry, 'EXPO_PUBLIC_OFFPAY_API_ALLOWED_ORIGINS'),
  );
  const effectiveAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : [origin];

  if (!effectiveAllowedOrigins.includes(origin)) {
    throw new Error(
      'EXPO_PUBLIC_OFFPAY_API_ORIGIN is not in EXPO_PUBLIC_OFFPAY_API_ALLOWED_ORIGINS.',
    );
  }

  return origin;
}

export const OFFPAY_API_ORIGIN = resolveOffpayApiOrigin();
export const OFFPAY_APP_VERSION =
  Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '0.0.0';

interface OffpayRequestOptions {
  path: `/${string}`;
  method?: OffpayApiMethod;
  query?: QueryParams;
  body?: unknown;
  network: OffpayNetwork;
  signal?: AbortSignal;
  accept?: string;
  headers?: Record<string, string>;
  walletId?: string;
  retryAuthRecovery?: boolean;
  retrySignature?: boolean;
  reprovisionAuth?: () => Promise<void>;
}

interface PublicRequestOptions {
  path: `/${string}`;
  method?: OffpayApiMethod;
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Optional caller signal. Will be merged with the per-request
   * timeout signal so an outer cancellation aborts the underlying
   * `fetch` instead of leaving the socket open.
   */
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface StoredAuthContext {
  walletInfo: SigningWalletInfo;
  walletAddress: string;
  signingSeed: Uint8Array | null;
  requestSecret: string;
  deviceId: string;
  bootstrapVersion: number;
}

interface SigningSession {
  walletId: string;
  walletAddress: string;
  signingSeed: Uint8Array;
}

interface SigningWalletInfo {
  id: string;
  publicKey: string;
  importMethod: WalletImportMethod;
}

let signingSession: SigningSession | null = null;
let signingSessionPromise: Promise<SigningSession> | null = null;
let signingSessionEpoch = 0;
let offpayAuthRecoveryHandler: (() => Promise<void>) | null = null;
let offpayNetworkAccessAllowed = true;

export class OffpayApiError extends Error {
  readonly code: BackendErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs: number;

  constructor(params: {
    code: BackendErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    retryAfterMs: number;
  }) {
    super(params.message);
    this.name = 'OffpayApiError';
    this.code = params.code;
    this.status = params.status;
    this.retryable = params.retryable;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export function setOffpayNetworkAccessAllowed(allowed: boolean): void {
  offpayNetworkAccessAllowed = allowed;
}

function assertOffpayNetworkAccessAllowed(): void {
  if (offpayNetworkAccessAllowed) return;

  throw new OffpayApiError({
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Offline mode is active. Network requests are disabled until online mode is enabled.',
    status: 0,
    retryable: false,
    retryAfterMs: 0,
  });
}

function appendQuery(path: `/${string}`, query?: QueryParams): string {
  if (query == null) return path;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `${path}?${queryString}` : path;
}

function buildUrl(pathAndQuery: string): string {
  return `${OFFPAY_API_ORIGIN}${pathAndQuery}`;
}

function buildIdempotencyKey(prefix: string, values: readonly string[]): string {
  let hash = 2166136261;
  const input = values.join('|');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function isBackendErrorEnvelope(value: unknown): value is BackendErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }

  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as Partial<BackendErrorEnvelope['error']>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.retryAfterMs === 'number'
  );
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await readJsonResponseAdaptive(response);
  } catch {
    throw new OffpayApiError({
      code: 'INTERNAL_ERROR',
      message: 'The server returned an unreadable response.',
      status: response.status,
      retryable: false,
      retryAfterMs: 0,
    });
  }
}

function throwForErrorEnvelope(status: number, payload: unknown): never {
  if (isBackendErrorEnvelope(payload)) {
    throw new OffpayApiError({
      code: payload.error.code,
      message: payload.error.message,
      status,
      retryable: payload.error.retryable,
      retryAfterMs: payload.error.retryAfterMs,
    });
  }

  throw new OffpayApiError({
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong.',
    status,
    retryable: false,
    retryAfterMs: 0,
  });
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

interface ScopedAbortHandle {
  signal: AbortSignal;
  cleanup: () => void;
}

/**
 * Returns an `AbortSignal` that aborts when either the upstream signal
 * is aborted or the timeout elapses. The returned `cleanup` must be
 * called from a `finally` block so the timer and listener don't leak.
 *
 * Native `fetch` only releases its underlying socket when the signal
 * actually aborts, so wrapping every request in a timeout is what
 * prevents hung HTTP connections from blocking the JS thread waiting
 * for a JSON parse.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): ScopedAbortHandle {
  const controller = new AbortController();

  if (signal != null) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const onUpstreamAbort = (): void => controller.abort(signal.reason);
      signal.addEventListener('abort', onUpstreamAbort, { once: true });

      const timer = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      return {
        signal: controller.signal,
        cleanup: () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onUpstreamAbort);
        },
      };
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export async function offpayPublicRequest<T>(options: PublicRequestOptions): Promise<T> {
  assertOffpayNetworkAccessAllowed();

  const method = options.method ?? 'GET';
  const pathAndQuery = appendQuery(options.path, options.query);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  const init: RequestInit = { method, headers };
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
    init.body = await stringifyJsonAdaptive(options.body);
  }

  const handle = withTimeout(options.signal, options.timeoutMs);
  init.signal = handle.signal;

  try {
    const response = await fetch(buildUrl(pathAndQuery), init);
    const payload = await parseJsonResponse(response);
    if (!response.ok) throwForErrorEnvelope(response.status, payload);

    return payload as T;
  } finally {
    handle.cleanup();
  }
}

export async function fetchUsdToCurrencyRateFromNetwork(currency: string): Promise<number> {
  const response = await offpayPublicRequest<FxRateResponse>({
    path: '/api/market/fx-rate',
    query: { currency },
    timeoutMs: 4000,
  });
  return response.rate;
}

export function setOffpayAuthRecoveryHandler(handler: (() => Promise<void>) | null): void {
  offpayAuthRecoveryHandler = handler;
}

export function clearOffpaySigningSession(): void {
  signingSessionEpoch += 1;
  signingSessionPromise = null;

  if (signingSession != null) {
    zeroOutBytes(signingSession.signingSeed);
    signingSession = null;
  }
}

async function recoverOffpayAuth(
  reprovisionAuth: (() => Promise<void>) | null | undefined,
): Promise<boolean> {
  if (reprovisionAuth == null) return false;

  await clearOffpayBootstrapCredentials();
  clearOffpaySigningSession();
  await reprovisionAuth();
  return true;
}

async function deriveSigningSeedWithAuth(params: {
  walletId: string;
  walletAddress: string;
  importMethod: WalletImportMethod;
}): Promise<Uint8Array> {
  const signingSeed = await getOrDeriveSigningSeed({
    walletAddress: params.walletAddress,
    derive: async () => {
      const localSigningBlocker = getWalletSigningBlocker(
        params.importMethod,
        'Authenticated OffPay requests',
        params.walletAddress,
      );
      if (localSigningBlocker != null) {
        throw new Error(localSigningBlocker);
      }

      const signingMaterial = await getStoredWalletSigningMaterialWithAuth(params.walletId);
      const mnemonic = signingMaterial?.mnemonic ?? null;
      const privateKey = signingMaterial?.privateKey ?? null;

      let derived: Uint8Array | null = null;
      if (mnemonic != null && mnemonic.length > 0) {
        derived = await deriveSigningSeedFromMnemonic(mnemonic);
      } else if (privateKey != null && privateKey.length > 0) {
        derived = decodeSigningSeedFromPrivateKey(privateKey);
      }

      if (derived == null) {
        throw new Error('No signing key is available for the active wallet.');
      }

      // Verify before returning to the cache so a corrupt/mismatched
      // private key never poisons the cache for the rest of the
      // unlocked session. Cache hits skip this check; the post-derive
      // guard plus clear-on-mutation keeps the address-to-seed
      // mapping correct.
      const derivedPublicKey = ed25519.getPublicKey(derived);
      try {
        if (bs58.encode(derivedPublicKey) !== params.walletAddress) {
          zeroOutBytes(derived);
          throw new Error('Stored signing material does not match the active wallet.');
        }
      } finally {
        zeroOutBytes(derivedPublicKey);
      }

      return derived;
    },
  });

  return signingSeed;
}

function isSigningSessionForWallet(
  session: SigningSession | null,
  walletInfo: Pick<SigningWalletInfo, 'id' | 'publicKey'>,
): session is SigningSession {
  return (
    session != null &&
    session.walletId === walletInfo.id &&
    session.walletAddress === walletInfo.publicKey
  );
}

function createSigningSession(walletInfo: SigningWalletInfo): Promise<SigningSession> {
  const sessionEpoch = signingSessionEpoch;

  const promise = (async () => {
    const signingSeed = await deriveSigningSeedWithAuth({
      walletId: walletInfo.id,
      walletAddress: walletInfo.publicKey,
      importMethod: walletInfo.importMethod,
    });

    if (sessionEpoch !== signingSessionEpoch) {
      zeroOutBytes(signingSeed);
      throw new Error('OffPay signing session was cleared before it was established.');
    }

    const nextSession: SigningSession = {
      walletId: walletInfo.id,
      walletAddress: walletInfo.publicKey,
      signingSeed,
    };

    if (signingSession != null) {
      zeroOutBytes(signingSession.signingSeed);
    }
    signingSession = nextSession;

    return nextSession;
  })();

  signingSessionPromise = promise;
  return promise;
}

async function getSigningSeed(walletInfo: SigningWalletInfo): Promise<Uint8Array> {
  if (isSigningSessionForWallet(signingSession, walletInfo)) {
    return Uint8Array.from(signingSession.signingSeed);
  }

  let pendingSession = signingSessionPromise;
  if (pendingSession == null) {
    clearOffpaySigningSession();
    pendingSession = createSigningSession(walletInfo);
  }

  try {
    const session = await pendingSession;
    if (isSigningSessionForWallet(session, walletInfo)) {
      return Uint8Array.from(session.signingSeed);
    }
  } finally {
    if (signingSessionPromise === pendingSession) {
      signingSessionPromise = null;
    }
  }

  return getSigningSeed(walletInfo);
}

async function getStoredAuthContext(walletId?: string): Promise<StoredAuthContext> {
  const [walletInfo, requestSecret, deviceId, bootstrapVersion] = await Promise.all([
    getStoredWalletInfo(walletId),
    getOffpayRequestSecret(),
    getOrCreateOffpayDeviceId(),
    getOffpayBootstrapVersion(),
  ]);

  if (walletInfo == null) {
    throw new Error('No active wallet is available for OffPay API authentication.');
  }

  if (requestSecret == null || bootstrapVersion == null) {
    throw new Error('OffPay API bootstrap is required before this request.');
  }

  const signingSeed = walletHasLocalSigningMaterial(walletInfo.importMethod)
    ? await getSigningSeed(walletInfo)
    : null;

  return {
    walletInfo,
    walletAddress: walletInfo.publicKey,
    signingSeed,
    requestSecret,
    deviceId,
    bootstrapVersion,
  };
}

function isMissingBootstrapCredentialsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'OffPay API bootstrap is required before this request.'
  );
}

export async function offpayApiRequest<T>(options: OffpayRequestOptions): Promise<T> {
  assertOffpayNetworkAccessAllowed();

  const method = options.method ?? 'GET';
  const pathAndQuery = appendQuery(options.path, options.query);
  let authContext: StoredAuthContext;

  try {
    authContext = await getStoredAuthContext(options.walletId);
  } catch (error) {
    if (isMissingBootstrapCredentialsError(error) && options.retryAuthRecovery !== false) {
      const reprovisionAuth = options.reprovisionAuth ?? offpayAuthRecoveryHandler;
      if (await recoverOffpayAuth(reprovisionAuth)) {
        return offpayApiRequest<T>({
          ...options,
          retryAuthRecovery: false,
        });
      }
    }

    throw error;
  }

  try {
    const authHeaders =
      authContext.signingSeed != null
        ? await buildOffpayAuthHeadersAsync({
            walletAddress: authContext.walletAddress,
            requestSecret: authContext.requestSecret,
            deviceId: authContext.deviceId,
            bootstrapVersion: authContext.bootstrapVersion,
            appVersion: OFFPAY_APP_VERSION,
            network: options.network,
            method,
            pathAndQuery,
            body: options.body,
            signingSeed: authContext.signingSeed,
          })
        : await buildOffpayAuthHeadersWithSignature({
            walletAddress: authContext.walletAddress,
            requestSecret: authContext.requestSecret,
            deviceId: authContext.deviceId,
            bootstrapVersion: authContext.bootstrapVersion,
            appVersion: OFFPAY_APP_VERSION,
            network: options.network,
            method,
            pathAndQuery,
            body: options.body,
            signCanonicalMessage: (message) =>
              getCachedOrSign(authContext.walletAddress, message, (cachedMessage) =>
                signMessageForWallet({
                  message: cachedMessage,
                  walletAddress: authContext.walletAddress,
                  walletId: authContext.walletInfo.id,
                }),
              ),
          });

    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/json',
      ...authHeaders,
      ...options.headers,
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = await stringifyJsonAdaptive(options.body);
    }

    const handle = withTimeout(options.signal);
    init.signal = handle.signal;

    try {
      const response = await fetch(buildUrl(pathAndQuery), init);
      const payload = await parseJsonResponse(response);
      if (!response.ok) throwForErrorEnvelope(response.status, payload);

      return payload as T;
    } finally {
      handle.cleanup();
    }
  } catch (error) {
    if (
      error instanceof OffpayApiError &&
      error.code === 'SIGNATURE_INVALID' &&
      options.retrySignature !== false
    ) {
      return offpayApiRequest<T>({
        ...options,
        retrySignature: false,
      });
    }

    if (
      error instanceof OffpayApiError &&
      (error.code === 'SECRET_ROTATED' || error.code === 'HMAC_INVALID') &&
      options.retryAuthRecovery !== false
    ) {
      const reprovisionAuth = options.reprovisionAuth ?? offpayAuthRecoveryHandler;
      // Drop cached signatures for this wallet — bootstrap is about to be
      // re-derived, and replaying the old signatures during recovery would
      // produce confusing server logs even though the signatures themselves
      // remain mathematically valid for the old (wallet, message) pair.
      invalidateSignCacheForWallet(authContext.walletAddress);
      if (await recoverOffpayAuth(reprovisionAuth)) {
        return offpayApiRequest<T>({
          ...options,
          retryAuthRecovery: false,
        });
      }
    }

    throw error;
  } finally {
    if (authContext.signingSeed != null) {
      zeroOutBytes(authContext.signingSeed);
    }
  }
}

export async function requestBootstrapNonce(
  walletAddress: string,
): Promise<BootstrapNonceResponse> {
  const deviceId = await getOrCreateOffpayDeviceId();

  return offpayPublicRequest<BootstrapNonceResponse>({
    path: '/api/bootstrap/provision',
    query: { wallet: walletAddress },
    headers: {
      'X-App-Version': OFFPAY_APP_VERSION,
      'X-Device-Id': deviceId,
    },
  });
}

export async function provisionBootstrap(
  body: BootstrapProvisionInput,
  walletId?: string,
): Promise<BootstrapProvisionResponse> {
  const walletInfo = await getStoredWalletInfo(walletId);
  if (walletInfo == null) {
    throw new Error('No active wallet is available for OffPay API bootstrap.');
  }

  if (walletInfo.publicKey !== body.walletAddress) {
    throw new Error('The active wallet does not match the bootstrap wallet address.');
  }

  const [signingSeed, deviceId] = await Promise.all([
    walletHasLocalSigningMaterial(walletInfo.importMethod) ? getSigningSeed(walletInfo) : null,
    getOrCreateOffpayDeviceId(),
  ]);

  try {
    const walletSignature =
      signingSeed != null
        ? signBootstrapNonce(body.nonce, signingSeed)
        : await signMessageForWallet({
            message: body.nonce,
            walletAddress: walletInfo.publicKey,
            walletId: walletInfo.id,
          });
    let provisionBody: BootstrapProvisionBody;

    if (body.attestationToken != null) {
      provisionBody = {
        walletAddress: body.walletAddress,
        nonce: body.nonce,
        platform: body.platform,
        attestationToken: body.attestationToken,
        ...(body.inviteCode != null ? { inviteCode: body.inviteCode } : {}),
        ...(body.attestationKeyId != null ? { attestationKeyId: body.attestationKeyId } : {}),
        walletSignature,
        appVersion: OFFPAY_APP_VERSION,
        deviceId,
      } satisfies BootstrapProvisionAttestedBody;
    } else {
      if (body.platform !== 'android') {
        throw new Error('OffPay prototype bootstrap bypass is only supported on Android.');
      }

      provisionBody = {
        walletAddress: body.walletAddress,
        nonce: body.nonce,
        platform: 'android',
        ...(body.inviteCode != null ? { inviteCode: body.inviteCode } : {}),
        walletSignature,
        appVersion: OFFPAY_APP_VERSION,
        deviceId,
      } satisfies BootstrapProvisionPrototypeBypassBody;
    }

    const response = await offpayPublicRequest<BootstrapProvisionResponse>({
      path: '/api/bootstrap/provision',
      method: 'POST',
      body: provisionBody,
      headers: {
        'X-Wallet-Address': body.walletAddress,
        'X-Timestamp': String(Date.now()),
        'X-Signature': walletSignature,
        'X-App-Version': OFFPAY_APP_VERSION,
        'X-Device-Id': deviceId,
      },
    });

    await storeOffpayBootstrapCredentials({
      secret: response.secret,
      bootstrapVersion: response.bootstrapVersion,
      walletAddress: body.walletAddress,
    });

    return response;
  } finally {
    if (signingSeed != null) {
      zeroOutBytes(signingSeed);
    }
  }
}

export function getCapabilities(
  network: OffpayNetwork,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<CapabilitiesResponse> {
  return offpayPublicRequest<CapabilitiesResponse>({
    path: '/api/capabilities',
    query: { network },
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  });
}

export async function buildOffpayPublicReadHeaders(): Promise<Record<string, string>> {
  const deviceId = await getOrCreateOffpayDeviceId();

  return {
    'X-App-Version': OFFPAY_APP_VERSION,
    'X-Device-Id': deviceId,
  };
}

export async function verifyInviteCode(
  inviteCode: string,
  email: string,
): Promise<InviteVerifyResponse> {
  return offpayPublicRequest<InviteVerifyResponse>({
    path: '/api/invite/verify',
    method: 'POST',
    body: { inviteCode, email },
    headers: await buildOffpayPublicReadHeaders(),
  });
}

export async function checkInviteEmail(email: string): Promise<{ verified: boolean; segment?: string }> {
  return offpayPublicRequest<{ verified: boolean; segment?: string }>({
    path: '/api/invite/check-email',
    method: 'POST',
    body: { email },
    headers: await buildOffpayPublicReadHeaders(),
  });
}

export async function getWalletBalance(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { useCache?: boolean; signal?: AbortSignal },
): Promise<WalletBalanceResponse> {
  return offpayPublicRequest<WalletBalanceResponse>({
    path: '/api/wallet/balance',
    query: { address: walletAddress, network, useCache: options?.useCache },
    signal: options?.signal,
    headers: await buildOffpayPublicReadHeaders(),
  });
}

export async function getWalletTransactions(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<WalletTransactionsResponse> {
  return offpayPublicRequest<WalletTransactionsResponse>({
    path: '/api/wallet/transactions',
    query: {
      address: walletAddress,
      network,
      cursor: options?.cursor,
      limit: options?.limit,
    },
    signal: options?.signal,
    headers: await buildOffpayPublicReadHeaders(),
  });
}

export function getStreamCapabilities(network: OffpayNetwork): Promise<StreamCapabilitiesResponse> {
  return offpayApiRequest<StreamCapabilitiesResponse>({
    path: '/api/stream/capabilities',
    query: { network },
    network,
  });
}

async function assertPendingBackupWallet(walletAddress: string): Promise<void> {
  const walletInfo = await getStoredWalletInfo();
  if (walletInfo == null) {
    throw new Error('Pending backup request requires an active wallet.');
  }

  if (walletInfo.publicKey !== walletAddress) {
    throw new Error('Pending backup wallet must match the authenticated wallet.');
  }
}

async function assertAuthenticatedWallet(walletAddress: string, label: string): Promise<void> {
  const walletInfo = await getStoredWalletInfo();
  if (walletInfo == null) {
    throw new Error(`${label} requires an active wallet.`);
  }

  if (walletInfo.publicKey !== walletAddress) {
    throw new Error(`${label} wallet must match the authenticated wallet.`);
  }
}

export function uploadPendingBackup(
  walletAddress: string,
  body: PendingBackupUploadBody,
  network: OffpayNetwork,
): Promise<{ stored: true; txId: string }> {
  if (walletAddress.length === 0) {
    throw new Error('Pending backup upload requires a wallet address.');
  }

  return assertPendingBackupWallet(walletAddress).then(() =>
    offpayApiRequest<{ stored: true; txId: string }>({
      path: '/api/pending/backup',
      method: 'POST',
      body,
      network,
    }),
  );
}

export function listPendingBackups(
  walletAddress: string,
  network: OffpayNetwork,
): Promise<PendingBackupListResponse> {
  return assertPendingBackupWallet(walletAddress).then(() =>
    offpayApiRequest<PendingBackupListResponse>({
      path: '/api/pending/backup',
      query: { wallet: walletAddress },
      network,
    }),
  );
}

export function deletePendingBackup(
  walletAddress: string,
  txId: string,
  network: OffpayNetwork,
): Promise<{ deleted: true; txId: string }> {
  if (walletAddress.length === 0) {
    throw new Error('Pending backup delete requires a wallet address.');
  }

  return assertPendingBackupWallet(walletAddress).then(() =>
    offpayApiRequest<{ deleted: true; txId: string }>({
      path: '/api/pending/backup',
      method: 'DELETE',
      body: { txId },
      network,
    }),
  );
}

export async function getSwapTokens(
  network: OffpayNetwork,
  options?: { signal?: AbortSignal },
): Promise<SwapTokensResponse> {
  return offpayPublicRequest<SwapTokensResponse>({
    path: '/api/swap/tokens',
    query: { network },
    signal: options?.signal,
    headers: await buildOffpayPublicReadHeaders(),
  });
}

export async function getSwapPrice(
  mint: string,
  network: OffpayNetwork,
  options?: { signal?: AbortSignal },
): Promise<SwapPriceResponse> {
  return offpayPublicRequest<SwapPriceResponse>({
    path: '/api/swap/price',
    query: { mint, network },
    signal: options?.signal,
    headers: await buildOffpayPublicReadHeaders(),
  });
}

export function createSwapQuote(
  request: SwapQuoteRequest,
  options?: { signal?: AbortSignal },
): Promise<SwapQuoteResponse> {
  return offpayApiRequest<SwapQuoteResponse>({
    path: '/api/swap/quote',
    method: 'POST',
    body: request,
    network: request.network,
    signal: options?.signal,
  });
}

export function executeSwapQuote(request: SwapExecuteRequest): Promise<SwapExecuteResponse> {
  return offpayApiRequest<SwapExecuteResponse>({
    path: '/api/swap/execute',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function requestSwapTriggerChallenge(
  request: SwapTriggerChallengeRequest,
): Promise<SwapTriggerChallengeResponse> {
  return offpayApiRequest<SwapTriggerChallengeResponse>({
    path: '/api/swap/trigger',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function verifySwapTriggerAuth(
  request: SwapTriggerVerifyRequest,
): Promise<SwapTriggerVerifyResponse> {
  return offpayApiRequest<SwapTriggerVerifyResponse>({
    path: '/api/swap/trigger',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function prepareSwapTriggerOrder(
  request: SwapTriggerPrepareRequest,
): Promise<SwapTriggerPrepareResponse> {
  return offpayApiRequest<SwapTriggerPrepareResponse>({
    path: '/api/swap/trigger',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function createSwapTriggerOrder(
  request: SwapTriggerCreateRequest,
): Promise<SwapTriggerCreateResponse> {
  return offpayApiRequest<SwapTriggerCreateResponse>({
    path: '/api/swap/trigger',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function createRecurringSwap(
  request: SwapRecurringCreateRequest,
): Promise<SwapRecurringCreateResponse> {
  return offpayApiRequest<SwapRecurringCreateResponse>({
    path: '/api/swap/recurring',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function executeRecurringSwap(
  request: SwapRecurringExecuteRequest,
): Promise<SwapRecurringExecuteResponse> {
  return offpayApiRequest<SwapRecurringExecuteResponse>({
    path: '/api/swap/recurring',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function preparePrivacySwapEnvelope(
  request: PrivacySwapPrepareRequest,
): Promise<PrivacySwapPrepareResponse> {
  return offpayApiRequest<PrivacySwapPrepareResponse>({
    path: '/api/swap/privacy-envelope/prepare',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function refreshPrivacySwapQuote(
  request: PrivacySwapRefreshQuoteRequest,
): Promise<PrivacySwapRefreshQuoteResponse> {
  return offpayApiRequest<PrivacySwapRefreshQuoteResponse>({
    path: '/api/swap/privacy-envelope/refresh-quote',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function finalizePrivacySwapEnvelope(
  request: PrivacySwapFinalizeRequest,
): Promise<PrivacySwapFinalizeResponse> {
  return offpayApiRequest<PrivacySwapFinalizeResponse>({
    path: '/api/swap/privacy-envelope/finalize',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function initializePrivatePaymentMint(
  request: PrivateInitMintRequest,
): Promise<PrivateInitMintResponse> {
  return offpayApiRequest<PrivateInitMintResponse>({
    path: '/api/payment/private-init-mint',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function getPrivatePaymentBalance(
  walletAddress: string,
  network: OffpayNetwork,
  mint?: string,
): Promise<PrivateBalanceResponse> {
  return offpayApiRequest<PrivateBalanceResponse>({
    path: '/api/payment/private-balance',
    query: { wallet: walletAddress, network, mint },
    network,
  });
}

export function preparePrivateSend(request: PrivateSendRequest): Promise<PrivateSendResponse> {
  return offpayApiRequest<PrivateSendResponse>({
    path: '/api/payment/private-send',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function settlePrivatePayments(
  request: PaymentSettleRequest,
): Promise<PaymentSettleResponse> {
  return offpayApiRequest<PaymentSettleResponse>({
    path: '/api/payment/settle',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function broadcastRawTransaction(
  request: RpcBroadcastRequest,
): Promise<RpcBroadcastResponse> {
  return offpayApiRequest<RpcBroadcastResponse>({
    path: '/api/rpc/broadcast',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function requestDevnetSolAirdrop(
  request: DevnetAirdropRequest,
): Promise<DevnetAirdropResponse> {
  return offpayApiRequest<DevnetAirdropResponse>({
    path: '/api/rpc/devnet-airdrop',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function getRpcLatestBlockhash(network: OffpayNetwork): Promise<RpcLatestBlockhashResponse> {
  return offpayApiRequest<RpcLatestBlockhashResponse>({
    path: '/api/rpc/latest-blockhash',
    query: { network },
    network,
  });
}

export function getRpcFeeForMessage(params: {
  network: OffpayNetwork;
  messageBase64: string;
  signal?: AbortSignal;
}): Promise<{ lamports: number | null }> {
  return offpayApiRequest<{ lamports: number | null }>({
    path: '/api/rpc/fee-for-message',
    method: 'POST',
    body: {
      messageBase64: params.messageBase64,
      network: params.network,
    },
    network: params.network,
    signal: params.signal,
  });
}

export function getRpcAccounts(request: RpcAccountsRequest): Promise<RpcAccountsResponse> {
  return offpayApiRequest<RpcAccountsResponse>({
    path: '/api/rpc/accounts',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function getRpcTokenLargestAccounts(
  request: RpcTokenLargestAccountsRequest,
): Promise<RpcTokenLargestAccountsResponse> {
  return offpayApiRequest<RpcTokenLargestAccountsResponse>({
    path: '/api/rpc/token-largest-accounts',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function getRpcEpochInfo(network: OffpayNetwork): Promise<RpcEpochInfoResponse> {
  return offpayApiRequest<RpcEpochInfoResponse>({
    path: '/api/rpc/epoch-info',
    query: { network },
    network,
  });
}

export function getRpcSlot(network: OffpayNetwork): Promise<RpcSlotResponse> {
  return offpayApiRequest<RpcSlotResponse>({
    path: '/api/rpc/slot',
    query: { network },
    network,
  });
}

export function getRpcSignatureStatuses(
  request: RpcSignatureStatusesRequest,
): Promise<RpcSignatureStatusesResponse> {
  return offpayApiRequest<RpcSignatureStatusesResponse>({
    path: '/api/rpc/signature-statuses',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function getRpcSignaturesForAddress(
  request: RpcSignaturesForAddressRequest,
): Promise<RpcSignaturesForAddressResponse> {
  return offpayApiRequest<RpcSignaturesForAddressResponse>({
    path: '/api/rpc/signatures-for-address',
    method: 'POST',
    body: request,
    network: request.network,
  });
}

export function getUmbraUtxos(request: UmbraUtxosRequest): Promise<UmbraUtxosResponse> {
  return offpayApiRequest<UmbraUtxosResponse>({
    path: '/api/umbra/utxos',
    query: {
      network: request.network,
      start: request.start,
      end: request.end,
      limit: request.limit,
    },
    network: request.network,
  });
}

export function getUmbraTreeProofs(
  request: UmbraTreeProofsRequest,
): Promise<UmbraTreeProofsResponse> {
  return offpayApiRequest<UmbraTreeProofsResponse>({
    path: `/api/umbra/trees/${request.treeIndex}/proofs`,
    method: 'POST',
    body: {
      network: request.network,
      insertionIndexes: request.insertionIndexes,
    },
    network: request.network,
  });
}

export async function getUmbraTreeSummaries(
  network: OffpayNetwork,
): Promise<UmbraTreeSummariesResponse> {
  try {
    const response = await offpayApiRequest<UmbraTreeSummariesResponse>({
      path: '/api/umbra/trees',
      query: { network },
      network,
    });

    if (__DEV__) {
      console.log('[offpay-api] /api/umbra/trees response', {
        network,
        origin: OFFPAY_API_ORIGIN,
        response,
      });
    }

    return response;
  } catch (error) {
    if (__DEV__) {
      console.log('[offpay-api] /api/umbra/trees error', {
        network,
        origin: OFFPAY_API_ORIGIN,
        error:
          error instanceof OffpayApiError
            ? {
                name: error.name,
                code: error.code,
                status: error.status,
                message: error.message,
                retryable: error.retryable,
                retryAfterMs: error.retryAfterMs,
              }
            : error,
      });
    }
    throw error;
  }
}

export function getUmbraRelayerInfo(network: OffpayNetwork): Promise<UmbraRelayerInfoResponse> {
  return offpayApiRequest<UmbraRelayerInfoResponse>({
    path: '/api/umbra/relayer-info',
    query: { network },
    network,
  });
}

export async function submitUmbraClaim(request: UmbraClaimRequest): Promise<UmbraClaimResponse> {
  try {
    const response = await offpayApiRequest<UmbraClaimResponse>({
      path: '/api/umbra/claim',
      method: 'POST',
      body: request,
      network: request.network,
    });

    if (__DEV__) {
      console.log('[offpay-api] /api/umbra/claim response', {
        network: request.network,
        origin: OFFPAY_API_ORIGIN,
        claimId: response.claimId,
        status: response.status,
        resultKeys: response.result == null ? [] : Object.keys(response.result),
      });
    }

    return response;
  } catch (error) {
    if (__DEV__) {
      console.log('[offpay-api] /api/umbra/claim error', {
        network: request.network,
        origin: OFFPAY_API_ORIGIN,
        error:
          error instanceof OffpayApiError
            ? {
                name: error.name,
                code: error.code,
                status: error.status,
                message: error.message,
                retryable: error.retryable,
                retryAfterMs: error.retryAfterMs,
              }
            : error,
      });
    }
    throw error;
  }
}

export function getUmbraClaimStatus(params: {
  network: OffpayNetwork;
  id: string;
}): Promise<UmbraClaimStatusResponse> {
  return offpayApiRequest<UmbraClaimStatusResponse>({
    path: `/api/umbra/claim-status/${encodeURIComponent(params.id)}`,
    query: { network: params.network },
    network: params.network,
  });
}

export function getOfflineRentEstimate(params: {
  walletAddress: string;
  slotCount: number;
  network: OffpayNetwork;
}): Promise<OfflineRentEstimateResponse> {
  return assertAuthenticatedWallet(params.walletAddress, 'Offline rent estimate').then(() =>
    offpayApiRequest<OfflineRentEstimateResponse>({
      path: '/api/offline/rent-estimate',
      query: {
        wallet: params.walletAddress,
        slotCount: params.slotCount,
        network: params.network,
      },
      network: params.network,
    }),
  );
}

export function prepareOfflineNoncePool(
  request: OfflineNoncePoolPrepareRequest,
): Promise<OfflineNoncePoolPrepareResponse> {
  return assertAuthenticatedWallet(request.walletAddress, 'Offline slot preparation').then(() =>
    offpayApiRequest<OfflineNoncePoolPrepareResponse>({
      path: '/api/offline/nonce-pool/prepare',
      method: 'POST',
      body: request,
      headers: {
        'Idempotency-Key': buildIdempotencyKey('nonce-prepare', [
          request.walletAddress,
          request.nonceAuthority,
          request.network,
          ...request.nonceAccounts.slice().sort(),
        ]),
      },
      network: request.network,
    }),
  );
}

export function prepareOfflineNonceAdvance(
  request: OfflineNoncePoolAdvanceRequest,
): Promise<OfflineNoncePoolAdvanceResponse> {
  return assertAuthenticatedWallet(request.walletAddress, 'Offline slot refresh').then(() =>
    offpayApiRequest<OfflineNoncePoolAdvanceResponse>({
      path: '/api/offline/nonce-pool/advance',
      method: 'POST',
      body: request,
      headers: {
        'Idempotency-Key': buildIdempotencyKey('nonce-advance', [
          request.walletAddress,
          request.nonceAccount,
          request.network,
        ]),
      },
      network: request.network,
    }),
  );
}

export function getOfflineNoncePoolStatus(params: {
  walletAddress: string;
  targetSlotCount: number;
  network: OffpayNetwork;
  nonceAccounts?: string[];
}): Promise<OfflineNoncePoolStatusResponse> {
  return assertAuthenticatedWallet(params.walletAddress, 'Offline slot status').then(() =>
    offpayApiRequest<OfflineNoncePoolStatusResponse>({
      path: '/api/offline/nonce-pool/status',
      query: {
        wallet: params.walletAddress,
        targetSlotCount: params.targetSlotCount,
        network: params.network,
      },
      network: params.network,
    }),
  );
}

export function getOfflineTokenContext(params: {
  mint: string;
  sender: string;
  recipient: string;
  network: OffpayNetwork;
}): Promise<OfflineTokenContextResponse> {
  return assertAuthenticatedWallet(params.sender, 'Offline token context').then(() =>
    offpayApiRequest<OfflineTokenContextResponse>({
      path: '/api/offline/token-context',
      query: {
        mint: params.mint,
        sender: params.sender,
        recipient: params.recipient,
        network: params.network,
      },
      network: params.network,
    }),
  );
}
