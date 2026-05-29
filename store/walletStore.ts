/**
 * Wallet state store — Zustand (in-memory, non-persisted).
 *
 * Wallet secrets are stored only in secure-wallet-store.ts.
 * Zustand keeps the current wallet list, active selection, and UI status.
 */
import { create } from 'zustand';

import {
  deleteStoredWallet,
  getStoredWalletSnapshot,
  removeStoredWallet,
  setStoredActiveWallet,
  storePrivyEmbeddedWallet,
  storeWalletWithMnemonic,
  storeWalletWithPrivateKey,
} from '@/lib/wallet/secure-wallet-store';
import { getSecuritySettings, setWalletLocked } from '@/lib/wallet/security-settings';
import {
  generateWallet,
  restoreWalletFromMnemonic,
  restoreWalletFromPrivateKey,
} from '@/lib/wallet/wallet';

import type { StoredWalletInfo, StoredWalletSnapshot } from '@/lib/wallet/secure-wallet-store';
import type { RecoveryWordCount } from '@/types/wallet';

const DEFAULT_ACCOUNT_NAME = 'Account 1';
const DEFAULT_BALANCE = '$ 0.00';

// Guards against two callers (eager module-evaluation hydration + the
// root `useEffect`) racing on the same SecureStore round-trip. A single
// pending promise is shared until it settles, then cleared so a later
// reset+rehydrate cycle still works.
let pendingHydratePromise: Promise<void> | null = null;

export interface WalletAccount extends StoredWalletInfo {}

interface WalletState {
  /** All stored wallets */
  wallets: WalletAccount[];

  /** Active wallet id */
  activeWalletId: string | null;

  /** Base58 public key (wallet address) for the currently unlocked active wallet */
  publicKey: string | null;

  /** Whether a wallet operation is in progress (prevents double-tap) */
  isLoading: boolean;

  /** Last error message from a wallet operation */
  error: string | null;

  /** Display name of the active account */
  accountName: string;

  /** USD balance for the active account */
  balance: string;

  /** Whether the store has attempted to hydrate from SecureStore */
  isHydrated: boolean;

  /** Whether the active wallet is primary */
  isPrimary: boolean;

  createWallet: (wordCount: RecoveryWordCount) => Promise<string[]>;
  importFromMnemonic: (mnemonic: string) => Promise<void>;
  importFromPrivateKey: (privateKey: string) => Promise<void>;
  importFromPrivyEmbeddedWallet: (publicKey: string) => Promise<void>;
  hydrate: () => Promise<void>;
  clearWallet: () => Promise<void>;
  clearError: () => void;
  setPrimaryWallet: (walletId: string) => Promise<void>;
  removeWallet: (walletId: string) => Promise<void>;
}

function getActiveWallet(
  wallets: WalletAccount[],
  activeWalletId: string | null,
): WalletAccount | null {
  if (activeWalletId == null) return wallets[0] ?? null;

  return wallets.find((wallet) => wallet.id === activeWalletId) ?? wallets[0] ?? null;
}

function buildWalletStateFromSnapshot(
  snapshot: StoredWalletSnapshot,
  publicKey: string | null,
): Pick<
  WalletState,
  'wallets' | 'activeWalletId' | 'accountName' | 'balance' | 'isPrimary' | 'publicKey'
> {
  const activeWallet = getActiveWallet(snapshot.wallets, snapshot.activeWalletId);

  return {
    wallets: snapshot.wallets,
    activeWalletId: activeWallet?.id ?? null,
    accountName: activeWallet?.name ?? DEFAULT_ACCOUNT_NAME,
    balance: activeWallet?.balance ?? DEFAULT_BALANCE,
    isPrimary: activeWallet != null,
    publicKey,
  };
}

function resolvePublicKeyForSnapshot(
  currentState: Pick<WalletState, 'activeWalletId' | 'publicKey'>,
  snapshot: StoredWalletSnapshot,
): string | null {
  const activeWallet = getActiveWallet(snapshot.wallets, snapshot.activeWalletId);
  if (activeWallet == null) return null;

  if (currentState.activeWalletId === activeWallet.id) {
    return currentState.publicKey;
  }

  return activeWallet.publicKey;
}

async function shouldStartWalletLocked(activeWallet: WalletAccount | null): Promise<boolean> {
  if (activeWallet == null) return false;

  try {
    const settings = await getSecuritySettings();
    if (!settings.hasPasscode) return false;

    if (!settings.walletLocked) {
      await setWalletLocked(true).catch(() => undefined);
    }

    return true;
  } catch {
    return false;
  }
}

function buildEmptyWalletState(): Pick<
  WalletState,
  'wallets' | 'activeWalletId' | 'publicKey' | 'accountName' | 'balance' | 'isPrimary'
