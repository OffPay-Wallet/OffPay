import * as SecureStore from 'expo-secure-store';

import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { DEFAULT_NETWORK } from '@/constants/networks';
import { OFFLINE_PAYMENT_SLOT_DEFAULT } from '@/constants/offline-payment-slots';
import {
  hydrateCriticalPreferencesFallback,
  PREFERENCES_NETWORK_MIRROR_KEY,
  usePreferencesStore,
} from '@/store/preferencesStore';

interface SecureStoreTestModule {
  __INTERNAL_RESET: () => void;
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
}

const secureStore = SecureStore as unknown as SecureStoreTestModule;

function resetPreferencesStore(): void {
  usePreferencesStore.setState({
    walletMode: 'online',
    offlinePaymentsEnabled: false,
    offlinePaymentPoolSize: OFFLINE_PAYMENT_SLOT_DEFAULT,
    currency: DEFAULT_CURRENCY,
    network: DEFAULT_NETWORK,
    networkUpdatedAt: 0,
  });
}

describe('preferencesStore', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    secureStore.__INTERNAL_RESET();
    resetPreferencesStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a devnet mirror for killed-process cold starts', async () => {
    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 10_000,
    });

    const rawMirror = await secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY);
    expect(rawMirror).toBe(JSON.stringify({ version: 1, network: 'devnet', updatedAt: 10_000 }));
  });

  it('clamps public-client mainnet selection back to devnet', async () => {
    await usePreferencesStore.getState().setNetwork('mainnet-beta');

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 0,
    });
    await expect(secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY)).resolves.toBeNull();
  });

  it('recovers the previous network when MMKV hydrates as the default network', async () => {
    await secureStore.setItemAsync(
      PREFERENCES_NETWORK_MIRROR_KEY,
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 20_000 }),
    );
    usePreferencesStore.setState({
      network: DEFAULT_NETWORK,
      networkUpdatedAt: 0,
    });

    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 20_000,
    });
  });

  it('does not overwrite a newer network with a stale SecureStore mirror', async () => {
    await secureStore.setItemAsync(
      PREFERENCES_NETWORK_MIRROR_KEY,
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 20_000 }),
    );
    usePreferencesStore.setState({
      network: DEFAULT_NETWORK,
      networkUpdatedAt: 30_000,
    });

    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: DEFAULT_NETWORK,
      networkUpdatedAt: 30_000,
    });
    const rawMirror = await secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY);
    expect(rawMirror).toBe(
      JSON.stringify({ version: 1, network: DEFAULT_NETWORK, updatedAt: 30_000 }),
    );
  });

  it('recovers old persisted mainnet state as devnet while mainnet is disabled', async () => {
    usePreferencesStore.setState({
      network: 'mainnet-beta',
      networkUpdatedAt: 30_000,
    });

    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 30_000,
    });
    const rawMirror = await secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY);
    expect(rawMirror).toBe(JSON.stringify({ version: 1, network: 'devnet', updatedAt: 30_000 }));
  });
});
