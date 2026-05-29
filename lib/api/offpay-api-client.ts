import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  buildOffpayAuthHeadersAsync,
  signBootstrapNonce,
  zeroOutBytes,
} from '@/lib/crypto/offpay-api-auth';
import Constants from 'expo-constants';
import { getClientCapabilities } from '@/services/capabilities';
import {
  broadcastRawTransaction as providerBroadcastRawTransaction,
  getRpcAccounts as providerGetRpcAccounts,
  getRpcEpochInfo as providerGetRpcEpochInfo,
  getRpcFeeForMessage as providerGetRpcFeeForMessage,
  getRpcLatestBlockhash as providerGetRpcLatestBlockhash,
  getRpcSignatureStatuses as providerGetRpcSignatureStatuses,
  getRpcSignaturesForAddress as providerGetRpcSignaturesForAddress,
  getRpcSlot as providerGetRpcSlot,
  getRpcTokenLargestAccounts as providerGetRpcTokenLargestAccounts,
  getWalletBalance as providerGetWalletBalance,
  getWalletTransactions as providerGetWalletTransactions,
  hasConfiguredWsProvider,
} from '@/services/rpc';
import {
  getPrivatePaymentBalance as clientGetPrivatePaymentBalance,
  initializePrivatePaymentMint as clientInitializePrivatePaymentMint,
  preparePrivateSend as clientPreparePrivateSend,
  settlePrivatePayments as clientSettlePrivatePayments,
} from '@/services/private-payments';
import {
  getOfflineNoncePoolStatus as clientGetOfflineNoncePoolStatus,
  getOfflineRentEstimate as clientGetOfflineRentEstimate,
  getOfflineTokenContext as clientGetOfflineTokenContext,
  prepareOfflineNonceAdvance as clientPrepareOfflineNonceAdvance,
  prepareOfflineNoncePool as clientPrepareOfflineNoncePool,
} from '@/services/offline';
import {
  getUmbraClaimStatus as clientGetUmbraClaimStatus,
  getUmbraRelayerInfo as clientGetUmbraRelayerInfo,
  getUmbraTreeProofs as clientGetUmbraTreeProofs,
  getUmbraUtxos as clientGetUmbraUtxos,
  submitUmbraClaim as clientSubmitUmbraClaim,
} from '@/services/umbra';
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
import { decodeSigningSeedFromPrivateKey, deriveSigningSeedFromMnemonic } from '@/lib/wallet/wallet';
import { getOrDeriveSigningSeed } from '@/lib/wallet/signing-seed-cache';
import { yieldToEventLoop, yieldToUi } from '@/lib/perf/ui-work-scheduler';

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
  UmbraTreeProofsRequest,
  UmbraTreeProofsResponse,
  UmbraUtxosRequest,
  UmbraUtxosResponse,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

const PUBLIC_OFFPAY_API_ORIGIN = process.env.EXPO_PUBLIC_OFFPAY_API_ORIGIN?.trim();

export const OFFPAY_API_ORIGIN = (
  PUBLIC_OFFPAY_API_ORIGIN != null && PUBLIC_OFFPAY_API_ORIGIN.length > 0
    ? PUBLIC_OFFPAY_API_ORIGIN
    : 'https://api.offpay.app'
).replace(/\/$/, '');
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
  walletAddress: string;
  signingSeed: Uint8Array;
  requestSecret: string;
  deviceId: string;
  bootstrapVersion: number;
}

interface SigningSession {
  walletId: string;
  walletAddress: string;
  signingSeed: Uint8Array;
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
  const text = await response.text();
  if (text.length === 0) return null;

