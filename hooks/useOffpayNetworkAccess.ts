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
    canUseNetwork: walletModeState.canUseNetwork && !isNetworkAccessSuspended,
    isNetworkAccessSuspended,
    /**
     * True from the moment the user picks a new network until the
     * staged switch lifecycle finishes. Action buttons (swap, send,
     * advanced swap) gate on this for visible "Switching network…"
     * feedback. Background read-only queries should NOT gate on this
     * — they only need `canUseNetwork`, which lifts sooner so balances
     * and capabilities can begin refetching while the longer UX
     * lockout still holds.
     */
    isNetworkSwitching,
    networkTransitionVersion,
  };
}
