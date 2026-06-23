import { queryOptions } from '@tanstack/react-query';

import { getCapabilities } from '@/lib/api/offpay-api-client';
import {
  CAPABILITIES_FAST_TIMEOUT_MS,
  CAPABILITIES_GC_TIME_MS,
  CAPABILITIES_STALE_TIME_MS,
} from '@/lib/api/offpay-capability-fallback';
import { offpayCapabilitiesCacheKey } from '@/lib/api/offpay-dashboard-cache';

import type { QueryClient } from '@tanstack/react-query';
import type { CapabilitiesResponse, OffpayNetwork } from '@/types/offpay-api';

interface OffpayCapabilitiesQueryOptionsParams {
  network: OffpayNetwork | null;
  unsupportedReason?: string | null;
  requestOwner?: string;
  timeoutMs?: number;
}

interface PrefetchOffpayCapabilitiesParams {
  queryClient: QueryClient;
  network: OffpayNetwork;
  requestOwner?: string;
  force?: boolean;
}

export const offpayCapabilitiesQueryKey = (
  network: OffpayNetwork | null,
  walletAddress?: string | null,
) =>
  walletAddress == null
    ? offpayCapabilitiesCacheKey(network)
    : (['offpay', 'capabilities', network, walletAddress] as const);

export function isTransientCapabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name === 'aborterror' ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('aborted') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('network request failed')
  );
}

export function offpayCapabilitiesQueryOptions({
  network,
  unsupportedReason,
  requestOwner = 'capabilities',
  timeoutMs = CAPABILITIES_FAST_TIMEOUT_MS,
}: OffpayCapabilitiesQueryOptionsParams) {
  return queryOptions<CapabilitiesResponse>({
    queryKey: offpayCapabilitiesQueryKey(network),
    queryFn: ({ signal }) => {
      if (network == null) {
        throw new Error(unsupportedReason ?? 'This network is not supported by OffPay API.');
      }

      return getCapabilities(network, {
        signal,
        timeoutMs,
        requestOwner,
      });
    },
    staleTime: CAPABILITIES_STALE_TIME_MS,
    gcTime: CAPABILITIES_GC_TIME_MS,
    retry: (failureCount, error) => isTransientCapabilityError(error) && failureCount < 2,
    retryDelay: (failureCount) => 600 + failureCount * 900,
  });
}

export async function prefetchOffpayCapabilities({
  queryClient,
  network,
  requestOwner = 'bootstrap.capabilities',
  force = false,
}: PrefetchOffpayCapabilitiesParams): Promise<void> {
  const options = offpayCapabilitiesQueryOptions({
    network,
    requestOwner,
  });

  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      refetchType: 'none',
    });
  }

  await queryClient.prefetchQuery(options);
}
