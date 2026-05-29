import { Buffer } from 'buffer';

import bs58 from 'bs58';

import type {
  JsonValue,
  OffpayNetwork,
  RpcAccountRecord,
  RpcAccountsResponse,
  RpcBroadcastResponse,
  RpcEpochInfoResponse,
  RpcLatestBlockhashResponse,
  RpcSignatureStatusesResponse,
  RpcSignaturesForAddressResponse,
  RpcSlotResponse,
  RpcTokenLargestAccountsResponse,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';
import { getStablecoinSymbolForMint } from '@/lib/policy/stablecoin-policy';
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';
import {
  readJsonResponseAdaptive,
  stringifyJsonAdaptive,
  yieldToEventLoop,
  yieldToUi,
  yieldToUiIfNeeded,
} from '@/lib/perf/ui-work-scheduler';

type ProviderName = 'helius' | 'alchemy';
type ProviderMethodGroup = 'read' | 'wallet' | 'history' | 'broadcast';

interface RpcProvider {
  name: ProviderName;
  network: OffpayNetwork;
  httpUrl: string | null;
  wsUrl: string | null;
  priority: {
    http: number;
    ws: number;
  };
}

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string | number | null;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc?: string;
  id?: string | number | null;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

interface ProviderState {
  cooldownUntil: number;
  disabled: boolean;
}

const RPC_TIMEOUT_MS = 12_000;
const RETRYABLE_RPC_CODES = new Set([-32005, -32004, -32002]);
const RETRYABLE_HTTP_STATUSES = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
const HTTP_ENDPOINT_COOLDOWN_MS = 60_000;
const TRANSACTION_ENRICHMENT_BATCH_SIZE = 8;
const TRANSACTION_ENRICHMENT_RPC_CONFIG = {
  maxSupportedTransactionVersion: 0,
  encoding: 'json',
  commitment: 'confirmed',
} as const;
const TRANSACTION_ENRICHMENT_PARSED_RPC_CONFIG = {
  maxSupportedTransactionVersion: 0,
  encoding: 'jsonParsed',
  commitment: 'confirmed',
} as const;
const PROVIDER_PRIORITIES: Record<ProviderName, RpcProvider['priority']> = {
  helius: { http: 0, ws: 0 },
  // Alchemy is a real WS fallback now: we read its WSS env vars and
  // accept it on the rotation when Helius is unhealthy. Priority `1`
  // keeps Helius preferred under normal conditions.
  alchemy: { http: 1, ws: 1 },
};
const TOKEN_BUCKETS: Record<ProviderMethodGroup, { capacity: number; refillPerSecond: number }> = {
  read: { capacity: 90, refillPerSecond: 45 },
  wallet: { capacity: 36, refillPerSecond: 18 },
  // History pages need 1 `getSignaturesForAddress` + N `getTransaction`
  // calls. Even with batched RPC the bucket needs enough capacity to
  // cover a 100-tx detail screen burst plus a refresh cycle without
  // starving. 60/30 is well under Helius's free-tier RPS ceiling and
  // mirrors what the wallet group sustains for cold-start fan-out.
  history: { capacity: 60, refillPerSecond: 30 },
  broadcast: { capacity: 4, refillPerSecond: 1.5 },
};
const PUBLIC_PROVIDER_ENV = {
  EXPO_PUBLIC_HELIUS_MAINNET_RPC_URL: process.env.EXPO_PUBLIC_HELIUS_MAINNET_RPC_URL,
  EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL: process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL,
  EXPO_PUBLIC_HELIUS_MAINNET_WSS_URL: process.env.EXPO_PUBLIC_HELIUS_MAINNET_WSS_URL,
  EXPO_PUBLIC_HELIUS_DEVNET_WSS_URL: process.env.EXPO_PUBLIC_HELIUS_DEVNET_WSS_URL,

  EXPO_PUBLIC_ALCHEMY_MAINNET_RPC_URL: process.env.EXPO_PUBLIC_ALCHEMY_MAINNET_RPC_URL,
  EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL: process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL,
  EXPO_PUBLIC_ALCHEMY_MAINNET_WSS_URL: process.env.EXPO_PUBLIC_ALCHEMY_MAINNET_WSS_URL,
  EXPO_PUBLIC_ALCHEMY_DEVNET_WSS_URL: process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_WSS_URL,
} satisfies Record<string, string | undefined>;

const buckets = new Map<string, TokenBucket>();
const states = new Map<string, ProviderState>();

class ProviderRouterError extends Error {
  readonly retryable: boolean;
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number;
  readonly provider?: ProviderName;
  readonly rpcError?: JsonRpcFailure['error'];

  constructor(params: {
    message: string;
    retryable: boolean;
    status: number;
    code: string;
    retryAfterMs?: number;
    provider?: ProviderName;
    rpcError?: JsonRpcFailure['error'];
  }) {
    super(params.message);
    this.name = 'ProviderRouterError';
    this.retryable = params.retryable;
    this.status = params.status;
    this.code = params.code;
    this.retryAfterMs = params.retryAfterMs ?? 0;
    this.provider = params.provider;
    this.rpcError = params.rpcError;
  }
}

function readPublicEnv(key: keyof typeof PUBLIC_PROVIDER_ENV): string | null {
  const value = PUBLIC_PROVIDER_ENV[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function endpointFor(
  provider: ProviderName,
  network: OffpayNetwork,
  kind: 'RPC' | 'WS',
): string | null {
  if (kind === 'WS') {
    if (provider === 'helius') {
      return network === 'mainnet'
        ? readPublicEnv('EXPO_PUBLIC_HELIUS_MAINNET_WSS_URL')
        : readPublicEnv('EXPO_PUBLIC_HELIUS_DEVNET_WSS_URL');
    }
    // Alchemy WSS — only present when the operator has configured a
    // matching env var. We read it lazily so the absence of the var
    // makes Alchemy a no-op for WS rather than a hard error.
    return network === 'mainnet'
      ? readPublicEnv('EXPO_PUBLIC_ALCHEMY_MAINNET_WSS_URL')
      : readPublicEnv('EXPO_PUBLIC_ALCHEMY_DEVNET_WSS_URL');
  }

  if (provider === 'helius') {
    return network === 'mainnet'
      ? readPublicEnv('EXPO_PUBLIC_HELIUS_MAINNET_RPC_URL')
      : readPublicEnv('EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL');
  }

  return network === 'mainnet'
    ? readPublicEnv('EXPO_PUBLIC_ALCHEMY_MAINNET_RPC_URL')
    : readPublicEnv('EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL');
}

function buildProviders(network: OffpayNetwork): RpcProvider[] {
  // The provider list depends only on `process.env`, which is fixed
  // at module evaluation. Reading the provider env vars on every RPC
  // helper call (and there are many: `orderedConfiguredHttpProviders`,
  // `getConfiguredWsEndpoints`, `hasConfiguredHttpProvider`, ...)
  // adds avoidable allocations to every Solana request. Memoise per
  // network so the result is computed once and reused.
  const cached = providersByNetwork.get(network);
  if (cached != null) return cached;
  const providers = (['helius', 'alchemy'] as const).map((name) => ({
    name,
    network,
    httpUrl: endpointFor(name, network, 'RPC'),
    wsUrl: endpointFor(name, network, 'WS'),
    priority: PROVIDER_PRIORITIES[name],
  }));
  providersByNetwork.set(network, providers);
  return providers;
}

const providersByNetwork = new Map<OffpayNetwork, RpcProvider[]>();

function providerStateKey(provider: RpcProvider): string {
  return `${provider.network}:${provider.name}`;
}

function bucketKey(provider: RpcProvider, group: ProviderMethodGroup): string {
  return `${providerStateKey(provider)}:${group}`;
}

function getProviderState(provider: RpcProvider): ProviderState {
  const key = providerStateKey(provider);
  const current = states.get(key);
  if (current) return current;
  const next = { cooldownUntil: 0, disabled: false };
  states.set(key, next);
  return next;
}

function markProviderCooldown(provider: RpcProvider, retryAfterMs: number): void {
  const state = getProviderState(provider);
  state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + retryAfterMs);
}

function markProviderDisabled(provider: RpcProvider): void {
  const state = getProviderState(provider);
  state.disabled = true;
}

function isProviderAvailable(provider: RpcProvider): boolean {
  const state = getProviderState(provider);
  return !state.disabled && state.cooldownUntil <= Date.now();
}

function consumeToken(provider: RpcProvider, group: ProviderMethodGroup): boolean {
  const policy = TOKEN_BUCKETS[group];
  const key = bucketKey(provider, group);
  const now = Date.now();
  const current = buckets.get(key) ?? { tokens: policy.capacity, updatedAt: now };
  const elapsedSeconds = Math.max(0, (now - current.updatedAt) / 1000);
  const tokens = Math.min(
    policy.capacity,
    current.tokens + elapsedSeconds * policy.refillPerSecond,
  );

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return false;
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return true;
}

function nextTokenWaitMs(provider: RpcProvider, group: ProviderMethodGroup): number {
  const policy = TOKEN_BUCKETS[group];
  const key = bucketKey(provider, group);
  const current = buckets.get(key);
  if (current == null || current.tokens >= 1) return 0;
  const missing = 1 - current.tokens;
  return Math.ceil((missing / policy.refillPerSecond) * 1000);
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    let abortHandler: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (signal != null && abortHandler != null) {
        signal.removeEventListener('abort', abortHandler);
      }
      resolve();
    }, ms);

    abortHandler = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('RPC request was aborted.'));
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

async function acquireProviderToken(
  provider: RpcProvider,
  group: ProviderMethodGroup,
  signal?: AbortSignal,
): Promise<boolean> {
  if (consumeToken(provider, group)) return true;

  // Wait up to 4s for a token to refill. The history group can drain
  // quickly during a burst (page load + warm-start) — bailing after
  // 900ms used to cascade into null enrichments and the dreaded
  // "Tx XXXX...XXXX" placeholder rows. We still bound the wait so a
  // misconfigured bucket can't pin the request indefinitely.
  const waitMs = Math.min(nextTokenWaitMs(provider, group), 4_000);
  if (waitMs <= 0) return false;
  await sleepWithAbort(waitMs, signal);
  return consumeToken(provider, group);
}

function parseRetryAfterMs(value: string | null): number {
  if (value == null) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.ceil(numeric * 1000);
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function retryAfterForHttpStatus(status: number, headerValue: string | null): number {
  const retryAfterMs = parseRetryAfterMs(headerValue);
  if (retryAfterMs > 0) return retryAfterMs;
  if (status === 404 || status === 405 || status === 410) return HTTP_ENDPOINT_COOLDOWN_MS;
  if (status === 408 || status === 409 || status === 425) return 5_000;
  return 3_000;
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let upstreamAbort: (() => void) | null = null;
  if (signal != null) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      upstreamAbort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', upstreamAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`RPC request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (signal != null && upstreamAbort != null) {
        signal.removeEventListener('abort', upstreamAbort);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcFailure(value: unknown): value is JsonRpcFailure {
  return isRecord(value) && isRecord(value.error);
}

function isJsonRpcSuccess<T>(value: unknown): value is JsonRpcSuccess<T> {
  return isRecord(value) && 'result' in value && !('error' in value);
}

async function parseRpcJsonResponse(response: Response): Promise<unknown> {
  // Tiny RPC reads (`getSlot`, `getBalance`, `getSignatureStatuses`)
  // return a few hundred bytes — paying a `requestAnimationFrame +
  // setTimeout(0)` round-trip to parse them adds ~16ms+ of pure
  // latency per call. The adaptive helper keeps the yield where the
  // payload is actually large enough to block frames (busy
  // `getTokenAccountsByOwner`, full `getTransaction` meta).
  return readJsonResponseAdaptive(response);
}

function jsonValue(value: unknown): JsonValue {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as JsonValue;
  }

  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  }

  return String(value);
}

function isRetryableRpcMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('timeout') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('try again') ||
    normalized.includes('overloaded')
  );
}

function isProviderMethodUnavailableRpcError(code: number, message: string): boolean {
  const normalized = message.toLowerCase();
  return code === 35 || normalized.includes('method is not available');
}

function classifyRpcError(
  provider: RpcProvider,
  method: string,
  failure: JsonRpcFailure,
): ProviderRouterError {
  const code = typeof failure.error.code === 'number' ? failure.error.code : 0;
  const message = failure.error.message ?? 'RPC provider rejected the request.';
  const providerMethodUnavailable = isProviderMethodUnavailableRpcError(code, message);
  const retryable =
    providerMethodUnavailable ||
    (method !== 'sendTransaction' && RETRYABLE_RPC_CODES.has(code)) ||
    code === 429 ||
    isRetryableRpcMessage(message);

  return new ProviderRouterError({
    message,
    retryable,
    status: retryable ? 503 : 400,
    code: retryable ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
    retryAfterMs: providerMethodUnavailable ? HTTP_ENDPOINT_COOLDOWN_MS : retryable ? 5_000 : 0,
    provider: provider.name,
    rpcError: failure.error,
  });
}

function classifyFetchError(provider: RpcProvider, error: unknown): ProviderRouterError {
  if (error instanceof ProviderRouterError) return error;
  return new ProviderRouterError({
    message: error instanceof Error ? error.message : 'RPC provider is unavailable.',
    retryable: true,
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    retryAfterMs: 2_000,
    provider: provider.name,
  });
}

function isPayloadTooLargeError(error: unknown): error is ProviderRouterError {
  return error instanceof ProviderRouterError && error.status === 413;
}

function isAbortLikeError(error: unknown): boolean {
  if (typeof error === 'string') return error === 'Aborted';
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.message === 'Aborted';
}

function rpcAbortError(error: unknown): Error {
  return error instanceof Error ? error : new Error('RPC request was aborted.');
}

function groupForMethod(method: string): ProviderMethodGroup {
  if (method === 'sendTransaction') return 'broadcast';
  if (method === 'getSignaturesForAddress' || method === 'getTransaction') return 'history';
  if (
    method === 'getBalance' ||
    method === 'getTokenAccountsByOwner' ||
    method === 'getFeeForMessage'
  ) {
    return 'wallet';
  }
  return 'read';
}

function orderedConfiguredHttpProviders(network: OffpayNetwork, method: string): RpcProvider[] {
  // The order is a pure function of (network, method) — provider
  // *availability* (cooldowns, disabled flags) is a separate concern
  // applied in `rpcRequest` after this returns. Caching the sorted
  // list avoids an allocation per RPC call (and there are many: every
  // wallet refetch, every fee-estimate, every history page).
  const orderingKey =
    method === 'sendTransaction'
      ? 'broadcast'
      : method === 'getTokenAccountsByOwner'
        ? 'helius-priority'
        : 'default';
  const cacheKey = `${network}:${orderingKey}`;
  const cached = httpProvidersByOrderingKey.get(cacheKey);
  if (cached != null) return cached;
  const providers = buildProviders(network).filter((provider) => provider.httpUrl != null);
  const priorityBoost = method === 'getTokenAccountsByOwner' ? 'helius' : null;
  const ordered = providers.slice().sort((left, right) => {
    if (left.name === priorityBoost && right.name !== priorityBoost) return -1;
    if (right.name === priorityBoost && left.name !== priorityBoost) return 1;
    return left.priority.http - right.priority.http;
  });
  httpProvidersByOrderingKey.set(cacheKey, ordered);
  return ordered;
}

const httpProvidersByOrderingKey = new Map<string, RpcProvider[]>();

function unavailableProviderError(network: OffpayNetwork): ProviderRouterError {
  return new ProviderRouterError({
    message:
      `No ${network} Solana RPC endpoint is configured. Add ` +
      `EXPO_PUBLIC_HELIUS_${network === 'mainnet' ? 'MAINNET' : 'DEVNET'}_RPC_URL or ` +
      `EXPO_PUBLIC_ALCHEMY_${network === 'mainnet' ? 'MAINNET' : 'DEVNET'}_RPC_URL, then restart the Expo bundler or rebuild the app.`,
    retryable: false,
    status: 503,
    code: 'MISSING_PROVIDER_CONFIG',
  });
}

async function rpcRequest<T>(
  network: OffpayNetwork,
  method: string,
  params: unknown[] = [],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onProviderSuccess?: (provider: RpcProvider) => void;
  } = {},
): Promise<T> {
  const configuredProviders = orderedConfiguredHttpProviders(network, method);
  if (configuredProviders.length === 0) {
    throw unavailableProviderError(network);
  }

  const providers = configuredProviders.filter(isProviderAvailable);
  if (providers.length === 0) {
    throw new ProviderRouterError({
      message: 'All configured Solana RPC providers are temporarily cooling down.',
      retryable: true,
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      retryAfterMs: 5_000,
    });
  }

  let lastError: ProviderRouterError | null = null;
  let tokenLimited = false;
  const group = groupForMethod(method);

  for (const provider of providers) {
    const handle = withTimeout(options.signal, options.timeoutMs ?? RPC_TIMEOUT_MS);
    try {
      const hasToken = await acquireProviderToken(provider, group, handle.signal);
      if (!hasToken) {
        tokenLimited = true;
        continue;
      }

      await yieldToEventLoop();
      const body = await stringifyJsonAdaptive({
        jsonrpc: '2.0',
        id: `${provider.name}:${method}:${Date.now()}`,
        method,
        params,
      });

      if (__DEV__ && method === 'sendTransaction') {
        console.log('[provider-router] sendTransaction rpc attempt', {
          network,
          provider: provider.name,
        });
      }

      const response = await fetch(provider.httpUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: handle.signal,
      });

      if (response.status === 401 || response.status === 403) {
        markProviderDisabled(provider);
        throw new ProviderRouterError({
          message: `${provider.name} RPC credentials are rejected.`,
          retryable: true,
          status: response.status,
          code: 'UPSTREAM_UNAVAILABLE',
          provider: provider.name,
        });
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After')) || 10_000;
        markProviderCooldown(provider, retryAfterMs);
        throw new ProviderRouterError({
          message: `${provider.name} RPC is rate limited.`,
          retryable: true,
          status: 429,
          code: 'RATE_LIMITED',
          retryAfterMs,
          provider: provider.name,
        });
      }

      if (!response.ok) {
        const payload = await parseRpcJsonResponse(response).catch(() => null);
        if (isJsonRpcFailure(payload)) {
          throw classifyRpcError(provider, method, payload);
        }

        const retryAfterMs = retryAfterForHttpStatus(
          response.status,
          response.headers.get('Retry-After'),
        );
        const retryable = RETRYABLE_HTTP_STATUSES.has(response.status) || response.status >= 500;
        if (retryable) markProviderCooldown(provider, retryAfterMs);
        throw new ProviderRouterError({
          message: `${provider.name} RPC failed with HTTP ${response.status}.`,
          retryable,
          status: response.status,
          code: retryable ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
          retryAfterMs,
          provider: provider.name,
        });
      }

      const payload = await parseRpcJsonResponse(response);
      if (isJsonRpcFailure(payload)) {
        throw classifyRpcError(provider, method, payload);
      }
      if (!isJsonRpcSuccess<T>(payload)) {
        throw new ProviderRouterError({
          message: `${provider.name} RPC returned an unreadable response.`,
          retryable: true,
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          provider: provider.name,
        });
      }
      options.onProviderSuccess?.(provider);
      return payload.result;
    } catch (error) {
      if (options.signal?.aborted === true || isAbortLikeError(error)) {
        throw rpcAbortError(error);
      }
      const routedError = classifyFetchError(provider, error);
      lastError = routedError;
      if (__DEV__ && method === 'sendTransaction' && routedError.retryable) {
        console.warn('[provider-router] sendTransaction rpc fallback', {
          network,
          provider: provider.name,
          nextProviderAvailable: providers.some(
            (candidate) => candidate !== provider && isProviderAvailable(candidate),
          ),
          error: {
            message: routedError.message,
            code: routedError.code,
            provider: routedError.provider,
            rpcError: routedError.rpcError,
            status: routedError.status,
          },
        });
      }
      if (routedError.retryable && routedError.retryAfterMs > 0) {
        markProviderCooldown(provider, routedError.retryAfterMs);
      }
      if (!routedError.retryable) {
        throw routedError;
      }
    } finally {
      handle.cleanup();
    }
  }

  if (lastError == null && tokenLimited) {
    throw new ProviderRouterError({
      message: 'Client-side Solana RPC pacing is cooling down.',
      retryable: true,
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterMs: 1_000,
    });
  }

  throw (
    lastError ??
    new ProviderRouterError({
      message: 'No Solana RPC provider completed the request.',
      retryable: true,
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
    })
  );
}

/**
 * Send a batched JSON-RPC request: one HTTP round trip + one token
 * spend per provider, regardless of how many subrequests there are.
 * Solana RPC providers (Helius, Alchemy, Triton) all support standard
 * JSON-RPC batching per the spec.
 *
 * Returns an array aligned with `subrequests`. Each slot is either a
 * resolved result or `null` if that subrequest's RPC error wasn't
 * fatal — the caller decides what to do per-slot. A whole-batch
 * failure throws the same `ProviderRouterError` `rpcRequest` would.
 */
