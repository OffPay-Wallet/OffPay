/**
 * Worker-side verifier for the OffPay AI session token.
 *
 * Mirrors the canonical payload format produced by the client in
 * `lib/agentic-payments/session-token.ts`. We deliberately keep this
 * Worker-only copy instead of importing the RN module, because the client
 * file pulls in SecureStore wrappers that don't compile under the Workers
 * runtime.
 *
 * Token format: header.payload.signature.deviceBinding
 *
 * - `signature` is base64url(HMAC_SHA-256(SHARED_SECRET, payload))
 * - `deviceBinding` is the first 32 chars of base64url(HMAC_SHA-256(per-
 *   device requestSecret, payload)). When the Worker can resolve the
 *   per-device secret (KV/DO lookup) it should additionally check this.
 *   Until the resolver is wired, the binding is recomputed only against
 *   SHARED_SECRET — still binds the request to the issuer, but does not
 *   yet rebind to a specific device.
 */

const AI_AUDIENCE = 'offpay-ai';
const SKEW_MS = 60_000;

export interface OffpayAiSessionVerifyOptions {
  sharedSecret: string;
  /**
   * Optional resolver returning the per-device `requestSecret` for a wallet
   * + device pair. When provided, the second binding is also checked.
   */
  resolveDeviceSecret?: (params: {
    walletAddress: string;
    deviceId: string;
  }) => Promise<string | null>;
  now?: number;
  skewMs?: number;
}

export type OffpayAiSessionVerifyResult =
  | { ok: true; walletAddress: string; deviceId: string; expiresAt: number }
  | { ok: false; reason: string };

export async function verifyOffpayAiSessionToken(
  token: string,
  options: OffpayAiSessionVerifyOptions,
): Promise<OffpayAiSessionVerifyResult> {
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

  const expectedSignature = await hmacSha256Base64Url(options.sharedSecret, payload);
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
    const expectedDeviceBinding = (
      await hmacSha256Base64Url(deviceSecret, payload)
    ).slice(0, 32);
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

interface ParsedCanonicalClaims {
  audience: string;
  walletAddress: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
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
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + padding;
  return atob(base64);
}
