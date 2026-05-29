import { QueryClient } from '@tanstack/react-query';

import { isOfflineNetworkBlockedError } from '@/lib/api/network-access-policy';

interface OffpayApiErrorLike {
  name: string;
  code: string;
  retryable: boolean;
  retryAfterMs: number;
}

const MAX_QUERY_RETRIES = 2;
const MAX_MUTATION_RETRIES = 1;
const MAX_RATE_LIMIT_RETRY_AFTER_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

function getOffpayApiError(error: unknown): OffpayApiErrorLike | null {
  if (typeof error !== 'object' || error == null) return null;

  const candidate = error as Partial<OffpayApiErrorLike>;
  if (
    candidate.name !== 'OffpayApiError' && candidate.name !== 'ProviderRouterError'
  ) {
    return null;
  }

  if (
    typeof candidate.code !== 'string' ||
    typeof candidate.retryable !== 'boolean' ||
    typeof candidate.retryAfterMs !== 'number'
  ) {
    return null;
  }

  return candidate as OffpayApiErrorLike;
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isOfflineNetworkBlockedError(error)) return false;

  const offpayError = getOffpayApiError(error);

  if (offpayError != null) {
    if (!offpayError.retryable) return false;

    if (offpayError.code === 'RATE_LIMITED') {
      return (
        failureCount <= 1 &&
        offpayError.retryAfterMs > 0 &&
        offpayError.retryAfterMs <= MAX_RATE_LIMIT_RETRY_AFTER_MS
      );
    }
  }

  return failureCount <= MAX_QUERY_RETRIES;
}

function shouldRetryMutation(failureCount: number, error: unknown): boolean {
  if (isOfflineNetworkBlockedError(error)) return false;

  const offpayError = getOffpayApiError(error);

  if (offpayError != null) {
    if (!offpayError.retryable || offpayError.code === 'RATE_LIMITED') return false;
  }

  return failureCount <= MAX_MUTATION_RETRIES;
}

function getRetryDelay(attemptIndex: number, error: unknown): number {
  const offpayError = getOffpayApiError(error);

  if (offpayError?.code === 'RATE_LIMITED') {
    return Math.min(
      Math.max(offpayError.retryAfterMs, DEFAULT_RETRY_DELAY_MS),
      MAX_RATE_LIMIT_RETRY_AFTER_MS,
    );
  }

  // Jittered exponential backoff: pick a value in [base/2, base) so a
  // herd of retries from the same parent doesn't all fire on the same
  // tick after a transient outage clears.
  const base = Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** attemptIndex, MAX_RETRY_DELAY_MS);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

/**
 * TanStack Query client with production-grade defaults.
 *
 * - staleTime: 60s — data stays fresh for 1 minute before background refetch
 * - gcTime: 5min — unused cache entries are garbage collected after 5 minutes
 * - retry: backend-aware retry policy that honors OffPay 429 retryAfterMs
 * - refetchOnWindowFocus: false — disabled since mobile apps handle focus differently
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes
      retry: shouldRetryQuery,
      retryDelay: getRetryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Long-running wallet/Umbra/SDK mutations should not fail
      // immediately when the device is offline. `'offlineFirst'`
      // attempts the request once and lets the offline guard reject
      // through `OfflineNetworkBlockedError`; transient connectivity
      // gaps queue the mutation until the next reconnect.
      networkMode: 'offlineFirst',
      retry: shouldRetryMutation,
      retryDelay: getRetryDelay,
    },
  },
});
