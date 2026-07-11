import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Keypair } from '@solana/web3.js';

import {
  getMagicBlockPrivateBalance,
  loginMagicBlockAuth,
  requestMagicBlockAuthChallenge,
} from '../magicblock';

import type { Bindings } from '../types';

const walletAddress = Keypair.fromSeed(new Uint8Array(32).fill(71)).publicKey.toBase58();
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ata = Keypair.fromSeed(new Uint8Array(32).fill(72)).publicKey.toBase58();
const bindings = {
  UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
} as Bindings;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MagicBlock private balance authentication', () => {
  let storage: Map<string, string>;
  let providerPrivateBalanceCalls: number;

  beforeEach(() => {
    storage = new Map();
    providerPrivateBalanceCalls = 0;
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
      }

      const parsed = new URL(url);
      if (parsed.pathname === '/v1/spl/challenge') {
        expect(parsed.searchParams.get('pubkey')).toBe(walletAddress);
        expect(parsed.searchParams.get('cluster')).toBe('mainnet');
        return jsonResponse({ challenge: 'sign-this-provider-challenge' });
      }
      if (parsed.pathname === '/v1/spl/login') {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          pubkey: walletAddress,
          challenge: 'sign-this-provider-challenge',
          signature: 'wallet-signature',
          cluster: 'mainnet',
          mock: false,
        });
        return jsonResponse({ token: 'real-provider-token' });
      }
      if (parsed.pathname === '/v1/spl/private-balance') {
        providerPrivateBalanceCalls += 1;
        expect(parsed.searchParams.get('address')).toBe(walletAddress);
        expect(parsed.searchParams.has('owner')).toBe(false);
        expect(parsed.searchParams.get('mint')).toBe(mint);
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer real-provider-token');
        return jsonResponse({
          address: walletAddress,
          mint,
          ata,
          location: 'ephemeral',
          balance: '1234',
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the official challenge/login token lifecycle before reading a private balance', async () => {
    const challenge = await requestMagicBlockAuthChallenge(bindings, {
      walletAddress,
      network: 'mainnet',
    });
    await expect(
      loginMagicBlockAuth(bindings, {
        walletAddress,
        network: 'mainnet',
        challenge: challenge.challenge,
        signature: 'wallet-signature',
      }),
    ).resolves.toMatchObject({ authenticated: true });

    await expect(
      getMagicBlockPrivateBalance(bindings, {
        address: walletAddress,
        mint,
        network: 'mainnet',
      }),
    ).resolves.toEqual({
      address: walletAddress,
      mint,
      ata,
      location: 'ephemeral',
      balance: '1234',
    });
    expect(providerPrivateBalanceCalls).toBe(1);
  });

  it('fails closed without a provider token and never fabricates a zero balance', async () => {
    await expect(
      getMagicBlockPrivateBalance(bindings, {
        address: walletAddress,
        mint,
        network: 'mainnet',
      }),
    ).rejects.toMatchObject({ code: 'MAGICBLOCK_AUTH_REQUIRED' });
    expect(providerPrivateBalanceCalls).toBe(0);
  });
});
