import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { getOrSetEdgeJsonCache } from '../edge-cache';

type FakeContext = {
  executionCtx: {
    waitUntil: (task: Promise<unknown>) => void;
  };
  req: {
    url: string;
  };
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
};

class FakeCache {
  readonly responses = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.responses.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.responses.set(request.url, response.clone());
  }
}

function createContext() {
  const values = new Map<string, unknown>();
  const waitUntilTasks: Promise<unknown>[] = [];
  const context: FakeContext = {
    executionCtx: {
      waitUntil: (task) => {
        waitUntilTasks.push(task);
      },
    },
    req: {
      url: 'https://api.offpay.test/api/wallet/balance?network=devnet',
    },
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
  };

  return { context, values, waitUntilTasks };
}

async function flushWaitUntil(tasks: Promise<unknown>[]): Promise<void> {
  const pending = tasks.splice(0, tasks.length);
  await Promise.all(pending);
}

describe('getOrSetEdgeJsonCache', () => {
  let originalCaches: unknown;
  let cache: FakeCache;

  beforeEach(() => {
    originalCaches = (globalThis as { caches?: unknown }).caches;
    cache = new FakeCache();
    (globalThis as { caches?: unknown }).caches = { default: cache };
  });

  afterEach(() => {
    (globalThis as { caches?: unknown }).caches = originalCaches;
  });

  it('returns a fresh cached payload without calling the resolver', async () => {
    const { context, values, waitUntilTasks } = createContext();
    const resolver = jest.fn(async () => ({ value: 1 }));

    await expect(
      getOrSetEdgeJsonCache({
        context: context as never,
        namespace: 'test_fresh',
        keyParts: ['devnet', 'wallet'],
        freshTtlMs: 10_000,
        staleTtlMs: 10_000,
        resolver,
      }),
    ).resolves.toEqual({ value: 1 });
    await flushWaitUntil(waitUntilTasks);

    resolver.mockResolvedValue({ value: 2 });
    await expect(
      getOrSetEdgeJsonCache({
        context: context as never,
        namespace: 'test_fresh',
        keyParts: ['devnet', 'wallet'],
        freshTtlMs: 10_000,
        staleTtlMs: 10_000,
        resolver,
      }),
    ).resolves.toEqual({ value: 1 });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(values.get('requestCacheStatus')).toBe('hit');
  });

  it('returns stale payload and refreshes in waitUntil', async () => {
    const { context, values, waitUntilTasks } = createContext();
    const resolver = jest.fn(async () => ({ value: 1 }));

    await getOrSetEdgeJsonCache({
      context: context as never,
      namespace: 'test_stale',
      keyParts: ['devnet', 'wallet'],
      freshTtlMs: 10_000,
      staleTtlMs: 30_000,
      resolver,
    });
    await flushWaitUntil(waitUntilTasks);

    const [cacheUrl, cachedResponse] = Array.from(cache.responses.entries())[0];
    const envelope = JSON.parse(await cachedResponse.clone().text());
    cache.responses.set(
      cacheUrl,
      new Response(
        JSON.stringify({
          ...envelope,
          freshUntil: Date.now() - 1,
          staleUntil: Date.now() + 30_000,
        }),
      ),
    );

    resolver.mockResolvedValue({ value: 2 });
    await expect(
      getOrSetEdgeJsonCache({
        context: context as never,
        namespace: 'test_stale',
        keyParts: ['devnet', 'wallet'],
        freshTtlMs: 10_000,
        staleTtlMs: 30_000,
        resolver,
      }),
    ).resolves.toEqual({ value: 1 });

    expect(values.get('requestCacheStatus')).toBe('stale');
    expect(resolver).toHaveBeenCalledTimes(2);

    await flushWaitUntil(waitUntilTasks);
    await expect(
      getOrSetEdgeJsonCache({
        context: context as never,
        namespace: 'test_stale',
        keyParts: ['devnet', 'wallet'],
        freshTtlMs: 10_000,
        staleTtlMs: 30_000,
        resolver,
      }),
    ).resolves.toEqual({ value: 2 });
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
