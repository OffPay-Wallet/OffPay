import {
  getUmbraClaimStatus,
  getUmbraRelayerInfo,
  getUmbraTreeProofs,
  getUmbraUtxos,
  submitUmbraClaim,
} from '@/lib/api/offpay-api-client';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import {
  base64ToBytes,
  base64ToFixedBytes,
  bigintToSafeNumber,
  bytesToHex,
  getStringProperty,
  h1AddressPartsToBase58,
  isRecord,
  readBigint,
  readCandidate,
  readNestedRecord,
  readOptionalString,
  readRequiredBigint,
  readRequiredString,
  safeBigintToNumber,
  splitAddressBase64,
} from '@/lib/umbra/umbra-parsing';
import type { UmbraPendingClaimUtxo } from '@/lib/umbra/umbra-types';

import type { JsonValue, OffpayNetwork } from '@/types/offpay-api';
import type {
  BatchMerkleProofResult,
  UtxoDataItem,
  UtxoFetchResult,
} from '@umbra-privacy/sdk/indexer';

/**
 * OffPay-side adapter for the Umbra indexer + relayer.
 *
 * The Umbra SDK fetches UTXO data, Merkle proofs, and submits claims
 * through pluggable providers. OffPay routes those calls through the
 * `offpay-api-client` so the device never talks to indexer/relayer
 * services directly. This file provides:
 *
 * - factory functions that match the SDK provider signatures
 * - response normalizers for indexer payloads
 * - claim-result classification helpers (completed vs already-claimed)
 * - per-UTXO projection helpers used by the receive UI
 *
 * Everything in this file is OffPay-specific glue; the underlying
 * cryptography, signing, and Solana RPC orchestration live in
 * `umbra-execution.ts`.
 */

const UMBRA_UTXO_FETCH_LIMIT_MAX = 1000;

const ARCIUM_ALREADY_CALLBACKED_ERROR_CODE = 6204;
// Umbra program errors that mean "this UTXO has already been claimed".
// Surfaces when a UTXO that has already been claimed is submitted again,
// e.g. because a previous claim landed on-chain but its callback /
// status poll surfaced a transient RPC error to the client. Treat as a
// "already_claimed" success so we stop showing the same UTXOs as
// pending and so the encrypted balance refresh runs.
// Sources (all from `@umbra-privacy/umbra-codama`):
//   - `UMBRA_ERROR__DUPLICATE_NULLIFIER`     = 14006 (0x36b6)
//   - `UMBRA_ERROR__NULLIFIER_ALREADY_BURNT` = 28004 (0x6d64)
const UMBRA_DUPLICATE_NULLIFIER_ERROR_CODE = 14006;
const UMBRA_NULLIFIER_ALREADY_BURNT_ERROR_CODE = 28004;
const UMBRA_ALREADY_CLAIMED_ERROR_CODES: readonly number[] = [
  UMBRA_DUPLICATE_NULLIFIER_ERROR_CODE,
  UMBRA_NULLIFIER_ALREADY_BURNT_ERROR_CODE,
];

export function isBenignAlreadyClaimedFailure(error: unknown): boolean {
  if (error == null) return false;

  if (typeof error === 'object') {
    const instructionError = (error as { InstructionError?: unknown }).InstructionError;
    if (Array.isArray(instructionError) && instructionError.length === 2) {
      const detail = instructionError[1];
      if (detail != null && typeof detail === 'object') {
        const custom = (detail as { Custom?: unknown }).Custom;
        if (typeof custom === 'number' && UMBRA_ALREADY_CLAIMED_ERROR_CODES.includes(custom)) {
          return true;
        }
      }
    }
  }

  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    if (lower.includes('duplicatenullifier')) return true;
    if (lower.includes('nullifieralreadyburnt')) return true;
    if (lower.includes('nullifier already')) return true;
    if (lower.includes('utxo already claimed')) return true;
    if (/custom\s*(?:program\s*)?error[:\s]+(?:0x36b6|0x6d64|14006|28004)\b/i.test(error)) {
      return true;
    }
  }
  if (error instanceof Error) {
    return isBenignAlreadyClaimedFailure(error.message);
  }
  return false;
}

