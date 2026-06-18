import type { Context } from 'hono';

import { recordRequestTiming, setRequestCacheStatus, waitUntil } from './timing.js';
import type { AppEnv } from './types.js';

interface EdgeCacheEnvelope<T> {
  payload: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
}

interface EdgeJsonCacheOptions<T> {
  context: Context<AppEnv>;
  namespace: string;
  keyParts: readonly unknown[];
  freshTtlMs: number;
  staleTtlMs: number;
  resolver: () => Promise<T>;
  isValid?: (payload: unknown) => payload is T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCacheEnvelope(value: unknown): value is EdgeCacheEnvelope<unknown> {
  return (
    isRecord(value) &&
    'payload' in value &&
    typeof value.fetchedAt === 'number' &&
    typeof value.freshUntil === 'number' &&
    typeof value.staleUntil === 'number'
  );
}

function getDefaultCache(): Cache | null {
  const cloudflareCaches =
    typeof caches === 'undefined'
      ? null
      : (caches as CacheStorage & {
          default?: Cache;
        });
  return cloudflareCaches?.default ?? null;
}

function normalizeTtlMs(value: number): number {
  return Math.max(0, Math.floor(value));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildCacheRequest(
  context: Context<AppEnv>,
  namespace: string,
  keyParts: readonly unknown[],
): Promise<Request> {
  const rawKey = JSON.stringify({ namespace, keyParts });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
  const origin = new URL(context.req.url).origin;
  return new Request(
    `${origin}/__offpay-edge-cache/${encodeURIComponent(namespace)}/${toHex(digest)}`,
    {
      method: 'GET',
    },
  );
}

async function readEnvelope<T>(
  response: Response,
  isValid?: (payload: unknown) => payload is T,
): Promise<EdgeCacheEnvelope<T> | null> {
  if (!response.ok) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return null;
  }

  if (!isCacheEnvelope(parsed)) return null;
  if (isValid != null && !isValid(parsed.payload)) return null;

  return parsed as EdgeCacheEnvelope<T>;
}

async function writeEnvelope<T>(params: {
  cache: Cache;
  request: Request;
  payload: T;
  freshTtlMs: number;
  staleTtlMs: number;
}): Promise<void> {
  const now = Date.now();
  const freshTtlMs = normalizeTtlMs(params.freshTtlMs);
  const staleTtlMs = normalizeTtlMs(params.staleTtlMs);
  const envelope: EdgeCacheEnvelope<T> = {
    payload: params.payload,
    fetchedAt: now,
    freshUntil: now + freshTtlMs,
    staleUntil: now + freshTtlMs + staleTtlMs,
  };
  const maxAgeSeconds = Math.max(1, Math.ceil((freshTtlMs + staleTtlMs) / 1000));

  await params.cache.put(
    params.request,
    new Response(JSON.stringify(envelope), {
      headers: {
        'Cache-Control': `public, max-age=${maxAgeSeconds}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    }),
  );
}

async function refreshEdgeJsonCache<T>(
  options: EdgeJsonCacheOptions<T> & { cache: Cache; request: Request },
): Promise<void> {
  const startedAt = performance.now();
  const payload = await options.resolver();
  recordRequestTiming(
    options.context,
    `${options.namespace}_refresh`,
    performance.now() - startedAt,
  );
  await writeEnvelope({
    cache: options.cache,
    request: options.request,
    payload,
    freshTtlMs: options.freshTtlMs,
    staleTtlMs: options.staleTtlMs,
  });
}

export async function getOrSetEdgeJsonCache<T>(options: EdgeJsonCacheOptions<T>): Promise<T> {
  const cache = getDefaultCache();
  if (cache == null || options.freshTtlMs <= 0) {
    setRequestCacheStatus(options.context, 'bypass');
    return options.resolver();
  }

  const request = await buildCacheRequest(options.context, options.namespace, options.keyParts);
  const lookupStartedAt = performance.now();
  const cachedResponse = await cache.match(request);
  recordRequestTiming(
    options.context,
    `${options.namespace}_cache`,
    performance.now() - lookupStartedAt,
  );

  const now = Date.now();
  if (cachedResponse != null) {
    const cached = await readEnvelope(cachedResponse, options.isValid);
    if (cached != null && cached.staleUntil > now) {
      if (cached.freshUntil > now) {
        setRequestCacheStatus(options.context, 'hit');
        return cached.payload;
      }

      setRequestCacheStatus(options.context, 'stale');
      waitUntil(
        options.context,
        refreshEdgeJsonCache({
          ...options,
          cache,
          request,
        }),
      );
      return cached.payload;
    }
  }

  setRequestCacheStatus(options.context, 'miss');
  const resolverStartedAt = performance.now();
  const payload = await options.resolver();
  recordRequestTiming(
    options.context,
    `${options.namespace}_resolve`,
    performance.now() - resolverStartedAt,
  );
  waitUntil(
    options.context,
    writeEnvelope({
      cache,
      request,
      payload,
      freshTtlMs: options.freshTtlMs,
      staleTtlMs: options.staleTtlMs,
    }),
  );
  return payload;
}
