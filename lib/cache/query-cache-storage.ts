import { File, Paths } from 'expo-file-system';

/**
 * Async storage adapter for `@tanstack/query-async-storage-persister`.
 *
 * Stores the persisted React Query cache as a single JSON file under
 * the platform cache directory. Cache directories can be wiped by
 * the OS under low-storage pressure, which is the right semantics
 * for a query cache: nothing here is unrecoverable, only a warm-start
 * acceleration.
 *
 * The persister itself handles serialisation, throttling, and busting;
 * this adapter just provides the I/O primitives.
 */

const QUERY_CACHE_FILENAME = 'tanstack-query-cache.json';

function getQueryCacheFile(): File {
  return new File(Paths.cache, QUERY_CACHE_FILENAME);
}

export const queryCacheStorage = {
  async getItem(_key: string): Promise<string | null> {
    try {
      const file = getQueryCacheFile();
      if (!file.exists) return null;
      return file.text();
    } catch {
      return null;
    }
  },

  async setItem(_key: string, value: string): Promise<void> {
    try {
      const file = getQueryCacheFile();
      file.write(value);
    } catch (error: unknown) {
      // Persisting the cache is best-effort; if the disk write fails,
      // the in-memory cache stays valid and the next foreground tick
      // will retry.
      console.warn('[query-cache-storage] setItem failed:', error);
    }
  },

  async removeItem(_key: string): Promise<void> {
    try {
      const file = getQueryCacheFile();
      if (!file.exists) return;
      file.delete();
    } catch {
      // Failing to clear is non-fatal; the cache will be overwritten
      // by the next setItem.
    }
  },
};