export function isBenignArciumDuplicateCallback(error: unknown): boolean {
  // Accept the strict Solana RPC error envelope:
  //   { InstructionError: [<ix>, { Custom: 6204 }] }
  if (error != null && typeof error === 'object') {
    const instructionError = (error as { InstructionError?: unknown }).InstructionError;
    if (Array.isArray(instructionError) && instructionError.length === 2) {
      const detail = instructionError[1];
      if (detail != null && typeof detail === 'object') {
        const custom = (detail as { Custom?: unknown }).Custom;
        if (custom === ARCIUM_ALREADY_CALLBACKED_ERROR_CODE) return true;
      }
    }
  }

  // Accept the stringified form too. Several backend / SDK paths bubble errors
  // up as opaque strings (e.g. "Program failed to complete: custom program error
  // 0x183c" or "AlreadyCallbackedComputation"). 0x183c is 6204 in hex; the human
  // string is what Arcium's anchor program emits in its message.
  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    if (lower.includes('alreadycallbackedcomputation')) return true;
    if (lower.includes('callback computation already called')) return true;
    if (/custom\s*(?:program\s*)?error[:\s]+(?:0x183c|6204)\b/i.test(error)) return true;
  }
  if (error instanceof Error) {
    return isBenignArciumDuplicateCallback(error.message);
  }

  return false;
}

export function getUtxoInsertionIndexAsNumber(utxo: unknown): number | null {
  if (utxo == null || typeof utxo !== 'object') return null;
  const value = (utxo as { insertionIndex?: unknown }).insertionIndex;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function h1TimestampToUnixMs(timestamp: {
  year: bigint;
  month: bigint;
  day: bigint;
  hour: bigint;
  minute: bigint;
  second: bigint;
}): number | null {
  const year = safeBigintToNumber(timestamp.year);
  const month = safeBigintToNumber(timestamp.month);
  const day = safeBigintToNumber(timestamp.day);
  const hour = safeBigintToNumber(timestamp.hour);
  const minute = safeBigintToNumber(timestamp.minute);
  const second = safeBigintToNumber(timestamp.second);
  if (
    year == null ||
    month == null ||
    day == null ||
    hour == null ||
    minute == null ||
    second == null
  ) {
    return null;
  }
  // H1 timestamps are 1-indexed for month + day (matches the SDK).
  const utcMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second);
  if (Number.isNaN(utcMs)) return null;
  return utcMs;
}

export function projectPendingClaimUtxo(
  utxo: unknown,
  kind: 'receiver' | 'self',
): UmbraPendingClaimUtxo | null {
  if (utxo == null || typeof utxo !== 'object') return null;
  const insertionIndex = getUtxoInsertionIndexAsNumber(utxo);
  if (insertionIndex == null) return null;

  const treeIndexRaw = (utxo as { treeIndex?: unknown }).treeIndex;
  const treeIndex =
    typeof treeIndexRaw === 'number'
      ? treeIndexRaw
      : typeof treeIndexRaw === 'bigint'
        ? (safeBigintToNumber(treeIndexRaw) ?? 0)
        : 0;

  let finalCommitmentHex = '';
  const finalCommitment = (utxo as { finalCommitment?: unknown }).finalCommitment;
  if (finalCommitment instanceof Uint8Array) {
    finalCommitmentHex = bytesToHex(finalCommitment);
  } else if (Array.isArray(finalCommitment)) {
    finalCommitmentHex = bytesToHex(Uint8Array.from(finalCommitment as number[]));
  }

  const h1 = (utxo as { h1Components?: unknown }).h1Components;
  let mintBase58: string | null = null;
  let senderBase58: string | null = null;
  let depositTimestampMs: number | null = null;
  if (h1 != null && typeof h1 === 'object') {
    const h1Record = h1 as Record<string, unknown>;
    const senderLow = h1Record.senderAddressLow;
    const senderHigh = h1Record.senderAddressHigh;
    if (typeof senderLow === 'bigint' && typeof senderHigh === 'bigint') {
      senderBase58 = h1AddressPartsToBase58({ low: senderLow, high: senderHigh });
    }
    const mintLow = h1Record.mintAddressLow;
    const mintHigh = h1Record.mintAddressHigh;
    if (typeof mintLow === 'bigint' && typeof mintHigh === 'bigint') {
      mintBase58 = h1AddressPartsToBase58({ low: mintLow, high: mintHigh });
    }
    const ts = h1Record.timestamp;
    if (ts != null && typeof ts === 'object') {
      const tsRecord = ts as Record<string, unknown>;
      if (
        typeof tsRecord.year === 'bigint' &&
        typeof tsRecord.month === 'bigint' &&
        typeof tsRecord.day === 'bigint' &&
        typeof tsRecord.hour === 'bigint' &&
        typeof tsRecord.minute === 'bigint' &&
        typeof tsRecord.second === 'bigint'
      ) {
        depositTimestampMs = h1TimestampToUnixMs({
          year: tsRecord.year,
          month: tsRecord.month,
          day: tsRecord.day,
          hour: tsRecord.hour,
          minute: tsRecord.minute,
          second: tsRecord.second,
        });
      }
    }
  }

  return {
    id: `${treeIndex}:${insertionIndex}`,
    kind,
    insertionIndex,
    treeIndex,
    finalCommitmentHex,
    mintBase58,
    senderBase58,
    depositTimestampMs,
  };
}

