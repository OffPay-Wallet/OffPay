import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';

import {
  createTriggerOrder,
  listTriggerOrders,
  prepareTriggerOrderDeposit,
  prepareTriggerOrderCancellation,
  verifyTriggerChallenge,
} from '../jupiter-trigger';

import type { Bindings } from '../types';

const owner = Keypair.fromSeed(new Uint8Array(32).fill(61));
const vault = Keypair.fromSeed(new Uint8Array(32).fill(62)).publicKey.toBase58();
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const bindings = {
  JUPITER_API_KEY: 'test-jupiter-key',
  JUPITER_TRIGGER_API_BASE_URL: 'https://api.jup.ag/trigger/v2',
  UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
} as Bindings;

function wireTransaction(lamports: number, signed: boolean): string {
  const transaction = new Transaction({
    feePayer: owner.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
  }).add(
    SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: owner.publicKey,
      lamports,
    }),
  );
  if (signed) transaction.sign(owner);
  return transaction
    .serialize({ requireAllSignatures: signed, verifySignatures: signed })
    .toString('base64');
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Jupiter Trigger V2 deposit transaction binding', () => {
  const unsignedDeposit = wireTransaction(1, false);
  const signedDeposit = wireTransaction(1, true);
  const unsignedCancellation = wireTransaction(3, false);
  let storage: Map<string, string>;
  let orderCreateCalls: number;
  let depositCraftBodies: Record<string, unknown>[];
  let cancelConfirmCalls: number;

  beforeEach(() => {
    storage = new Map();
    orderCreateCalls = 0;
    depositCraftBodies = [];
    cancelConfirmCalls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://redis.offpay.test/pipeline') {
        const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
        return jsonResponse(
          commands.map((command) => {
            const [operation, key, value] = command;
            if (operation === 'GET') return { result: storage.get(key ?? '') ?? null };
            if (operation === 'DEL') return { result: storage.delete(key ?? '') ? 1 : 0 };
            if (operation === 'SET') {
              const lockOnly = command.includes('NX');
              if (lockOnly && storage.has(key ?? '')) return { result: null };
              storage.set(key ?? '', value ?? '');
              return { result: 'OK' };
            }
            if (operation === 'EVAL') {
              const lockKey = command[3] ?? '';
              const lockToken = command[4] ?? '';
              if (storage.get(lockKey) !== lockToken) return { result: 0 };
              storage.delete(lockKey);
              return { result: 1 };
            }
            throw new Error(`Unexpected Redis operation: ${operation}`);
          }),
        );
      }
      if (url.endsWith('/auth/verify')) return jsonResponse({ token: 'trigger-jwt' });
      if (url.endsWith('/vault')) {
        return jsonResponse({
          userPubkey: owner.publicKey.toBase58(),
          vaultPubkey: vault,
          privyVaultId: 'vault-id',
          privyUserId: 'user-id',
        });
      }
      if (url.endsWith('/deposit/craft')) {
        depositCraftBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({
          requestId: 'deposit-request-1',
          transaction: unsignedDeposit,
          receiverAddress: vault,
          mint: inputMint,
          amount: '1000000',
          tokenDecimals: 9,
        });
      }
      if (url.endsWith('/orders/price')) {
        orderCreateCalls += 1;
        return jsonResponse({ id: 'trigger-1', txSignature: 'deposit-signature-1' });
      }
      if (url.includes('/orders/history?')) {
        return jsonResponse({
          orders: [
            {
              id: 'trigger-1',
              orderType: 'single',
              orderState: 'open',
              rawState: 'open',
              userPubkey: owner.publicKey.toBase58(),
              inputMint,
              outputMint,
              triggerMint: outputMint,
              initialInputAmount: '1000000',
              remainingInputAmount: '1000000',
              outputAmount: null,
              expiresAt: Date.now() + 60_000,
              createdAt: Date.now() - 1000,
              updatedAt: Date.now(),
            },
          ],
          pagination: { total: 1, limit: 20, offset: 0 },
        });
      }
      if (url.endsWith('/orders/price/cancel/trigger-1')) {
        return jsonResponse({
          id: 'trigger-1',
          transaction: unsignedCancellation,
          requestId: 'cancel-request-1',
        });
      }
      if (url.endsWith('/orders/price/confirm-cancel/trigger-1')) {
        cancelConfirmCalls += 1;
        return jsonResponse({ id: 'trigger-1', txSignature: 'cancel-signature-1' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function authenticate(): Promise<void> {
    await verifyTriggerChallenge(bindings, {
      walletAddress: owner.publicKey.toBase58(),
      network: 'mainnet',
      challengeType: 'message',
      signature: 'provider-verifies-this-signature',
    });
  }

  it('lists only orders bound to the authenticated Trigger wallet', async () => {
    await authenticate();

    await expect(
      listTriggerOrders(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
        state: 'active',
        limit: 20,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      orders: [{ id: 'trigger-1', orderState: 'open', inputMint, outputMint }],
      pagination: { total: 1, limit: 20, offset: 0 },
    });
  });

  it('fails deposit preparation closed before contacting the provider', async () => {
    await expect(
      prepareTriggerOrderDeposit(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        inputMint,
        outputMint,
        amount: '1000000',
        orderSubType: 'single',
        network: 'mainnet',
      }),
    ).rejects.toThrow('disabled until vault withdrawal transactions can be semantically verified');
    expect(depositCraftBodies).toHaveLength(0);
    expect(orderCreateCalls).toBe(0);
  });

  it('fails direct create attempts closed even if a stale deposit request ID is supplied', async () => {
    await expect(
      createTriggerOrder(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
        orderType: 'single',
        depositRequestId: 'deposit-request-1',
        depositSignedTransaction: signedDeposit,
        inputMint,
        inputAmount: '1000000',
        outputMint,
        triggerMint: outputMint,
        expiresAt: Date.now() + 60_000,
        triggerCondition: 'above',
        triggerPriceUsd: 200,
      }),
    ).rejects.toThrow('disabled until vault withdrawal transactions can be semantically verified');
    expect(orderCreateCalls).toBe(0);
  });

  it('fails cancellation preparation closed before requesting an unverifiable withdrawal', async () => {
    await expect(
      prepareTriggerOrderCancellation(bindings, {
        walletAddress: owner.publicKey.toBase58(),
        network: 'mainnet',
        orderId: 'trigger-1',
      }),
    ).rejects.toThrow('disabled until vault withdrawal transactions can be semantically verified');
    expect(cancelConfirmCalls).toBe(0);
  });
});
