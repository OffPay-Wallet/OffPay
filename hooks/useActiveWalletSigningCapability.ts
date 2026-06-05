import { useMemo } from 'react';

import {
  getLocalSigningWalletBlocker,
  walletHasLocalSigningMaterial,
} from '@/lib/wallet/wallet-capabilities';
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
  return state.wallets.find((wallet) => wallet.publicKey === state.publicKey)?.importMethod ?? null;
}

export function useActiveWalletSigningCapability(): {
  importMethod: WalletImportMethod | null;
  hasLocalSigningMaterial: boolean;
  localSigningBlocker: string | null;
} {
  const importMethod = useWalletStore(selectActiveWalletImportMethod);

  return useMemo(
    () => ({
      importMethod,
      hasLocalSigningMaterial: walletHasLocalSigningMaterial(importMethod),
      localSigningBlocker: getLocalSigningWalletBlocker(importMethod),
    }),
    [importMethod],
  );
}