function readH1AddressParts(
  source: Record<string, unknown>,
  base64Keys: readonly string[],
  lowKeys: readonly string[],
  highKeys: readonly string[],
  label: string,
): { low: bigint; high: bigint } {
  const encoded = readCandidate(source, base64Keys);
  if (typeof encoded === 'string' && encoded.length > 0) {
    return splitAddressBase64(encoded, label);
  }

  return {
    low: readRequiredBigint(source, lowKeys, `${label} low`),
    high: readRequiredBigint(source, highKeys, `${label} high`),
  };
}

function normalizeUmbraUtxoDataItem(entry: unknown): UtxoDataItem {
  if (!isRecord(entry)) {
    throw new Error('Umbra indexer returned a malformed UTXO entry.');
  }

  const h1 = readNestedRecord(entry, ['h1Components', 'h1_components', 'h1']) ?? entry;
  const senderAddress = readH1AddressParts(
    h1,
    ['h1_sender_address', 'senderAddress'],
    ['senderAddressLow', 'sender_address_low', 'h1_sender_address_low'],
    ['senderAddressHigh', 'sender_address_high', 'h1_sender_address_high'],
    'sender address',
  );
  const mintAddress = readH1AddressParts(
    h1,
    ['h1_mint_address', 'mintAddress'],
    ['mintAddressLow', 'mint_address_low', 'h1_mint_address_low'],
    ['mintAddressHigh', 'mint_address_high', 'h1_mint_address_high'],
    'mint address',
  );
  const timestamp =
    readNestedRecord(h1, ['timestamp', 'h1_timestamp']) ??
    ({
      year: readCandidate(h1, ['h1_year', 'year']),
      month: readCandidate(h1, ['h1_month', 'month']),
      day: readCandidate(h1, ['h1_day', 'day']),
      hour: readCandidate(h1, ['h1_hour', 'hour']),
      minute: readCandidate(h1, ['h1_minute', 'minute']),
      second: readCandidate(h1, ['h1_second', 'second']),
    } satisfies Record<string, unknown>);
  const eventType = readOptionalString(entry, ['event_type', 'eventType']);

  return {
    absoluteIndex: readRequiredBigint(
      entry,
      ['absolute_index', 'absoluteIndex'],
      'absolute index',
    ) as never,
    treeIndex: readRequiredBigint(entry, ['tree_index', 'treeIndex'], 'tree index') as never,
    insertionIndex: readRequiredBigint(
      entry,
      ['insertion_index', 'insertionIndex'],
      'insertion index',
    ) as never,
    finalCommitment: base64ToFixedBytes(
      readRequiredString(entry, ['final_commitment', 'finalCommitment'], 'final commitment'),
      32,
      'final commitment',
    ) as never,
    h1Components: {
      version: readRequiredBigint(h1, ['h1_version', 'version'], 'H1 version') as never,
      commitmentIndex: readRequiredBigint(
        h1,
        ['h1_commitment_index', 'commitmentIndex', 'commitment_index'],
        'H1 commitment index',
      ) as never,
      senderAddressLow: senderAddress.low as never,
      senderAddressHigh: senderAddress.high as never,
      relayerFixedSolFees: readRequiredBigint(
        h1,
        ['h1_relayer_fixed_sol_fees', 'relayerFixedSolFees', 'relayer_fixed_sol_fees'],
        'relayer fees',
      ) as never,
      mintAddressLow: mintAddress.low as never,
      mintAddressHigh: mintAddress.high as never,
      timestamp: {
        year: readRequiredBigint(timestamp, ['year'], 'timestamp year') as never,
        month: readRequiredBigint(timestamp, ['month'], 'timestamp month') as never,
        day: readRequiredBigint(timestamp, ['day'], 'timestamp day') as never,
        hour: readRequiredBigint(timestamp, ['hour'], 'timestamp hour') as never,
        minute: readRequiredBigint(timestamp, ['minute'], 'timestamp minute') as never,
        second: readRequiredBigint(timestamp, ['second'], 'timestamp second') as never,
      },
      poolVolumeSpl: readRequiredBigint(
        h1,
        ['h1_pool_volume_spl', 'poolVolumeSpl', 'pool_volume_spl'],
        'pool SPL volume',
      ) as never,
      poolVolumeSol: readRequiredBigint(
        h1,
        ['h1_pool_volume_sol', 'poolVolumeSol', 'pool_volume_sol'],
        'pool SOL volume',
      ) as never,
    },
    h1Hash: base64ToFixedBytes(
      readRequiredString(entry, ['h1_hash', 'h1Hash'], 'H1 hash'),
      32,
      'H1 hash',
    ) as never,
    h2Hash: base64ToFixedBytes(
      readRequiredString(entry, ['h2_hash', 'h2Hash'], 'H2 hash'),
      32,
      'H2 hash',
    ) as never,
    aesEncryptedData: base64ToBytes(
      readRequiredString(entry, ['aes_encrypted_data', 'aesEncryptedData'], 'encrypted UTXO data'),
      'encrypted UTXO data',
    ) as never,
    depositorX25519PublicKey: base64ToFixedBytes(
      readRequiredString(
        entry,
        ['depositor_x25519_public_key', 'depositorX25519PublicKey'],
        'depositor X25519 public key',
      ),
      32,
      'depositor X25519 public key',
    ) as never,
    timestamp: readRequiredBigint(entry, ['timestamp'], 'UTXO timestamp') as never,
    slot: readRequiredBigint(entry, ['slot'], 'UTXO slot') as never,
    eventType: eventType === 'callback' ? 'callback' : 'deposit',
  };
}

