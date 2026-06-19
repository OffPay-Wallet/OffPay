import type { Context, MiddlewareHandler } from 'hono';
import { verifyAsync as verifyEd25519 } from '@noble/ed25519';
import bs58 from 'bs58';
import { errorResponse } from './errors.js';
import { AppError } from './errors.js';
import { checkRateLimit, applyRateLimitHeaders } from './ratelimit.js';
import type { AppEnv, Bindings, Network } from './types.js';
import {
  DEFAULT_MAX_JSON_BODY_BYTES,
  canonicalJsonStringify,
  ensureSupportedVersionFormat,
  isValidEd25519Signature,
  isValidSolanaAddress,
  parseNetwork,
} from './validation.js';
import { isAllowedOrigin } from './cors.js';

const TIMESTAMP_MAX_AGE_MS = 60_000;
const TIMESTAMP_FUTURE_SKEW_MS = 5_000;
const HEX_PATTERN = /^[a-f0-9]+$/i;
const PROTECTED_ROUTE_PREFIXES = [
  '/api/market/',
  '/api/wallet/',
  '/api/risk/',
  '/api/swap/',
  '/api/payment/',
  '/api/offline/',
  '/api/privacy/',
  '/api/stream/',
  '/api/pending/',
  '/api/rpc/',
  '/api/umbra/',
] as const;
const PUBLIC_AUTH_EXEMPT_ROUTES = new Set([
  'GET /api/market/fx-rate',
  'POST /api/market/token-price',
  'POST /api/market/token-prices-batch',
  'POST /api/market/token-price-history',
  'GET /api/swap/tokens',
  'GET /api/swap/price',
  'GET /api/wallet/dashboard',
  'GET /api/wallet/balance',
  'GET /api/wallet/transactions',
  'GET /api/stream/capabilities',
  'GET /api/stream/wallet-activity',
]);
const PUBLIC_RATE_LIMITED_ROUTES = new Set([
  'GET /api/bootstrap/provision',
  'POST /api/bootstrap/provision',
  'GET /api/capabilities',
  'POST /api/invite/verify',
  'GET /api/market/fx-rate',
  'POST /api/market/token-price',
  'POST /api/market/token-prices-batch',
  'POST /api/market/token-price-history',
  'GET /api/swap/tokens',
  'GET /api/swap/price',
  'GET /api/wallet/dashboard',
  'GET /api/wallet/balance',
  'GET /api/wallet/transactions',
  'GET /api/stream/capabilities',
  'GET /api/stream/wallet-activity',
]);
const PUBLIC_RATE_LIMIT_FAIL_CLOSED_ROUTES = new Set([
  'GET /api/bootstrap/provision',
  'POST /api/bootstrap/provision',
  'POST /api/invite/verify',
  'GET /api/stream/wallet-activity',
]);

interface AuthHeaders {
  authMode: 'wallet-v1' | 'hmac-v2';
  walletAddress: string;
  timestamp: number;
  signature: string | null;
  appHmac: string;
  appVersion: string;
  deviceId: string;
  network: Network;
  bootstrapVersion: string;
}

interface AuthenticatedRequest {
  wallet: string;
  deviceId: string;
  network: Network;
}

function normalizeRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function requiresAuthentication(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'OPTIONS') {
    return false;
  }

  if (PUBLIC_AUTH_EXEMPT_ROUTES.has(normalizeRouteKey(normalizedMethod, path))) {
    return false;
  }

  return PROTECTED_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function shouldRateLimitPublicRoute(method: string, path: string): boolean {
  return PUBLIC_RATE_LIMITED_ROUTES.has(normalizeRouteKey(method, path));
}

function shouldFailClosedWhenRateLimitDegraded(method: string, path: string): boolean {
  if (requiresAuthentication(method, path)) {
    return true;
  }

  return PUBLIC_RATE_LIMIT_FAIL_CLOSED_ROUTES.has(normalizeRouteKey(method, path));
}

