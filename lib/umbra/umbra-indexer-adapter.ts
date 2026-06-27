import {
  getUmbraClaimStatus,
  getUmbraRelayerInfo,
  getUmbraTreeProofs,
  getUmbraTreeSummaries,
  getUmbraUtxos,
  submitUmbraClaim,
} from '@/lib/api/offpay-api-client';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import {
  base64ToBytes,
  base64ToFixedBytes,
  bytesToHex,
  decodeU128Le,
  getStringProperty,
  h1AddressPartsToBase58,
  isRecord,
  readBigint,
  readCandidate,
  readOptionalString,
  readRequiredString,
  safeBigintToNumber,
  splitAddressBase64,
} from '@/lib/umbra/umbra-parsing';
import { mark, measure } from '@/lib/perf/perf-marks';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';
import type { UmbraPendingClaimUtxo } from '@/lib/umbra/umbra-types';

import type { JsonValue, OffpayNetwork } from '@/types/offpay-api';
import type {
  BatchMerkleProofResult,
  TreeSummaryFetcherFunction,
  UtxoDataItem,
  UtxoFetchResult,
} from '@umbra-privacy/sdk/indexer';
import { IndexerError } from '@umbra-privacy/sdk/indexer';

/**
 * OffPay-side adapter for the Umbra indexer + relayer.
 *
 * The Umbra SDK fetches UTXO data, Merkle proofs, and submits claims
 * through pluggable providers. OffPay uses the SDK's protobuf-aware
 * hosted-indexer fetchers for read paths, while claim submission and
 * status polling continue through `offpay-api-client`. This file provides:
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

const UMBRA_UTXO_FETCH_LIMIT_MAX = 1000n;
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

interface UmbraUtxoDataFetcherOptions {
  maxLimit?: bigint;
  signal?: AbortSignal | null;
  yieldAfterPage?: boolean;
}

function assertUmbraIndexerNotAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Umbra indexer request cancelled.');
  error.name = 'AbortError';
  throw error;
}

export function createOffpayUmbraUtxoDataFetcher(
  network: OffpayNetwork,
  options: UmbraUtxoDataFetcherOptions = {},
) {
  const maxLimit = options.maxLimit ?? UMBRA_UTXO_FETCH_LIMIT_MAX;

  return async (
    startIndex: bigint,
    endIndex?: bigint,
    limit?: bigint,
  ): Promise<UtxoFetchResult> => {
    assertUmbraIndexerNotAborted(options.signal);
    if (limit !== undefined && limit < 1n) {
      throw new IndexerError('validation', `Invalid limit: ${String(limit)}. Must be at least 1.`, {
        operation: 'fetchUtxoData',
      });
    }
    const cappedLimit = limit === undefined ? maxLimit : limit > maxLimit ? maxLimit : limit;
    const startedAt = mark();
    let itemCount = 0;
    let hasMore: boolean | null = null;
    let nextCursor: string | null = null;
    try {
      const result = await fetchOffpayUmbraUtxoData(
        network,
        startIndex,
        endIndex,
        cappedLimit,
        options.signal,
      );
      itemCount = result.items.size;
      hasMore = result.hasMore;
      nextCursor = result.nextCursor == null ? null : String(result.nextCursor);
      assertUmbraIndexerNotAborted(options.signal);
      if (options.yieldAfterPage === true) {
        await yieldToUi();
      }
      return result;
    } finally {
      measure('umbra.indexer.utxoPage', startedAt, {
        network,
        startIndex: startIndex.toString(),
        endIndex: endIndex == null ? null : endIndex.toString(),
        limit: Number(cappedLimit),
        itemCount,
        hasMore,
        nextCursor,
      });
    }
  };
}

async function fetchOffpayUmbraUtxoData(
  network: OffpayNetwork,
  startIndex: bigint,
  endIndex?: bigint,
  limit?: bigint,
  signal?: AbortSignal | null,
): Promise<UtxoFetchResult> {
  if (startIndex < 0n) {
    throw new IndexerError(
      'validation',
      `Invalid start index: ${String(startIndex)}. Must be non-negative.`,
      { operation: 'fetchUtxoData' },
    );
  }
  if (endIndex !== undefined && endIndex < startIndex) {
    throw new IndexerError(
      'validation',
      `Invalid end index: ${String(endIndex)}. Must be >= start index (${String(startIndex)}).`,
      { operation: 'fetchUtxoData' },
    );
  }

  let response: Awaited<ReturnType<typeof getUmbraUtxos>>;
  try {
    response = await getUmbraUtxos({
      network,
      start: startIndex.toString(),
      ...(endIndex !== undefined ? { end: endIndex.toString() } : {}),
      ...(limit !== undefined ? { limit: limit.toString() } : {}),
      signal: signal ?? undefined,
    });
  } catch (error) {
    if (error instanceof IndexerError) throw error;
    throw new IndexerError(
      'network',
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
      {
        operation: 'fetchUtxoData',
        cause: error instanceof Error ? error : undefined,
      },
    );
  }

  const items = new Map<bigint, UtxoDataItem>();
  for (const utxo of response.utxos) {
    try {
      const item = normalizeOffpayUtxoDataItem(utxo);
      items.set(item.insertionIndex as bigint, item);
    } catch (error) {
      const absoluteIndex = readCandidate(utxo, ['absolute_index', 'absoluteIndex']);
      throw new IndexerError(
        'parse',
        `Failed to parse UTXO data for index ${String(absoluteIndex)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          operation: 'fetchUtxoData',
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  }

  return {
    items: items as never,
    hasMore: response.hasMore,
    nextCursor: response.cursor == null ? undefined : BigInt(response.cursor),
    totalCount: BigInt(response.totalCount) as never,
  };
}

function readU128ColumnValue(value: unknown, label: string): bigint {
  if (value instanceof Uint8Array) return decodeU128Le(value);
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return BigInt(value);
    return decodeU128Le(base64ToBytes(value, label));
  }
  throw new Error(`Umbra indexer response has invalid ${label}.`);
}

function normalizeOffpayUtxoDataItem(utxo: Record<string, JsonValue>): UtxoDataItem {
  const senderAddress = splitAddressBase64(
    readRequiredString(utxo, ['h1_sender_address', 'h1SenderAddress'], 'h1_sender_address'),
    'h1_sender_address',
  );
  const mintAddress = splitAddressBase64(
    readRequiredString(utxo, ['h1_mint_address', 'h1MintAddress'], 'h1_mint_address'),
    'h1_mint_address',
  );
  const eventType = readRequiredString(utxo, ['event_type', 'eventType'], 'event_type');
  if (eventType !== 'deposit' && eventType !== 'callback') {
    throw new Error(`Umbra indexer response has invalid event_type: ${String(eventType)}.`);
  }

  return {
    absoluteIndex: readBigint(
      readCandidate(utxo, ['absolute_index', 'absoluteIndex']),
      'absolute_index',
    ),
    treeIndex: readBigint(readCandidate(utxo, ['tree_index', 'treeIndex']), 'tree_index') as never,
    insertionIndex: readBigint(
      readCandidate(utxo, ['insertion_index', 'insertionIndex']),
      'insertion_index',
    ) as never,
    finalCommitment: base64ToFixedBytes(
      readRequiredString(utxo, ['final_commitment', 'finalCommitment'], 'final_commitment'),
      32,
      'final_commitment',
    ) as never,
    h1Components: {
      version: readU128ColumnValue(
        readCandidate(utxo, ['h1_version', 'h1Version']),
        'h1_version',
      ) as never,
      commitmentIndex: readU128ColumnValue(
        readCandidate(utxo, ['h1_commitment_index', 'h1CommitmentIndex']),
        'h1_commitment_index',
      ) as never,
      senderAddressLow: senderAddress.low as never,
      senderAddressHigh: senderAddress.high as never,
      relayerFixedSolFees: readBigint(
        readCandidate(utxo, ['h1_relayer_fixed_sol_fees', 'h1RelayerFixedSolFees']),
        'h1_relayer_fixed_sol_fees',
      ) as never,
      mintAddressLow: mintAddress.low as never,
      mintAddressHigh: mintAddress.high as never,
      timestamp: {
        year: readBigint(readCandidate(utxo, ['h1_year', 'h1Year']), 'h1_year') as never,
        month: readBigint(readCandidate(utxo, ['h1_month', 'h1Month']), 'h1_month') as never,
        day: readBigint(readCandidate(utxo, ['h1_day', 'h1Day']), 'h1_day') as never,
        hour: readBigint(readCandidate(utxo, ['h1_hour', 'h1Hour']), 'h1_hour') as never,
        minute: readBigint(readCandidate(utxo, ['h1_minute', 'h1Minute']), 'h1_minute') as never,
        second: readBigint(readCandidate(utxo, ['h1_second', 'h1Second']), 'h1_second') as never,
      },
      poolVolumeSpl: readBigint(
        readCandidate(utxo, ['h1_pool_volume_spl', 'h1PoolVolumeSpl']),
        'h1_pool_volume_spl',
      ) as never,
      poolVolumeSol: readBigint(
        readCandidate(utxo, ['h1_pool_volume_sol', 'h1PoolVolumeSol']),
        'h1_pool_volume_sol',
      ) as never,
    },
    h1Hash: base64ToFixedBytes(
      readRequiredString(utxo, ['h1_hash', 'h1Hash'], 'h1_hash'),
      32,
      'h1_hash',
    ) as never,
    h2Hash: base64ToFixedBytes(
      readRequiredString(utxo, ['h2_hash', 'h2Hash'], 'h2_hash'),
      32,
      'h2_hash',
    ) as never,
    aesEncryptedData: base64ToBytes(
      readRequiredString(utxo, ['aes_encrypted_data', 'aesEncryptedData'], 'aes_encrypted_data'),
      'aes_encrypted_data',
    ) as never,
    depositorX25519PublicKey: base64ToFixedBytes(
      readRequiredString(
        utxo,
        ['depositor_x25519_public_key', 'depositorX25519PublicKey'],
        'depositor_x25519_public_key',
      ),
      32,
      'depositor_x25519_public_key',
    ) as never,
    timestamp: readBigint(readCandidate(utxo, ['timestamp']), 'timestamp') as never,
    slot: readBigint(readCandidate(utxo, ['slot']), 'slot') as never,
    eventType,
  };
}

export function createOffpayUmbraTreeSummaryFetcher(
  network: OffpayNetwork,
  options: { signal?: AbortSignal | null } = {},
): TreeSummaryFetcherFunction {
  return async () => {
    assertUmbraIndexerNotAborted(options.signal);
    const response = await getUmbraTreeSummaries(network, options.signal);
    assertUmbraIndexerNotAborted(options.signal);
    return response.trees.map((tree) => ({
      treeIndex: BigInt(tree.treeIndex) as never,
      numLeaves: BigInt(tree.numLeaves) as never,
    }));
  };
}

export function createOffpayUmbraBatchMerkleProofFetcher(network: OffpayNetwork) {
  return async (
    treeIndex: bigint,
    insertionIndices: readonly bigint[],
  ): Promise<BatchMerkleProofResult> => {
    const startedAt = mark();
    const result = await fetchOffpayUmbraBatchMerkleProof(network, treeIndex, insertionIndices);
    // The Merkle root is a public input to the claim proof (aggregated-hash
    // slot [0]) and the on-chain program verifies it against its bounded
    // root-history window. If the indexer's root drifts from the on-chain
    // tree state — the devnet tree grows every few seconds — the proof binds
    // to a root the program no longer accepts, surfacing as
    // UnableToVerifyGroth16Proof. Log the (non-secret) root + leaf count so we
    // can correlate a failed claim with the root it proved against.
    if (__DEV__) {
      const rootBytes = (result as { root?: Uint8Array }).root;
      const rootHex = rootBytes instanceof Uint8Array ? bytesToHex(rootBytes) : 'unknown';
      const proofs = (result as { proofs?: Map<unknown, unknown> }).proofs;
      measure('umbra.claims.merkleProof', startedAt, {
        network,
        treeIndex: Number(treeIndex),
        insertionCount: insertionIndices.length,
        proofCount: proofs instanceof Map ? proofs.size : -1,
        root: rootHex,
      });
    }
    return result;
  };
}

function readProofPathBytes(value: JsonValue | undefined): Uint8Array[] {
  if (!Array.isArray(value)) {
    throw new Error('Umbra proof entry is missing a Merkle path.');
  }

  return value.map((entry, index) => jsonValueToFixedBytes(entry, 32, `proof[${index}]`));
}

function jsonValueToFixedBytes(
  value: JsonValue | undefined,
  length: number,
  label: string,
): Uint8Array {
  if (typeof value === 'string') {
    return base64ToFixedBytes(value, length, label);
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) {
    const bytes = Uint8Array.from(value as number[]);
    if (bytes.length !== length) {
      throw new Error(`Umbra indexer response ${label} must be ${length} bytes.`);
    }
    return bytes;
  }

  throw new Error(`Umbra indexer response has invalid ${label}.`);
}

async function fetchOffpayUmbraBatchMerkleProof(
  network: OffpayNetwork,
  treeIndex: bigint,
  insertionIndices: readonly bigint[],
): Promise<BatchMerkleProofResult> {
  const response = await getUmbraTreeProofs({
    network,
    treeIndex: Number(treeIndex),
    insertionIndexes: insertionIndices.map((insertionIndex) => Number(insertionIndex)),
  });

  if (response.root == null) {
    throw new Error('Umbra proof batch response is missing the Merkle root.');
  }

  const proofs = new Map<bigint, { merklePath: Uint8Array[]; leaf: Uint8Array }>();
  for (const entry of response.proofs) {
    if (!isRecord(entry)) {
      throw new Error('Umbra proof batch response has an invalid proof entry.');
    }

    const insertionIndex = readBigint(
      readCandidate(entry, ['insertion_index', 'insertionIndex']),
      'insertion_index',
    );
    const proofValue = readCandidate(entry, ['proof', 'merkleProof', 'merkle_path', 'merklePath']);
    const leafValue = readCandidate(entry, ['leaf']);

    proofs.set(insertionIndex, {
      merklePath: readProofPathBytes(proofValue as JsonValue | undefined) as never,
      leaf: jsonValueToFixedBytes(leafValue as JsonValue | undefined, 32, 'leaf') as never,
    });
  }

  return {
    root: jsonValueToFixedBytes(response.root, 32, 'root') as never,
    proofs: proofs as never,
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

/**
 * Dev-only diagnostic: log the NON-SECRET structural fields of a burn request
 * before it is submitted to the relayer. This is the bundle the Umbra team
 * asked for when triaging on-chain `UnableToVerifyGroth16Proof (0x36b5)` —
 * it lets us confirm the claim targets the expected pool / mint / capacity
 * without ever printing nullifiers, linker encryptions, proof bytes, or any
 * other secret-bearing material.
 */
