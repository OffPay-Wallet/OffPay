import { FlashTradeApiError, FlashTradeClient } from '@/lib/flash-trade/client';

const originalFetch = global.fetch;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FlashTradeClient V2', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses only current root endpoints and passes abort signals to every market read', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/pool-data') return jsonResponse({ pools: [] });
      if (path === '/raw/markets') return jsonResponse([]);
      if (path === '/tokens') return jsonResponse([]);
      if (path === '/prices') return jsonResponse({});
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new FlashTradeClient({ baseUrl: 'https://flash.example', timeoutMs: 1000 });
    await expect(client.getMarkets()).resolves.toEqual([]);

    const requests = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requests).toEqual(
      expect.arrayContaining([
        'https://flash.example/pool-data',
        'https://flash.example/raw/markets',
        'https://flash.example/tokens',
        'https://flash.example/prices',
      ]),
    );
    expect(requests.some((url) => url.includes('/v1/'))).toBe(false);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('derives and validates the side-specific execution market from live raw-market data', async () => {
    const marketPubkey = '11111111111111111111111111111111';
    const poolPubkey = 'SysvarC1ock11111111111111111111111111111111';
    const targetCustody = 'SysvarRent111111111111111111111111111111111';
    const collateralCustody = 'SysvarRecentB1ockHashes11111111111111111111';
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === `/raw/markets/${marketPubkey}`) {
        return jsonResponse({
          pubkey: marketPubkey,
          account: {
            side: 'Long',
            pool: poolPubkey,
            targetCustody,
            collateralCustody,
          },
        });
      }
      if (path === `/pool-data/${poolPubkey}`) {
        return jsonResponse({
          poolAddress: poolPubkey,
          custodyStats: [{ symbol: 'USDC', custodyAccount: collateralCustody }],
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new FlashTradeClient({ baseUrl: 'https://flash.example' });

    await expect(client.getMarketExecutionAccounts(marketPubkey)).resolves.toMatchObject({
      side: 'long',
      marketPubkey,
      poolPubkey,
      targetCustodyPubkey: targetCustody,
      collateralCustodyPubkey: collateralCustody,
    });
  });

  it('posts the official V2 open schema to the root transaction builder', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        newLeverage: '5.01',
        newEntryPrice: '80',
        newLiquidationPrice: '64',
        entryFee: '0.01',
        entryFeeBeforeDiscount: '0.01',
        openPositionFeePercent: '0.02',
        availableLiquidity: '1000',
        youPayUsdUi: '10.99',
        youRecieveUsdUi: '54.95',
        marginFeePercentage: '0.001',
        outputAmount: '1',
        outputAmountUi: '0.68',
        transactionBase64: 'base64',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new FlashTradeClient({ baseUrl: 'https://flash.example' });

    await client.openPosition({
      inputTokenSymbol: 'USDC',
      outputTokenSymbol: 'SOL',
      inputAmountUi: '11',
      leverage: 5,
      tradeType: 'LONG',
      orderType: 'MARKET',
      owner: 'wallet',
      slippagePercentage: '0.5',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://flash.example/transaction-builder/open-position',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          inputTokenSymbol: 'USDC',
          outputTokenSymbol: 'SOL',
          inputAmountUi: '11',
          leverage: 5,
          tradeType: 'LONG',
          orderType: 'MARKET',
          owner: 'wallet',
          slippagePercentage: '0.5',
        }),
      }),
    );
  });

  it('posts the official one-shot deposit schema without substituting mint fields', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ transactionBase64: 'base64' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new FlashTradeClient({ baseUrl: 'https://flash.example' });

    await client.deposit({ owner: 'wallet', tokenSymbol: 'USDC', amount: '10.25' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://flash.example/transaction-builder/deposit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ owner: 'wallet', tokenSymbol: 'USDC', amount: '10.25' }),
      }),
    );
  });

  it('uses the live two-step withdrawal schemas without inventing a co-signer', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ transactionBase64: 'base64' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new FlashTradeClient({ baseUrl: 'https://flash.example' });

    await client.requestWithdrawal({
      owner: 'owner',
      feePayer: 'distinct-cosigner',
      tokenMint: 'mint',
      amount: '1.25',
    });
    await client.executeWithdrawal({ owner: 'owner', tokenMint: 'mint' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://flash.example/transaction-builder/request-withdrawal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          feePayer: 'distinct-cosigner',
          tokenMint: 'mint',
          amount: '1.25',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://flash.example/transaction-builder/withdrawal-settle',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ owner: 'owner', tokenMint: 'mint' }),
      }),
    );
  });

  it('throws the V2 err-in-a-200 error channel', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ err: 'basket is not delegated' }),
    ) as unknown as typeof fetch;
    const client = new FlashTradeClient({ baseUrl: 'https://flash.example' });

    await expect(
      client.closePosition({
        marketSymbol: 'SOL',
        side: 'LONG',
        inputUsdUi: '0',
        withdrawTokenSymbol: 'USDC',
        owner: 'wallet',
      }),
    ).rejects.toMatchObject<Partial<FlashTradeApiError>>({
      code: 'PROTOCOL_ERROR',
      httpStatus: 200,
      message: 'basket is not delegated',
    });
  });

  it('fails readiness closed until both basket pubkey and basket data are available', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        owner: 'wallet',
        basketPubkey: 'basket',
        basketData: null,
        positionMetrics: {},
        orderMetrics: {},
      }),
    ) as unknown as typeof fetch;
    const client = new FlashTradeClient({ baseUrl: 'https://flash.example' });

    await expect(client.getAccountReadiness('wallet')).resolves.toEqual({
      ready: false,
      owner: 'wallet',
      basketPubkey: 'basket',
      reason: 'basket_not_available',
    });
  });
});
