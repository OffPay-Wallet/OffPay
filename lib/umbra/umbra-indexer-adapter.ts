import {
  getUmbraClaimStatus,
  getUmbraRelayerInfo,
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
  readOptionalString,
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
  UtxoColumnarColumns,
  UtxoDataItem,
  UtxoFetchResult,
} from '@umbra-privacy/sdk/indexer';
import {
  IndexerError,
  ReadServiceClient,
  getBatchMerkleProofFetcher,
  getTreeSummaryFetcher,
} from '@umbra-privacy/sdk/indexer';

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
const DEFAULT_INDEXER_URLS: Record<OffpayNetwork, string> = {
  mainnet: 'https://utxo-indexer.api.umbraprivacy.com',
  devnet: 'https://utxo-indexer.api-devnet.umbraprivacy.com',
};
const PUBLIC_UMBRA_INDEXER_ENV = {
  EXPO_PUBLIC_UMBRA_INDEXER_URL_MAINNET: process.env.EXPO_PUBLIC_UMBRA_INDEXER_URL_MAINNET,
  EXPO_PUBLIC_UMBRA_INDEXER_URL_DEVNET: process.env.EXPO_PUBLIC_UMBRA_INDEXER_URL_DEVNET,
} satisfies Record<string, string | undefined>;

