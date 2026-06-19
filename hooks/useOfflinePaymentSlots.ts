import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  getOfflinePaymentSlotRentEstimate,
  reclaimOfflinePaymentSlotRent,
  loadOfflinePaymentSlotSnapshot,
  prepareOfflinePaymentSlots,
  refreshOfflinePaymentSlotsFromBackendStatus,
} from '@/lib/offline/offline-payment-slots';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayNetwork } from '@/types/offpay-api';
import type { QueryClient } from '@tanstack/react-query';
import type {
  OfflinePaymentSlotSnapshot,
  OfflineSlotReclaimAuthorization,
  OfflineSlotSpendAuthorization,
} from '@/lib/offline/offline-payment-slots';

interface PrepareOfflinePaymentSlotsInput {
  targetSlotCount?: number;
  spendAuthorization: OfflineSlotSpendAuthorization;
}

interface ReclaimOfflinePaymentSlotsInput {
  reclaimAuthorization: OfflineSlotReclaimAuthorization;
}

interface UseOfflinePaymentSlotsOptions {
  deferCapabilitiesUntilAfterInteractions?: boolean;
  enabled?: boolean;
  statusEnabled?: boolean;
  rentEstimateEnabled?: boolean;
  targetSlotCount?: number;
}

export const offlinePaymentSlotsQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'offlinePaymentSlots', network, walletAddress] as const;

export const offlinePaymentSlotRentEstimateQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  slotCount: number,
) => ['offpay', 'offlinePaymentSlotRentEstimate', network, walletAddress, slotCount] as const;

export function setOfflinePaymentSlotsQueryData(
  queryClient: QueryClient,
  snapshot: OfflinePaymentSlotSnapshot,
  targetSlotCount = snapshot.targetSlotCount,
): void {
  queryClient.setQueryData(
    offlinePaymentSlotsQueryKey(snapshot.walletAddress, snapshot.network),
    snapshot,
  );
  queryClient.setQueryData(
    [
      ...offlinePaymentSlotsQueryKey(snapshot.walletAddress, snapshot.network),
      'provider',
      targetSlotCount,
    ],
    snapshot,
  );
}

