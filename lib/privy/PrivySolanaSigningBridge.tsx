import { Buffer } from 'buffer';
import { useEffect, useMemo, useRef } from 'react';

import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { registerExternalWalletSigner } from '@/lib/wallet/external-wallet-signing';

import type {
  ExternalSignableSolanaTransaction,
  ExternalWalletSigner,
} from '@/lib/wallet/external-wallet-signing';
import type { PrivyEmbeddedSolanaWalletProvider } from '@privy-io/expo';

export interface BridgeSolanaWallet {
  address: string;
  publicKey?: string;
  walletIndex?: number;
  getProvider: () => Promise<PrivyEmbeddedSolanaWalletProvider>;
}

interface PrivyRequestProvider {
  request: <TResponse = unknown>(args: {
    method: string;
    params?: Record<string, unknown>;
  }) => Promise<TResponse>;
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

export function readPrivySolanaWallets(state: unknown): BridgeSolanaWallet[] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function unwrapPrivyResponseData(response: unknown): unknown {
  return isRecord(response) && 'data' in response ? response.data : response;
}

function getPrivyRequestProvider(provider: unknown): PrivyRequestProvider {
  const request = isRecord(provider) ? provider.request : null;
  if (typeof request !== 'function') {
    throw new Error(
      'Privy wallet signing provider is unavailable. Sign in again or wait a moment and retry.',
    );
  }

  return {
    request: request.bind(provider) as PrivyRequestProvider['request'],
  };
}

function decodePrivySignature(signature: unknown): Uint8Array {
  if (signature instanceof Uint8Array) {
    if (signature.length === 64) return Uint8Array.from(signature);
    throw new Error('Privy returned an invalid Solana signature.');
  }

  if (typeof signature !== 'string') {
    throw new Error('Privy returned an invalid Solana signature.');
  }

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

export function decodePrivySignatureResponse(response: unknown): Uint8Array {
  const data = unwrapPrivyResponseData(response);
  if (isRecord(data) && 'signature' in data) return decodePrivySignature(data.signature);
  return decodePrivySignature(data);
}

function deserializeSignedTransactionBytes(bytes: Uint8Array): ExternalSignableSolanaTransaction {
  const signatureCount = bytes[0] ?? 0;
  const messageOffset = 1 + signatureCount * 64;
  const messageFirstByte = bytes[messageOffset] ?? 0;
  if ((messageFirstByte & 0x80) !== 0) return VersionedTransaction.deserialize(bytes);
  return Transaction.from(Buffer.from(bytes));
}

export function readPrivySignedTransactionResponse(
  response: unknown,
): ExternalSignableSolanaTransaction {
  const data = unwrapPrivyResponseData(response);

  if (data instanceof Transaction || data instanceof VersionedTransaction) return data;

  if (isRecord(data)) {
    const signedTransaction = data.signedTransaction ?? data.signed_transaction;
    if (
      signedTransaction instanceof Transaction ||
      signedTransaction instanceof VersionedTransaction
    ) {
      return signedTransaction;
    }
    if (signedTransaction instanceof Uint8Array) {
      return deserializeSignedTransactionBytes(signedTransaction);
    }
    if (typeof signedTransaction === 'string') {
      return deserializeSignedTransactionBytes(
        Uint8Array.from(Buffer.from(signedTransaction, 'base64')),
      );
    }
  }

  throw new Error('Privy returned an invalid signed Solana transaction.');
}

export async function signPrivySolanaMessage(
  wallet: BridgeSolanaWallet,
  message: Uint8Array,
): Promise<Uint8Array> {
  const provider = getPrivyRequestProvider(await wallet.getProvider());
  const response = await provider.request({
    method: 'signMessage',
    params: {
      message: Buffer.from(message).toString('base64'),
    },
  });
  return decodePrivySignatureResponse(response);
}

export async function signPrivySolanaTransaction(
  wallet: BridgeSolanaWallet,
  transaction: ExternalSignableSolanaTransaction,
): Promise<ExternalSignableSolanaTransaction> {
  const provider = getPrivyRequestProvider(await wallet.getProvider());
  const response = await provider.request({
    method: 'signTransaction',
    params: { transaction },
  });
  return readPrivySignedTransactionResponse(response);
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
        signMessage: (message) => signPrivySolanaMessage(wallet, message),
        signTransaction: (transaction) => signPrivySolanaTransaction(wallet, transaction),
        signTransactions: async (transactions) => {
          const signed: ExternalSignableSolanaTransaction[] = [];
          for (const transaction of transactions) {
            signed.push(await signPrivySolanaTransaction(wallet, transaction));
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
