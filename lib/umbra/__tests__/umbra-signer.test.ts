import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { registerExternalWalletSigner } from '@/lib/wallet/external-wallet-signing';
import { createExternalUmbraSigner, createUmbraSignerForWallet } from '@/lib/umbra/umbra-signer';

import type { ExternalWalletSigner } from '@/lib/wallet/external-wallet-signing';

const mockSigningSeed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const mockWalletAddress = bs58.encode(ed25519.getPublicKey(mockSigningSeed));

jest.mock('@/lib/wallet/secure-wallet-store', () => ({
  __esModule: true,
  getStoredWalletInfo: jest.fn(async () => ({
    id: 'wallet-privy',
    publicKey: mockWalletAddress,
    importMethod: 'privy-embedded',
  })),
  getStoredWalletSigningMaterialWithAuth: jest.fn(),
}));

function makeExternalSigner(walletAddress = mockWalletAddress): ExternalWalletSigner {
  return {
    kind: 'privy-embedded',
    walletAddress,
    signMessage: async (message) => Uint8Array.from(ed25519.sign(message, mockSigningSeed)),
    signTransaction: async (transaction) => transaction,
  };
}

describe('umbra-signer external wallet support', () => {
  it('adapts Privy-style message signing into the Umbra signer interface', async () => {
    const handle = createExternalUmbraSigner(mockWalletAddress, makeExternalSigner());
    const message = Uint8Array.of(1, 2, 3);

    const signedMessage = await handle.signer.signMessage(message);
    const signedTransaction = await handle.signer.signTransaction({
      messageBytes: message,
      signatures: {},
    } as never);
    const signatures = signedTransaction.signatures as unknown as Record<string, Uint8Array>;

    expect(signedMessage.signer).toBe(mockWalletAddress);
    expect(ed25519.verify(signedMessage.signature, message, bs58.decode(mockWalletAddress))).toBe(
      true,
    );
    expect(
      ed25519.verify(signatures[mockWalletAddress], message, bs58.decode(mockWalletAddress)),
    ).toBe(true);
  });

  it('waits for the Privy signer bridge before creating an Umbra signer', async () => {
    const pending = createUmbraSignerForWallet(mockWalletAddress, 'wallet-privy');
    await Promise.resolve();

    const dispose = registerExternalWalletSigner(makeExternalSigner());
    try {
      await expect(pending).resolves.toMatchObject({
        signer: {
          address: mockWalletAddress,
        },
      });
    } finally {
      dispose();
    }
  });
});
