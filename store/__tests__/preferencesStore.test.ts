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

  it('writes a Devnet mirror for a new killed-process cold start', async () => {
    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 10_000,
    });

    const rawMirror = await secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY);
    expect(rawMirror).toBe(JSON.stringify({ version: 1, network: 'devnet', updatedAt: 10_000 }));
  });

  it('rejects an explicit switch to disabled Mainnet', async () => {
    await usePreferencesStore.getState().setNetwork('mainnet-beta');

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 0,
    });
    await expect(secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY)).resolves.toBeNull();
  });

  it('repairs a stale in-memory Mainnet value through the shared setter', async () => {
    usePreferencesStore.setState({ network: 'mainnet-beta', networkUpdatedAt: 0 });

    await usePreferencesStore.getState().setNetwork('mainnet-beta');

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 10_000,
    });
    await expect(secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY)).resolves.toBe(
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 10_000 }),
    );
  });

  it('uses a newer valid Devnet mirror to repair stale Mainnet state', async () => {
    await secureStore.setItemAsync(
      PREFERENCES_NETWORK_MIRROR_KEY,
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 20_000 }),
    );
    usePreferencesStore.setState({
      network: 'mainnet-beta',
      networkUpdatedAt: 0,
    });

    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 20_000,
    });
  });

  it('rewrites a disabled Mainnet mirror as Devnet', async () => {
    await secureStore.setItemAsync(
      PREFERENCES_NETWORK_MIRROR_KEY,
      JSON.stringify({ version: 1, network: 'mainnet-beta', updatedAt: 20_000 }),
    );
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

  it('normalizes Mainnet when MMKV and the Devnet mirror have equal timestamps', async () => {
    await secureStore.setItemAsync(
      PREFERENCES_NETWORK_MIRROR_KEY,
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 30_000 }),
    );
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

  it('keeps the newer Devnet timestamp when its mirror is stale', async () => {
    await secureStore.setItemAsync(
      PREFERENCES_NETWORK_MIRROR_KEY,
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 20_000 }),
    );
    usePreferencesStore.setState({ network: 'devnet', networkUpdatedAt: 30_000 });

    await hydrateCriticalPreferencesFallback();

    expect(usePreferencesStore.getState()).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 30_000,
    });
    await expect(secureStore.getItemAsync(PREFERENCES_NETWORK_MIRROR_KEY)).resolves.toBe(
      JSON.stringify({ version: 1, network: 'devnet', updatedAt: 30_000 }),
    );
  });

  it('migrates version 6 Mainnet preferences to Devnet', async () => {
    const options = usePreferencesStore.persist.getOptions();
    expect(options.version).toBe(7);
    expect(options.migrate).toBeDefined();

    const migrated = await options.migrate?.(
      { network: 'mainnet-beta', networkUpdatedAt: 30_000 },
      6,
    );

    expect(migrated).toMatchObject({
      network: 'devnet',
      networkUpdatedAt: 30_000,
    });
  });
});
