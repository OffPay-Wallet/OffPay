/**
 * Secure wallet storage — iOS Keychain / Android EncryptedSharedPreferences.
 *
 * Security model:
 *  - All wallet secrets are encrypted at rest via platform secure storage
 *  - WHEN_UNLOCKED_THIS_DEVICE_ONLY — data cannot be backed up or migrated
 *  - Wallets are stored as a single encrypted snapshot so appends/removals do
 *    not partially overwrite existing wallets if a write fails midway
 *  - Legacy single-wallet keys are migrated forward into the snapshot format
 *
 * This module is the ONLY place that reads/writes wallet secrets.
 * All other modules interact via the wallet store.
 */
import * as SecureStore from 'expo-secure-store';
import {
  deleteSecureStoreItem,
  getSecureStoreItem,
  setSecureStoreItem,
} from '@/lib/secure-store/secure-store-chunks';
import { clearSigningSeedCache } from '@/lib/wallet/signing-seed-cache';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEYS = {
  SNAPSHOT: 'offpay_wallet_snapshot_v1',

  // Legacy single-wallet keys kept for migration.
  MNEMONIC: 'offpay_wallet_mnemonic',
  PUBLIC_KEY: 'offpay_wallet_public_key',
  PRIVATE_KEY: 'offpay_wallet_private_key',
  DERIVATION_PATH: 'offpay_wallet_derivation_path',
  IMPORT_METHOD: 'offpay_wallet_import_method',
} as const;

const ACCOUNT_NAME_PREFIX = 'Account';
const DEFAULT_WALLET_BALANCE = '$ 0.00';

