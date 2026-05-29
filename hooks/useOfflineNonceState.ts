import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearOfflineNonceState,
  getOfflineNonceReadiness,
  saveOfflineNonceState,
} from '@/lib/offline/offline-payments';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { useOffpayNetworkTransitionStore } from '@/store/offpayNetworkTransitionStore';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayNetwork } from '@/types/offpay-api';

export const offlineNonceStateQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  walletMode?: 'online' | 'offline',
) => ['offpay', 'offlineNonceState', network, walletAddress, walletMode ?? 'any'] as const;

export function useOfflineNonceState() {
  const queryClient = useQueryClient();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const { network } = useOffpayNetwork();
  const {
    preferredWalletMode,
    effectiveWalletMode,
    canUseNetwork,
    isConnectivityResolved,
    isOnlineReachable,
    isOfflineFallback,
  } = useWalletModeState();
  const networkAccessSuspended = useOffpayNetworkTransitionStore((s) => s.networkAccessSuspended);

  const readinessQuery = useQuery({
    queryKey: offlineNonceStateQueryKey(walletAddress, network, effectiveWalletMode),
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline nonce readiness requires an active wallet and network.');
      }

      return getOfflineNonceReadiness({
        walletAddress,
        network,
        walletMode: effectiveWalletMode,
      });
    },
    enabled: walletAddress != null && network != null && !networkAccessSuspended,
    staleTime: 1000 * 30,
  });

  const saveMutation = useMutation({
    mutationFn: (params: { nonceAccount: string; nonceAuthority: string; cachedNonce: string }) => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline nonce setup requires an active wallet and network.');
      }

      return saveOfflineNonceState({
        walletAddress,
        network,
        ...params,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: offlineNonceStateQueryKey(walletAddress, network),
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Offline nonce reset requires an active wallet and network.');
      }

      return clearOfflineNonceState({ walletAddress, network });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: offlineNonceStateQueryKey(walletAddress, network),
      });
    },
  });

  return {
    walletAddress,
    network,
    preferredWalletMode,
    effectiveWalletMode,
    walletMode: effectiveWalletMode,
    isConnectivityResolved,
    isOnlineReachable,
    canUseNetwork,
    isOfflineFallback,
    readinessQuery,
    saveMutation,
    clearMutation,
  };
}
