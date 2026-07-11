import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  createRwaQuote,
  executeRwaQuote,
  getRwaAssets,
  getRwaPrice,
  resetRwaFetchImplementation,
  setRwaFetchImplementation,
} from '../rwa';
import { executeSwapQuote } from '../jupiter';
import {
  resetJupiterTransactionVerifierImplementationForTests,
  setJupiterTransactionVerifierImplementationForTests,
} from '../jupiter-transaction-verifier';

import type { Bindings } from '../types';

const AAPLX_MAINNET_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const TSLAX_MAINNET_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_SANDBOX_RWA_MINT = 'So11111111111111111111111111111111111111112';
const DEVNET_SANDBOX_TSLA_MINT = 'CrieBJEXarFm2C7vgPJs9v7M9PLuHV6axkNWhjUTwKZq';
const DEVNET_SANDBOX_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const RWA_DELEGATE_PROGRAM_ID = '4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7';
const WALLET_SIGNER = Keypair.fromSeed(new Uint8Array(32).fill(41));
const WALLET = WALLET_SIGNER.publicKey.toBase58();
const JUPITER_BASE_URL = 'https://api.jup.ag';
const DEVNET_RPC_URL = 'https://rpc.offpay.test';
const MAGICBLOCK_ER_RPC_URL = 'https://devnet-as.magicblock.app';

function createSwapWireTransaction(signed: boolean, lamports = 1): string {
  const transaction = new Transaction({
    feePayer: WALLET_SIGNER.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
  }).add(
    SystemProgram.transfer({
      fromPubkey: WALLET_SIGNER.publicKey,
      toPubkey: WALLET_SIGNER.publicKey,
      lamports,
    }),
  );
  if (signed) transaction.sign(WALLET_SIGNER);
  return transaction
    .serialize({ requireAllSignatures: signed, verifySignatures: signed })
    .toString('base64');
}

const UNSIGNED_SWAP_TRANSACTION = createSwapWireTransaction(false);
const SIGNED_SWAP_TRANSACTION = createSwapWireTransaction(true);
const SIGNED_SWAP_SIGNATURE = bs58.encode(
  Transaction.from(Buffer.from(SIGNED_SWAP_TRANSACTION, 'base64')).signature!,
);
const SIGNED_TAMPERED_SWAP_TRANSACTION = createSwapWireTransaction(true, 2);
const SWAP_TRANSACTION_MESSAGE = Buffer.from(
  VersionedTransaction.deserialize(
    Buffer.from(UNSIGNED_SWAP_TRANSACTION, 'base64'),
  ).message.serialize(),
).toString('base64');

const bindings = {
  JUPITER_API_KEY: 'jupiter-key',
  JUPITER_API_BASE_URL: JUPITER_BASE_URL,
  HELIUS_DEVNET_RPC_URL: DEVNET_RPC_URL,
  OFFPAY_MAINNET_USDC_MINT: USDC_MAINNET_MINT,
  OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: AAPLX_MAINNET_MINT,
  OFFPAY_RWA_MAINNET_ENABLED: '1',
  OFFPAY_RWA_MAINNET_ELIGIBLE_WALLETS: WALLET,
  OFFPAY_RWA_MAINNET_ELIGIBILITY_POLICY_VERSION: 'test-policy-v1',
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
      tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
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
    {
      id: DEVNET_SANDBOX_TSLA_MINT,
      name: 'Spoofed Apple xStock',
      symbol: 'AAPLx',
      decimals: 8,
      tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      isVerified: true,
      tags: ['stocks', 'verified'],
    },
  ];
}

type TestRwaFetchImplementation = Parameters<typeof setRwaFetchImplementation>[0];

function officialIssuerAssetsResponse(options?: {
  haltedMint?: string;
  includeAapl?: boolean;
  includeTesla?: boolean;
}) {
  const assets = [
    {
      id: 'issuer-aapl',
      name: 'Apple xStock',
      symbol: 'AAPLx',
      underlyingSymbol: 'AAPL',
      logo: 'https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png',
      mint: AAPLX_MAINNET_MINT,
    },
    {
      id: 'issuer-tsla',
      name: 'Tesla xStock',
      symbol: 'TSLAx',
      underlyingSymbol: 'TSLA',
      logo: 'https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png',
      mint: TSLAX_MAINNET_MINT,
    },
  ].filter((asset) =>
    asset.mint === AAPLX_MAINNET_MINT
      ? options?.includeAapl !== false
      : options?.includeTesla !== false,
  );

  return {
    nodes: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      underlyingSymbol: asset.underlyingSymbol,
      logo: asset.logo,
      isTradingHalted: asset.mint === options?.haltedMint,
      deployments: [
        {
          address: asset.mint,
          network: 'Solana',
          supportsAtomicSwaps: true,
        },
      ],
    })),
    page: { currentPage: 0, hasNextPage: false },
  };
}

