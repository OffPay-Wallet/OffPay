import { useNetInfo } from '@react-native-community/netinfo';
import { useEffect } from 'react';

import { usePreferencesStore } from '@/store/preferencesStore';

import type { WalletMode } from '@/store/preferencesStore';

interface WalletModeState {
  preferredWalletMode: WalletMode;
  effectiveWalletMode: WalletMode;
  isOnlineReachable: boolean;
  canUseNetwork: boolean;
  isOfflineFallback: boolean;
  isConnectivityResolved: boolean;
  setPreferredWalletMode: (mode: WalletMode) => void;
}

export function useWalletModeState(): WalletModeState {
  const preferredWalletMode = usePreferencesStore((state) => state.walletMode);
  const setPreferredWalletMode = usePreferencesStore((state) => state.setWalletMode);
  const netInfo = useNetInfo();

  const isConnectivityResolved = netInfo.isConnected != null || netInfo.isInternetReachable != null;
  const isOnlineReachable =
    !isConnectivityResolved ||
    (netInfo.isConnected === true && netInfo.isInternetReachable !== false);
  const isOfflineFallback = isConnectivityResolved && !isOnlineReachable;
  const effectiveWalletMode: WalletMode =
    preferredWalletMode === 'offline' || isOfflineFallback ? 'offline' : 'online';
  const canUseNetwork = effectiveWalletMode === 'online' && isOnlineReachable;

  useEffect(() => {
    if (preferredWalletMode === 'online' && isOfflineFallback) {
      setPreferredWalletMode('offline');
    }
  }, [isOfflineFallback, preferredWalletMode, setPreferredWalletMode]);

  return {
    preferredWalletMode,
    effectiveWalletMode,
    isOnlineReachable,
    canUseNetwork,
    isOfflineFallback,
    isConnectivityResolved,
    setPreferredWalletMode,
  };
}
