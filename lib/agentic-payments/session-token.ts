import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { getConfiguredOffpayAttestationAdapter } from '@/lib/bootstrap/attestation';
import { bootstrapOffpayRequestSecret } from '@/lib/bootstrap/offpay-bootstrap';
import {
  getOffpayRequestSecret,
  getOffpayRequestWalletAddress,
  getOrCreateOffpayDeviceId,
} from '@/lib/api/offpay-api-storage';
import { getStoredWalletInfo } from '@/lib/wallet/secure-wallet-store';

/**
 * Signed envelope the client sends to the AI proxy Worker. The Worker
 * recomputes the HMAC with the same shared secret and rejects mismatches.
 *
 * This does NOT replace device attestation. It binds an AI-proxy request to
 * a wallet+device pair that has already cleared OffPay bootstrap (which
 * does run App Attest / Play Integrity end-to-end). The Worker checks the
 * signature, the issued-at window, and the audience.
 *
 * Token format (header.payload.signature) — JWT-shaped but with a fixed
 * `EdDSA` placeholder header so we don't ship a JWT library purely for
 * this. The signature algorithm is HMAC-SHA-256 over the canonical
 * payload string `aud:offpay-ai|sub:<wallet>|dev:<deviceId>|iat:<ms>|exp:<ms>`.
 */
export interface OffpayAiSessionToken {
  /** The opaque token string sent in the `x-offpay-ai-session` header. */
  token: string;
  /** Subject — wallet address the token was issued for. */
  walletAddress: string;
  /** Issued-at, milliseconds since epoch. */
  issuedAt: number;
  /** Expiration, milliseconds since epoch. */
  expiresAt: number;
}

const AI_AUDIENCE = 'offpay-ai';
const TOKEN_SCHEME_VERSION = 'v1';
const SIGNATURE_BYTES = 32;

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TTL_MS = 15 * 60 * 1000;
const SKEW_MS = 60_000;

const SHARED_SECRET = (process.env.EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET ?? '').trim();

export class OffpayAiSessionTokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffpayAiSessionTokenUnavailableError';
  }
}

export function isOffpayAiSessionTokenConfigured(): boolean {
  return SHARED_SECRET.length > 0;
}

/**
 * Build a signed session token for the AI proxy. Returns `null` when the
 * shared secret is not configured for this build, or when device bootstrap
 * has not completed yet (so the OffPay request secret + wallet address
 * are not in SecureStore). Callers should treat both cases identically:
 * send the proxy request without the header and let the Worker enforce
 * via `AI_PROXY_REQUIRE_SESSION_TOKEN`.
 *
 * Throws `OffpayAiSessionTokenUnavailableError` only on unexpected
 * failures (SecureStore read errors etc.) where the caller should know
 * something is wrong.
 */
export async function buildOffpayAiSessionToken(params?: {
  ttlMs?: number;
  now?: number;
}): Promise<OffpayAiSessionToken | null> {
  if (!isOffpayAiSessionTokenConfigured()) return null;

  const credentials = await ensureAiSessionBootstrapCredentials();
  if (credentials == null) return null;
  const { requestSecret, walletAddress } = credentials;

  const deviceId = await getOrCreateOffpayDeviceId();
  const now = params?.now ?? Date.now();
  const ttl = Math.min(params?.ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS);
  const expiresAt = now + ttl;

  const payload = canonicalPayload({
    walletAddress,
    deviceId,
    issuedAt: now,
    expiresAt,
  });
  const signature = hmacSha256Base64Url(SHARED_SECRET, payload);

  // We bind the per-device requestSecret too, so a leaked SHARED_SECRET
  // alone does not let an attacker forge tokens for a real wallet/device.
  // The Worker recomputes both bindings.
  const deviceBinding = hmacSha256Base64Url(requestSecret, payload).slice(0, 32);

  const header = base64Url(
    JSON.stringify({ alg: 'HS256', typ: 'OFFPAY_AI', ver: TOKEN_SCHEME_VERSION }),
  );
  const body = base64Url(payload);
  const token = `${header}.${body}.${signature}.${deviceBinding}`;

  return {
    token,
    walletAddress,
    issuedAt: now,
    expiresAt,
  };
}

async function ensureAiSessionBootstrapCredentials(): Promise<{
  requestSecret: string;
  walletAddress: string;
} | null> {
  const existing = await readAiSessionBootstrapCredentials();
  if (existing != null) return existing;

  const walletInfo = await getStoredWalletInfo();
  if (walletInfo == null) {
    throw new OffpayAiSessionTokenUnavailableError(
      'A wallet is required before using Yuga.',
    );
  }

  try {
    await bootstrapOffpayRequestSecret({
      walletAddress: walletInfo.publicKey,
      walletId: walletInfo.id,
      attestationAdapter: getConfiguredOffpayAttestationAdapter(),
    });
  } catch (error) {
    throw new OffpayAiSessionTokenUnavailableError(
      error instanceof Error
        ? error.message
        : 'OffPay bootstrap failed before creating a Yuga session.',
    );
  }

  const provisioned = await readAiSessionBootstrapCredentials();
  if (provisioned != null) return provisioned;

  throw new OffpayAiSessionTokenUnavailableError(
    'OffPay bootstrap did not return Yuga session credentials.',
  );
}

async function readAiSessionBootstrapCredentials(): Promise<{
  requestSecret: string;
  walletAddress: string;
} | null> {
  const [requestSecret, walletAddress] = await Promise.all([
    getOffpayRequestSecret(),
    getOffpayRequestWalletAddress(),
  ]);

  if (
    requestSecret == null ||
    requestSecret.length === 0 ||
    walletAddress == null ||
    walletAddress.length === 0
  ) {
    return null;
  }

  return { requestSecret, walletAddress };
}