> {
  return {
    wallets: [],
    activeWalletId: null,
    publicKey: null,
    accountName: DEFAULT_ACCOUNT_NAME,
    balance: DEFAULT_BALANCE,
    isPrimary: false,
  };
}

export const useWalletStore = create<WalletState>()((set, get) => ({
  ...buildEmptyWalletState(),
  isLoading: false,
  error: null,
  isHydrated: false,

  createWallet: async (wordCount) => {
    if (get().isLoading) return [];

    set({ isLoading: true, error: null });

    try {
      const wallet = await generateWallet(wordCount);

      await storeWalletWithMnemonic({
        mnemonic: wallet.mnemonic,
        publicKey: wallet.publicKey,
        derivationPath: wallet.derivationPath,
        importMethod: 'generated',
      });

      const snapshot = await getStoredWalletSnapshot();
      const nextPublicKey = resolvePublicKeyForSnapshot(get(), snapshot);

      set({
        ...buildWalletStateFromSnapshot(snapshot, nextPublicKey),
        isLoading: false,
        isHydrated: true,
        error: null,
      });

      return wallet.mnemonic.split(' ');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create wallet';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  importFromMnemonic: async (mnemonic) => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const wallet = await restoreWalletFromMnemonic(mnemonic);

      await storeWalletWithMnemonic({
        mnemonic: wallet.mnemonic,
        publicKey: wallet.publicKey,
        derivationPath: wallet.derivationPath,
        importMethod: 'mnemonic-import',
      });

      const snapshot = await getStoredWalletSnapshot();
      const nextPublicKey = resolvePublicKeyForSnapshot(get(), snapshot);

      set({
        ...buildWalletStateFromSnapshot(snapshot, nextPublicKey),
        isLoading: false,
        isHydrated: true,
        error: null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to import wallet';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  importFromPrivateKey: async (privateKey) => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const wallet = restoreWalletFromPrivateKey(privateKey);

      await storeWalletWithPrivateKey({
        privateKey: privateKey.trim(),
        publicKey: wallet.publicKey,
      });

      const snapshot = await getStoredWalletSnapshot();
      const nextPublicKey = resolvePublicKeyForSnapshot(get(), snapshot);

      set({
        ...buildWalletStateFromSnapshot(snapshot, nextPublicKey),
        isLoading: false,
        isHydrated: true,
        error: null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to import wallet';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  importFromPrivyEmbeddedWallet: async (publicKey) => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const snapshot = await storePrivyEmbeddedWallet({ publicKey });
      const activeWallet = getActiveWallet(snapshot.wallets, snapshot.activeWalletId);

      set({
        ...buildWalletStateFromSnapshot(snapshot, activeWallet?.publicKey ?? null),
        isLoading: false,
        isHydrated: true,
        error: null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to activate Privy wallet';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  hydrate: async () => {
    if (get().isHydrated) return;
    if (pendingHydratePromise != null) return pendingHydratePromise;

    pendingHydratePromise = (async () => {
      try {
        const snapshot = await getStoredWalletSnapshot();
        const activeWallet = getActiveWallet(snapshot.wallets, snapshot.activeWalletId);
        const startLocked = await shouldStartWalletLocked(activeWallet);

        set({
          ...buildWalletStateFromSnapshot(
            snapshot,
            startLocked ? null : (activeWallet?.publicKey ?? null),
          ),
          isHydrated: true,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to load wallet';
        console.error('[WalletStore] hydrate failed:', error);
        set({ ...buildEmptyWalletState(), isHydrated: true, error: message });
      } finally {
        pendingHydratePromise = null;
      }
    })();

    return pendingHydratePromise;
  },

  clearWallet: async () => {
    set({ isLoading: true, error: null });

    try {
      await deleteStoredWallet();
      set({
        ...buildEmptyWalletState(),
        isLoading: false,
        isHydrated: true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to clear wallet';
      set({ error: message, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),

  setPrimaryWallet: async (walletId) => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const snapshot = await setStoredActiveWallet(walletId);
      const activeWallet = getActiveWallet(snapshot.wallets, snapshot.activeWalletId);

      set({
        ...buildWalletStateFromSnapshot(snapshot, activeWallet?.publicKey ?? null),
        isLoading: false,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to set primary wallet';
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  removeWallet: async (walletId) => {
    if (get().isLoading) return;

    set({ isLoading: true, error: null });

    try {
      const snapshot = await removeStoredWallet(walletId);
      const nextPublicKey = resolvePublicKeyForSnapshot(get(), snapshot);

      set({
        ...buildWalletStateFromSnapshot(snapshot, nextPublicKey),
        isLoading: false,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to remove wallet';
      set({ error: message, isLoading: false });
      throw error;
    }
  },
}));
