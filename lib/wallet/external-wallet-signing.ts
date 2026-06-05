import type { Transaction, VersionedTransaction } from '@solana/web3.js';

export type ExternalWalletSignerKind = 'privy-embedded';
export type ExternalSignableSolanaTransaction = Transaction | VersionedTransaction;

export interface ExternalWalletSigner {
  kind: ExternalWalletSignerKind;
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (
    transaction: ExternalSignableSolanaTransaction,
  ) => Promise<ExternalSignableSolanaTransaction>;
  signTransactions?: (
    transactions: readonly ExternalSignableSolanaTransaction[],
  ) => Promise<ExternalSignableSolanaTransaction[]>;
}

type Listener = () => void;

const signersByAddress = new Map<string, ExternalWalletSigner>();
const listeners = new Set<Listener>();
let snapshotVersion = 0;

function normalizeAddress(address: string): string {
  return address.trim();
}

function emitChange(): void {
  snapshotVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerExternalWalletSigner(signer: ExternalWalletSigner): () => void {
  const walletAddress = normalizeAddress(signer.walletAddress);
  const normalizedSigner: ExternalWalletSigner = {
    ...signer,
    walletAddress,
  };

  signersByAddress.set(walletAddress, normalizedSigner);
  emitChange();

  return () => {
    const active = signersByAddress.get(walletAddress);
    if (active !== normalizedSigner) return;
    signersByAddress.delete(walletAddress);
    emitChange();
  };
}

export function getExternalWalletSigner(
  walletAddress: string | null | undefined,
): ExternalWalletSigner | null {
  if (walletAddress == null) return null;
  return signersByAddress.get(normalizeAddress(walletAddress)) ?? null;
}

export function hasExternalWalletSigner(walletAddress: string | null | undefined): boolean {
  return getExternalWalletSigner(walletAddress) != null;
}

export function subscribeExternalWalletSigners(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getExternalWalletSigningSnapshot(): number {
  return snapshotVersion;
}
