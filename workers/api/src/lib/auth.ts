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
  '/api/swap/',
  '/api/pending/',
] as const;

interface AuthHeaders {
  walletAddress: string;
  timestamp: number;
  signature: string;
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
  if (method.toUpperCase() === 'OPTIONS') {
    return false;
  }

  return PROTECTED_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
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
  if (!isValidEd25519Signature(signature)) {
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
    walletAddress,
    timestamp,
    signature,
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

async function deriveDeviceSecretHex(
  bootstrapSecret: string,
  walletAddress: string,
  deviceId: string,
): Promise<string> {
  return hmacSha256Hex(bootstrapSecret, `${walletAddress}:${deviceId}`);
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
  signature: string,
): Promise<boolean> {
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

async function verifyAppHmac(
  request: Request,
  bindings: Bindings,
  walletAddress: string,
  timestamp: number,
  deviceId: string,
  appHmac: string,
): Promise<boolean> {
  const bootstrapSecret = getRequiredBinding(bindings, 'OFFPAY_BOOTSTRAP_SECRET');
  const pathAndQuery = buildPathAndQuery(request.url);
  const derivedSecret = await deriveDeviceSecretHex(bootstrapSecret, walletAddress, deviceId);
  const message = `${timestamp}:${walletAddress}:${request.method.toUpperCase()}:${pathAndQuery}`;
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
  if (!isAllowedOrigin(origin)) {
    return errorResponse(403, 'FORBIDDEN_ORIGIN', 'Origin not permitted.');
  }

  const signatureValid = await verifyWalletSignature(
    context.req.raw,
    parsedHeaders.walletAddress,
    parsedHeaders.timestamp,
    parsedHeaders.signature,
  );
  if (!signatureValid) {
    return errorResponse(401, 'SIGNATURE_INVALID', 'Request signature invalid or expired.');
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
    await next();
    return;
  }

  const result = await authenticateRequest(context);
  if (result instanceof Response) {
    return result;
  }

  const rateLimit = await checkRateLimit(context.env, {
    method: context.req.method,
    path: context.req.path,
    identifier: result.wallet,
  });

  if (!rateLimit.allowed) {
    const response = errorResponse(429, 'RATE_LIMITED', 'Too many requests.', {
      retryable: true,
      retryAfterMs: rateLimit.retryAfterSec * 1000,
    });
    applyRateLimitHeaders(response.headers, rateLimit);
    return response;
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