async function rpcBatchRequest<T>(
  network: OffpayNetwork,
  method: string,
  subrequests: ReadonlyArray<{ params: unknown[] }>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Array<T | null>> {
  if (subrequests.length === 0) return [];

  const configuredProviders = orderedConfiguredHttpProviders(network, method);
  if (configuredProviders.length === 0) throw unavailableProviderError(network);

  const providers = configuredProviders.filter(isProviderAvailable);
  if (providers.length === 0) {
    throw new ProviderRouterError({
      message: 'All configured Solana RPC providers are temporarily cooling down.',
      retryable: true,
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      retryAfterMs: 5_000,
    });
  }

  const group = groupForMethod(method);
  let lastError: ProviderRouterError | null = null;
  let tokenLimited = false;

  for (const provider of providers) {
    const handle = withTimeout(options.signal, options.timeoutMs ?? RPC_TIMEOUT_MS);
    try {
      // A batch call counts as a single token spend regardless of
      // size — providers bill it as one HTTP request.
      const hasToken = await acquireProviderToken(provider, group, handle.signal);
      if (!hasToken) {
        tokenLimited = true;
        continue;
      }

      const baseId = Date.now();
      const body = await stringifyJsonAdaptive(
        subrequests.map((entry, index) => ({
          jsonrpc: '2.0',
          id: `${provider.name}:${method}:${baseId}:${index}`,
          method,
          params: entry.params,
        })),
      );

      const response = await fetch(provider.httpUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: handle.signal,
      });

      if (response.status === 401 || response.status === 403) {
        markProviderDisabled(provider);
        throw new ProviderRouterError({
          message: `${provider.name} RPC credentials are rejected.`,
          retryable: true,
          status: response.status,
          code: 'UPSTREAM_UNAVAILABLE',
          provider: provider.name,
        });
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After')) || 10_000;
        markProviderCooldown(provider, retryAfterMs);
        throw new ProviderRouterError({
          message: `${provider.name} RPC is rate limited.`,
          retryable: true,
          status: 429,
          code: 'RATE_LIMITED',
          retryAfterMs,
          provider: provider.name,
        });
      }

      if (!response.ok) {
        const retryAfterMs = retryAfterForHttpStatus(
          response.status,
          response.headers.get('Retry-After'),
        );
        const retryable = RETRYABLE_HTTP_STATUSES.has(response.status) || response.status >= 500;
        if (retryable) markProviderCooldown(provider, retryAfterMs);
        throw new ProviderRouterError({
          message: `${provider.name} RPC failed with HTTP ${response.status}.`,
          retryable,
          status: response.status,
          code: retryable ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
          retryAfterMs,
          provider: provider.name,
        });
      }

      const payload = await parseRpcJsonResponse(response);
      if (!Array.isArray(payload)) {
        throw new ProviderRouterError({
          message: `${provider.name} RPC returned a non-batch response for a batch request.`,
          retryable: true,
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          provider: provider.name,
        });
      }

      // Subrequests can arrive out of order; route by id suffix.
      const results: Array<T | null> = new Array(subrequests.length).fill(null);
      for (const entry of payload) {
        if (!isRecord(entry)) continue;
        const id = typeof entry.id === 'string' ? entry.id : null;
        if (id == null) continue;
        const tail = id.split(':').pop();
        const index = tail != null ? Number.parseInt(tail, 10) : Number.NaN;
        if (!Number.isInteger(index) || index < 0 || index >= subrequests.length) continue;
        if (isJsonRpcFailure(entry)) {
          // Per-subrequest RPC error — surface as null so the
          // caller can decide whether to retry just that slot.
          continue;
        }
        if (isJsonRpcSuccess<T>(entry)) {
          results[index] = entry.result;
        }
      }
      return results;
    } catch (error) {
      if (options.signal?.aborted === true || isAbortLikeError(error)) {
        throw rpcAbortError(error);
      }
      const routedError = classifyFetchError(provider, error);
      lastError = routedError;
      if (routedError.retryable && routedError.retryAfterMs > 0) {
        markProviderCooldown(provider, routedError.retryAfterMs);
      }
      if (!routedError.retryable) throw routedError;
    } finally {
      handle.cleanup();
    }
  }

  if (lastError == null && tokenLimited) {
    throw new ProviderRouterError({
      message: 'Client-side Solana RPC pacing is cooling down.',
      retryable: true,
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterMs: 1_000,
    });
  }

  throw (
    lastError ??
    new ProviderRouterError({
      message: 'No Solana RPC provider completed the batch request.',
      retryable: true,
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
    })
  );
}

function mapAccountRecord(address: string, account: unknown): RpcAccountRecord | null {
  if (!isRecord(account)) return null;
  const data =
    Array.isArray(account.data) && typeof account.data[0] === 'string' ? account.data[0] : null;
  return {
    pubkey: address,
    address,
    data,
    dataBase64: data,
    owner: typeof account.owner === 'string' ? account.owner : null,
    lamports: typeof account.lamports === 'number' ? account.lamports : null,
    executable: typeof account.executable === 'boolean' ? account.executable : null,
    rentEpoch:
      typeof account.rentEpoch === 'number' || typeof account.rentEpoch === 'string'
        ? account.rentEpoch
        : null,
    space:
      typeof account.space === 'number' || typeof account.space === 'string' ? account.space : null,
  };
}

// Wrapped SOL on Solana shares the same mint as native SOL (the
// SOL "mint" is the System Program native account address by
// convention; SPL transfers wrap/unwrap into this same key). When
// surfacing native SOL transfers in transaction history we must
// return the *native* SOL identity (symbol "SOL", the standard
// solana-labs logo), not the Umbra `wSOL` entry that happens to
// share the mint. Otherwise every SOL transfer in history reads as
// "Sent 0.2 wSOL" and renders without a recognizable token icon.
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const NATIVE_SOL_METADATA = {
  name: 'Solana',
  symbol: 'SOL',
  logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  verified: true,
} as const;

function tokenMetadata(
  network: OffpayNetwork,
  mint: string,
): {
  name: string;
  symbol: string;
  logo: string | null;
  verified: boolean;
} {
  // Hot path: called once per SPL token account in `parseTokenAccounts`
  // and per-transaction in `buildEnrichmentFromTransaction`. The
  // underlying `getUmbraTokenByMint` and `getStablecoinSymbolForMint`
  // each invoke `isValidSolanaAddress` (a base58 decode) on the mint,
  // so an uncached call costs two base58 decodes plus two linear
  // scans. The result is a pure function of (network, mint) — caching
  // it removes the duplicate decodes from every refetch.
  const networkCache =
    tokenMetadataCache.get(network) ??
    (() => {
      const next = new Map<string, ReturnType<typeof computeTokenMetadata>>();
      tokenMetadataCache.set(network, next);
      return next;
    })();
  const cached = networkCache.get(mint);
  if (cached != null) return { ...cached };
  const computed = computeTokenMetadata(network, mint);
  networkCache.set(mint, computed);
  return { ...computed };
}

const tokenMetadataCache = new Map<
  OffpayNetwork,
  Map<string, { name: string; symbol: string; logo: string | null; verified: boolean }>
>();

function computeTokenMetadata(
  network: OffpayNetwork,
  mint: string,
): {
  name: string;
  symbol: string;
  logo: string | null;
  verified: boolean;
} {
  if (mint === NATIVE_SOL_MINT) {
    return { ...NATIVE_SOL_METADATA };
  }

  const umbra = getUmbraTokenByMint(network, mint);
  if (umbra != null) {
    return {
      name: umbra.name,
      symbol: umbra.aliases?.[0] ?? umbra.symbol,
      logo: umbra.logoUri ?? null,
      verified: true,
    };
  }

  const stablecoin = getStablecoinSymbolForMint(network, mint);
  if (stablecoin != null) {
    return {
      name: stablecoin === 'USDC' ? 'USD Coin' : 'Tether USD',
      symbol: stablecoin,
      logo: null,
      verified: true,
    };
  }

  // Unknown mint and we couldn't enrich it through DAS (this branch
  // only executes on the legacy fallback path when Helius DAS is
  // unavailable). Return the raw mint as the placeholder for both
  // name and symbol — the UI layer is responsible for any truncation.
  // Crucially we no longer fabricate a `4xxx...yyyy`-style symbol
  // here; producing a string that *looks* like a ticker but isn't
  // one polluted downstream price/swap lookups.
  return {
    name: mint,
    symbol: mint,
    logo: null,
    verified: false,
  };
}

async function parseTokenAccounts(
  network: OffpayNetwork,
  walletAddress: string,
  result: unknown,
): Promise<WalletBalanceResponse['tokens']> {
  if (!isRecord(result) || !Array.isArray(result.value)) return [];
  const value = result.value;

  // Refetches frequently return the same shape (no on-chain change
  // between polls). Computing a cheap structural fingerprint and
  // skipping the parse when the response matches the last one for
  // this (network, walletAddress) saves the synchronous walk through
  // every token account on every Home refresh — the largest chunk of
  // post-fetch JS work for wallets with many SPL accounts.
  const fingerprint = computeTokenAccountsFingerprint(value);
  const cacheKey = `${network}:${walletAddress}`;
  const cached = parsedTokenAccountsCache.get(cacheKey);
  if (cached != null && cached.fingerprint === fingerprint) {
    return cached.tokens;
  }

  const tokens: WalletBalanceResponse['tokens'] = [];
  let budgetStartedAt = Date.now();

  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.account) || !isRecord(entry.account.data)) {
      budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
      continue;
    }
    const parsed = isRecord(entry.account.data.parsed) ? entry.account.data.parsed : null;
    const info = parsed && isRecord(parsed.info) ? parsed.info : null;
    const tokenAmount = info && isRecord(info.tokenAmount) ? info.tokenAmount : null;
    const mint = typeof info?.mint === 'string' ? info.mint : null;
    const amount = typeof tokenAmount?.amount === 'string' ? tokenAmount.amount : null;
    const uiAmountString =
      typeof tokenAmount?.uiAmountString === 'string' ? tokenAmount.uiAmountString : null;
    const decimals = typeof tokenAmount?.decimals === 'number' ? tokenAmount.decimals : null;
    if (mint == null || amount == null || decimals == null || amount === '0') {
      budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
      continue;
    }

    const metadata = tokenMetadata(network, mint);
    tokens.push({
      mint,
      name: metadata.name,
      symbol: metadata.symbol,
      logo: metadata.logo,
      balance: uiAmountString ?? amount,
      decimals,
      verified: metadata.verified,
      // A token account that the user actually holds with a non-zero
      // balance is not spam by default. The previous logic flagged
      // every mint outside the small built-in allowlist (USDC, USDT,
      // wSOL, UMBRA) as spam, which incorrectly hid every legitimate
      // SPL token (BONK, JUP, JTO, WIF, …). `verified` still indicates
      // whether we have curated metadata for the mint; `spam` is now
      // reserved for an explicit denylist signal that we don't yet
      // populate from this code path.
      spam: false,
    });
    budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
  }

  parsedTokenAccountsCache.set(cacheKey, { fingerprint, tokens });
  return tokens;
}

const parsedTokenAccountsCache = new Map<
  string,
  { fingerprint: string; tokens: WalletBalanceResponse['tokens'] }
>();

/**
 * Cheap structural fingerprint over the raw token-accounts response.
 * Combines entry count plus mint+amount of every entry. The total
 * cost is one pass over the array (string concatenation, no parse,
 * no metadata lookup). Two refetches with the same on-chain state
 * produce identical fingerprints; any balance change shifts the
 * fingerprint and triggers a fresh parse.
 */
function computeTokenAccountsFingerprint(value: readonly unknown[]): string {
  const parts: string[] = [String(value.length)];
  for (const entry of value) {
    if (!isRecord(entry)) {
      parts.push('-');
      continue;
    }
    const account = isRecord(entry.account) ? entry.account : null;
    const data = account != null && isRecord(account.data) ? account.data : null;
    const parsed = data != null && isRecord(data.parsed) ? data.parsed : null;
    const info = parsed != null && isRecord(parsed.info) ? parsed.info : null;
    const tokenAmount = info != null && isRecord(info.tokenAmount) ? info.tokenAmount : null;
    const mint = typeof info?.mint === 'string' ? info.mint : '';
    const amount = typeof tokenAmount?.amount === 'string' ? tokenAmount.amount : '';
    parts.push(`${mint}:${amount}`);
  }
  return parts.join('|');
}

export function getConfiguredRpcProviders(network: OffpayNetwork): RpcProvider[] {
  return buildProviders(network);
}

export function hasConfiguredHttpProvider(network: OffpayNetwork): boolean {
  return buildProviders(network).some((provider) => provider.httpUrl != null);
}

export function getPrimaryRpcEndpoint(network: OffpayNetwork): string | null {
  return orderedConfiguredHttpProviders(network, 'getSlot')[0]?.httpUrl ?? null;
}

