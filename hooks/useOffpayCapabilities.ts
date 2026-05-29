import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getCapabilities } from '@/lib/api/offpay-api-client';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { selectCapability } from '@/lib/api/offpay-capabilities';
import { observeOfflineSupportedStablecoins } from '@/lib/offline/offline-token-metadata';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';

import type { CapabilitiesResponse, OffpayNetwork } from '@/types/offpay-api';

interface UseOffpayCapabilitiesOptions {
  deferUntilAfterInteractions?: boolean;
  enabled?: boolean;
}

export const offpayCapabilitiesQueryKey = (
  network: OffpayNetwork | null,
  walletAddress?: string | null,
) =>
  walletAddress == null
    ? (['offpay', 'capabilities', network] as const)
    : (['offpay', 'capabilities', network, walletAddress] as const);

export function useOffpayCapabilities(options?: UseOffpayCapabilitiesOptions) {
  const { network, unsupportedReason } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended, networkTransitionVersion } =
    useOffpayNetworkAccess();
  const deferUntilAfterInteractions = options?.deferUntilAfterInteractions ?? false;
  const enabledByCaller = options?.enabled ?? true;
  const handledTransitionVersionRef = useRef(networkTransitionVersion);
  const capabilityIdentity = useMemo(() => {
    if (!enabledByCaller || network == null || !canUseNetwork) return null;
    return `${network}:${networkTransitionVersion}`;
  }, [canUseNetwork, enabledByCaller, network, networkTransitionVersion]);
  const [readyCapabilityIdentity, setReadyCapabilityIdentity] = useState<string | null>(null);

  useEffect(() => {
    setReadyCapabilityIdentity(null);
    if (capabilityIdentity == null) return;

    const shouldDeferForNetworkSwitch =
      handledTransitionVersionRef.current !== networkTransitionVersion;
    const markCapabilitiesReady = () => {
      handledTransitionVersionRef.current = networkTransitionVersion;
      setReadyCapabilityIdentity(capabilityIdentity);
    };

    if (!deferUntilAfterInteractions && !shouldDeferForNetworkSwitch) {
      markCapabilitiesReady();
      return;
    }

    const scheduled = scheduleUiWorkAfterFirstPaint(() => markCapabilitiesReady(), {
      timeoutMs: 2500,
      fallbackDelayMs: 350,
    });

    return () => {
      scheduled.cancel();
    };
  }, [capabilityIdentity, deferUntilAfterInteractions, networkTransitionVersion]);

  const query = useQuery<CapabilitiesResponse>({
    queryKey: offpayCapabilitiesQueryKey(network),
    queryFn: async () => {
      if (network == null) {
        throw new Error(unsupportedReason ?? 'This network is not supported by OffPay API.');
      }
      return getCapabilities(network);
    },
    enabled: capabilityIdentity != null && readyCapabilityIdentity === capabilityIdentity,
    staleTime: 1000 * 60 * 5,
    placeholderData: (previousData) =>
      previousData?.network === network ? previousData : undefined,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const capabilities = query.data?.capabilities ?? null;

  useEffect(() => {
    if (query.data?.capabilities.offline?.supportedStablecoins == null) return;
    void observeOfflineSupportedStablecoins(
      query.data.network,
      query.data.capabilities.offline.supportedStablecoins,
    );
  }, [query.data]);
  const hasCapabilityError = query.isError && !query.isFetching;
  const errorMessage =
    query.error instanceof Error ? query.error.message : 'OffPay capabilities failed to load.';

  return {
    ...query,
    network,
    unsupportedReason,
    capabilities,
    errorMessage,
    hasCapabilityError,
    isCapabilitiesPending:
      !isNetworkAccessSuspended &&
      enabledByCaller &&
      canUseNetwork &&
      network != null &&
      capabilities == null &&
      !hasCapabilityError,
  };
}

export { selectCapability };