export function createOffpayUmbraUtxoDataFetcher(network: OffpayNetwork) {
  return async (
    startIndex: bigint,
    endIndex?: bigint,
    limit?: bigint,
  ): Promise<UtxoFetchResult> => {
    const requestedLimit =
      limit === undefined ? undefined : bigintToSafeNumber(limit, 'Umbra UTXO limit');
    const response = await getUmbraUtxos({
      network,
      start: bigintToSafeNumber(startIndex, 'Umbra UTXO start index'),
      ...(endIndex === undefined
        ? {}
        : { end: bigintToSafeNumber(endIndex, 'Umbra UTXO end index') }),
      ...(requestedLimit === undefined
        ? {}
        : { limit: Math.min(requestedLimit, UMBRA_UTXO_FETCH_LIMIT_MAX) }),
    });
    const items = new Map();
    for (const entry of response.utxos) {
      const item = normalizeUmbraUtxoDataItem(entry);
      items.set(item.insertionIndex, item);
    }

    const nextCursor = response.cursor == null ? undefined : readBigint(response.cursor, 'cursor');
    return {
      items,
      hasMore: response.cursor != null,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      totalCount: BigInt(response.utxos.length) as never,
    } as UtxoFetchResult;
  };
}

function flattenUmbraProofEntries(values: readonly unknown[]): unknown[] {
  return values.flatMap((entry) => {
    if (isRecord(entry)) {
      const nestedProofs = readCandidate(entry, ['proofs', 'items', 'results', 'data']);
      if (Array.isArray(nestedProofs)) return nestedProofs;
    }
    return [entry];
  });
}