function logUmbraBurnRequestShape(network: OffpayNetwork, request: unknown): void {
  if (!__DEV__ || !isRecord(request)) return;
  const utxoSlots = request.utxo_slot_data;
  console.log('[umbra-claims] burn request shape', {
    network,
    variant: typeof request.variant === 'string' ? request.variant : null,
    stealthPoolIndex:
      typeof request.stealth_pool_index === 'number' ? request.stealth_pool_index : null,
    mint: typeof request.mint === 'string' ? request.mint : null,
    userPubkey: typeof request.user_pubkey === 'string' ? request.user_pubkey : null,
    maxUtxoCapacity:
      typeof request.max_utxo_capacity === 'number' ? request.max_utxo_capacity : null,
    utxoSlotCount: Array.isArray(utxoSlots) ? utxoSlots.length : null,
  });
}

export function createOffpayUmbraClaimRelayer(network: OffpayNetwork) {
  const submitClaim = async (request: unknown) => {
    const startedAt = mark();
    logUmbraBurnRequestShape(network, request);
    let response: Awaited<ReturnType<typeof submitUmbraClaim>>;
    try {
      response = await submitUmbraClaim({
        network,
        payload: request as Record<string, JsonValue>,
      });
    } catch (error) {
      measure('umbra.relayer.submitClaim', startedAt, {
        network,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const requestId =
      response.claimId ??
      readOptionalString(response.result, ['requestId', 'request_id', 'claimId', 'claim_id', 'id']);
    measure('umbra.relayer.submitClaim', startedAt, {
      network,
      ok: requestId != null,
      hasRequestId: requestId != null,
      requestId: requestId ?? null,
    });
    if (requestId == null) {
      throw new Error('Umbra relayer did not return a claim request id.');
    }

    return {
      requestId,
      status: 'received' as const,
    };
  };

  const pollClaimStatus = async (requestId: string) => {
    const response = await getUmbraClaimStatus({ network, id: requestId });
    const result = response.result;
    const status = normalizeUmbraClaimStatus(
      response.status ?? readOptionalString(result, ['status', 'state']),
    );
    const failureReason =
      readOptionalString(result, ['failureReason', 'failure_reason', 'error']) ?? null;
    const variant = readOptionalString(result, ['variant']) ?? 'encrypted_balance';
    const resolvedVariant =
      readOptionalString(result, ['resolvedVariant', 'resolved_variant']) ?? undefined;
    const txSignature =
      readOptionalString(result, ['txSignature', 'tx_signature', 'signature']) ?? undefined;
    const callbackSignature =
      readOptionalString(result, ['callbackSignature', 'callback_signature']) ?? undefined;
    const computationAccount =
      readOptionalString(result, ['computationAccount', 'computation_account']) ?? undefined;
    if (__DEV__ && (status === 'failed' || status === 'timed_out' || failureReason != null)) {
      // Full non-secret identity so the Umbra triage bundle can correlate a
      // failed poll with the on-chain attempt (request id, signatures,
      // computation account, resolved variant).
      console.warn('[umbra-claims] relayer poll surfaced a non-success status', {
        network,
        requestId,
        status,
        variant,
        resolvedVariant: resolvedVariant ?? null,
        txSignature: txSignature ?? null,
        callbackSignature: callbackSignature ?? null,
        computationAccount: computationAccount ?? null,
        failureReason,
      });
    }

    return {
      requestId,
      status,
      variant,
      resolvedVariant,
      txSignature,
      callbackSignature,
      computationAccount,
      failureReason,
      createdAt: readOptionalString(result, ['createdAt', 'created_at']) ?? response.fetchedAt,
      updatedAt: readOptionalString(result, ['updatedAt', 'updated_at']) ?? response.fetchedAt,
    };
  };

  const getRelayerAddress = async () => {
    const response = await getUmbraRelayerInfo(network);
    const relayerAddress = findSolanaAddressString(response.relayer);
    if (relayerAddress == null) {
      throw new Error('Umbra relayer metadata did not include a valid relayer address.');
    }
    return relayerAddress as never;
  };

  return {
    // Current Umbra SDK (v5) consumes the burn-named relayer methods…
    submitBurn: submitClaim,
    pollBurnStatus: pollClaimStatus,
    // …while the legacy SDK (v3) still calls the claim-named methods. Both
    // names share one implementation; the OffPay relayer endpoint is the same.
    submitClaim,
    pollClaimStatus,
    getRelayerAddress,
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
    // SDK v5 `BurnBatchResult` exposes the UTXO identifiers as
    // `stealthPoolNoteIds` ("treeIndex:leafIndex"). Older shapes used
    // `utxoIds`; accept both so index tracking never silently empties out
    // (an empty list here is what previously made a failed claim look like a
    // success — no unresolved indices meant no total-failure signal).
    const rawBatchIds = Array.isArray(batch.stealthPoolNoteIds)
      ? batch.stealthPoolNoteIds
      : Array.isArray(batch.utxoIds)
        ? batch.utxoIds
        : [];
    const batchIndices = rawBatchIds
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
