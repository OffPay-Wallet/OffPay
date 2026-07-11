/**
 * X (Twitter) handle → Solana address resolution.
 *
 * Reads SNS's on-chain `.twitter` registry through the official SNS SDK proxy.
 *
 * Handle ownership in the SNS Twitter registry is verified at
 * registration time: the user posts a tweet from their X account
 * containing the wallet address, then signs a transaction binding
 * the handle to that wallet. Looking up the handle later returns
 * the wallet they registered, so a successful resolution provides
 * a reasonable trust signal.
 *
 * Reference: https://docs.bonfida.org/help/solana-name-service-twitter
 *
 * Notes:
 *  - Resolution uses the public, official SNS SDK proxy. No API key.
 *  - We never call X's own API or Privy's user lookup endpoint —
 *    those would require a server-side credential.
 *  - X handles are case-insensitive at the platform level; we
 *    normalize to lowercase for cache hits, but the on-chain
 *    registry is case-sensitive so we let the SDK do the lookup
 *    against the user-supplied form first.
 */
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { fetchSnsProxyResult } from '@/lib/identity/sns-proxy';

const X_HANDLE_CACHE_TTL_MS = 60 * 1000;
const X_HANDLE_NEGATIVE_CACHE_TTL_MS = 10 * 1000;
const X_HANDLE_RESOLUTION_TIMEOUT_MS = 6_000;

/**
 * X allows handles up to 15 alphanumerics + underscores. We accept
 * the bare handle, an `@` prefix, an `x.com/handle` URL, or a
 * `twitter.com/handle` URL — all coerced to the bare form for
 * lookup. Names longer than 15 chars are out of spec and rejected
 * up-front.
 */
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const X_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(@?[A-Za-z0-9_]{1,15})\/?$/i;

interface CachedXResolution {
  address: string | null; // null encodes a negative result
  expiresAt: number;
}

const xResolutionCache = new Map<string, CachedXResolution>();

/**
 * Strips the `@` prefix and any URL chrome around an X handle.
 * Returns the bare handle (no `@`) when the input is plausibly an
 * X handle; otherwise returns `null`.
 */
export function normalizeXHandle(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return null;
  if (isValidSolanaAddress(trimmed)) return null;

  // URL form first — extract the handle out of an x.com / twitter.com
  // path. We reject paths with more than one segment so we don't
  // silently treat `x.com/handle/status/123` as `handle`.
  const urlMatch = X_URL_PATTERN.exec(trimmed);
  if (urlMatch != null) {
    const handle = urlMatch[1].replace(/^@+/, '');
    return X_HANDLE_PATTERN.test(handle) ? handle : null;
  }

  // Bare handle, possibly @-prefixed.
  const stripped = trimmed.replace(/^@+/, '');
  if (X_HANDLE_PATTERN.test(stripped)) return stripped;

  return null;
}

/** Returns `true` when the input shape matches an X handle. */
export function isXHandleInput(value: string | null | undefined): boolean {
  return normalizeXHandle(value) != null;
}

async function resolveXHandleWithoutTimeout(handle: string): Promise<string | null> {
  const owner = await fetchSnsProxyResult({
    path: `twitter/get-key-by-handle/${encodeURIComponent(handle)}`,
    timeoutMs: X_HANDLE_RESOLUTION_TIMEOUT_MS,
    timeoutMessage: `@${handle} lookup timed out. Check your connection and try again.`,
  });
  if (owner != null && !isValidSolanaAddress(owner)) {
    return null;
  }
  return owner;
}

export interface ResolvedXHandle {
  /** Bare handle as resolved (no `@`). */
  handle: string;
  /** Base58 Solana wallet address. */
  address: string;
  /** Resolution source. Currently only `'sns-twitter'`. */
  source: 'sns-twitter';
}

export class XHandleNotRegisteredError extends Error {
  readonly handle: string;
  constructor(handle: string) {
    super(
      `@${handle} hasn't linked a Solana wallet on SNS yet. Ask them to register at sns.id/twitter or paste their wallet address.`,
    );
    this.name = 'XHandleNotRegisteredError';
    this.handle = handle;
  }
}

/**
 * Resolves an X handle to a Solana wallet via the SNS Twitter
 * registry. Throws `XHandleNotRegisteredError` when the handle has
 * no on-chain registration. Times out after 6s.
 */
export async function resolveXHandle(value: string): Promise<ResolvedXHandle> {
  const handle = normalizeXHandle(value);
  if (handle == null) {
    throw new Error('Enter a valid X handle (@username) or wallet address.');
  }

  const cacheKey = handle.toLowerCase();
  const cached = xResolutionCache.get(cacheKey);
  if (cached != null && cached.expiresAt > Date.now()) {
    if (cached.address == null) {
      throw new XHandleNotRegisteredError(handle);
    }
    return { handle, address: cached.address, source: 'sns-twitter' };
  }

  const address = await resolveXHandleWithoutTimeout(handle);

  xResolutionCache.set(cacheKey, {
    address,
    expiresAt:
      Date.now() + (address == null ? X_HANDLE_NEGATIVE_CACHE_TTL_MS : X_HANDLE_CACHE_TTL_MS),
  });

  if (address == null) {
    throw new XHandleNotRegisteredError(handle);
  }

  return { handle, address, source: 'sns-twitter' };
}