  try {
    await yieldToUi();
    const payload = JSON.parse(text);
    await yieldToEventLoop();
    return payload;
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

async function offpayPublicRequest<T>(options: PublicRequestOptions): Promise<T> {
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
    await yieldToUi();
    init.body = JSON.stringify(options.body);
    await yieldToEventLoop();
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

async function fetchFrankfurterUsdRate(currency: string): Promise<number> {
  assertOffpayNetworkAccessAllowed();

  const handle = withTimeout(undefined);
  try {
    const response = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${currency}`, {
      signal: handle.signal,
    });
    if (!response.ok) {
      throw new Error(`Frankfurter does not have a USD/${currency} rate.`);
    }

    const body = (await parseJsonResponse(response)) as { rates?: Record<string, number> };
    const rate = body.rates?.[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      throw new Error(`Frankfurter missing USD/${currency} rate.`);
    }

    return rate;
  } finally {
    handle.cleanup();
  }
}

async function fetchCurrencyApiUsdRate(currency: string): Promise<number> {
  assertOffpayNetworkAccessAllowed();

  const target = currency.toLowerCase();
  const handle = withTimeout(undefined);
  try {
    const response = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      { signal: handle.signal },
    );
    if (!response.ok) {
      throw new Error(`Currency API does not have a USD/${currency} rate.`);
    }

    const body = (await parseJsonResponse(response)) as { usd?: Record<string, unknown> };
    const rate = body.usd?.[target];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      throw new Error(`Currency API missing USD/${currency} rate.`);
    }

    return rate;
  } finally {
    handle.cleanup();
  }
}

export async function fetchUsdToCurrencyRateFromNetwork(currency: string): Promise<number> {
  try {
    return await fetchFrankfurterUsdRate(currency);
  } catch {
    return fetchCurrencyApiUsdRate(currency);
  }
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
}): Promise<Uint8Array> {
  const signingSeed = await getOrDeriveSigningSeed({
    walletAddress: params.walletAddress,
    derive: async () => {
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
  walletInfo: { id: string; publicKey: string },
): session is SigningSession {
  return (
    session != null &&
    session.walletId === walletInfo.id &&
    session.walletAddress === walletInfo.publicKey
  );
}

function createSigningSession(walletInfo: {
  id: string;
  publicKey: string;
}): Promise<SigningSession> {
  const sessionEpoch = signingSessionEpoch;

  const promise = (async () => {
    const signingSeed = await deriveSigningSeedWithAuth({
      walletId: walletInfo.id,
      walletAddress: walletInfo.publicKey,
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

async function getSigningSeed(walletInfo: { id: string; publicKey: string }): Promise<Uint8Array> {
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

  const signingSeed = await getSigningSeed(walletInfo);

  return {
    walletAddress: walletInfo.publicKey,
    signingSeed,
    requestSecret,
    deviceId,
    bootstrapVersion,
  };
}

export async function offpayApiRequest<T>(options: OffpayRequestOptions): Promise<T> {
  assertOffpayNetworkAccessAllowed();

  const method = options.method ?? 'GET';
  const pathAndQuery = appendQuery(options.path, options.query);
  const authContext = await getStoredAuthContext(options.walletId);

  try {
    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/json',
      ...(await buildOffpayAuthHeadersAsync({
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
      })),
      ...options.headers,
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
      await yieldToUi();
      init.body = JSON.stringify(options.body);
      await yieldToEventLoop();
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
      if (await recoverOffpayAuth(reprovisionAuth)) {
        return offpayApiRequest<T>({
          ...options,
          retryAuthRecovery: false,
        });
      }
    }

    throw error;
  } finally {
    zeroOutBytes(authContext.signingSeed);
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
    getSigningSeed(walletInfo),
    getOrCreateOffpayDeviceId(),
  ]);

  try {
    await yieldToUi();
    const walletSignature = signBootstrapNonce(body.nonce, signingSeed);
    let provisionBody: BootstrapProvisionBody;

    if (body.attestationToken != null) {
      provisionBody = {
        walletAddress: body.walletAddress,
        nonce: body.nonce,
        platform: body.platform,
        attestationToken: body.attestationToken,
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
    zeroOutBytes(signingSeed);
  }
}

export function getCapabilities(network: OffpayNetwork): Promise<CapabilitiesResponse> {
  return Promise.resolve(getClientCapabilities(network));
}

export function getWalletBalance(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { useCache?: boolean; signal?: AbortSignal },
): Promise<WalletBalanceResponse> {
  return providerGetWalletBalance(walletAddress, network, { signal: options?.signal });
}

export function getWalletTransactions(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<WalletTransactionsResponse> {
  return providerGetWalletTransactions(walletAddress, network, options);
}

export function getStreamCapabilities(network: OffpayNetwork): Promise<StreamCapabilitiesResponse> {
  return Promise.resolve({
    network,
    capabilities: {
      walletActivity: hasConfiguredWsProvider(network),
    },
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

export function getSwapTokens(
  network: OffpayNetwork,
  options?: { signal?: AbortSignal },
): Promise<SwapTokensResponse> {
  return offpayApiRequest<SwapTokensResponse>({
    path: '/api/swap/tokens',
    query: { network },
    network,
    signal: options?.signal,
  });
}

export function getSwapPrice(
  mint: string,
  network: OffpayNetwork,
  options?: { signal?: AbortSignal },
): Promise<SwapPriceResponse> {
  return offpayApiRequest<SwapPriceResponse>({
    path: '/api/swap/price',
    query: { mint, network },
    network,
    signal: options?.signal,
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
  return clientInitializePrivatePaymentMint(request);
}

export function getPrivatePaymentBalance(
  walletAddress: string,
  network: OffpayNetwork,
  mint?: string,
): Promise<PrivateBalanceResponse> {
  return clientGetPrivatePaymentBalance(walletAddress, network, mint);
}

export function preparePrivateSend(request: PrivateSendRequest): Promise<PrivateSendResponse> {
  return clientPreparePrivateSend(request);
}

export function settlePrivatePayments(
  request: PaymentSettleRequest,
): Promise<PaymentSettleResponse> {
  return clientSettlePrivatePayments(request);
}

export function broadcastRawTransaction(
  request: RpcBroadcastRequest,
): Promise<RpcBroadcastResponse> {
  return providerBroadcastRawTransaction(request);
}

export function getRpcLatestBlockhash(network: OffpayNetwork): Promise<RpcLatestBlockhashResponse> {
  return providerGetRpcLatestBlockhash(network);
}

export function getRpcFeeForMessage(params: {
  network: OffpayNetwork;
  messageBase64: string;
  signal?: AbortSignal;
}): Promise<{ lamports: number | null }> {
  return providerGetRpcFeeForMessage(params);
}

export function getRpcAccounts(request: RpcAccountsRequest): Promise<RpcAccountsResponse> {
  return providerGetRpcAccounts(request);
}

export function getRpcTokenLargestAccounts(
  request: RpcTokenLargestAccountsRequest,
): Promise<RpcTokenLargestAccountsResponse> {
  return providerGetRpcTokenLargestAccounts(request);
}

export function getRpcEpochInfo(network: OffpayNetwork): Promise<RpcEpochInfoResponse> {
  return providerGetRpcEpochInfo(network);
}

export function getRpcSlot(network: OffpayNetwork): Promise<RpcSlotResponse> {
  return providerGetRpcSlot(network);
}

export function getRpcSignatureStatuses(
  request: RpcSignatureStatusesRequest,
): Promise<RpcSignatureStatusesResponse> {
  return providerGetRpcSignatureStatuses(request);
}

export function getRpcSignaturesForAddress(
  request: RpcSignaturesForAddressRequest,
): Promise<RpcSignaturesForAddressResponse> {
  return providerGetRpcSignaturesForAddress(request);
}

export function getUmbraUtxos(request: UmbraUtxosRequest): Promise<UmbraUtxosResponse> {
  return clientGetUmbraUtxos(request);
}

export function getUmbraTreeProofs(
  request: UmbraTreeProofsRequest,
): Promise<UmbraTreeProofsResponse> {
  return clientGetUmbraTreeProofs(request);
}

export function getUmbraRelayerInfo(network: OffpayNetwork): Promise<UmbraRelayerInfoResponse> {
  return clientGetUmbraRelayerInfo(network);
}

export function submitUmbraClaim(request: UmbraClaimRequest): Promise<UmbraClaimResponse> {
  return clientSubmitUmbraClaim(request);
}

export function getUmbraClaimStatus(params: {
  network: OffpayNetwork;
  id: string;
}): Promise<UmbraClaimStatusResponse> {
  return clientGetUmbraClaimStatus(params);
}

export function getOfflineRentEstimate(params: {
  walletAddress: string;
  slotCount: number;
  network: OffpayNetwork;
}): Promise<OfflineRentEstimateResponse> {
  return assertAuthenticatedWallet(params.walletAddress, 'Offline rent estimate').then(() =>
    clientGetOfflineRentEstimate(params),
  );
}

export function prepareOfflineNoncePool(
  request: OfflineNoncePoolPrepareRequest,
): Promise<OfflineNoncePoolPrepareResponse> {
  return assertAuthenticatedWallet(request.walletAddress, 'Offline slot preparation').then(() =>
    clientPrepareOfflineNoncePool(request),
  );
}

export function prepareOfflineNonceAdvance(
  request: OfflineNoncePoolAdvanceRequest,
): Promise<OfflineNoncePoolAdvanceResponse> {
  return assertAuthenticatedWallet(request.walletAddress, 'Offline slot refresh').then(() =>
    clientPrepareOfflineNonceAdvance(request),
  );
}

export function getOfflineNoncePoolStatus(params: {
  walletAddress: string;
  targetSlotCount: number;
  network: OffpayNetwork;
  nonceAccounts?: string[];
}): Promise<OfflineNoncePoolStatusResponse> {
  return assertAuthenticatedWallet(params.walletAddress, 'Offline slot status').then(() =>
    clientGetOfflineNoncePoolStatus(params),
  );
}

export function getOfflineTokenContext(params: {
  mint: string;
  sender: string;
  recipient: string;
  network: OffpayNetwork;
}): Promise<OfflineTokenContextResponse> {
  return assertAuthenticatedWallet(params.sender, 'Offline token context').then(() =>
    clientGetOfflineTokenContext(params),
  );
}
