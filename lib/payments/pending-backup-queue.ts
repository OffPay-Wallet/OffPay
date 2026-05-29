import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

import {
  deletePendingBackup,
  getRpcSignatureStatuses,
  settlePrivatePayments,
  uploadPendingBackup,
} from '@/lib/api/offpay-api-client';
import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
import {
  deletePersistedJson,
  readPersistedJson,
  writePersistedJson,
} from '@/lib/cache/persistent-json-cache';
import { getStoredWalletSigningMaterialWithAuth } from '@/lib/wallet/secure-wallet-store';
import { getOrDeriveSigningSeed } from '@/lib/wallet/signing-seed-cache';
import {
  decodeSigningSeedFromPrivateKey,
  deriveSigningSeedFromMnemonic,
} from '@/lib/wallet/wallet';

import type {
  OffpayNetwork,
  PaymentSettleResponse,
  PendingBackupListResponse,
  PendingBackupUploadBody,
} from '@/types/offpay-api';

const STORAGE_KEY = 'offpay_pending_backup_queue_v1';

const BACKUP_KEY_DOMAIN = 'offpay:pending-backup-key:v1';
const PLAINTEXT_DOMAIN = 'offpay:pending-backup-payload:v1';
const STORAGE_VERSION = 1;
const PLAINTEXT_VERSION = 1;
const MAX_TX_ID_LENGTH = 128;
const MAX_SIGNED_BLOB_LENGTH = 256_000;
const MAX_CIPHERTEXT_LENGTH = 512_000;
const SETTLEMENT_BATCH_SIZE = 50;
const SETTLEMENT_BATCH_DELAY_MS = 500;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

let queueMutationLock: Promise<void> = Promise.resolve();

export type PendingBackupKind =
  | 'private-payment'
  | 'offline-payment'
  | 'privacy-envelope-settlement';

export type PendingBackupSettlementStatus = 'pending' | 'confirmed' | 'failed';

export interface PendingBackupPlaintext {
  version: 1;
  domain: typeof PLAINTEXT_DOMAIN;
  txId: string;
  walletAddress: string;
  network: OffpayNetwork;
  kind: PendingBackupKind;
  signedBlob: string;
  createdAt: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface PendingBackupQueueItem {
  txId: string;
  walletAddress: string;
  network: OffpayNetwork;
  ciphertext: string;
  nonce: string;
  createdAt: number;
  recoveredAt: number | null;
  uploadedAt: number | null;
  lastUploadError: string | null;
  settlementStatus: PendingBackupSettlementStatus;
  settlementSignature: string | null;
  lastSettlementError: string | null;
  updatedAt: number;
}

export interface PendingBackupQueueStats {
  total: number;
  pending: number;
  uploadPending: number;
  recovered: number;
  confirmedAwaitingDelete: number;
  failed: number;
}

export interface PendingBackupRecoveryResult {
  recoveredCount: number;
  skippedCount: number;
  failedCount: number;
  failureMessages: string[];
}

export interface PendingBackupUploadSyncResult {
  uploadedCount: number;
  failedCount: number;
}

export interface PendingBackupSettlementResult {
  submittedCount: number;
  confirmedCount: number;
  failedCount: number;
  deleteFailedCount: number;
  batches: PaymentSettleResponse[];
  submittedTxIds: string[];
  confirmedTxIds: string[];
  failedTxIds: string[];
}

export interface PendingBackupCleanupResult {
  deletedCount: number;
  failedCount: number;
}

interface PendingBackupStoragePayload {
  version: 1;
  items: PendingBackupQueueItem[];
}

interface EnqueuePendingPaymentBackupParams {
  walletAddress: string;
  walletId?: string;
  network: OffpayNetwork;
  txId: string;
  signedBlob: string;
  kind?: PendingBackupKind;
  createdAt?: number;
  metadata?: Record<string, string | number | boolean | null>;
  uploadImmediately?: boolean;
}

function assertSafeId(txId: string): void {
  if (typeof txId !== 'string' || txId.trim().length === 0) {
    throw new Error('Pending backup txId is required.');
  }

  if (txId.length > MAX_TX_ID_LENGTH) {
    throw new Error('Pending backup txId is too long.');
  }
}

function assertTimestamp(createdAt: number): void {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw new Error('Pending backup createdAt must be a valid epoch timestamp.');
  }