function getPublicRateLimitIdentifier(context: Context<AppEnv>): string {
  return (
    context.req.header('X-Device-Id')?.trim() ||
    context.req.header('CF-Connecting-IP')?.trim() ||
    context.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous'
  );
}

async function checkRequestRateLimit(
  context: Context<AppEnv>,
  identifier: string,
): Promise<Awaited<ReturnType<typeof checkRateLimit>> | Response> {
  const rateLimit = await checkRateLimit(context.env, {
    method: context.req.method,
    path: context.req.path,
    identifier,
  });

  if (!rateLimit.allowed) {
    const response = errorResponse(429, 'RATE_LIMITED', 'Too many requests.', {
      retryable: true,
      retryAfterMs: rateLimit.retryAfterSec * 1000,
    });
    applyRateLimitHeaders(response.headers, rateLimit);
    return response;
  }

  return rateLimit;
}

function rateLimitStorageUnavailableResponse(
  rateLimit: Awaited<ReturnType<typeof checkRateLimit>>,
): Response {
  const response = errorResponse(
    503,
    'UPSTREAM_UNAVAILABLE',
    'Rate limit storage is temporarily unavailable.',
    {
      retryable: true,
      retryAfterMs: rateLimit.retryAfterSec * 1000,
    },
  );
  applyRateLimitHeaders(response.headers, rateLimit);
  response.headers.set('Retry-After', rateLimit.retryAfterSec.toString());
  return response;
}