export function getAvailableRpcEndpoint(network: OffpayNetwork): string | null {
  return (
    orderedConfiguredHttpProviders(network, 'getSlot')
      .filter(isProviderAvailable)
      .sort((left, right) => left.priority.http - right.priority.http)[0]?.httpUrl ?? null
  );
}

export function getPrimaryWsEndpoint(network: OffpayNetwork): string | null {
  return (
    buildProviders(network)
      .filter((provider) => provider.wsUrl != null && isProviderAvailable(provider))
      .sort((left, right) => left.priority.ws - right.priority.ws)[0]?.wsUrl ?? null
  );
}

export function getConfiguredWsEndpoints(network: OffpayNetwork): Array<{
  provider: ProviderName;
  url: string;
}> {
  return buildProviders(network)
    .filter(
      (provider): provider is RpcProvider & { wsUrl: string } =>
        provider.wsUrl != null && isProviderAvailable(provider),
    )
    .sort((left, right) => left.priority.ws - right.priority.ws)
    .map((provider) => ({
      provider: provider.name,
      url: provider.wsUrl,
    }));
}

export function hasConfiguredWsProvider(network: OffpayNetwork): boolean {
  return getPrimaryWsEndpoint(network) != null;
}

export async function getRpcLatestBlockhash(
  network: OffpayNetwork,
): Promise<RpcLatestBlockhashResponse> {
  const result = await rpcRequest<{ value?: RpcLatestBlockhashResponse }>(
    network,
    'getLatestBlockhash',
    [{ commitment: 'confirmed' }],
  );
  if (!result.value?.blockhash || typeof result.value.lastValidBlockHeight !== 'number') {
    throw new Error('Latest blockhash response is invalid.');
  }
  return result.value;
}

export async function getRpcFeeForMessage(params: {
  network: OffpayNetwork;
  /** Base64-encoded compiled message (Message.serialize() output). */
  messageBase64: string;
  signal?: AbortSignal;
}): Promise<{ lamports: number | null }> {
  const result = await rpcRequest<{ value?: number | null }>(
    params.network,
    'getFeeForMessage',
    [params.messageBase64, { commitment: 'confirmed' }],
    { signal: params.signal },
  );
  const value = typeof result?.value === 'number' ? result.value : null;
  return { lamports: value };
}

export async function getRpcAccounts(params: {
  addresses: string[];
  network: OffpayNetwork;
}): Promise<RpcAccountsResponse> {
  const result = await rpcRequest<{ value?: unknown[] }>(params.network, 'getMultipleAccounts', [
    params.addresses,
    { encoding: 'base64', commitment: 'confirmed' },
  ]);
  const values = Array.isArray(result.value) ? result.value : [];
  return {
    network: params.network,
    accounts: params.addresses.map((address, index) => mapAccountRecord(address, values[index])),
  };
}

export async function getRpcTokenLargestAccounts(params: {
  mint: string;
  network: OffpayNetwork;
}): Promise<RpcTokenLargestAccountsResponse> {
  const result = await rpcRequest<{ value?: unknown[] }>(
    params.network,
    'getTokenLargestAccounts',
    [params.mint, { commitment: 'confirmed' }],
  );
  const accounts = (Array.isArray(result.value) ? result.value : []).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.address !== 'string' || typeof entry.amount !== 'string') {
      return [];
    }
    return [
      {
        address: entry.address,
        amount: entry.amount,
        decimals: typeof entry.decimals === 'number' ? entry.decimals : 0,
        uiAmount: typeof entry.uiAmount === 'number' ? entry.uiAmount : null,
        uiAmountString: typeof entry.uiAmountString === 'string' ? entry.uiAmountString : null,
      },
    ];
  });
  return { network: params.network, mint: params.mint, accounts, fetchedAt: Date.now() };
}

export async function getRpcEpochInfo(network: OffpayNetwork): Promise<RpcEpochInfoResponse> {
  const result = await rpcRequest<Record<string, unknown>>(network, 'getEpochInfo', [
    { commitment: 'confirmed' },
  ]);
  return {
    epoch: typeof result.epoch === 'number' ? result.epoch : 0,
    slotIndex: typeof result.slotIndex === 'number' ? result.slotIndex : 0,
    slotsInEpoch: typeof result.slotsInEpoch === 'number' ? result.slotsInEpoch : 0,
  };
}

export async function getRpcSlot(network: OffpayNetwork): Promise<RpcSlotResponse> {
  const slot = await rpcRequest<number>(network, 'getSlot', [{ commitment: 'confirmed' }]);
  return { slot };
}

export async function getMinimumBalanceForRentExemption(params: {
  network: OffpayNetwork;
  space: number;
}): Promise<string> {
  const lamports = await rpcRequest<number>(params.network, 'getMinimumBalanceForRentExemption', [
    params.space,
    { commitment: 'confirmed' },
  ]);
  return Math.trunc(lamports).toString();
}

export async function getWalletLamports(params: {
  address: string;
  network: OffpayNetwork;
}): Promise<string> {
  const result = await rpcRequest<{ value?: number }>(params.network, 'getBalance', [
    params.address,
    { commitment: 'confirmed' },
  ]);
  return Math.trunc(result.value ?? 0).toString();
}

export async function getRpcSignatureStatuses(params: {
  signatures: string[];
  network: OffpayNetwork;
}): Promise<RpcSignatureStatusesResponse> {
  const result = await rpcRequest<{ value?: unknown[] }>(params.network, 'getSignatureStatuses', [
    params.signatures,
    { searchTransactionHistory: true },
  ]);
  const values = Array.isArray(result.value) ? result.value : [];
  return {
    statuses: params.signatures.map((_, index) => {
      const entry = values[index];
      if (!isRecord(entry)) return null;
      const confirmationStatus =
        entry.confirmationStatus === 'processed' ||
        entry.confirmationStatus === 'confirmed' ||
        entry.confirmationStatus === 'finalized'
          ? entry.confirmationStatus
          : null;
      return {
        slot: typeof entry.slot === 'number' ? entry.slot : null,
        confirmations: typeof entry.confirmations === 'number' ? entry.confirmations : null,
        err: entry.err == null ? null : jsonValue(entry.err),
        confirmationStatus,
      };
    }),
  };
}

export async function getRpcSignaturesForAddress(params: {
  address: string;
  limit?: number;
  before?: string;
  network: OffpayNetwork;
}): Promise<RpcSignaturesForAddressResponse> {
  const config: Record<string, unknown> = {
    limit: Math.min(Math.max(params.limit ?? 25, 1), 100),
    commitment: 'confirmed',
  };
  if (params.before != null) config.before = params.before;
  const result = await rpcRequest<unknown[]>(params.network, 'getSignaturesForAddress', [
    params.address,
    config,
  ]);
  return {
    signatures: result.flatMap((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.signature !== 'string' ||
        typeof entry.slot !== 'number'
      ) {
        return [];
      }
      const confirmationStatus =
        entry.confirmationStatus === 'processed' ||
        entry.confirmationStatus === 'confirmed' ||
        entry.confirmationStatus === 'finalized'
          ? entry.confirmationStatus
          : null;
      return [
        {
          signature: entry.signature,
          slot: entry.slot,
          blockTime: typeof entry.blockTime === 'number' ? entry.blockTime : null,
          err: entry.err == null ? null : jsonValue(entry.err),
          confirmationStatus,
        },
      ];
    }),
  };
}

export async function broadcastRawTransaction(params: {
  rawTransaction: string;
  network: OffpayNetwork;
  skipPreflight?: boolean;
  maxRetries?: number;
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
}): Promise<RpcBroadcastResponse> {
  const primarySignature = rawTransactionPrimarySignature(params.rawTransaction);
  const transactionDebug = __DEV__ ? summarizeRawTransactionForLog(params.rawTransaction) : null;
  let writeProvider: ProviderName | null = null;
  try {
    const signature = await rpcRequest<string>(
      params.network,
      'sendTransaction',
      [
        params.rawTransaction,
        {
          encoding: 'base64',
          skipPreflight: params.skipPreflight ?? false,
          maxRetries: params.maxRetries ?? 3,
          preflightCommitment: params.preflightCommitment ?? 'confirmed',
        },
      ],
      {
        timeoutMs: 20_000,
        onProviderSuccess: (provider) => {
          writeProvider = provider.name;
        },
      },
    );
    if (__DEV__) {
      console.log('[provider-router] sendTransaction submitted', {
        network: params.network,
        provider: writeProvider,
        primarySignature,
        signature,
      });
    }
    return { signature };
  } catch (error) {
    if (__DEV__) {
      const rpcDebug =
        error instanceof ProviderRouterError ? summarizeRpcErrorForLog(error.rpcError) : null;
      console.warn('[provider-router] sendTransaction rejected', {
        network: params.network,
        primarySignature,
        rpcInstructionError: rpcDebug?.instructionError ?? null,
        rpcLogs: rpcDebug?.logs ?? null,
        transactionInstructions: transactionDebug?.instructions ?? null,
        transactionVersion: transactionDebug?.version ?? null,
        error:
          error instanceof ProviderRouterError
            ? {
                message: error.message,
                code: error.code,
                provider: error.provider,
                retryable: error.retryable,
                rpcError: error.rpcError,
                status: error.status,
              }
            : error instanceof Error
              ? { message: error.message, name: error.name }
              : error,
      });
    }
    throw error;
  }
}

export interface WalletStreamableTokenAccount {
  /** Token account (ATA) public key. This is what `accountSubscribe` watches. */
  pubkey: string;
  /** Mint address of the token held in the account. */
  mint: string;
  /** Decimals reported by the token amount. */
  decimals: number;
  /** Current raw (atomic) balance string at discovery time. Used as the diff baseline. */
  rawAmount: string;
  /** Resolved display symbol (or short mint), to enrich notification payloads. */
  symbol: string;
  /** Whether the mint is in the verified token list. */
  verified: boolean;
}

export interface WalletStreamableSnapshot {
  walletAddress: string;
  /** Lamports balance at discovery time, used as the baseline for SOL diffs. */
  baseLamports: number;
  tokenAccounts: WalletStreamableTokenAccount[];
}

/**
 * Snapshot the wallet's base SOL balance and SPL token accounts in a
 * shape that the WS activity stream can use to:
 *
 * 1. Open `accountSubscribe` for each account (base wallet + every ATA).
 * 2. Seed a per-account baseline so subsequent notifications can be
 *    diffed into a direction (`receive` / `send`) and an amount.
 *
 * The shape is deliberately minimal — `parseTokenAccounts` builds a
 * richer view for the `getWalletBalance` response, but the stream
 * does not need logos / spam flags / UI amounts. Splitting these
 * keeps the stream startup fast and avoids pulling token-list
 * metadata work onto the WS warm path.
 */
