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

interface RegisterExternalWalletSignerOptions {
  unregisterDelayMs?: number;
}

function normalizeAddress(address: string): string {
  return address.trim();
}

function emitChange(): void {
  snapshotVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerExternalWalletSigner(
  signer: ExternalWalletSigner,
  options?: RegisterExternalWalletSignerOptions,
): () => void {
  const walletAddress = normalizeAddress(signer.walletAddress);
  const normalizedSigner: ExternalWalletSigner = {
    ...signer,
    walletAddress,
  };
  const unregisterDelayMs = Math.max(0, options?.unregisterDelayMs ?? 0);

  signersByAddress.set(walletAddress, normalizedSigner);
  emitChange();

  return () => {
    const removeIfStillActive = () => {
      const active = signersByAddress.get(walletAddress);
      if (active !== normalizedSigner) return;
      signersByAddress.delete(walletAddress);
      emitChange();
    };

    if (unregisterDelayMs <= 0) {
      removeIfStillActive();
      return;
    }

    setTimeout(removeIfStillActive, unregisterDelayMs);
  };
}

export function getExternalWalletSigner(
  walletAddress: string | null | undefined,
): ExternalWalletSigner | null {
  if (walletAddress == null) return null;
  return signersByAddress.get(normalizeAddress(walletAddress)) ?? null;
}

export function waitForExternalWalletSigner(
  walletAddress: string | null | undefined,
  timeoutMs: number,
): Promise<ExternalWalletSigner | null> {
  if (walletAddress == null) return Promise.resolve(null);

  const normalizedWalletAddress = normalizeAddress(walletAddress);
  const existing = signersByAddress.get(normalizedWalletAddress) ?? null;
  if (existing != null || timeoutMs <= 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const settle = (signer: ExternalWalletSigner | null) => {
      if (settled) return;
      settled = true;
      if (timeout != null) clearTimeout(timeout);
      unsubscribe();
      resolve(signer);
    };

    const unsubscribe = subscribeExternalWalletSigners(() => {
      const signer = signersByAddress.get(normalizedWalletAddress) ?? null;
      if (signer != null) settle(signer);
    });

    timeout = setTimeout(() => settle(null), timeoutMs);

    const signerAfterSubscribe = signersByAddress.get(normalizedWalletAddress) ?? null;
    if (signerAfterSubscribe != null) settle(signerAfterSubscribe);
  });
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
