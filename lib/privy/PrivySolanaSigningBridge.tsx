import { Buffer } from 'buffer';
import { useEffect, useMemo, useRef } from 'react';

import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import bs58 from 'bs58';

import { registerExternalWalletSigner } from '@/lib/wallet/external-wallet-signing';

import type {
  ExternalSignableSolanaTransaction,
  ExternalWalletSigner,
} from '@/lib/wallet/external-wallet-signing';
import type { PrivyEmbeddedSolanaWalletProvider } from '@privy-io/expo';

interface BridgeSolanaWallet {
  address: string;
  publicKey?: string;
  walletIndex?: number;
  getProvider: () => Promise<PrivyEmbeddedSolanaWalletProvider>;
}

function isBridgeSolanaWallet(value: unknown): value is BridgeSolanaWallet {
  if (value == null || typeof value !== 'object') return false;

  const candidate = value as {
    address?: unknown;
    publicKey?: unknown;
    walletIndex?: unknown;
    getProvider?: unknown;
  };

  return (
    typeof candidate.address === 'string' &&
    candidate.address.length > 0 &&
    typeof candidate.getProvider === 'function' &&
    (candidate.publicKey == null || typeof candidate.publicKey === 'string') &&
    (candidate.walletIndex == null || typeof candidate.walletIndex === 'number')
  );
}

function readPrivySolanaWallets(state: unknown): BridgeSolanaWallet[] {
  if (state == null || typeof state !== 'object') return [];

  const candidate = state as {
    status?: unknown;
    publicKey?: unknown;
    getProvider?: unknown;
    wallets?: unknown;
  };
  const wallets = Array.isArray(candidate.wallets)
    ? candidate.wallets.filter(isBridgeSolanaWallet)
    : [];

  if (wallets.length > 0) return wallets;

  if (
    candidate.status === 'connected' &&
    typeof candidate.publicKey === 'string' &&
    candidate.publicKey.length > 0 &&
    typeof candidate.getProvider === 'function'
  ) {
    return [
      {
        address: candidate.publicKey,
        publicKey: candidate.publicKey,
        walletIndex: 0,
        getProvider: candidate.getProvider as BridgeSolanaWallet['getProvider'],
      },
    ];
  }

  return [];
}

function decodePrivySignature(signature: string): Uint8Array {
  const base64 = Uint8Array.from(Buffer.from(signature, 'base64'));
  if (base64.length === 64) return base64;

  try {
    const base58 = bs58.decode(signature);
    if (base58.length === 64) return base58;
  } catch {
    // Fall through to a deterministic error below.
  }

  throw new Error('Privy returned an invalid Solana signature.');
}

export function PrivySolanaSigningBridge(): null {
  const { isReady: privyReady } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletsRef = useRef<BridgeSolanaWallet[]>([]);
  const wallets = useMemo(
    () => (privyReady ? readPrivySolanaWallets(solanaWallet) : []),
    [privyReady, solanaWallet],
  );
  const walletKey = wallets
    .map((wallet) => `${wallet.address}:${wallet.walletIndex ?? 0}`)
    .sort()
    .join('|');

  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);

  useEffect(() => {
    if (walletKey.length === 0) return undefined;

    const disposers = walletsRef.current.map((wallet) => {
      const signer: ExternalWalletSigner = {
        kind: 'privy-embedded',
        walletAddress: wallet.address,
        signMessage: async (message) => {
          const provider = await wallet.getProvider();
          const response = await provider.request({
            method: 'signMessage',
            params: {
              message: Buffer.from(message).toString('base64'),
            },
          });
          return decodePrivySignature(response.signature);
        },
        signTransaction: async (transaction) => {
          const provider = await wallet.getProvider();
          const response = await provider.request<ExternalSignableSolanaTransaction>({
            method: 'signTransaction',
            params: { transaction },
          });
          return response.signedTransaction;
        },
        signTransactions: async (transactions) => {
          const provider = await wallet.getProvider();
          const signed: ExternalSignableSolanaTransaction[] = [];
          for (const transaction of transactions) {
            const response = await provider.request<ExternalSignableSolanaTransaction>({
              method: 'signTransaction',
              params: { transaction },
            });
            signed.push(response.signedTransaction);
          }
          return signed;
        },
      };

      return registerExternalWalletSigner(signer);
    });

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [walletKey]);

  return null;
}