/** Secure storage options — maximum security policy */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const AUTH_OPTIONS: SecureStore.SecureStoreOptions = {
  ...SECURE_OPTIONS,
  requireAuthentication: true,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletImportMethod =
  | 'generated'
  | 'mnemonic-import'
  | 'private-key-import'
  | 'privy-embedded';

export interface StoredWalletInfo {
  id: string;
  name: string;
  publicKey: string;
  importMethod: WalletImportMethod;
  derivationPath: string | null;
  balance: string;
}

export interface StoredWalletSnapshot {
  wallets: StoredWalletInfo[];
  activeWalletId: string | null;
}

export interface StoredWalletSigningMaterial {
  mnemonic: string | null;
  privateKey: string | null;
}

interface StoredWalletRecord extends StoredWalletInfo {
  mnemonic: string | null;
  privateKey: string | null;
}

interface StoredWalletSnapshotPayload {
  version: 1;
  wallets: StoredWalletRecord[];
  activeWalletId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWalletId(): string {
  return `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isWalletImportMethod(value: string | null): value is WalletImportMethod {
  return (
    value === 'generated' ||
    value === 'mnemonic-import' ||
    value === 'private-key-import' ||
    value === 'privy-embedded'
  );
}

function getNextAccountName(wallets: StoredWalletRecord[]): string {
  const maxIndex = wallets.reduce((highest, wallet) => {
    const match = /^Account (\d+)$/.exec(wallet.name);
    if (match == null) return highest;

    const parsed = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
  }, 0);

  return `${ACCOUNT_NAME_PREFIX} ${maxIndex + 1}`;
}

function isGeneratedAccountName(name: string): boolean {
  return /^Account \d+$/.test(name);
}

function renumberGeneratedAccountNames(wallets: StoredWalletRecord[]): StoredWalletRecord[] {
  let nextAccountIndex = 1;

  return wallets.map((wallet) => {
    if (!isGeneratedAccountName(wallet.name)) {
      return wallet;
    }

    const nextName = `${ACCOUNT_NAME_PREFIX} ${nextAccountIndex}`;
    nextAccountIndex += 1;

    return wallet.name === nextName ? wallet : { ...wallet, name: nextName };
  });
}

function toStoredWalletInfo(wallet: StoredWalletRecord): StoredWalletInfo {
  return {
    id: wallet.id,
    name: wallet.name,
    publicKey: wallet.publicKey,
    importMethod: wallet.importMethod,
    derivationPath: wallet.derivationPath,
    balance: wallet.balance,
  };
}

function normalizeWalletRecord(wallet: StoredWalletRecord): StoredWalletRecord {
  return {
    id: wallet.id,
    name: wallet.name,
    publicKey: wallet.publicKey,
    importMethod: wallet.importMethod,
    derivationPath: wallet.derivationPath,
    balance: wallet.balance,
    mnemonic: wallet.mnemonic,
    privateKey: wallet.privateKey,
  };
}

function normalizeSnapshot(
  payload: StoredWalletSnapshotPayload | null,
): StoredWalletSnapshotPayload | null {
  if (payload == null) return null;

  const normalizedWallets = payload.wallets.map(normalizeWalletRecord);
  const activeWalletId =
    normalizedWallets.find((wallet) => wallet.id === payload.activeWalletId)?.id ??
    normalizedWallets[0]?.id ??
    null;
  const activeWallet =
    activeWalletId == null
      ? null
      : (normalizedWallets.find((wallet) => wallet.id === activeWalletId) ?? null);
  const remainingWallets =
    activeWallet == null
      ? normalizedWallets
      : normalizedWallets.filter((wallet) => wallet.id !== activeWalletId);

  return {
    version: 1,
    wallets: activeWallet == null ? remainingWallets : [activeWallet, ...remainingWallets],
    activeWalletId,
  };
}

function toPublicSnapshot(payload: StoredWalletSnapshotPayload | null): StoredWalletSnapshot {
  if (payload == null) {
    return {
      wallets: [],
      activeWalletId: null,
    };
  }

  return {
    wallets: payload.wallets.map(toStoredWalletInfo),
    activeWalletId: payload.activeWalletId,
  };
}

function getWalletFromPayload(
  payload: StoredWalletSnapshotPayload | null,
  walletId?: string,
): StoredWalletRecord | null {
  if (payload == null) return null;

  const targetWalletId = walletId ?? payload.activeWalletId;
  if (targetWalletId == null) return null;

  return payload.wallets.find((wallet) => wallet.id === targetWalletId) ?? null;
}

function hasWalletWithPublicKey(payload: StoredWalletSnapshotPayload, publicKey: string): boolean {
  return payload.wallets.some((wallet) => wallet.publicKey === publicKey);
}

async function clearLegacyKeys(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(KEYS.MNEMONIC),
    SecureStore.deleteItemAsync(KEYS.PUBLIC_KEY),
    SecureStore.deleteItemAsync(KEYS.PRIVATE_KEY),
    SecureStore.deleteItemAsync(KEYS.DERIVATION_PATH),
    SecureStore.deleteItemAsync(KEYS.IMPORT_METHOD),
  ]);
}

async function writeSnapshot(payload: StoredWalletSnapshotPayload): Promise<void> {
  await setSecureStoreItem(KEYS.SNAPSHOT, JSON.stringify(payload), SECURE_OPTIONS);
  await clearLegacyKeys();
}

async function readSnapshot(
  options?: SecureStore.SecureStoreOptions,
): Promise<StoredWalletSnapshotPayload | null> {
  const raw = await getSecureStoreItem(KEYS.SNAPSHOT, options);
  if (raw == null || raw.length === 0) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWalletSnapshotPayload>;
    if (!Array.isArray(parsed.wallets)) return null;

    const wallets = parsed.wallets.flatMap((wallet): StoredWalletRecord[] => {
      if (
        wallet == null ||
        typeof wallet.id !== 'string' ||
        typeof wallet.name !== 'string' ||
        typeof wallet.publicKey !== 'string' ||
        !isWalletImportMethod(
          typeof wallet.importMethod === 'string' ? wallet.importMethod : null,
        ) ||
        (wallet.derivationPath != null && typeof wallet.derivationPath !== 'string') ||
        typeof wallet.balance !== 'string' ||
        (wallet.mnemonic != null && typeof wallet.mnemonic !== 'string') ||
        (wallet.privateKey != null && typeof wallet.privateKey !== 'string')
      ) {
        return [];
      }

      return [
        {
          id: wallet.id,
          name: wallet.name,
          publicKey: wallet.publicKey,
          importMethod: wallet.importMethod,
          derivationPath: wallet.derivationPath ?? null,
          balance: wallet.balance,
          mnemonic: wallet.mnemonic ?? null,
          privateKey: wallet.privateKey ?? null,
        },
      ];
    });

    return normalizeSnapshot({
      version: 1,
      wallets,
      activeWalletId:
        typeof parsed.activeWalletId === 'string'
          ? parsed.activeWalletId
          : (wallets[0]?.id ?? null),
    });
  } catch (error: unknown) {
    console.error('[SecureWalletStore] Failed to parse wallet snapshot:', error);
    return null;
  }
}

async function migrateLegacyWallet(
  options?: SecureStore.SecureStoreOptions,
): Promise<StoredWalletSnapshotPayload | null> {
  const [mnemonic, publicKey, privateKey, derivationPath, importMethodRaw] = await Promise.all([
    SecureStore.getItemAsync(KEYS.MNEMONIC, options),
    SecureStore.getItemAsync(KEYS.PUBLIC_KEY, options),
    SecureStore.getItemAsync(KEYS.PRIVATE_KEY, options),
    SecureStore.getItemAsync(KEYS.DERIVATION_PATH, options),
    SecureStore.getItemAsync(KEYS.IMPORT_METHOD, options),
  ]);

  if (publicKey == null || publicKey.length === 0) return null;

  const importMethod: WalletImportMethod = isWalletImportMethod(importMethodRaw)
    ? importMethodRaw
    : privateKey != null && privateKey.length > 0
      ? 'private-key-import'
      : 'generated';

  const wallet: StoredWalletRecord = {
    id: createWalletId(),
    name: `${ACCOUNT_NAME_PREFIX} 1`,
    publicKey,
    importMethod,
    derivationPath,
    balance: DEFAULT_WALLET_BALANCE,
    mnemonic: mnemonic ?? null,
    privateKey: privateKey ?? null,
  };

  const payload: StoredWalletSnapshotPayload = {
    version: 1,
    wallets: [wallet],
    activeWalletId: wallet.id,
  };

  await writeSnapshot(payload);

  return payload;
}

async function getSnapshotPayload(
  options?: SecureStore.SecureStoreOptions,
): Promise<StoredWalletSnapshotPayload | null> {
  const snapshot = await readSnapshot(options);
  if (snapshot != null) return snapshot;

  return migrateLegacyWallet(options);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function storeWalletWithMnemonic(params: {
  mnemonic: string;
  publicKey: string;
  derivationPath: string;
  importMethod: 'generated' | 'mnemonic-import';
}): Promise<void> {
  const snapshot =
    (await getSnapshotPayload()) ??
    ({
      version: 1,
      wallets: [],
      activeWalletId: null,
    } satisfies StoredWalletSnapshotPayload);

  if (hasWalletWithPublicKey(snapshot, params.publicKey)) {
    throw new Error('This wallet is already added to OffPay.');
  }

  const wallet: StoredWalletRecord = {
    id: createWalletId(),
    name: getNextAccountName(snapshot.wallets),
    publicKey: params.publicKey,
    importMethod: params.importMethod,
    derivationPath: params.derivationPath,
    balance: DEFAULT_WALLET_BALANCE,
    mnemonic: params.mnemonic,
    privateKey: null,
  };

  const nextSnapshot = normalizeSnapshot({
    version: 1,
    wallets: [...snapshot.wallets, wallet],
    activeWalletId: snapshot.activeWalletId ?? wallet.id,
  });

  if (nextSnapshot == null) {
    throw new Error('Failed to build the next wallet snapshot.');
  }

  await writeSnapshot(nextSnapshot);
}

export async function storeWalletWithPrivateKey(params: {
  privateKey: string;
  publicKey: string;
}): Promise<void> {
  const snapshot =
    (await getSnapshotPayload()) ??
    ({
      version: 1,
      wallets: [],
      activeWalletId: null,
    } satisfies StoredWalletSnapshotPayload);

  if (hasWalletWithPublicKey(snapshot, params.publicKey)) {
    throw new Error('This wallet is already added to OffPay.');
  }

  const wallet: StoredWalletRecord = {
    id: createWalletId(),
    name: getNextAccountName(snapshot.wallets),
    publicKey: params.publicKey,
    importMethod: 'private-key-import',
    derivationPath: null,
    balance: DEFAULT_WALLET_BALANCE,
    mnemonic: null,
    privateKey: params.privateKey,
  };

  const nextSnapshot = normalizeSnapshot({
    version: 1,
    wallets: [...snapshot.wallets, wallet],
    activeWalletId: snapshot.activeWalletId ?? wallet.id,
  });

  if (nextSnapshot == null) {
    throw new Error('Failed to build the next wallet snapshot.');
  }

  await writeSnapshot(nextSnapshot);
}

export async function storePrivyEmbeddedWallet(params: {
  publicKey: string;
}): Promise<StoredWalletSnapshot> {
  const snapshot =
    (await getSnapshotPayload()) ??
    ({
      version: 1,
      wallets: [],
      activeWalletId: null,
    } satisfies StoredWalletSnapshotPayload);

  const existingWallet = snapshot.wallets.find((wallet) => wallet.publicKey === params.publicKey);

  if (existingWallet != null) {
    const nextSnapshot = normalizeSnapshot({
      ...snapshot,
      activeWalletId: existingWallet.id,
    });

    if (nextSnapshot == null) {
      throw new Error('Failed to activate the Privy wallet.');
    }

    await writeSnapshot(nextSnapshot);
    return toPublicSnapshot(nextSnapshot);
  }

  const wallet: StoredWalletRecord = {
    id: createWalletId(),
    name: getNextAccountName(snapshot.wallets),
    publicKey: params.publicKey,
    importMethod: 'privy-embedded',
    derivationPath: null,
    balance: DEFAULT_WALLET_BALANCE,
    mnemonic: null,
    privateKey: null,
  };

  const nextSnapshot = normalizeSnapshot({
    version: 1,
    wallets: [...snapshot.wallets, wallet],
    activeWalletId: wallet.id,
  });

  if (nextSnapshot == null) {
    throw new Error('Failed to build the Privy wallet snapshot.');
  }

  await writeSnapshot(nextSnapshot);
  return toPublicSnapshot(nextSnapshot);
}

export async function getStoredWalletSnapshot(): Promise<StoredWalletSnapshot> {
  const snapshot = await getSnapshotPayload();
  return toPublicSnapshot(snapshot);
}

export async function setStoredActiveWallet(walletId: string): Promise<StoredWalletSnapshot> {
  const snapshot = await getSnapshotPayload();
  const wallet = getWalletFromPayload(snapshot, walletId);

  if (snapshot == null || wallet == null) {
    throw new Error('Wallet not found.');
  }

  const nextSnapshot = normalizeSnapshot({
    ...snapshot,
    activeWalletId: wallet.id,
  });

  if (nextSnapshot == null) {
    throw new Error('Failed to update the active wallet.');
  }

  await writeSnapshot(nextSnapshot);
  // Active-wallet switch invalidates any cached signing seed because
  // the cache was keyed by the old resolved walletId. Clearing the
  // entire cache (rather than just the previous wallet's entry) is
  // cheap and avoids accidental cross-wallet seed reuse if multiple
  // wallets coexist in the cache.
  clearSigningSeedCache('wallet-switch');

  return toPublicSnapshot(nextSnapshot);
}

export async function removeStoredWallet(walletId: string): Promise<StoredWalletSnapshot> {
  const snapshot = await getSnapshotPayload();

  if (snapshot == null) {
    return toPublicSnapshot(null);
  }

  const walletExists = snapshot.wallets.some((wallet) => wallet.id === walletId);
  if (!walletExists) {
    return toPublicSnapshot(snapshot);
  }

  if (snapshot.wallets.length <= 1) {
    throw new Error('Cannot remove the only wallet.');
  }

  const wallets = renumberGeneratedAccountNames(
    snapshot.wallets.filter((wallet) => wallet.id !== walletId),
  );
  const activeWalletId =
    snapshot.activeWalletId === walletId ? (wallets[0]?.id ?? null) : snapshot.activeWalletId;

  const nextSnapshot = normalizeSnapshot({
    version: 1,
    wallets,
    activeWalletId,
  });

  if (nextSnapshot == null) {
    throw new Error('Failed to update the wallet list.');
  }

  await writeSnapshot(nextSnapshot);
  // Wallet removal can change the active id and shifts the cache's
  // notion of which wallet is current. A full clear is cheap and
  // avoids any cross-wallet seed reuse path.
  clearSigningSeedCache('wallet-remove');

  return toPublicSnapshot(nextSnapshot);
}

export async function hasStoredWallet(): Promise<boolean> {
  try {
    const snapshot = await getStoredWalletSnapshot();
    return snapshot.wallets.length > 0;
  } catch (error: unknown) {
    console.error('[SecureWalletStore] hasStoredWallet failed:', error);
    return false;
  }
}

export async function getStoredWalletInfo(walletId?: string): Promise<StoredWalletInfo | null> {
  try {
    const snapshot = await getSnapshotPayload();
    const wallet = getWalletFromPayload(snapshot, walletId);
    return wallet == null ? null : toStoredWalletInfo(wallet);
  } catch {
    return null;
  }
}

export async function getStoredMnemonic(walletId?: string): Promise<string | null> {
  try {
    const snapshot = await getSnapshotPayload();
    return getWalletFromPayload(snapshot, walletId)?.mnemonic ?? null;
  } catch {
    return null;
  }
}

export async function getStoredMnemonicWithAuth(walletId?: string): Promise<string | null> {
  try {
    const snapshot = await getSnapshotPayload(AUTH_OPTIONS);
    return getWalletFromPayload(snapshot, walletId)?.mnemonic ?? null;
  } catch {
    return null;
  }
}

export async function getStoredPrivateKey(walletId?: string): Promise<string | null> {
  try {
    const snapshot = await getSnapshotPayload();
    return getWalletFromPayload(snapshot, walletId)?.privateKey ?? null;
  } catch {
    return null;
  }
}

export async function getStoredPrivateKeyWithAuth(walletId?: string): Promise<string | null> {
  try {
    const snapshot = await getSnapshotPayload(AUTH_OPTIONS);
    return getWalletFromPayload(snapshot, walletId)?.privateKey ?? null;
  } catch {
    return null;
  }
}

export async function getStoredWalletSigningMaterialWithAuth(
  walletId?: string,
): Promise<StoredWalletSigningMaterial | null> {
  try {
    const snapshot = await getSnapshotPayload(AUTH_OPTIONS);
    const wallet = getWalletFromPayload(snapshot, walletId);
    if (wallet == null) return null;

    return {
      mnemonic: wallet.mnemonic,
      privateKey: wallet.privateKey,
    };
  } catch {
    return null;
  }
}

export async function getStoredWalletInfoWithAuth(
  walletId?: string,
): Promise<StoredWalletInfo | null> {
  try {
    const snapshot = await getSnapshotPayload(AUTH_OPTIONS);
    const wallet = getWalletFromPayload(snapshot, walletId);
    return wallet == null ? null : toStoredWalletInfo(wallet);
  } catch {
    return null;
  }
}

export async function deleteStoredWallet(): Promise<void> {
  // Clear in-memory secrets first, then attempt the disk wipe. Even
  // if SecureStore deletion fails halfway through, we have already
  // dropped any cached seeds so the JS runtime cannot continue
  // signing with a wallet that the user has asked to delete.
  clearSigningSeedCache('wallet-delete-all');

  const results = await Promise.allSettled([
    deleteSecureStoreItem(KEYS.SNAPSHOT),
    SecureStore.deleteItemAsync(KEYS.MNEMONIC),
    SecureStore.deleteItemAsync(KEYS.PUBLIC_KEY),
    SecureStore.deleteItemAsync(KEYS.PRIVATE_KEY),
    SecureStore.deleteItemAsync(KEYS.DERIVATION_PATH),
    SecureStore.deleteItemAsync(KEYS.IMPORT_METHOD),
  ]);

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.error('[SecureWalletStore] deleteStoredWallet partial failure:', failures);
    throw new Error(`Failed to delete ${failures.length} wallet key(s) from secure storage.`);
  }
}
