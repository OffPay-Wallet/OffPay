const mockGetSwapPrice = jest.fn();

jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  getSwapPrice: mockGetSwapPrice,
}));

const { getTokenUsdPriceForValuation } = require('@/lib/market-prices') as typeof import('@/lib/market-prices');

function priceResponse(mint: string, price: number) {
  return {
    mint,
    price,
    currency: 'USD' as const,
    fetchedAt: 123,
  };
}

describe('market price valuation resolver', () => {
  beforeEach(() => {
    mockGetSwapPrice.mockReset();
  });

  it('uses the active network price when it is available', async () => {
    mockGetSwapPrice.mockResolvedValueOnce(priceResponse('So11111111111111111111111111111111111111112', 85));

    await expect(
      getTokenUsdPriceForValuation({
        mint: 'So11111111111111111111111111111111111111112',
        network: 'devnet',
      }),
    ).resolves.toBe(85);

    expect(mockGetSwapPrice).toHaveBeenCalledTimes(1);
    expect(mockGetSwapPrice).toHaveBeenCalledWith(
      'So11111111111111111111111111111111111111112',
      'devnet',
    );
  });

  it('falls back from devnet to the market network for the exact same mint', async () => {
    mockGetSwapPrice
      .mockRejectedValueOnce(new Error('devnet price unavailable'))
      .mockResolvedValueOnce(priceResponse('So11111111111111111111111111111111111111112', 86));

    await expect(
      getTokenUsdPriceForValuation({
        mint: 'So11111111111111111111111111111111111111112',
        network: 'devnet',
      }),
    ).resolves.toBe(86);

    expect(mockGetSwapPrice).toHaveBeenNthCalledWith(
      1,
      'So11111111111111111111111111111111111111112',
      'devnet',
    );
    expect(mockGetSwapPrice).toHaveBeenNthCalledWith(
      2,
      'So11111111111111111111111111111111111111112',
      'mainnet',
    );
  });

  it('does not retry mainnet against itself', async () => {
    mockGetSwapPrice.mockRejectedValueOnce(new Error('mainnet price unavailable'));

    await expect(
      getTokenUsdPriceForValuation({
        mint: 'MissingMint111111111111111111111111111111111',
        network: 'mainnet',
      }),
    ).resolves.toBeNull();

    expect(mockGetSwapPrice).toHaveBeenCalledTimes(1);
  });
});
