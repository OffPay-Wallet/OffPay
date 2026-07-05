import {
  getExternalWalletSigner,
  registerExternalWalletSigner,
  waitForExternalWalletSigner,
} from '@/lib/wallet/external-wallet-signing';

import type { ExternalWalletSigner } from '@/lib/wallet/external-wallet-signing';

function makeSigner(walletAddress: string): ExternalWalletSigner {
  return {
    kind: 'privy-embedded',
    walletAddress,
    signMessage: async () => new Uint8Array(64),
    signTransaction: async (transaction) => transaction,
  };
}

describe('external wallet signing registry', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves immediately when the signer is already registered', async () => {
    const signer = makeSigner('wallet-ready');
    const dispose = registerExternalWalletSigner(signer);

    try {
      await expect(waitForExternalWalletSigner('wallet-ready', 1000)).resolves.toMatchObject({
        walletAddress: 'wallet-ready',
      });
      expect(getExternalWalletSigner('wallet-ready')).toMatchObject({
        walletAddress: 'wallet-ready',
      });
    } finally {
      dispose();
    }
  });

  it('waits for a signer that registers after the request starts', async () => {
    const pending = waitForExternalWalletSigner('wallet-late', 1000);
    const dispose = registerExternalWalletSigner(makeSigner('wallet-late'));

    try {
      await expect(pending).resolves.toMatchObject({
        walletAddress: 'wallet-late',
      });
    } finally {
      dispose();
    }
  });

  it('returns null when no signer registers before the timeout', async () => {
    jest.useFakeTimers();

    const pending = waitForExternalWalletSigner('wallet-missing', 1000);
    jest.advanceTimersByTime(1000);

    await expect(pending).resolves.toBeNull();
  });

  it('keeps a signer available through a delayed unregister window', () => {
    jest.useFakeTimers();

    const dispose = registerExternalWalletSigner(makeSigner('wallet-reconnecting'), {
      unregisterDelayMs: 1000,
    });

    dispose();
    expect(getExternalWalletSigner('wallet-reconnecting')).toMatchObject({
      walletAddress: 'wallet-reconnecting',
    });

    jest.advanceTimersByTime(999);
    expect(getExternalWalletSigner('wallet-reconnecting')).toMatchObject({
      walletAddress: 'wallet-reconnecting',
    });

    jest.advanceTimersByTime(1);
    expect(getExternalWalletSigner('wallet-reconnecting')).toBeNull();
  });

  it('does not let a delayed unregister remove a replacement signer', () => {
    jest.useFakeTimers();

    const disposeOld = registerExternalWalletSigner(makeSigner('wallet-replaced'), {
      unregisterDelayMs: 1000,
    });
    disposeOld();

    const disposeNew = registerExternalWalletSigner(makeSigner('wallet-replaced'));
    try {
      jest.advanceTimersByTime(1000);
      expect(getExternalWalletSigner('wallet-replaced')).toMatchObject({
        walletAddress: 'wallet-replaced',
      });
    } finally {
      disposeNew();
    }

    expect(getExternalWalletSigner('wallet-replaced')).toBeNull();
  });
});
