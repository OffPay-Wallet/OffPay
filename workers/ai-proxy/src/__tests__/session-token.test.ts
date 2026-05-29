import { verifyOffpayAiSessionToken } from '../auth/session-token';

const SHARED_SECRET = 'shared-secret-for-test';
const DEVICE_SECRET = 'device-secret';

describe('Worker session-token verifier', () => {
  it('rejects malformed tokens', async () => {
    const result = await verifyOffpayAiSessionToken('not.a.token', {
      sharedSecret: SHARED_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('malformed');
    }
  });

  it('accepts a valid token built with the same shared secret', async () => {
    const token = await buildToken({
      walletAddress: 'WalletAlpha',
      deviceId: 'device-alpha',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sharedSecret: SHARED_SECRET,
    });

    const result = await verifyOffpayAiSessionToken(token, {
      sharedSecret: SHARED_SECRET,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.walletAddress).toBe('WalletAlpha');
      expect(result.deviceId).toBe('device-alpha');
    }
  });

  it('rejects a token whose signature was made with a different secret', async () => {
    const token = await buildToken({
      walletAddress: 'WalletAlpha',
      deviceId: 'device-alpha',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sharedSecret: 'attacker-secret',
    });

    const result = await verifyOffpayAiSessionToken(token, {
      sharedSecret: SHARED_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('signature');
    }
  });

  it('checks the device binding when a resolver is provided', async () => {
    const token = await buildToken({
      walletAddress: 'WalletAlpha',
      deviceId: 'device-alpha',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sharedSecret: SHARED_SECRET,
      deviceSecret: DEVICE_SECRET,
    });

    const result = await verifyOffpayAiSessionToken(token, {
      sharedSecret: SHARED_SECRET,
      resolveDeviceSecret: async ({ walletAddress, deviceId }) => {
        if (walletAddress === 'WalletAlpha' && deviceId === 'device-alpha') {
          return DEVICE_SECRET;
        }
        return null;
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects when the resolver supplies a different device secret', async () => {
    const token = await buildToken({
      walletAddress: 'WalletAlpha',
      deviceId: 'device-alpha',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      sharedSecret: SHARED_SECRET,
      deviceSecret: DEVICE_SECRET,
    });

    const result = await verifyOffpayAiSessionToken(token, {
      sharedSecret: SHARED_SECRET,
      resolveDeviceSecret: async () => 'different-device-secret',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('binding');
    }
  });
});

interface BuildTokenParams {
  walletAddress: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
  sharedSecret: string;
  deviceSecret?: string;
}

async function buildToken(params: BuildTokenParams): Promise<string> {
  const payload = `aud:offpay-ai|sub:${params.walletAddress}|dev:${params.deviceId}|iat:${params.issuedAt}|exp:${params.expiresAt}`;
  const signature = await hmacBase64Url(params.sharedSecret, payload);
  const deviceBinding = (
    await hmacBase64Url(params.deviceSecret ?? params.sharedSecret, payload)
  ).slice(0, 32);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'OFFPAY_AI', ver: 'v1' }));
  return `${header}.${base64Url(payload)}.${signature}.${deviceBinding}`;
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
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

function base64Url(input: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(input));
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
