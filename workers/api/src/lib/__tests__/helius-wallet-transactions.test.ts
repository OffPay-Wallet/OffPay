import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  getWalletTokenTransactions,
  getWalletTransactions,
  resetHeliusFetchImplementation,
  setHeliusFetchImplementation,
} from '../helius';

import type { Bindings } from '../types';

const WALLET = '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ';
const RECIPIENT = 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk';
const SIGNATURE = '5JEBA3C9A3C9A3C9A3C9A3C9A3C9A3C9A3C9A3C9A3C9A3C9';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_ACCOUNT = '8Huh8yL4uY8r4nHkFiXLpFZ6LbWyKqVgL4PBYiX8FWXG';
const OTHER_TOKEN_MINT = 'DezXAZ8z7PnrnRJjz3mP8cB1sMiBw1ZbrGdNd4T5wwf';
const DEVNET_UMBRA_PROGRAM = 'DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ';
const UMBRA_POOL = '9B5mqKTY4N6mNLLbnVMXg67thA6Z6hVSY8FzN4JNYqgd';

const bindings = {
  HELIUS_DEVNET_RPC_URL: 'https://rpc.offpay.test',
  HELIUS_MAINNET_API_KEY: 'test-mainnet-key',
  HELIUS_MAINNET_RPC_URL: 'https://mainnet-rpc.offpay.test',
  JUPITER_API_KEY: 'test-jupiter',
  OFFPAY_BOOTSTRAP_SECRET: 'test-bootstrap',
  BOOTSTRAP_SECRET_VERSION: '1',
  OFFPAY_BACKUP_HMAC_SECRET: 'test-backup',
  KV_REST_API_URL: 'https://kv.offpay.test',
  KV_REST_API_TOKEN: 'test-kv',
  MAGICBLOCK_DEVNET_VALIDATORS: '',
  MAGICBLOCK_MAINNET_VALIDATORS: '',
  MIN_APP_VERSION: '0.0.0',
} as Bindings;

function withAlchemyRpc(
  network: 'devnet' | 'mainnet',
  overrides: Partial<Bindings> = {},
): Bindings {
  return {
    ...bindings,
    ...(network === 'devnet'
      ? { ALCHEMY_DEVNET_RPC_URL: 'https://alchemy.offpay.test' }
      : { ALCHEMY_MAINNET_RPC_URL: 'https://alchemy.offpay.test' }),
    ...overrides,
  } as Bindings;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

// Parsed getTransaction-style item for a native SOL transfer from WALLET to
// RECIPIENT.
function rawRpcSolTransferItem(
  signature: string,
  blockTime: number,
  lamports: number,
): Record<string, unknown> {
  return {
    slot: 1000,
    transactionIndex: 0,
    blockTime,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
        instructions: [
          {
            programId: '11111111111111111111111111111111',
            parsed: {
              type: 'transfer',
              info: { source: WALLET, destination: RECIPIENT, lamports },
            },
          },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000, 0],
      postBalances: [1_000_000_000 - lamports - 5000, lamports],
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
}

// Item where WALLET only paid the fee (no transfer touching it). Not displayable.
function rawRpcFeeOnlyItem(signature: string, blockTime: number): Record<string, unknown> {
  return {
    slot: 1000,
    transactionIndex: 0,
    blockTime,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [{ pubkey: WALLET }],
        instructions: [{ programId: 'ComputeBudget111111111111111111111111111111' }],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000],
      postBalances: [999_995_000],
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
}

// Item for a SOL -> SPL swap: a wrapped-SOL debit and an SPL credit, both owned
// by WALLET. The parser classifies this as a SWAP whose description reads
// "Swapped <sol> SOL to <amount> <symbol>".
function rawRpcSolToTokenSwapItem(params: {
  signature: string;
  blockTime: number;
  solLamports: number;
  tokenMint: string;
  tokenRawAmount: string;
  tokenDecimals: number;
}): Record<string, unknown> {
  return {
    slot: 1000,
    transactionIndex: 0,
    blockTime: params.blockTime,
    transaction: {
      signatures: [params.signature],
      message: { accountKeys: [{ pubkey: WALLET }], instructions: [] },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000],
      postBalances: [999_000_000],
      preTokenBalances: [
        {
          owner: WALLET,
          accountIndex: 0,
          mint: SOL_MINT,
          uiTokenAmount: { amount: String(params.solLamports), decimals: 9 },
        },
        {
          owner: WALLET,
          accountIndex: 1,
          mint: params.tokenMint,
          uiTokenAmount: { amount: '0', decimals: params.tokenDecimals },
        },
      ],
      postTokenBalances: [
        {
          owner: WALLET,
          accountIndex: 0,
          mint: SOL_MINT,
          uiTokenAmount: { amount: '0', decimals: 9 },
        },
        {
          owner: WALLET,
          accountIndex: 1,
          mint: params.tokenMint,
          uiTokenAmount: { amount: params.tokenRawAmount, decimals: params.tokenDecimals },
        },
      ],
    },
  };
}

function rawRpcItemTouchesMint(item: Record<string, unknown>, mint: string): boolean {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  for (const key of ['preTokenBalances', 'postTokenBalances'] as const) {
    const list = meta[key];
    if (Array.isArray(list) && list.some((entry) => (entry as { mint?: string })?.mint === mint)) {
      return true;
    }
  }
  return false;
}

function enhancedSolTransferItem(
  signature: string,
  timestamp: number,
  lamports: number,
): Record<string, unknown> {
  return {
    signature,
    timestamp,
    fee: 5000,
    type: 'TRANSFER',
    nativeTransfers: [
      {
        fromUserAccount: WALLET,
        toUserAccount: RECIPIENT,
        amount: lamports,
      },
    ],
    tokenTransfers: [],
  };
}

function enhancedUnknownSystemTransferItem(
  signature: string,
  timestamp: number,
  lamports: number,
  direction: 'send' | 'receive' = 'send',
): Record<string, unknown> {
  const source = direction === 'send' ? WALLET : RECIPIENT;
  const destination = direction === 'send' ? RECIPIENT : WALLET;
  return {
    signature,
    timestamp,
    fee: 5000,
    type: 'UNKNOWN',
    nativeTransfers: [
      {
        fromUserAccount: source,
        toUserAccount: destination,
        amount: lamports,
      },
    ],
    tokenTransfers: [],
    instructions: [
      {
        programId: '11111111111111111111111111111111',
        parsed: {
          type: 'transfer',
          info: {
            source,
            destination,
            lamports,
          },
        },
      },
    ],
  };
}

function enhancedNonceWithdrawalItem(
  signature: string,
  timestamp: number,
  lamports: number,
): Record<string, unknown> {
  return {
    signature,
    timestamp,
    fee: 5000,
    type: 'UNKNOWN',
    nativeTransfers: [
      {
        fromUserAccount: RECIPIENT,
        toUserAccount: WALLET,
        amount: lamports,
      },
    ],
    tokenTransfers: [],
    instructions: [
      {
        programId: '11111111111111111111111111111111',
        parsed: {
          type: 'withdrawFromNonce',
          info: {
            nonceAccount: RECIPIENT,
            recipient: WALLET,
            lamports,
          },
        },
      },
    ],
  };
}

function enhancedOpaqueNativeTransferItem(params: {
  signature: string;
  timestamp: number;
  lamports: number;
  direction: 'send' | 'receive';
}): Record<string, unknown> {
  const source = params.direction === 'send' ? WALLET : RECIPIENT;
  const destination = params.direction === 'send' ? RECIPIENT : WALLET;
  return {
    signature: params.signature,
    timestamp: params.timestamp,
    fee: 5000,
    type: 'UNKNOWN',
    nativeTransfers: [
      {
        fromUserAccount: source,
        toUserAccount: destination,
        amount: params.lamports,
      },
    ],
    tokenTransfers: [],
  };
}

function rpcSystemTransferResult(params: {
  signature: string;
  blockTime: number;
  lamports: number;
  direction: 'send' | 'receive';
}): Record<string, unknown> {
  const source = params.direction === 'send' ? WALLET : RECIPIENT;
  const destination = params.direction === 'send' ? RECIPIENT : WALLET;
  return {
    blockTime: params.blockTime,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000, 0],
      postBalances:
        params.direction === 'send'
          ? [1_000_000_000 - params.lamports - 5000, params.lamports]
          : [1_000_000_000 + params.lamports - 5000, 0],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: {
      signatures: [params.signature],
      message: {
        accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
        instructions: [
          {
            program: 'system',
            programId: '11111111111111111111111111111111',
            parsed: {
              type: 'transfer',
              info: {
                source,
                destination,
                lamports: params.lamports,
              },
            },
          },
        ],
      },
    },
  };
}

