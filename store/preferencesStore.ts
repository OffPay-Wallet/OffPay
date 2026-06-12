/**
 * Preferences store — persists user preferences via SecureStore.
 *
 * Stores: wallet mode, display currency, Solana network, and offline payment settings.
 *
 * Usage: import { usePreferencesStore } from '@/store/preferencesStore';
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { DEFAULT_NETWORK } from '@/constants/networks';
import {
  OFFLINE_PAYMENT_SLOT_DEFAULT,
  clampOfflinePaymentSlotCount,
} from '@/constants/offline-payment-slots';
import { mmkvStorage } from '@/lib/cache/mmkv-storage';

import type { SolanaNetworkId } from '@/constants/networks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wallet operating mode. Offline mode gates durable nonce readiness and QR/offline queue flows. */
export type WalletMode = 'online' | 'offline';

interface PreferencesState {
  /** Wallet operating mode — online backend payments or offline durable nonce flows. */
  walletMode: WalletMode;

  /** Whether the user opted in to preparing offline payment slots. */
  offlinePaymentsEnabled: boolean;

  /** Desired offline payment slot pool size. Backend preparation is capability-gated. */
  offlinePaymentPoolSize: number;

  /** ISO 4217 display currency code (e.g. 'USD', 'EUR', 'INR') */
  currency: string;

  /** Active Solana network cluster */
  network: SolanaNetworkId;

  // Actions
  setWalletMode: (mode: WalletMode) => void;
  setOfflinePaymentsEnabled: (enabled: boolean) => void;
  setOfflinePaymentPoolSize: (size: number) => void;
  setCurrency: (code: string) => void;
  setNetwork: (network: SolanaNetworkId) => void;
}

type PersistedPreferencesState = Partial<PreferencesState> & {
  notificationsEnabled?: unknown;
};

function normalizePersistedNetwork(network: unknown): SolanaNetworkId {
  if (network === 'mainnet-beta' || network === 'devnet') {
    return network;
  }

  return DEFAULT_NETWORK;
}

function normalizePoolSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return OFFLINE_PAYMENT_SLOT_DEFAULT;
  }

  return clampOfflinePaymentSlotCount(value);
}

function stripLegacyNotificationPreference(
  state: PersistedPreferencesState,
): Partial<PreferencesState> {
  const next = { ...state };
  delete next.notificationsEnabled;

  return next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      walletMode: 'online',
      offlinePaymentsEnabled: false,
      offlinePaymentPoolSize: OFFLINE_PAYMENT_SLOT_DEFAULT,
      currency: DEFAULT_CURRENCY,
      network: DEFAULT_NETWORK,

      setWalletMode: (mode) =>
        set((state) => (state.walletMode === mode ? state : { walletMode: mode })),
      setOfflinePaymentsEnabled: (enabled) =>
        set((state) =>
          state.offlinePaymentsEnabled === enabled ? state : { offlinePaymentsEnabled: enabled },
        ),
      setOfflinePaymentPoolSize: (size) =>
        set((state) => {
          const normalizedSize = normalizePoolSize(size);
          return state.offlinePaymentPoolSize === normalizedSize
            ? state
            : { offlinePaymentPoolSize: normalizedSize };
        }),
      setCurrency: (code) => set((state) => (state.currency === code ? state : { currency: code })),
      setNetwork: (network) => set((state) => (state.network === network ? state : { network })),
    }),
    {
      name: 'offpay-preferences',
      storage: createJSONStorage(() => mmkvStorage),
      version: 5,
      migrate: (persistedState, version) => {
        if (typeof persistedState !== 'object' || persistedState === null) {
          return persistedState;
        }

        if (version === 5) {
          return persistedState;
        }

        const state = persistedState as PersistedPreferencesState;
        const stateWithoutLegacyNotifications = stripLegacyNotificationPreference(state);

        return {
          ...stateWithoutLegacyNotifications,
          network: normalizePersistedNetwork(state.network),
          offlinePaymentsEnabled: state.offlinePaymentsEnabled === true,
          offlinePaymentPoolSize: normalizePoolSize(state.offlinePaymentPoolSize),
        };
      },
    },
  ),
);
