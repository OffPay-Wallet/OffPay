import { useWalletModeState } from '@/hooks/useWalletModeState';
import { useOffpayNetworkTransitionStore } from '@/store/offpayNetworkTransitionStore';
import { useShallow } from 'zustand/react/shallow';

export function useOffpayNetworkAccess() {
  const walletModeState = useWalletModeState();
  const { isNetworkAccessSuspended, isNetworkSwitching, networkTransitionVersion } =
    useOffpayNetworkTransitionStore(
      useShallow((state) => ({
        isNetworkAccessSuspended: state.networkAccessSuspended,
        isNetworkSwitching: state.isNetworkSwitching,
        networkTransitionVersion: state.transitionVersion,
      })),
    );

  return {
    ...walletModeState,
    canUseNetwork:
      walletModeState.canUseNetwork && !isNetworkAccessSuspended && !isNetworkSwitching,
    isNetworkAccessSuspended,
    /**
     * True from the moment the user picks a new network until the
     * staged switch lifecycle finishes. Action buttons (swap, send,
     * advanced swap) gate on this for visible "Switching network…"
     * feedback. `canUseNetwork` also remains false during this window
     * so new-network read queries do not fan out while navigation and
     * tab state are still settling.
     */
    isNetworkSwitching,
    networkTransitionVersion,
  };
}
