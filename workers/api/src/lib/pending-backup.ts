import { AppError } from './errors.js';
import { hmacSha256Hex } from './auth.js';
import type { Bindings, Network, R2Bucket } from './types.js';

const PENDING_BACKUP_TTL_MS = 72 * 60 * 60 * 1000;
const PENDING_BACKUP_LIST_LIMIT = 1000;

interface PendingBackupRecord {
  txId: string;
  ciphertext: string;
  nonce: string;
  createdAt: number;
}

interface StoredPendingBackupRecord extends PendingBackupRecord {
  walletAddress: string;
  metadataHmac: string;
  metadataVersion?: 1 | 2;
  network?: Network;
}

interface PendingBackupObjectReference {
  pathname: string;
  uploadedAt: number;
}

type PendingBackupBlobReference = PendingBackupObjectReference;

interface PendingBackupStore {
  delete(pathname: string): Promise<void>;
  get(pathname: string): Promise<string | null>;
  list(prefix: string): Promise<PendingBackupObjectReference[]>;
  put(pathname: string, body: string): Promise<void>;
}

type PendingBackupStoreFactory = (bindings: Bindings) => PendingBackupStore;

let pendingBackupStoreFactory: PendingBackupStoreFactory = createPendingBackupStore;

function getRequiredBinding(bindings: Bindings, key: keyof Bindings): string {
  const rawValue = bindings[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return value;
}

function getPendingBackupBucket(bindings: Bindings): R2Bucket {
  const bucket = bindings.PENDING_BACKUP_BUCKET;
  if (bucket == null) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return bucket;
}

function toObjectStorageError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Backup storage is temporarily unavailable.',
    retryable: true,
    cause: error,
  });
}

function buildPendingBackupPath(walletAddress: string, txId: string, network?: Network): string {
  return `${buildPendingBackupPrefix(walletAddress, network)}${txId}`;
}

function buildPendingBackupPrefix(walletAddress: string, network?: Network): string {
  if (network) {
    return `pending/v2/${walletAddress}/${network}/`;
  }

  return `pending/${walletAddress}/`;
}

function isExpiredPendingBackup(timestampMs: number, now = Date.now()): boolean {
  return timestampMs <= 0 || timestampMs < now - PENDING_BACKUP_TTL_MS;
}

async function computeLegacyPendingBackupMetadataHmac(
  backupSecret: string,
  walletAddress: string,
  txId: string,
  createdAt: number,
): Promise<string> {
  return hmacSha256Hex(backupSecret, `${walletAddress}:${txId}:${createdAt}`);
}

async function computePendingBackupMetadataHmacV2(
  backupSecret: string,
  walletAddress: string,
  network: Network,
  txId: string,
  createdAt: number,
  ciphertext: string,
  nonce: string,
): Promise<string> {
  return hmacSha256Hex(
    backupSecret,
    `${walletAddress}:${network}:${txId}:${createdAt}:${ciphertext}:${nonce}`,
  );
}

function createPendingBackupStore(bindings: Bindings): PendingBackupStore {
  const bucket = getPendingBackupBucket(bindings);

  return {
    async delete(pathname) {
      try {
        await bucket.delete(pathname);
      } catch (error) {
        throw toObjectStorageError(error);
      }
    },
    async get(pathname) {
      try {
        const object = await bucket.get(pathname);
        return object == null ? null : object.text();
      } catch (error) {
        throw toObjectStorageError(error);
      }
    },
    async list(prefix) {
      try {
        const objects: PendingBackupObjectReference[] = [];
        let cursor: string | undefined;

        do {
          const page = await bucket.list({
            limit: PENDING_BACKUP_LIST_LIMIT,
            prefix,
            ...(cursor ? { cursor } : {}),
          });

          page.objects.forEach((object) => {
            objects.push({
              pathname: object.key,
              uploadedAt: object.uploaded.getTime(),
            });
          });

          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);

        return objects;
      } catch (error) {
        throw toObjectStorageError(error);
      }
    },
    async put(pathname, body) {
      try {
        await bucket.put(pathname, body, {
          httpMetadata: {
            contentType: 'application/json; charset=utf-8',
          },
        });
      } catch (error) {
        throw toObjectStorageError(error);
      }
    },
  };
}

function parseStoredPendingBackupRecord(rawValue: string): StoredPendingBackupRecord | null {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (typeof parsedValue !== 'object' || parsedValue === null || Array.isArray(parsedValue)) {
    return null;
  }

  const candidate = parsedValue as Partial<StoredPendingBackupRecord>;
  const createdAt = candidate.createdAt;
  if (
    typeof candidate.walletAddress !== 'string' ||
    typeof candidate.txId !== 'string' ||
    typeof candidate.ciphertext !== 'string' ||
    typeof candidate.nonce !== 'string' ||
    typeof createdAt !== 'number' ||
    !Number.isInteger(createdAt) ||
    createdAt <= 0 ||
    typeof candidate.metadataHmac !== 'string'
  ) {
    return null;
  }

  if (
    candidate.metadataVersion !== undefined &&
    candidate.metadataVersion !== 1 &&
    candidate.metadataVersion !== 2
  ) {
    return null;
  }

  if (candidate.network !== undefined && candidate.network !== 'devnet' && candidate.network !== 'mainnet') {
    return null;
  }

  return candidate as StoredPendingBackupRecord;
}

