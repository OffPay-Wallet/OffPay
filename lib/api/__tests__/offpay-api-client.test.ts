const mockClearOffpayBootstrapCredentials = jest.fn(async () => undefined);
const mockGetOffpayBootstrapVersion = jest.fn(async () => 7);
const mockGetOffpayRequestSecret = jest.fn(async () => 'request-secret');
const mockGetOrCreateOffpayDeviceId = jest.fn(async () => 'device-1');

const mockGetStoredWalletInfo = jest.fn(async () => ({
  id: 'wallet-1',
  publicKey: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
}));
const mockGetStoredWalletSigningMaterialWithAuth = jest.fn(async () => ({
  mnemonic: null,
  privateKey: 'private-key',
}));

const mockDecodeSigningSeedFromPrivateKey = jest.fn(() => new Uint8Array(32).fill(7));
const mockDeriveSigningSeedFromMnemonic = jest.fn(async () => new Uint8Array(32).fill(9));
const mockProviderGetWalletBalance = jest.fn(async () => ({
  address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
  network: 'devnet',
  solBalance: 0,
  tokens: [],
  fetchedAt: 123,
}));

jest.mock('@/lib/api/offpay-api-storage', () => ({
  __esModule: true,
  clearOffpayBootstrapCredentials: mockClearOffpayBootstrapCredentials,
  getOffpayBootstrapVersion: mockGetOffpayBootstrapVersion,
  getOffpayRequestSecret: mockGetOffpayRequestSecret,
  getOrCreateOffpayDeviceId: mockGetOrCreateOffpayDeviceId,
  storeOffpayBootstrapCredentials: jest.fn(async () => undefined),
}));

jest.mock('@/lib/wallet/secure-wallet-store', () => ({
  __esModule: true,
  getStoredWalletInfo: mockGetStoredWalletInfo,
  getStoredWalletSigningMaterialWithAuth: mockGetStoredWalletSigningMaterialWithAuth,
}));

jest.mock('@/lib/wallet/wallet', () => ({
  __esModule: true,
  decodeSigningSeedFromPrivateKey: mockDecodeSigningSeedFromPrivateKey,
  deriveSigningSeedFromMnemonic: mockDeriveSigningSeedFromMnemonic,
}));

// `offpay-api-client.deriveSigningSeedWithAuth` calls
// `getOrDeriveSigningSeed` and then verifies that
// `ed25519.getPublicKey(seed)` base58-encodes to the active wallet
// address. The test wallet's mocked `decodeSigningSeedFromPrivateKey`
// returns a deterministic 32-byte fill that doesn't actually derive
// the test wallet's public key, which would make verification fail
// before the auth flow we're trying to exercise can run.
//
// Mocking the cache hatch keeps the test focused on the auth-recovery
// behavior under test and skips the verification path. Verification
// itself is exercised at runtime and on real-device traces (cache
// hit/miss numbers were validated separately in Task 2E).
jest.mock('@/lib/wallet/signing-seed-cache', () => ({
  __esModule: true,
  getOrDeriveSigningSeed: jest.fn(async () => new Uint8Array(32).fill(7)),
  clearSigningSeedCache: jest.fn(),
  SigningSeedCacheInvalidatedError: class extends Error {},
}));

jest.mock('@/services/rpc', () => ({
  __esModule: true,
  broadcastRawTransaction: jest.fn(),
  getMinimumBalanceForRentExemption: jest.fn(),
  getRpcAccounts: jest.fn(),
  getRpcEpochInfo: jest.fn(),
  getRpcLatestBlockhash: jest.fn(),
  getRpcSignatureStatuses: jest.fn(),
  getRpcSignaturesForAddress: jest.fn(),
  getRpcSlot: jest.fn(),
  getRpcTokenLargestAccounts: jest.fn(),
  getWalletBalance: mockProviderGetWalletBalance,
  getWalletLamports: jest.fn(),
  getWalletTransactions: jest.fn(),
  hasConfiguredHttpProvider: jest.fn(() => true),
  hasConfiguredWsProvider: jest.fn(() => true),
}));

const {
  OFFPAY_APP_VERSION,
  OffpayApiError,
  clearOffpaySigningSession,
  getWalletBalance,
  offpayApiRequest,
  setOffpayNetworkAccessAllowed,
  setOffpayAuthRecoveryHandler,
} = require('@/lib/api/offpay-api-client') as typeof import('@/lib/api/offpay-api-client');

function buildResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('offpay-api-client', () => {
  beforeEach(() => {
    clearOffpaySigningSession();
    setOffpayAuthRecoveryHandler(null);
    setOffpayNetworkAccessAllowed(true);
  });

  afterEach(() => {
    setOffpayNetworkAccessAllowed(true);
  });

  it('uses Expo metadata for the runtime app version', () => {
    expect(OFFPAY_APP_VERSION).toBe('9.9.9-test');
  });

  it('does not clear bootstrap credentials when auth recovery is unavailable', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse(
        {
          error: {
            code: 'SECRET_ROTATED',
            message: 'Secret rotated.',
            retryable: true,
            retryAfterMs: 0,
          },
        },
        401,
      ),
    );

    await expect(
      offpayApiRequest({
        path: '/api/swap/tokens',
        network: 'mainnet',
      }),
    ).rejects.toBeInstanceOf(OffpayApiError);

    expect(mockClearOffpayBootstrapCredentials).not.toHaveBeenCalled();
  });

  it('blocks OffPay API requests before fetch when offline mode disables network access', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    setOffpayNetworkAccessAllowed(false);

    await expect(
      offpayApiRequest({
        path: '/api/swap/tokens',
        network: 'mainnet',
      }),
    ).rejects.toMatchObject({
      name: 'OffpayApiError',
      code: 'UPSTREAM_UNAVAILABLE',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes wallet balance requests through the client provider router', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;

    await expect(
      getWalletBalance('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw', 'devnet', {
        useCache: false,
      }),
    ).resolves.toMatchObject({
      address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      network: 'devnet',
    });

    expect(mockProviderGetWalletBalance).toHaveBeenCalledWith(
      'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      'devnet',
      { signal: undefined },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears credentials and retries once when auth recovery is available', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const reprovisionAuth = jest.fn(async () => undefined);
    fetchMock
      .mockResolvedValueOnce(
        buildResponse(
          {
            error: {
              code: 'SECRET_ROTATED',
              message: 'Secret rotated.',
              retryable: true,
              retryAfterMs: 0,
            },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(
        buildResponse({
          ok: true,
          network: 'mainnet',
        }),
      );

    await expect(
      offpayApiRequest<{ ok: boolean; network: string }>({
        path: '/api/swap/tokens',
        network: 'mainnet',
        reprovisionAuth,
      }),
    ).resolves.toEqual({
      ok: true,
      network: 'mainnet',
    });

    expect(mockClearOffpayBootstrapCredentials).toHaveBeenCalledTimes(1);
    expect(reprovisionAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
