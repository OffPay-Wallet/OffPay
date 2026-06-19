import { ed25519 } from '@noble/curves/ed25519.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';

import { digestHex, hmacSha256HexSafe } from '@/lib/crypto/safe-hash';
import { mark, measure } from '@/lib/perf/perf-marks';

import type { OffpayApiMethod } from '@/types/offpay-api';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  function normalizeForCanonicalJson(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map((entry) => (entry === undefined ? null : normalizeForCanonicalJson(entry)));
    }

    if (isPlainObject(input)) {
      const sortedEntries = Object.keys(input)
        .sort((left, right) => left.localeCompare(right))
        .flatMap((key) => {
          const nestedValue = input[key];
          if (nestedValue === undefined) return [];

          return [[key, normalizeForCanonicalJson(nestedValue)] as const];
        });

      return Object.fromEntries(sortedEntries);
    }

    return input;
  }

  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function sha256hex(input: string | Uint8Array): string {
  return digestHex('SHA-256', input);
}

export function canonicalBodyHash(body: unknown): string {
  if (body === undefined || body === null) {
    return sha256hex('');
  }

  return sha256hex(canonicalJsonStringify(body));
}

export function buildCanonicalMessage(params: {
  walletAddress: string;
  timestamp: number;
  method: OffpayApiMethod;
  pathAndQuery: string;
  bodyHash: string;
}): string {
  return `offpay:${params.walletAddress}:${params.timestamp}:${params.method}:${params.pathAndQuery}:${params.bodyHash}`;
}

export function buildHmacMessage(params: {
  timestamp: number;
  walletAddress: string;
  method: OffpayApiMethod;
  pathAndQuery: string;
}): string {
  return `${params.timestamp}:${params.walletAddress}:${params.method}:${params.pathAndQuery}`;
}

export function buildHmacV2Message(params: {
  timestamp: number;
  walletAddress: string;
  method: OffpayApiMethod;
  pathAndQuery: string;
  bodyHash: string;
}): string {
  return `${params.timestamp}:${params.walletAddress}:${params.method}:${params.pathAndQuery}:${params.bodyHash}`;
}

function getAuthPerfPayload(params: {
  method: OffpayApiMethod;
  network: string;
  pathAndQuery: string;
}): { method: OffpayApiMethod; network: string; route: string } {
  return {
    method: params.method,
    network: params.network,
    route: params.pathAndQuery.split('?')[0] ?? params.pathAndQuery,
  };
}

export function signOffpayMessage(message: string, signingSeed: Uint8Array): string {
  const startedAt = mark();
  const signature = ed25519.sign(utf8ToBytes(message), signingSeed);
  measure('apiAuth.signOffpayMessage', startedAt);
  return bs58.encode(signature);
}

export function signBootstrapNonce(nonce: string, signingSeed: Uint8Array): string {
  const startedAt = mark();
  const signature = ed25519.sign(utf8ToBytes(nonce), signingSeed);
  measure('apiAuth.signBootstrapNonce', startedAt);
  return bs58.encode(signature);
}

export function hmacSha256Hex(secret: string, message: string): string {
  const startedAt = mark();
  const result = hmacSha256HexSafe(secret, message);
  measure('apiAuth.hmacSha256Hex', startedAt);
  return result;
}

export function buildOffpayAuthHeaders(params: {
  walletAddress: string;
  requestSecret: string;
  deviceId: string;
  bootstrapVersion: number;
  appVersion: string;
  network: string;
  method: OffpayApiMethod;
  pathAndQuery: string;
  body?: unknown;
  timestamp?: number;
  signingSeed: Uint8Array;
}): Record<string, string> {
  const timestamp = params.timestamp ?? Date.now();
  const bodyHash = canonicalBodyHash(params.body);
  const canonicalMessage = buildCanonicalMessage({
    walletAddress: params.walletAddress,
    timestamp,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
    bodyHash,
  });
  const hmacMessage = buildHmacMessage({
    timestamp,
    walletAddress: params.walletAddress,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
  });

  return {
    'X-Wallet-Address': params.walletAddress,
    'X-Timestamp': String(timestamp),
    'X-Signature': signOffpayMessage(canonicalMessage, params.signingSeed),
    'X-App-HMAC': hmacSha256Hex(params.requestSecret, hmacMessage),
    'X-App-Version': params.appVersion,
    'X-Device-Id': params.deviceId,
    'X-Network': params.network,
    'X-Bootstrap-Version': String(params.bootstrapVersion),
  };
}

