import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { getOrSetSharedJsonCache } from '../shared-cache';

import type { Bindings } from '../types';

const bindings = {
  KV_REST_API_URL: 'https://kv.offpay.test',
  KV_REST_API_TOKEN: 'test-token',
} as Bindings;

const isValuePayload = (value: unknown): value is { value: number } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { value?: unknown }).value === 'number';

describe('getOrSetSharedJsonCache', () => {
  let originalFetch: typeof globalThis.fetch;
  let store: Map<string, string>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    store = new Map<string, string>();
    globalThis.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const commands = JSON.parse(String(init?.body ?? '[]')) as Array<Array<string | number>>;
      const results = commands.map((command) => {
        if (command[0] === 'GET') {
          const cacheKey = String(command[1]);
          return { result: store.get(cacheKey) ?? null };
        }

        if (command[0] === 'SET') {
          const cacheKey = String(command[1]);
          const cacheValue = String(command[2]);
          store.set(cacheKey, cacheValue);
          return { result: 'OK' };
        }

        return { error: 'unsupported command' };
      });

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns stale payload immediately and refreshes through waitUntil', async () => {
    const waitUntilTasks: Promise<unknown>[] = [];
    const resolver = jest.fn(async () => ({ value: 1 }));

    await expect(
      getOrSetSharedJsonCache({
        bindings,
        namespace: 'test-wallet-history',
        key: 'wallet:history:first-page',
        ttlMs: 10_000,
        staleTtlMs: 30_000,
        isValid: isValuePayload,
        resolver,
        waitUntil: (task) => waitUntilTasks.push(task),
      }),
    ).resolves.toEqual({ value: 1 });

    const [cacheKey, rawEnvelope] = Array.from(store.entries())[0];
    const envelope = JSON.parse(rawEnvelope);
    store.set(
      cacheKey,
      JSON.stringify({
        ...envelope,
        freshUntil: Date.now() - 1,
        staleUntil: Date.now() + 30_000,
      }),
    );

    resolver.mockResolvedValue({ value: 2 });
    await expect(
      getOrSetSharedJsonCache({
        bindings,
        namespace: 'test-wallet-history',
        key: 'wallet:history:first-page',
        ttlMs: 10_000,
        staleTtlMs: 30_000,
        isValid: isValuePayload,
        resolver,
        waitUntil: (task) => waitUntilTasks.push(task),
      }),
    ).resolves.toEqual({ value: 1 });

    expect(waitUntilTasks).toHaveLength(1);
    expect(resolver).toHaveBeenCalledTimes(2);

    await Promise.all(waitUntilTasks);
    await expect(
      getOrSetSharedJsonCache({
        bindings,
        namespace: 'test-wallet-history',
        key: 'wallet:history:first-page',
        ttlMs: 10_000,
        staleTtlMs: 30_000,
        isValid: isValuePayload,
        resolver,
      }),
    ).resolves.toEqual({ value: 2 });
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
