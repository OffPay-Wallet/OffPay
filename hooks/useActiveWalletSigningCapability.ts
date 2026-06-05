import { useMemo, useSyncExternalStore } from 'react';

import {
  getExternalWalletSigningSnapshot,
  subscribeExternalWalletSigners,
} from '@/lib/wallet/external-wallet-signing';
import { getWalletSigningBlocker, walletCanSignWithApp } from '@/lib/wallet/wallet-capabilities';
import { useWalletStore } from '@/store/walletStore';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';

function selectActiveWalletImportMethod(state: {
  activeWalletId: string | null;
  publicKey: string | null;
  wallets: ReadonlyArray<{
    id: string;
    publicKey: string;
    importMethod: WalletImportMethod;
  }>;
}): WalletImportMethod | null {
  const byId =
    state.activeWalletId == null
      ? null
      : (state.wallets.find((wallet) => wallet.id === state.activeWalletId) ?? null);
  if (byId != null) return byId.importMethod;

  if (state.publicKey == null) return null;

  const byAddress = state.wallets.find((wallet) => wallet.publicKey === state.publicKey) ?? null;
  return byAddress?.importMethod ?? null;
}

function selectActiveWalletAddress(state: {
  activeWalletId: string | null;
  publicKey: string | null;
  wallets: ReadonlyArray<{
    id: string;
    publicKey: string;
  }>;
}): string | null {
  const byId =
    state.activeWalletId == null
      ? null
      : (state.wallets.find((wallet) => wallet.id === state.activeWalletId) ?? null);
  return byId?.publicKey ?? state.publicKey ?? null;
}

export function useActiveWalletSigningCapability(): {
  importMethod: WalletImportMethod | null;
  walletAddress: string | null;
  canSignWithApp: boolean;
  signingBlocker: string | null;
} {
  const importMethod = useWalletStore(selectActiveWalletImportMethod);
  const walletAddress = useWalletStore(selectActiveWalletAddress);
  useSyncExternalStore(
    subscribeExternalWalletSigners,
    getExternalWalletSigningSnapshot,
    getExternalWalletSigningSnapshot,
  );

  return useMemo(
    () => ({
      importMethod,
      walletAddress,
      canSignWithApp: walletCanSignWithApp({ importMethod, walletAddress }),
      signingBlocker: getWalletSigningBlocker(importMethod, 'This action', walletAddress),
    }),
    [importMethod, walletAddress],
  );
}
