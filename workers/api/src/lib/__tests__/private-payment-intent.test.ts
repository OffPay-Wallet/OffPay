import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

import { resetHeliusFetchImplementation, setHeliusFetchImplementation } from '../helius';
import { executePrivatePayment } from '../payment';

import type { Bindings } from '../types';

const owner = Keypair.fromSeed(new Uint8Array(32).fill(91));
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(92)).publicKey.toBase58();
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const intentId = '00000000-0000-4000-8000-000000000091';
const signature =
  '2UV7CJH8ocFrkEQe8yRE2PW8ckZjsJdKqeGhBmjowwkgTKRJuRvy58aZnqQq9QfF87hbHDLpKfJ9kvCYXx1ji5a1';
const bindings = {
  HELIUS_MAINNET_RPC_URL: 'https://mainnet-rpc.offpay.test',
  UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
} as Bindings;

function wireTransaction(lamports: number): string {
  const message = new TransactionMessage({
    payerKey: owner.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: owner.publicKey,
        lamports,
      }),
    ],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([owner]);
  return Buffer.from(transaction.serialize()).toString('base64');
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id, result });
}

describe('MagicBlock private payment execution intent', () => {
  const signedTransaction = wireTransaction(1);
  const tamperedTransaction = wireTransaction(2);
  const messageBase64 = Buffer.from(
    VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64')).message.serialize(),
  ).toString('base64');
  let storage: Map<string, string>;
  let broadcastCalls: number;

  beforeEach(() => {
    storage = new Map([
      [
        `magicblock-private-send-intent:v1:${intentId}`,
        JSON.stringify({
          intentId,
          walletAddress: owner.publicKey.toBase58(),
          recipient,
          mint,
          amount: '1000000',
          network: 'mainnet',
          transactionMessageBase64: messageBase64,
          expiresAt: Date.now() + 60_000,
        }),
      ],
    ]);
    broadcastCalls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) !== 'https://redis.offpay.test/pipeline') {
        throw new Error(`Unexpected URL ${String(input)}`);
      }
      const commands = JSON.parse(String(init?.body ?? '[]')) as string[][];
      return jsonResponse(
        commands.map((command) => {
          const [operation, key, value] = command;
          if (operation === 'GET') return { result: storage.get(key ?? '') ?? null };
          if (operation === 'DEL') return { result: storage.delete(key ?? '') ? 1 : 0 };
          if (operation === 'SET') {
            if (command.includes('NX') && storage.has(key ?? '')) return { result: null };
            storage.set(key ?? '', value ?? '');
            return { result: 'OK' };
          }
          if (operation === 'EVAL') {
            const lockKey = command[3] ?? '';
            const token = command[4] ?? '';
            if (storage.get(lockKey) !== token) return { result: 0 };
            storage.delete(lockKey);
            return { result: 1 };
          }
          throw new Error(`Unexpected Redis operation ${operation}`);
        }),
      );
    });
    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { id: unknown; method: string };
        if (request.method === 'sendTransaction') {
          broadcastCalls += 1;
          return jsonRpcResponse(request.id, signature);
        }
        if (request.method === 'getTransaction') {
          return jsonRpcResponse(request.id, { meta: { err: null } });
        }
        throw new Error(`Unexpected RPC method ${request.method}`);
      }),
    );
  });

  afterEach(() => {
    resetHeliusFetchImplementation();
    jest.restoreAllMocks();
  });

  it('broadcasts only the exact prepared message with a valid wallet signature', async () => {
    await expect(
      executePrivatePayment(bindings, {
        intentId,
        walletAddress: owner.publicKey.toBase58(),
        signedTransaction,
        network: 'mainnet',
      }),
    ).resolves.toEqual({ intentId, signature, status: 'confirmed' });
    expect(broadcastCalls).toBe(1);
    expect(storage.has(`magicblock-private-send-intent:v1:${intentId}`)).toBe(false);
  });

  it('rejects a separately signed transaction before any broadcast', async () => {
    await expect(
      executePrivatePayment(bindings, {
        intentId,
        walletAddress: owner.publicKey.toBase58(),
        signedTransaction: tamperedTransaction,
        network: 'mainnet',
      }),
    ).rejects.toThrow('does not match the prepared transaction');
    expect(broadcastCalls).toBe(0);
  });
});
