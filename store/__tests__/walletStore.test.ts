import * as SecureStore from 'expo-secure-store';
import { QueryClient } from '@tanstack/react-query';

import {
  getSecuritySettings,
  setFingerprintEnabled,
  setPasscode,
  setWalletLocked,
} from '@/lib/wallet/security-settings';
import {
  getStoredWalletSigningMaterialWithAuth,
  getStoredWalletSnapshot,
  storeWalletWithPrivateKey,
} from '@/lib/wallet/secure-wallet-store';
import { resetForgottenWallet } from '@/lib/wallet/wallet-reset';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

const WALLET_ADDRESS = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';

function resetWalletStore(): void {
  useWalletStore.setState({
    wallets: [],
    activeWalletId: null,
    publicKey: null,
    isLoading: false,
    error: null,
    accountName: 'Account 1',
    balance: '$ 0.00',
    isHydrated: false,
    isPrimary: false,
  });
}

describe('walletStore hydration lock state', () => {
  beforeEach(() => {
    resetWalletStore();
    useAppStore.setState({ hasOnboarded: false, username: null });
  });

  afterEach(() => {
    resetWalletStore();
    useAppStore.setState({ hasOnboarded: false, username: null });
  });

  it('hydrates the active public key when no app passcode exists', async () => {
    await storeWalletWithPrivateKey({
      privateKey: 'test-private-key',
      publicKey: WALLET_ADDRESS,
    });

    await useWalletStore.getState().hydrate();

    expect(useWalletStore.getState().publicKey).toBe(WALLET_ADDRESS);
    expect(useWalletStore.getState().wallets[0]?.publicKey).toBe(WALLET_ADDRESS);
  });

  it('persists the active wallet display name across hydration', async () => {
    await storeWalletWithPrivateKey({
      privateKey: 'test-private-key',
      publicKey: WALLET_ADDRESS,
    });
    await useWalletStore.getState().hydrate();

    await useWalletStore.getState().setActiveWalletName('karan');

    expect(useWalletStore.getState().accountName).toBe('karan');
    expect(useWalletStore.getState().wallets[0]?.name).toBe('karan');

    resetWalletStore();
    await useWalletStore.getState().hydrate();

    expect(useWalletStore.getState().accountName).toBe('karan');
    expect(useWalletStore.getState().wallets[0]?.name).toBe('karan');
  });

  it('activates a Privy embedded wallet without local signing material', async () => {
    await useWalletStore.getState().importFromPrivyEmbeddedWallet(WALLET_ADDRESS);

    expect(useWalletStore.getState().publicKey).toBe(WALLET_ADDRESS);
    expect(useWalletStore.getState().wallets).toEqual([
      expect.objectContaining({
        publicKey: WALLET_ADDRESS,
        importMethod: 'privy-embedded',
        derivationPath: null,
      }),
    ]);
    await expect(getStoredWalletSigningMaterialWithAuth()).resolves.toEqual({
      mnemonic: null,
      privateKey: null,
    });
  });

  it('keeps the active wallet locked on app startup when a passcode exists', async () => {
    await storeWalletWithPrivateKey({
      privateKey: 'test-private-key',
      publicKey: WALLET_ADDRESS,
    });
    await setPasscode('123456');
    await SecureStore.setItemAsync('offpay_security_wallet_locked', '0');

    await useWalletStore.getState().hydrate();

    expect(useWalletStore.getState().publicKey).toBeNull();
    expect(useWalletStore.getState().wallets[0]?.publicKey).toBe(WALLET_ADDRESS);
    await expect(SecureStore.getItemAsync('offpay_security_wallet_locked')).resolves.toBe('1');
  });

  it('forgotten password reset clears wallet, security, onboarding, and query state', async () => {
    await storeWalletWithPrivateKey({
      privateKey: 'test-private-key',
      publicKey: WALLET_ADDRESS,
    });
    await setPasscode('123456');
    await setFingerprintEnabled(true);
    await setWalletLocked(true);
    await useWalletStore.getState().hydrate();
    useAppStore.getState().setHasOnboarded(true);
    useAppStore.getState().setUsername('karan');

    const queryClient = new QueryClient();
    queryClient.setQueryData(['offpay', 'walletBalance', 'mainnet', WALLET_ADDRESS], {
      address: WALLET_ADDRESS,
    });

    await resetForgottenWallet({ queryClient });

    expect(useWalletStore.getState().wallets).toHaveLength(0);
    expect(useWalletStore.getState().publicKey).toBeNull();
    expect(useAppStore.getState().hasOnboarded).toBe(false);
    expect(useAppStore.getState().username).toBeNull();
    await expect(getStoredWalletSnapshot()).resolves.toEqual({
      wallets: [],
      activeWalletId: null,
    });
    await expect(getSecuritySettings()).resolves.toEqual({
      fingerprintEnabled: false,
      hasPasscode: false,
      walletLocked: false,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
