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
});
