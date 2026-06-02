const mockFetchAlchemyTokenUsdPrice = jest.fn();
const mockFetchAlchemyHistoricalTokenUsdPrices = jest.fn();

jest.mock('@/lib/api/alchemy-prices-api', () => ({
  __esModule: true,
  fetchAlchemyTokenUsdPrice: mockFetchAlchemyTokenUsdPrice,
  fetchAlchemyHistoricalTokenUsdPrices: mockFetchAlchemyHistoricalTokenUsdPrices,
}));

const { getTokenUsdPriceForValuation, getTokenUsdPriceHistory } =
  require('@/lib/market-prices') as typeof import('@/lib/market-prices');

describe('market price valuation resolver', () => {
  beforeEach(() => {
    mockFetchAlchemyTokenUsdPrice.mockReset();
    mockFetchAlchemyHistoricalTokenUsdPrices.mockReset();
  });

  it('uses Alchemy address pricing first for mainnet SPL tokens', async () => {
    mockFetchAlchemyTokenUsdPrice.mockResolvedValueOnce({
      value: 1.02,
      lastUpdatedAt: '2026-06-02T00:00:00Z',
    });

    await expect(
      getTokenUsdPriceForValuation({
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        network: 'mainnet',
        symbol: 'USDC',
        priceSymbol: 'USDC',
      }),
    ).resolves.toBe(1.02);

    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenCalledTimes(1);
    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenCalledWith(
      {
        type: 'address',
        network: 'solana-mainnet',
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
      { signal: undefined },
    );
  });

  it('falls back to Alchemy symbol pricing when address pricing is missing', async () => {
    mockFetchAlchemyTokenUsdPrice.mockResolvedValueOnce(null).mockResolvedValueOnce({
      value: 92,
      lastUpdatedAt: '2026-06-02T00:00:00Z',
    });

    await expect(
      getTokenUsdPriceForValuation({
        mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        network: 'mainnet',
        symbol: 'SOL',
        priceSymbol: 'SOL',
      }),
    ).resolves.toBe(92);

    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenNthCalledWith(
      1,
      {
        type: 'address',
        network: 'solana-mainnet',
        address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      },
      { signal: undefined },
    );
    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenNthCalledWith(
      2,
      { type: 'symbol', symbol: 'SOL' },
      { signal: undefined },
    );
  });

  it('uses the market alias for devnet test tokens instead of a devnet address lookup', async () => {
    mockFetchAlchemyTokenUsdPrice.mockResolvedValueOnce({
      value: 1,
      lastUpdatedAt: '2026-06-02T00:00:00Z',
    });

    await expect(
      getTokenUsdPriceForValuation({
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        network: 'devnet',
        symbol: 'dUSDC',
        priceSymbol: 'USDC',
      }),
    ).resolves.toBe(1);

    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenCalledTimes(1);
    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenCalledWith(
      { type: 'symbol', symbol: 'USDC' },
      { signal: undefined },
    );
  });

  it('normalizes wrapped SOL to SOL symbol pricing for native valuations', async () => {
    mockFetchAlchemyTokenUsdPrice.mockResolvedValueOnce({
      value: 91,
      lastUpdatedAt: '2026-06-02T00:00:00Z',
    });

    await expect(
      getTokenUsdPriceForValuation({
        mint: 'So11111111111111111111111111111111111111112',
        network: 'mainnet',
        symbol: 'wSOL',
        priceSymbol: 'wSOL',
      }),
    ).resolves.toBe(91);

    expect(mockFetchAlchemyTokenUsdPrice).toHaveBeenCalledWith(
      { type: 'symbol', symbol: 'SOL' },
      { signal: undefined },
    );
  });
});

describe('market price history resolver', () => {
  beforeEach(() => {
    mockFetchAlchemyTokenUsdPrice.mockReset();
    mockFetchAlchemyHistoricalTokenUsdPrices.mockReset();
  });

  it('falls back to symbol history after an empty address history response', async () => {
    const history = [
      {
        value: 90,
        timestamp: 1780000000000,
        timestampIso: '2026-06-01T00:00:00Z',
        marketCap: null,
        totalVolume: null,
      },
    ];
    mockFetchAlchemyHistoricalTokenUsdPrices.mockResolvedValueOnce([]);
    mockFetchAlchemyHistoricalTokenUsdPrices.mockResolvedValueOnce(history);

    await expect(
      getTokenUsdPriceHistory({
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        network: 'mainnet',
        symbol: 'USDC',
        priceSymbol: 'USDC',
        startTime: '2026-05-26T00:00:00Z',
        endTime: '2026-06-02T00:00:00Z',
        interval: '5m',
        withMarketData: true,
      }),
    ).resolves.toEqual(history);

    expect(mockFetchAlchemyHistoricalTokenUsdPrices).toHaveBeenNthCalledWith(
      1,
      {
        type: 'address',
        network: 'solana-mainnet',
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
      {
        startTime: '2026-05-26T00:00:00Z',
        endTime: '2026-06-02T00:00:00Z',
        interval: '5m',
        withMarketData: true,
      },
      { signal: undefined },
    );
    expect(mockFetchAlchemyHistoricalTokenUsdPrices).toHaveBeenNthCalledWith(
      2,
      { type: 'symbol', symbol: 'USDC' },
      {
        startTime: '2026-05-26T00:00:00Z',
        endTime: '2026-06-02T00:00:00Z',
        interval: '5m',
        withMarketData: true,
      },
      { signal: undefined },
    );
  });
});
