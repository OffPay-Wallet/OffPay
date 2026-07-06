import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createRwaQuote,
  executeRwaQuote,
  getRwaAssets,
  getRwaPrice,
  resetRwaFetchImplementation,
  setRwaFetchImplementation,
} from '../rwa';

import type { Bindings } from '../types';

const AAPLX_MAINNET_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const TSLAX_MAINNET_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_SANDBOX_RWA_MINT = 'So11111111111111111111111111111111111111112';
const DEVNET_SANDBOX_TSLA_MINT = 'CrieBJEXarFm2C7vgPJs9v7M9PLuHV6axkNWhjUTwKZq';
const DEVNET_SANDBOX_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const RWA_DELEGATE_PROGRAM_ID = '4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7';
const WALLET = '11111111111111111111111111111111';
const JUPITER_BASE_URL = 'https://api.jup.ag';
const DEVNET_RPC_URL = 'https://rpc.offpay.test';
const MAGICBLOCK_ER_RPC_URL = 'https://devnet-as.magicblock.app';

const bindings = {
  JUPITER_API_KEY: 'jupiter-key',
  JUPITER_API_BASE_URL: JUPITER_BASE_URL,
  HELIUS_DEVNET_RPC_URL: DEVNET_RPC_URL,
  OFFPAY_MAINNET_USDC_MINT: USDC_MAINNET_MINT,
  OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: AAPLX_MAINNET_MINT,
  OFFPAY_RWA_MAINNET_ENABLED: '1',
  UPSTASH_REDIS_REST_URL: 'https://redis.test',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
} as Bindings;