  if (createdAt > Date.now() + CLOCK_SKEW_MS) {
    throw new Error('Pending backup createdAt is too far in the future.');
  }
}

function assertSignedBlob(signedBlob: string): void {
  if (typeof signedBlob !== 'string' || signedBlob.trim().length === 0) {
    throw new Error('Pending backup signed blob is required.');
  }

  if (signedBlob.length > MAX_SIGNED_BLOB_LENGTH) {
    throw new Error('Pending backup signed blob is too large.');
  }
}

function decodeBase58Field(value: string, label: string): Uint8Array {
  if (value.length === 0 || value.length > MAX_CIPHERTEXT_LENGTH) {
    throw new Error(`${label} is missing or too large.`);
  }

  try {
    return bs58.decode(value);
  } catch {
    throw new Error(`${label} must be base58 encoded.`);
  }
}

function validateEncryptedBackupShape(backup: PendingBackupUploadBody): void {
  assertSafeId(backup.txId);
  assertTimestamp(backup.createdAt);

  const nonce = decodeBase58Field(backup.nonce, 'Pending backup nonce');
  if (nonce.length !== nacl.secretbox.nonceLength) {
    throw new Error('Pending backup nonce must decode to 24 bytes.');
  }

  const ciphertext = decodeBase58Field(backup.ciphertext, 'Pending backup ciphertext');
  if (ciphertext.length <= nacl.secretbox.overheadLength) {
    throw new Error('Pending backup ciphertext is too short.');
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown pending backup error.';
}

function normalizeSettlementSignature(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readShortVecLength(buffer: Uint8Array, offset: number): { value: number; offset: number } | null {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte == null) return null;
    value |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7;
    if (shift > 28) return null;
  }

  return null;
}

function decodeSignedBlobBytes(signedBlob: string): Uint8Array | null {
  const normalized = signedBlob.trim();
  if (normalized.length === 0) return null;

  try {
    const base64Candidate = /^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length % 4 === 0;
    if (base64Candidate) {
      return Uint8Array.from(Buffer.from(normalized, 'base64'));
    }
  } catch {
    // Fall back to base58 below.
  }

  try {
    return bs58.decode(normalized);
  } catch {
    return null;
  }
}

function getSignedBlobPrimarySignature(signedBlob: string): string | null {
  const transaction = decodeSignedBlobBytes(signedBlob);
  if (transaction == null) return null;

  const signatureCount = readShortVecLength(transaction, 0);
  if (signatureCount == null || signatureCount.value < 1) return null;

  const signatureStart = signatureCount.offset;
  const signatureEnd = signatureStart + 64;
  if (transaction.length < signatureEnd) return null;

  const signature = transaction.subarray(signatureStart, signatureEnd);
  if (signature.every((byte) => byte === 0)) return null;

  return bs58.encode(signature);
}

