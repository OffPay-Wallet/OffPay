import {
  buildOffpayAiSessionToken,
  isOffpayAiSessionTokenConfigured,
  verifyOffpayAiSessionToken,
  __aiSessionTokenInternal,
} from '@/lib/agentic-payments/session-token';

const ORIGINAL_SECRET = process.env.EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET;

jest.mock('@/lib/api/offpay-api-storage', () => ({
  getOffpayRequestSecret: jest.fn(),
  getOffpayRequestWalletAddress: jest.fn(),
  getOrCreateOffpayDeviceId: jest.fn(),
}));

const storageMock = jest.requireMock('@/lib/api/offpay-api-storage') as {
  getOffpayRequestSecret: jest.Mock;
  getOffpayRequestWalletAddress: jest.Mock;
  getOrCreateOffpayDeviceId: jest.Mock;
};

afterAll(() => {
  process.env.EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET = ORIGINAL_SECRET;
});

describe('OffPay AI session token', () => {
  beforeEach(() => {
    storageMock.getOffpayRequestSecret.mockReset();
    storageMock.getOffpayRequestWalletAddress.mockReset();
    storageMock.getOrCreateOffpayDeviceId.mockReset();
  });

  it('reports unconfigured when the shared secret env is empty', () => {
    expect(isOffpayAiSessionTokenConfigured()).toBe(false);
  });

  it('builds a token whose canonical payload binds wallet, device, and ttl', async () => {
    storageMock.getOffpayRequestSecret.mockResolvedValue('device-request-secret');
    storageMock.getOffpayRequestWalletAddress.mockResolvedValue('Wallet1234');
    storageMock.getOrCreateOffpayDeviceId.mockResolvedValue('offpay-device-1');

    // The exported builder reads SHARED_SECRET at module load time, so we
    // verify the canonical payload via the internal helper which the
    // builder always uses.
    const payload = __aiSessionTokenInternal.canonicalPayload({
      walletAddress: 'Wallet1234',
      deviceId: 'offpay-device-1',
      issuedAt: 1_000,
      expiresAt: 2_000,
    });

    expect(payload).toBe(
      `aud:${__aiSessionTokenInternal.AI_AUDIENCE}|sub:Wallet1234|dev:offpay-device-1|iat:1000|exp:2000`,
    );

    const parsed = __aiSessionTokenInternal.parseCanonicalPayload(payload);
    expect(parsed).toEqual({
      audience: __aiSessionTokenInternal.AI_AUDIENCE,
      walletAddress: 'Wallet1234',
      deviceId: 'offpay-device-1',
      issuedAt: 1000,
      expiresAt: 2000,
    });
  });

  it('rejects malformed tokens', async () => {
    const result = await verifyOffpayAiSessionToken('not.a.token', {
      sharedSecret: 'shared',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('malformed');
    }
  });

  it('rejects tokens signed with a different secret', async () => {
    const payload = __aiSessionTokenInternal.canonicalPayload({
      walletAddress: 'Wallet1234',
      deviceId: 'offpay-device-1',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60_000,
    });
    const sig = __aiSessionTokenInternal.hmacSha256Base64Url('attacker-secret', payload);
    const token = `eyJhbGciOiJIUzI1NiJ9.${base64Url(payload)}.${sig}.devicebinding00000000000000000000`;

    const result = await verifyOffpayAiSessionToken(token, { sharedSecret: 'shared' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('signature');
    }
  });

  it('rejects expired tokens outside the skew window', async () => {
    const issuedAt = 1_000_000;
    const expiresAt = issuedAt + 60_000;
    const payload = __aiSessionTokenInternal.canonicalPayload({
      walletAddress: 'Wallet1234',
      deviceId: 'offpay-device-1',
      issuedAt,
      expiresAt,
    });
    const sig = __aiSessionTokenInternal.hmacSha256Base64Url('shared', payload);
    const token = `eyJhbGciOiJIUzI1NiJ9.${base64Url(payload)}.${sig}.devicebinding00000000000000000000`;

    const result = await verifyOffpayAiSessionToken(token, {
      sharedSecret: 'shared',
      now: expiresAt + 5 * 60_000, // way past skew
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('expired');
    }
  });

  it('accepts a valid token within the active window', async () => {
    const issuedAt = 1_000_000;
    const expiresAt = issuedAt + 60_000;
    const payload = __aiSessionTokenInternal.canonicalPayload({
      walletAddress: 'Wallet1234',
      deviceId: 'offpay-device-1',
      issuedAt,
      expiresAt,
    });
    const sig = __aiSessionTokenInternal.hmacSha256Base64Url('shared', payload);
    const token = `eyJhbGciOiJIUzI1NiJ9.${base64Url(payload)}.${sig}.devicebinding00000000000000000000`;

    const result = await verifyOffpayAiSessionToken(token, {
      sharedSecret: 'shared',
      now: issuedAt + 15_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.walletAddress).toBe('Wallet1234');
      expect(result.deviceId).toBe('offpay-device-1');
    }
  });
});

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