const devnetSandboxBindings = {
  ...bindings,
  OFFPAY_RWA_DELEGATE_PROGRAM_ID: RWA_DELEGATE_PROGRAM_ID,
  OFFPAY_RWA_DELEGATE_DEVNET_ENABLED: '1',
  OFFPAY_RWA_MAGICBLOCK_ER_DEVNET_RPC_URL: MAGICBLOCK_ER_RPC_URL,
  OFFPAY_RWA_DEVNET_SANDBOX_MINT: DEVNET_SANDBOX_RWA_MINT,
  OFFPAY_RWA_DEVNET_SETTLEMENT_MINT: DEVNET_SANDBOX_USDC_MINT,
  OFFPAY_RWA_DEVNET_SANDBOX_SYMBOL: 'AAPLd',
  OFFPAY_RWA_DEVNET_SANDBOX_NAME: 'Apple Sandbox RWA',
  OFFPAY_RWA_DEVNET_SANDBOX_DECIMALS: '6',
  OFFPAY_RWA_DEVNET_PRICE_REFERENCE_MINT: AAPLX_MAINNET_MINT,
  OFFPAY_RWA_DEVNET_ASSETS_JSON: JSON.stringify([
    {
      mint: DEVNET_SANDBOX_RWA_MINT,
      symbol: 'AAPLd',
      name: 'Apple Sandbox RWA',
      decimals: 6,
      priceReferenceMint: AAPLX_MAINNET_MINT,
      underlyingSymbol: 'AAPL',
    },
    {
      mint: DEVNET_SANDBOX_TSLA_MINT,
      symbol: 'TSLAd',
      name: 'Tesla Sandbox RWA',
      decimals: 6,
      priceReferenceMint: TSLAX_MAINNET_MINT,
      underlyingSymbol: 'TSLA',
    },
  ]),
} as Bindings;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return jsonResponse({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function blockhashResponse(id: unknown): Response {
  return jsonRpcResponse(id, {
    value: {
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1_000,
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
      id: TSLAX_MAINNET_MINT,
      name: 'Tesla xStock',
      symbol: 'TSLAx',
      decimals: 8,
      isVerified: true,
      tags: ['stocks', 'verified'],
    },
    {
      id: '11111111111111111111111111111111',
      name: 'Suspicious xStock',
      symbol: 'SUSx',
      decimals: 8,
      isVerified: false,
      tags: ['stocks'],
      audit: {
        isSus: true,
      },
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

  it('can expose the full verified Jupiter stocks catalog with wildcard config', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.includes('/price/v3?ids=')) {
        const ids = new URL(url).searchParams.get('ids')?.split(',') ?? [];
        expect(ids).toEqual([AAPLX_MAINNET_MINT, TSLAX_MAINNET_MINT]);
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
          [TSLAX_MAINNET_MINT]: {
            usdPrice: 322.15,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(
      {
        ...bindings,
        OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '*',
      } as Bindings,
      'mainnet',
    );

    expect(response.assets.map((asset) => asset.symbol)).toEqual(['AAPLx', 'TSLAx']);
    expect(response.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mint: AAPLX_MAINNET_MINT,
          priceUsd: 214.42,
        }),
        expect.objectContaining({
          mint: TSLAX_MAINNET_MINT,
          priceUsd: 322.15,
        }),
      ]),
    );
  });

  it('accepts wrapped Jupiter stock catalog payloads without fabricating assets', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) {
        return jsonResponse({ data: jupiterStocksResponse() });
      }
      if (url.includes('/price/v3?ids=')) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(bindings, 'mainnet');

    expect(response.assets).toHaveLength(1);
    expect(response.assets[0]).toMatchObject({
      symbol: 'AAPLx',
      mint: AAPLX_MAINNET_MINT,
      provider: 'jupiter_stocks',
      priceUsd: 214.42,
    });
  });

  it('falls back to Jupiter xStock search when the stocks tag is unavailable', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) {
        return jsonResponse({
          status: 400,
          message: 'Invalid tag provided.',
        });
      }
      if (url.endsWith('/tokens/v2/search?query=xStock')) {
        return jsonResponse(jupiterStocksResponse());
      }
      if (url.includes('/price/v3?ids=')) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(bindings, 'mainnet');

    expect(response.assets).toHaveLength(1);
    expect(response.assets[0]).toMatchObject({
      symbol: 'AAPLx',
      mint: AAPLX_MAINNET_MINT,
      provider: 'jupiter_stocks',
      priceUsd: 214.42,
    });
  });

  it('does not fabricate devnet RWA assets without real devnet liquidity', async () => {
    const response = await getRwaAssets(bindings, 'devnet');

    expect(response.mode).toBe('devnet_unavailable');
    expect(response.provider).toBe('jupiter_stocks');
    expect(response.assets).toEqual([]);
  });

  it('returns a configured devnet sandbox asset with live provider pricing', async () => {
    setRwaFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/price/v3?ids=')) {
        return jsonResponse({});
      }
      if (url.includes('/price/v3?ids=')) {
        const ids = new URL(url).searchParams.get('ids')?.split(',') ?? [];
        expect(ids).toEqual([AAPLX_MAINNET_MINT, TSLAX_MAINNET_MINT]);
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
          [TSLAX_MAINNET_MINT]: {
            usdPrice: 322.15,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(devnetSandboxBindings, 'devnet');

    expect(response).toMatchObject({
      mode: 'devnet_sandbox',
      provider: 'offpay_devnet_sandbox',
      providerEnvironment: 'devnet_sandbox',
    });
    expect(response.assets.map((asset) => asset.symbol)).toEqual(['AAPLd', 'TSLAd']);
    expect(response.assets[0]).toMatchObject({
      symbol: 'AAPLd',
      mint: DEVNET_SANDBOX_RWA_MINT,
      settlementMint: DEVNET_SANDBOX_USDC_MINT,
      provider: 'offpay_devnet_sandbox',
      priceUsd: 214.42,
      tradable: true,
      devnetSandbox: true,
      magicBlockEligible: true,
      execution: {
        buy: 'devnet_sandbox',
        sell: 'devnet_sandbox',
        magicBlock: 'devnet_sandbox',
      },
    });
    expect(response.assets[1]).toMatchObject({
      symbol: 'TSLAd',
      mint: DEVNET_SANDBOX_TSLA_MINT,
      settlementMint: DEVNET_SANDBOX_USDC_MINT,
      provider: 'offpay_devnet_sandbox',
      priceUsd: 322.15,
      tradable: true,
      devnetSandbox: true,
    });
  });

  it('creates devnet sandbox quotes with MagicBlock ER transaction steps', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(DEVNET_RPC_URL);
      const request = JSON.parse(String(init?.body ?? '{}')) as { id: unknown; method: string };
      if (request.method === 'getLatestBlockhash') {
        return blockhashResponse(request.id);
      }
      throw new Error(`Unexpected Solana RPC method: ${request.method}`);
    });
    setRwaFetchImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/price/v3?ids=')) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
          },
          [TSLAX_MAINNET_MINT]: {
            usdPrice: 322.15,
          },
        });
      }
      if (url === MAGICBLOCK_ER_RPC_URL) {
        const request = JSON.parse(String(init?.body ?? '{}')) as { id: unknown; method: string };
        expect(request.method).toBe('getLatestBlockhash');
        return blockhashResponse(request.id);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await createRwaQuote(devnetSandboxBindings, {
      assetMint: DEVNET_SANDBOX_RWA_MINT,
      cashAmount: '10',
      side: 'buy',
      network: 'devnet',
      walletAddress: WALLET,
    });

    expect(response.provider).toBe('offpay_devnet_sandbox');
    expect(response.sandboxIntent).toBeDefined();
    expect(response.sandboxIntent?.magicBlock).toEqual({
      enabled: true,
      erRpcUrl: MAGICBLOCK_ER_RPC_URL,
      delegatedAccount: response.sandboxIntent!.intent,
    });
    expect(response.unsignedTransactions?.map((step) => [step.id, step.target])).toEqual([
      ['base-create-delegate', 'solana_devnet'],
      ['er-approve-undelegate', 'magicblock_er_devnet'],
      ['base-settle', 'solana_devnet'],
    ]);
    expect(response.unsignedTransactions).toHaveLength(3);
    expect(response.unsignedTransaction).toBe(
      response.unsignedTransactions?.[0]?.unsignedTransaction,
    );
  });

  it('executes devnet MagicBlock RWA steps through base, ER, then base RPCs', async () => {
    const events: string[] = [];
    let baseSendCount = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(DEVNET_RPC_URL);
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        id: unknown;
        method: string;
        params: unknown[];
      };
      events.push(`base:${request.method}`);
      if (request.method === 'sendTransaction') {
        baseSendCount += 1;
        return jsonRpcResponse(request.id, `base-signature-${baseSendCount}`);
      }
      if (request.method === 'getSignatureStatuses') {
        return jsonRpcResponse(request.id, {
          value: [
            {
              slot: 1,
              confirmations: null,
              confirmationStatus: 'confirmed',
              err: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected Solana RPC method: ${request.method}`);
    });
    setRwaFetchImplementation(async (input, init) => {
      expect(String(input)).toBe(MAGICBLOCK_ER_RPC_URL);
      const request = JSON.parse(String(init?.body ?? '{}')) as { id: unknown; method: string };
      events.push(`er:${request.method}`);
      if (request.method === 'sendTransaction') {
        return jsonRpcResponse(request.id, 'er-signature-1');
      }
      throw new Error(`Unexpected MagicBlock RPC method: ${request.method}`);
    });

    const response = await executeRwaQuote(devnetSandboxBindings, {
      quoteId: 'devnet-test',
      signedTransaction: 'AQIDBA==',
      signedTransactions: [
        {
          id: 'base-create-delegate',
          target: 'solana_devnet',
          signedTransaction: 'AQIDBA==',
        },
        {
          id: 'er-approve-undelegate',
          target: 'magicblock_er_devnet',
          signedTransaction: 'BQYHCA==',
        },
        {
          id: 'base-settle',
          target: 'solana_devnet',
          signedTransaction: 'CQoLDA==',
        },
      ],
      network: 'devnet',
      walletAddress: WALLET,
    });

    expect(events).toEqual([
      'base:sendTransaction',
      'base:getSignatureStatuses',
      'er:sendTransaction',
      'base:sendTransaction',
      'base:getSignatureStatuses',
    ]);
    expect(response.signatures).toEqual([
      {
        id: 'base-create-delegate',
        target: 'solana_devnet',
        signature: 'base-signature-1',
      },
      {
        id: 'er-approve-undelegate',
        target: 'magicblock_er_devnet',
        signature: 'er-signature-1',
      },
      {
        id: 'base-settle',
        target: 'solana_devnet',
        signature: 'base-signature-2',
      },
    ]);
    expect(response.signature).toBe('base-signature-2');
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

  it('fails closed for quote creation on devnet without sandbox config', async () => {
    await expect(
      createRwaQuote(bindings, {
        assetMint: AAPLX_MAINNET_MINT,
        cashAmount: '10',
        side: 'buy',
        network: 'devnet',
        walletAddress: WALLET,
      }),
    ).rejects.toThrow('not configured');
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