function rpcNonceAccountFundingResult(params: {
  signature: string;
  blockTime: number;
  lamports: number;
}): Record<string, unknown> {
  return {
    blockTime: params.blockTime,
    meta: {
      err: null,
      fee: 10000,
      preBalances: [1_000_000_000, 0],
      postBalances: [1_000_000_000 - params.lamports - 10000, params.lamports],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: {
      signatures: [params.signature],
      message: {
        accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
        instructions: [
          {
            program: 'system',
            programId: '11111111111111111111111111111111',
            parsed: {
              type: 'createAccount',
              info: {
                source: WALLET,
                newAccount: RECIPIENT,
                lamports: params.lamports,
                space: 80,
              },
            },
          },
          {
            program: 'system',
            programId: '11111111111111111111111111111111',
            parsed: {
              type: 'initializeNonce',
              info: {
                nonceAccount: RECIPIENT,
                nonceAuthority: WALLET,
              },
            },
          },
        ],
      },
    },
  };
}

function rpcNonceWithdrawalResult(params: {
  signature: string;
  blockTime: number;
  lamports: number;
}): Record<string, unknown> {
  return {
    blockTime: params.blockTime,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000_000, 0],
      postBalances: [1_000_000_000 + params.lamports - 5000, 0],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: {
      signatures: [params.signature],
      message: {
        accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
        instructions: [
          {
            program: 'system',
            programId: '11111111111111111111111111111111',
            parsed: {
              type: 'withdrawFromNonce',
              info: {
                nonceAccount: RECIPIENT,
                nonceAuthority: WALLET,
                recipient: WALLET,
                lamports: params.lamports,
              },
            },
          },
        ],
      },
    },
  };
}

function enhancedNonceAccountFundingItem(
  signature: string,
  timestamp: number,
  lamports: number,
): Record<string, unknown> {
  return {
    signature,
    timestamp,
    fee: 10000,
    type: 'UNKNOWN',
    nativeTransfers: [
      {
        fromUserAccount: WALLET,
        toUserAccount: RECIPIENT,
        amount: lamports,
      },
    ],
    tokenTransfers: [],
    instructions: [
      {
        programId: '11111111111111111111111111111111',
        parsed: {
          type: 'createAccount',
          info: {
            source: WALLET,
            newAccount: RECIPIENT,
            lamports,
            space: 80,
          },
        },
      },
      {
        programId: '11111111111111111111111111111111',
        parsed: {
          type: 'initializeNonce',
          info: {
            nonceAccount: RECIPIENT,
            nonceAuthority: WALLET,
          },
        },
      },
    ],
  };
}

function createRawRpcHistoryMock(options: {
  enhancedItems: readonly Record<string, unknown>[];
  onRpcMethod?: (method: string) => void;
  assets?: unknown[];
  rpcTransactionsBySignature?: ReadonlyMap<string, unknown>;
}) {
  const toRpcResult = (item: Record<string, unknown>): unknown => {
    const signature = String(item.signature ?? '');
    const timestamp = typeof item.timestamp === 'number' ? item.timestamp : 0;
    const nativeTransfers = Array.isArray(item.nativeTransfers) ? item.nativeTransfers : [];
    const nativeTransfer = nativeTransfers.find(
      (transfer): transfer is Record<string, unknown> =>
        transfer != null && typeof transfer === 'object',
    );
    if (nativeTransfer) {
      return rpcSystemTransferResult({
        signature,
        blockTime: timestamp,
        lamports: Number(nativeTransfer.amount ?? 0),
        direction: nativeTransfer.fromUserAccount === WALLET ? 'send' : 'receive',
      });
    }

    return {
      blockTime: timestamp,
      meta: {
        err: null,
        fee: Number(item.fee ?? 5000),
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [],
        postTokenBalances: [],
      },
      transaction: {
        signatures: [signature],
        message: { accountKeys: [{ pubkey: WALLET }], instructions: [] },
      },
    };
  };

  return jest.fn(async (input: string, init: RequestInit) => {
    if ((init.method ?? 'GET').toUpperCase() === 'GET') {
      throw new Error(`Unexpected REST request: ${input}`);
    }

    const requestBody = JSON.parse(init.body as string);
    const respond = (request: Record<string, unknown>) => {
      const method = String(request.method);
      options.onRpcMethod?.(method);

      if (method === 'getTransactionsForAddress') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32403,
            message: 'This feature is only available for paid plans.',
          },
        };
      }
      if (method === 'getAssetBatch') {
        return { jsonrpc: '2.0', id: request.id, result: options.assets ?? [] };
      }
      if (method === 'getTokenAccountsByOwner') {
        return { jsonrpc: '2.0', id: request.id, result: { value: [] } };
      }
      if (method === 'getSignaturesForAddress') {
        const params = Array.isArray(request.params) ? request.params : [];
        const config = (params[1] ?? {}) as Record<string, unknown>;
        const limit = typeof config.limit === 'number' ? config.limit : 100;
        const beforeSignature = typeof config.before === 'string' ? config.before : null;
        const startIndex =
          beforeSignature == null
            ? 0
            : options.enhancedItems.findIndex((item) => item.signature === beforeSignature) + 1;
        const normalizedStartIndex = startIndex > 0 ? startIndex : 0;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: options.enhancedItems
            .slice(normalizedStartIndex, normalizedStartIndex + limit)
            .map((item) => ({
              signature: item.signature,
              blockTime: item.timestamp,
              err: null,
            })),
        };
      }
      if (method === 'getTransaction') {
        const params = Array.isArray(request.params) ? request.params : [];
        const signature = String(params[0] ?? '');
        const enhancedItem = options.enhancedItems.find((item) => item.signature === signature);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result:
            options.rpcTransactionsBySignature?.get(signature) ??
            (enhancedItem != null ? toRpcResult(enhancedItem) : null),
        };
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    };

    return jsonResponse(
      Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
    );
  });
}

function getTransactionSignature(item: Record<string, unknown>): string {
  const transaction = item.transaction as { signatures?: string[] } | undefined;
  return transaction?.signatures?.[0] ?? '';
}