function publicIndexerEnv(key: keyof typeof PUBLIC_UMBRA_INDEXER_ENV): string | null {
  const value = PUBLIC_UMBRA_INDEXER_ENV[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function getUmbraIndexerEndpoint(network: OffpayNetwork): string {
  const key =
    network === 'mainnet'
      ? 'EXPO_PUBLIC_UMBRA_INDEXER_URL_MAINNET'
      : 'EXPO_PUBLIC_UMBRA_INDEXER_URL_DEVNET';
  return (publicIndexerEnv(key) ?? DEFAULT_INDEXER_URLS[network]).replace(/\/$/, '');
}

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
  const client = new ReadServiceClient({
    endpoint: getUmbraIndexerEndpoint(network),
  });
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
      const result = await fetchOffpayUmbraUtxoData(client, startIndex, endIndex, cappedLimit);
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
  client: ReadServiceClient,
  startIndex: bigint,
  endIndex?: bigint,
  limit?: bigint,
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

  let columnarResponse: Awaited<ReturnType<ReadServiceClient['getUtxoDataColumnar']>>;
  try {
    columnarResponse = await client.getUtxoDataColumnar({
      start: startIndex,
      end: endIndex,
      limit,
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

  const cols = columnarResponse.columns;
  const items = new Map<bigint, UtxoDataItem>();
  if (cols != null) {
    for (let rowIndex = 0; rowIndex < cols.absolute_index.length; rowIndex += 1) {
      try {
        const item = normalizeColumnarUtxoDataItem(cols, rowIndex);
        items.set(item.insertionIndex as bigint, item);
      } catch (error) {
        const absoluteIndex = readColumnValue(cols.absolute_index, rowIndex, 'absolute_index');
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
  }

  return {
    items: items as never,
    hasMore: columnarResponse.has_more,
    nextCursor: columnarResponse.next_cursor ?? undefined,
    totalCount: columnarResponse.total_count as never,
  };
}

function readColumnValue<T>(values: readonly T[], rowIndex: number, label: string): T {
  const value = values[rowIndex];
  if (value === undefined) {
    throw new Error(`Umbra indexer response is missing ${label}.`);
  }
  return value;
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

function normalizeColumnarUtxoDataItem(cols: UtxoColumnarColumns, rowIndex: number): UtxoDataItem {
  const senderAddress = splitAddressBase64(
    readColumnValue(cols.h1_sender_address, rowIndex, 'h1_sender_address'),
    'h1_sender_address',
  );
  const mintAddress = splitAddressBase64(
    readColumnValue(cols.h1_mint_address, rowIndex, 'h1_mint_address'),
    'h1_mint_address',
  );
  const eventType = readColumnValue(cols.event_type, rowIndex, 'event_type');
  if (eventType !== 'deposit' && eventType !== 'callback') {
    throw new Error(`Umbra indexer response has invalid event_type: ${String(eventType)}.`);
  }

  return {
    absoluteIndex: readBigint(
      readColumnValue(cols.absolute_index, rowIndex, 'absolute_index'),
      'absolute_index',
    ),
    treeIndex: readBigint(
      readColumnValue(cols.tree_index, rowIndex, 'tree_index'),
      'tree_index',
    ) as never,
    insertionIndex: readBigint(
      readColumnValue(cols.insertion_index, rowIndex, 'insertion_index'),
      'insertion_index',
    ) as never,
    finalCommitment: base64ToFixedBytes(
      readColumnValue(cols.final_commitment, rowIndex, 'final_commitment'),
      32,
      'final_commitment',
    ) as never,
    h1Components: {
      version: readU128ColumnValue(
        readColumnValue(cols.h1_version, rowIndex, 'h1_version'),
        'h1_version',
      ) as never,
      commitmentIndex: readU128ColumnValue(
        readColumnValue(cols.h1_commitment_index, rowIndex, 'h1_commitment_index'),
        'h1_commitment_index',
      ) as never,
      senderAddressLow: senderAddress.low as never,
      senderAddressHigh: senderAddress.high as never,
      relayerFixedSolFees: readBigint(
        readColumnValue(cols.h1_relayer_fixed_sol_fees, rowIndex, 'h1_relayer_fixed_sol_fees'),
        'h1_relayer_fixed_sol_fees',
      ) as never,
      mintAddressLow: mintAddress.low as never,
      mintAddressHigh: mintAddress.high as never,
      timestamp: {
        year: readBigint(readColumnValue(cols.h1_year, rowIndex, 'h1_year'), 'h1_year') as never,
        month: readBigint(
          readColumnValue(cols.h1_month, rowIndex, 'h1_month'),
          'h1_month',
        ) as never,
        day: readBigint(readColumnValue(cols.h1_day, rowIndex, 'h1_day'), 'h1_day') as never,
        hour: readBigint(readColumnValue(cols.h1_hour, rowIndex, 'h1_hour'), 'h1_hour') as never,
        minute: readBigint(
          readColumnValue(cols.h1_minute, rowIndex, 'h1_minute'),
          'h1_minute',
        ) as never,
        second: readBigint(
          readColumnValue(cols.h1_second, rowIndex, 'h1_second'),
          'h1_second',
        ) as never,
      },
      poolVolumeSpl: readBigint(
        readColumnValue(cols.h1_pool_volume_spl, rowIndex, 'h1_pool_volume_spl'),
        'h1_pool_volume_spl',
      ) as never,
      poolVolumeSol: readBigint(
        readColumnValue(cols.h1_pool_volume_sol, rowIndex, 'h1_pool_volume_sol'),
        'h1_pool_volume_sol',
      ) as never,
    },
    h1Hash: base64ToFixedBytes(
      readColumnValue(cols.h1_hash, rowIndex, 'h1_hash'),
      32,
      'h1_hash',
    ) as never,
    h2Hash: base64ToFixedBytes(
      readColumnValue(cols.h2_hash, rowIndex, 'h2_hash'),
      32,
      'h2_hash',
    ) as never,
    aesEncryptedData: base64ToBytes(
      readColumnValue(cols.aes_encrypted_data, rowIndex, 'aes_encrypted_data'),
      'aes_encrypted_data',
    ) as never,
    depositorX25519PublicKey: base64ToFixedBytes(
      readColumnValue(cols.depositor_x25519_public_key, rowIndex, 'depositor_x25519_public_key'),
      32,
      'depositor_x25519_public_key',
    ) as never,
    timestamp: readBigint(
      readColumnValue(cols.timestamp, rowIndex, 'timestamp'),
      'timestamp',
    ) as never,
    slot: readBigint(readColumnValue(cols.slot, rowIndex, 'slot'), 'slot') as never,
    eventType,
  };
}

export function createOffpayUmbraTreeSummaryFetcher(
  network: OffpayNetwork,
): TreeSummaryFetcherFunction {
  return getTreeSummaryFetcher({
    apiEndpoint: getUmbraIndexerEndpoint(network),
  });
}

export function createOffpayUmbraBatchMerkleProofFetcher(network: OffpayNetwork) {
  const sdkFetcher = getBatchMerkleProofFetcher({
    apiEndpoint: getUmbraIndexerEndpoint(network),
  });

  return async (
    treeIndex: bigint,
    insertionIndices: readonly bigint[],
  ): Promise<BatchMerkleProofResult> => {
    const startedAt = mark();
    const result = await sdkFetcher(treeIndex as never, insertionIndices as never);
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
