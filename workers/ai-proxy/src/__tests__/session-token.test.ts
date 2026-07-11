import { verifyOffpayAiSessionToken } from '../auth/session-token';

const SHARED_SECRET = 'shared-secret-for-test-at-least-32-characters';
const WALLET = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';

describe('Worker session-token verifier', () => {
  it('rejects malformed tokens and weak server configuration', async () => {
    await expect(
      verifyOffpayAiSessionToken('not.a.token', { sharedSecret: SHARED_SECRET }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('malformed') });
    await expect(
      verifyOffpayAiSessionToken('v2.payload.signature', { sharedSecret: 'too-short' }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('securely') });
  });

  it('accepts a valid API-issued mainnet token', async () => {
    const issuedAt = Date.now();
    const token = await buildToken({ issuedAt, expiresAt: issuedAt + 60_000 });
    await expect(
      verifyOffpayAiSessionToken(token, {
        sharedSecret: SHARED_SECRET,
        now: issuedAt + 1_000,
      }),
    ).resolves.toEqual({
      ok: true,
      walletAddress: WALLET,
      deviceId: 'device-alpha',
      network: 'mainnet',
      expiresAt: issuedAt + 60_000,
    });
  });

  it('rejects a token signed with another secret', async () => {
    const issuedAt = Date.now();
    const token = await buildToken({
      issuedAt,
      expiresAt: issuedAt + 60_000,
      sharedSecret: 'attacker-secret-at-least-32-characters',
    });
    await expect(
      verifyOffpayAiSessionToken(token, { sharedSecret: SHARED_SECRET, now: issuedAt }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('signature') });
  });

  it('rejects expired, future, and overlong sessions', async () => {
    const issuedAt = 1_000_000;
    const expired = await buildToken({ issuedAt, expiresAt: issuedAt + 60_000 });
    await expect(
      verifyOffpayAiSessionToken(expired, {
        sharedSecret: SHARED_SECRET,
        now: issuedAt + 120_000,
        skewMs: 0,
      }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('expired') });

    const future = await buildToken({ issuedAt, expiresAt: issuedAt + 60_000 });
    await expect(
      verifyOffpayAiSessionToken(future, {
        sharedSecret: SHARED_SECRET,
        now: issuedAt - 1,
        skewMs: 0,
      }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('not yet') });

    const overlong = await buildToken({ issuedAt, expiresAt: issuedAt + 6 * 60_000 });
    await expect(
      verifyOffpayAiSessionToken(overlong, {
        sharedSecret: SHARED_SECRET,
        now: issuedAt,
        skewMs: 0,
      }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('lifetime') });
  });
});

async function buildToken(params: {
  issuedAt: number;
  expiresAt: number;
  sharedSecret?: string;
}): Promise<string> {
  const claims = {
    aud: 'offpay-ai',
    iss: 'offpay-api',
    sub: WALLET,
    dev: 'device-alpha',
    net: 'mainnet',
    iat: params.issuedAt,
    exp: params.expiresAt,
    jti: '00000000-0000-4000-8000-000000000000',
  };
  const payload = base64Url(JSON.stringify(claims));
  const signingInput = `v2.${payload}`;
  const signature = await hmacBase64Url(params.sharedSecret ?? SHARED_SECRET, signingInput);
  return `${signingInput}.${signature}`;
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
  return Buffer.from(bytes).toString('base64url');
}
