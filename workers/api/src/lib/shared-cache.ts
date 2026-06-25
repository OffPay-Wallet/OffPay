import { runKvPipeline } from './provider-utils.js';
import type { Bindings } from './types.js';

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createSharedCacheKey(namespace: string, key: string): Promise<string> {
  return `cache:${namespace}:${await sha256Hex(key)}`;
}

async function getSharedJsonCache<T>(
  bindings: Bindings,
  namespace: string,
  key: string,
): Promise<T | null> {
  try {
    const cacheKey = await createSharedCacheKey(namespace, key);
    const [rawValue] = await runKvPipeline(
      bindings,
      [['GET', cacheKey]],
      'Shared cache is temporarily unavailable.',
    );

    if (typeof rawValue !== 'string' || rawValue.length === 0) {
      return null;
    }

    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

async function setSharedJsonCache<T>(
  bindings: Bindings,
  namespace: string,
  key: string,
  value: T,
  ttlMs: number,
): Promise<void> {
  try {
    const cacheKey = await createSharedCacheKey(namespace, key);
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    await runKvPipeline(
      bindings,
      [['SET', cacheKey, JSON.stringify(value), 'EX', ttlSec]],
      'Shared cache is temporarily unavailable.',
    );
  } catch {
    // Shared cache is a performance layer only; upstream reads remain authoritative.
  }
}

async function getOrSetSharedJsonCache<T>(params: {
  bindings: Bindings;
  namespace: string;
  key: string;
  ttlMs: number;
  isValid: (value: unknown) => value is T;
  resolver: () => Promise<T>;
  recordTiming?: (name: string, durationMs: number) => void;
  metricLabel?: string;
}): Promise<T> {
  const label = params.metricLabel ?? 'kv';
  const getStartedAt = Date.now();
  const cached = await getSharedJsonCache<unknown>(params.bindings, params.namespace, params.key);
  params.recordTiming?.(`${label}_kv_get`, Date.now() - getStartedAt);
  if (cached != null && params.isValid(cached)) {
    return cached;
  }

  const value = await params.resolver();
  const setStartedAt = Date.now();
  await setSharedJsonCache(params.bindings, params.namespace, params.key, value, params.ttlMs);
  params.recordTiming?.(`${label}_kv_set`, Date.now() - setStartedAt);
  return value;
}

export { getOrSetSharedJsonCache };
