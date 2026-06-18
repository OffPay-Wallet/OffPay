import { useIsFetching, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getCapabilities } from '@/lib/api/offpay-api-client';
import {
  buildUnavailableCapabilities,
  CAPABILITIES_FAST_TIMEOUT_MS,
  CAPABILITIES_GC_TIME_MS,
  CAPABILITIES_STALE_TIME_MS,
} from '@/lib/api/offpay-capability-fallback';
import { offpayCapabilitiesCacheKey } from '@/lib/api/offpay-dashboard-cache';
import { offpayWalletDashboardBaseQueryKey } from '@/lib/api/offpay-wallet-query-keys';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { selectCapability } from '@/lib/api/offpay-capabilities';
import { observeOfflineSupportedStablecoins } from '@/lib/offline/offline-token-metadata';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { useWalletStore } from '@/store/walletStore';

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
    ? offpayCapabilitiesCacheKey(network)
    : (['offpay', 'capabilities', network, walletAddress] as const);

function isCapabilityRequestCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name === 'aborterror' ||
    message.includes('canceled') ||
    message.includes('cancelled') ||
    message.includes('aborted')
  );
}

export function useOffpayCapabilities(options?: UseOffpayCapabilitiesOptions) {
  const { network, unsupportedReason } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended, networkTransitionVersion } =
    useOffpayNetworkAccess();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const dashboardFetching =
    useIsFetching({
      queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
    }) > 0;
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
    queryFn: async ({ signal }) => {
      if (network == null) {
        throw new Error(unsupportedReason ?? 'This network is not supported by OffPay API.');
      }
      return getCapabilities(network, {
        signal,
        timeoutMs: CAPABILITIES_FAST_TIMEOUT_MS,
      });
    },
    enabled:
      capabilityIdentity != null &&
      readyCapabilityIdentity === capabilityIdentity &&
      !dashboardFetching,
    staleTime: CAPABILITIES_STALE_TIME_MS,
    gcTime: CAPABILITIES_GC_TIME_MS,
    placeholderData: (previousData) =>
      previousData?.network === network ? previousData : undefined,
    refetchOnMount: false,
    refetchOnReconnect: true,
    retry: false,
  });

  const isTransientCapabilityCancel = query.isError && isCapabilityRequestCancellation(query.error);
  const hasCapabilityError = query.isError && !query.isFetching && !isTransientCapabilityCancel;
  const fallbackCapabilities = useMemo(() => {
    if (!hasCapabilityError || network == null || !enabledByCaller) return null;
    const message =
      query.error instanceof Error
        ? `OffPay API capabilities are temporarily unavailable: ${query.error.message}`
        : 'OffPay API capabilities are temporarily unavailable.';
    return buildUnavailableCapabilities(network, message);
  }, [enabledByCaller, hasCapabilityError, network, query.error]);
  const capabilityResponse = query.data ?? fallbackCapabilities;
  const capabilities = capabilityResponse?.capabilities ?? null;

  useEffect(() => {
    if (query.data?.capabilities.offline?.supportedStablecoins == null) return;
    void observeOfflineSupportedStablecoins(
      query.data.network,
      query.data.capabilities.offline.supportedStablecoins,
    );
  }, [query.data]);
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
      (!hasCapabilityError || dashboardFetching),
  };
}

export { selectCapability };
