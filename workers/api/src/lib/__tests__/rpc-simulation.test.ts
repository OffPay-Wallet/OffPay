import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  broadcastRawTransaction,
  resetHeliusFetchImplementation,
  setHeliusFetchImplementation,
  simulateRawTransaction,
} from '../helius';

import type { Bindings } from '../types';

const bindings = {
  HELIUS_MAINNET_RPC_URL: 'https://mainnet-rpc.offpay.test',
} as Bindings;

function rpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'test', result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('simulateRawTransaction', () => {
  afterEach(() => {
    resetHeliusFetchImplementation();
    jest.restoreAllMocks();
  });

  it('simulates the exact unsigned wire transaction without replacing its blockhash', async () => {
    const fetchMock = jest.fn(async (_input: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as {
        method: string;
        params: [string, Record<string, unknown>];
      };
      expect(request.method).toBe('simulateTransaction');
      expect(request.params).toEqual([
        'AQIDBA==',
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: 'confirmed',
        },
      ]);
      return rpcResponse({ value: { err: null, logs: [], unitsConsumed: 42_009 } });
    });
    setHeliusFetchImplementation(fetchMock);

    await expect(
      simulateRawTransaction(bindings, {
        transactionBase64: 'AQIDBA==',
        network: 'mainnet',
      }),
    ).resolves.toEqual({ success: true, error: null, unitsConsumed: 42_009 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized on-chain simulation failure instead of treating it as success', async () => {
    setHeliusFetchImplementation(
      jest.fn(async () =>
        rpcResponse({
          value: {
            err: { InstructionError: [0, 'Custom'] },
            logs: ['Program log: sensitive prelude', 'Program failed: insufficient funds for fee'],
            unitsConsumed: 3_100,
          },
        }),
      ),
    );

    await expect(
      simulateRawTransaction(bindings, {
        transactionBase64: 'AQIDBA==',
        network: 'mainnet',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Program failed: insufficient funds for fee',
      unitsConsumed: 3_100,
    });
  });

  it('preserves the actionable program log from sendTransaction preflight failures', async () => {
    setHeliusFetchImplementation(
      jest.fn(async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'test',
            error: {
              code: -32002,
              message: 'Transaction simulation failed',
              data: {
                err: { InstructionError: [1, 'Custom'] },
                logs: [
                  'Program log: Error: the RWA intent account is not initialized',
                  'Program failed: custom program error: 0xbc4',
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      broadcastRawTransaction(bindings, {
        rawTransaction: 'AQIDBA==',
        network: 'mainnet',
      }),
    ).rejects.toThrow('Program log: Error: the RWA intent account is not initialized');
  });
});
