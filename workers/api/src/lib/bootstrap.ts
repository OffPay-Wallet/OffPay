import { verifyAsync as verifyEd25519 } from '@noble/ed25519';
import bs58 from 'bs58';
import { AppError } from './errors.js';
import type { Bindings } from './types.js';
import { isValidEd25519Signature, isValidSolanaAddress } from './validation.js';

const BOOTSTRAP_NONCE_KEY_PREFIX = 'bootstrap:nonce:v1:';
const BOOTSTRAP_NONCE_TTL_SEC = 120;
const BOOTSTRAP_NONCE_TTL_MS = BOOTSTRAP_NONCE_TTL_SEC * 1000;

interface BootstrapNonceRecord {
  walletAddress: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
}

interface BootstrapNonceStore {
  store(nonce: string, record: BootstrapNonceRecord, ttlSec: number): Promise<void>;
  consume(nonce: string): Promise<BootstrapNonceRecord | null>;
}

type BootstrapNonceStoreFactory = (bindings: Bindings) => BootstrapNonceStore;

let nonceStoreFactory: BootstrapNonceStoreFactory = createBootstrapNonceStore;

function createKvEndpoint(bindings: Bindings): string {
  const endpoint = bindings.KV_REST_API_URL?.trim();
  if (!endpoint) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return endpoint.replace(/\/$/, '');
}

function getRequiredKvToken(bindings: Bindings): string {
  const token = bindings.KV_REST_API_TOKEN?.trim();
  if (!token) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return token;
}

async function runKvPipeline(
  bindings: Bindings,
  commands: ReadonlyArray<ReadonlyArray<string | number>>,
): Promise<unknown[]> {
  const response = await fetch(`${createKvEndpoint(bindings)}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getRequiredKvToken(bindings)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  const erroredEntry = payload.find((entry) => typeof entry.error === 'string');
  if (erroredEntry) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return payload.map((entry) => entry.result ?? null);
}

function buildNonceStorageKey(nonce: string): string {
  return `${BOOTSTRAP_NONCE_KEY_PREFIX}${nonce}`;
}

function createBootstrapNonceStore(bindings: Bindings): BootstrapNonceStore {
  return {
    async store(nonce, record, ttlSec) {
      await runKvPipeline(bindings, [
        ['SET', buildNonceStorageKey(nonce), JSON.stringify(record), 'EX', ttlSec],
      ]);
    },
    async consume(nonce) {
      const [storedValue] = await runKvPipeline(bindings, [
        ['GETDEL', buildNonceStorageKey(nonce)],
      ]);

      if (typeof storedValue !== 'string' || storedValue.length === 0) {
        return null;
      }

      let parsedRecord: unknown;
      try {
        parsedRecord = JSON.parse(storedValue);
      } catch (error) {
        throw new AppError({
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Required backend configuration is unavailable.',
          retryable: true,
          cause: error,
        });
      }

      if (
        typeof parsedRecord !== 'object' ||
        parsedRecord === null ||
        typeof (parsedRecord as Partial<BootstrapNonceRecord>).walletAddress !== 'string' ||
        typeof (parsedRecord as Partial<BootstrapNonceRecord>).deviceId !== 'string' ||
        typeof (parsedRecord as Partial<BootstrapNonceRecord>).issuedAt !== 'number' ||
        typeof (parsedRecord as Partial<BootstrapNonceRecord>).expiresAt !== 'number'
      ) {
        throw new AppError({
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Required backend configuration is unavailable.',
          retryable: true,
        });
      }

      return parsedRecord as BootstrapNonceRecord;
    },
  };
}

function createBootstrapNonceRecord(walletAddress: string, deviceId: string): BootstrapNonceRecord {
  const issuedAt = Date.now();

  return {
    walletAddress,
    deviceId,
    issuedAt,
    expiresAt: issuedAt + BOOTSTRAP_NONCE_TTL_MS,
  };
}

async function issueBootstrapNonce(
  bindings: Bindings,
  walletAddress: string,
  deviceId: string,
): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = crypto.randomUUID();
  const record = createBootstrapNonceRecord(walletAddress, deviceId);
  const store = nonceStoreFactory(bindings);

  await store.store(nonce, record, BOOTSTRAP_NONCE_TTL_SEC);

  return {
    nonce,
    expiresAt: record.expiresAt,
  };
}

async function consumeBootstrapNonce(
  bindings: Bindings,
  nonce: string,
): Promise<BootstrapNonceRecord | null> {
  const store = nonceStoreFactory(bindings);
  const record = await store.consume(nonce);

  if (!record) {
    return null;
  }

  if (record.expiresAt <= Date.now()) {
    return null;
  }

  return record;
}

async function verifyBootstrapWalletSignature(
  walletAddress: string,
  nonce: string,
  signature: string,
): Promise<boolean> {
  if (!isValidSolanaAddress(walletAddress) || !isValidEd25519Signature(signature)) {
    return false;
  }

  try {
    return await verifyEd25519(
      bs58.decode(signature),
      new TextEncoder().encode(nonce),
      bs58.decode(walletAddress),
    );
  } catch {
    return false;
  }
}

function resolveClientIp(request: Request): string {
  const candidates = [
    request.headers.get('CF-Connecting-IP'),
    request.headers.get('X-Real-IP'),
    request.headers.get('X-Forwarded-For')?.split(',')[0] ?? null,
  ];

  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return 'unknown';
}

function setBootstrapNonceStoreFactory(factory: BootstrapNonceStoreFactory): void {
  nonceStoreFactory = factory;
}

function resetBootstrapNonceStoreFactory(): void {
  nonceStoreFactory = createBootstrapNonceStore;
}

export {
  BOOTSTRAP_NONCE_TTL_MS,
  BOOTSTRAP_NONCE_TTL_SEC,
  consumeBootstrapNonce,
  issueBootstrapNonce,
  resetBootstrapNonceStoreFactory,
  resolveClientIp,
  setBootstrapNonceStoreFactory,
  verifyBootstrapWalletSignature,
  type BootstrapNonceRecord,
  type BootstrapNonceStore,
  type BootstrapNonceStoreFactory,
};
