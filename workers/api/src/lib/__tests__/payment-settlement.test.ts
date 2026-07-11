import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { resetHeliusFetchImplementation, setHeliusFetchImplementation } from '../helius';
import { settlePrivatePayments } from '../payment';

import type { Bindings } from '../types';

const signature =
  '2UV7CJH8ocFrkEQe8yRE2PW8ckZjsJdKqeGhBmjowwkgTKRJuRvy58aZnqQq9QfF87hbHDLpKfJ9kvCYXx1ji5a1';
const bindings = {
  HELIUS_MAINNET_RPC_URL: 'https://mainnet-rpc.offpay.test',
} as Bindings;

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('private payment settlement finality', () => {
  afterEach(() => {
    jest.useRealTimers();
    resetHeliusFetchImplementation();
    jest.restoreAllMocks();
  });

  it('keeps a broadcast transaction pending when confirmation is not yet observable', async () => {
    jest.useFakeTimers();
    let statusChecks = 0;
    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { id: unknown; method: string };
        if (request.method === 'sendTransaction') return jsonRpcResponse(request.id, signature);
        if (request.method === 'getTransaction') {
          statusChecks += 1;
          return jsonRpcResponse(request.id, null);
        }
        throw new Error(`Unexpected method ${request.method}`);
      }),
    );

    const settlement = settlePrivatePayments(bindings, {
      signedBlobs: ['AQIDBA=='],
      network: 'mainnet',
    });
    await jest.runAllTimersAsync();

    await expect(settlement).resolves.toMatchObject({
      results: [{ signature, status: 'pending' }],
    });
    expect(statusChecks).toBe(12);
  });

  it('reports confirmed only after the RPC exposes a successful transaction', async () => {
    setHeliusFetchImplementation(
      jest.fn(async (_input: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { id: unknown; method: string };
        if (request.method === 'sendTransaction') return jsonRpcResponse(request.id, signature);
        if (request.method === 'getTransaction') {
          return jsonRpcResponse(request.id, { meta: { err: null } });
        }
        throw new Error(`Unexpected method ${request.method}`);
      }),
    );

    await expect(
      settlePrivatePayments(bindings, {
        signedBlobs: ['AQIDBA=='],
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({ results: [{ signature, status: 'confirmed' }] });
  });
});
