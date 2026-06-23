import { Buffer } from 'buffer';

import { Transaction } from '@solana/web3.js';

jest.mock('@privy-io/expo', () => ({
  __esModule: true,
  useEmbeddedSolanaWallet: jest.fn(),
  usePrivy: jest.fn(),
}));

import {
  decodePrivySignatureResponse,
  readPrivySignedTransactionResponse,
  signPrivySolanaMessage,
  signPrivySolanaTransaction,
} from '@/lib/privy/PrivySolanaSigningBridge';

import type { BridgeSolanaWallet } from '@/lib/privy/PrivySolanaSigningBridge';

function makeSignature(): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, index) => index + 1);
}

function makeWallet(provider: unknown): BridgeSolanaWallet {
  return {
    address: 'privy-wallet',
    walletIndex: 0,
    getProvider: jest.fn(async () => provider as never),
  };
}

describe('PrivySolanaSigningBridge', () => {
  it('decodes current and wrapped Privy signMessage responses', () => {
    const signature = makeSignature();
    const encoded = Buffer.from(signature).toString('base64');

    expect(decodePrivySignatureResponse({ signature: encoded })).toEqual(signature);
    expect(decodePrivySignatureResponse({ data: { signature: encoded } })).toEqual(signature);
  });

  it('signs messages through the Privy request provider', async () => {
    const signature = makeSignature();
    const encoded = Buffer.from(signature).toString('base64');
    const request = jest.fn(async () => ({ signature: encoded }));
    const wallet = makeWallet({ request });

    await expect(signPrivySolanaMessage(wallet, Uint8Array.of(1, 2, 3))).resolves.toEqual(
      signature,
    );
    expect(request).toHaveBeenCalledWith({
      method: 'signMessage',
      params: {
        message: 'AQID',
      },
    });
  });

  it('returns a clear error when Privy has not exposed a request provider', async () => {
    const wallet = makeWallet({});

    await expect(signPrivySolanaMessage(wallet, Uint8Array.of(1))).rejects.toThrow(
      'Privy wallet signing provider is unavailable',
    );
  });

  it('signs transactions and accepts wrapped signed-transaction responses', async () => {
    const transaction = new Transaction();
    const request = jest.fn(async () => ({ data: { signedTransaction: transaction } }));
    const wallet = makeWallet({ request });

    await expect(signPrivySolanaTransaction(wallet, transaction)).resolves.toBe(transaction);
    expect(request).toHaveBeenCalledWith({
      method: 'signTransaction',
      params: { transaction },
    });
    expect(readPrivySignedTransactionResponse({ signedTransaction: transaction })).toBe(
      transaction,
    );
  });
});
