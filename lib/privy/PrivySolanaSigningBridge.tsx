import { Buffer } from 'buffer';
import { useEffect, useRef } from 'react';

import { useEmbeddedSolanaWallet } from '@privy-io/expo';
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
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletsRef = useRef<BridgeSolanaWallet[]>([]);
  const walletKey =
    solanaWallet.status === 'connected'
      ? solanaWallet.wallets
          .map((wallet) => `${wallet.address}:${wallet.walletIndex}`)
          .sort()
          .join('|')
      : '';

  useEffect(() => {
    walletsRef.current = solanaWallet.status === 'connected' ? solanaWallet.wallets : [];
  }, [solanaWallet]);

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
