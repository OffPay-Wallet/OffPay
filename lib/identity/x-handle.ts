/**
 * X (Twitter) handle → Solana address resolution.
 *
 * Reads SNS's on-chain `.twitter` registry through the same RPC
 * fan-out we already use for `.sol` resolution (see `lib/sns.ts`).
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
 *  - Resolution is fully client-side. No backend proxy, no API key.
 *  - We never call X's own API or Privy's user lookup endpoint —
 *    those would require a server-side credential.
 *  - X handles are case-insensitive at the platform level; we
 *    normalize to lowercase for cache hits, but the on-chain
 *    registry is case-sensitive so we let the SDK do the lookup
 *    against the user-supplied form first.
 */
import { getRpcAccounts } from '@/lib/api/offpay-api-client';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type { OffpayNetwork, RpcAccountRecord } from '@/types/offpay-api';
import type { AccountInfo, Commitment, PublicKey } from '@solana/web3.js';

const X_HANDLE_RESOLUTION_NETWORK: OffpayNetwork = 'mainnet';
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

type PublicKeyCtor = typeof import('@solana/web3.js').PublicKey;

interface CachedXResolution {
  address: string | null; // null encodes a negative result
  expiresAt: number;
}

const xResolutionCache = new Map<string, CachedXResolution>();
let publicKeyCtorPromise: Promise<PublicKeyCtor> | null = null;

function getPublicKeyCtor(): Promise<PublicKeyCtor> {
  publicKeyCtorPromise ??= import('@solana/web3.js').then((module) => module.PublicKey);
  return publicKeyCtorPromise;
}

function normalizeLamports(value: RpcAccountRecord['lamports']): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeRentEpoch(value: RpcAccountRecord['rentEpoch']): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function decodeRpcAccountData(account: RpcAccountRecord): Buffer {
  const encoded = account.dataBase64 ?? account.data;
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return Buffer.alloc(0);
  }
  return Buffer.from(encoded, 'base64');
}

function normalizeRpcAccount(
  account: RpcAccountRecord | null,
  PublicKeyValue: PublicKeyCtor,
): AccountInfo<Buffer> | null {
  if (account == null || account.owner == null || !isValidSolanaAddress(account.owner)) {
    return null;
  }

  return {
    data: decodeRpcAccountData(account),
    executable: account.executable === true,
    lamports: normalizeLamports(account.lamports),
    owner: new PublicKeyValue(account.owner),
    rentEpoch: normalizeRentEpoch(account.rentEpoch),
  };
}

/**
 * Minimal Connection-like adapter sufficient for `getTwitterRegistry`.
 * Mirrors the shape `lib/sns.ts` uses so the same RPC plumbing
 * powers both lookups. We re-implement the adapter rather than
 * exporting it from `sns.ts` because the SNS module also exposes
 * `getTokenLargestAccounts` which the Twitter helper does not need.
 */
class OffpayXHandleConnection {
  async getAccountInfo(
    publicKey: PublicKey,
    _commitmentOrConfig?: Commitment | unknown,
  ): Promise<AccountInfo<Buffer> | null> {
    const [account] = await this.getMultipleAccountsInfo([publicKey]);
    return account ?? null;
  }

  async getMultipleAccountsInfo(
    publicKeys: PublicKey[],
    _commitmentOrConfig?: Commitment | unknown,
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    const response = await getRpcAccounts({
      network: X_HANDLE_RESOLUTION_NETWORK,
      addresses: publicKeys.map((publicKey) => publicKey.toBase58()),
    });

    const PublicKeyValue = await getPublicKeyCtor();
    return publicKeys.map((_, index) =>
      normalizeRpcAccount(response.accounts[index] ?? null, PublicKeyValue),
    );
  }
}

const xHandleConnection = new OffpayXHandleConnection();

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId != null) clearTimeout(timeoutId);
  });
}

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
  const { getTwitterRegistry } = await import('@bonfida/spl-name-service');
  let registry: Awaited<ReturnType<typeof getTwitterRegistry>>;
  try {
    registry = await getTwitterRegistry(xHandleConnection as never, handle);
  } catch (error) {
    // Bonfida throws when the registry account is missing — encode
    // that as a `null` so the cache can short-circuit subsequent
    // lookups for unregistered handles.
    const message = error instanceof Error ? error.message : '';
    if (/invalid name account|not\s*found|account does not exist/i.test(message)) {
      return null;
    }
    throw error;
  }

  const owner = registry?.owner?.toBase58?.();
  if (typeof owner !== 'string' || !isValidSolanaAddress(owner)) {
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

  const address = await withTimeout(
    resolveXHandleWithoutTimeout(handle),
    X_HANDLE_RESOLUTION_TIMEOUT_MS,
    `@${handle} lookup timed out. Check your connection and try again.`,
  );

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