// Mock that serves standard Solana public-RPC history methods from a fixed,
// newest-first list of full transaction items. getAssetBatch metadata resolves
// to empty unless provided.
function createGetTransactionsForAddressMock(
  items: readonly Record<string, unknown>[],
  options: {
    onConfig?: (config: Record<string, unknown>) => void;
    onMethod?: (method: string) => void;
    onUrl?: (url: string) => void;
    assets?: unknown[];
  } = {},
) {
  return jest.fn(async (input: string, init: RequestInit) => {
    options.onUrl?.(input);
    const requestBody = JSON.parse(init.body as string);
    const respond = (request: Record<string, unknown>) => {
      options.onMethod?.(String(request.method));
      if (request.method === 'getTransactionsForAddress') {
        throw new Error('getTransactionsForAddress must not be used for wallet history');
      }
      if (request.method === 'getAssetBatch') {
        return { jsonrpc: '2.0', id: request.id, result: options.assets ?? [] };
      }
      if (request.method === 'getTokenAccountsByOwner') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            value: [
              {
                pubkey: TOKEN_ACCOUNT,
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: OTHER_TOKEN_MINT,
                      },
                    },
                  },
                },
              },
            ],
          },
        };
      }
      if (request.method === 'getSignaturesForAddress') {
        const params = Array.isArray(request.params) ? request.params : [];
        const address = String(params[0] ?? '');
        const config = (params[1] ?? {}) as Record<string, unknown>;
        options.onConfig?.(config);
        const limit = typeof config.limit === 'number' ? config.limit : 100;
        const before = typeof config.before === 'string' ? config.before : null;
        const matching =
          address === TOKEN_ACCOUNT
            ? items.filter((item) => rawRpcItemTouchesMint(item, OTHER_TOKEN_MINT))
            : address === WALLET
              ? items
              : [];
        const startIndex =
          before == null
            ? 0
            : matching.findIndex((item) => getTransactionSignature(item) === before) + 1;
        const normalizedStartIndex = startIndex > 0 ? startIndex : 0;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: matching
            .slice(normalizedStartIndex, normalizedStartIndex + limit)
            .map((item) => ({
              signature: getTransactionSignature(item),
              blockTime: item.blockTime,
              err: null,
            })),
        };
      }
      if (request.method === 'getTransaction') {
        const params = Array.isArray(request.params) ? request.params : [];
        const signature = String(params[0] ?? '');
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: items.find((item) => getTransactionSignature(item) === signature) ?? null,
        };
      }
      throw new Error(`Unexpected RPC method on raw history path: ${String(request.method)}`);
    };
    return jsonResponse(
      Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
    );
  });
}