function getRequiredBinding(bindings: Bindings, key: keyof Bindings): string {
  const rawValue = bindings[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return value;
}

function getBootstrapSecretVersion(bindings: Bindings): string {
  const bootstrapSecretVersion = getRequiredBinding(bindings, 'BOOTSTRAP_SECRET_VERSION');
  if (!/^\d+$/.test(bootstrapSecretVersion)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return bootstrapSecretVersion;
}

function getMinimumAppVersion(bindings: Bindings): string {
  const minAppVersion = getRequiredBinding(bindings, 'MIN_APP_VERSION');
  try {
    ensureSupportedVersionFormat(minAppVersion);
  } catch {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return minAppVersion;
}

function parseAuthHeaders(context: Context<AppEnv>): AuthHeaders {
  const authModeRaw = context.req.header('X-App-Auth-Mode')?.trim().toLowerCase();
  const authMode = authModeRaw === 'hmac-v2' ? 'hmac-v2' : 'wallet-v1';

  const walletAddress = context.req.header('X-Wallet-Address')?.trim() ?? '';
  if (!isValidSolanaAddress(walletAddress)) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const timestampRaw = context.req.header('X-Timestamp')?.trim() ?? '';
  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const signature = context.req.header('X-Signature')?.trim() ?? '';
  if (authMode === 'wallet-v1' && !isValidEd25519Signature(signature)) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const appHmac = context.req.header('X-App-HMAC')?.trim().toLowerCase() ?? '';
  if (!HEX_PATTERN.test(appHmac) || appHmac.length !== 64) {
    throw new AppError({
      status: 401,
      code: 'HMAC_INVALID',
      message: 'App integrity check failed.',
    });
  }

  const appVersion = context.req.header('X-App-Version')?.trim() ?? '';
  try {
    ensureSupportedVersionFormat(appVersion);
  } catch {
    throw new AppError({
      status: 426,
      code: 'OUTDATED_APP',
      message: 'Please update OffPay.',
    });
  }

  const deviceId = context.req.header('X-Device-Id')?.trim() ?? '';
  if (deviceId.length === 0) {
    throw new AppError({
      status: 401,
      code: 'HMAC_INVALID',
      message: 'App integrity check failed.',
    });
  }

  let network: Network;
  try {
    network = parseNetwork(context.req.header('X-Network') ?? 'mainnet');
  } catch {
    throw new AppError({
      status: 400,
      code: 'INVALID_NETWORK',
      message: 'Invalid network.',
    });
  }

  const bootstrapVersion = context.req.header('X-Bootstrap-Version')?.trim() ?? '';
  if (!/^\d+$/.test(bootstrapVersion)) {
    throw new AppError({
      status: 401,
      code: 'HMAC_INVALID',
      message: 'App integrity check failed.',
    });
  }

  return {
    authMode,
    walletAddress,
    timestamp,
    signature: signature.length > 0 ? signature : null,
    appHmac,
    appVersion,
    deviceId,
    network,
    bootstrapVersion,
  };
}

function parseVersion(version: string): number[] {
  return version.split('.').map((part) => Number(part));
}

function meetsMinVersion(currentVersion: string, minimumVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const minimum = parseVersion(minimumVersion);
  const maxLength = Math.max(current.length, minimum.length);

  for (let index = 0; index < maxLength; index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;

    if (currentPart > minimumPart) {
      return true;
    }

    if (currentPart < minimumPart) {
      return false;
    }
  }

  return true;
}

function buildPathAndQuery(url: string): string {
  const parsedUrl = new URL(url);
  return `${parsedUrl.pathname}${parsedUrl.search}`;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index]! ^ right[index]!;
  }

  return mismatch === 0;
}

function hexToBytes(value: string): Uint8Array {
  const normalizedValue = value.toLowerCase();
  const bytes = new Uint8Array(normalizedValue.length / 2);

  for (let index = 0; index < normalizedValue.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalizedValue.slice(index, index + 2), 16);
  }

  return bytes;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (entry) => entry.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

async function deriveDeviceSecretHexUncached(
  bootstrapSecret: string,
  walletAddress: string,
  deviceId: string,
): Promise<string> {
  return hmacSha256Hex(bootstrapSecret, `${walletAddress}:${deviceId}`);
}

/**
 * Per-isolate memoization of the per-wallet derived device secret.
 *
 * `OFFPAY_BOOTSTRAP_SECRET` is a binding that is constant for the lifetime
 * of a deployed isolate (it only changes on a new deploy, which spins up a
 * fresh isolate). The derived secret is purely a function of
 * `(bootstrapSecret, walletAddress, deviceId)`, so caching it on the isolate
 * is safe and saves one `crypto.subtle.importKey` + `crypto.subtle.sign`
 * round-trip (~0.5-1ms) per protected request.
 *
 * The cache is implicitly invalidated whenever Cloudflare evicts the
 * isolate, which is the only condition that can change the bootstrap
 * secret under our feet. We cap the entry count to keep memory bounded
 * under a runaway client making many unique `(wallet, device)` pairs.
 */
const MAX_DERIVED_SECRET_CACHE_ENTRIES = 2048;
const derivedDeviceSecretCache = new Map<string, string>();

function buildDerivedSecretCacheKey(
  bootstrapSecret: string,
  walletAddress: string,
  deviceId: string,
): string {
  return `${bootstrapSecret}:${walletAddress}:${deviceId}`;
}

function pruneDerivedSecretCache(): void {
  if (derivedDeviceSecretCache.size <= MAX_DERIVED_SECRET_CACHE_ENTRIES) return;
  // Map preserves insertion order. Drop the oldest entries first; the
  // hottest wallet+device pairs accumulate at the end of the map and stay
  // warm.
  const overflow = derivedDeviceSecretCache.size - MAX_DERIVED_SECRET_CACHE_ENTRIES;
  const iterator = derivedDeviceSecretCache.keys();
  for (let index = 0; index < overflow; index += 1) {
    const next = iterator.next();
    if (next.done === true) break;
    derivedDeviceSecretCache.delete(next.value);
  }
}

async function deriveDeviceSecretHex(
  bootstrapSecret: string,
  walletAddress: string,
  deviceId: string,
): Promise<string> {
  const key = buildDerivedSecretCacheKey(bootstrapSecret, walletAddress, deviceId);
  const cached = derivedDeviceSecretCache.get(key);
  if (cached != null) return cached;

  const derived = await deriveDeviceSecretHexUncached(bootstrapSecret, walletAddress, deviceId);
  derivedDeviceSecretCache.set(key, derived);
  pruneDerivedSecretCache();
  return derived;
}

async function canonicalBodyHash(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength != null && Number(contentLength) > DEFAULT_MAX_JSON_BODY_BYTES) {
    throw new AppError({
      status: 413,
      code: 'INVALID_REQUEST',
      message: 'Request body is too large.',
    });
  }

  const rawBody = await request.clone().text();
  if (rawBody.trim().length === 0) {
    return sha256Hex('');
  }

  if (rawBody.length > DEFAULT_MAX_JSON_BODY_BYTES) {
    throw new AppError({
      status: 413,
      code: 'INVALID_REQUEST',
      message: 'Request body is too large.',
    });
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    try {
      const parsedBody = JSON.parse(rawBody) as unknown;
      return sha256Hex(canonicalJsonStringify(parsedBody));
    } catch (error) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Malformed JSON body.',
        cause: error,
      });
    }
  }

  return sha256Hex(rawBody);
}