async function getSettlementSignatureState(params: {
  signature: string;
  network: OffpayNetwork;
}): Promise<'confirmed' | 'failed' | 'unknown'> {
  try {
    const response = await getRpcSignatureStatuses({
      signatures: [params.signature],
      network: params.network,
    });
    const status = response.statuses[0];
    if (status == null) return 'unknown';
    if (status.err != null) return 'failed';
    if (status.slot != null || status.confirmationStatus != null) return 'confirmed';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOffpayNetwork(value: unknown): value is OffpayNetwork {
  return value === 'mainnet' || value === 'devnet';
}

function isPendingBackupKind(value: unknown): value is PendingBackupKind {
  return (
    value === 'private-payment' ||
    value === 'offline-payment' ||
    value === 'privacy-envelope-settlement'
  );
}

function sanitizeMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (metadata == null) return undefined;

  const entries = Object.entries(metadata).filter(([, value]) => {
    return (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    );
  });

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function assertPlaintext(value: unknown): asserts value is PendingBackupPlaintext {
  if (!isRecord(value)) {
    throw new Error('Pending backup plaintext is not an object.');
  }

  if (
    value.version !== PLAINTEXT_VERSION ||
    value.domain !== PLAINTEXT_DOMAIN ||
    typeof value.txId !== 'string' ||
    typeof value.walletAddress !== 'string' ||
    !isOffpayNetwork(value.network) ||
    !isPendingBackupKind(value.kind) ||
    typeof value.signedBlob !== 'string' ||
    typeof value.createdAt !== 'number'
  ) {
    throw new Error('Pending backup plaintext schema is invalid.');
  }

  assertSafeId(value.txId);
  assertTimestamp(value.createdAt);
  assertSignedBlob(value.signedBlob);
}

function isQueueItem(value: unknown): value is PendingBackupQueueItem {
  if (!isRecord(value)) return false;

  return (
    typeof value.txId === 'string' &&
    typeof value.walletAddress === 'string' &&
    isOffpayNetwork(value.network) &&
    typeof value.ciphertext === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.createdAt === 'number' &&
    (typeof value.recoveredAt === 'number' || value.recoveredAt === null) &&
    (typeof value.uploadedAt === 'number' || value.uploadedAt === null) &&
    (typeof value.lastUploadError === 'string' || value.lastUploadError === null) &&
    (value.settlementStatus === 'pending' ||
      value.settlementStatus === 'confirmed' ||
      value.settlementStatus === 'failed') &&
    (typeof value.settlementSignature === 'string' || value.settlementSignature === null) &&
    (typeof value.lastSettlementError === 'string' || value.lastSettlementError === null) &&
    typeof value.updatedAt === 'number'
  );
}

async function readQueue(): Promise<PendingBackupQueueItem[]> {
  const payload = await readPersistedJson(STORAGE_KEY, (value): PendingBackupStoragePayload | null => {
    if (!isRecord(value)) return null;
    const candidate = value as Partial<PendingBackupStoragePayload>;
    if (candidate.version !== STORAGE_VERSION || !Array.isArray(candidate.items)) {
      return null;
    }

    return {
      version: STORAGE_VERSION,
      items: candidate.items.filter(isQueueItem),
    };
  });
  return payload?.items ?? [];
}

async function writeQueue(items: PendingBackupQueueItem[]): Promise<void> {
  const payload: PendingBackupStoragePayload = {
    version: STORAGE_VERSION,
    items,
  };

  await writePersistedJson(STORAGE_KEY, payload);
}

export async function clearPendingBackupQueue(): Promise<void> {
  await withQueueMutation(() => deletePersistedJson(STORAGE_KEY));
}

async function withQueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = queueMutationLock;
  let release: () => void = () => undefined;

  queueMutationLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();
  }
}

async function updateQueueItem(
  txId: string,
  updater: (item: PendingBackupQueueItem) => PendingBackupQueueItem | null,
): Promise<PendingBackupQueueItem | null> {
  return withQueueMutation(async () => {
    const items = await readQueue();
    let updatedItem: PendingBackupQueueItem | null = null;
    const nextItems = items.flatMap((item) => {
      if (item.txId !== txId) return [item];

      updatedItem = updater(item);
      return updatedItem == null ? [] : [updatedItem];
    });

    await writeQueue(nextItems);
    return updatedItem;
  });
}

function upsertQueueItem(
  items: PendingBackupQueueItem[],
  item: PendingBackupQueueItem,
): PendingBackupQueueItem[] {
  const existingIndex = items.findIndex((existing) => existing.txId === item.txId);
  if (existingIndex === -1) return [...items, item];

  const nextItems = [...items];
  const existing = nextItems[existingIndex];
  nextItems[existingIndex] = {
    ...existing,
    ...item,
    uploadedAt: existing?.uploadedAt ?? item.uploadedAt,
    settlementStatus:
      existing?.settlementStatus === 'confirmed' ? 'confirmed' : item.settlementStatus,
    settlementSignature: existing?.settlementSignature ?? item.settlementSignature,
    updatedAt: Date.now(),
  };
  return nextItems;
}

async function deriveSigningSeedForBackup(params: {
  walletId?: string;
  walletAddress: string;
}): Promise<Uint8Array> {
  return getOrDeriveSigningSeed({
    walletAddress: params.walletAddress,
    derive: async () => {
      const signingMaterial = await getStoredWalletSigningMaterialWithAuth(params.walletId);
      const mnemonic = signingMaterial?.mnemonic ?? null;
      const privateKey = signingMaterial?.privateKey ?? null;

      let seed: Uint8Array | null = null;
      if (mnemonic != null && mnemonic.length > 0) {
        seed = await deriveSigningSeedFromMnemonic(mnemonic);
      } else if (privateKey != null && privateKey.length > 0) {
        seed = decodeSigningSeedFromPrivateKey(privateKey);
      }

      if (seed == null) {
        throw new Error('No wallet signing material is available for pending backup recovery.');
      }

      // Verify before caching so a corrupt/mismatched private key
      // never poisons the cache for the rest of the unlocked
      // session.
      const derivedPublicKey = ed25519.getPublicKey(seed);
      try {
        if (bs58.encode(derivedPublicKey) !== params.walletAddress) {
          zeroOutBytes(seed);
          throw new Error('Stored signing material does not match the active wallet.');
        }
      } finally {
        zeroOutBytes(derivedPublicKey);
      }

      return seed;
    },
  });
}

