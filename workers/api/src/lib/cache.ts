import type { Network } from './types.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });

    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
    this.inFlight.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    resolver: () => Promise<T> | T,
  ): Promise<T> {
    const cachedValue = this.get<T>(key);
    if (cachedValue !== null) {
      return cachedValue;
    }

    const pendingValue = this.inFlight.get(key);
    if (pendingValue != null) {
      return pendingValue as Promise<T>;
    }

    const nextPromise = Promise.resolve()
      .then(resolver)
      .then((nextValue) => {
        this.set(key, nextValue, ttlMs);
        return nextValue;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, nextPromise);
    return nextPromise;
  }
}

function createCacheKey(namespace: string, parts: ReadonlyArray<string | number | boolean>): string {
  return [namespace, ...parts.map((part) => String(part))].join(':');
}

function createNetworkCacheKey(
  network: Network,
  namespace: string,
  parts: ReadonlyArray<string | number | boolean>,
): string {
  return createCacheKey(`${network}:${namespace}`, parts);
}

const memoryCache = new MemoryCache();

export { MemoryCache, createCacheKey, createNetworkCacheKey, memoryCache };