async function verifyWalletSignature(
  request: Request,
  walletAddress: string,
  timestamp: number,
  signature: string | null,
): Promise<boolean> {
  if (signature == null) return false;

  const now = Date.now();
  if (timestamp < now - TIMESTAMP_MAX_AGE_MS || timestamp > now + TIMESTAMP_FUTURE_SKEW_MS) {
    return false;
  }

  const walletPublicKey = bs58.decode(walletAddress);
  const signatureBytes = bs58.decode(signature);
  const pathAndQuery = buildPathAndQuery(request.url);
  const bodyHash = await canonicalBodyHash(request);
  const message = `offpay:${walletAddress}:${timestamp}:${request.method.toUpperCase()}:${pathAndQuery}:${bodyHash}`;

  return verifyEd25519(signatureBytes, new TextEncoder().encode(message), walletPublicKey);
}

function isTimestampFresh(timestamp: number): boolean {
  const now = Date.now();
  return timestamp >= now - TIMESTAMP_MAX_AGE_MS && timestamp <= now + TIMESTAMP_FUTURE_SKEW_MS;
}

async function verifyAppHmac(
  request: Request,
  bindings: Bindings,
  walletAddress: string,
  timestamp: number,
  deviceId: string,
  appHmac: string,
  authMode: AuthHeaders['authMode'],
): Promise<boolean> {
  const bootstrapSecret = getRequiredBinding(bindings, 'OFFPAY_BOOTSTRAP_SECRET');
  const pathAndQuery = buildPathAndQuery(request.url);
  const derivedSecret = await deriveDeviceSecretHex(bootstrapSecret, walletAddress, deviceId);
  const method = request.method.toUpperCase();
  const message =
    authMode === 'hmac-v2'
      ? `${timestamp}:${walletAddress}:${method}:${pathAndQuery}:${await canonicalBodyHash(request)}`
      : `${timestamp}:${walletAddress}:${method}:${pathAndQuery}`;
  const expectedHmac = await hmacSha256Hex(derivedSecret, message);

  return timingSafeEqual(hexToBytes(expectedHmac), hexToBytes(appHmac));
}