function setRwaTestFetchImplementation(
  implementation: TestRwaFetchImplementation,
  options?: {
    haltedMint?: string;
    includeAapl?: boolean;
    includeTesla?: boolean;
    multiplier?: number;
    newMultiplier?: number;
    activationDateTime?: number;
  },
): void {
  setRwaFetchImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/api/v2/public/assets?')) {
      return jsonResponse(officialIssuerAssetsResponse(options));
    }
    if (url.includes('/api/v1/token/') && url.includes('/multiplier?network=Solana')) {
      return jsonResponse({
        currentMultiplier: options?.multiplier ?? 1,
        newMultiplier: options?.newMultiplier ?? 0,
        activationDateTime: options?.activationDateTime ?? 0,
      });
    }
    return implementation(input, init);
  });
}

function mockJupiterOrder(priceImpactPct = 0.2, expectedMultiplier = '1'): void {
  setJupiterTransactionVerifierImplementationForTests(async (request) => ({
    transactionMessageBase64: Buffer.from(
      VersionedTransaction.deserialize(
        Buffer.from(request.transactionBase64, 'base64'),
      ).message.serialize(),
    ).toString('base64'),
    kind: request.intent.kind,
    feePayerAddress: request.intent.walletAddress,
    signerAddresses: [request.intent.walletAddress],
    programIds: [],
    providerRequestId: request.intent.providerRequestId ?? null,
    maxPriorityFeeLamports: '0',
    maxNewTokenAccounts: 0,
    recurringOrderAddress: null,
  }));
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
        transaction: UNSIGNED_SWAP_TRANSACTION,
        inAmount: '10000000',
        outAmount: '250000',
        otherAmountThreshold: '248750',
        slippageBps: 50,
        feeBps: 0,
        expireAt: new Date(Date.now() + 30_000).toISOString(),
        priceImpactPct,
        router: 'metis',
        gasless: false,
        signatureFeePayer: WALLET,
      });
    }

    if (url === 'https://redis.test/pipeline') {
      expect(init?.method).toBe('POST');
      const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
      const storedQuote = JSON.parse(commands[0]?.[2] ?? '{}') as {
        context?: Record<string, unknown>;
      };
      expect(storedQuote.context).toMatchObject({
        purpose: 'rwa',
        assetMint: AAPLX_MAINNET_MINT,
        issuerAssetId: 'issuer-aapl',
        scaledUiMultiplier: expectedMultiplier,
        eligibilityPolicyVersion: 'test-policy-v1',
        side: 'buy',
      });
      return jsonResponse([{ result: 'OK' }]);
    }

    throw new Error(`Unexpected global fetch URL: ${url}`);
  });
}

function mockJupiterSellOrder(): void {
  setJupiterTransactionVerifierImplementationForTests(async (request) => ({
    transactionMessageBase64: Buffer.from(
      VersionedTransaction.deserialize(
        Buffer.from(request.transactionBase64, 'base64'),
      ).message.serialize(),
    ).toString('base64'),
    kind: request.intent.kind,
    feePayerAddress: request.intent.walletAddress,
    signerAddresses: [request.intent.walletAddress],
    programIds: [],
    providerRequestId: request.intent.providerRequestId ?? null,
    maxPriorityFeeLamports: '0',
    maxNewTokenAccounts: 0,
    recurringOrderAddress: null,
  }));
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(`${JUPITER_BASE_URL}/swap/v2/order`)) {
      expect(url).toContain(`inputMint=${encodeURIComponent(AAPLX_MAINNET_MINT)}`);
      expect(url).toContain(`outputMint=${encodeURIComponent(USDC_MAINNET_MINT)}`);
      expect(url).toContain('amount=100000000');
      return jsonResponse({
        requestId: 'request-sell-1',
        quoteId: 'quote-sell-1',
        transaction: UNSIGNED_SWAP_TRANSACTION,
        inAmount: '100000000',
        outAmount: '250000000',
        otherAmountThreshold: '248750000',
        slippageBps: 50,
        feeBps: 0,
        expireAt: new Date(Date.now() + 30_000).toISOString(),
        priceImpactPct: 0.1,
        router: 'metis',
        gasless: false,
        signatureFeePayer: WALLET,
      });
    }
    if (url === 'https://redis.test/pipeline') return jsonResponse([{ result: 'OK' }]);
    throw new Error(`Unexpected global fetch URL: ${url}`);
  });
}

