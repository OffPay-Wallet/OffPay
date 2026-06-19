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
import { getSecureStoreItem, setSecureStoreItem } from '@/lib/secure-store/secure-store-chunks';

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

  /** Monotonic timestamp for resolving cold-start network recovery conflicts. */
  networkUpdatedAt: number;

  // Actions
  setWalletMode: (mode: WalletMode) => void;
  setOfflinePaymentsEnabled: (enabled: boolean) => void;
  setOfflinePaymentPoolSize: (size: number) => void;
  setCurrency: (code: string) => void;
  setNetwork: (network: SolanaNetworkId) => Promise<void>;
}

type PersistedPreferencesState = Partial<
  Pick<
    PreferencesState,
    | 'walletMode'
    | 'offlinePaymentsEnabled'
    | 'offlinePaymentPoolSize'
    | 'currency'
    | 'network'
    | 'networkUpdatedAt'
  >
> & {
  notificationsEnabled?: unknown;
};

interface NetworkPreferenceMirror {
  version: 1;
  network: SolanaNetworkId;
  updatedAt: number;
}

export const PREFERENCES_NETWORK_MIRROR_KEY = 'offpay_preferences_network_v1';

let networkMirrorWriteChain: Promise<void> = Promise.resolve();

function nextNetworkPreferenceTimestamp(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

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

function normalizePreferenceTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function parseNetworkPreferenceMirror(raw: string | null): NetworkPreferenceMirror | null {
  if (raw == null) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<NetworkPreferenceMirror>;
    const updatedAt = normalizePreferenceTimestamp(parsed.updatedAt);
    const network = normalizePersistedNetwork(parsed.network);

    if (parsed.version !== 1 || updatedAt === 0 || network !== parsed.network) {
      return null;
    }

    return {
      version: 1,
      network,
      updatedAt,
    };
  } catch {
    return null;
  }
}

async function readNetworkPreferenceMirror(): Promise<NetworkPreferenceMirror | null> {
  try {
    return parseNetworkPreferenceMirror(await getSecureStoreItem(PREFERENCES_NETWORK_MIRROR_KEY));
  } catch {
    return null;
  }
}

function queueNetworkPreferenceMirrorWrite(mirror: NetworkPreferenceMirror): Promise<void> {
  const write = networkMirrorWriteChain.then(async () => {
    await setSecureStoreItem(PREFERENCES_NETWORK_MIRROR_KEY, JSON.stringify(mirror));
  });

  networkMirrorWriteChain = write.catch(() => undefined);
  return write.catch(() => undefined);
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
      networkUpdatedAt: 0,

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
      setNetwork: (network) => {
        let mirror: NetworkPreferenceMirror | null = null;

        set((state) => {
          if (state.network === network) return state;

          const updatedAt = nextNetworkPreferenceTimestamp(state.networkUpdatedAt);
          mirror = {
            version: 1,
            network,
            updatedAt,
          };

          return {
            network,
            networkUpdatedAt: updatedAt,
          };
        });

        return mirror == null ? Promise.resolve() : queueNetworkPreferenceMirrorWrite(mirror);
      },
    }),
    {
      name: 'offpay-preferences',
      storage: createJSONStorage(() => mmkvStorage),
      skipHydration: true,
      version: 6,
      migrate: (persistedState, version) => {
        if (typeof persistedState !== 'object' || persistedState === null) {
          return persistedState;
        }

        const state = persistedState as PersistedPreferencesState;
        const stateWithoutLegacyNotifications = stripLegacyNotificationPreference(state);

        return {
          ...stateWithoutLegacyNotifications,
          network: normalizePersistedNetwork(state.network),
          offlinePaymentsEnabled: state.offlinePaymentsEnabled === true,
          offlinePaymentPoolSize: normalizePoolSize(state.offlinePaymentPoolSize),
          networkUpdatedAt: normalizePreferenceTimestamp(state.networkUpdatedAt),
        };
      },
    },
  ),
);

/**
 * Recover critical preferences that must be stable before app providers
 * mount. MMKV remains the normal persistence layer; SecureStore keeps a
 * tiny timestamped mirror so a killed-process launch cannot leak the
 * default mainnet network if the MMKV blob opens empty or late.
 */
export async function hydrateCriticalPreferencesFallback(): Promise<void> {
  const state = usePreferencesStore.getState();
  const stateNetwork = normalizePersistedNetwork(state.network);
  const stateUpdatedAt = normalizePreferenceTimestamp(state.networkUpdatedAt);
  const mirror = await readNetworkPreferenceMirror();

  if (mirror == null) {
    const updatedAt =
      stateUpdatedAt > 0 ? stateUpdatedAt : nextNetworkPreferenceTimestamp(stateUpdatedAt);

    usePreferencesStore.setState({
      network: stateNetwork,
      networkUpdatedAt: updatedAt,
    });

    await queueNetworkPreferenceMirrorWrite({
      version: 1,
      network: stateNetwork,
      updatedAt,
    });
    return;
  }

  if (
    mirror.updatedAt > stateUpdatedAt ||
    (mirror.updatedAt === stateUpdatedAt && mirror.network !== stateNetwork)
  ) {
    usePreferencesStore.setState({
      network: mirror.network,
      networkUpdatedAt: mirror.updatedAt,
    });
    return;
  }

  if (stateUpdatedAt > mirror.updatedAt || stateNetwork !== mirror.network) {
    const updatedAt =
      stateUpdatedAt > 0 ? stateUpdatedAt : nextNetworkPreferenceTimestamp(mirror.updatedAt);

    usePreferencesStore.setState({
      network: stateNetwork,
      networkUpdatedAt: updatedAt,
    });

    await queueNetworkPreferenceMirrorWrite({
      version: 1,
      network: stateNetwork,
      updatedAt,
    });
  }
}
