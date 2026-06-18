import { useIsFetching, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { getWalletBalance } from '@/lib/api/offpay-api-client';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { observeOfflineTokenMetadataFromWalletBalance } from '@/lib/offline/offline-token-metadata';
import { useWalletStore } from '@/store/walletStore';

import type { CapabilityStatus, WalletBalanceResponse } from '@/types/offpay-api';

const WALLET_BALANCE_STALE_TIME_MS = 1000 * 15;
const WALLET_BALANCE_GC_TIME_MS = 1000 * 60 * 30;

interface UseOffpayWalletBalanceOptions {
  deferCapabilitiesUntilAfterInteractions?: boolean;
  eagerWithoutCapabilities?: boolean;
  enabled?: boolean;
}

export function useOffpayWalletBalance(
  walletAddressOverride?: string | null,
  options?: UseOffpayWalletBalanceOptions,
) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = walletAddressOverride ?? activeWalletAddress;
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const enabledByCaller = options?.enabled ?? true;
  const dashboardFetching =
    useIsFetching({
      queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
    }) > 0;
  const capabilitiesQuery = useOffpayCapabilities({
    deferUntilAfterInteractions: options?.deferCapabilitiesUntilAfterInteractions,
    enabled: enabledByCaller,
  });
  const { capabilities } = capabilitiesQuery;
  const capability: CapabilityStatus = !canUseNetwork
    ? {
        available: false,
        reason: 'temporarily_unavailable',
        message: 'Offline mode is using cached wallet data.',
      }
    : capabilities == null && capabilitiesQuery.hasCapabilityError
      ? {
          available: false,
          reason: 'temporarily_unavailable',
          message: capabilitiesQuery.errorMessage,
        }
      : getOffpayFeatureCapability(capabilities, 'wallet.balance');
  const capabilityAvailable = isOffpayFeatureAvailable(capabilities, 'wallet.balance');
  const enabled =
    enabledByCaller &&
    walletAddress != null &&
    network != null &&
    canUseNetwork &&
    !dashboardFetching &&
    (capabilityAvailable ||
      (options?.eagerWithoutCapabilities === true &&
        capabilities == null &&
        !capabilitiesQuery.hasCapabilityError));

  const query = useQuery<WalletBalanceResponse>({
    queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
    queryFn: ({ signal }) => {
      if (walletAddress == null || network == null) {
        throw new Error('Wallet balance requires an active wallet and supported network.');
      }

      return getWalletBalance(walletAddress, network, { signal });
    },
    enabled,
    staleTime: WALLET_BALANCE_STALE_TIME_MS,
    gcTime: WALLET_BALANCE_GC_TIME_MS,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === network && previousKey?.[3] === walletAddress
        ? previousData
        : undefined;
    },
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (query.data == null) {
      return;
    }

    void observeOfflineTokenMetadataFromWalletBalance(query.data);
  }, [query.data]);

  return {
    ...query,
    walletAddress,
    network,
    capability,
    isCapabilitiesPending:
      canUseNetwork && (capabilitiesQuery.isCapabilitiesPending || dashboardFetching),
    isCapabilityEnabled: capabilityAvailable || enabled,
  };
}
