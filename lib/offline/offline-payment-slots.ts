import { Buffer } from 'buffer';

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  broadcastRawTransaction,
  getOfflineNoncePoolStatus,
  getOfflineRentEstimate,
  getRpcLatestBlockhash,
  getRpcSignatureStatuses,
  prepareOfflineNonceAdvance,
  prepareOfflineNoncePool,
} from '@/lib/api/offpay-api-client';
import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
import {
  OFFLINE_PAYMENT_SLOT_DEFAULT,
  clampOfflinePaymentSlotCount,
} from '@/constants/offline-payment-slots';
import {
  deletePersistedJson,
  readPersistedJson,
  writePersistedJson,
} from '@/lib/cache/persistent-json-cache';
import {
  signSerializedTransactionForWallet,
  signSerializedTransactionsForWallet,
  signSerializedTransactionWithSeedAsync,
} from '@/lib/crypto/solana-transaction-signing';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { yieldToEventLoop, yieldToUi, yieldToUiIfNeeded } from '@/lib/perf/ui-work-scheduler';

import type {
  OfflineNoncePoolStatusResponse,
  OfflineRentEstimateResponse,
  OffpayNetwork,
} from '@/types/offpay-api';

const SLOT_INDEX_KEY_PREFIX = 'offpay_offline_slots_index_v1';
const SLOT_RECORD_KEY_PREFIX = 'offpay_offline_slot_v1';
const SLOT_VERSION = 1;
const CONFIRMATION_ATTEMPTS = 6;
const CONFIRMATION_DELAY_MS = 1200;
const PREPARING_SLOT_GRACE_MS = 10 * 60 * 1000;
const LAMPORTS_PER_SOL = 1_000_000_000n;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const RECENT_BLOCKHASHES_SYSVAR_ID = 'SysvarRecentB1ockHashes11111111111111111111';
const RENT_SYSVAR_ID = 'SysvarRent111111111111111111111111111111111';
const WITHDRAW_NONCE_ACCOUNT_INSTRUCTION = 5;

export type OfflinePaymentSlotStatus =
  | 'ready'
  | 'locked'
  | 'queued'
  | 'settling'
  | 'settled'
  | 'stale'
  | 'preparing'
  | 'closing'
  | 'closed'
  | 'error';

interface OfflinePaymentSlotIndex {
  version: 1;
  walletAddress: string;
  network: OffpayNetwork;
  targetSlotCount: number;
  nonceAccounts: string[];
  updatedAt: number;
}

export interface OfflinePaymentSlotRecord {
  version: 1;
  walletAddress: string;
  network: OffpayNetwork;
  nonceAccount: string;
  nonceAuthority: string;
  nonceValue: string | null;
  status: OfflinePaymentSlotStatus;
  lamports: string | null;
  rentExempt: boolean | null;
  checkedAt: number | null;
  updatedAt: number;
  lockedTxId: string | null;
  pendingSignature: string | null;
  errorMessage: string | null;
}

export interface OfflinePaymentSlotSnapshot {
  walletAddress: string;
  network: OffpayNetwork;
  targetSlotCount: number;
  slots: OfflinePaymentSlotRecord[];
  counts: {
    ready: number;
    locked: number;
    queued: number;
    settling: number;
    stale: number;
    preparing: number;
    closing: number;
    closed: number;
    error: number;
    needsRefill: number;
  };
  updatedAt: number;
}

export interface OfflinePaymentSlotPreparationResult {
  snapshot: OfflinePaymentSlotSnapshot;
  preparedCount: number;
  signatures: string[];
  rentEstimate: OfflineRentEstimateResponse | null;
}

export type OfflineSlotSpendAuthorization = 'user-confirmed';
export type OfflineSlotReclaimAuthorization = 'user-confirmed';

export interface OfflinePaymentSlotReclaimResult {
  snapshot: OfflinePaymentSlotSnapshot;
  closedCount: number;
  reclaimedLamports: string;
  reclaimedSol: string;
  signatures: string[];
}

interface GeneratedNonceAccount {
  nonceAccount: string;
  signingSeed: Uint8Array;
}

function safeKeyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function clampSlotCount(value: number): number {
  return clampOfflinePaymentSlotCount(value);
}

function indexKey(walletAddress: string, network: OffpayNetwork): string {
  return `${SLOT_INDEX_KEY_PREFIX}_${safeKeyPart(network)}_${safeKeyPart(walletAddress)}`;
}

