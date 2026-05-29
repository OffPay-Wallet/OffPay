const PROVIDER_ENV_KEYS = [
  'EXPO_PUBLIC_HELIUS_MAINNET_RPC_URL',
  'EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL',
  'EXPO_PUBLIC_HELIUS_MAINNET_WSS_URL',
  'EXPO_PUBLIC_HELIUS_DEVNET_WSS_URL',
  'EXPO_PUBLIC_ALCHEMY_MAINNET_RPC_URL',
  'EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL',
] as const;

const ORIGINAL_PROVIDER_ENV = Object.fromEntries(
  PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function resetProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreProviderEnv(): void {
  for (const key of PROVIDER_ENV_KEYS) {
    const value = ORIGINAL_PROVIDER_ENV[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function buildRpcResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null,
    },
    json: async () => body,
  } as unknown as Response;
}

function buildSolTransferResult(walletAddress: string): unknown {
  return {
    slot: 123,
    meta: {
      err: null,
      fee: 5000,
      preTokenBalances: [],
      postTokenBalances: [],
      preBalances: [1_000_000_000, 0],
      postBalances: [998_995_000, 1_000_000],
    },
    transaction: {
      message: {
        accountKeys: [walletAddress, 'Recipient111111111111111111111111111111111'],
      },
    },
    version: 'legacy',
  };
}

function buildFeeOnlyResult(walletAddress: string): Record<string, unknown> {
  return {
    slot: 123,
    meta: {
      err: null,
      fee: 5000,
      preTokenBalances: [],
      postTokenBalances: [],
      preBalances: [1_000_000_000],
      postBalances: [999_995_000],
    },
    transaction: {
      message: {
        accountKeys: [walletAddress],
      },
    },
    version: 'legacy',
  };
}

function buildParsedSelfSolTransferResult(walletAddress: string): Record<string, unknown> {
  return {
    ...buildFeeOnlyResult(walletAddress),
    transaction: {
      message: {
        accountKeys: [
          {
            pubkey: walletAddress,
            signer: true,
            writable: true,
          },
          {
            pubkey: '11111111111111111111111111111111',
            signer: false,
            writable: false,
          },
        ],
        instructions: [
          {
            program: 'system',
            parsed: {
              type: 'transfer',
              info: {
                source: walletAddress,
                destination: walletAddress,
                lamports: 100_000_000,
              },
            },
          },
        ],
      },
    },
  };
}

function buildParsedSelfTokenTransferResult(walletAddress: string): Record<string, unknown> {
  const mint = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';
  const tokenAccount = '7hm8eA9PvMt84cXGPwGvpwnU2abjHidowTxn9wG7fuvX';
  return {
    ...buildFeeOnlyResult(walletAddress),
    transaction: {
      message: {
        accountKeys: [
          {
            pubkey: walletAddress,
            signer: true,
            writable: true,
          },
          {
            pubkey: tokenAccount,
            signer: false,
            writable: true,
          },
        ],
        instructions: [
          {
            program: 'spl-token',
            parsed: {
              type: 'transferChecked',
              info: {
                authority: walletAddress,
                source: tokenAccount,
                destination: tokenAccount,
                mint,
                tokenAmount: {
                  amount: '4000000',
                  decimals: 6,
                  uiAmountString: '4',
                },
              },
            },
          },
        ],
      },
    },
  };
}

describe('provider-router', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    restoreProviderEnv();
  });

  it('reports missing client RPC env separately from provider outages', async () => {
    resetProviderEnv();

    const { getRpcSlot, ProviderRouterError } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    let caught: unknown = null;
    try {
      await getRpcSlot('devnet');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderRouterError);
    expect(caught).toMatchObject({
      name: 'ProviderRouterError',
      code: 'MISSING_PROVIDER_CONFIG',
      retryable: false,
    });
    expect(caught instanceof Error ? caught.message : '').toContain(
      'EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL',
    );
  });

  it('falls back to Alchemy when the Helius endpoint returns HTTP 404', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';
    process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL =
      'https://solana-devnet.g.alchemy.com/v2/test-alchemy';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(buildRpcResponse({ error: 'not found' }, 404))
      .mockResolvedValueOnce(
        buildRpcResponse({
          jsonrpc: '2.0',
          id: 'alchemy:getSlot',
          result: 12345,
        }),
      );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getRpcSlot } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    await expect(getRpcSlot('devnet')).resolves.toEqual({ slot: 12345 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('devnet.helius-rpc.com');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('solana-devnet.g.alchemy.com');
  });

  it('uses Helius as the primary write RPC and falls back to Alchemy on retryable provider failure', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';
    process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL =
      'https://solana-devnet.g.alchemy.com/v2/test-alchemy';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildRpcResponse({ error: 'node unhealthy' }, 503),
      )
      .mockResolvedValueOnce(
        buildRpcResponse({
          jsonrpc: '2.0',
          id: 'alchemy:sendTransaction',
          result: 'write-sig',
        }),
      );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { broadcastRawTransaction } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    await expect(
      broadcastRawTransaction({
        rawTransaction: Buffer.from([1, 2, 3]).toString('base64'),
        network: 'devnet',
      }),
    ).resolves.toEqual({ signature: 'write-sig' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('devnet.helius-rpc.com');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('solana-devnet.g.alchemy.com');
  });

  it('falls back to getBalance + getTokenAccountsByOwner when DAS is unavailable', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(buildRpcResponse({ error: 'das not enabled' }, 404))
      .mockResolvedValueOnce(
        buildRpcResponse({
          jsonrpc: '2.0',
          id: 'helius:getBalance',
          result: {
            context: { slot: 1 },
            value: 5000,
          },
        }),
      )
      .mockResolvedValueOnce(
        buildRpcResponse({
          jsonrpc: '2.0',
          id: 'helius:getTokenAccountsByOwner',
          result: {
            context: { slot: 1 },
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: 'So11111111111111111111111111111111111111112',
                        tokenAmount: {
                          amount: '1000000',
                          decimals: 6,
                          uiAmountString: '1',
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getWalletBalance } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    await expect(
      getWalletBalance('F4BGMh11111111111111111111111111111Hyyu8d', 'devnet'),
    ).resolves.toMatchObject({
      network: 'devnet',
      solBalance: 5000,
      tokens: [
        {
          mint: 'So11111111111111111111111111111111111111112',
          balance: '1',
          decimals: 6,
        },
      ],
    });

    const methods = fetchMock.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      return JSON.parse(String(init.body)).method;
    });
    const tokenCall = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));

    expect(methods).toEqual(['getAssetsByOwner', 'getBalance', 'getTokenAccountsByOwner']);
    expect(tokenCall.params[2]).toMatchObject({
      encoding: 'jsonParsed',
      commitment: 'confirmed',
    });
  });

  it('uses Helius DAS getAssetsByOwner to populate wallet balances and token metadata', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';

    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildRpcResponse({
        jsonrpc: '2.0',
        id: 'helius:getAssetsByOwner:1',
        result: {
          items: [
            {
              id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              interface: 'FungibleAsset',
              content: {
                metadata: { name: 'USD Coin', symbol: 'USDC' },
                links: {
                  image:
                    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
                },
              },
              token_info: {
                balance: '1234567',
                decimals: 6,
              },
            },
            {
              id: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
              interface: 'FungibleToken',
              content: {
                metadata: { name: 'Some Token', symbol: 'SOME' },
              },
              token_info: {
                balance: 9000,
                decimals: 0,
                price_info: { price_per_token: 0.25 },
              },
            },
          ],
          nativeBalance: { lamports: 5000, price_per_sol: 85.12, total_price: 0.0004256 },
        },
      }),
    );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getWalletBalance } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    const balance = await getWalletBalance('F4BGMh11111111111111111111111111111Hyyu8d', 'devnet');

    expect(balance).toMatchObject({
      network: 'devnet',
      solBalance: 5000,
      nativeSolUsdPrice: 85.12,
      tokens: [
        {
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          name: 'USD Coin',
          symbol: 'USDC',
          balance: '1.234567',
          decimals: 6,
          verified: true,
          spam: false,
        },
        {
          mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          name: 'Some Token',
          symbol: 'SOME',
          balance: '9000',
          decimals: 0,
          usdPrice: 0.25,
          verified: true,
          spam: false,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const dasBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(dasBody.method).toBe('getAssetsByOwner');
    expect(dasBody.params).toMatchObject({
      ownerAddress: 'F4BGMh11111111111111111111111111111Hyyu8d',
      page: 1,
      displayOptions: {
        showFungible: true,
        showNativeBalance: true,
      },
    });
  });

  it('does not fail over JSON-RPC invalid request errors', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';
    process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL =
      'https://solana-devnet.g.alchemy.com/v2/test-alchemy';

    const fetchMock = jest.fn().mockResolvedValueOnce(
      buildRpcResponse({
        jsonrpc: '2.0',
        id: 'helius:getSlot',
        error: {
          code: -32602,
          message: 'Invalid params',
        },
      }),
    );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getRpcSlot, ProviderRouterError } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    let caught: unknown = null;
    try {
      await getRpcSlot('devnet');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderRouterError);
    expect(caught).toMatchObject({
      name: 'ProviderRouterError',
      code: 'INVALID_REQUEST',
      retryable: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('devnet.helius-rpc.com');
  });

  it('does not cool down RPC providers for sendTransaction simulation failures', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';
    process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL =
      'https://solana-devnet.g.alchemy.com/v2/test-alchemy';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildRpcResponse({
          jsonrpc: '2.0',
          id: 'helius:sendTransaction',
          error: {
            code: -32002,
            message: 'Transaction simulation failed',
          },
        }),
      )
      .mockResolvedValueOnce(
        buildRpcResponse({
          jsonrpc: '2.0',
          id: 'helius:getSlot',
          result: 45678,
        }),
      );
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { broadcastRawTransaction, getRpcSlot, ProviderRouterError } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    let caught: unknown = null;
    try {
      await broadcastRawTransaction({
        rawTransaction: Buffer.from([1, 2, 3]).toString('base64'),
        network: 'devnet',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderRouterError);
    expect(caught).toMatchObject({
      code: 'INVALID_REQUEST',
      retryable: false,
    });

    await expect(getRpcSlot('devnet')).resolves.toEqual({ slot: 45678 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('devnet.helius-rpc.com');
  });

  it('splits oversized transaction enrichment batches and preserves history metadata', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';

    const walletAddress = 'F4BGMh11111111111111111111111111111Hyyu8d';
    const signatures = Array.from({ length: 9 }, (_, index) => `signature-${index}`);
    const batchSizes: number[] = [];
    const encodings: unknown[] = [];

    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));

      if (!Array.isArray(body) && body.method === 'getSignaturesForAddress') {
        return buildRpcResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: signatures.map((signature, index) => ({
            signature,
            slot: index + 1,
            blockTime: 1_700_000_000 + index,
            err: null,
            confirmationStatus: 'confirmed',
          })),
        });
      }

      if (Array.isArray(body)) {
        batchSizes.push(body.length);
        for (const request of body) {
          encodings.push(request.params?.[1]?.encoding);
        }

        if (body.length === 8) {
          return buildRpcResponse({ error: 'payload too large' }, 413);
        }

        return buildRpcResponse(
          body.map((request) => ({
            jsonrpc: '2.0',
            id: request.id,
            result: buildSolTransferResult(walletAddress),
          })),
        );
      }

      throw new Error(`Unexpected RPC body: ${JSON.stringify(body)}`);
    });
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getWalletTransactions } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    const page = await getWalletTransactions(walletAddress, 'devnet', { limit: 9 });

    expect(batchSizes).toEqual([8, 4, 4, 1]);
    expect(new Set(encodings)).toEqual(new Set(['json']));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(page.transactions).toHaveLength(9);
    expect(
      page.transactions.every(
        (transaction) =>
          transaction.amount === '0.001' &&
          transaction.tokenSymbol === 'SOL' &&
          transaction.tokenLogo != null &&
          transaction.type === 'TRANSFER',
      ),
    ).toBe(true);
  });

  it('uses parsed transaction instructions for self transfers with zero wallet delta', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';

    const walletAddress = '8WDiyTX4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz';
    const signatures = ['self-sol-signature', 'self-token-signature'];
    const singleRequestEncodings: unknown[] = [];

    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));

      if (!Array.isArray(body) && body.method === 'getSignaturesForAddress') {
        return buildRpcResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: signatures.map((signature, index) => ({
            signature,
            slot: index + 1,
            blockTime: 1_700_000_000 + index,
            err: null,
            confirmationStatus: 'confirmed',
          })),
        });
      }

      if (Array.isArray(body)) {
        return buildRpcResponse(
          body.map((request) => ({
            jsonrpc: '2.0',
            id: request.id,
            result: buildFeeOnlyResult(walletAddress),
          })),
        );
      }

      if (!Array.isArray(body) && body.method === 'getTransaction') {
        const signature = body.params?.[0];
        const encoding = body.params?.[1]?.encoding;
        singleRequestEncodings.push(encoding);
        if (encoding === 'json') {
          return buildRpcResponse({
            jsonrpc: '2.0',
            id: body.id,
            result: buildFeeOnlyResult(walletAddress),
          });
        }

        return buildRpcResponse({
          jsonrpc: '2.0',
          id: body.id,
          result:
            signature === 'self-sol-signature'
              ? buildParsedSelfSolTransferResult(walletAddress)
              : buildParsedSelfTokenTransferResult(walletAddress),
        });
      }

      throw new Error(`Unexpected RPC body: ${JSON.stringify(body)}`);
    });
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getWalletTransactions } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    const page = await getWalletTransactions(walletAddress, 'devnet', { limit: 2 });

    expect(singleRequestEncodings.filter((encoding) => encoding === 'json')).toHaveLength(2);
    expect(singleRequestEncodings.filter((encoding) => encoding === 'jsonParsed')).toHaveLength(2);
    expect(page.transactions).toHaveLength(2);
    expect(page.transactions[0]).toMatchObject({
      signature: 'self-sol-signature',
      type: 'TRANSFER',
      description: 'Self-transfer',
      amount: '0.1',
      rawAmount: '100000000',
      tokenSymbol: 'SOL',
      direction: 'send',
    });
    expect(page.transactions[1]).toMatchObject({
      signature: 'self-token-signature',
      type: 'TRANSFER',
      description: 'Self-transfer',
      amount: '4',
      rawAmount: '4000000',
      tokenMint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      direction: 'send',
    });
  });

  it('does not cool down RPC providers when a history refresh is aborted', async () => {
    resetProviderEnv();
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL =
      'https://devnet.helius-rpc.com/?api-key=test-helius';

    const controller = new AbortController();
    const walletAddress = 'F4BGMh11111111111111111111111111111Hyyu8d';
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));

      if (!Array.isArray(body) && body.method === 'getSignaturesForAddress') {
        return buildRpcResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: [
            {
              signature: 'signature-abort',
              slot: 1,
              blockTime: 1_700_000_000,
              err: null,
              confirmationStatus: 'confirmed',
            },
          ],
        });
      }

      if (Array.isArray(body)) {
        controller.abort(new Error('Aborted'));
        throw new Error('Aborted');
      }

      if (!Array.isArray(body) && body.method === 'getSlot') {
        return buildRpcResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: 45678,
        });
      }

      throw new Error(`Unexpected RPC body: ${JSON.stringify(body)}`);
    });
    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const { getRpcSlot, getWalletTransactions } =
      require('@/services/rpc') as typeof import('@/services/rpc');

    await expect(
      getWalletTransactions(walletAddress, 'devnet', {
        limit: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Aborted');
    await expect(getRpcSlot('devnet')).resolves.toEqual({ slot: 45678 });
  });
});