async function pruneExpiredPendingBackups(
  store: PendingBackupStore,
  blobs: readonly PendingBackupBlobReference[],
): Promise<PendingBackupBlobReference[]> {
  const activeBlobs: PendingBackupBlobReference[] = [];

  for (const blob of blobs) {
    // Retention is enforced from Blob upload time rather than client-supplied
    // createdAt, so clients cannot extend backup lifetime by backdating data.
    if (isExpiredPendingBackup(blob.uploadedAt)) {
      await store.delete(blob.pathname);
      continue;
    }

    activeBlobs.push(blob);
  }

  return activeBlobs;
}

async function storePendingBackup(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
  backup: PendingBackupRecord,
): Promise<void> {
  const metadataHmac = await computePendingBackupMetadataHmacV2(
    getRequiredBinding(bindings, 'OFFPAY_BACKUP_HMAC_SECRET'),
    walletAddress,
    network,
    backup.txId,
    backup.createdAt,
    backup.ciphertext,
    backup.nonce,
  );

  const store = pendingBackupStoreFactory(bindings);
  const [networkScopedBlobs, legacyBlobs] = await Promise.all([
    store.list(buildPendingBackupPrefix(walletAddress, network)),
    store.list(buildPendingBackupPrefix(walletAddress)),
  ]);
  await Promise.all([
    pruneExpiredPendingBackups(store, networkScopedBlobs),
    pruneExpiredPendingBackups(store, legacyBlobs),
  ]);

  const storedRecord: StoredPendingBackupRecord = {
    ...backup,
    walletAddress,
    metadataHmac,
    metadataVersion: 2,
    network,
  };

  await store.put(buildPendingBackupPath(walletAddress, backup.txId, network), JSON.stringify(storedRecord));
}

async function listPendingBackups(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
): Promise<PendingBackupRecord[]> {
  const backupSecret = getRequiredBinding(bindings, 'OFFPAY_BACKUP_HMAC_SECRET');
  const store = pendingBackupStoreFactory(bindings);
  const [networkScopedListedBlobs, legacyListedBlobs] = await Promise.all([
    store.list(buildPendingBackupPrefix(walletAddress, network)),
    store.list(buildPendingBackupPrefix(walletAddress)),
  ]);
  const [networkScopedBlobs, legacyBlobs] = await Promise.all([
    pruneExpiredPendingBackups(store, networkScopedListedBlobs),
    pruneExpiredPendingBackups(store, legacyListedBlobs),
  ]);
  const blobs = [...networkScopedBlobs, ...legacyBlobs];
  const backups: PendingBackupRecord[] = [];
  const seenPaths = new Set<string>();
  const seenTxIds = new Set<string>();

  for (const blob of blobs) {
    if (seenPaths.has(blob.pathname)) {
      continue;
    }
    seenPaths.add(blob.pathname);

    const rawValue = await store.get(blob.pathname);
    if (!rawValue) {
      continue;
    }

    const storedRecord = parseStoredPendingBackupRecord(rawValue);
    if (!storedRecord) {
      await store.delete(blob.pathname);
      continue;
    }

    const metadataVersion = storedRecord.metadataVersion ?? 1;
    if (storedRecord.walletAddress !== walletAddress) {
      await store.delete(blob.pathname);
      continue;
    }

    let expectedHmac: string;
    if (metadataVersion === 2) {
      if (
        storedRecord.network !== network ||
        blob.pathname !== buildPendingBackupPath(walletAddress, storedRecord.txId, network)
      ) {
        await store.delete(blob.pathname);
        continue;
      }

      expectedHmac = await computePendingBackupMetadataHmacV2(
        backupSecret,
        storedRecord.walletAddress,
        storedRecord.network,
        storedRecord.txId,
        storedRecord.createdAt,
        storedRecord.ciphertext,
        storedRecord.nonce,
      );
    } else {
      if (blob.pathname !== buildPendingBackupPath(walletAddress, storedRecord.txId)) {
        await store.delete(blob.pathname);
        continue;
      }

      expectedHmac = await computeLegacyPendingBackupMetadataHmac(
        backupSecret,
        storedRecord.walletAddress,
        storedRecord.txId,
        storedRecord.createdAt,
      );
    }

    if (storedRecord.metadataHmac !== expectedHmac) {
      await store.delete(blob.pathname);
      continue;
    }

    if (seenTxIds.has(storedRecord.txId)) {
      continue;
    }
    seenTxIds.add(storedRecord.txId);

    backups.push({
      txId: storedRecord.txId,
      ciphertext: storedRecord.ciphertext,
      nonce: storedRecord.nonce,
      createdAt: storedRecord.createdAt,
    });
  }

  backups.sort((left, right) => left.createdAt - right.createdAt);
  return backups;
}

async function deletePendingBackup(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
  txId: string,
): Promise<void> {
  const store = pendingBackupStoreFactory(bindings);
  await Promise.all([
    store.delete(buildPendingBackupPath(walletAddress, txId, network)),
    store.delete(buildPendingBackupPath(walletAddress, txId)),
  ]);
}

function setPendingBackupStoreFactory(factory: PendingBackupStoreFactory): void {
  pendingBackupStoreFactory = factory;
}

function resetPendingBackupStoreFactory(): void {
  pendingBackupStoreFactory = createPendingBackupStore;
}

export {
  PENDING_BACKUP_TTL_MS,
  buildPendingBackupPath,
  deletePendingBackup,
  isExpiredPendingBackup,
  listPendingBackups,
  resetPendingBackupStoreFactory,
  setPendingBackupStoreFactory,
  storePendingBackup,
  type PendingBackupBlobReference,
  type PendingBackupObjectReference,
  type PendingBackupRecord,
  type PendingBackupStore,
  type PendingBackupStoreFactory,
  type StoredPendingBackupRecord,
};