function normalizeUmbraBatchMerkleProofResult(
  payload: unknown,
  insertionIndices: readonly bigint[],
): BatchMerkleProofResult {
  const rawEntries = isRecord(payload)
    ? readCandidate(payload, ['proofs', 'items', 'results', 'data'])
    : payload;
  const entries = flattenUmbraProofEntries(Array.isArray(rawEntries) ? rawEntries : [payload]);
  const root =
    readOptionalString(payload, ['root', 'merkleRoot', 'merkle_root']) ??
    entries
      .map((entry) => readOptionalString(entry, ['root', 'merkleRoot', 'merkle_root']))
      .find(Boolean);

  if (root == null) {
    throw new Error('Umbra Merkle proof response did not include a tree root.');
  }

  const proofs = new Map();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const insertionIndex = readRequiredBigint(
      entry,
      ['insertion_index', 'insertionIndex', 'leafIndex', 'leaf_index'],
      'proof insertion index',
    );
    const pathValue = readCandidate(entry, ['proof', 'merklePath', 'merkle_path', 'path']);
    if (!Array.isArray(pathValue)) {
      throw new Error('Umbra Merkle proof response did not include a proof path.');
    }

    proofs.set(insertionIndex, {
      merklePath: pathValue.map((hash, index) =>
        base64ToFixedBytes(String(hash), 32, `Merkle proof hash ${index}`),
      ),
      leaf: base64ToFixedBytes(
        readRequiredString(
          entry,
          ['leaf', 'commitment', 'finalCommitment', 'final_commitment'],
          'proof leaf',
        ),
        32,
        'proof leaf',
      ),
    });
  }

  const missingIndex = insertionIndices.find((insertionIndex) => !proofs.has(insertionIndex));
  if (missingIndex != null) {
    throw new Error(`Umbra Merkle proof response is missing insertion index ${missingIndex}.`);
  }

  return {
    root: base64ToFixedBytes(root, 32, 'Merkle root') as never,
    proofs,
  } as BatchMerkleProofResult;
}

export function createOffpayUmbraBatchMerkleProofFetcher(network: OffpayNetwork) {
  return async (
    treeIndex: bigint,
    insertionIndices: readonly bigint[],
  ): Promise<BatchMerkleProofResult> => {
    const response = await getUmbraTreeProofs({
      network,
      treeIndex: bigintToSafeNumber(treeIndex, 'Umbra tree index'),
      insertionIndexes: insertionIndices.map((index) =>
        bigintToSafeNumber(index, 'Umbra insertion index'),
      ),
    });

    return normalizeUmbraBatchMerkleProofResult(response, insertionIndices);
  };
}

function findSolanaAddressString(value: unknown): string | null {
  if (typeof value === 'string' && isValidSolanaAddress(value)) return value;
  if (!isRecord(value)) return null;

  for (const key of ['address', 'relayer', 'feePayer', 'fee_payer', 'publicKey', 'public_key']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && isValidSolanaAddress(candidate)) return candidate;
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findSolanaAddressString(nestedValue);
    if (nested != null) return nested;
  }
  return null;
}

function normalizeUmbraClaimStatus(status: string | null): string {
  if (status === 'completed' || status === 'failed' || status === 'timed_out') return status;
  if (
    status === 'submitted' ||
    status === 'received' ||
    status === 'pending' ||
    status === 'processing'
  ) {
    return status;
  }
  return status ?? 'received';
}

export function createOffpayUmbraClaimRelayer(network: OffpayNetwork) {
  return {
    submitClaim: async (request: unknown) => {
      const response = await submitUmbraClaim({
        network,
        payload: request as Record<string, JsonValue>,
      });
      const requestId =
        response.claimId ??
        readOptionalString(response.result, [
          'requestId',
          'request_id',
          'claimId',
          'claim_id',
          'id',
        ]);
      if (requestId == null) {
        throw new Error('Umbra relayer did not return a claim request id.');
      }

      return {
        requestId,
        status: 'received' as const,
      };
    },
    pollClaimStatus: async (requestId: string) => {
      const response = await getUmbraClaimStatus({ network, id: requestId });
      const result = response.result;
      const status = normalizeUmbraClaimStatus(
        response.status ?? readOptionalString(result, ['status', 'state']),
      );

      return {
        requestId,
        status,
        variant: readOptionalString(result, ['variant']) ?? 'encrypted_balance',
        resolvedVariant:
          readOptionalString(result, ['resolvedVariant', 'resolved_variant']) ?? undefined,
        txSignature:
          readOptionalString(result, ['txSignature', 'tx_signature', 'signature']) ?? undefined,
        callbackSignature:
          readOptionalString(result, ['callbackSignature', 'callback_signature']) ?? undefined,
        computationAccount:
          readOptionalString(result, ['computationAccount', 'computation_account']) ?? undefined,
        failureReason:
          readOptionalString(result, ['failureReason', 'failure_reason', 'error']) ?? null,
        createdAt: readOptionalString(result, ['createdAt', 'created_at']) ?? response.fetchedAt,
        updatedAt: readOptionalString(result, ['updatedAt', 'updated_at']) ?? response.fetchedAt,
      };
    },
    getRelayerAddress: async () => {
      const response = await getUmbraRelayerInfo(network);
      const relayerAddress = findSolanaAddressString(response.relayer);
      if (relayerAddress == null) {
        throw new Error('Umbra relayer metadata did not include a valid relayer address.');
      }
      return relayerAddress as never;
    },
  };
}

