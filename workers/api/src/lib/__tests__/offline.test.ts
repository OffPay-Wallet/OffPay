import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  OFFLINE_SLOT_MAX_COUNT,
  TOKEN_PROGRAM_ID,
  prepareNoncePool,
  resetOfflineNonceStoreFactory,
  setOfflineNonceStoreFactory,
  type OfflineNonceStore,
  type StoredIdempotencyRecord,
} from '../offline';
import { resetHeliusFetchImplementation, setHeliusFetchImplementation } from '../helius';

import type { Bindings, Network } from '../types';

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

function publicKey(seed: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(seed)));
}

function jsonRpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'test', result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createStore(initialNonceAccounts: string[]): OfflineNonceStore & {
  nonceAccounts: Set<string>;
} {
  const idempotency = new Map<string, StoredIdempotencyRecord>();
  const nonceAccounts = new Set(initialNonceAccounts);

  return {
    nonceAccounts,
    async getIdempotencyRecord(storageKey) {
      return idempotency.get(storageKey) ?? null;
    },
    async storeIdempotencyRecord(storageKey, record) {
      if (idempotency.has(storageKey)) return false;
      idempotency.set(storageKey, record);
      return true;
    },
    async acquireNoncePoolLock() {
      return 'lock-token';
    },
    async releaseNoncePoolLock() {},
    async addNonceAccounts(_walletAddress, _network, accounts) {
      accounts.forEach((account) => nonceAccounts.add(account));
    },
    async removeNonceAccounts(_walletAddress, _network, accounts) {
      accounts.forEach((account) => nonceAccounts.delete(account));
    },
    async listNonceAccounts() {
      return Array.from(nonceAccounts);
    },
  };
}

function rpcAccountResponseFor(method: string, params: unknown): unknown {
  if (method === 'getMinimumBalanceForRentExemption') {
    return 1_447_680;
  }

  if (method === 'getLatestBlockhash') {
    return {
      value: {
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 1,
      },
    };
  }

  if (method === 'getMultipleAccounts') {
    const addresses = Array.isArray(params) && Array.isArray(params[0]) ? params[0] : [];
    return {
      value: addresses.map(() => null),
    };
  }

  throw new Error(`Unexpected RPC method ${method}`);
}

describe('offline nonce pool preparation', () => {
  afterEach(() => {
    resetOfflineNonceStoreFactory();
    resetHeliusFetchImplementation();
    jest.restoreAllMocks();
  });

  it('prunes missing backend nonce accounts before enforcing the 50 slot cap', async () => {
    const walletAddress = publicKey(1);
    const oldMissingAccounts = Array.from({ length: OFFLINE_SLOT_MAX_COUNT }, (_, index) =>
      publicKey(index + 2),
    );
    const requestedAccounts = Array.from({ length: 10 }, (_, index) => publicKey(index + 80));
    const store = createStore(oldMissingAccounts);

    setOfflineNonceStoreFactory(() => store);
    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { method: string; params: unknown };
        return jsonRpcResponse(rpcAccountResponseFor(request.method, request.params));
      }),
    );

    const result = await prepareNoncePool(bindings, {
      walletAddress,
      nonceAuthority: walletAddress,
      nonceAccounts: requestedAccounts,
      network: 'devnet',
      idempotencyKey: 'prepare-after-prune',
    });

    expect(result.unsignedTransactions).toHaveLength(10);
    expect(store.nonceAccounts.size).toBe(10);
    expect(requestedAccounts.every((account) => store.nonceAccounts.has(account))).toBe(true);
    expect(oldMissingAccounts.some((account) => store.nonceAccounts.has(account))).toBe(false);
  });

  it('still counts existing non-missing nonce accounts against the 50 slot cap', async () => {
    const walletAddress = publicKey(101);
    const existingAccounts = Array.from({ length: OFFLINE_SLOT_MAX_COUNT }, (_, index) =>
      publicKey(index + 102),
    );
    const requestedAccounts = Array.from({ length: 10 }, (_, index) => publicKey(index + 180));
    const store = createStore(existingAccounts);

    setOfflineNonceStoreFactory(() => store);
    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { method: string; params: unknown };
        if (request.method === 'getMultipleAccounts') {
          const addresses =
            Array.isArray(request.params) && Array.isArray(request.params[0])
              ? (request.params[0] as string[])
              : [];
          return jsonRpcResponse({
            value: addresses.map(() => ({
              data: null,
              executable: false,
              lamports: 1_447_680,
              owner: TOKEN_PROGRAM_ID,
              rentEpoch: 0,
            })),
          });
        }

        return jsonRpcResponse(rpcAccountResponseFor(request.method, request.params));
      }),
    );

    await expect(
      prepareNoncePool(bindings, {
        walletAddress,
        nonceAuthority: walletAddress,
        nonceAccounts: requestedAccounts,
        network: 'devnet' as Network,
        idempotencyKey: 'prepare-over-cap',
      }),
    ).rejects.toThrow('exceeds the 50 slot maximum');
    expect(store.nonceAccounts.size).toBe(OFFLINE_SLOT_MAX_COUNT);
  });
});
