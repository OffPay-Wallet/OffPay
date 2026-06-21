const mockClearOffpayBootstrapCredentials = jest.fn(async () => undefined);
const mockGetOffpayBootstrapVersion = jest.fn<Promise<number | null>, []>(async () => 7);
const mockGetOffpayRequestSecret = jest.fn<Promise<string | null>, []>(
  async () => 'request-secret',
);
const mockGetOffpayRequestWalletAddress = jest.fn<Promise<string | null>, []>(
  async () => 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
);
const mockGetOrCreateOffpayDeviceId = jest.fn(async () => 'device-1');

const mockGetStoredWalletInfo = jest.fn(async () => ({
  id: 'wallet-1',
  publicKey: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
  importMethod: 'generated',
}));
const mockGetStoredWalletSigningMaterialWithAuth = jest.fn(async () => ({
  mnemonic: null,
  privateKey: 'private-key',
}));

const mockDecodeSigningSeedFromPrivateKey = jest.fn(() => new Uint8Array(32).fill(7));
const mockDeriveSigningSeedFromMnemonic = jest.fn(async () => new Uint8Array(32).fill(9));

jest.mock('@/lib/api/offpay-api-storage', () => ({
  __esModule: true,
  clearOffpayBootstrapCredentials: mockClearOffpayBootstrapCredentials,
  getOffpayBootstrapVersion: mockGetOffpayBootstrapVersion,
  getOffpayRequestSecret: mockGetOffpayRequestSecret,
  getOffpayRequestWalletAddress: mockGetOffpayRequestWalletAddress,
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

const {
  OFFPAY_APP_VERSION,
  OffpayApiError,
  buildOffpayPublicReadHeaders,
  clearOffpaySigningSession,
  getStreamCapabilities,
  getSwapTokens,
  getWalletBalance,
  getWalletTokenTransactions,
  getWalletTransactions,
  offpayPublicFetch,
  offpayApiRequest,
  setOffpayNetworkAccessAllowed,
  setOffpayAuthRecoveryHandler,
} = require('@/lib/api/offpay-api-client') as typeof import('@/lib/api/offpay-api-client');
const { fetchAlchemyTokenUsdPricesBatch } =
  require('@/lib/api/alchemy-prices-api') as typeof import('@/lib/api/alchemy-prices-api');

function buildResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('offpay-api-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOffpayRequestSecret.mockResolvedValue('request-secret');
    mockGetOffpayRequestWalletAddress.mockResolvedValue(
      'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
    );
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

  it('normalizes native fetch failures into retryable OffPay API errors', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: Fetch request has been canceled'));

    await expect(
      getWalletBalance('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw', 'devnet'),
    ).rejects.toMatchObject({
      name: 'OffpayApiError',
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Network request failed. Check your connection and try again.',
      retryable: true,
    });
  });

  it('forces bootstrap recovery when stored credentials belong to another wallet', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const recovery = jest.fn(async () => undefined);
    setOffpayAuthRecoveryHandler(recovery);
    mockGetOffpayRequestWalletAddress
      .mockResolvedValueOnce('DifferentWallet111111111111111111111111111111')
      .mockResolvedValueOnce('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw');
    fetchMock.mockResolvedValueOnce(buildResponse({ ok: true }));

    await expect(
      offpayApiRequest<{ ok: true }>({
        path: '/api/payment/private-balance',
        network: 'devnet',
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(recovery).toHaveBeenCalledTimes(1);
    expect(mockClearOffpayBootstrapCredentials).toHaveBeenCalledTimes(1);
  });

  it('routes wallet balance requests through the API Worker', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
        network: 'devnet',
        solBalance: 0,
        tokens: [],
        fetchedAt: 123,
      }),
    );

    await expect(
      getWalletBalance('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw', 'devnet', {
        useCache: false,
      }),
    ).resolves.toMatchObject({
      address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      network: 'devnet',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/wallet/balance?'),
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('network=devnet'));
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('address=Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw'),
    );
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('routes wallet transactions without requiring local signing material', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
        network: 'mainnet',
        transactions: [],
        cursor: null,
        fetchedAt: 123,
      }),
    );

    await expect(
      getWalletTransactions('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw', 'mainnet', {
        limit: 20,
      }),
    ).resolves.toMatchObject({
      address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      network: 'mainnet',
      transactions: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/wallet/transactions?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('network=mainnet'));
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('limit=20'));
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('routes token-specific wallet transactions without requiring local signing material', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
        network: 'devnet',
        transactions: [],
        cursor: null,
        fetchedAt: 123,
      }),
    );

    await expect(
      getWalletTokenTransactions(
        'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
        'devnet',
        'So11111111111111111111111111111111111111112',
        {
          limit: 8,
          useCache: false,
        },
      ),
    ).resolves.toMatchObject({
      address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      network: 'devnet',
      transactions: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/wallet/token-transactions?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('network=devnet'));
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('limit=8'));
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('useCache=false'));
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('mint=So11111111111111111111111111111111111111112'),
    );
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('routes read-only swap token metadata without requiring local signing material', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        network: 'devnet',
        tokens: [],
      }),
    );

    await expect(getSwapTokens('devnet')).resolves.toMatchObject({
      network: 'devnet',
      tokens: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/swap/tokens?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('network=devnet'));
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('uses HMAC-only protected API auth for external wallets', async () => {
    mockGetStoredWalletInfo.mockResolvedValueOnce({
      id: 'wallet-privy',
      publicKey: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      importMethod: 'privy-embedded',
    });
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(buildResponse({ ok: true }));

    await expect(
      offpayApiRequest({
        path: '/api/payment/private-balance',
        query: {
          wallet: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
          network: 'devnet',
        },
        network: 'devnet',
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/payment/private-balance?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-App-Auth-Mode': 'hmac-v2',
          'X-App-HMAC': expect.any(String),
          'X-Wallet-Address': 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('routes stream capabilities without requiring local signing material', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        network: 'devnet',
        provider: 'helius',
        capabilities: {
          walletActivity: true,
        },
      }),
    );

    await expect(getStreamCapabilities('devnet')).resolves.toMatchObject({
      network: 'devnet',
      capabilities: {
        walletActivity: true,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/stream/capabilities?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('network=devnet'));
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('opens public wallet activity streams without wallet signing material', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(buildResponse({ ok: true }));

    await expect(
      offpayPublicFetch({
        path: '/api/stream/wallet-activity',
        query: {
          wallet: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
          network: 'devnet',
        },
        accept: 'text/event-stream',
        headers: await buildOffpayPublicReadHeaders(),
        timeoutMs: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/stream/wallet-activity?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('network=devnet'));
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining('wallet=Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw'),
    );
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('routes batch token valuation reads without wallet signing material', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      buildResponse({
        network: 'mainnet',
        currency: 'USD',
        rate: 1,
        fetchedAt: 123,
        unitUsdPrices: {
          So11111111111111111111111111111111111111112: 92,
        },
        pricedCount: 1,
        expectedCount: 1,
      }),
    );

    await expect(
      fetchAlchemyTokenUsdPricesBatch({
        network: 'mainnet',
        currency: 'USD',
        tokens: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            priceSymbol: 'SOL',
          },
        ],
      }),
    ).resolves.toMatchObject({
      network: 'mainnet',
      currency: 'USD',
      rate: 1,
      unitUsdPrices: {
        So11111111111111111111111111111111111111112: 92,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/market/token-prices-batch'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-App-Version': OFFPAY_APP_VERSION,
          'X-Device-Id': 'device-1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'X-Signature': expect.any(String),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        network: 'mainnet',
        currency: 'USD',
        tokens: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            priceSymbol: 'SOL',
          },
        ],
      }),
    );
    expect(mockGetStoredWalletSigningMaterialWithAuth).not.toHaveBeenCalled();
  });

  it('reprovisions once when bootstrap credentials are missing locally', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const reprovisionAuth = jest.fn(async () => undefined);
    mockGetOffpayRequestSecret.mockResolvedValueOnce(null).mockResolvedValueOnce('request-secret');
    mockGetOffpayBootstrapVersion.mockResolvedValueOnce(null).mockResolvedValueOnce(7);
    fetchMock.mockResolvedValueOnce(
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
