/**
 * Session-scoped Ed25519 signing-seed cache.
 *
 * Why this exists:
 *   `lib/wallet.ts:deriveSigningSeedFromMnemonic` runs PBKDF2 with 2048
 *   rounds. Real-device measurements show 1000-2000ms per call. Today every
 *   protected API request, every Umbra signing op, every transaction signer,
 *   and every offline payment slot derive the same 32 bytes from scratch.
 *   Holding a derived seed in memory for the duration of an unlocked session
 *   collapses dozens of derivations per minute into one cold derivation per
 *   wallet per unlock.
 *
 * Security boundary:
 *   The cache lives only inside the unlocked session. AppLockGate already
 *   models "secrets allowed in memory" — when it transitions the wallet to
 *   locked or backgrounded, this cache is cleared. Wallet switch / delete /
 *   reset / fresh import also flush the cache. The cache never writes to
 *   disk, never crosses process boundaries, never leaves the JS runtime.
 *
 * Lifetime rules (tightest wins):
 *   - Sliding TTL: 2 minutes since last `getOrDeriveSigningSeed` hit.
 *   - Hard TTL: 10 minutes since the entry was first cached.
 *   - Manual clear from AppLockGate / wallet mutations.
 *
 * Cache key:
 *   The cache is keyed by Solana wallet public key (base58 string, the same
 *   value callers pass as `walletAddress`). Public key is concrete, available
 *   at every call site, and avoids both a `walletId` round-trip through
 *   SecureStore on every warm hit and any 'active'-sentinel ambiguity that
 *   could produce cross-wallet seed reuse during fast active-wallet switches.
 *
 * Cache invalidation strategy:
 *   Wallet switch / remove / delete / reset / app lock / app background all
 *   call the global `clearSigningSeedCache(reason)`. There is no per-wallet
 *   clear API today — wallet mutations are rare compared with signing, and
 *   the simplicity of always flushing avoids the secure-wallet-store needing
 *   to know how the cache is keyed.
 *
 * Concurrency model:
 *   Without dedupe, a burst of 20 concurrent protected requests during a
 *   warm-up triggers 20 PBKDF2 derivations on the JS thread. The
 *   `pending` map keyed by `walletAddress` stores the in-flight Promise so
 *   subsequent waves of the same wallet share one derivation.
 *
 *   Background-during-derivation correctness uses an epoch token. Every
 *   `clearSigningSeedCache()` increments the epoch. A pending derivation
 *   captures its starting epoch; when it resolves, it compares against the
 *   current epoch. If the epoch advanced (meaning a lock/switch happened
 *   while we were deriving), the resolved seed is zeroed and the awaiters
 *   reject with a SigningSeedCacheInvalidatedError so signing flows fail
 *   cleanly instead of completing with a seed that was derived under a
 *   privilege state that no longer applies.
 *
 * Returned ownership:
 *   Existing call sites zero the seed they receive after signing
 *   (`zeroOutBytes(signingSeed)`). To stay compatible without rewriting
 *   them, every cache hit returns a *copy* of the cached seed. The cache
 *   keeps the canonical bytes; callers may zero what they were given
 *   without touching the cache.
 *
 * Public-key verification policy:
 *   The cache does not verify `ed25519.getPublicKey(seed) === walletAddress`
 *   on hits. Verification happens at the *call sites* where the address is
 *   known. Reasoning: if a derived seed was verified before being cached,
 *   it cannot become wrong over time without a cache-invalidation event,
 *   and clearing the cache on wallet mutations + lock guarantees the
 *   address-to-seed mapping never drifts. Per-call-site verification is
 *   defense in depth against any future cache key bug.
 */
import { mark, measure } from '@/lib/perf/perf-marks';

const SLIDING_TTL_MS = 2 * 60_000;
const HARD_TTL_MS = 10 * 60_000;

interface CachedSeed {
  /** 32-byte Ed25519 signing seed. Owned by the cache, never returned by reference. */
  seed: Uint8Array;
  /** Hard expiry (ms epoch). After this point the entry is dropped on read. */
  expiresAt: number;
  /** Sliding stamp updated on every cache hit. */
  lastUsedAt: number;
}

/**
 * Diagnostic categories logged on every `getOrDeriveSigningSeed` call.
 * Matched against the perf log so warm-cache anomalies (e.g. unexpected
 * cold derivations mid-session) can be triaged without a debugger.
 */
type CacheReadOutcome =
  | 'cache-hit'
  | 'cache-pending-hit'
  | 'cache-miss-cold'
  | 'cache-miss-expired-sliding'
  | 'cache-miss-expired-hard'
  | 'cache-epoch-invalidated';

/** Key shape: normalized base58 wallet public key. */
const cache = new Map<string, CachedSeed>();
const pending = new Map<string, Promise<Uint8Array>>();

/**
 * Monotonically increasing token bumped on every cache clear. Pending
 * derivations capture their starting epoch and reject if it diverges
 * from the current epoch on resolution.
 */
let cacheEpoch = 0;

/** Thrown by `getOrDeriveSigningSeed` when a clear races a pending derivation. */
export class SigningSeedCacheInvalidatedError extends Error {
  constructor(reason: string) {
    super(`Signing-seed cache invalidated during derivation: ${reason}`);
    this.name = 'SigningSeedCacheInvalidatedError';
  }
}

function zeroBytes(bytes: Uint8Array): void {
  try {
    bytes.fill(0);
  } catch {
    // Best effort only.
  }
}

function copySeed(source: Uint8Array): Uint8Array {
  return Uint8Array.from(source);
}

