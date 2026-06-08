/**
 * Per-message signature cache + in-flight dedup for external signers (Privy).
 *
 * Ed25519 is deterministic: the same `(wallet, message)` always produces the
 * same signature. The server validates request timestamps within a 60s window
 * (`TIMESTAMP_MAX_AGE_MS` in `workers/api/src/lib/auth.ts`), so caching
 * signatures for shorter than that window is always safe.
 *
 * The perf logs showed `txSign.signMessage.external.total` at 300-2200ms per
 * call (network round-trip to Privy). The same screens frequently fan out
 * several `offpayApiRequest` calls in parallel — each one signs the exact same
 * canonical message when they share `(wallet, method, path, body)` and land in
 * the same millisecond. Without dedup they pay the round-trip independently.
 *
 * This module:
 *
 *   1. **In-flight dedup** — concurrent calls with the same key share one
 *      signer invocation. Eliminates the paired 1800ms+1468ms pattern in the
 *      perf logs.
 *   2. **Short-TTL cache** — successful signatures are cached for 45s. Catches
 *      the second copy of an identical request fired slightly after the first
 *      finishes (e.g. React StrictMode double-mount in dev).
 *
 * The cache key includes the wallet address but NOT the device id, because
 * the server's signature check is bound to the wallet public key (not the
 * device). The HMAC is a separate concern; rotating the HMAC secret forces
 * an auth recovery, and recovery invalidates the sign cache too.
 */
import { mark, measure } from '@/lib/perf/perf-marks';

interface SignCacheEntry {
  signature: string;
  expiresAt: number;
}

/** Cached and in-flight entries share a `(walletAddress, message)` key. */
const cache = new Map<string, SignCacheEntry>();
const inFlight = new Map<string, Promise<string>>();

/**
 * TTL is intentionally below the server's 60s `TIMESTAMP_MAX_AGE_MS` so a
 * cached signature can never outlive the timestamp window that produced it.
 */
const SIGN_CACHE_TTL_MS = 45_000;

/**
 * Upper bound on cached entries. With a 45s TTL and 256 entries we cap
 * memory at ~256 × (~200 bytes per signature + key) ≈ 80KB, which is
 * negligible. The cap is a safety belt for runaway wallets; in practice the
 * cache never holds more than a few dozen entries.
 */
const MAX_CACHE_ENTRIES = 256;

function buildKey(walletAddress: string, message: string): string {
  return `${walletAddress}:${message}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function pruneIfOverCapacity(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const overflow = cache.size - MAX_CACHE_ENTRIES;
  for (let index = 0; index < overflow; index += 1) {
    const entry = sorted[index];
    if (entry != null) cache.delete(entry[0]);
  }
}

/**
 * Resolve a signature for `(walletAddress, message)`, sharing in-flight
 * signer calls and short-circuiting repeats from the local cache.
 *
 * `signer` is the actual sign function (e.g. a `signMessageForWallet` call
 * bound to a specific wallet). It is only invoked on cache miss AND when no
 * sibling caller is already in flight for the same key.
 */
export async function getCachedOrSign(
  walletAddress: string,
  message: string,
  signer: (message: string) => Promise<string>,
): Promise<string> {
  const key = buildKey(walletAddress, message);
  const now = Date.now();

  const cached = cache.get(key);
  if (cached != null && cached.expiresAt > now) {
    measure('apiAuth.signCache.hit', mark());
    return cached.signature;
  }

  const pending = inFlight.get(key);
  if (pending != null) {
    measure('apiAuth.signCache.join', mark());
    return pending;
  }

  const startedAt = mark();
  const promise = signer(message)
    .then((signature) => {
      cache.set(key, { signature, expiresAt: Date.now() + SIGN_CACHE_TTL_MS });
      pruneExpired(Date.now());
      pruneIfOverCapacity();
      measure('apiAuth.signCache.miss', startedAt);
      return signature;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Drop every cached and in-flight entry for a given wallet. Call this when
 * the server reports `SECRET_ROTATED` or `HMAC_INVALID` and the local
 * bootstrap is being re-derived. Signatures themselves are still valid for
 * the old (wallet, message) pair, but replaying them after a rotation
 * produces confusing server logs; clearing the cache is cheap insurance.
 */
export function invalidateSignCacheForWallet(walletAddress: string): void {
  const prefix = `${walletAddress}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) {
      inFlight.delete(key);
    }
  }
}

/** Drop every cached and in-flight entry. Used by tests. */
export function clearSignCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Test-only inspection of cache size. */
export function __INTERNAL_GET_SIGN_CACHE_SIZE(): number {
  return cache.size;
}

/** Test-only inspection of in-flight count. */
export function __INTERNAL_GET_IN_FLIGHT_SIZE(): number {
  return inFlight.size;
}