async function authenticateRequest(
  context: Context<AppEnv>,
): Promise<AuthenticatedRequest | Response> {
  const minAppVersion = getMinimumAppVersion(context.env);
  const bootstrapSecretVersion = getBootstrapSecretVersion(context.env);

  const parsedHeaders = parseAuthHeaders(context);
  if (!meetsMinVersion(parsedHeaders.appVersion, minAppVersion)) {
    return errorResponse(426, 'OUTDATED_APP', 'Please update OffPay.');
  }

  const origin = context.req.header('Origin');
  if (!isAllowedOrigin(origin, context.env)) {
    return errorResponse(403, 'FORBIDDEN_ORIGIN', 'Origin not permitted.');
  }

  if (!isTimestampFresh(parsedHeaders.timestamp)) {
    return errorResponse(401, 'SIGNATURE_INVALID', 'Request signature invalid or expired.');
  }

  if (parsedHeaders.authMode === 'wallet-v1') {
    const signatureValid = await verifyWalletSignature(
      context.req.raw,
      parsedHeaders.walletAddress,
      parsedHeaders.timestamp,
      parsedHeaders.signature,
    );
    if (!signatureValid) {
      return errorResponse(401, 'SIGNATURE_INVALID', 'Request signature invalid or expired.');
    }
  }

  if (parsedHeaders.bootstrapVersion !== bootstrapSecretVersion) {
    return errorResponse(401, 'SECRET_ROTATED', 'Request secret has been rotated.');
  }

  const hmacValid = await verifyAppHmac(
    context.req.raw,
    context.env,
    parsedHeaders.walletAddress,
    parsedHeaders.timestamp,
    parsedHeaders.deviceId,
    parsedHeaders.appHmac,
    parsedHeaders.authMode,
  );
  if (!hmacValid) {
    return errorResponse(401, 'HMAC_INVALID', 'App integrity check failed.');
  }

  context.set('wallet', parsedHeaders.walletAddress);
  context.set('deviceId', parsedHeaders.deviceId);
  context.set('network', parsedHeaders.network);

  return {
    wallet: parsedHeaders.walletAddress,
    deviceId: parsedHeaders.deviceId,
    network: parsedHeaders.network,
  };
}

const authenticationMiddleware: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (!requiresAuthentication(context.req.method, context.req.path)) {
    if (shouldRateLimitPublicRoute(context.req.method, context.req.path)) {
      const rateLimit = await checkRequestRateLimit(context, getPublicRateLimitIdentifier(context));
      if (rateLimit instanceof Response) return rateLimit;
      if (
        rateLimit.degraded &&
        shouldFailClosedWhenRateLimitDegraded(context.req.method, context.req.path)
      ) {
        return rateLimitStorageUnavailableResponse(rateLimit);
      }

      await next();
      applyRateLimitHeaders(context.res.headers, rateLimit);
      return;
    }

    await next();
    return;
  }

  const result = await authenticateRequest(context);
  if (result instanceof Response) {
    return result;
  }

  const rateLimit = await checkRequestRateLimit(context, result.wallet);
  if (rateLimit instanceof Response) return rateLimit;
  if (
    rateLimit.degraded &&
    shouldFailClosedWhenRateLimitDegraded(context.req.method, context.req.path)
  ) {
    return rateLimitStorageUnavailableResponse(rateLimit);
  }

  await next();
  applyRateLimitHeaders(context.res.headers, rateLimit);
};

function getAuthenticatedContext(context: Context<AppEnv>): AuthenticatedRequest {
  const wallet = context.get('wallet');
  const deviceId = context.get('deviceId');
  const network = context.get('network');

  if (!wallet || !deviceId || !network) {
    throw new AppError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Authenticated context is unavailable.',
    });
  }

  return {
    wallet,
    deviceId,
    network,
  };
}

export {
  TIMESTAMP_FUTURE_SKEW_MS,
  TIMESTAMP_MAX_AGE_MS,
  authenticateRequest,
  authenticationMiddleware,
  buildPathAndQuery,
  canonicalBodyHash,
  deriveDeviceSecretHex,
  getAuthenticatedContext,
  hmacSha256Hex,
  requiresAuthentication,
  meetsMinVersion,
  timingSafeEqual,
  verifyAppHmac,
  verifyWalletSignature,
};

/** Test-only: clear the per-isolate derived secret cache. */
export function __resetDerivedDeviceSecretCacheForTests(): void {
  derivedDeviceSecretCache.clear();
}