export async function getWalletStreamableAccounts(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { signal?: AbortSignal },
): Promise<WalletStreamableSnapshot> {
  const [lamports, tokenAccounts] = await Promise.all([
    rpcRequest<{ value?: number }>(
      network,
      'getBalance',
      [walletAddress, { commitment: 'confirmed' }],
      { signal: options?.signal },
    ),
    rpcRequest<unknown>(
      network,
      'getTokenAccountsByOwner',
      [
        walletAddress,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
      { signal: options?.signal },
    ),
  ]);

  const accounts: WalletStreamableTokenAccount[] = [];
  if (isRecord(tokenAccounts) && Array.isArray(tokenAccounts.value)) {
    for (const entry of tokenAccounts.value) {
      if (!isRecord(entry)) continue;
      const pubkey = typeof entry.pubkey === 'string' ? entry.pubkey : null;
      const account = isRecord(entry.account) ? entry.account : null;
      const data = account && isRecord(account.data) ? account.data : null;
      const parsed = data && isRecord(data.parsed) ? data.parsed : null;
      const info = parsed && isRecord(parsed.info) ? parsed.info : null;
      const tokenAmount = info && isRecord(info.tokenAmount) ? info.tokenAmount : null;
      const mint = typeof info?.mint === 'string' ? info.mint : null;
      const amount = typeof tokenAmount?.amount === 'string' ? tokenAmount.amount : null;
      const decimals = typeof tokenAmount?.decimals === 'number' ? tokenAmount.decimals : null;
      if (pubkey == null || mint == null || decimals == null || amount == null) continue;

      const metadata = tokenMetadata(network, mint);
      accounts.push({
        pubkey,
        mint,
        decimals,
        rawAmount: amount,
        symbol: metadata.symbol,
        verified: metadata.verified,
      });
    }
  }

  return {
    walletAddress,
    baseLamports: lamports.value ?? 0,
    tokenAccounts: accounts,
  };
}

export async function getWalletMintRawBalance(params: {
  address: string;
  mint: string;
  network: OffpayNetwork;
}): Promise<string> {
  const result = await rpcRequest<{ value?: unknown[] }>(
    params.network,
    'getTokenAccountsByOwner',
    [params.address, { mint: params.mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  );
  const accounts = Array.isArray(result.value) ? result.value : [];
  let total = 0n;
  for (const entry of accounts) {
    if (!isRecord(entry) || !isRecord(entry.account) || !isRecord(entry.account.data)) continue;
    const parsed = isRecord(entry.account.data.parsed) ? entry.account.data.parsed : null;
    const info = parsed && isRecord(parsed.info) ? parsed.info : null;
    const tokenAmount = info && isRecord(info.tokenAmount) ? info.tokenAmount : null;
    const amount = typeof tokenAmount?.amount === 'string' ? tokenAmount.amount : null;
    if (amount != null && /^\d+$/.test(amount)) total += BigInt(amount);
  }
  return total.toString();
}

export async function getWalletBalance(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { signal?: AbortSignal },
): Promise<WalletBalanceResponse> {
  // Prefer the Helius DAS `getAssetsByOwner` path. It returns on-
  // chain Metaplex metadata (name, symbol, image) alongside balances
  // and the native SOL balance in a single round trip — so we get
  // real token names/logos for every fungible asset the wallet
  // holds, not just the four tokens that used to be hardcoded in
  // the old allowlist. If DAS is unavailable (no Helius endpoint
  // configured, or the call errors out) we fall back to the legacy
  // `getBalance` + `getTokenAccountsByOwner` path below.
  if (heliusHttpUrlForNetwork(network) != null) {
    try {
      const dasResponse = await fetchWalletAssetsViaDas(walletAddress, network, options?.signal);
      if (dasResponse != null) {
        return dasResponse;
      }
    } catch (error) {
      if (options?.signal?.aborted === true || isAbortLikeError(error)) {
        throw rpcAbortError(error);
      }
      if (__DEV__) {
        console.log('[provider-router] DAS getAssetsByOwner failed; falling back to RPC', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const [lamports, tokenAccounts] = await Promise.all([
    rpcRequest<{ value?: number }>(
      network,
      'getBalance',
      [walletAddress, { commitment: 'confirmed' }],
      {
        signal: options?.signal,
      },
    ),
    rpcRequest<unknown>(
      network,
      'getTokenAccountsByOwner',
      [
        walletAddress,
        { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
      { signal: options?.signal },
    ),
  ]);

  return {
    address: walletAddress,
    network,
    solBalance: lamports.value ?? 0,
    tokens: await parseTokenAccounts(network, walletAddress, tokenAccounts),
    fetchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Helius DAS — `getAssetsByOwner` for real on-chain token metadata
// ---------------------------------------------------------------------------

const DAS_PAGE_LIMIT = 1000;
const DAS_MAX_PAGES = 5;

function heliusHttpUrlForNetwork(network: OffpayNetwork): string | null {
  const provider = buildProviders(network).find((entry) => entry.name === 'helius');
  return provider?.httpUrl ?? null;
}

interface DasContentLink {
  image?: unknown;
}

interface DasContentFile {
  uri?: unknown;
  cdn_uri?: unknown;
  mime?: unknown;
}

interface DasContent {
  metadata?: { name?: unknown; symbol?: unknown };
  links?: DasContentLink;
  files?: DasContentFile[];
}

interface DasTokenInfo {
  balance?: unknown;
  decimals?: unknown;
  symbol?: unknown;
  price_info?: { price_per_token?: unknown; total_price?: unknown };
}

interface DasAsset {
  id?: unknown;
  interface?: unknown;
  content?: DasContent;
  token_info?: DasTokenInfo;
}

interface DasNativeBalance {
  lamports?: unknown;
  price_per_sol?: unknown;
  total_price?: unknown;
}

interface DasResult {
  items?: DasAsset[];
  nativeBalance?: DasNativeBalance;
}

interface DasResponseEnvelope {
  result?: DasResult;
  error?: { message?: string };
}

function readDasString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readDasNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readDasAtomicAmount(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value.toString();
}

function readDasPositiveNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : null;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function pickDasLogo(content: DasContent | undefined): string | null {
  const direct = readDasString(content?.links?.image);
  if (direct != null) return direct;
  const files = Array.isArray(content?.files) ? content.files : [];
  for (const file of files) {
    const cdn = readDasString(file?.cdn_uri);
    if (cdn != null) return cdn;
    const uri = readDasString(file?.uri);
    if (uri != null) return uri;
  }
  return null;
}

function isFungibleDasInterface(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // DAS "interface" enum values for fungible tokens. We exclude NFTs
  // (`V1_NFT`, `ProgrammableNFT`, `Custom`, etc.) so the wallet
  // surface stays focused on tokens with balances.
  return value === 'FungibleToken' || value === 'FungibleAsset';
}

function dasAssetToBalanceToken(asset: DasAsset): WalletBalanceResponse['tokens'][number] | null {
  const mint = readDasString(asset.id);
  const tokenInfo = asset.token_info ?? null;
  const balance = readDasAtomicAmount(tokenInfo?.balance);
  const decimals = readDasNumber(tokenInfo?.decimals);
  if (mint == null || balance == null || decimals == null) return null;
  if (balance === '0') return null;

  const metadata = asset.content?.metadata ?? null;
  const onChainName = readDasString(metadata?.name);
  const onChainSymbol = readDasString(metadata?.symbol) ?? readDasString(tokenInfo?.symbol);
  const logo = pickDasLogo(asset.content);
  const usdPrice = readDasPositiveNumber(tokenInfo?.price_info?.price_per_token);

  // Format the balance into the same UI string shape the legacy path
  // produces so downstream consumers don't have to branch on source.
  const uiBalance = decimals > 0 ? formatAtomicTokenAmountForBalance(balance, decimals) : balance;

  return {
    mint,
    name: onChainName ?? mint,
    symbol: onChainSymbol ?? mint,
    logo,
    balance: uiBalance,
    decimals,
    usdPrice,
    verified: onChainName != null && onChainSymbol != null,
    spam: false,
  };
}

function formatAtomicTokenAmountForBalance(rawAmount: string, decimals: number): string {
  if (decimals <= 0) return rawAmount;
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(rawAmount);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = absolute % scale;
  if (fraction === 0n) return `${negative ? '-' : ''}${whole.toString()}`;
  const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fractionString.length > 0 ? `.${fractionString}` : ''}`;
}

async function fetchWalletAssetsViaDas(
  walletAddress: string,
  network: OffpayNetwork,
  signal?: AbortSignal,
): Promise<WalletBalanceResponse | null> {
  const heliusUrl = heliusHttpUrlForNetwork(network);
  if (heliusUrl == null) return null;

  const tokens: WalletBalanceResponse['tokens'] = [];
  let nativeLamports = 0;
  let nativeSolUsdPrice: number | null = null;
  let page = 1;

  while (page <= DAS_MAX_PAGES) {
    const handle = withTimeout(signal, RPC_TIMEOUT_MS);
    let payload: DasResponseEnvelope;
    try {
      const body = await stringifyJsonAdaptive({
        jsonrpc: '2.0',
        id: `helius:getAssetsByOwner:${page}:${Date.now()}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: walletAddress,
          page,
          limit: DAS_PAGE_LIMIT,
          displayOptions: {
            showFungible: true,
            // Only include native SOL on the first page; subsequent
            // pages of token-only data don't need it.
            showNativeBalance: page === 1,
          },
        },
      });
      const response = await fetch(heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: handle.signal,
      });
      if (!response.ok) {
        // Helius returns 404/4xx for unsupported networks (e.g. some
        // devnet keys); treat that as "DAS unavailable, use fallback".
        return null;
      }
      const parsed = await readJsonResponseAdaptive(response);
      if (!isRecord(parsed)) return null;
      payload = parsed as DasResponseEnvelope;
    } finally {
      handle.cleanup();
    }

    if (payload.error != null) {
      throw new Error(payload.error.message ?? 'DAS getAssetsByOwner failed.');
    }

    const result: DasResult | undefined = payload.result;
    if (result == null || typeof result !== 'object') return null;
    // DAS responses always include a top-level `items` array (even
    // when empty). If the field isn't present at all, the upstream
    // is almost certainly not a DAS-aware endpoint — fall back to
    // the legacy `getBalance` + `getTokenAccountsByOwner` path so a
    // misconfigured RPC URL doesn't strand the wallet on an empty
    // home screen.
    if (!Array.isArray(result.items) && page === 1) return null;
    if (page === 1) {
      const lamports = readDasNumber(result.nativeBalance?.lamports);
      if (lamports != null) nativeLamports = lamports;
      nativeSolUsdPrice = readDasPositiveNumber(result.nativeBalance?.price_per_sol);
    }

    const items = Array.isArray(result.items) ? result.items : [];
    let budgetStartedAt = Date.now();
    for (const asset of items) {
      if (!isRecord(asset)) continue;
      if (!isFungibleDasInterface(asset.interface)) continue;
      const token = dasAssetToBalanceToken(asset as DasAsset);
      if (token != null) tokens.push(token);
      budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
    }

    // DAS pagination: stop when the page returns fewer than the
    // requested limit (i.e., last page).
    if (items.length < DAS_PAGE_LIMIT) break;
    page += 1;
  }

  return {
    address: walletAddress,
    network,
    solBalance: nativeLamports,
    nativeSolUsdPrice,
    tokens,
    fetchedAt: Date.now(),
  };
}

interface TransactionEnrichment {
  type: string;
  description: string | null;
  amount: string | null;
  rawAmount: string | null;
  tokenMint: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenLogo: string | null;
  tokenDecimals: number | null;
  fee: number;
  direction: 'send' | 'receive' | null;
  sender: string | null;
  recipient: string | null;
  counterparties: Array<{ address: string; role: string }>;
}

interface ParsedTokenBalance {
  accountIndex: number;
  owner: string | null;
  mint: string;
  amount: string;
  decimals: number;
  uiAmountString: string | null;
}

function readParsedTokenBalances(value: unknown): ParsedTokenBalance[] {
  if (!Array.isArray(value)) return [];
  const balances: ParsedTokenBalance[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const accountIndex = typeof entry.accountIndex === 'number' ? entry.accountIndex : null;
    const owner = typeof entry.owner === 'string' ? entry.owner : null;
    const mint = typeof entry.mint === 'string' ? entry.mint : null;
    const tokenAmount = isRecord(entry.uiTokenAmount) ? entry.uiTokenAmount : null;
    const amount = typeof tokenAmount?.amount === 'string' ? tokenAmount.amount : null;
    const decimals = typeof tokenAmount?.decimals === 'number' ? tokenAmount.decimals : null;
    const uiAmountString =
      typeof tokenAmount?.uiAmountString === 'string' ? tokenAmount.uiAmountString : null;
    if (accountIndex == null || mint == null || amount == null || decimals == null) {
      continue;
    }
    balances.push({
      accountIndex,
      owner,
      mint,
      amount,
      decimals,
      uiAmountString,
    });
  }
  return balances;
}

function readAccountKeys(message: Record<string, unknown> | null): string[] {
  if (message == null) return [];
  const keys = message.accountKeys;
  if (!Array.isArray(keys)) return [];
  return keys.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (isRecord(entry) && typeof entry.pubkey === 'string') return [entry.pubkey];
    return [];
  });
}

function formatAtomicTokenAmount(rawAmount: bigint, decimals: number): string {
  const negative = rawAmount < 0n;
  const absolute = negative ? -rawAmount : rawAmount;
  if (decimals <= 0) return `${negative ? '-' : ''}${absolute.toString()}`;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = absolute % scale;
  if (fraction === 0n) return `${negative ? '-' : ''}${whole.toString()}`;
  const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fractionString.length > 0 ? `.${fractionString}` : ''}`;
}

function formatAtomicSolAmount(lamports: bigint): string {
  return formatAtomicTokenAmount(lamports, 9);
}

// Helius-style descriptions only stay legible when the symbol is a real
// token ticker (alphanumeric, no dots). For unknown / abbreviated mints
// we hide the description and rely on the `amount` + `tokenSymbol`
// fields the frontend's parser uses as a fallback.
function isCleanTokenSymbol(symbol: string | null | undefined): boolean {
  if (symbol == null) return false;
  return /^[A-Za-z][A-Za-z0-9]{1,15}$/.test(symbol);
}

// Strip non-alphanumeric characters so an abbreviated mint like
// `4zMM...ncDU` reduces to `4zMMncDU` for embedding in a description
// without breaking the frontend's amount+symbol regex. Only used for
// swap descriptions where we need both sides to render together.
function sanitizeSymbolForDescription(symbol: string): string | null {
  const cleaned = symbol.replace(/[^A-Za-z0-9]/g, '');
  if (cleaned.length === 0) return null;
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned;
}

function buildTransferDescription(
  direction: 'send' | 'receive',
  uiAmount: string,
  symbol: string,
  counterpartyShort: string | null,
): string | null {
  if (!isCleanTokenSymbol(symbol)) return null;
  if (direction === 'receive') {
    return counterpartyShort != null
      ? `Received ${uiAmount} ${symbol} from ${counterpartyShort}`
      : `Received ${uiAmount} ${symbol}`;
  }
  return counterpartyShort != null
    ? `Sent ${uiAmount} ${symbol} to ${counterpartyShort}`
    : `Sent ${uiAmount} ${symbol}`;
}

function buildSwapDescription(
  inputAmount: string,
  inputSymbol: string,
  outputAmount: string,
  outputSymbol: string,
): string | null {
  const safeInput = isCleanTokenSymbol(inputSymbol)
    ? inputSymbol
    : sanitizeSymbolForDescription(inputSymbol);
  const safeOutput = isCleanTokenSymbol(outputSymbol)
    ? outputSymbol
    : sanitizeSymbolForDescription(outputSymbol);
  if (safeInput == null || safeOutput == null) return null;
  return `Swapped ${inputAmount} ${safeInput} to ${outputAmount} ${safeOutput}`;
}

function readParsedInstructions(raw: unknown): Record<string, unknown>[] {
  if (!isRecord(raw)) return [];
  const meta = isRecord(raw.meta) ? raw.meta : null;
  const transaction = isRecord(raw.transaction) ? raw.transaction : null;
  const message = transaction != null && isRecord(transaction.message) ? transaction.message : null;
  const instructions = Array.isArray(message?.instructions)
    ? message.instructions.filter(isRecord)
    : [];
  const innerInstructions = Array.isArray(meta?.innerInstructions)
    ? meta.innerInstructions.flatMap((group) => {
        if (!isRecord(group) || !Array.isArray(group.instructions)) return [];
        return group.instructions.filter(isRecord);
      })
    : [];

  return [...instructions, ...innerInstructions];
}

function buildParsedInstructionEnrichment(params: {
  network: OffpayNetwork;
  walletAddress: string;
  fallback: TransactionEnrichment;
  fee: number;
  raw: unknown;
}): TransactionEnrichment | null {
  const instructions = readParsedInstructions(params.raw);
  for (const instruction of instructions) {
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const type = typeof parsed?.type === 'string' ? parsed.type : null;
    const info = parsed != null && isRecord(parsed.info) ? parsed.info : null;
    if (type == null || info == null) continue;

    if (type === 'transfer' && typeof info.lamports === 'number') {
      const source = typeof info.source === 'string' ? info.source : null;
      const destination = typeof info.destination === 'string' ? info.destination : null;
      if (source !== params.walletAddress && destination !== params.walletAddress) continue;

      const lamports = Math.max(0, Math.trunc(info.lamports));
      if (lamports <= 0) continue;
      const direction: 'send' | 'receive' =
        destination === params.walletAddress && source !== params.walletAddress
          ? 'receive'
          : 'send';
      const counterpartyAddress = direction === 'receive' ? source : destination;
      const metadata = tokenMetadata(params.network, NATIVE_SOL_MINT);
      const amount = formatAtomicSolAmount(BigInt(lamports));
      const isSelfTransfer = source === destination && source === params.walletAddress;
      return {
        ...params.fallback,
        type: 'TRANSFER',
        fee: params.fee,
        description: isSelfTransfer
          ? 'Self-transfer'
          : buildTransferDescription(
              direction,
              amount,
              metadata.symbol,
              counterpartyAddress != null
                ? `${counterpartyAddress.slice(0, 4)}...${counterpartyAddress.slice(-4)}`
                : null,
            ),
        amount,
        rawAmount: String(lamports),
        tokenMint: NATIVE_SOL_MINT,
        tokenSymbol: metadata.symbol,
        tokenName: metadata.name,
        tokenLogo: metadata.logo,
        tokenDecimals: 9,
        direction,
        sender: source,
        recipient: destination,
        counterparties:
          counterpartyAddress != null
            ? [
                {
                  address: counterpartyAddress,
                  role: direction === 'receive' ? 'sender' : 'recipient',
                },
              ]
            : [],
      };
    }

    if (type !== 'transfer' && type !== 'transferChecked') continue;

    const authority = typeof info.authority === 'string' ? info.authority : null;
    const source = typeof info.source === 'string' ? info.source : null;
    const destination = typeof info.destination === 'string' ? info.destination : null;
    const mint = typeof info.mint === 'string' ? info.mint : null;
    const tokenAmount = isRecord(info.tokenAmount) ? info.tokenAmount : null;
    const rawAmount =
      typeof tokenAmount?.amount === 'string'
        ? tokenAmount.amount
        : typeof info.amount === 'string'
          ? info.amount
          : null;
    const decimals = typeof tokenAmount?.decimals === 'number' ? tokenAmount.decimals : null;
    if (
      authority !== params.walletAddress ||
      mint == null ||
      rawAmount == null ||
      decimals == null
    ) {
      continue;
    }

    const metadata = tokenMetadata(params.network, mint);
    const amount =
      typeof tokenAmount?.uiAmountString === 'string'
        ? tokenAmount.uiAmountString
        : formatAtomicTokenAmount(BigInt(rawAmount), decimals);
    return {
      ...params.fallback,
      type: 'TRANSFER',
      fee: params.fee,
      description:
        source === destination
          ? 'Self-transfer'
          : buildTransferDescription(
              'send',
              amount,
              metadata.symbol,
              destination != null ? `${destination.slice(0, 4)}...${destination.slice(-4)}` : null,
            ),
      amount,
      rawAmount,
      tokenMint: mint,
      tokenSymbol: metadata.symbol,
      tokenName: metadata.name,
      tokenLogo: metadata.logo,
      tokenDecimals: decimals,
      direction: 'send',
      sender: params.walletAddress,
      recipient: destination,
      counterparties:
        destination != null
          ? [
              {
                address: destination,
                role: 'recipient',
              },
            ]
          : [],
    };
  }

  return null;
}

async function buildEnrichmentFromTransaction(
  network: OffpayNetwork,
  walletAddress: string,
  raw: unknown,
): Promise<TransactionEnrichment> {
  const fallback: TransactionEnrichment = {
    type: 'unknown',
    description: null,
    amount: null,
    rawAmount: null,
    tokenMint: null,
    tokenSymbol: null,
    tokenName: null,
    tokenLogo: null,
    tokenDecimals: null,
    fee: 0,
    direction: null,
    sender: null,
    recipient: null,
    counterparties: [],
  };

  if (!isRecord(raw)) return fallback;
  await yieldToUi();
  const meta = isRecord(raw.meta) ? raw.meta : null;
  const transaction = isRecord(raw.transaction) ? raw.transaction : null;
  const message = transaction != null && isRecord(transaction.message) ? transaction.message : null;
  const accountKeys = readAccountKeys(message);
  const fee = typeof meta?.fee === 'number' ? meta.fee : 0;
  const preTokenBalances = readParsedTokenBalances(meta?.preTokenBalances);
  const postTokenBalances = readParsedTokenBalances(meta?.postTokenBalances);
  const preBalances = Array.isArray(meta?.preBalances) ? (meta.preBalances as unknown[]) : [];
  const postBalances = Array.isArray(meta?.postBalances) ? (meta.postBalances as unknown[]) : [];

  // Index parsed balances by (mint, owner) so we can compute deltas robustly
  // even when an SPL token account is closed or freshly created mid-tx.
  // Nested map (`mint -> owner -> slot`) avoids the
  // `${mint}::${owner ?? ''}` template-string allocation per token
  // balance, which adds up across history pages with many transfers.
  // `OWNER_NULL_KEY` stands in for the `null`-owner case so the inner
  // map can keep a uniform string key.
  interface BalanceSlot {
    mint: string;
    owner: string | null;
    decimals: number;
    pre: bigint;
    post: bigint;
  }
  const OWNER_NULL_KEY = '\u0000';
  const balanceMap = new Map<string, Map<string, BalanceSlot>>();
  const upsertBalanceSlot = (mint: string, owner: string | null, decimals: number): BalanceSlot => {
    const ownerKey = owner ?? OWNER_NULL_KEY;
    let owners = balanceMap.get(mint);
    if (owners == null) {
      owners = new Map<string, BalanceSlot>();
      balanceMap.set(mint, owners);
    }
    let slot = owners.get(ownerKey);
    if (slot == null) {
      slot = { mint, owner, decimals, pre: 0n, post: 0n };
      owners.set(ownerKey, slot);
    }
    return slot;
  };
  let budgetStartedAt = Date.now();
  for (const entry of preTokenBalances) {
    const slot = upsertBalanceSlot(entry.mint, entry.owner, entry.decimals);
    slot.pre += BigInt(entry.amount);
    slot.decimals = entry.decimals;
    budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
  }
  for (const entry of postTokenBalances) {
    const slot = upsertBalanceSlot(entry.mint, entry.owner, entry.decimals);
    slot.post += BigInt(entry.amount);
    slot.decimals = entry.decimals;
    budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
  }

  // Group token deltas by mint so we can pick a representative token even
  // when several SPL accounts are touched for the same mint.
  const tokenDeltas = new Map<
    string,
    {
      mint: string;
      decimals: number;
      walletDelta: bigint;
      otherEntries: Array<{ owner: string; delta: bigint }>;
    }
  >();
  for (const owners of balanceMap.values()) {
    for (const slot of owners.values()) {
      const delta = slot.post - slot.pre;
      if (delta === 0n) continue;
      let aggregate = tokenDeltas.get(slot.mint);
      if (aggregate == null) {
        aggregate = {
          mint: slot.mint,
          decimals: slot.decimals,
          walletDelta: 0n,
          otherEntries: [],
        };
        tokenDeltas.set(slot.mint, aggregate);
      }
      aggregate.decimals = slot.decimals;
      if (slot.owner === walletAddress) {
        aggregate.walletDelta += delta;
      } else if (slot.owner != null) {
        aggregate.otherEntries.push({ owner: slot.owner, delta });
      }
      budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
    }
  }

  await yieldToEventLoop();
  const tokenMovements = Array.from(tokenDeltas.values())
    .filter((entry) => entry.walletDelta !== 0n)
    .sort((left, right) => {
      const leftAbs = left.walletDelta < 0n ? -left.walletDelta : left.walletDelta;
      const rightAbs = right.walletDelta < 0n ? -right.walletDelta : right.walletDelta;
      return leftAbs > rightAbs ? -1 : leftAbs < rightAbs ? 1 : 0;
    });

  const swapPair =
    tokenMovements.length >= 2 &&
    tokenMovements.some((entry) => entry.walletDelta < 0n) &&
    tokenMovements.some((entry) => entry.walletDelta > 0n)
      ? {
          input: tokenMovements.find((entry) => entry.walletDelta < 0n) ?? null,
          output: tokenMovements.find((entry) => entry.walletDelta > 0n) ?? null,
        }
      : null;

  if (swapPair?.input != null && swapPair.output != null) {
    const inputMetadata = tokenMetadata(network, swapPair.input.mint);
    const outputMetadata = tokenMetadata(network, swapPair.output.mint);
    const inputAmount = formatAtomicTokenAmount(
      swapPair.input.walletDelta,
      swapPair.input.decimals,
    ).replace(/^-/, '');
    const outputAmount = formatAtomicTokenAmount(
      swapPair.output.walletDelta,
      swapPair.output.decimals,
    );
    return {
      ...fallback,
      type: 'SWAP',
      fee,
      description: buildSwapDescription(
        inputAmount,
        inputMetadata.symbol,
        outputAmount,
        outputMetadata.symbol,
      ),
      amount: outputAmount,
      rawAmount: swapPair.output.walletDelta.toString(),
      tokenMint: swapPair.output.mint,
      tokenSymbol: outputMetadata.symbol,
      tokenName: outputMetadata.name,
      tokenLogo: outputMetadata.logo,
      tokenDecimals: swapPair.output.decimals,
      direction: null,
      counterparties: [],
    };
  }

  const dominant = tokenMovements[0];
  if (dominant != null) {
    const direction: 'send' | 'receive' = dominant.walletDelta > 0n ? 'receive' : 'send';
    const metadata = tokenMetadata(network, dominant.mint);
    const uiAmount = formatAtomicTokenAmount(dominant.walletDelta, dominant.decimals);
    const absoluteAmount = uiAmount.replace(/^-/, '');
    // Pick the counterparty with the inverse delta.
    const counterpartyEntry =
      [...dominant.otherEntries].sort((left, right) => {
        const leftAbs = left.delta < 0n ? -left.delta : left.delta;
        const rightAbs = right.delta < 0n ? -right.delta : right.delta;
        return leftAbs > rightAbs ? -1 : leftAbs < rightAbs ? 1 : 0;
      })[0] ?? null;
    const counterparties: TransactionEnrichment['counterparties'] = [];
    if (counterpartyEntry != null) {
      counterparties.push({
        address: counterpartyEntry.owner,
        role: direction === 'receive' ? 'sender' : 'recipient',
      });
    }
    const counterpartyAddress = counterpartyEntry?.owner ?? null;
    const counterpartyShort =
      counterpartyAddress != null
        ? `${counterpartyAddress.slice(0, 4)}...${counterpartyAddress.slice(-4)}`
        : null;
    const description = buildTransferDescription(
      direction,
      absoluteAmount,
      metadata.symbol,
      counterpartyShort,
    );
    return {
      ...fallback,
      type: 'TRANSFER',
      fee,
      description,
      amount: absoluteAmount,
      rawAmount:
        dominant.walletDelta < 0n
          ? (-dominant.walletDelta).toString()
          : dominant.walletDelta.toString(),
      tokenMint: dominant.mint,
      tokenSymbol: metadata.symbol,
      tokenName: metadata.name,
      tokenLogo: metadata.logo,
      tokenDecimals: dominant.decimals,
      direction,
      sender: direction === 'receive' ? counterpartyAddress : walletAddress,
      recipient: direction === 'send' ? counterpartyAddress : walletAddress,
      counterparties,
    };
  }

  // Native SOL transfer fallback. Use lamport balance deltas adjusted for
  // the fee paid by the wallet when it is the fee payer.
  const walletAccountIndex = accountKeys.indexOf(walletAddress);
  if (walletAccountIndex >= 0) {
    const pre = preBalances[walletAccountIndex];
    const post = postBalances[walletAccountIndex];
    if (typeof pre === 'number' && typeof post === 'number') {
      const isFeePayer = walletAccountIndex === 0;
      const lamportDelta = BigInt(post) - BigInt(pre) + (isFeePayer ? BigInt(fee) : 0n);
      if (lamportDelta !== 0n) {
        const direction: 'send' | 'receive' = lamportDelta > 0n ? 'receive' : 'send';
        const metadata = tokenMetadata(network, 'So11111111111111111111111111111111111111112');
        const uiAmount = formatAtomicSolAmount(lamportDelta);
        const absoluteAmount = uiAmount.replace(/^-/, '');
        const counterpartyEntry =
          accountKeys
            .map((address, index) => {
              if (index === walletAccountIndex) return null;
              const otherPre = preBalances[index];
              const otherPost = postBalances[index];
              if (typeof otherPre !== 'number' || typeof otherPost !== 'number') return null;
              const otherDelta = BigInt(otherPost) - BigInt(otherPre);
              if (otherDelta === 0n) return null;
              return { address, delta: otherDelta };
            })
            .filter((entry): entry is { address: string; delta: bigint } => entry != null)
            .sort((left, right) => {
              const leftAbs = left.delta < 0n ? -left.delta : left.delta;
              const rightAbs = right.delta < 0n ? -right.delta : right.delta;
              return leftAbs > rightAbs ? -1 : leftAbs < rightAbs ? 1 : 0;
            })[0] ?? null;
        const counterpartyAddress = counterpartyEntry?.address ?? null;
        const counterpartyShort =
          counterpartyAddress != null
            ? `${counterpartyAddress.slice(0, 4)}...${counterpartyAddress.slice(-4)}`
            : null;
        // Self-transfer: the wallet appears as the only account with a
        // non-zero net delta. The lamport delta then equals the
        // negative fee, which would render as a confusing "Sent
        // 0.000005 SOL". Tag it as a self-transfer so the UI surfaces
        // it as such rather than a normal outgoing payment.
        const isSelfTransfer = counterpartyEntry == null && lamportDelta === -BigInt(fee);
        const description = isSelfTransfer
          ? 'Self-transfer'
          : buildTransferDescription(direction, absoluteAmount, metadata.symbol, counterpartyShort);
        const counterparties: TransactionEnrichment['counterparties'] =
          counterpartyAddress != null
            ? [
                {
                  address: counterpartyAddress,
                  role: direction === 'receive' ? 'sender' : 'recipient',
                },
              ]
            : [];
        return {
          ...fallback,
          type: 'TRANSFER',
          fee,
          description,
          amount: absoluteAmount,
          rawAmount: lamportDelta < 0n ? (-lamportDelta).toString() : lamportDelta.toString(),
          tokenMint: 'So11111111111111111111111111111111111111112',
          tokenSymbol: metadata.symbol,
          tokenName: metadata.name,
          tokenLogo: metadata.logo,
          tokenDecimals: 9,
          direction,
          sender: direction === 'receive' ? counterpartyAddress : walletAddress,
          recipient: direction === 'send' ? counterpartyAddress : walletAddress,
          counterparties,
        };
      }
    }
  }

  const parsedInstructionEnrichment = buildParsedInstructionEnrichment({
    network,
    walletAddress,
    fallback,
    fee,
    raw,
  });
  if (parsedInstructionEnrichment != null) return parsedInstructionEnrichment;

  return {
    ...fallback,
    fee,
  };
}

function isUnenrichedEnrichment(enrichment: TransactionEnrichment): boolean {
  return (
    enrichment.type === 'unknown' &&
    enrichment.amount == null &&
    enrichment.rawAmount == null &&
    enrichment.tokenMint == null &&
    enrichment.tokenSymbol == null &&
    enrichment.direction == null
  );
}

async function fetchTransactionEnrichment(
  walletAddress: string,
  network: OffpayNetwork,
  signature: string,
  signal?: AbortSignal,
): Promise<TransactionEnrichment | null> {
  // Single-signature fallback path used to retry batch slots that
  // returned null. Two attempts with a refill-aware backoff so a
  // brief upstream blip doesn't degrade an entire history row down
  // to "Sent / Tx XX...XX".
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await rpcRequest<unknown>(
        network,
        'getTransaction',
        [signature, TRANSACTION_ENRICHMENT_RPC_CONFIG],
        { signal },
      );
      if (raw == null) return null;
      const enrichment = await buildEnrichmentFromTransaction(network, walletAddress, raw);
      if (!isUnenrichedEnrichment(enrichment)) return enrichment;

      const parsedRaw = await rpcRequest<unknown>(
        network,
        'getTransaction',
        [signature, TRANSACTION_ENRICHMENT_PARSED_RPC_CONFIG],
        { signal },
      );
      if (parsedRaw == null) return enrichment;
      return await buildEnrichmentFromTransaction(network, walletAddress, parsedRaw);
    } catch (error) {
      if (signal?.aborted === true || isAbortLikeError(error)) throw rpcAbortError(error);
      if (error instanceof ProviderRouterError && error.retryable === false) {
        if (__DEV__) {
          console.log('[provider-router] enrichment unrecoverable', {
            signature,
            error: error.message,
          });
        }
        return null;
      }
      if (attempt === 0) {
        // Wait long enough for the history bucket to refill at least
        // a few tokens (capacity 60, refill 30/s). 750ms gives us
        // ~22 fresh tokens — plenty for the second attempt to land.
        await new Promise<void>((resolve) => setTimeout(resolve, 750));
        continue;
      }
      if (__DEV__) {
        console.log('[provider-router] enrichment retries exhausted', {
          signature,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }
  return null;
}

async function fetchTransactionBatchRawResults(
  network: OffpayNetwork,
  subrequests: ReadonlyArray<{ params: unknown[] }>,
  startIndex: number,
  signal?: AbortSignal,
): Promise<Array<unknown | null>> {
  try {
    if (signal?.aborted === true) throw rpcAbortError(signal.reason);
    return await rpcBatchRequest<unknown>(network, 'getTransaction', subrequests, { signal });
  } catch (error) {
    if (signal?.aborted === true || isAbortLikeError(error)) throw rpcAbortError(error);
    if (isPayloadTooLargeError(error) && subrequests.length > 1) {
      const midpoint = Math.ceil(subrequests.length / 2);
      if (__DEV__) {
        console.log('[provider-router] enrichment batch too large; splitting', {
          start: startIndex,
          size: subrequests.length,
          left: midpoint,
          right: subrequests.length - midpoint,
        });
      }
      const left = await fetchTransactionBatchRawResults(
        network,
        subrequests.slice(0, midpoint),
        startIndex,
        signal,
      );
      const right = await fetchTransactionBatchRawResults(
        network,
        subrequests.slice(midpoint),
        startIndex + midpoint,
        signal,
      );
      return [...left, ...right];
    }

    throw error;
  }
}

// Batched enrichment fan-out. A history page is split into small JSON-RPC
// arrays instead of N sequential requests, with per-signature retry only
// for slots that still come back empty.
async function fetchEnrichmentsConcurrently(
  walletAddress: string,
  network: OffpayNetwork,
  signatures: ReadonlyArray<{ signature: string; err: unknown }>,
  signal?: AbortSignal,
): Promise<Array<TransactionEnrichment | null>> {
  if (signatures.length === 0) return [];

  // `getTransaction` responses can be very large for swap/program-heavy
  // transactions. Keep batches small and split again on HTTP 413 so a
  // single oversized page does not degrade every history row to null.
  const subrequests = signatures.map((entry) => ({
    params: [entry.signature, TRANSACTION_ENRICHMENT_RPC_CONFIG] as unknown[],
  }));

  const results: Array<TransactionEnrichment | null> = new Array(signatures.length).fill(null);
  let nullSlotCount = 0;
  let batchFailureCount = 0;

  for (let start = 0; start < subrequests.length; start += TRANSACTION_ENRICHMENT_BATCH_SIZE) {
    if (signal?.aborted === true) throw rpcAbortError(signal.reason);
    const slice = subrequests.slice(start, start + TRANSACTION_ENRICHMENT_BATCH_SIZE);
    let rawResults: Array<unknown | null>;
    try {
      rawResults = await fetchTransactionBatchRawResults(network, slice, start, signal);
    } catch (error) {
      if (isAbortLikeError(error)) throw rpcAbortError(error);
      // Whole-batch failure — fall through to per-signature path
      // below so each row still has a chance to enrich.
      batchFailureCount += 1;
      if (__DEV__) {
        console.log('[provider-router] enrichment batch failed; retrying per-signature', {
          start,
          size: slice.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      rawResults = new Array(slice.length).fill(null);
    }

    for (let offset = 0; offset < rawResults.length; offset += 1) {
      const raw = rawResults[offset];
      const targetIndex = start + offset;
      const entry = signatures[targetIndex];
      if (entry == null) continue;
      if (raw != null && isRecord(raw)) {
        const enrichment = await buildEnrichmentFromTransaction(network, walletAddress, raw);
        if (isUnenrichedEnrichment(enrichment)) {
          nullSlotCount += 1;
        } else {
          results[targetIndex] = enrichment;
        }
      } else {
        nullSlotCount += 1;
      }
    }

    await yieldToUi();
  }

  // Per-signature retry for slots the batch left null. We cap the
  // fan-out so a totally dead RPC can't burn the bucket.
  const RETRY_CONCURRENCY = 4;
  const RETRY_LIMIT = 24;
  const nullIndices: number[] = [];
  for (let index = 0; index < results.length; index += 1) {
    if (results[index] == null) nullIndices.push(index);
    if (nullIndices.length >= RETRY_LIMIT) break;
  }

  if (__DEV__ && (nullSlotCount > 0 || batchFailureCount > 0)) {
    console.log('[provider-router] enrichment summary', {
      total: signatures.length,
      nullsAfterBatch: nullSlotCount,
      batchFailures: batchFailureCount,
      retrying: nullIndices.length,
    });
  }

  for (let start = 0; start < nullIndices.length; start += RETRY_CONCURRENCY) {
    if (signal?.aborted === true) throw rpcAbortError(signal.reason);
    const slice = nullIndices.slice(start, start + RETRY_CONCURRENCY);
    const enrichments = await Promise.all(
      slice.map((index) => {
        const entry = signatures[index]!;
        return fetchTransactionEnrichment(walletAddress, network, entry.signature, signal);
      }),
    );
    for (let offset = 0; offset < slice.length; offset += 1) {
      results[slice[offset]!] = enrichments[offset] ?? null;
    }
    await yieldToUi();
  }

  return results;
}

export async function getWalletTransactions(
  walletAddress: string,
  network: OffpayNetwork,
  options?: { cursor?: string; limit?: number; signal?: AbortSignal },
): Promise<WalletTransactionsResponse> {
  const response = await getRpcSignaturesForAddress({
    address: walletAddress,
    network,
    before: options?.cursor,
    limit: options?.limit,
  });
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const enrichments = await fetchEnrichmentsConcurrently(
    walletAddress,
    network,
    response.signatures,
    options?.signal,
  );
  const transactions: WalletTransactionsResponse['transactions'] = [];
  let budgetStartedAt = Date.now();
  for (let index = 0; index < response.signatures.length; index += 1) {
    const entry = response.signatures[index];
    if (entry == null) continue;
    const enrichment = enrichments[index];
    const status: 'success' | 'failed' = entry.err == null ? 'success' : 'failed';
    const timestamp = entry.blockTime ?? Math.floor(Date.now() / 1000);
    if (enrichment == null) {
      // We deliberately use `unknown` here (not `transaction`) so the
      // data layer can render this row as an in-flight "Activity"
      // pending enrichment instead of defaulting to a "Sent" tone.
      transactions.push({
        signature: entry.signature,
        timestamp,
        type: 'unknown',
        description: null,
        fee: 0,
        status,
        counterparties: [],
      });
      budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
      continue;
    }

    transactions.push({
      signature: entry.signature,
      timestamp,
      type: enrichment.type,
      description: enrichment.description,
      amount: enrichment.amount,
      rawAmount: enrichment.rawAmount,
      tokenMint: enrichment.tokenMint,
      tokenSymbol: enrichment.tokenSymbol,
      tokenName: enrichment.tokenName,
      tokenLogo: enrichment.tokenLogo,
      tokenDecimals: enrichment.tokenDecimals,
      fee: enrichment.fee,
      status,
      direction: enrichment.direction,
      sender: enrichment.sender,
      recipient: enrichment.recipient,
      counterparties: enrichment.counterparties,
    });
    budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
  }
  return {
    address: walletAddress,
    network,
    transactions,
    cursor:
      response.signatures.length >= limit
        ? (response.signatures[response.signatures.length - 1]?.signature ?? null)
        : null,
    fetchedAt: Date.now(),
  };
}

export function rawTransactionPrimarySignature(rawTransactionBase64: string): string | null {
  try {
    const bytes = Uint8Array.from(Buffer.from(rawTransactionBase64, 'base64'));
    if (bytes.length < 65) return null;
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
    if (signatureCount < 1 || bytes.length < cursor + 64) return null;
    return bs58.encode(bytes.subarray(cursor, cursor + 64));
  } catch {
    return null;
  }
}

function readCompactU16(
  bytes: Uint8Array,
  startCursor: number,
): { value: number; cursor: number } | null {
  let cursor = startCursor;
  let value = 0;
  let shift = 0;

  while (cursor < bytes.length) {
    const byte = bytes[cursor] ?? 0;
    value |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      return { value, cursor };
    }
    shift += 7;
    if (shift > 21) return null;
  }

  return null;
}

interface RawTransactionInstructionLog {
  index: number;
  programId: string | null;
  programIdIndex: number;
  accountCount: number;
  dataLength: number;
  discriminatorHex: string | null;
}

interface RawTransactionDebugLog {
  version: 'legacy' | number;
  signatureCount: number;
  accountCount: number;
  instructionCount: number;
  instructions: RawTransactionInstructionLog[];
}

function summarizeRawTransactionForLog(
  rawTransactionBase64: string,
): RawTransactionDebugLog | null {
  try {
    const bytes = Uint8Array.from(Buffer.from(rawTransactionBase64, 'base64'));
    let decoded = readCompactU16(bytes, 0);
    if (decoded == null) return null;
    const signatureCount = decoded.value;
    let cursor = decoded.cursor + signatureCount * 64;
    if (cursor >= bytes.length) return null;

    const firstMessageByte = bytes[cursor] ?? 0;
    const isVersioned = (firstMessageByte & 0x80) !== 0;
    const version: 'legacy' | number = isVersioned ? firstMessageByte & 0x7f : 'legacy';
    if (isVersioned) cursor += 1;

    cursor += 3;
    decoded = readCompactU16(bytes, cursor);
    if (decoded == null) return null;
    const accountCount = decoded.value;
    cursor = decoded.cursor;
    if (cursor + accountCount * 32 > bytes.length) return null;

    const accountKeys: string[] = [];
    for (let index = 0; index < accountCount; index += 1) {
      accountKeys.push(bs58.encode(bytes.subarray(cursor, cursor + 32)));
      cursor += 32;
    }

    cursor += 32;
    decoded = readCompactU16(bytes, cursor);
    if (decoded == null) return null;
    const instructionCount = decoded.value;
    cursor = decoded.cursor;

    const instructions: RawTransactionInstructionLog[] = [];
    for (let index = 0; index < instructionCount && cursor < bytes.length; index += 1) {
      const programIdIndex = bytes[cursor] ?? 0;
      cursor += 1;

      decoded = readCompactU16(bytes, cursor);
      if (decoded == null) break;
      const accountIndexCount = decoded.value;
      cursor = decoded.cursor + accountIndexCount;

      decoded = readCompactU16(bytes, cursor);
      if (decoded == null) break;
      const dataLength = decoded.value;
      cursor = decoded.cursor;
      const dataStart = cursor;
      const dataEnd = Math.min(cursor + dataLength, bytes.length);
      const discriminator =
        dataLength >= 8
          ? Buffer.from(bytes.subarray(dataStart, dataStart + 8)).toString('hex')
          : null;
      cursor += dataLength;

      instructions.push({
        index,
        programId: accountKeys[programIdIndex] ?? null,
        programIdIndex,
        accountCount: accountIndexCount,
        dataLength: dataEnd - dataStart,
        discriminatorHex: discriminator,
      });
    }

    return {
      version,
      signatureCount,
      accountCount,
      instructionCount,
      instructions: instructions.slice(0, 8),
    };
  } catch {
    return null;
  }
}

function summarizeRpcErrorForLog(rpcError: unknown): {
  instructionError: JsonValue | null;
  logs: string[] | null;
} | null {
  if (!isRecord(rpcError)) return null;
  const data = rpcError.data;
  if (!isRecord(data)) return null;
  const logs = Array.isArray(data.logs)
    ? data.logs.filter((entry): entry is string => typeof entry === 'string').slice(-20)
    : null;

  return {
    instructionError: 'err' in data ? jsonValue(data.err) : null,
    logs,
  };
}

export { ProviderRouterError };
