import { AppError } from './errors.js';
import type { Network } from './types.js';

const AI_SESSION_AUDIENCE = 'offpay-ai';
const AI_SESSION_ISSUER = 'offpay-api';
const AI_SESSION_TOKEN_VERSION = 'v2';
const AI_SESSION_TTL_MS = 5 * 60 * 1000;
const MIN_SHARED_SECRET_LENGTH = 32;

interface AiSessionClaims {
  aud: typeof AI_SESSION_AUDIENCE;
  iss: typeof AI_SESSION_ISSUER;
  sub: string;
  dev: string;
  net: Network;
  iat: number;
  exp: number;
  jti: string;
}

export interface IssuedAiSession {
  token: string;
  walletAddress: string;
  network: Network;
  issuedAt: number;
  expiresAt: number;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
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

export async function issueAiSession(params: {
  sharedSecret: string;
  walletAddress: string;
  deviceId: string;
  network: Network;
  now?: number;
}): Promise<IssuedAiSession> {
  const sharedSecret = params.sharedSecret.trim();
  if (sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Yuga session authentication is unavailable.',
      retryable: true,
    });
  }

  const issuedAt = params.now ?? Date.now();
  const expiresAt = issuedAt + AI_SESSION_TTL_MS;
  const claims: AiSessionClaims = {
    aud: AI_SESSION_AUDIENCE,
    iss: AI_SESSION_ISSUER,
    sub: params.walletAddress,
    dev: params.deviceId,
    net: params.network,
    iat: issuedAt,
    exp: expiresAt,
    jti: crypto.randomUUID(),
  };
  const payload = base64UrlFromString(JSON.stringify(claims));
  const signingInput = `${AI_SESSION_TOKEN_VERSION}.${payload}`;
  const signature = await hmacSha256Base64Url(sharedSecret, signingInput);

  return {
    token: `${signingInput}.${signature}`,
    walletAddress: params.walletAddress,
    network: params.network,
    issuedAt,
    expiresAt,
  };
}

export const __aiSessionInternal = {
  AI_SESSION_AUDIENCE,
  AI_SESSION_ISSUER,
  AI_SESSION_TOKEN_VERSION,
  AI_SESSION_TTL_MS,
  MIN_SHARED_SECRET_LENGTH,
};
