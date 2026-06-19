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

const bindings = {
  HELIUS_DEVNET_RPC_URL: 'https://rpc.offpay.test',
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
});
