const AI_SESSION_AUDIENCE = 'offpay-ai';
const AI_SESSION_ISSUER = 'offpay-api';
const AI_SESSION_TOKEN_VERSION = 'v2';
const MAX_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SKEW_MS = 30_000;
const MIN_SHARED_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 2_048;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface OffpayAiSessionVerifyOptions {
  sharedSecret: string;
  now?: number;
  skewMs?: number;
}

export type OffpayAiSessionNetwork = 'mainnet' | 'devnet';

export type OffpayAiSessionVerifyResult =
  | {
      ok: true;
      walletAddress: string;
      deviceId: string;
      network: OffpayAiSessionNetwork;
      expiresAt: number;
    }
  | { ok: false; reason: string };

interface AiSessionClaims {
  aud: typeof AI_SESSION_AUDIENCE;
  iss: typeof AI_SESSION_ISSUER;
  sub: string;
  dev: string;
  net: OffpayAiSessionNetwork;
  iat: number;
  exp: number;
  jti: string;
}

export async function verifyOffpayAiSessionToken(
  token: string,
  options: OffpayAiSessionVerifyOptions,
): Promise<OffpayAiSessionVerifyResult> {
  const sharedSecret = options.sharedSecret.trim();
  if (sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
    return { ok: false, reason: 'Shared secret is not configured securely.' };
  }
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'Token is malformed.' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Token is malformed.' };
  const [version, payloadPart, signaturePart] = parts;
  if (
    version !== AI_SESSION_TOKEN_VERSION ||
    !BASE64_URL_PATTERN.test(payloadPart) ||
    !BASE64_URL_PATTERN.test(signaturePart)
  ) {
    return { ok: false, reason: 'Token is malformed.' };
  }

  const signingInput = `${version}.${payloadPart}`;
  const expectedSignature = await hmacSha256Base64Url(sharedSecret, signingInput);
  if (!constantTimeEquals(signaturePart, expectedSignature)) {
    return { ok: false, reason: 'Token signature is invalid.' };
  }

  const claims = parseClaims(payloadPart);
  if (claims == null) return { ok: false, reason: 'Token claims are malformed.' };

  const now = options.now ?? Date.now();
  const skew = Math.max(0, options.skewMs ?? DEFAULT_SKEW_MS);
  if (claims.iat - skew > now) return { ok: false, reason: 'Token is not yet valid.' };
  if (claims.exp + skew < now) return { ok: false, reason: 'Token has expired.' };
  if (claims.exp - claims.iat > MAX_TOKEN_TTL_MS) {
    return { ok: false, reason: 'Token lifetime is invalid.' };
  }

  return {
    ok: true,
    walletAddress: claims.sub,
    deviceId: claims.dev,
    network: claims.net,
    expiresAt: claims.exp,
  };
}

function parseClaims(payloadPart: string): AiSessionClaims | null {
  let value: unknown;
  try {
    value = JSON.parse(decodeBase64Url(payloadPart));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value == null) return null;
  const claims = value as Partial<AiSessionClaims>;
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  if (
    claims.aud !== AI_SESSION_AUDIENCE ||
    claims.iss !== AI_SESSION_ISSUER ||
    typeof claims.sub !== 'string' ||
    claims.sub.length < 32 ||
    claims.sub.length > 64 ||
    typeof claims.dev !== 'string' ||
    claims.dev.length === 0 ||
    claims.dev.length > 128 ||
    (claims.net !== 'mainnet' && claims.net !== 'devnet') ||
    typeof issuedAt !== 'number' ||
    !Number.isInteger(issuedAt) ||
    typeof expiresAt !== 'number' ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    typeof claims.jti !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(claims.jti)
  ) {
    return null;
  }
  return claims as AiSessionClaims;
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlFromBytes(new Uint8Array(signature));
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
  );
}

export const __aiSessionVerifierInternal = {
  AI_SESSION_AUDIENCE,
  AI_SESSION_ISSUER,
  AI_SESSION_TOKEN_VERSION,
  MAX_TOKEN_TTL_MS,
  MIN_SHARED_SECRET_LENGTH,
};
