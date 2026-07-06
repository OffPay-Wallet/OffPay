import { useQuery } from '@tanstack/react-query';

import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { getRwaAssets } from '@/lib/api/offpay-api-client';

import type { CapabilitiesResponse, OffpayNetwork, RwaAssetsResponse } from '@/types/offpay-api';

export const RWA_ASSETS_STALE_TIME_MS = 20 * 1000;
export const RWA_ASSETS_REFETCH_INTERVAL_MS = 30 * 1000;
export const RWA_ASSETS_GC_TIME_MS = 15 * 60 * 1000;

export function rwaAssetsQueryKey(network: string | null) {
  return ['offpay', 'rwa', 'assets', network] as const;
}

interface UseRwaAssetsParams {
  network: OffpayNetwork | null;
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null;
  requestOwner: string;
  refetchInterval?: boolean;
}

export function useRwaAssets({
  network,
  canUseNetwork,
  capabilities,
  requestOwner,
  refetchInterval = true,
}: UseRwaAssetsParams) {
  const canLoadAssets =
    network != null && canUseNetwork && isOffpayFeatureAvailable(capabilities, 'rwa.assets');

  return {
    canLoadAssets,
    query: useQuery<RwaAssetsResponse>({
      queryKey: rwaAssetsQueryKey(network),
      queryFn: ({ signal }) => {
        if (network == null) {
          throw new Error('RWA assets require a supported OffPay network.');
        }

        return getRwaAssets(network, {
          signal,
          requestOwner,
        });
      },
      enabled: canLoadAssets,
      staleTime: RWA_ASSETS_STALE_TIME_MS,
      gcTime: RWA_ASSETS_GC_TIME_MS,
      refetchOnMount: 'always',
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchInterval: canLoadAssets && refetchInterval ? RWA_ASSETS_REFETCH_INTERVAL_MS : false,
      refetchIntervalInBackground: false,
    }),
  };
}
