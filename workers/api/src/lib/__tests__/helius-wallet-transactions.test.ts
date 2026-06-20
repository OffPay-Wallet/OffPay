import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
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

const bindings = {
  HELIUS_DEVNET_RPC_URL: 'https://rpc.offpay.test',
  HELIUS_MAINNET_API_KEY: 'test-mainnet-key',
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

  it('fetches token-account signatures so arbitrary token transfer history is not stablecoin-only', async () => {
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
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '12345000', decimals: 5 },
                  },
                  {
                    owner: WALLET,
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '0', decimals: 5 },
                  },
                ],
                postTokenBalances: [
                  {
                    owner: sender,
                    mint: OTHER_TOKEN_MINT,
                    uiTokenAmount: { amount: '0', decimals: 5 },
                  },
                  {
                    owner: WALLET,
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

  it('does not ask the mainnet enhanced history endpoint for token-account-only results', async () => {
    const fetchMock = jest.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.pathname).toBe(`/v0/addresses/${WALLET}/transactions`);
      expect(url.searchParams.has('token-accounts')).toBe(false);
      return jsonResponse([]);
    });

    setHeliusFetchImplementation(fetchMock);

    await getWalletTransactions(bindings, {
      address: WALLET,
      network: 'mainnet',
      limit: 5,
      useCache: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