describe('wallet transaction history (standard Solana RPC)', () => {
  afterEach(() => {
    resetHeliusFetchImplementation();
  });

  it('recovers native SOL amount and recipient from sparse parsed transfer records', async () => {
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { value: [] },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              {
                signature: SIGNATURE,
                blockTime: 1781794440,
                err: null,
              },
            ],
          };
        }

        if (request.method === 'getTransaction') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              blockTime: 1781794440,
              meta: {
                err: null,
                fee: 5000,
                preBalances: [1_000_000_000, 0],
                postBalances: [749_995_000, 250_000_000],
                preTokenBalances: [],
                postTokenBalances: [],
              },
              transaction: {
                message: {
                  accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
                  instructions: [
                    {
                      programId: '11111111111111111111111111111111',
                      parsed: {
                        type: 'transfer',
                        info: {
                          source: WALLET,
                          destination: RECIPIENT,
                        },
                      },
                    },
                  ],
                },
              },
            },
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      limit: 1,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: SIGNATURE,
      type: 'TOKEN_TRANSFER',
      description: 'Sent 0.25 SOL',
      amount: '0.25',
      rawAmount: '250000000',
      tokenMint: SOL_MINT,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
      tokenDecimals: 9,
      direction: 'send',
      sender: WALLET,
      recipient: RECIPIENT,
    });
    expect(response.transactions[0]?.counterparties).toContainEqual({
      address: RECIPIENT,
      role: 'recipient',
    });
  });

  it('falls back to Solana public RPC when Alchemy raw history RPC fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const multiProviderBindings = withAlchemyRpc('devnet');
    const calledUrls: string[] = [];
    const timings: string[] = [];
    const fetchMock = jest.fn(async (input: string, init: RequestInit) => {
      calledUrls.push(input);
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTransactionsForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32002, message: 'provider-specific history unavailable' },
          };
        }
        if (input.includes('alchemy')) {
          throw new Error('Alchemy raw RPC unavailable');
        }
        if (request.method === 'getTokenAccountsByOwner') {
          return { jsonrpc: '2.0', id: request.id, result: { value: [] } };
        }
        if (request.method === 'getSignaturesForAddress') {
          return { jsonrpc: '2.0', id: request.id, result: [] };
        }
        return { jsonrpc: '2.0', id: request.id, result: null };
      };
      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(multiProviderBindings, {
      address: WALLET,
      network: 'devnet',
      limit: 5,
      useCache: false,
      recordTiming: (name) => timings.push(name),
    });

    // Alchemy raw RPC is the fast primary for standard history methods; public
    // Solana RPC remains the history-only backup when Alchemy fails.
    expect(response.transactions).toEqual([]);
    expect(calledUrls.some((url) => url.includes('alchemy'))).toBe(true);
    expect(calledUrls.some((url) => url === 'https://api.devnet.solana.com')).toBe(true);
    expect(timings).toContain('tx_rpc_provider_solanaPublic');
    expect(timings).not.toContain('tx_rpc_provider_alchemy');
    warnSpy.mockRestore();
  });

  it('limits shallow wallet history transaction batches instead of parsing the whole signature page', async () => {
    const signatures = Array.from(
      { length: 100 },
      (_, index) => `${SIGNATURE}${index.toString().padStart(3, '0')}`,
    );
    const getTransactionBatchSizes: number[] = [];
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));

      if (
        Array.isArray(requestBody) &&
        requestBody.every((request) => request.method === 'getTransaction')
      ) {
        getTransactionBatchSizes.push(requestBody.length);
      }

      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { value: [] },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: signatures.map((signature, index) => ({
              signature,
              blockTime: 1781794440 - index,
              err: null,
            })),
          };
        }

        if (request.method === 'getTransaction') {
          const params = Array.isArray(request.params) ? request.params : [];
          const signature = String(params[0] ?? '');
          const signatureIndex = signatures.indexOf(signature);
          return {
            jsonrpc: '2.0',
            id: request.id,
            result:
              signatureIndex >= 0 && signatureIndex < 20
                ? {
                    blockTime: 1781794440 - signatureIndex,
                    meta: {
                      err: null,
                      fee: 5000,
                      preBalances: [1_000_000_000, 0],
                      postBalances: [999_990_000, 5_000],
                      preTokenBalances: [],
                      postTokenBalances: [],
                    },
                    transaction: {
                      message: {
                        accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
                        instructions: [
                          {
                            programId: '11111111111111111111111111111111',
                            parsed: {
                              type: 'transfer',
                              info: {
                                source: WALLET,
                                destination: RECIPIENT,
                              },
                            },
                          },
                        ],
                      },
                    },
                  }
                : null,
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      limit: 20,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(20);
    expect(getTransactionBatchSizes).toEqual([40]);
  });

  it('limits token detail transaction batches instead of parsing the whole signature page', async () => {
    const signatures = Array.from(
      { length: 100 },
      (_, index) => `${SIGNATURE}token${index.toString().padStart(3, '0')}`,
    );
    const sender = 'Hq3cgpbHV1Hsq3cZKaWDyHhXzHq7veKf5D5eGX2Ujqq3';
    const getTransactionBatchSizes: number[] = [];
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));

      if (
        Array.isArray(requestBody) &&
        requestBody.every((request) => request.method === 'getTransaction')
      ) {
        getTransactionBatchSizes.push(requestBody.length);
      }

      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          const params = Array.isArray(request.params) ? request.params : [];
          const filter = params[1];
          const programId =
            filter != null && typeof filter === 'object' && 'programId' in filter
              ? String(filter.programId)
              : '';

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              value: programId.includes('Tokenkeg')
                ? [
                    {
                      pubkey: TOKEN_ACCOUNT,
                      account: {
                        data: {
                          parsed: {
                            info: {
                              mint: OTHER_TOKEN_MINT,
                            },
                          },
                        },
                      },
                    },
                  ]
                : [],
            },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: signatures.map((signature, index) => ({
              signature,
              blockTime: 1781794500 - index,
              err: null,
            })),
          };
        }

        if (request.method === 'getTransaction') {
          const params = Array.isArray(request.params) ? request.params : [];
          const signature = String(params[0] ?? '');
          const signatureIndex = signatures.indexOf(signature);
          const hasTokenTransfer = signatureIndex >= 0 && signatureIndex < 8;

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              blockTime: 1781794500 - Math.max(signatureIndex, 0),
              meta: {
                err: null,
                fee: 5000,
                preBalances: [1_000_000_000],
                postBalances: [999_995_000],
                preTokenBalances: hasTokenTransfer
                  ? [
                      {
                        owner: sender,
                        accountIndex: 0,
                        mint: OTHER_TOKEN_MINT,
                        uiTokenAmount: { amount: '1000000', decimals: 5 },
                      },
                      {
                        accountIndex: 1,
                        mint: OTHER_TOKEN_MINT,
                        uiTokenAmount: { amount: '0', decimals: 5 },
                      },
                    ]
                  : [],
                postTokenBalances: hasTokenTransfer
                  ? [
                      {
                        owner: sender,
                        accountIndex: 0,
                        mint: OTHER_TOKEN_MINT,
                        uiTokenAmount: { amount: '0', decimals: 5 },
                      },
                      {
                        accountIndex: 1,
                        mint: OTHER_TOKEN_MINT,
                        uiTokenAmount: { amount: '1000000', decimals: 5 },
                      },
                    ]
                  : [],
              },
              transaction: {
                message: {
                  accountKeys: [{ pubkey: sender }, { pubkey: TOKEN_ACCOUNT }],
                  instructions: [],
                },
              },
            },
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              {
                id: OTHER_TOKEN_MINT,
                content: { metadata: { name: 'Bonk', symbol: 'BONK' } },
                token_info: { symbol: 'BONK', decimals: 5 },
              },
            ],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      mint: OTHER_TOKEN_MINT,
      limit: 8,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(8);
    expect(getTransactionBatchSizes).toEqual([20]);
  });

  it('fetches token-account signatures so arbitrary token transfer history is not stablecoin-only when owner metadata is sparse', async () => {
    const tokenSignature = `${SIGNATURE}tok`;
    const sender = 'Hq3cgpbHV1Hsq3cZKaWDyHhXzHq7veKf5D5eGX2Ujqq3';
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          const params = Array.isArray(request.params) ? request.params : [];
          const filter = params[1];
          const programId =
            filter != null && typeof filter === 'object' && 'programId' in filter
              ? String(filter.programId)
              : '';

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              value: programId.includes('Tokenkeg')
                ? [
                    {
                      pubkey: TOKEN_ACCOUNT,
                      account: {
                        data: {
                          parsed: {
                            info: {
                              mint: OTHER_TOKEN_MINT,
                            },
                          },
                        },
                      },
                    },
                  ]
                : [],
            },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          const params = Array.isArray(request.params) ? request.params : [];
          const address = params[0];

          return {
            jsonrpc: '2.0',
            id: request.id,
            result:
              address === TOKEN_ACCOUNT
                ? [
                    {
                      signature: tokenSignature,
                      blockTime: 1781794500,
                      err: null,
                    },
                  ]
                : [],
          };
        }

        if (request.method === 'getTransaction') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              blockTime: 1781794500,
              meta: {
                err: null,
                fee: 5000,
                preBalances: [1_000_000_000],
                postBalances: [999_995_000],
                preTokenBalances: [
                  {
                    owner: sender,
                    accountIndex: 0,
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '12345000', decimals: 5 },
                  },
                  {
                    accountIndex: 1,
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '0', decimals: 5 },
                  },
                ],
                postTokenBalances: [
                  {
                    owner: sender,
                    accountIndex: 0,
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '0', decimals: 5 },
                  },
                  {
                    accountIndex: 1,
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '12345000', decimals: 5 },
                  },
                ],
              },
              transaction: {
                message: {
                  accountKeys: [{ pubkey: sender }, { pubkey: TOKEN_ACCOUNT }],
                  instructions: [],
                },
              },
            },
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              {
                id: OTHER_TOKEN_MINT,
                content: { metadata: { name: 'Bonk', symbol: 'BONK' } },
                token_info: { symbol: 'BONK', decimals: 5 },
              },
            ],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      limit: 5,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: tokenSignature,
      type: 'RECEIVE',
      description: 'Received 123.45 BONK',
      amount: '123.45',
      rawAmount: '12345000',
      tokenMint: OTHER_TOKEN_MINT,
      tokenSymbol: 'BONK',
      tokenName: 'Bonk',
      tokenDecimals: 5,
      direction: 'receive',
      recipient: WALLET,
    });
  });

  it('uses standard public RPC methods for mainnet wallet history', async () => {
    const configs: Record<string, unknown>[] = [];
    const seenMethods: string[] = [];
    const fetchMock = createGetTransactionsForAddressMock(
      [rawRpcSolTransferItem(SIGNATURE, 1781794440, 250_000_000)],
      {
        onConfig: (config) => configs.push(config),
        onMethod: (method) => seenMethods.push(method),
      },
    );

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      limit: 5,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: SIGNATURE,
      description: 'Sent 0.25 SOL',
      amount: '0.25',
      rawAmount: '250000000',
      tokenMint: SOL_MINT,
      tokenSymbol: 'SOL',
      tokenName: 'Solana',
      direction: 'send',
      sender: WALLET,
      recipient: RECIPIENT,
    });
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getTokenAccountsByOwner');
    expect(seenMethods).toContain('getSignaturesForAddress');
    expect(seenMethods).toContain('getTransaction');
    expect(configs.every((config) => config.commitment === 'confirmed')).toBe(true);
  });

  it('uses standard public RPC methods for devnet when Alchemy is configured', async () => {
    const devnetRawRpcBindings = withAlchemyRpc('devnet', {
      HELIUS_DEVNET_API_KEY: 'test-devnet-key',
    });
    const configs: Record<string, unknown>[] = [];
    const seenMethods: string[] = [];
    const fetchMock = createGetTransactionsForAddressMock(
      [rawRpcSolTransferItem(SIGNATURE, 1781794440, 250_000_000)],
      {
        onConfig: (config) => configs.push(config),
        onMethod: (method) => seenMethods.push(method),
      },
    );

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      limit: 5,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: SIGNATURE,
      tokenMint: SOL_MINT,
      tokenSymbol: 'SOL',
      direction: 'send',
    });
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getSignaturesForAddress');
    expect(seenMethods).toContain('getTransaction');
    expect(configs.every((config) => config.commitment === 'confirmed')).toBe(true);
  });

  it('prefers Alchemy raw RPC for history when Alchemy is configured', async () => {
    const multiProviderBindings = {
      ...bindings,
      HELIUS_DEVNET_API_KEY: 'test-devnet-key',
      ALCHEMY_DEVNET_RPC_URL: 'https://alchemy.offpay.test',
      ALCHEMY_DEVNET_FALLBACK_RPC_URL: 'https://alchemy-fallback.offpay.test',
    } as Bindings;
    const calledUrls: string[] = [];
    const seenMethods: string[] = [];
    const fetchMock = createGetTransactionsForAddressMock(
      [rawRpcSolTransferItem(SIGNATURE, 1781794440, 250_000_000)],
      {
        onUrl: (url) => calledUrls.push(url),
        onMethod: (method) => seenMethods.push(method),
      },
    );

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(multiProviderBindings, {
      address: WALLET,
      network: 'devnet',
      limit: 5,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(calledUrls.every((url) => url === 'https://alchemy.offpay.test')).toBe(true);
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getSignaturesForAddress');
  });

  it('uses Solana public history without requiring Helius or Alchemy configuration', async () => {
    const publicOnlyBindings = {
      ...bindings,
      HELIUS_DEVNET_API_KEY: undefined,
      HELIUS_DEVNET_RPC_URL: undefined,
      ALCHEMY_DEVNET_RPC_URL: undefined,
    } as Bindings;
    const calledUrls: string[] = [];
    const seenMethods: string[] = [];
    const fetchMock = createGetTransactionsForAddressMock(
      [rawRpcSolTransferItem(SIGNATURE, 1781794440, 250_000_000)],
      {
        onUrl: (url) => calledUrls.push(url),
        onMethod: (method) => seenMethods.push(method),
      },
    );

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(publicOnlyBindings, {
      address: WALLET,
      network: 'devnet',
      limit: 5,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(calledUrls.every((url) => url === 'https://api.devnet.solana.com')).toBe(true);
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getSignaturesForAddress');
    expect(seenMethods).toContain('getTransaction');
  });

  it('pages raw SOL token history until the limit is filled', async () => {
    // 300 full items newest-first: 3 SOL transfers in page 1 (of 100) and 5 in
    // page 2; the rest are fee-only noise. Filling a limit of 8 SOL rows
    // therefore REQUIRES paging. SOL is not a token transfer, so there is no
    // server-side mint filter and rows are matched locally.
    const items: Record<string, unknown>[] = [];
    const baseTime = 1781800000;
    for (let index = 0; index < 300; index += 1) {
      const signature = `${SIGNATURE}page${String(index).padStart(3, '0')}`;
      const isSol = (index < 100 && index % 34 === 0) || (index >= 100 && index % 20 === 0);
      items.push(
        isSol
          ? rawRpcSolTransferItem(signature, baseTime - index, 100_000_000 + index)
          : rawRpcFeeOnlyItem(signature, baseTime - index),
      );
    }
    const configs: Record<string, unknown>[] = [];
    const fetchMock = createGetTransactionsForAddressMock(items, {
      onConfig: (config) => configs.push(config),
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      mint: SOL_MINT,
      limit: 8,
      useCache: false,
    });

    expect(response.transactions.length).toBeGreaterThanOrEqual(8);
    expect(response.transactions.every((transaction) => transaction.tokenMint === SOL_MINT)).toBe(
      true,
    );
    // No provider-specific history method is called; standard signature pages
    // are scanned until enough displayable SOL rows are found. Fee-only items
    // are excluded.
    expect(
      configs.every((config) => (config.filters as Record<string, unknown>)?.tokenTransfer == null),
    ).toBe(true);
    expect(configs.length).toBeGreaterThanOrEqual(2);
    // More matching rows remain, so a cursor is returned for the client.
    expect(response.cursor).not.toBeNull();
  });

  it('matches SPL token history from raw token-account signatures', async () => {
    const tokenItem = (signature: string, blockTime: number, rawAmount: string) => ({
      slot: 1000,
      transactionIndex: 0,
      blockTime,
      transaction: {
        signatures: [signature],
        message: { accountKeys: [{ pubkey: WALLET }], instructions: [] },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [
          {
            owner: WALLET,
            accountIndex: 0,
            mint: OTHER_TOKEN_MINT,
            uiTokenAmount: { amount: '0', decimals: 6 },
          },
        ],
        postTokenBalances: [
          {
            owner: WALLET,
            accountIndex: 0,
            mint: OTHER_TOKEN_MINT,
            uiTokenAmount: { amount: rawAmount, decimals: 6 },
          },
        ],
      },
    });
    const items = [
      tokenItem(`${SIGNATURE}t0`, 1781800000, '1000000'),
      rawRpcSolTransferItem(`${SIGNATURE}s0`, 1781799999, 250_000_000),
      tokenItem(`${SIGNATURE}t1`, 1781799998, '2000000'),
    ];
    const configs: Record<string, unknown>[] = [];
    const fetchMock = createGetTransactionsForAddressMock(items, {
      onConfig: (config) => configs.push(config),
      assets: [
        {
          id: OTHER_TOKEN_MINT,
          content: { metadata: { name: 'Bonk', symbol: 'BONK' } },
          token_info: { symbol: 'BONK', decimals: 6 },
        },
      ],
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      mint: OTHER_TOKEN_MINT,
      limit: 8,
      useCache: false,
    });

    // Token Details scans the wallet's token accounts directly and filters
    // locally, avoiding the failing provider-specific history method.
    expect(response.transactions).toHaveLength(2);
    expect(response.transactions.every((t) => t.tokenMint === OTHER_TOKEN_MINT)).toBe(true);
    expect((configs[0]?.filters as Record<string, unknown>)?.tokenTransfer).toBeUndefined();
  });

  it('paginates SPL token history through raw signature cursors without dropping rows', async () => {
    const tokenItem = (signature: string, blockTime: number, rawAmount: string) => ({
      slot: 1000,
      transactionIndex: 0,
      blockTime,
      transaction: {
        signatures: [signature],
        message: { accountKeys: [{ pubkey: WALLET }], instructions: [] },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1_000_000_000],
        postBalances: [999_995_000],
        preTokenBalances: [
          {
            owner: WALLET,
            accountIndex: 0,
            mint: OTHER_TOKEN_MINT,
            uiTokenAmount: { amount: '0', decimals: 6 },
          },
        ],
        postTokenBalances: [
          {
            owner: WALLET,
            accountIndex: 0,
            mint: OTHER_TOKEN_MINT,
            uiTokenAmount: { amount: rawAmount, decimals: 6 },
          },
        ],
      },
    });
    const items = Array.from({ length: 30 }, (_, index) =>
      tokenItem(
        `${SIGNATURE}p${String(index).padStart(3, '0')}`,
        1781800000 - index,
        String((index + 1) * 1_000_000),
      ),
    );
    const configs: Record<string, unknown>[] = [];
    const fetchMock = createGetTransactionsForAddressMock(items, {
      onConfig: (config) => configs.push(config),
      assets: [
        {
          id: OTHER_TOKEN_MINT,
          content: { metadata: { name: 'Bonk', symbol: 'BONK' } },
          token_info: { symbol: 'BONK', decimals: 6 },
        },
      ],
    });

    setHeliusFetchImplementation(fetchMock);

    const firstPage = await getWalletTokenTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      mint: OTHER_TOKEN_MINT,
      limit: 8,
      useCache: false,
    });
    const secondPage = await getWalletTokenTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      mint: OTHER_TOKEN_MINT,
      cursor: firstPage.cursor ?? undefined,
      limit: 8,
      useCache: false,
    });

    expect(firstPage.transactions).toHaveLength(8);
    expect(secondPage.transactions).toHaveLength(8);
    expect(firstPage.cursor).toBe(items[7] ? getTransactionSignature(items[7]!) : null);
    expect(secondPage.cursor).toBe(items[15] ? getTransactionSignature(items[15]!) : null);
    const itemSignature = (item: Record<string, unknown>): string => {
      const transaction = item.transaction as { signatures: string[] };
      return transaction.signatures[0]!;
    };
    expect(firstPage.transactions.map((transaction) => transaction.signature)).toEqual(
      items.slice(0, 8).map(itemSignature),
    );
    expect(secondPage.transactions.map((transaction) => transaction.signature)).toEqual(
      items.slice(8, 16).map(itemSignature),
    );
    expect(
      configs.every((config) => (config.filters as Record<string, unknown>)?.tokenTransfer == null),
    ).toBe(true);
  });

  it('keeps SOL swaps in broad wallet history (previously dropped by the null-direction gate)', async () => {
    const fetchMock = createGetTransactionsForAddressMock(
      [
        rawRpcSolToTokenSwapItem({
          signature: `${SIGNATURE}swap`,
          blockTime: 1781800000,
          solLamports: 500_000_000,
          tokenMint: OTHER_TOKEN_MINT,
          tokenRawAmount: '75000000',
          tokenDecimals: 6,
        }),
      ],
      {
        assets: [
          {
            id: OTHER_TOKEN_MINT,
            content: { metadata: { name: 'USD Coin', symbol: 'USDC' } },
            token_info: { symbol: 'USDC', decimals: 6 },
          },
        ],
      },
    );

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      limit: 5,
      useCache: false,
    });

    // A two-legged swap has a null direction; it must still be displayable.
    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]?.type.toLowerCase()).toContain('swap');
    expect(response.transactions[0]?.description).toContain('SOL');
  });

  it('includes SOL swaps in SOL token activity even when the primary token is the swap output', async () => {
    const fetchMock = createGetTransactionsForAddressMock(
      [
        rawRpcSolToTokenSwapItem({
          signature: `${SIGNATURE}swap`,
          blockTime: 1781800000,
          solLamports: 500_000_000,
          tokenMint: OTHER_TOKEN_MINT,
          tokenRawAmount: '75000000',
          tokenDecimals: 6,
        }),
      ],
      {
        assets: [
          {
            id: OTHER_TOKEN_MINT,
            content: { metadata: { name: 'USD Coin', symbol: 'USDC' } },
            token_info: { symbol: 'USDC', decimals: 6 },
          },
        ],
      },
    );

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      mint: SOL_MINT,
      limit: 8,
      useCache: false,
    });

    // The swap collapses to USDC as its primary token, but it still moved SOL,
    // so it must appear in the SOL token-details view.
    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]?.type.toLowerCase()).toContain('swap');
  });

  it('uses raw Solana RPC without attempting provider-specific history', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seenMethods: string[] = [];
    const fetchMock = createRawRpcHistoryMock({
      enhancedItems: [enhancedSolTransferItem(SIGNATURE, 1781794440, 250_000_000)],
      onRpcMethod: (method) => seenMethods.push(method),
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      limit: 1,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: SIGNATURE,
      tokenMint: SOL_MINT,
      direction: 'send',
    });
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getSignaturesForAddress');
    expect(seenMethods).toContain('getTransaction');
    warnSpy.mockRestore();
  });

  it('uses devnet raw Solana RPC for SOL token history without provider-specific fallback', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const devnetRawRpcBindings = withAlchemyRpc('devnet');
    const seenMethods: string[] = [];
    const fetchMock = createRawRpcHistoryMock({
      enhancedItems: [
        enhancedSolTransferItem(`${SIGNATURE}rest0`, 1781794440, 250_000_000),
        {
          signature: `${SIGNATURE}fee-only`,
          timestamp: 1781794439,
          fee: 5000,
          type: 'TRANSFER',
          nativeTransfers: [],
          tokenTransfers: [],
        },
        enhancedSolTransferItem(`${SIGNATURE}rest1`, 1781794438, 100_000_000),
      ],
      onRpcMethod: (method) => seenMethods.push(method),
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 2,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(2);
    expect(response.transactions.every((transaction) => transaction.tokenMint === SOL_MINT)).toBe(
      true,
    );
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getSignaturesForAddress');
    expect(seenMethods).toContain('getTransaction');
    warnSpy.mockRestore();
  });

  it('shows raw RPC SOL transfer rows without provider-specific fallback', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const devnetRawRpcBindings = withAlchemyRpc('devnet');
    const sendSignature = `${SIGNATURE}unknown-send`;
    const receiveSignature = `${SIGNATURE}unknown-receive`;
    const fetchMock = createRawRpcHistoryMock({
      enhancedItems: [
        enhancedUnknownSystemTransferItem(sendSignature, 1781794440, 20_000_000, 'send'),
        enhancedNonceWithdrawalItem(receiveSignature, 1781794439, 1_447_680),
      ],
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 4,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(2);
    expect(response.transactions[0]).toMatchObject({
      signature: sendSignature,
      type: 'TOKEN_TRANSFER',
      tokenMint: SOL_MINT,
      direction: 'send',
      rawAmount: '20000000',
    });
    expect(response.transactions[1]).toMatchObject({
      signature: receiveSignature,
      type: 'RECEIVE',
      tokenMint: SOL_MINT,
      direction: 'receive',
      rawAmount: '1447680',
    });
    warnSpy.mockRestore();
  });

  it('filters nonce funding from native SOL rows through raw instructions', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const devnetRawRpcBindings = withAlchemyRpc('devnet');
    const transferSignature = `${SIGNATURE}opaque-transfer`;
    const nonceSignature = `${SIGNATURE}opaque-nonce`;
    const seenMethods: string[] = [];
    const rpcTransactionsBySignature = new Map<string, unknown>([
      [
        transferSignature,
        rpcSystemTransferResult({
          signature: transferSignature,
          blockTime: 1781794440,
          lamports: 20_000_000,
          direction: 'send',
        }),
      ],
      [
        nonceSignature,
        rpcNonceAccountFundingResult({
          signature: nonceSignature,
          blockTime: 1781794439,
          lamports: 1_447_680,
        }),
      ],
    ]);
    const fetchMock = createRawRpcHistoryMock({
      enhancedItems: [
        enhancedOpaqueNativeTransferItem({
          signature: nonceSignature,
          timestamp: 1781794441,
          lamports: 1_447_680,
          direction: 'send',
        }),
        enhancedOpaqueNativeTransferItem({
          signature: transferSignature,
          timestamp: 1781794440,
          lamports: 20_000_000,
          direction: 'send',
        }),
      ],
      onRpcMethod: (method) => seenMethods.push(method),
      rpcTransactionsBySignature,
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 4,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: transferSignature,
      type: 'TOKEN_TRANSFER',
      tokenMint: SOL_MINT,
      direction: 'send',
      rawAmount: '20000000',
    });
    expect(seenMethods.filter((method) => method === 'getTransaction')).toHaveLength(2);
    warnSpy.mockRestore();
  });

  it('deep-scans raw SOL token history for nonce withdrawals', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const devnetRawRpcBindings = withAlchemyRpc('devnet');
    const transferSignature = `${SIGNATURE}enhanced-transfer`;
    const withdrawalSignature = `${SIGNATURE}nonce-withdraw`;
    const seenMethods: string[] = [];
    const fetchMock = jest.fn(async (input: string, init: RequestInit) => {
      if ((init.method ?? 'GET').toUpperCase() === 'GET') {
        return jsonResponse([enhancedSolTransferItem(transferSignature, 1781794440, 20_000_000)]);
      }

      const requestBody = JSON.parse(init.body as string);
      const respond = (request: Record<string, unknown>) => {
        const method = String(request.method);
        seenMethods.push(method);

        if (method === 'getTransactionsForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32403, message: 'This feature is only available for paid plans.' },
          };
        }

        if (method === 'getTokenAccountsByOwner') {
          return { jsonrpc: '2.0', id: request.id, result: { value: [] } };
        }

        if (method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              { signature: withdrawalSignature, blockTime: 1781794441, err: null },
              { signature: transferSignature, blockTime: 1781794440, err: null },
            ],
          };
        }

        if (method === 'getTransaction') {
          const params = Array.isArray(request.params) ? request.params : [];
          const signature = String(params[0] ?? '');
          return {
            jsonrpc: '2.0',
            id: request.id,
            result:
              signature === withdrawalSignature
                ? rpcNonceWithdrawalResult({
                    signature: withdrawalSignature,
                    blockTime: 1781794441,
                    lamports: 1_447_680,
                  })
                : rpcSystemTransferResult({
                    signature: transferSignature,
                    blockTime: 1781794440,
                    lamports: 20_000_000,
                    direction: 'send',
                  }),
          };
        }

        if (method === 'getAssetBatch') {
          return { jsonrpc: '2.0', id: request.id, result: [] };
        }

        throw new Error(`Unexpected RPC method: ${method}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 4,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(2);
    expect(response.transactions[0]).toMatchObject({
      signature: withdrawalSignature,
      type: 'RECEIVE',
      direction: 'receive',
      rawAmount: '1447680',
    });
    expect(response.transactions[1]).toMatchObject({
      signature: transferSignature,
      type: 'TOKEN_TRANSFER',
      direction: 'send',
      rawAmount: '20000000',
    });
    expect(seenMethods).toContain('getSignaturesForAddress');
    warnSpy.mockRestore();
  });

  it('falls back to raw native SOL rows for first-page wallet history', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const devnetRawRpcBindings = withAlchemyRpc('devnet');
    const enhancedSignature = `${SIGNATURE}history-enhanced-transfer`;
    const withdrawalSignature = `${SIGNATURE}history-nonce-withdraw`;
    const seenMethods: string[] = [];
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      if ((init.method ?? 'GET').toUpperCase() === 'GET') {
        return jsonResponse([enhancedSolTransferItem(enhancedSignature, 1781794440, 20_000_000)]);
      }

      const requestBody = JSON.parse(init.body as string);
      const respond = (request: Record<string, unknown>) => {
        const method = String(request.method);
        seenMethods.push(method);

        if (method === 'getTransactionsForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32403, message: 'This feature is only available for paid plans.' },
          };
        }

        if (method === 'getTokenAccountsByOwner') {
          return { jsonrpc: '2.0', id: request.id, result: { value: [] } };
        }

        if (method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              { signature: withdrawalSignature, blockTime: 1781794441, err: null },
              { signature: enhancedSignature, blockTime: 1781794440, err: null },
            ],
          };
        }

        if (method === 'getTransaction') {
          const params = Array.isArray(request.params) ? request.params : [];
          const signature = String(params[0] ?? '');
          return {
            jsonrpc: '2.0',
            id: request.id,
            result:
              signature === withdrawalSignature
                ? rpcNonceWithdrawalResult({
                    signature: withdrawalSignature,
                    blockTime: 1781794441,
                    lamports: 1_447_680,
                  })
                : rpcSystemTransferResult({
                    signature: enhancedSignature,
                    blockTime: 1781794440,
                    lamports: 20_000_000,
                    direction: 'send',
                  }),
          };
        }

        if (method === 'getAssetBatch') {
          return { jsonrpc: '2.0', id: request.id, result: [] };
        }

        throw new Error(`Unexpected RPC method: ${method}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      limit: 20,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(2);
    expect(response.transactions[0]).toMatchObject({
      signature: withdrawalSignature,
      type: 'RECEIVE',
      direction: 'receive',
      tokenMint: SOL_MINT,
      rawAmount: '1447680',
    });
    expect(response.transactions[1]).toMatchObject({
      signature: enhancedSignature,
      type: 'TOKEN_TRANSFER',
      direction: 'send',
      tokenMint: SOL_MINT,
      rawAmount: '20000000',
    });
    expect(seenMethods).toContain('getSignaturesForAddress');
    warnSpy.mockRestore();
  });

  it('does not treat nonce-account rent funding as SOL token activity in raw history', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const devnetRawRpcBindings = withAlchemyRpc('devnet');
    const nonceSignature = `${SIGNATURE}nonce-rent`;
    const transferSignature = `${SIGNATURE}real-sol`;
    const seenMethods: string[] = [];
    const fetchMock = createRawRpcHistoryMock({
      enhancedItems: [
        enhancedNonceAccountFundingItem(nonceSignature, 1781794440, 1_447_680),
        enhancedSolTransferItem(transferSignature, 1781794439, 250_000_000),
      ],
      onRpcMethod: (method) => seenMethods.push(method),
      rpcTransactionsBySignature: new Map<string, unknown>([
        [
          nonceSignature,
          rpcNonceAccountFundingResult({
            signature: nonceSignature,
            blockTime: 1781794440,
            lamports: 1_447_680,
          }),
        ],
      ]),
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(devnetRawRpcBindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 2,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: transferSignature,
      tokenMint: SOL_MINT,
      direction: 'send',
    });
    expect(
      response.transactions.some((transaction) => transaction.signature === nonceSignature),
    ).toBe(false);
    warnSpy.mockRestore();
  });

  it('uses the raw RPC scan without calling provider-specific history', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seenMethods: string[] = [];
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      if ((init.method ?? 'GET').toUpperCase() === 'GET') {
        return new Response('enhanced transactions unavailable', { status: 503 });
      }

      const requestBody = JSON.parse(init.body as string);
      const respond = (request: Record<string, unknown>) => {
        seenMethods.push(String(request.method));

        if (request.method === 'getTransactionsForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32403, message: 'Method not available on plan' },
          };
        }

        if (request.method === 'getTokenAccountsByOwner') {
          return { jsonrpc: '2.0', id: request.id, result: { value: [] } };
        }

        if (request.method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [{ signature: SIGNATURE, blockTime: 1781794440, err: null }],
          };
        }

        if (request.method === 'getTransaction') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              blockTime: 1781794440,
              meta: {
                err: null,
                fee: 5000,
                preBalances: [1_000_000_000, 0],
                postBalances: [749_995_000, 250_000_000],
                preTokenBalances: [],
                postTokenBalances: [],
              },
              transaction: {
                message: {
                  accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
                  instructions: [
                    {
                      programId: '11111111111111111111111111111111',
                      parsed: {
                        type: 'transfer',
                        info: { source: WALLET, destination: RECIPIENT },
                      },
                    },
                  ],
                },
              },
            },
          };
        }

        if (request.method === 'getAssetBatch') {
          return { jsonrpc: '2.0', id: request.id, result: [] };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(withAlchemyRpc('mainnet'), {
      address: WALLET,
      network: 'mainnet',
      limit: 1,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: SIGNATURE,
      tokenMint: SOL_MINT,
      direction: 'send',
    });
    expect(seenMethods).not.toContain('getTransactionsForAddress');
    expect(seenMethods).toContain('getSignaturesForAddress');
    expect(seenMethods).toContain('getTransaction');
    warnSpy.mockRestore();
  });

  it('deep-scans token-specific RPC history and returns balance-only SOL rows', async () => {
    const unrelatedSignatures = Array.from(
      { length: 100 },
      (_, index) => `${SIGNATURE}noise${String(index).padStart(3, '0')}`,
    );
    const solSignature = `${SIGNATURE}sol`;
    let signaturePageCount = 0;
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { value: [] },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          const params = Array.isArray(request.params) ? request.params : [];
          const config = params[1] as { before?: string; limit?: number } | undefined;
          expect(params[0]).toBe(WALLET);
          expect(config?.limit).toBe(100);
          signaturePageCount += 1;

          const previousIndex =
            config?.before == null ? -1 : unrelatedSignatures.indexOf(config.before);
          const startIndex = previousIndex < 0 ? 0 : previousIndex + 1;

          if (startIndex >= unrelatedSignatures.length) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: [
                {
                  signature: solSignature,
                  blockTime: 1781794500,
                  err: null,
                },
              ],
            };
          }

          const page = unrelatedSignatures.slice(startIndex, startIndex + (config?.limit ?? 100));
          const result = page.map((signature, index) => ({
            signature,
            blockTime: 1781794600 - startIndex - index,
            err: null,
          }));
          if (startIndex + page.length >= unrelatedSignatures.length) {
            result.push({
              signature: solSignature,
              blockTime: 1781794500,
              err: null,
            });
          }

          return {
            jsonrpc: '2.0',
            id: request.id,
            result,
          };
        }

        if (request.method === 'getTransaction') {
          const params = Array.isArray(request.params) ? request.params : [];
          const signature = params[0];
          const isSolTransfer = signature === solSignature;

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: isSolTransfer
              ? {
                  blockTime: 1781794500,
                  meta: {
                    err: null,
                    fee: 5000,
                    preBalances: [1_000_000_000, 0],
                    postBalances: [799_995_000, 200_000_000],
                    preTokenBalances: [],
                    postTokenBalances: [],
                  },
                  transaction: {
                    message: {
                      accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
                      instructions: [],
                    },
                  },
                }
              : {
                  blockTime: 1781794560,
                  meta: {
                    err: null,
                    fee: 5000,
                    preBalances: [1_000_000_000],
                    postBalances: [999_995_000],
                    preTokenBalances: [
                      {
                        owner: WALLET,
                        accountIndex: 0,
                        mint: OTHER_TOKEN_MINT,
                        uiTokenAmount: { amount: '1000000', decimals: 6 },
                      },
                    ],
                    postTokenBalances: [
                      {
                        owner: WALLET,
                        accountIndex: 0,
                        mint: OTHER_TOKEN_MINT,
                        uiTokenAmount: { amount: '0', decimals: 6 },
                      },
                    ],
                  },
                  transaction: {
                    message: {
                      accountKeys: [{ pubkey: WALLET }],
                      instructions: [],
                    },
                  },
                },
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              {
                id: OTHER_TOKEN_MINT,
                content: { metadata: { name: 'USD Coin', symbol: 'USDC' } },
                token_info: { symbol: 'USDC', decimals: 6 },
              },
            ],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 8,
      useCache: false,
    });
    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: solSignature,
      amount: '0.2',
      rawAmount: '200000000',
      tokenMint: SOL_MINT,
      tokenSymbol: 'SOL',
      direction: 'send',
    });
    expect(signaturePageCount).toBe(6);
  });

  it('does not treat Umbra rent or fee lamport movement as SOL token activity', async () => {
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { value: [] },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [
              {
                signature: SIGNATURE,
                blockTime: 1781794600,
                err: null,
              },
            ],
          };
        }

        if (request.method === 'getTransaction') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              blockTime: 1781794600,
              meta: {
                err: null,
                fee: 5000,
                preBalances: [1_000_000_000, 0, 0],
                postBalances: [995_151_000, 4_844_000, 0],
                preTokenBalances: [],
                postTokenBalances: [],
              },
              transaction: {
                message: {
                  accountKeys: [
                    { pubkey: WALLET },
                    { pubkey: UMBRA_POOL },
                    { pubkey: DEVNET_UMBRA_PROGRAM },
                  ],
                  instructions: [
                    {
                      programId: '11111111111111111111111111111111',
                      parsed: {
                        type: 'transfer',
                        info: {
                          source: WALLET,
                          destination: UMBRA_POOL,
                          lamports: 4_844_000,
                        },
                      },
                    },
                    {
                      programId: DEVNET_UMBRA_PROGRAM,
                      accounts: [WALLET, UMBRA_POOL, DEVNET_UMBRA_PROGRAM],
                    },
                  ],
                },
              },
            },
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTokenTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      mint: SOL_MINT,
      limit: 8,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(0);
  });

  it('scans past internal SOL rent noise and returns the real SOL transfer in canonical history', async () => {
    const noiseSignatures = Array.from(
      { length: 100 },
      (_, index) => `${SIGNATURE}umbra${String(index).padStart(3, '0')}`,
    );
    const solSignature = `${SIGNATURE}real-sol-transfer`;
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        if (request.method === 'getTokenAccountsByOwner') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { value: [] },
          };
        }

        if (request.method === 'getSignaturesForAddress') {
          const params = Array.isArray(request.params) ? request.params : [];
          const config = params[1] as { before?: string; limit?: number } | undefined;
          expect(config?.limit).toBe(100);

          if (config?.before === noiseSignatures.at(-1)) {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: [
                {
                  signature: solSignature,
                  blockTime: 1781708200,
                  err: null,
                },
              ],
            };
          }

          return {
            jsonrpc: '2.0',
            id: request.id,
            result:
              config?.before == null
                ? noiseSignatures.map((signature, index) => ({
                    signature,
                    blockTime: 1781794600 - index,
                    err: null,
                  }))
                : [],
          };
        }

        if (request.method === 'getTransaction') {
          const params = Array.isArray(request.params) ? request.params : [];
          const signature = params[0];
          const isSolTransfer = signature === solSignature;

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: isSolTransfer
              ? {
                  blockTime: 1781708200,
                  meta: {
                    err: null,
                    fee: 5000,
                    preBalances: [1_000_000_000, 0],
                    postBalances: [998_995_000, 1_000_000],
                    preTokenBalances: [],
                    postTokenBalances: [],
                  },
                  transaction: {
                    message: {
                      accountKeys: [{ pubkey: WALLET }, { pubkey: RECIPIENT }],
                      instructions: [
                        {
                          programId: '11111111111111111111111111111111',
                          parsed: {
                            type: 'transfer',
                            info: {
                              source: WALLET,
                              destination: RECIPIENT,
                              lamports: 1_000_000,
                            },
                          },
                        },
                      ],
                    },
                  },
                }
              : {
                  blockTime: 1781794600,
                  meta: {
                    err: null,
                    fee: 5000,
                    preBalances: [1_000_000_000, 0, 0],
                    postBalances: [995_151_000, 4_844_000, 0],
                    preTokenBalances: [],
                    postTokenBalances: [],
                  },
                  transaction: {
                    message: {
                      accountKeys: [
                        { pubkey: WALLET },
                        { pubkey: UMBRA_POOL },
                        { pubkey: DEVNET_UMBRA_PROGRAM },
                      ],
                      instructions: [
                        {
                          programId: '11111111111111111111111111111111',
                          parsed: {
                            type: 'transfer',
                            info: {
                              source: WALLET,
                              destination: UMBRA_POOL,
                              lamports: 4_844_000,
                            },
                          },
                        },
                        {
                          programId: DEVNET_UMBRA_PROGRAM,
                          accounts: [WALLET, UMBRA_POOL, DEVNET_UMBRA_PROGRAM],
                        },
                      ],
                    },
                  },
                },
          };
        }

        if (request.method === 'getAssetBatch') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: [],
          };
        }

        throw new Error(`Unexpected RPC method: ${String(request.method)}`);
      };

      return jsonResponse(
        Array.isArray(requestBody) ? requestBody.map(respond) : respond(requestBody),
      );
    });

    setHeliusFetchImplementation(fetchMock);

    const response = await getWalletTransactions(bindings, {
      address: WALLET,
      network: 'devnet',
      limit: 100,
      useCache: false,
    });

    expect(response.transactions).toHaveLength(1);
    expect(response.transactions[0]).toMatchObject({
      signature: solSignature,
      amount: '0.001',
      rawAmount: '1000000',
      tokenMint: SOL_MINT,
      tokenSymbol: 'SOL',
      direction: 'send',
      recipient: RECIPIENT,
    });
  });
});