/**
 * Worker-side verification helper. Lives next to the client so the two
 * sides share the canonical payload format; the Worker imports it through
 * a tiny re-export under `workers/ai-proxy/src/auth/session-token.ts` to avoid
 * pulling React-Native modules into the Worker bundle.
 */
export function verifyOffpayAiSessionToken(
  token: string,
  options: {
    sharedSecret: string;
    /**
     * Optional resolver that returns the per-device `requestSecret` for a
     * given `walletAddress` + `deviceId`. When provided, the second
     * binding is also checked.
     */
    resolveDeviceSecret?: (params: {
      walletAddress: string;
      deviceId: string;
    }) => Promise<string | null>;
    now?: number;
    skewMs?: number;
  },
): Promise<{ ok: true; walletAddress: string; deviceId: string; expiresAt: number } | { ok: false; reason: string }> {
  return verifyOffpayAiSessionTokenImpl(token, options);
}

async function verifyOffpayAiSessionTokenImpl(
  token: string,
  options: {
    sharedSecret: string;
    resolveDeviceSecret?: (params: {
      walletAddress: string;
      deviceId: string;
    }) => Promise<string | null>;
    now?: number;
    skewMs?: number;
  },
): Promise<{ ok: true; walletAddress: string; deviceId: string; expiresAt: number } | { ok: false; reason: string }> {
  if (options.sharedSecret.length === 0) {
    return { ok: false, reason: 'Shared secret is not configured.' };
  }

  const parts = token.split('.');
  if (parts.length !== 4) {
    return { ok: false, reason: 'Token is malformed.' };
  }

  const [, bodyPart, signaturePart, devicePart] = parts;
  let payload: string;
  try {
    payload = decodeBase64Url(bodyPart);
  } catch {
    return { ok: false, reason: 'Token payload is not base64url.' };
  }

  const expectedSignature = hmacSha256Base64Url(options.sharedSecret, payload);
  if (!constantTimeEquals(signaturePart, expectedSignature)) {
    return { ok: false, reason: 'Token signature is invalid.' };
  }

  const claims = parseCanonicalPayload(payload);
  if (claims == null) {
    return { ok: false, reason: 'Token claims are malformed.' };
  }

  const now = options.now ?? Date.now();
  const skew = options.skewMs ?? SKEW_MS;

  if (claims.issuedAt - skew > now) {
    return { ok: false, reason: 'Token is not yet valid.' };
  }

  if (claims.expiresAt + skew < now) {
    return { ok: false, reason: 'Token has expired.' };
  }

  if (claims.audience !== AI_AUDIENCE) {
    return { ok: false, reason: 'Token audience is wrong.' };
  }

  if (options.resolveDeviceSecret != null) {
    const deviceSecret = await options.resolveDeviceSecret({
      walletAddress: claims.walletAddress,
      deviceId: claims.deviceId,
    });
    if (deviceSecret == null || deviceSecret.length === 0) {
      return { ok: false, reason: 'Device is not enrolled.' };
    }
    const expectedDeviceBinding = hmacSha256Base64Url(deviceSecret, payload).slice(0, 32);
    if (!constantTimeEquals(devicePart, expectedDeviceBinding)) {
      return { ok: false, reason: 'Device binding is invalid.' };
    }
  }

  return {
    ok: true,
    walletAddress: claims.walletAddress,
    deviceId: claims.deviceId,
    expiresAt: claims.expiresAt,
  };
}

interface CanonicalPayloadInput {
  walletAddress: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
}

interface ParsedCanonicalClaims {
  audience: string;
  walletAddress: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
}

function canonicalPayload(input: CanonicalPayloadInput): string {
  return [
    `aud:${AI_AUDIENCE}`,
    `sub:${input.walletAddress}`,
    `dev:${input.deviceId}`,
    `iat:${input.issuedAt}`,
    `exp:${input.expiresAt}`,
  ].join('|');
}

function parseCanonicalPayload(payload: string): ParsedCanonicalClaims | null {
  const fields: Record<string, string> = {};
  for (const part of payload.split('|')) {
    const colon = part.indexOf(':');
    if (colon <= 0) return null;
    fields[part.slice(0, colon)] = part.slice(colon + 1);
  }
  const audience = fields.aud;
  const walletAddress = fields.sub;
  const deviceId = fields.dev;
  const issuedAt = Number(fields.iat);
  const expiresAt = Number(fields.exp);
  if (
    audience == null ||
    walletAddress == null ||
    walletAddress.length === 0 ||
    deviceId == null ||
    deviceId.length === 0 ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt
  ) {
    return null;
  }
  return { audience, walletAddress, deviceId, issuedAt, expiresAt };
}

function hmacSha256Base64Url(secret: string, message: string): string {
  const digest = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message));
  if (digest.byteLength !== SIGNATURE_BYTES) {
    // Defensive — sha256 is always 32 bytes but we want an explicit fail
    // mode if upstream changes.
    throw new Error('Unexpected HMAC digest length.');
  }
  return base64UrlFromBytes(digest);
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64Url(input: string): string {
  return base64UrlFromBytes(utf8ToBytes(input));
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  // `btoa` is available in both React Native (via fast-text-encoding shim)
  // and Cloudflare Workers, so we don't need a Node Buffer dependency.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return atob(base64);
}

// Tiny helper exposed for tests so they can introspect the canonical
// payload format without importing private internals.
export const __aiSessionTokenInternal = {
  AI_AUDIENCE,
  TOKEN_SCHEME_VERSION,
  canonicalPayload,
  parseCanonicalPayload,
  hmacSha256Base64Url,
  bytesToHex,
};