function recordKey(walletAddress: string, network: OffpayNetwork, nonceAccount: string): string {
  return `${SLOT_RECORD_KEY_PREFIX}_${safeKeyPart(network)}_${safeKeyPart(walletAddress)}_${safeKeyPart(
    nonceAccount,
  )}`;
}

function assertWallet(value: string, label: string): string {
  const normalized = value.trim();
  if (!isValidSolanaAddress(normalized)) {
    throw new Error(`${label} must be a valid Solana public key.`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSlotStatus(value: unknown): OfflinePaymentSlotStatus | null {
  if (
    value === 'ready' ||
    value === 'locked' ||
    value === 'queued' ||
    value === 'settling' ||
    value === 'settled' ||
    value === 'stale' ||
    value === 'preparing' ||
    value === 'closing' ||
    value === 'closed' ||
    value === 'error'
  ) {
    return value;
  }
  return null;
}

function normalizeIndex(
  walletAddress: string,
  network: OffpayNetwork,
  value: unknown,
): OfflinePaymentSlotIndex | null {
  if (!isRecord(value) || value.version !== SLOT_VERSION || value.network !== network) {
    return null;
  }
  if (
    value.walletAddress !== walletAddress ||
    typeof value.targetSlotCount !== 'number' ||
    !Array.isArray(value.nonceAccounts)
  ) {
    return null;
  }

  return {
    version: SLOT_VERSION,
    walletAddress,
    network,
    targetSlotCount: clampSlotCount(value.targetSlotCount),
    nonceAccounts: value.nonceAccounts.filter(
      (account): account is string => typeof account === 'string' && isValidSolanaAddress(account),
    ),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

function normalizeSlotRecord(value: unknown): OfflinePaymentSlotRecord | null {
  if (!isRecord(value) || value.version !== SLOT_VERSION) return null;
  const status = normalizeSlotStatus(value.status);
  if (status == null) return null;
  if (
    typeof value.walletAddress !== 'string' ||
    typeof value.nonceAccount !== 'string' ||
    typeof value.nonceAuthority !== 'string' ||
    (value.network !== 'mainnet' && value.network !== 'devnet')
  ) {
    return null;
  }

  try {
    return {
      version: SLOT_VERSION,
      walletAddress: assertWallet(value.walletAddress, 'Wallet address'),
      network: value.network,
      nonceAccount: assertWallet(value.nonceAccount, 'Nonce account'),
      nonceAuthority: assertWallet(value.nonceAuthority, 'Nonce authority'),
      nonceValue: typeof value.nonceValue === 'string' ? value.nonceValue : null,
      status,
      lamports: typeof value.lamports === 'string' ? value.lamports : null,
      rentExempt: typeof value.rentExempt === 'boolean' ? value.rentExempt : null,
      checkedAt: typeof value.checkedAt === 'number' ? value.checkedAt : null,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
      lockedTxId: typeof value.lockedTxId === 'string' ? value.lockedTxId : null,
      pendingSignature: typeof value.pendingSignature === 'string' ? value.pendingSignature : null,
      errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : null,
    };
  } catch {
    return null;
  }
}

async function loadIndex(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<OfflinePaymentSlotIndex> {
  const walletAddress = assertWallet(params.walletAddress, 'Wallet address');
  return (
    (await readPersistedJson(indexKey(walletAddress, params.network), (value) =>
      normalizeIndex(walletAddress, params.network, value),
    )) ?? {
      version: SLOT_VERSION,
      walletAddress,
      network: params.network,
      targetSlotCount: OFFLINE_PAYMENT_SLOT_DEFAULT,
      nonceAccounts: [],
      updatedAt: Date.now(),
    }
  );
}

async function saveIndex(index: OfflinePaymentSlotIndex): Promise<void> {
  await writePersistedJson(indexKey(index.walletAddress, index.network), index);
}

async function loadSlot(params: {
  walletAddress: string;
  network: OffpayNetwork;
  nonceAccount: string;
}): Promise<OfflinePaymentSlotRecord | null> {
  return readPersistedJson(
    recordKey(params.walletAddress, params.network, params.nonceAccount),
    normalizeSlotRecord,
  );
}

async function saveSlot(slot: OfflinePaymentSlotRecord): Promise<OfflinePaymentSlotRecord> {
  await writePersistedJson(recordKey(slot.walletAddress, slot.network, slot.nonceAccount), slot);
  return slot;
}

export async function clearOfflinePaymentSlotCache(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<void> {
  const walletAddress = assertWallet(params.walletAddress, 'Wallet address');
  const index = await readPersistedJson(indexKey(walletAddress, params.network), (value) =>
    normalizeIndex(walletAddress, params.network, value),
  );
  await Promise.allSettled(
    index?.nonceAccounts.map((nonceAccount) =>
      deletePersistedJson(recordKey(walletAddress, params.network, nonceAccount)),
    ) ?? [],
  );
  await deletePersistedJson(indexKey(walletAddress, params.network));
}

function computeCounts(slots: OfflinePaymentSlotRecord[], targetSlotCount: number) {
  const counts = {
    ready: 0,
    locked: 0,
    queued: 0,
    settling: 0,
    stale: 0,
    preparing: 0,
    closing: 0,
    closed: 0,
    error: 0,
    needsRefill: 0,
  };

  for (const slot of slots) {
    if (slot.status in counts) {
      counts[slot.status as keyof typeof counts] += 1;
    }
  }

  const activeCount =
    counts.ready +
    counts.locked +
    counts.queued +
    counts.settling +
    counts.preparing +
    counts.closing;
  counts.needsRefill = Math.max(0, targetSlotCount - activeCount);
  return counts;
}

export async function loadOfflinePaymentSlotSnapshot(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<OfflinePaymentSlotSnapshot> {
  const index = await loadIndex(params);
  const slots = (
    await Promise.all(
      index.nonceAccounts.map((nonceAccount) =>
        loadSlot({
          walletAddress: index.walletAddress,
          network: index.network,
          nonceAccount,
        }),
      ),
    )
  ).filter((slot): slot is OfflinePaymentSlotRecord => slot != null);
  await yieldToEventLoop();

  return {
    walletAddress: index.walletAddress,
    network: index.network,
    targetSlotCount: index.targetSlotCount,
    slots: slots.sort((left, right) => left.updatedAt - right.updatedAt),
    counts: computeCounts(slots, index.targetSlotCount),
    updatedAt: index.updatedAt,
  };
}

async function upsertSlots(params: {
  walletAddress: string;
  network: OffpayNetwork;
  targetSlotCount?: number;
  slots: OfflinePaymentSlotRecord[];
}): Promise<OfflinePaymentSlotSnapshot> {
  const index = await loadIndex(params);
  const nonceAccounts = new Set(index.nonceAccounts);
  for (const slot of params.slots) {
    nonceAccounts.add(slot.nonceAccount);
    await saveSlot(slot);
    await yieldToEventLoop();
  }

  await yieldToUi();
  await saveIndex({
    ...index,
    targetSlotCount: clampSlotCount(params.targetSlotCount ?? index.targetSlotCount),
    nonceAccounts: Array.from(nonceAccounts),
    updatedAt: Date.now(),
  });

  return loadOfflinePaymentSlotSnapshot(params);
}

function mapBackendSlotStatus(
  state: OfflineNoncePoolStatusResponse['slots'][number]['state'],
): OfflinePaymentSlotStatus {
  if (state === 'ready') return 'ready';
  if (state === 'locked') return 'locked';
  if (state === 'settling') return 'settling';
  if (state === 'stale') return 'stale';
  return 'error';
}

export async function syncOfflinePaymentSlotsFromBackendStatus(
  status: OfflineNoncePoolStatusResponse,
): Promise<OfflinePaymentSlotSnapshot> {
  const local = await loadOfflinePaymentSlotSnapshot({
    walletAddress: status.walletAddress,
    network: status.network,
  });
  const localByAccount = new Map(local.slots.map((slot) => [slot.nonceAccount, slot]));
  const now = Date.now();
  const backendAccounts = new Set(status.slots.map((slot) => slot.nonceAccount));
  const slots: OfflinePaymentSlotRecord[] = [];
  let budgetStartedAt = Date.now();
  for (const backendSlot of status.slots) {
    const current = localByAccount.get(backendSlot.nonceAccount);
    const backendStatus = mapBackendSlotStatus(backendSlot.state);
    const freshPreparing =
      current?.status === 'preparing' && now - current.updatedAt < PREPARING_SLOT_GRACE_MS;
    const localPending =
      (freshPreparing && backendStatus !== 'ready') ||
      current?.status === 'locked' ||
      current?.status === 'queued' ||
      (current?.status === 'settling' &&
        (current.lockedTxId != null || backendStatus !== 'ready')) ||
      current?.status === 'closing' ||
      current?.status === 'closed';

    slots.push({
      version: SLOT_VERSION,
      walletAddress: status.walletAddress,
      network: status.network,
      nonceAccount: backendSlot.nonceAccount,
      nonceAuthority: backendSlot.authority,
      nonceValue: backendSlot.nonceValue,
      status: localPending ? current.status : backendStatus,
      lamports: backendSlot.lamports,
      rentExempt: backendSlot.rentExempt,
      checkedAt: backendSlot.checkedAt,
      updatedAt: now,
      lockedTxId: current?.lockedTxId ?? null,
      pendingSignature: current?.pendingSignature ?? null,
      errorMessage: current?.errorMessage ?? null,
    });
    budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
  }
  for (const current of local.slots) {
    if (backendAccounts.has(current.nonceAccount)) continue;
    if (current.status !== 'preparing') continue;
    if (now - current.updatedAt < PREPARING_SLOT_GRACE_MS) continue;

    slots.push({
      ...current,
      status: 'error',
      updatedAt: now,
      errorMessage: 'Offline slot preparation did not reach provider status.',
    });
  }

  return upsertSlots({
    walletAddress: status.walletAddress,
    network: status.network,
    targetSlotCount: status.targetSlotCount,
    slots,
  });
}

export async function refreshOfflinePaymentSlotsFromBackendStatus(params: {
  walletAddress: string;
  network: OffpayNetwork;
  targetSlotCount: number;
}): Promise<OfflinePaymentSlotSnapshot> {
  const local = await loadOfflinePaymentSlotSnapshot(params);
  const nonceAccounts = local.slots.map((slot) => slot.nonceAccount);
  const status = await getOfflineNoncePoolStatus({
    ...params,
    nonceAccounts,
  });
  return syncOfflinePaymentSlotsFromBackendStatus(status);
}

export async function getOfflinePaymentSlotRentEstimate(params: {
  walletAddress: string;
  network: OffpayNetwork;
  slotCount: number;
}): Promise<OfflineRentEstimateResponse> {
  return getOfflineRentEstimate({
    walletAddress: params.walletAddress,
    network: params.network,
    slotCount: clampSlotCount(params.slotCount),
  });
}

function generateNonceAccount(): GeneratedNonceAccount {
  const signingSeed = new Uint8Array(32);
  crypto.getRandomValues(signingSeed);
  const publicKey = ed25519.getPublicKey(signingSeed);
  try {
    return {
      nonceAccount: bs58.encode(publicKey),
      signingSeed,
    };
  } finally {
    zeroOutBytes(publicKey);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeShortVecLength(length: number): number[] {
  const bytes: number[] = [];
  let value = length;

  do {
    let byte = value & 0x7f;
    value >>= 7;
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);

  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function compactArray(items: Uint8Array[]): Uint8Array {
  return concatBytes([Uint8Array.from(encodeShortVecLength(items.length)), ...items]);
}

function publicKeyBytes(value: string, label: string): Uint8Array {
  const bytes = bs58.decode(assertWallet(value, label));
  if (bytes.length !== 32) {
    throw new Error(`${label} must be a valid Solana public key.`);
  }

  return bytes;
}

function u32ToLittleEndian(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function u64ToLittleEndian(value: bigint): number[] {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error('Lamports must fit into a u64.');
  }

  return Array.from({ length: 8 }, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn));
}

function compiledInstruction(params: {
  programIdIndex: number;
  accountIndexes: number[];
  data: number[];
}): Uint8Array {
  return concatBytes([
    Uint8Array.from([params.programIdIndex]),
    Uint8Array.from(encodeShortVecLength(params.accountIndexes.length)),
    Uint8Array.from(params.accountIndexes),
    Uint8Array.from(encodeShortVecLength(params.data.length)),
    Uint8Array.from(params.data),
  ]);
}

function unsignedTransactionFromMessage(message: Uint8Array): string {
  return Buffer.from(
    concatBytes([Uint8Array.from(encodeShortVecLength(1)), new Uint8Array(64), message]),
  ).toString('base64');
}

function buildCloseNonceAccountTransaction(params: {
  walletAddress: string;
  nonceAccount: string;
  lamports: bigint;
  recentBlockhash: string;
}): string {
  const accountKeys = [
    publicKeyBytes(params.walletAddress, 'Wallet address'),
    publicKeyBytes(params.nonceAccount, 'Nonce account'),
    publicKeyBytes(RECENT_BLOCKHASHES_SYSVAR_ID, 'Recent blockhashes sysvar'),
    publicKeyBytes(RENT_SYSVAR_ID, 'Rent sysvar'),
    publicKeyBytes(SYSTEM_PROGRAM_ID, 'System program'),
  ];
  const withdrawInstruction = compiledInstruction({
    programIdIndex: 4,
    accountIndexes: [1, 0, 2, 3, 0],
    data: [
      ...u32ToLittleEndian(WITHDRAW_NONCE_ACCOUNT_INSTRUCTION),
      ...u64ToLittleEndian(params.lamports),
    ],
  });
  const message = concatBytes([
    Uint8Array.from([1, 0, 3]),
    compactArray(accountKeys),
    publicKeyBytes(params.recentBlockhash, 'Recent blockhash'),
    compactArray([withdrawInstruction]),
  ]);

  return unsignedTransactionFromMessage(message);
}

function parseLamports(value: string | null): bigint | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;
  if (fraction === 0n) return whole.toString();

  return `${whole}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

export function isOfflinePaymentSlotReclaimable(slot: OfflinePaymentSlotRecord): boolean {
  if (slot.nonceAuthority !== slot.walletAddress) return false;
  if (
    slot.status !== 'ready' &&
    slot.status !== 'stale' &&
    slot.status !== 'settled' &&
    slot.status !== 'error'
  ) {
    return false;
  }

  const lamports = parseLamports(slot.lamports);
  return lamports != null && lamports > 0n;
}

async function waitForSignatureConfirmation(params: {
  signatures: string[];
  network: OffpayNetwork;
}): Promise<void> {
  if (params.signatures.length === 0) return;

  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const response = await getRpcSignatureStatuses({
      signatures: params.signatures,
      network: params.network,
    });
    await yieldToEventLoop();

    const failed = response.statuses.find((status) => status?.err != null);
    if (failed != null) {
      throw new Error('Offline slot transaction failed on-chain.');
    }

    const confirmed = response.statuses.every(
      (status) =>
        status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized',
    );
    if (confirmed) return;

    await delay(CONFIRMATION_DELAY_MS);
  }
}

async function waitForSignatureConfirmationStrict(params: {
  signatures: string[];
  network: OffpayNetwork;
}): Promise<boolean> {
  if (params.signatures.length === 0) return true;

  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const response = await getRpcSignatureStatuses({
      signatures: params.signatures,
      network: params.network,
    });
    await yieldToEventLoop();

    const failed = response.statuses.find((status) => status?.err != null);
    if (failed != null) {
      throw new Error('Offline slot transaction failed on-chain.');
    }

    const confirmed = response.statuses.every(
      (status) =>
        status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized',
    );
    if (confirmed) return true;

    await delay(CONFIRMATION_DELAY_MS);
  }

  return false;
}

export async function prepareOfflinePaymentSlots(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  targetSlotCount: number;
  spendAuthorization: OfflineSlotSpendAuthorization;
}): Promise<OfflinePaymentSlotPreparationResult> {
  if (params.spendAuthorization !== 'user-confirmed') {
    throw new Error(
      'Preparing offline payment slots spends SOL for nonce-account rent and requires explicit user confirmation.',
    );
  }

  const targetSlotCount = clampSlotCount(params.targetSlotCount);
  const rentEstimate = await getOfflinePaymentSlotRentEstimate({
    walletAddress: params.walletAddress,
    network: params.network,
    slotCount: targetSlotCount,
  });
  await yieldToUi();

  let refreshed = await refreshOfflinePaymentSlotsFromBackendStatus({
    walletAddress: params.walletAddress,
    network: params.network,
    targetSlotCount,
  }).catch(() => loadOfflinePaymentSlotSnapshot(params));
  await yieldToUi();
  const staleSlots = refreshed.slots.filter((slot) => slot.status === 'stale');
  const advanceSignatures: string[] = [];
  const preparedStaleAdvances: Array<{
    slot: OfflinePaymentSlotRecord;
    transactionBase64: string;
  }> = [];

  for (const slot of staleSlots) {
    const preparedAdvance = await prepareOfflineNonceAdvance({
      walletAddress: params.walletAddress,
      nonceAccount: slot.nonceAccount,
      network: params.network,
    });
    preparedStaleAdvances.push({
      slot,
      transactionBase64: preparedAdvance.transactionBase64,
    });
    await yieldToUi();
  }

  const signedStaleAdvances = await signSerializedTransactionsForWallet({
    unsignedTransactions: preparedStaleAdvances.map((entry) => entry.transactionBase64),
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });

  for (let index = 0; index < preparedStaleAdvances.length; index += 1) {
    const { slot } = preparedStaleAdvances[index];
    const broadcast = await broadcastRawTransaction({
      rawTransaction: signedStaleAdvances[index],
      network: params.network,
    });
    advanceSignatures.push(broadcast.signature);
    await saveSlot({
      ...slot,
      status: 'settling',
      pendingSignature: broadcast.signature,
      errorMessage: null,
      updatedAt: Date.now(),
    });
    await delay(0);
  }

  if (advanceSignatures.length > 0) {
    await waitForSignatureConfirmation({
      signatures: advanceSignatures,
      network: params.network,
    }).catch(() => undefined);
    refreshed = await refreshOfflinePaymentSlotsFromBackendStatus({
      walletAddress: params.walletAddress,
      network: params.network,
      targetSlotCount,
    }).catch(() => loadOfflinePaymentSlotSnapshot(params));
    await yieldToUi();
  }
  const requestCount =
    refreshed.slots.length === 0
      ? targetSlotCount
      : Math.max(0, Math.min(refreshed.counts.needsRefill, targetSlotCount));

  if (requestCount === 0) {
    return {
      snapshot: refreshed,
      preparedCount: 0,
      signatures: [],
      rentEstimate,
    };
  }

  const generated: GeneratedNonceAccount[] = [];
  for (let index = 0; index < requestCount; index += 1) {
    generated.push(generateNonceAccount());
    await yieldToEventLoop();
  }
  const generatedByAccount = new Map(generated.map((entry) => [entry.nonceAccount, entry]));

  try {
    await yieldToUi();
    await upsertSlots({
      walletAddress: params.walletAddress,
      network: params.network,
      targetSlotCount,
      slots: generated.map((entry) => ({
        version: SLOT_VERSION,
        walletAddress: params.walletAddress,
        network: params.network,
        nonceAccount: entry.nonceAccount,
        nonceAuthority: params.walletAddress,
        nonceValue: null,
        status: 'preparing',
        lamports: null,
        rentExempt: null,
        checkedAt: null,
        updatedAt: Date.now(),
        lockedTxId: null,
        pendingSignature: null,
        errorMessage: null,
      })),
    });

    await yieldToUi();
    const prepared = await prepareOfflineNoncePool({
      walletAddress: params.walletAddress,
      nonceAuthority: params.walletAddress,
      nonceAccounts: generated.map((entry) => entry.nonceAccount),
      network: params.network,
    });
    const returnedAccounts = new Set(
      prepared.unsignedTransactions.map((transaction) => transaction.nonceAccount),
    );
    const missingPreparedAccounts = generated.filter(
      (entry) => !returnedAccounts.has(entry.nonceAccount),
    );
    if (missingPreparedAccounts.length > 0) {
      for (const entry of missingPreparedAccounts) {
        await saveSlot({
          version: SLOT_VERSION,
          walletAddress: params.walletAddress,
          network: params.network,
          nonceAccount: entry.nonceAccount,
          nonceAuthority: params.walletAddress,
          nonceValue: null,
          status: 'error',
          lamports: null,
          rentExempt: null,
          checkedAt: null,
          updatedAt: Date.now(),
          lockedTxId: null,
          pendingSignature: null,
          errorMessage: 'Backend did not return a preparation transaction for this slot.',
        });
        await yieldToEventLoop();
      }
    }

    const signatures: string[] = [];
    await yieldToUi();
    const walletSignedTransactions = await signSerializedTransactionsForWallet({
      unsignedTransactions: prepared.unsignedTransactions.map(
        (transaction) => transaction.transactionBase64,
      ),
      walletAddress: params.walletAddress,
      walletId: params.walletId,
    });

    for (let index = 0; index < prepared.unsignedTransactions.length; index += 1) {
      const transaction = prepared.unsignedTransactions[index];
      const generatedAccount = generatedByAccount.get(transaction.nonceAccount);
      if (generatedAccount == null) {
        throw new Error('Prepared offline slot transaction did not match a local nonce account.');
      }

      const fullySigned = await signSerializedTransactionWithSeedAsync({
        unsignedTransaction: walletSignedTransactions[index],
        walletAddress: generatedAccount.nonceAccount,
        signingSeed: generatedAccount.signingSeed,
        transactionLabel: 'offline slot creation transaction',
      });
      await yieldToUi();
      const broadcast = await broadcastRawTransaction({
        rawTransaction: fullySigned,
        network: params.network,
      });
      signatures.push(broadcast.signature);
      await saveSlot({
        version: SLOT_VERSION,
        walletAddress: params.walletAddress,
        network: params.network,
        nonceAccount: generatedAccount.nonceAccount,
        nonceAuthority: params.walletAddress,
        nonceValue: null,
        status: 'settling',
        lamports: null,
        rentExempt: null,
        checkedAt: null,
        updatedAt: Date.now(),
        lockedTxId: null,
        pendingSignature: broadcast.signature,
        errorMessage: null,
      });
      await yieldToUi();
    }

    await yieldToUi();
    await waitForSignatureConfirmation({
      signatures,
      network: params.network,
    }).catch(() => undefined);

    const snapshot = await refreshOfflinePaymentSlotsFromBackendStatus({
      walletAddress: params.walletAddress,
      network: params.network,
      targetSlotCount,
    }).catch(() => loadOfflinePaymentSlotSnapshot(params));
    await yieldToUi();

    return {
      snapshot,
      preparedCount: prepared.unsignedTransactions.length,
      signatures,
      rentEstimate,
    };
  } catch (error) {
    await upsertSlots({
      walletAddress: params.walletAddress,
      network: params.network,
      targetSlotCount,
      slots: generated.map((entry) => ({
        version: SLOT_VERSION,
        walletAddress: params.walletAddress,
        network: params.network,
        nonceAccount: entry.nonceAccount,
        nonceAuthority: params.walletAddress,
        nonceValue: null,
        status: 'error',
        lamports: null,
        rentExempt: null,
        checkedAt: null,
        updatedAt: Date.now(),
        lockedTxId: null,
        pendingSignature: null,
        errorMessage: error instanceof Error ? error.message : 'Offline slot preparation failed.',
      })),
    });
    throw error;
  } finally {
    for (const entry of generated) {
      zeroOutBytes(entry.signingSeed);
    }
  }
}

export async function reclaimOfflinePaymentSlotRent(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  targetSlotCount: number;
  reclaimAuthorization: OfflineSlotReclaimAuthorization;
}): Promise<OfflinePaymentSlotReclaimResult> {
  if (params.reclaimAuthorization !== 'user-confirmed') {
    throw new Error(
      'Recovering SOL from offline payment slots requires explicit user confirmation.',
    );
  }

  let snapshot = await refreshOfflinePaymentSlotsFromBackendStatus({
    walletAddress: params.walletAddress,
    network: params.network,
    targetSlotCount: params.targetSlotCount,
  }).catch(() => loadOfflinePaymentSlotSnapshot(params));
  await yieldToUi();
  const reclaimableSlots = snapshot.slots.filter(isOfflinePaymentSlotReclaimable);

  if (reclaimableSlots.length === 0) {
    return {
      snapshot,
      closedCount: 0,
      reclaimedLamports: '0',
      reclaimedSol: '0',
      signatures: [],
    };
  }

  const blockhash = await getRpcLatestBlockhash(params.network);
  await yieldToUi();
  const signatures: string[] = [];
  let reclaimedLamports = 0n;

  for (const slot of reclaimableSlots) {
    const lamports = parseLamports(slot.lamports);
    if (lamports == null || lamports <= 0n) continue;

    if (
      slot.nonceAuthority !== params.walletAddress ||
      slot.walletAddress !== params.walletAddress
    ) {
      await saveSlot({
        ...slot,
        status: 'error',
        errorMessage: 'Offline slot authority does not match the active wallet.',
        updatedAt: Date.now(),
      });
      continue;
    }

    try {
      await yieldToUi();
      const unsignedTransaction = buildCloseNonceAccountTransaction({
        walletAddress: params.walletAddress,
        nonceAccount: slot.nonceAccount,
        lamports,
        recentBlockhash: blockhash.blockhash,
      });
      const signedTransaction = await signSerializedTransactionForWallet({
        unsignedTransaction,
        walletAddress: params.walletAddress,
        walletId: params.walletId,
      });
      const broadcast = await broadcastRawTransaction({
        rawTransaction: signedTransaction,
        network: params.network,
      });
      signatures.push(broadcast.signature);
      reclaimedLamports += lamports;

      await saveSlot({
        ...slot,
        status: 'closing',
        pendingSignature: broadcast.signature,
        errorMessage: null,
        updatedAt: Date.now(),
      });
      await yieldToUi();
    } catch (error) {
      await saveSlot({
        ...slot,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Offline slot reclaim failed.',
        updatedAt: Date.now(),
      });
    }
  }

  if (signatures.length > 0) {
    try {
      await yieldToUi();
      const confirmed = await waitForSignatureConfirmationStrict({
        signatures,
        network: params.network,
      });
      if (!confirmed) {
        snapshot = await loadOfflinePaymentSlotSnapshot(params);
        return {
          snapshot,
          closedCount: 0,
          reclaimedLamports: '0',
          reclaimedSol: '0',
          signatures,
        };
      }
    } catch (error) {
      const failedSignatureSet = new Set(signatures);
      await Promise.all(
        reclaimableSlots.map(async (slot) => {
          const current = await loadSlot({
            walletAddress: params.walletAddress,
            network: params.network,
            nonceAccount: slot.nonceAccount,
          });
          if (
            current?.pendingSignature == null ||
            !failedSignatureSet.has(current.pendingSignature)
          ) {
            return;
          }

          await saveSlot({
            ...current,
            status: 'error',
            errorMessage:
              error instanceof Error ? error.message : 'Offline slot reclaim failed on-chain.',
            updatedAt: Date.now(),
          });
        }),
      );
      throw error;
    }

    const closedSignatureSet = new Set(signatures);
    await Promise.all(
      reclaimableSlots.map(async (slot) => {
        const current = await loadSlot({
          walletAddress: params.walletAddress,
          network: params.network,
          nonceAccount: slot.nonceAccount,
        });
        if (
          current?.pendingSignature == null ||
          !closedSignatureSet.has(current.pendingSignature)
        ) {
          return;
        }

        await saveSlot({
          ...current,
          status: 'closed',
          nonceValue: null,
          lamports: '0',
          rentExempt: false,
          lockedTxId: null,
          pendingSignature: null,
          errorMessage: null,
          checkedAt: Date.now(),
          updatedAt: Date.now(),
        });
        await yieldToEventLoop();
      }),
    );
  }

  snapshot = await refreshOfflinePaymentSlotsFromBackendStatus({
    walletAddress: params.walletAddress,
    network: params.network,
    targetSlotCount: params.targetSlotCount,
  }).catch(() => loadOfflinePaymentSlotSnapshot(params));
  await yieldToUi();

  return {
    snapshot,
    closedCount: signatures.length,
    reclaimedLamports: reclaimedLamports.toString(),
    reclaimedSol: formatSol(reclaimedLamports),
    signatures,
  };
}

export async function getReadyOfflinePaymentSlot(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<OfflinePaymentSlotRecord | null> {
  const snapshot = await loadOfflinePaymentSlotSnapshot(params);
  return (
    snapshot.slots.find(
      (slot) =>
        slot.status === 'ready' &&
        slot.nonceValue != null &&
        slot.nonceValue.length > 0 &&
        slot.nonceAuthority === params.walletAddress,
    ) ?? null
  );
}

export async function lockOfflinePaymentSlotForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  nonceAccount: string;
  txId: string;
}): Promise<OfflinePaymentSlotRecord | null> {
  const current = await loadSlot(params);
  if (current == null) return null;

  return saveSlot({
    ...current,
    status: 'locked',
    lockedTxId: params.txId,
    errorMessage: null,
    updatedAt: Date.now(),
  });
}

async function updateSlotForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
  status: OfflinePaymentSlotStatus;
  errorMessage?: string | null;
}): Promise<OfflinePaymentSlotRecord | null> {
  const snapshot = await loadOfflinePaymentSlotSnapshot(params);
  const current = snapshot.slots.find((slot) => slot.lockedTxId === params.txId);
  if (current == null) return null;

  return saveSlot({
    ...current,
    status: params.status,
    errorMessage: params.errorMessage ?? null,
    updatedAt: Date.now(),
  });
}

export function markOfflinePaymentSlotSettlingForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
}): Promise<OfflinePaymentSlotRecord | null> {
  return updateSlotForTx({ ...params, status: 'settling' });
}

export function markOfflinePaymentSlotSettledForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
}): Promise<OfflinePaymentSlotRecord | null> {
  return updateSlotForTx({ ...params, status: 'settled' });
}

export function markOfflinePaymentSlotFailedForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
  errorMessage: string;
}): Promise<OfflinePaymentSlotRecord | null> {
  return updateSlotForTx({
    walletAddress: params.walletAddress,
    network: params.network,
    txId: params.txId,
    status: 'locked',
    errorMessage: params.errorMessage,
  });
}
