import { defaultShouldDehydrateQuery } from '@tanstack/query-core';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

import { mmkvStorage, waitForMmkvEncryption } from '@/lib/cache/mmkv-storage';
import { queryClient } from '@/lib/cache/query-client';

import type { Query } from '@tanstack/query-core';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

/**
 * App version cache buster. Bumping `APP_QUERY_CACHE_VERSION` will
 * cause TanStack to discard any persisted cache from older builds.
 * Bump it whenever a query's response shape changes.
 */
const APP_QUERY_CACHE_VERSION = 'v7';

/** 24 hours of cached query data is plenty for a wallet UI. */
const QUERY_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

/** Single key under which the cache file is stored. */
const QUERY_CACHE_KEY = 'offpay-tanstack-query-cache';

const QUERY_CACHE_WRITE_THROTTLE_MS = 1000;

// History should cold-start from the worker/server cache. Persisting wallet
// transaction query data can preserve optimistic single-send pages across
// app restarts and paint an incomplete history before the API responds.
const NON_PERSISTED_WALLET_QUERY_SCOPES = new Set([
  'walletTransactions',
  'walletTokenTransactions',
  'umbraEncryptedBalances',
  'umbraVaultRegistrationStatus',
  'privatePaymentBalance',
]);

let installed = false;
let restorePromise: Promise<void> | null = null;

function isNonPersistedWalletQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === 'offpay' && NON_PERSISTED_WALLET_QUERY_SCOPES.has(String(queryKey[1] ?? ''))
  );
}

function shouldDehydrateQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && !isNonPersistedWalletQueryKey(query.queryKey);
}

function removeRestoredNonPersistedWalletQueries(): void {
  for (const scope of NON_PERSISTED_WALLET_QUERY_SCOPES) {
    queryClient.removeQueries({
      queryKey: ['offpay', scope],
      exact: false,
    });
  }
}

function createEncryptedMmkvQueryPersister() {
  let pendingSerializedClient: string | null = null;
  let writeHandle: ReturnType<typeof setTimeout> | null = null;

  const flushPendingWrite = () => {
    if (writeHandle != null) {
      clearTimeout(writeHandle);
      writeHandle = null;
    }
    if (pendingSerializedClient == null) return;
    mmkvStorage.setItem(QUERY_CACHE_KEY, pendingSerializedClient);
    pendingSerializedClient = null;
  };

  return {
    persistClient(persistedClient: PersistedClient): void {
      pendingSerializedClient = JSON.stringify(persistedClient);
      if (writeHandle != null) return;
      writeHandle = setTimeout(flushPendingWrite, QUERY_CACHE_WRITE_THROTTLE_MS);
    },
    restoreClient(): PersistedClient | undefined {
      flushPendingWrite();
      const persisted = mmkvStorage.getItem(QUERY_CACHE_KEY);
      if (persisted == null || persisted.length === 0) return undefined;

      try {
        return JSON.parse(persisted) as PersistedClient;
      } catch (error: unknown) {
        mmkvStorage.removeItem(QUERY_CACHE_KEY);
        console.warn('[query-persistence] cached query payload was invalid:', error);
        return undefined;
      }
    },
    removeClient(): void {
      if (writeHandle != null) {
        clearTimeout(writeHandle);
        writeHandle = null;
      }
      pendingSerializedClient = null;
      mmkvStorage.removeItem(QUERY_CACHE_KEY);
    },
  };
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
 * Restore waits for MMKV's SecureStore-backed encryption key before
 * reading, then uses sync MMKV access instead of the old file adapter.
 * As soon as the encrypted cache loads, observers see the upgraded
 * data via TanStack's normal subscription path. While the cache
 * hydrates, background fetches still run to refresh stale entries.
 */
export function installQueryCachePersistence(): Promise<void> {
  if (installed && restorePromise != null) return restorePromise;
  installed = true;

  restorePromise = waitForMmkvEncryption()
    .then(() => {
      const [, persistedRestore] = persistQueryClient({
        queryClient,
        persister: createEncryptedMmkvQueryPersister(),
        maxAge: QUERY_CACHE_MAX_AGE_MS,
        buster: APP_QUERY_CACHE_VERSION,
        // Mutations are inherently transient and shouldn't be replayed
        // from disk; we only persist completed queries.
        dehydrateOptions: {
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery,
        },
      });

      return persistedRestore;
    })
    .then(removeRestoredNonPersistedWalletQueries)
    .catch((error: unknown) => {
      console.warn('[query-persistence] restore failed:', error);
    });

  return restorePromise;
}
