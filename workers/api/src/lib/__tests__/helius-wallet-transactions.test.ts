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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('getWalletTransactions RPC fallback', () => {
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

  it('hedges to the secondary provider when the primary RPC fails', async () => {
    const multiProviderBindings = {
      ...bindings,
      ALCHEMY_DEVNET_RPC_URL: 'https://alchemy.offpay.test',
    } as Bindings;
    const calledUrls: string[] = [];
    const fetchMock = jest.fn(async (input: string, init: RequestInit) => {
      calledUrls.push(input);
      // Primary (Helius) is down: every call to it fails fast.
      if (!input.includes('alchemy')) {
        return new Response('upstream error', { status: 503 });
      }
      // Secondary (Alchemy) answers with an empty (but valid) result set.
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
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
    });

    // The failed primary did not throw; the secondary served the result.
    expect(response.transactions).toEqual([]);
    expect(calledUrls.some((url) => !url.includes('alchemy'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('alchemy'))).toBe(true);
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

  it('uses raw RPC for mainnet wallet history instead of indexed enhanced history', async () => {
    const seenMethods: string[] = [];
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const requestBody =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer));
      const respond = (request: Record<string, unknown>) => {
        seenMethods.push(String(request.method));

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

    await getWalletTransactions(bindings, {
      address: WALLET,
      network: 'mainnet',
      limit: 5,
      useCache: false,
    });

    expect(seenMethods).toEqual([
      'getTokenAccountsByOwner',
      'getTokenAccountsByOwner',
      'getSignaturesForAddress',
    ]);
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