function isExpired(entry: CachedSeed, now: number): 'sliding' | 'hard' | null {
  if (now >= entry.expiresAt) return 'hard';
  if (now - entry.lastUsedAt > SLIDING_TTL_MS) return 'sliding';
  return null;
}

function evictExpired(now: number): void {
  for (const [walletAddress, entry] of cache) {
    const kind = isExpired(entry, now);
    if (kind != null) {
      zeroBytes(entry.seed);
      cache.delete(walletAddress);
    }
  }
}

/**
 * Returns the last 6 characters of a wallet address. Solana base58
 * addresses are 32-44 chars, so the trailing 6 chars are stable
 * non-sensitive labels safe to log alongside cache events.
 */
function walletAddressSuffix(walletAddress: string): string {
  return walletAddress.length <= 6 ? walletAddress : walletAddress.slice(-6);
}

function logOutcome(
  outcome: CacheReadOutcome,
  walletAddress: string,
  payload?: Record<string, string | number | boolean | null>,
): void {
  measure(`signingSeedCache.${outcome}`, mark() - 1, {
    walletAddress: walletAddressSuffix(walletAddress),
    cacheSize: cache.size,
    pendingSize: pending.size,
    epoch: cacheEpoch,
    ...(payload ?? {}),
  });
}

/**
 * Read a cached seed if one exists and is still valid; otherwise derive
 * via the supplied callback, cache the result, and return a copy.
 *
 * `walletAddress` must be a non-empty base58 wallet public key. Callers
 * must NOT pass an `'active'` sentinel or any other placeholder. Keying
 * on the actual public key avoids cross-wallet seed reuse and keeps the
 * cache decoupled from the active-wallet store.
 *
 * Concurrent calls for the same `walletAddress` share the same
 * in-flight derivation. Concurrent calls for different addresses run
 * in parallel.
 */
export async function getOrDeriveSigningSeed(params: {
  walletAddress: string;
  derive: () => Promise<Uint8Array>;
}): Promise<Uint8Array> {
  const walletAddress = params.walletAddress.trim();
  if (walletAddress.length === 0) {
    throw new Error('Signing-seed cache requires a non-empty wallet address.');
  }

  const now = Date.now();
  // Capture pre-eviction state so a miss attributes to either sliding
  // or hard expiry rather than a flat `cache-miss-cold`.
  const entryBeforeEviction = cache.get(walletAddress);
  const expiryKindBeforeEviction =
    entryBeforeEviction != null ? isExpired(entryBeforeEviction, now) : null;
  evictExpired(now);

  const cached = cache.get(walletAddress);
  if (cached != null) {
    cached.lastUsedAt = now;
    logOutcome('cache-hit', walletAddress);
    return copySeed(cached.seed);
  }

  const existing = pending.get(walletAddress);
  if (existing != null) {
    logOutcome('cache-pending-hit', walletAddress);
    return existing.then((seed) => copySeed(seed));
  }

  if (expiryKindBeforeEviction === 'sliding') {
    logOutcome('cache-miss-expired-sliding', walletAddress);
  } else if (expiryKindBeforeEviction === 'hard') {
    logOutcome('cache-miss-expired-hard', walletAddress);
  } else {
    logOutcome('cache-miss-cold', walletAddress);
  }

  const startedAt = mark();
  const startEpoch = cacheEpoch;
  const derivation = params.derive().then(
    (derivedSeed) => {
      // If the cache was cleared while we were deriving (lock,
      // background, wallet switch), the seed we just computed is
      // tied to a privilege state that no longer applies. Zero the
      // seed and reject so the caller's signing flow fails cleanly.
      if (startEpoch !== cacheEpoch) {
        zeroBytes(derivedSeed);
        logOutcome('cache-epoch-invalidated', walletAddress, { startEpoch });
        throw new SigningSeedCacheInvalidatedError('cache cleared during derivation');
      }
      cache.set(walletAddress, {
        seed: derivedSeed,
        expiresAt: Date.now() + HARD_TTL_MS,
        lastUsedAt: Date.now(),
      });
      pending.delete(walletAddress);
      measure('signingSeedCache.deriveCold', startedAt, {
        walletAddress: walletAddressSuffix(walletAddress),
      });
      return copySeed(derivedSeed);
    },
    (error) => {
      pending.delete(walletAddress);
      throw error;
    },
  );

  pending.set(walletAddress, derivation);
  return derivation;
}

/**
 * Drop every cached seed and invalidate every in-flight derivation.
 *
 * `reason` is included in the perf log and in any
 * `SigningSeedCacheInvalidatedError` raised against pending awaiters,
 * which makes it easier to correlate signing failures with the
 * triggering lock/background/switch event.
 *
 * Call this from:
 *   - AppLockGate when the wallet transitions to locked/backgrounded
 *   - Wallet switch / delete / reset / fresh import paths
 *   - Any other privilege-state change that should drop in-memory secrets
 */
export function clearSigningSeedCache(reason: string = 'manual'): void {
  cacheEpoch += 1;
  for (const entry of cache.values()) {
    zeroBytes(entry.seed);
  }
  cache.clear();
  // Pending derivations cannot be canceled — they will check the new
  // epoch on resolve and zero+reject themselves. Dropping the map
  // entries here prevents fresh callers from awaiting stale promises.
  pending.clear();
  measure('signingSeedCache.clearAll', mark() - 1, { reason });
}

/** Test-only helper. Returns the wallet addresses with cached entries. */
export function __getCachedAddressesForTest(): string[] {
  return [...cache.keys()];
}
