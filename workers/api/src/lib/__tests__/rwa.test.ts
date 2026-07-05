import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createRwaQuote,
  getRwaAssets,
  getRwaPrice,
  resetRwaFetchImplementation,
  setRwaFetchImplementation,
} from '../rwa';

import type { Bindings } from '../types';

const AAPLX_MAINNET_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WALLET = '11111111111111111111111111111111';
const JUPITER_BASE_URL = 'https://api.jup.ag';

const bindings = {
  JUPITER_API_KEY: 'jupiter-key',
  JUPITER_API_BASE_URL: JUPITER_BASE_URL,
  OFFPAY_MAINNET_USDC_MINT: USDC_MAINNET_MINT,
  OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: AAPLX_MAINNET_MINT,
  OFFPAY_RWA_MAINNET_ENABLED: '1',
  UPSTASH_REDIS_REST_URL: 'https://redis.test',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
} as Bindings;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function jupiterStocksResponse() {
  return [
    {
      id: AAPLX_MAINNET_MINT,
      name: 'Apple xStock',
      symbol: 'AAPLx',
      icon: 'https://static.jup.ag/aaplx.png',
      decimals: 8,
      tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      isVerified: true,
      tags: ['stocks', 'verified'],
    },
    {
      id: 'So11111111111111111111111111111111111111112',
      name: 'Unapproved xStock',
      symbol: 'NOPE',
      decimals: 8,
      isVerified: true,
      tags: ['stocks', 'verified'],
    },
  ];
}

function mockJupiterOrder(priceImpactPct = 0.2): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith(`${JUPITER_BASE_URL}/swap/v2/order`)) {
      expect(url).toContain(`inputMint=${encodeURIComponent(USDC_MAINNET_MINT)}`);
      expect(url).toContain(`outputMint=${encodeURIComponent(AAPLX_MAINNET_MINT)}`);
      expect(url).toContain('amount=10000000');
      expect(url).toContain(`taker=${encodeURIComponent(WALLET)}`);
      expect((init?.headers as Headers).get('x-api-key')).toBe('jupiter-key');
      return jsonResponse({
        requestId: 'request-1',
        quoteId: 'quote-1',
        transaction: 'AQIDBA==',
        inAmount: '10000000',
        outAmount: '250000',
        expireAt: new Date(Date.now() + 30_000).toISOString(),
        priceImpactPct,
        router: 'ultra',
      });
    }

    if (url === 'https://redis.test/pipeline') {
      expect(init?.method).toBe('POST');
      return jsonResponse([{ result: 'OK' }]);
    }

    throw new Error(`Unexpected global fetch URL: ${url}`);
  });
}

afterEach(() => {
  resetRwaFetchImplementation();
  jest.restoreAllMocks();
});

describe('RWA Jupiter stocks integration', () => {
  it('returns real Jupiter stock-tagged assets on mainnet', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.endsWith(`/price/v3?ids=${encodeURIComponent(AAPLX_MAINNET_MINT)}`)) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(bindings, 'mainnet');

    expect(response.mode).toBe('jupiter_stocks');
    expect(response.provider).toBe('jupiter_stocks');
    expect(response.assets).toHaveLength(1);
    expect(response.assets[0]).toMatchObject({
      symbol: 'AAPLx',
      mint: AAPLX_MAINNET_MINT,
      provider: 'jupiter_stocks',
      providerEnvironment: 'production',
      settlementMint: USDC_MAINNET_MINT,
      settlementSymbol: 'USDC',
      priceUsd: 214.42,
      tradable: true,
      devnetSandbox: false,
      magicBlockEligible: false,
      execution: {
        buy: 'jupiter_swap',
        sell: 'jupiter_swap',
        magicBlock: 'disabled',
      },
    });
  });

  it('fails closed to an empty catalog when the RWA allowlist is missing', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(
      {
        ...bindings,
        OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '',
      } as Bindings,
      'mainnet',
    );

    expect(response.mode).toBe('jupiter_stocks');
    expect(response.assets).toEqual([]);
  });

  it('does not fabricate devnet RWA assets without real devnet liquidity', async () => {
    const response = await getRwaAssets(bindings, 'devnet');

    expect(response.mode).toBe('devnet_unavailable');
    expect(response.provider).toBe('jupiter_stocks');
    expect(response.assets).toEqual([]);
  });

  it('returns nullable Jupiter pricing without inventing a fallback price', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.endsWith(`/price/v3?ids=${encodeURIComponent(AAPLX_MAINNET_MINT)}`)) {
        return jsonResponse({});
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaPrice(bindings, {
      mint: AAPLX_MAINNET_MINT,
      network: 'mainnet',
    });

    expect(response).toMatchObject({
      mint: AAPLX_MAINNET_MINT,
      symbol: 'AAPLx',
      price: null,
      provider: 'jupiter_stocks',
    });
  });

  it('fails closed for quote creation on devnet', async () => {
    await expect(
      createRwaQuote(bindings, {
        assetMint: AAPLX_MAINNET_MINT,
        cashAmount: '10',
        side: 'buy',
        network: 'devnet',
        walletAddress: WALLET,
      }),
    ).rejects.toThrow('mainnet');
  });

  it('creates mainnet RWA buy quotes through Jupiter without issuer API keys', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.endsWith(`/price/v3?ids=${encodeURIComponent(AAPLX_MAINNET_MINT)}`)) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
        });
      }
      throw new Error(`Unexpected RWA URL: ${url}`);
    });

    mockJupiterOrder();

    const response = await createRwaQuote(bindings, {
      assetMint: AAPLX_MAINNET_MINT,
      cashAmount: '10',
      side: 'buy',
      network: 'mainnet',
      walletAddress: WALLET,
    });

    expect(response).toMatchObject({
      quoteId: 'quote-1',
      assetMint: AAPLX_MAINNET_MINT,
      assetSymbol: 'AAPLx',
      settlementMint: USDC_MAINNET_MINT,
      side: 'buy',
      cashAmount: '10',
      quantity: '0.0025',
      priceImpactPct: 0.2,
      routeSummary: expect.stringContaining('Jupiter'),
      unsignedTransaction: 'AQIDBA==',
      transactionFormat: 'solana_versioned_transaction_base64',
      provider: 'jupiter_stocks',
    });
  });

  it('rejects RWA quotes above the configured price impact limit', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.endsWith(`/price/v3?ids=${encodeURIComponent(AAPLX_MAINNET_MINT)}`)) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
        });
      }
      throw new Error(`Unexpected RWA URL: ${url}`);
    });
    mockJupiterOrder(0.2);

    await expect(
      createRwaQuote(
        {
          ...bindings,
          OFFPAY_RWA_MAX_PRICE_IMPACT_BPS: '10',
        } as Bindings,
        {
          assetMint: AAPLX_MAINNET_MINT,
          cashAmount: '10',
          side: 'buy',
          network: 'mainnet',
          walletAddress: WALLET,
        },
      ),
    ).rejects.toThrow('price impact');
  });
});