export async function buildOffpayAuthHeadersAsync(params: {
  walletAddress: string;
  requestSecret: string;
  deviceId: string;
  bootstrapVersion: number;
  appVersion: string;
  network: string;
  method: OffpayApiMethod;
  pathAndQuery: string;
  body?: unknown;
  timestamp?: number;
  signingSeed: Uint8Array;
}): Promise<Record<string, string>> {
  // No yields. The full sync work in this function — body SHA-256,
  // canonical/HMAC message build, Ed25519 sign, HMAC-SHA256 — is
  // ~7ms total under typical OffPay request bodies (sub-KB JSON).
  // That fits inside one frame budget. The previous implementation
  // wrapped the work in `await yieldToUi()` + `await yieldToEventLoop()`
  // and ran the sign+HMAC inside `runCryptoTask` for an additional
  // yield. Real-device traces showed those yields queuing behind
  // unrelated JS work (WS subscribe-ack flurry, query invalidation
  // bursts) and stretching the wrapper time to 500-1500ms while the
  // inner work stayed at 6ms. Removing the scheduling layer collapses
  // those outliers and never costs more than the 7ms of inline work
  // it would have done anyway.
  //
  // Heavier signing paths (Umbra signMessage/signTransaction,
  // advanced-swap executor signing, offline-payment signing) still
  // route through `runCryptoTask` because their work is closer to
  // a frame budget per call AND they fire in bursts where yielding
  // between signatures matters. Auth is per-protected-request,
  // small, and latency-sensitive — different tradeoffs.
  const startedAt = mark();
  const timestamp = params.timestamp ?? Date.now();
  const bodyHash = canonicalBodyHash(params.body);
  const canonicalMessage = buildCanonicalMessage({
    walletAddress: params.walletAddress,
    timestamp,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
    bodyHash,
  });
  const hmacMessage = buildHmacMessage({
    timestamp,
    walletAddress: params.walletAddress,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
  });
  const signAndHmacStart = mark();
  const signature = signOffpayMessage(canonicalMessage, params.signingSeed);
  const appHmac = hmacSha256Hex(params.requestSecret, hmacMessage);
  const perfPayload = getAuthPerfPayload(params);
  measure('apiAuth.signAndHmac', signAndHmacStart, perfPayload);
  measure('apiAuth.buildHeadersAsync', startedAt, perfPayload);

  return {
    'X-Wallet-Address': params.walletAddress,
    'X-Timestamp': String(timestamp),
    'X-Signature': signature,
    'X-App-HMAC': appHmac,
    'X-App-Version': params.appVersion,
    'X-Device-Id': params.deviceId,
    'X-Network': params.network,
    'X-Bootstrap-Version': String(params.bootstrapVersion),
  };
}

export async function buildOffpayAuthHeadersWithSignature(params: {
  walletAddress: string;
  requestSecret: string;
  deviceId: string;
  bootstrapVersion: number;
  appVersion: string;
  network: string;
  method: OffpayApiMethod;
  pathAndQuery: string;
  body?: unknown;
  timestamp?: number;
  signCanonicalMessage: (message: string) => Promise<string>;
}): Promise<Record<string, string>> {
  const startedAt = mark();
  const timestamp = params.timestamp ?? Date.now();
  const bodyHash = canonicalBodyHash(params.body);
  const canonicalMessage = buildCanonicalMessage({
    walletAddress: params.walletAddress,
    timestamp,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
    bodyHash,
  });
  const hmacMessage = buildHmacMessage({
    timestamp,
    walletAddress: params.walletAddress,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
  });
  const signAndHmacStart = mark();
  const [signature, appHmac] = await Promise.all([
    params.signCanonicalMessage(canonicalMessage),
    Promise.resolve(hmacSha256Hex(params.requestSecret, hmacMessage)),
  ]);
  const perfPayload = getAuthPerfPayload(params);
  measure('apiAuth.externalSignAndHmac', signAndHmacStart, perfPayload);
  measure('apiAuth.buildHeadersWithSignature', startedAt, perfPayload);

  return {
    'X-Wallet-Address': params.walletAddress,
    'X-Timestamp': String(timestamp),
    'X-Signature': signature,
    'X-App-HMAC': appHmac,
    'X-App-Version': params.appVersion,
    'X-Device-Id': params.deviceId,
    'X-Network': params.network,
    'X-Bootstrap-Version': String(params.bootstrapVersion),
  };
}

export function buildOffpayHmacAuthHeaders(params: {
  walletAddress: string;
  requestSecret: string;
  deviceId: string;
  bootstrapVersion: number;
  appVersion: string;
  network: string;
  method: OffpayApiMethod;
  pathAndQuery: string;
  body?: unknown;
  timestamp?: number;
}): Record<string, string> {
  const startedAt = mark();
  const timestamp = params.timestamp ?? Date.now();
  const bodyHash = canonicalBodyHash(params.body);
  const hmacMessage = buildHmacV2Message({
    timestamp,
    walletAddress: params.walletAddress,
    method: params.method,
    pathAndQuery: params.pathAndQuery,
    bodyHash,
  });
  const appHmac = hmacSha256Hex(params.requestSecret, hmacMessage);
  const perfPayload = getAuthPerfPayload(params);
  measure('apiAuth.buildHmacHeaders', startedAt, perfPayload);

  return {
    'X-App-Auth-Mode': 'hmac-v2',
    'X-Wallet-Address': params.walletAddress,
    'X-Timestamp': String(timestamp),
    'X-App-HMAC': appHmac,
    'X-App-Version': params.appVersion,
    'X-Device-Id': params.deviceId,
    'X-Network': params.network,
    'X-Bootstrap-Version': String(params.bootstrapVersion),
  };
}

export function zeroOutBytes(bytes: Uint8Array): void {
  try {
    bytes.fill(0);
  } catch {
    // Best effort only.
  }
}