export function useOfflinePaymentSlots(options?: UseOfflinePaymentSlotsOptions) {
  const queryClient = useQueryClient();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isOnlineReachable, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const offlinePaymentsEnabled = usePreferencesStore((state) => state.offlinePaymentsEnabled);
  const storedTargetSlotCount = usePreferencesStore((state) => state.offlinePaymentPoolSize);
  const targetSlotCount = options?.targetSlotCount ?? storedTargetSlotCount;
  const hasExplicitTargetSlotCount = options?.targetSlotCount != null;
  const enabledByCaller = options?.enabled ?? true;
  const statusEnabledByCaller = options?.statusEnabled ?? enabledByCaller;
  const rentEstimateEnabledByCaller = options?.rentEstimateEnabled ?? enabledByCaller;
  const capabilitiesQuery = useOffpayCapabilities({
    deferUntilAfterInteractions: options?.deferCapabilitiesUntilAfterInteractions,
    enabled: enabledByCaller,
  });
  const capabilities = capabilitiesQuery.capabilities;
  const noncePoolCapability = getOffpayFeatureCapability(capabilities, 'offline.noncePool');
  const nonceStatusCapability = getOffpayFeatureCapability(capabilities, 'offline.nonceStatus');
  const tokenContextCapability = getOffpayFeatureCapability(capabilities, 'offline.tokenContext');
  const rentEstimateCapability = getOffpayFeatureCapability(capabilities, 'offline.rentEstimate');
  const canPrepare =
    enabledByCaller &&
    canUseNetwork &&
    isOffpayFeatureAvailable(capabilities, 'offline.noncePool') &&
    isOffpayFeatureAvailable(capabilities, 'offline.nonceCreate') &&
    isOffpayFeatureAvailable(capabilities, 'offline.rentEstimate') &&
    walletAddress != null &&
    network != null;

  const localSnapshotQuery = useQuery({
    queryKey: offlinePaymentSlotsQueryKey(walletAddress, network),
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline payment slots require an active wallet and network.');
      }

      return loadOfflinePaymentSlotSnapshot({ walletAddress, network });
    },
    enabled:
      enabledByCaller && walletAddress != null && network != null && !isNetworkAccessSuspended,
    networkMode: 'always',
    staleTime: 1000 * 15,
  });
  const pendingLocalSlotCount =
    (localSnapshotQuery.data?.counts.preparing ?? 0) +
    (localSnapshotQuery.data?.counts.settling ?? 0);
  const shouldReadProviderStatus =
    offlinePaymentsEnabled || hasExplicitTargetSlotCount || pendingLocalSlotCount > 0;
  const shouldReadRentEstimate = hasExplicitTargetSlotCount;
  const canReadStatus =
    shouldReadProviderStatus &&
    statusEnabledByCaller &&
    canUseNetwork &&
    isOffpayFeatureAvailable(capabilities, 'offline.nonceStatus') &&
    walletAddress != null &&
    network != null;

  const statusQuery = useQuery({
    queryKey: [...offlinePaymentSlotsQueryKey(walletAddress, network), 'provider', targetSlotCount],
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline payment slot status requires an active wallet and network.');
      }

      return refreshOfflinePaymentSlotsFromBackendStatus({
        walletAddress,
        network,
        targetSlotCount,
      });
    },
    enabled: canReadStatus,
    refetchInterval: canReadStatus && pendingLocalSlotCount > 0 ? 4000 : false,
    staleTime: 1000 * 30,
  });

  const rentEstimateQuery = useQuery({
    queryKey: offlinePaymentSlotRentEstimateQueryKey(walletAddress, network, targetSlotCount),
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline payment slot estimate requires an active wallet and network.');
      }

      return getOfflinePaymentSlotRentEstimate({
        walletAddress,
        network,
        slotCount: targetSlotCount,
      });
    },
    enabled:
      walletAddress != null &&
      network != null &&
      shouldReadRentEstimate &&
      rentEstimateEnabledByCaller &&
      canUseNetwork &&
      isOffpayFeatureAvailable(capabilities, 'offline.rentEstimate'),
    staleTime: 1000 * 60,
  });

  const prepareMutation = useMutation({
    mutationFn: (input: PrepareOfflinePaymentSlotsInput) => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline payment slot preparation requires an active wallet and network.');
      }

      return prepareOfflinePaymentSlots({
        walletAddress,
        walletId,
        network,
        targetSlotCount: input.targetSlotCount ?? targetSlotCount,
        spendAuthorization: input.spendAuthorization,
      });
    },
    onSuccess: (result, input) => {
      const mutationTargetSlotCount = input.targetSlotCount ?? targetSlotCount;
      const resultWalletAddress = result.snapshot.walletAddress;
      const resultNetwork = result.snapshot.network;
      setOfflinePaymentSlotsQueryData(queryClient, result.snapshot, mutationTargetSlotCount);
      void queryClient.invalidateQueries({
        queryKey: offlinePaymentSlotsQueryKey(resultWalletAddress, resultNetwork),
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({
        queryKey: offlinePaymentSlotRentEstimateQueryKey(
          resultWalletAddress,
          resultNetwork,
          mutationTargetSlotCount,
        ),
        refetchType: 'active',
      });
    },
  });

  const reclaimMutation = useMutation({
    mutationFn: (input: ReclaimOfflinePaymentSlotsInput) => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline payment slot recovery requires an active wallet and network.');
      }

      return reclaimOfflinePaymentSlotRent({
        walletAddress,
        walletId,
        network,
        targetSlotCount,
        reclaimAuthorization: input.reclaimAuthorization,
      });
    },
    onSuccess: (result) => {
      setOfflinePaymentSlotsQueryData(queryClient, result.snapshot);
      void queryClient.invalidateQueries({
        queryKey: offlinePaymentSlotsQueryKey(
          result.snapshot.walletAddress,
          result.snapshot.network,
        ),
        refetchType: 'none',
      });
    },
  });

  const snapshot = canUseNetwork
    ? (statusQuery.data ?? localSnapshotQuery.data ?? null)
    : (localSnapshotQuery.data ?? null);

  return {
    walletAddress,
    network,
    offlinePaymentsEnabled,
    targetSlotCount,
    snapshot,
    localSnapshotQuery,
    statusQuery,
    rentEstimateQuery,
    prepareMutation,
    reclaimMutation,
    canReadStatus,
    canPrepare,
    isOnlineReachable,
    canUseNetwork,
    noncePoolCapability,
    nonceStatusCapability,
    tokenContextCapability,
    rentEstimateCapability,
    isCapabilitiesPending: capabilitiesQuery.isCapabilitiesPending,
  };
}

export function useOfflinePaymentSlotsAutoSync(): void {
  const offlinePaymentsEnabled = usePreferencesStore((state) => state.offlinePaymentsEnabled);

  // This hook never prepares slots automatically. Keep launch passive:
  // local snapshots are cheap, while provider status and rent estimate
  // reads are wallet-scoped authenticated requests for external-wallet
  // users. Rent is only needed in visible slot-preparation UI.
  useOfflinePaymentSlots({
    enabled: offlinePaymentsEnabled,
    statusEnabled: false,
    rentEstimateEnabled: false,
  });
}
