import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { defaultShouldDehydrateQuery } from '@tanstack/query-core';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

import { queryClient } from '@/lib/cache/query-client';
import { queryCacheStorage } from '@/lib/cache/query-cache-storage';

import type { Query } from '@tanstack/query-core';

/**
 * App version cache buster. Bumping `APP_QUERY_CACHE_VERSION` will
 * cause TanStack to discard any persisted cache from older builds.
 * Bump it whenever a query's response shape changes.
 */
const APP_QUERY_CACHE_VERSION = 'v3';

/** 24 hours of cached query data is plenty for a wallet UI. */
const QUERY_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

/** Single key under which the cache file is stored. */
const QUERY_CACHE_KEY = 'offpay-tanstack-query-cache';

const VOLATILE_WALLET_QUERY_SCOPES = new Set([
  'walletBalance',
  'umbraEncryptedBalances',
  'umbraVaultRegistrationStatus',
  'privatePaymentBalance',
  'portfolioValuation',
  'tokenPriceHistory',
  'tokenValuations',
]);

let installed = false;
let restorePromise: Promise<void> | null = null;

function isVolatileWalletQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'offpay' && VOLATILE_WALLET_QUERY_SCOPES.has(String(queryKey[1] ?? ''));
}

function shouldDehydrateQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && !isVolatileWalletQueryKey(query.queryKey);
}

function removeRestoredVolatileWalletQueries(): void {
  for (const scope of VOLATILE_WALLET_QUERY_SCOPES) {
    queryClient.removeQueries({
      queryKey: ['offpay', scope],
      exact: false,
    });
  }
}

/**
 * Initialise the React Query cache persister.
 *
 * Returns a promise that resolves once the persisted cache has been
 * restored (or determined missing). Calling this more than once is a
 * no-op; subsequent callers receive the same promise.
 *
 * The hydration is async by design: the splash gate stays free of disk
 * IO and the home screen paints with whatever is already in memory.
 * As soon as the on-disk cache loads, observers see the upgraded data
 * via TanStack's normal subscription path. While the cache hydrates,
 * background fetches still run to refresh stale entries.
 */
export function installQueryCachePersistence(): Promise<void> {
  if (installed && restorePromise != null) return restorePromise;
  installed = true;

  const persister = createAsyncStoragePersister({
    storage: queryCacheStorage,
    key: QUERY_CACHE_KEY,
    // Throttle writes; React Query batches updates and writes on idle,
    // but a 1 s minimum keeps the disk cool even if many queries
    // resolve in quick succession.
    throttleTime: 1000,
  });

  const [, persistedRestore] = persistQueryClient({
    queryClient,
    persister,
    maxAge: QUERY_CACHE_MAX_AGE_MS,
    buster: APP_QUERY_CACHE_VERSION,
    // Mutations are inherently transient and shouldn't be replayed
    // from disk; we only persist completed queries.
    dehydrateOptions: {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery,
    },
  });

  restorePromise = persistedRestore
    .then(removeRestoredVolatileWalletQueries)
    .catch((error: unknown) => {
      console.warn('[query-persistence] restore failed:', error);
    });

  return restorePromise;
}
