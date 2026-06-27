import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair } from '@solana/web3.js';

import { requestDevnetTreasuryAirdrop } from '../devnet-faucet';
import { resetHeliusFetchImplementation, setHeliusFetchImplementation } from '../helius';

import type { Bindings } from '../types';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const faucetKeypair = Keypair.fromSeed(new Uint8Array(32).fill(7));
const recipientKeypair = Keypair.fromSeed(new Uint8Array(32).fill(9));

const bindings = {
  HELIUS_DEVNET_RPC_URL: 'https://rpc.offpay.test',
  KV_REST_API_URL: 'https://kv.offpay.test',
  KV_REST_API_TOKEN: 'test-kv',
  OFFPAY_DEVNET_FAUCET_SECRET_KEY: JSON.stringify(Array.from(faucetKeypair.secretKey)),
} as Bindings;

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonRpcErrorResponse(id: unknown, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32002,
        message,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function tokenAccountDataBase64(rawAmount: bigint): string {
  const data = Buffer.alloc(165);
  let remaining = rawAmount;
  for (let index = 0; index < 8; index += 1) {
    data[64 + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return data.toString('base64');
}

describe('requestDevnetTreasuryAirdrop', () => {
  let originalFetch: typeof globalThis.fetch;
  let kvStore: Map<string, string>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    kvStore = new Map<string, string>();
    globalThis.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const commands = JSON.parse(String(init?.body ?? '[]')) as Array<Array<string | number>>;
      const results = commands.map((command) => {
        const name = String(command[0]).toUpperCase();
        const key = String(command[1]);

        if (name === 'SET') {
          const nx = command.some((entry) => String(entry).toUpperCase() === 'NX');
          if (nx && kvStore.has(key)) {
            return { result: null };
          }
          kvStore.set(key, String(command[2]));
          return { result: 'OK' };
        }

        if (name === 'TTL') {
          return { result: kvStore.has(key) ? 14_400 : -2 };
        }

        if (name === 'DEL') {
          const deleted = kvStore.delete(key);
          return { result: deleted ? 1 : 0 };
        }

        return { error: `unsupported command ${name}` };
      });

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetHeliusFetchImplementation();
    jest.restoreAllMocks();
  });

  it('releases the faucet cooldown when transaction broadcast fails', async () => {
    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as {
          id: unknown;
          method: string;
          params: unknown[];
        };

        if (request.method === 'getBalance') {
          return jsonRpcResponse(request.id, { value: 10_000_000_000 });
        }

        if (request.method === 'getMultipleAccounts') {
          const addresses = Array.isArray(request.params[0]) ? (request.params[0] as string[]) : [];
          return jsonRpcResponse(request.id, {
            value: addresses.map((_, index) =>
              index % 2 === 0
                ? {
                    data: [tokenAccountDataBase64(1_000_000_000n), 'base64'],
                    executable: false,
                    lamports: 2_039_280,
                    owner: TOKEN_PROGRAM_ID,
                    rentEpoch: 0,
                  }
                : null,
            ),
          });
        }

        if (request.method === 'getMinimumBalanceForRentExemption') {
          return jsonRpcResponse(request.id, 2_039_280);
        }

        if (request.method === 'getLatestBlockhash') {
          return jsonRpcResponse(request.id, {
            value: {
              blockhash: '11111111111111111111111111111111',
              lastValidBlockHeight: 1_000,
            },
          });
        }

        if (request.method === 'sendTransaction') {
          return jsonRpcErrorResponse(request.id, 'invalid faucet transaction');
        }

        throw new Error(`Unexpected RPC method ${request.method}`);
      }),
    );

    await expect(
      requestDevnetTreasuryAirdrop(bindings, {
        walletAddress: recipientKeypair.publicKey.toBase58(),
      }),
    ).rejects.toThrow('invalid faucet transaction');

    expect(Array.from(kvStore.keys()).filter((key) => key.startsWith('devnet-faucet:'))).toEqual(
      [],
    );
  });
});