type UmbraClaimBatchOutcome = 'completed' | 'already_claimed';

export interface UmbraClassifiedClaimResult {
  outcome: UmbraClaimBatchOutcome;
  /**
   * Insertion indices of UTXOs whose nullifier is now set on-chain
   * (status `completed` or benign already-claimed).
   */
  resolvedInsertionIndices: number[];
  /**
   * Insertion indices of UTXOs that did NOT land on-chain. These must
   * stay in the pending set so the user can retry.
   */
  unresolvedInsertionIndices: number[];
  /** First non-benign failure reason, if any. */
  failureReason: string | null;
}

function parseUtxoIdToInsertionIndex(utxoId: unknown): number | null {
  if (typeof utxoId !== 'string') return null;
  const parts = utxoId.split(':');
  if (parts.length < 2) return null;
  const leafIndex = Number(parts[parts.length - 1]);
  return Number.isSafeInteger(leafIndex) && leafIndex >= 0 ? leafIndex : null;
}

export function classifyUmbraClaimResult(result: unknown): UmbraClassifiedClaimResult {
  const empty: UmbraClassifiedClaimResult = {
    outcome: 'completed',
    resolvedInsertionIndices: [],
    unresolvedInsertionIndices: [],
    failureReason: null,
  };

  if (!isRecord(result)) return empty;
  const batches = result.batches;
  if (!(batches instanceof Map) || batches.size === 0) return empty;

  const resolved: number[] = [];
  const unresolved: number[] = [];
  let firstFailureReason: string | null = null;
  let sawAlreadyClaimed = false;
  let sawCompleted = false;

  for (const batch of batches.values()) {
    if (!isRecord(batch)) continue;
    const status = typeof batch.status === 'string' ? batch.status : null;
    const failureReason =
      typeof batch.failureReason === 'string' && batch.failureReason.length > 0
        ? batch.failureReason
        : null;
    const batchUtxoIds = Array.isArray(batch.utxoIds) ? batch.utxoIds : [];
    const batchIndices = batchUtxoIds
      .map(parseUtxoIdToInsertionIndex)
      .filter((value): value is number => value != null);

    if (status === 'completed') {
      sawCompleted = true;
      resolved.push(...batchIndices);
      continue;
    }

    if (failureReason != null && isBenignAlreadyClaimedFailure(failureReason)) {
      sawAlreadyClaimed = true;
      resolved.push(...batchIndices);
      continue;
    }

    // Genuine batch failure — UTXOs in this batch did not land
    // on-chain, so they must remain pending. We record the reason
    // for the caller to surface, but we do not throw here so partial
    // successes can still be persisted.
    if (firstFailureReason == null) {
      firstFailureReason = failureReason ?? `Umbra claim status: ${status ?? 'unknown'}.`;
    }
    unresolved.push(...batchIndices);
  }

  let outcome: UmbraClaimBatchOutcome;
  if (sawCompleted) {
    outcome = 'completed';
  } else if (sawAlreadyClaimed) {
    outcome = 'already_claimed';
  } else {
    outcome = 'completed';
  }

  return {
    outcome,
    resolvedInsertionIndices: Array.from(new Set(resolved)),
    unresolvedInsertionIndices: Array.from(new Set(unresolved)),
    failureReason: firstFailureReason,
  };
}

export function assertUmbraClaimCompleted(result: unknown): UmbraClassifiedClaimResult {
  return classifyUmbraClaimResult(result);
}

export function getCallbackStatusFromResult(result: unknown): string | null {
  if (result == null || typeof result !== 'object') return null;

  const record = result as Record<string, unknown>;
  const callbackStatus = record.callbackStatus ?? record.callback_status;
  if (callbackStatus != null) return String(callbackStatus);

  const callback = record.callback;
  if (callback != null && typeof callback === 'object') {
    const callbackRecord = callback as Record<string, unknown>;
    const nestedStatus = callbackRecord.status ?? callbackRecord.callbackStatus;
    if (nestedStatus != null) return String(nestedStatus);

    const nestedSignature = getStringProperty(callback, ['signature', 'callbackSignature']);
    if (nestedSignature != null) return 'finalized';
  }

  const callbackSignature = getStringProperty(result, ['callbackSignature', 'callback_signature']);
  if (callbackSignature != null) return 'finalized';

  return null;
}