async function deriveBackupKey(params: {
  walletAddress: string;
  walletId?: string;
}): Promise<Uint8Array> {
  const signingSeed = await deriveSigningSeedForBackup({
    walletId: params.walletId,
    walletAddress: params.walletAddress,
  });
  const publicKey = ed25519.getPublicKey(signingSeed);

  try {
    const derivedAddress = bs58.encode(publicKey);
    if (derivedAddress !== params.walletAddress) {
      throw new Error('Pending backup wallet key does not match the active wallet.');
    }

    const domain = utf8ToBytes(`${BACKUP_KEY_DOMAIN}:${params.walletAddress}`);
    const material = new Uint8Array(domain.length + signingSeed.length);
    material.set(domain, 0);
    material.set(signingSeed, domain.length);

    try {
      return sha256(material);
    } finally {
      zeroOutBytes(material);
    }
  } finally {
    zeroOutBytes(signingSeed);
    zeroOutBytes(publicKey);
  }
}

function encryptPlaintext(plaintext: PendingBackupPlaintext, key: Uint8Array): PendingBackupUploadBody {
  const nonce = new Uint8Array(nacl.secretbox.nonceLength);
  crypto.getRandomValues(nonce);

  const plaintextBytes = utf8ToBytes(JSON.stringify(plaintext));
  const ciphertext = nacl.secretbox(plaintextBytes, nonce, key);

  try {
    return {
      txId: plaintext.txId,
      ciphertext: bs58.encode(ciphertext),
      nonce: bs58.encode(nonce),
      createdAt: plaintext.createdAt,
    };
  } finally {
    zeroOutBytes(nonce);
    zeroOutBytes(plaintextBytes);
    zeroOutBytes(ciphertext);
  }
}

function decryptPlaintext(
  backup: PendingBackupUploadBody,
  key: Uint8Array,
): PendingBackupPlaintext {
  validateEncryptedBackupShape(backup);

  const ciphertext = bs58.decode(backup.ciphertext);
  const nonce = bs58.decode(backup.nonce);
  const plaintextBytes = nacl.secretbox.open(ciphertext, nonce, key);

  try {
    if (plaintextBytes == null) {
      throw new Error('Pending backup could not be authenticated or decrypted.');
    }

    const plaintextJson = Buffer.from(plaintextBytes).toString('utf8');
    const parsed = JSON.parse(plaintextJson) as unknown;
    assertPlaintext(parsed);

    if (parsed.txId !== backup.txId || parsed.createdAt !== backup.createdAt) {
      throw new Error('Pending backup metadata does not match decrypted payload.');
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Pending backup plaintext is not valid JSON.');
    }
    throw error;
  } finally {
    zeroOutBytes(ciphertext);
    zeroOutBytes(nonce);
    if (plaintextBytes != null) zeroOutBytes(plaintextBytes);
  }
}