afterEach(() => {
  resetRwaFetchImplementation();
  resetJupiterTransactionVerifierImplementationForTests();
  jest.restoreAllMocks();
});

describe('RWA Jupiter stocks integration', () => {
  it('returns real Jupiter stock-tagged assets on mainnet', async () => {
    setRwaTestFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.endsWith(`/price/v3?ids=${encodeURIComponent(AAPLX_MAINNET_MINT)}`)) {
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
            priceChange24h: 1.25,
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
      change24hPct: 1.25,
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
    setRwaTestFetchImplementation(async (input) => {
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
    setRwaTestFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.includes('/price/v3?ids=')) {
        const ids = new URL(url).searchParams.get('ids')?.split(',') ?? [];
        expect(ids).toEqual([AAPLX_MAINNET_MINT, TSLAX_MAINNET_MINT]);
        return jsonResponse({
          [AAPLX_MAINNET_MINT]: {
            usdPrice: 214.42,
            priceChange24h: -0.75,
          },
          [TSLAX_MAINNET_MINT]: {
            usdPrice: 322.15,
            priceChange24h: 2.5,
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

  it('paginates the zero-based official issuer catalog without skipping page zero', async () => {
    const issuerNodes = officialIssuerAssetsResponse().nodes;
    const requestedPages: string[] = [];
    setRwaFetchImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v2/public/assets') {
        const page = url.searchParams.get('page') ?? '';
        requestedPages.push(page);
        return jsonResponse({
          nodes: page === '0' ? [issuerNodes[0]] : [issuerNodes[1]],
          page: { currentPage: Number(page), hasNextPage: page === '0' },
        });
      }
      if (url.pathname.includes('/api/v1/token/') && url.pathname.endsWith('/multiplier')) {
        return jsonResponse({ currentMultiplier: 1, newMultiplier: 0, activationDateTime: 0 });
      }
      if (url.pathname.endsWith('/tokens/v2/tag')) return jsonResponse(jupiterStocksResponse());
      if (url.pathname.endsWith('/price/v3')) return jsonResponse({});
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(
      { ...bindings, OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '*' } as Bindings,
      'mainnet',
    );

    expect(requestedPages).toEqual(['0', '1']);
    expect(response.assets.map((asset) => asset.symbol)).toEqual(['AAPLx', 'TSLAx']);
  });

  it('rejects a Jupiter-verified stock token that is absent from the official issuer registry', async () => {
    setRwaTestFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(jupiterStocksResponse());
      if (url.includes('/price/v3?ids=')) return jsonResponse({});
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(
      { ...bindings, OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '*' } as Bindings,
      'mainnet',
    );

    expect(response.assets.some((asset) => asset.mint === DEVNET_SANDBOX_TSLA_MINT)).toBe(false);
  });

  it('does not accept xStock naming as a substitute for Jupiter verification', async () => {
    const unverifiedAapl = jupiterStocksResponse().map((token) =>
      token.id === AAPLX_MAINNET_MINT ? { ...token, isVerified: false, tags: ['stocks'] } : token,
    );
    setRwaTestFetchImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tokens/v2/tag?query=stocks')) return jsonResponse(unverifiedAapl);
      if (url.endsWith('/tokens/v2/search?query=xStock')) return jsonResponse(unverifiedAapl);
      throw new Error(`Unexpected URL: ${url}`);
    });

    const response = await getRwaAssets(bindings, 'mainnet');
    expect(response.assets).toEqual([]);
  });

  it('accepts wrapped Jupiter stock catalog payloads without fabricating assets', async () => {
    setRwaTestFetchImplementation(async (input) => {
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
    setRwaTestFetchImplementation(async (input) => {
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
    setRwaTestFetchImplementation(async (input) => {
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
            priceChange24h: -0.75,
          },
          [TSLAX_MAINNET_MINT]: {
            usdPrice: 322.15,
            priceChange24h: 2.5,
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
    expect(response.assets.map((asset) => asset.name)).toEqual(['Apple', 'Tesla']);
    expect(response.assets[0]).toMatchObject({
      symbol: 'AAPLd',
      mint: DEVNET_SANDBOX_RWA_MINT,
      settlementMint: DEVNET_SANDBOX_USDC_MINT,
      provider: 'offpay_devnet_sandbox',
      priceUsd: 214.42,
      change24hPct: -0.75,
      tradable: true,
      devnetSandbox: true,
      magicBlockEligible: true,
      execution: {
        buy: 'devnet_sandbox',
        sell: 'devnet_sandbox',
        magicBlock: 'devnet_sandbox',
      },
    });
    expect(response.assets[0]?.logo).toBe(
      'https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png',
    );
    expect(response.assets[1]).toMatchObject({
      symbol: 'TSLAd',
      mint: DEVNET_SANDBOX_TSLA_MINT,
      settlementMint: DEVNET_SANDBOX_USDC_MINT,
      provider: 'offpay_devnet_sandbox',
      priceUsd: 322.15,
      change24hPct: 2.5,
      tradable: true,
      devnetSandbox: true,
    });
    expect(response.assets[1]?.logo).toBe(
      'https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png',
    );
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
    setRwaTestFetchImplementation(async (input, init) => {
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
    setRwaTestFetchImplementation(async (input, init) => {
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
    setRwaTestFetchImplementation(async (input) => {
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
    setRwaTestFetchImplementation(async (input) => {
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
      countryCode: 'DE',
    });

    expect(response).toMatchObject({
      quoteId: expect.any(String),
      assetMint: AAPLX_MAINNET_MINT,
      assetSymbol: 'AAPLx',
      settlementMint: USDC_MAINNET_MINT,
      side: 'buy',
      cashAmount: '10',
      quantity: '0.0025',
      priceImpactPct: 0.2,
      routeSummary: expect.stringContaining('Jupiter'),
      unsignedTransaction: UNSIGNED_SWAP_TRANSACTION,
      transactionFormat: 'solana_versioned_transaction_base64',
      provider: 'jupiter_stocks',
    });
    expect(response.quoteId).not.toBe('quote-1');
    const secondResponse = await createRwaQuote(bindings, {
      assetMint: AAPLX_MAINNET_MINT,
      cashAmount: '10',
      side: 'buy',
      network: 'mainnet',
      walletAddress: WALLET,
      countryCode: 'DE',
    });
    expect(secondResponse.quoteId).not.toBe(response.quoteId);
  });

  it('uses the official Token-2022 scaled UI multiplier for quoted display quantities', async () => {
    setRwaTestFetchImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith('/tokens/v2/tag?query=stocks'))
          return jsonResponse(jupiterStocksResponse());
        if (url.includes('/price/v3?ids=')) return jsonResponse({});
        throw new Error(`Unexpected RWA URL: ${url}`);
      },
      { multiplier: 1.25 },
    );
    mockJupiterOrder(0.2, '1.25');

    const response = await createRwaQuote(bindings, {
      assetMint: AAPLX_MAINNET_MINT,
      cashAmount: '10',
      side: 'buy',
      network: 'mainnet',
      walletAddress: WALLET,
      countryCode: 'DE',
    });

    expect(response.quantity).toBe('0.003125');
    expect(response.scaledUiMultiplier).toBe('1.25');
  });

  it('converts a displayed sell quantity back to raw Token-2022 atoms before quoting', async () => {
    setRwaTestFetchImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith('/tokens/v2/tag?query=stocks'))
          return jsonResponse(jupiterStocksResponse());
        if (url.includes('/price/v3?ids=')) return jsonResponse({});
        throw new Error(`Unexpected RWA URL: ${url}`);
      },
      { multiplier: 1.25 },
    );
    mockJupiterSellOrder();

    const response = await createRwaQuote(bindings, {
      assetMint: AAPLX_MAINNET_MINT,
      quantity: '1.25',
      side: 'sell',
      network: 'mainnet',
      walletAddress: WALLET,
      countryCode: 'DE',
    });

    expect(response.quantity).toBe('1.25');
    expect(response.cashAmount).toBe('250');
  });

  it('fails closed while an issuer multiplier transition is inside the safety window', async () => {
    setRwaTestFetchImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith('/tokens/v2/tag?query=stocks'))
          return jsonResponse(jupiterStocksResponse());
        if (url.includes('/price/v3?ids=')) return jsonResponse({});
        throw new Error(`Unexpected RWA URL: ${url}`);
      },
      {
        multiplier: 1,
        newMultiplier: 0.5,
        activationDateTime: Date.now() + 5 * 60 * 1000,
      },
    );

    const response = await getRwaAssets(bindings, 'mainnet');
    expect(response.assets[0]).toMatchObject({
      tradable: false,
      multiplierTransitionActive: true,
      pendingScaledUiMultiplier: '0.5',
    });
  });

  it('fails closed when issuer multiplier transition metadata is incomplete', async () => {
    setRwaTestFetchImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith('/tokens/v2/tag?query=stocks'))
          return jsonResponse(jupiterStocksResponse());
        throw new Error(`Unexpected RWA URL: ${url}`);
      },
      { multiplier: 1, newMultiplier: 0.5, activationDateTime: 0 },
    );

    await expect(getRwaAssets(bindings, 'mainnet')).rejects.toThrow(
      'multiplier transition is incomplete',
    );
  });

  it('marks an issuer-halted asset non-tradable even when Jupiter still returns it', async () => {
    setRwaTestFetchImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith('/tokens/v2/tag?query=stocks'))
          return jsonResponse(jupiterStocksResponse());
        if (url.includes('/price/v3?ids=')) return jsonResponse({});
        throw new Error(`Unexpected RWA URL: ${url}`);
      },
      { haltedMint: AAPLX_MAINNET_MINT },
    );

    const response = await getRwaAssets(bindings, 'mainnet');
    expect(response.assets[0]).toMatchObject({ tradingHalted: true, tradable: false });
  });

  it('re-checks issuer status before executing a signed mainnet RWA quote', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://redis.test/pipeline');
      const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
      expect(commands[0]?.[0]).toBe('GET');
      return jsonResponse([
        {
          result: JSON.stringify({
            requestId: 'request-rwa-1',
            provider: 'ultra',
            takerAddress: WALLET,
            network: 'mainnet',
            expiresAt: Date.now() + 30_000,
            lastValidBlockHeight: null,
            transactionMessageBase64: SWAP_TRANSACTION_MESSAGE,
            context: {
              purpose: 'rwa',
              assetMint: AAPLX_MAINNET_MINT,
              issuerAssetId: 'issuer-aapl',
              scaledUiMultiplier: '1',
              eligibilityPolicyVersion: 'test-policy-v1',
              side: 'buy',
            },
          }),
        },
      ]);
    });
    setRwaTestFetchImplementation(
      async (input) => {
        const url = String(input);
        if (url.endsWith('/tokens/v2/tag?query=stocks'))
          return jsonResponse(jupiterStocksResponse());
        if (url.includes('/price/v3?ids=')) return jsonResponse({});
        throw new Error(`Unexpected RWA URL: ${url}`);
      },
      { haltedMint: AAPLX_MAINNET_MINT },
    );

    await expect(
      executeRwaQuote(bindings, {
        quoteId: 'quote-rwa-1',
        signedTransaction: 'AQIDBA==',
        network: 'mainnet',
        walletAddress: WALLET,
        countryCode: 'DE',
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
  });

  it('prevents an RWA quote from bypassing RWA checks through the generic swap executor', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://redis.test/pipeline');
      const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
      const operation = commands[0]?.[0];
      if (operation === 'SET') return jsonResponse([{ result: 'OK' }]);
      if (operation === 'EVAL') return jsonResponse([{ result: 1 }]);
      if (operation === 'GET') {
        return jsonResponse([
          {
            result: JSON.stringify({
              requestId: 'request-rwa-1',
              provider: 'ultra',
              takerAddress: WALLET,
              network: 'mainnet',
              expiresAt: Date.now() + 30_000,
              lastValidBlockHeight: null,
              transactionMessageBase64: SWAP_TRANSACTION_MESSAGE,
              context: {
                purpose: 'rwa',
                assetMint: AAPLX_MAINNET_MINT,
                issuerAssetId: 'issuer-aapl',
                scaledUiMultiplier: '1',
                eligibilityPolicyVersion: 'test-policy-v1',
                side: 'buy',
              },
            }),
          },
        ]);
      }
      throw new Error(`Unexpected Redis operation: ${operation}`);
    });

    await expect(
      executeSwapQuote(bindings, {
        quoteId: 'quote-rwa-1',
        signedTransaction: 'AQIDBA==',
        network: 'mainnet',
        takerAddress: WALLET,
      }),
    ).rejects.toThrow('route that created it');
  });

  it('keeps ordinary non-RWA Jupiter quotes executable through the generic executor', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://redis.test/pipeline') {
        const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
        const [operation, key] = commands[0] ?? [];
        if (operation === 'SET') return jsonResponse([{ result: 'OK' }]);
        if (operation === 'EVAL') return jsonResponse([{ result: 1 }]);
        if (operation === 'GET' && key?.startsWith('swap-quote:v2:')) {
          return jsonResponse([
            {
              result: JSON.stringify({
                requestId: 'request-swap-1',
                provider: 'ultra',
                takerAddress: WALLET,
                network: 'mainnet',
                expiresAt: Date.now() + 30_000,
                lastValidBlockHeight: null,
                transactionMessageBase64: SWAP_TRANSACTION_MESSAGE,
                context: null,
              }),
            },
          ]);
        }
        if (operation === 'DEL') return jsonResponse([{ result: 1 }]);
        if (operation === 'GET') return jsonResponse([{ result: null }]);
      }
      if (url === `${JUPITER_BASE_URL}/swap/v2/execute`) {
        return jsonResponse({
          status: 'Success',
          signature: SIGNED_SWAP_SIGNATURE,
          code: 0,
          inputAmountResult: '10000000',
          outputAmountResult: '250000',
          totalInputAmount: '10000000',
          totalOutputAmount: '250000',
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      executeSwapQuote(bindings, {
        quoteId: 'quote-swap-1',
        signedTransaction: SIGNED_SWAP_TRANSACTION,
        network: 'mainnet',
        takerAddress: WALLET,
      }),
    ).resolves.toEqual({
      signature: SIGNED_SWAP_SIGNATURE,
      code: 0,
      inputAmountResult: '10000000',
      outputAmountResult: '250000',
      totalInputAmount: '10000000',
      totalOutputAmount: '250000',
    });
  });

  it('rejects a valid wallet signature over any transaction other than the quoted message', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://redis.test/pipeline') {
        const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
        const [operation, key] = commands[0] ?? [];
        if (operation === 'SET') return jsonResponse([{ result: 'OK' }]);
        if (operation === 'EVAL') return jsonResponse([{ result: 1 }]);
        if (operation === 'GET' && key?.startsWith('swap-quote:v2:')) {
          return jsonResponse([
            {
              result: JSON.stringify({
                requestId: 'request-swap-2',
                provider: 'ultra',
                takerAddress: WALLET,
                network: 'mainnet',
                expiresAt: Date.now() + 30_000,
                lastValidBlockHeight: null,
                transactionMessageBase64: SWAP_TRANSACTION_MESSAGE,
                context: null,
              }),
            },
          ]);
        }
        if (operation === 'GET') return jsonResponse([{ result: null }]);
        if (operation === 'DEL') return jsonResponse([{ result: 1 }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      executeSwapQuote(bindings, {
        quoteId: 'quote-swap-2',
        signedTransaction: SIGNED_TAMPERED_SWAP_TRANSACTION,
        network: 'mainnet',
        takerAddress: WALLET,
      }),
    ).rejects.toThrow('does not match the quoted transaction');
  });

  it('fails closed for mainnet RWA quotes without server-side eligibility or in a restricted country', async () => {
    await expect(
      createRwaQuote(
        { ...bindings, OFFPAY_RWA_MAINNET_ELIGIBILITY_POLICY_VERSION: '' } as Bindings,
        {
          assetMint: AAPLX_MAINNET_MINT,
          cashAmount: '10',
          side: 'buy',
          network: 'mainnet',
          walletAddress: WALLET,
          countryCode: 'DE',
        },
      ),
    ).rejects.toMatchObject({ code: 'RWA_ELIGIBILITY_REQUIRED' });

    await expect(
      createRwaQuote(bindings, {
        assetMint: AAPLX_MAINNET_MINT,
        cashAmount: '10',
        side: 'buy',
        network: 'mainnet',
        walletAddress: WALLET,
        countryCode: 'US',
      }),
    ).rejects.toMatchObject({ code: 'RWA_ELIGIBILITY_REQUIRED' });
  });

  it('rejects RWA quotes above the configured price impact limit', async () => {
    setRwaTestFetchImplementation(async (input) => {
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
          countryCode: 'DE',
        },
      ),
    ).rejects.toThrow('price impact');
  });
});
