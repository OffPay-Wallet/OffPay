import { runKvPipeline } from './provider-utils.js';
import type { Bindings } from './types.js';

const encoder = new TextEncoder();

interface SharedCacheEnvelope<T> {
  payload: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
}

interface SharedJsonCacheOptions<T> {
  bindings: Bindings;
  namespace: string;
  key: string;
  ttlMs: number;
  staleTtlMs?: number;
  isValid: (value: unknown) => value is T;
  resolver: () => Promise<T>;
  recordTiming?: (name: string, durationMs: number) => void;
  metricLabel?: string;
  waitUntil?: (task: Promise<unknown>) => void;
}

const refreshes = new Map<string, Promise<void>>();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createSharedCacheKey(namespace: string, key: string): Promise<string> {
  return `cache:${namespace}:${await sha256Hex(key)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSharedCacheEnvelope(value: unknown): value is SharedCacheEnvelope<unknown> {
  return (
    isRecord(value) &&
    'payload' in value &&
    typeof value.fetchedAt === 'number' &&
    typeof value.freshUntil === 'number' &&
    typeof value.staleUntil === 'number'
  );
}

function normalizeTtlMs(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}

function createSharedCacheEnvelope<T>(
  payload: T,
  freshTtlMs: number,
  staleTtlMs: number,
): SharedCacheEnvelope<T> {
  const now = Date.now();
  return {
    payload,
    fetchedAt: now,
    freshUntil: now + normalizeTtlMs(freshTtlMs),
    staleUntil: now + normalizeTtlMs(freshTtlMs) + normalizeTtlMs(staleTtlMs),
  };
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

async function refreshSharedJsonCache<T>(params: SharedJsonCacheOptions<T>): Promise<void> {
  const label = params.metricLabel ?? 'kv';
  const resolveStartedAt = Date.now();
  const value = await params.resolver();
  params.recordTiming?.(`${label}_kv_refresh`, Date.now() - resolveStartedAt);

  const staleTtlMs = normalizeTtlMs(params.staleTtlMs);
  const setStartedAt = Date.now();
  const valueToCache =
    staleTtlMs > 0 ? createSharedCacheEnvelope(value, params.ttlMs, staleTtlMs) : value;
  await setSharedJsonCache(
    params.bindings,
    params.namespace,
    params.key,
    valueToCache,
    params.ttlMs + staleTtlMs,
  );
  params.recordTiming?.(`${label}_kv_set`, Date.now() - setStartedAt);
}

function scheduleSharedJsonCacheRefresh<T>(params: SharedJsonCacheOptions<T>): void {
  const refreshKey = `${params.namespace}:${params.key}`;
  const existingRefresh = refreshes.get(refreshKey);
  if (existingRefresh != null) {
    params.waitUntil?.(existingRefresh);
    return;
  }

  const refresh = refreshSharedJsonCache(params).finally(() => {
    refreshes.delete(refreshKey);
  });
  const guardedRefresh = refresh.catch(() => undefined);
  refreshes.set(refreshKey, guardedRefresh);

  if (params.waitUntil != null) {
    params.waitUntil(guardedRefresh);
    return;
  }

  void guardedRefresh;
}

async function getOrSetSharedJsonCache<T>(params: SharedJsonCacheOptions<T>): Promise<T> {
  const label = params.metricLabel ?? 'kv';
  const getStartedAt = Date.now();
  const cached = await getSharedJsonCache<unknown>(params.bindings, params.namespace, params.key);
  params.recordTiming?.(`${label}_kv_get`, Date.now() - getStartedAt);
  const staleTtlMs = normalizeTtlMs(params.staleTtlMs);

  if (cached != null) {
    if (staleTtlMs > 0 && isSharedCacheEnvelope(cached) && params.isValid(cached.payload)) {
      const now = Date.now();
      if (cached.staleUntil > now) {
        if (cached.freshUntil <= now) {
          scheduleSharedJsonCacheRefresh(params);
        }

        return cached.payload;
      }
    }

    if (params.isValid(cached)) {
      return cached;
    }
  }

  const value = await params.resolver();
  const setStartedAt = Date.now();
  const valueToCache =
    staleTtlMs > 0 ? createSharedCacheEnvelope(value, params.ttlMs, staleTtlMs) : value;
  await setSharedJsonCache(
    params.bindings,
    params.namespace,
    params.key,
    valueToCache,
    params.ttlMs + staleTtlMs,
  );
  params.recordTiming?.(`${label}_kv_set`, Date.now() - setStartedAt);
  return value;
}

export { getOrSetSharedJsonCache };