function buildQueueItem(params: {
  backup: PendingBackupUploadBody;
  walletAddress: string;
  network: OffpayNetwork;
  recoveredAt: number | null;
  uploadedAt: number | null;
  lastUploadError?: string | null;
}): PendingBackupQueueItem {
  validateEncryptedBackupShape(params.backup);

  return {
    txId: params.backup.txId,
    walletAddress: params.walletAddress,
    network: params.network,
    ciphertext: params.backup.ciphertext,
    nonce: params.backup.nonce,
    createdAt: params.backup.createdAt,
    recoveredAt: params.recoveredAt,
    uploadedAt: params.uploadedAt,
    lastUploadError: params.lastUploadError ?? null,
    settlementStatus: 'pending',
    settlementSignature: null,
    lastSettlementError: null,
    updatedAt: Date.now(),
  };
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSettlementLifecycleCallback(callback: Promise<void> | undefined): Promise<void> {
  try {
    await callback;
  } catch {
    // Settlement must not be blocked by local nonce-state bookkeeping.
  }
}

export async function encryptPendingPaymentBackup(
  params: EnqueuePendingPaymentBackupParams,
): Promise<PendingBackupUploadBody> {
  assertSafeId(params.txId);
  assertSignedBlob(params.signedBlob);

  const createdAt = params.createdAt ?? Date.now();
  assertTimestamp(createdAt);

  const key = await deriveBackupKey({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });

  try {
    const plaintext: PendingBackupPlaintext = {
      version: PLAINTEXT_VERSION,
      domain: PLAINTEXT_DOMAIN,
      txId: params.txId,
      walletAddress: params.walletAddress,
      network: params.network,
      kind: params.kind ?? 'private-payment',
      signedBlob: params.signedBlob,
      createdAt,
      metadata: sanitizeMetadata(params.metadata),
    };

    return encryptPlaintext(plaintext, key);
  } finally {
    zeroOutBytes(key);
  }
}

export async function enqueuePendingPaymentBackup(
  params: EnqueuePendingPaymentBackupParams,
): Promise<{ item: PendingBackupQueueItem; uploaded: boolean }> {
  const backup = await encryptPendingPaymentBackup(params);
  const uploadImmediately = params.uploadImmediately ?? true;
  let uploadedAt: number | null = null;
  let lastUploadError: string | null = null;

  const item = buildQueueItem({
    backup,
    walletAddress: params.walletAddress,
    network: params.network,
    recoveredAt: null,
    uploadedAt: null,
  });

  await withQueueMutation(async () => {
    const items = await readQueue();
    await writeQueue(upsertQueueItem(items, item));
  });

  if (uploadImmediately) {
    try {
      await uploadPendingBackup(params.walletAddress, backup, params.network);
      uploadedAt = Date.now();
    } catch (error) {
      lastUploadError = getErrorMessage(error);
    }
  }

  const updated =
    (await updateQueueItem(backup.txId, (current) => ({
      ...current,
      uploadedAt,
      lastUploadError,
      updatedAt: Date.now(),
    }))) ?? item;

  return {
    item: updated,
    uploaded: uploadedAt != null,
  };
}

export async function recoverPendingBackupsToLocalQueue(params: {
  walletAddress: string;
  walletId?: string;
  network: OffpayNetwork;
  backups: PendingBackupListResponse['backups'];
}): Promise<PendingBackupRecoveryResult> {
  if (params.backups.length === 0) {
    return { recoveredCount: 0, skippedCount: 0, failedCount: 0, failureMessages: [] };
  }

  const key = await deriveBackupKey({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  let recoveredCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failures: string[] = [];

  try {
    await withQueueMutation(async () => {
      const queueItems = await readQueue();
      let nextItems = queueItems;

      for (const backup of params.backups) {
        try {
          const plaintext = decryptPlaintext(backup, key);

          if (
            plaintext.walletAddress !== params.walletAddress ||
            plaintext.network !== params.network ||
            plaintext.txId !== backup.txId
          ) {
            throw new Error('Pending backup does not belong to the active wallet and network.');
          }

          if (nextItems.some((item) => item.txId === backup.txId)) {
            skippedCount += 1;
            continue;
          }

          nextItems = upsertQueueItem(
            nextItems,
            buildQueueItem({
              backup,
              walletAddress: params.walletAddress,
              network: params.network,
              recoveredAt: Date.now(),
              uploadedAt: Date.now(),
            }),
          );
          recoveredCount += 1;
        } catch (error) {
          failedCount += 1;
          failures.push(`${backup.txId}: ${getErrorMessage(error)}`);
        }
      }

      await writeQueue(nextItems);
    });
  } finally {
    zeroOutBytes(key);
  }

  return {
    recoveredCount,
    skippedCount,
    failedCount,
    failureMessages: failures,
  };
}

export async function syncPendingBackupUploads(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<PendingBackupUploadSyncResult> {
  const items = (await readQueue()).filter(
    (item) =>
      item.walletAddress === params.walletAddress &&
      item.network === params.network &&
      item.uploadedAt == null &&
      item.settlementStatus !== 'confirmed',
  );

  let uploadedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    try {
      await uploadPendingBackup(
        params.walletAddress,
        {
          txId: item.txId,
          ciphertext: item.ciphertext,
          nonce: item.nonce,
          createdAt: item.createdAt,
        },
        params.network,
      );
      uploadedCount += 1;
      await updateQueueItem(item.txId, (current) => ({
        ...current,
        uploadedAt: Date.now(),
        lastUploadError: null,
        updatedAt: Date.now(),
      }));
    } catch (error) {
      failedCount += 1;
      await updateQueueItem(item.txId, (current) => ({
        ...current,
        lastUploadError: getErrorMessage(error),
        updatedAt: Date.now(),
      }));
    }
  }

  return { uploadedCount, failedCount };
}

export async function listLocalPendingBackups(params?: {
  walletAddress?: string;
  network?: OffpayNetwork;
}): Promise<PendingBackupQueueItem[]> {
  const items = await readQueue();
  return items.filter((item) => {
    if (params?.walletAddress != null && item.walletAddress !== params.walletAddress) return false;
    if (params?.network != null && item.network !== params.network) return false;
    return true;
  });
}

export async function getPendingBackupQueueStats(params?: {
  walletAddress?: string;
  network?: OffpayNetwork;
}): Promise<PendingBackupQueueStats> {
  const items = await listLocalPendingBackups(params);

  return {
    total: items.length,
    pending: items.filter((item) => item.settlementStatus === 'pending').length,
    uploadPending: items.filter(
      (item) => item.uploadedAt == null && item.settlementStatus !== 'confirmed',
    ).length,
    recovered: items.filter((item) => item.recoveredAt != null).length,
    confirmedAwaitingDelete: items.filter((item) => item.settlementStatus === 'confirmed').length,
    failed: items.filter((item) => item.settlementStatus === 'failed').length,
  };
}

export async function settleQueuedPendingPayments(params: {
  walletAddress: string;
  walletId?: string;
  network: OffpayNetwork;
  onOfflinePaymentSettling?: (txId: string) => Promise<void>;
  onOfflinePaymentConfirmed?: (txId: string, signature: string) => Promise<void>;
  onOfflinePaymentFailed?: (txId: string, errorMessage: string) => Promise<void>;
}): Promise<PendingBackupSettlementResult> {
  const items = (await readQueue()).filter(
    (item) =>
      item.walletAddress === params.walletAddress &&
      item.network === params.network &&
      item.settlementStatus !== 'confirmed',
  );

  if (items.length === 0) {
    return {
      submittedCount: 0,
      confirmedCount: 0,
      failedCount: 0,
      deleteFailedCount: 0,
      batches: [],
      submittedTxIds: [],
      confirmedTxIds: [],
      failedTxIds: [],
    };
  }

  const key = await deriveBackupKey({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  const signedBlobsByTxId = new Map<string, string>();

  try {
    for (const item of items) {
      try {
        const plaintext = decryptPlaintext(
          {
            txId: item.txId,
            ciphertext: item.ciphertext,
            nonce: item.nonce,
            createdAt: item.createdAt,
          },
          key,
        );

        if (
          plaintext.walletAddress !== params.walletAddress ||
          plaintext.network !== params.network
        ) {
          throw new Error('Queued backup does not match the settlement wallet and network.');
        }

        signedBlobsByTxId.set(item.txId, plaintext.signedBlob);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        await runSettlementLifecycleCallback(
          params.onOfflinePaymentFailed?.(item.txId, errorMessage),
        );
        await updateQueueItem(item.txId, (current) => ({
          ...current,
          settlementStatus: 'failed',
          lastSettlementError: errorMessage,
          updatedAt: Date.now(),
        }));
      }
    }
  } finally {
    zeroOutBytes(key);
  }

  const validEntries = items
    .map((item) => ({ item, signedBlob: signedBlobsByTxId.get(item.txId) }))
    .filter((entry): entry is { item: PendingBackupQueueItem; signedBlob: string } => {
      return entry.signedBlob != null;
    });

  let submittedCount = 0;
  let confirmedCount = 0;
  let failedCount = items.length - validEntries.length;
  let deleteFailedCount = 0;
  const batches: PaymentSettleResponse[] = [];
  const submittedTxIds: string[] = [];
  const confirmedTxIds: string[] = [];
  const failedTxIds: string[] = [];

  const chunks = chunkItems(validEntries, SETTLEMENT_BATCH_SIZE);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? [];
    await Promise.all(
      chunk.map(async (entry) => {
        await runSettlementLifecycleCallback(params.onOfflinePaymentSettling?.(entry.item.txId));
      }),
    );
    const response = await settlePrivatePayments({
      signedBlobs: chunk.map((entry) => entry.signedBlob),
      network: params.network,
    });
    batches.push(response);
    submittedCount += chunk.length;
    submittedTxIds.push(...chunk.map((entry) => entry.item.txId));

    for (let resultIndex = 0; resultIndex < response.results.length; resultIndex += 1) {
      const result = response.results[resultIndex];
      const txId = chunk[resultIndex]?.item.txId;

      if (txId == null || result == null) continue;

      const signature =
        normalizeSettlementSignature(result.signature) ??
        getSignedBlobPrimarySignature(chunk[resultIndex]?.signedBlob ?? '');
      let signatureState: 'confirmed' | 'failed' | 'unknown' =
        result.status === 'confirmed' && signature != null ? 'confirmed' : 'unknown';

      if (result.status === 'failed' && signature != null) {
        signatureState = await getSettlementSignatureState({
          signature,
          network: params.network,
        });
      }

      if (signatureState === 'confirmed' && signature != null) {
        await runSettlementLifecycleCallback(
          params.onOfflinePaymentConfirmed?.(txId, signature),
        );
        try {
          await deletePendingBackup(params.walletAddress, txId, params.network);
          await updateQueueItem(txId, () => null);
          confirmedCount += 1;
          confirmedTxIds.push(txId);
        } catch (error) {
          deleteFailedCount += 1;
          confirmedTxIds.push(txId);
          await updateQueueItem(txId, (current) => ({
            ...current,
            settlementStatus: 'confirmed',
            settlementSignature: signature,
            lastSettlementError: `Confirmed, but backup delete failed: ${getErrorMessage(error)}`,
            updatedAt: Date.now(),
          }));
        }
      } else if (result.status === 'failed' && signature != null && signatureState === 'unknown') {
        failedCount += 1;
        failedTxIds.push(txId);
        await updateQueueItem(txId, (current) => ({
          ...current,
          settlementStatus: 'pending',
          settlementSignature: signature,
          lastSettlementError: 'Waiting for on-chain confirmation.',
          updatedAt: Date.now(),
        }));
      } else {
        failedCount += 1;
        failedTxIds.push(txId);
        const errorMessage =
          result.status === 'confirmed'
            ? 'Settlement confirmed without a transaction signature.'
            : 'Settlement failed.';
        await runSettlementLifecycleCallback(
          params.onOfflinePaymentFailed?.(txId, errorMessage),
        );
        await updateQueueItem(txId, (current) => ({
          ...current,
          settlementStatus: 'failed',
          settlementSignature: signature,
          lastSettlementError: errorMessage,
          updatedAt: Date.now(),
        }));
      }
    }

    if (index < chunks.length - 1) {
      await delay(SETTLEMENT_BATCH_DELAY_MS);
    }
  }

  return {
    submittedCount,
    confirmedCount,
    failedCount,
    deleteFailedCount,
    batches,
    submittedTxIds,
    confirmedTxIds,
    failedTxIds,
  };
}

export async function deleteLocalPendingBackup(txId: string): Promise<void> {
  assertSafeId(txId);
  await updateQueueItem(txId, () => null);
}

export async function cleanupConfirmedPendingBackups(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<PendingBackupCleanupResult> {
  const items = (await readQueue()).filter(
    (item) =>
      item.walletAddress === params.walletAddress &&
      item.network === params.network &&
      item.settlementStatus === 'confirmed',
  );

  let deletedCount = 0;
  let failedCount = 0;

  for (const item of items) {
    try {
      await deletePendingBackup(params.walletAddress, item.txId, params.network);
      await updateQueueItem(item.txId, () => null);
      deletedCount += 1;
    } catch (error) {
      failedCount += 1;
      await updateQueueItem(item.txId, (current) => ({
        ...current,
        lastSettlementError: `Confirmed, but backup delete retry failed: ${getErrorMessage(error)}`,
        updatedAt: Date.now(),
      }));
    }
  }

  return { deletedCount, failedCount };
}
