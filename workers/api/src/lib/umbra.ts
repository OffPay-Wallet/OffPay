import {
  IndexerReadError,
  ReadServiceClient,
  type BatchProofResponse as UmbraIndexerBatchProofResponse,
  type ProofResponse as UmbraIndexerProofResponse,
  type StatsResponse as UmbraIndexerStatsResponse,
  type TreeInfoResponse as UmbraIndexerTreeInfoResponse,
  type UtxoDataResponse as UmbraIndexerUtxoDataResponse,
  type UtxoResponse as UmbraIndexerUtxoResponse,
} from '@umbra-privacy/indexer-read-service-client';
import { createNetworkCacheKey, memoryCache } from './cache.js';
import { AppError } from './errors.js';
import { getRpcSlot } from './helius.js';
import { readTrimmedString } from './provider-utils.js';
import type { Bindings, Network } from './types.js';
import { isRecord } from './validation.js';

const DEFAULT_UMBRA_INDEXER_URLS: Readonly<Record<Network, string>> = {
  mainnet: 'https://utxo-indexer.api.umbraprivacy.com',
  devnet: 'https://utxo-indexer.api-devnet.umbraprivacy.com',
};
const DEFAULT_UMBRA_RELAYER_URLS: Readonly<Record<Network, string>> = {
  mainnet: 'https://relayer.api.umbraprivacy.com',
  devnet: 'https://relayer.api-devnet.umbraprivacy.com',
};
const DEFAULT_UMBRA_CIRCUIT_VERSION = 'v3';
const DEFAULT_UMBRA_MIN_SDK_VERSION = '3.0.0';
const UMBRA_BALANCE_CACHE_TTL_MS = 30_000;
const UMBRA_INDEXER_HEALTH_CACHE_TTL_MS = 30_000;
const UMBRA_INDEXER_SLOT_STALE_THRESHOLD: Readonly<Record<Network, number>> = {
  mainnet: 20_000,
  devnet: 20_000,
};
const UMBRA_INDEXER_SECONDS_STALE_THRESHOLD: Readonly<Record<Network, number>> = {
  mainnet: 120,
  devnet: 60,
};
const MAX_UMBRA_SANITIZE_DEPTH = 6;
const MAX_UMBRA_ARRAY_ITEMS = 200;
const UMBRA_SENSITIVE_RESPONSE_KEY_PATTERN =
  /(api[-_]?key|authorization|token|secret|private[-_]?key|seed|mnemonic|master[-_]?viewing[-_]?key|spending[-_]?key)/i;

const SHIELDED_BALANCE_PATH_CANDIDATES = [
  '/v1/privacy/shielded-balance',
  '/api/v1/privacy/shielded-balance',
  '/privacy/shielded-balance',
  '/api/privacy/shielded-balance',
] as const;

const SCAN_ANNOUNCEMENTS_PATH_CANDIDATES = [
  '/v1/privacy/scan-announcements',
  '/api/v1/privacy/scan-announcements',
  '/privacy/scan-announcements',
  '/api/privacy/scan-announcements',
] as const;

const REGISTER_VIEWING_KEY_PATH_CANDIDATES = [
  '/v1/privacy/register-viewing-key',
  '/api/v1/privacy/register-viewing-key',
  '/privacy/register-viewing-key',
  '/api/privacy/register-viewing-key',
] as const;

const UMBRA_UTXOS_PATH_CANDIDATES = [
  '/v1/utxos',
  '/api/v1/utxos',
  '/utxos',
  '/api/utxos',
  '/v1/umbra/utxos',
  '/api/v1/umbra/utxos',
  '/umbra/utxos',
  '/api/umbra/utxos',
] as const;

const UMBRA_TREE_PROOF_PATH_CANDIDATES = [
  '/v1/trees/:treeIndex/proof/:insertionIndex',
  '/api/v1/trees/:treeIndex/proof/:insertionIndex',
  '/trees/:treeIndex/proof/:insertionIndex',
  '/api/trees/:treeIndex/proof/:insertionIndex',
  '/v1/umbra/trees/:treeIndex/proof/:insertionIndex',
  '/api/v1/umbra/trees/:treeIndex/proof/:insertionIndex',
  '/umbra/trees/:treeIndex/proof/:insertionIndex',
  '/api/umbra/trees/:treeIndex/proof/:insertionIndex',
] as const;

const UMBRA_TREE_PROOFS_PATH_CANDIDATES = [
  '/v1/trees/:treeIndex/proofs',
  '/api/v1/trees/:treeIndex/proofs',
  '/trees/:treeIndex/proofs',
  '/api/trees/:treeIndex/proofs',
  '/v1/umbra/trees/:treeIndex/proofs',
  '/api/v1/umbra/trees/:treeIndex/proofs',
  '/umbra/trees/:treeIndex/proofs',
  '/api/umbra/trees/:treeIndex/proofs',
] as const;

const UMBRA_TREE_SUMMARIES_PATH_CANDIDATES = [
  '/v1/trees',
  '/api/v1/trees',
  '/trees',
  '/api/trees',
  '/v1/umbra/trees',
  '/api/v1/umbra/trees',
  '/umbra/trees',
  '/api/umbra/trees',
] as const;

const UMBRA_RELAYER_INFO_PATH_CANDIDATES = [
  '/v1/relayer/info',
] as const;

const UMBRA_CLAIM_PATH_CANDIDATES = [
  '/v1/claims',
] as const;

const UMBRA_CLAIM_STATUS_PATH_CANDIDATES = [
  '/v1/claims/:id',
] as const;

interface UmbraShieldedBalance {
  mint: string;
  amount: string;
  commitment: string;
}

interface UmbraShieldedBalanceRequest {
  walletAddress: string;
  network: Network;
}

interface UmbraShieldedBalanceResponse {
  address: string;
  shieldedBalances: UmbraShieldedBalance[];
}

type UmbraJsonPrimitive = string | number | boolean | null;
type UmbraJsonValue = UmbraJsonPrimitive | UmbraJsonObject | UmbraJsonValue[];

interface UmbraJsonObject {
  [key: string]: UmbraJsonValue;
}

interface UmbraScanAnnouncementsRequest {
  walletAddress: string;
  network: Network;
}

interface UmbraScanAnnouncementsResponse {
  announcements: UmbraJsonObject[];
}

interface UmbraRegisterViewingKeyRequest {
  walletAddress: string;
  viewingKeyPublicKey: string;
  network: Network;
}

interface UmbraRegisterViewingKeyResponse {
  registered: true;
}

interface UmbraUtxosRequest {
  network: Network;
  start?: string;
  end?: string;
  limit?: string;
}

interface UmbraUtxosResponse {
  network: Network;
  utxos: UmbraJsonObject[];
  cursor: string | null;
  hasMore: boolean;
  totalCount: string;
  startIndex: string;
  endIndex: string | null;
  highestIndexedInsertionIndex: string | null;
  fetchedAt: string;
}

interface UmbraTreeProofRequest {
  network: Network;
  treeIndex: number;
  insertionIndex: number;
}

interface UmbraTreeProofResponse {
  network: Network;
  treeIndex: number;
  insertionIndex: number;
  proof: UmbraJsonValue | null;
  root: string | null;
  leaf: string | null;
  fetchedAt: string;
}

interface UmbraTreeProofsRequest {
  network: Network;
  treeIndex: number;
  insertionIndexes: number[];
}

interface UmbraTreeProofsResponse {
  network: Network;
  treeIndex: number;
  proofs: UmbraJsonValue[];
  root: string | null;
  fetchedAt: string;
}

interface UmbraTreeSummary {
  treeIndex: string;
  numLeaves: string;
}

interface UmbraTreeSummariesRequest {
  network: Network;
}

interface UmbraTreeSummariesResponse {
  network: Network;
  trees: UmbraTreeSummary[];
  fetchedAt: string;
}

interface UmbraRelayerInfoRequest {
  network: Network;
}

interface UmbraRelayerInfoResponse {
  network: Network;
  relayer: UmbraJsonObject | null;
  endpoint: string;
  fetchedAt: string;
}

interface UmbraIndexerHealthRequest {
  network: Network;
}

interface UmbraIndexerHealthResponse {
  network: Network;
  endpoint: string;
  status: string;
  ready: boolean;
  storageReady: boolean;
  totalUtxos: string;
  latestAbsoluteIndex: string | null;
  latestTreeRoot: string | null;
  latestTreeLeaves: string | null;
  latestUtxoSlot: string | null;
  latestUtxoTimestamp: string | null;
  currentSolanaSlot: number | null;
  laggingBySlots: number | null;
  laggingBySeconds: number | null;
  stale: boolean;
  fetchedAt: string;
}

interface UmbraCircuitMetadata {
  circuitVersion: string;
  minSdkVersion: string;
}

interface UmbraClaimRequest {
  network: Network;
  payload: UmbraJsonObject;
}

interface UmbraClaimResponse {
  network: Network;
  claimId: string | null;
  status: string | null;
  result: UmbraJsonObject | null;
  fetchedAt: string;
}

interface UmbraClaimStatusRequest {
  network: Network;
  id: string;
}

interface UmbraClaimStatusResponse {
  network: Network;
  id: string;
  status: string | null;
  result: UmbraJsonObject | null;
  fetchedAt: string;
}

type UmbraFetchImplementation = typeof fetch;

interface UmbraHttpResult {
  response: Response;
  payload: unknown;
}

interface UmbraJsonFetchOptions {
  baseUrl?: string;
}

let umbraFetchImplementation: UmbraFetchImplementation = fetch;

function isUmbraLocalTestMode(bindings: Bindings): boolean {
  const value = bindings.UMBRA_LOCAL_TEST_MODE;
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function setUmbraFetchImplementation(implementation: UmbraFetchImplementation): void {
  umbraFetchImplementation = implementation;
}

function resetUmbraFetchImplementation(): void {
  umbraFetchImplementation = fetch;
}

function normalizeUmbraHttpUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol.');
    }

    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Umbra provider configuration is unavailable.',
      retryable: true,
    });
  }
}

function getUmbraIndexerUrl(bindings: Bindings, network: Network): string {
  const configuredUrl = network === 'mainnet'
    ? bindings.UMBRA_INDEXER_URL_MAINNET?.trim()
    : bindings.UMBRA_INDEXER_URL_DEVNET?.trim();

  return normalizeUmbraHttpUrl(
    configuredUrl && configuredUrl.length > 0
      ? configuredUrl
      : DEFAULT_UMBRA_INDEXER_URLS[network],
  );
}

function getUmbraRelayerUrl(bindings: Bindings, network: Network): string {
  const configuredUrl = network === 'mainnet'
    ? bindings.UMBRA_RELAYER_URL_MAINNET?.trim()
    : bindings.UMBRA_RELAYER_URL_DEVNET?.trim();

  return normalizeUmbraHttpUrl(
    configuredUrl && configuredUrl.length > 0
      ? configuredUrl
      : DEFAULT_UMBRA_RELAYER_URLS[network],
  );
}

function getUmbraCircuitMetadata(bindings: Bindings): UmbraCircuitMetadata {
  return {
    circuitVersion: bindings.UMBRA_CIRCUIT_VERSION?.trim() || DEFAULT_UMBRA_CIRCUIT_VERSION,
    minSdkVersion: bindings.UMBRA_MIN_SDK_VERSION?.trim() || DEFAULT_UMBRA_MIN_SDK_VERSION,
  };
}

function buildUmbraHeaders(bindings: Bindings): Headers {
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  const apiKey = bindings.UMBRA_API_KEY?.trim();
  if (apiKey) {
    headers.set('x-api-key', apiKey);
  }
  return headers;
}

function buildUmbraUrl(
  path: string,
  queryParams?: Readonly<Record<string, string>>,
  baseUrl?: string,
): string {
  if (!baseUrl) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Umbra provider configuration is unavailable.',
      retryable: true,
    });
  }

  const url = new URL(`${baseUrl}${path}`);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function fetchUmbraJson(
  bindings: Bindings,
  pathCandidates: readonly string[],
  init: Omit<RequestInit, 'headers'> & { headers?: HeadersInit },
  unavailableMessage: string,
  queryParams?: Readonly<Record<string, string>>,
  options: UmbraJsonFetchOptions = {},
): Promise<UmbraHttpResult> {
  const headers = new Headers(init.headers);
  buildUmbraHeaders(bindings).forEach((value, key) => {
    headers.set(key, value);
  });

  let lastNotFoundResult: UmbraHttpResult | null = null;
  const baseUrl = options.baseUrl;

  for (const path of pathCandidates) {
    let response: Response;
    try {
      response = await umbraFetchImplementation(buildUmbraUrl(path, queryParams, baseUrl), {
        ...init,
        headers,
      });
    } catch (error) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: unavailableMessage,
        retryable: true,
        cause: error,
      });
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 404 || response.status === 405) {
      lastNotFoundResult = { response, payload };
      continue;
    }

    return { response, payload };
  }

  if (lastNotFoundResult) {
    return lastNotFoundResult;
  }

  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: unavailableMessage,
    retryable: true,
  });
}

function createUmbraIndexerFetch(bindings: Bindings): UmbraFetchImplementation {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const apiKey = bindings.UMBRA_API_KEY?.trim();
    if (apiKey && !headers.has('x-api-key')) {
      headers.set('x-api-key', apiKey);
    }

    return umbraFetchImplementation(input, {
      ...init,
      headers,
    });
  };
}

function createUmbraIndexerClient(bindings: Bindings, network: Network): ReadServiceClient {
  return new ReadServiceClient({
    endpoint: getUmbraIndexerUrl(bindings, network),
    fetch: createUmbraIndexerFetch(bindings),
  });
}

function toUmbraUnavailable(message: string, cause?: unknown): AppError {
  return new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message,
    retryable: true,
    cause,
  });
}

function toUmbraIndexerUnavailable(message: string, cause?: unknown): AppError {
  if (cause instanceof AppError) {
    return cause;
  }

  if (cause instanceof IndexerReadError && cause.statusCode === 400) {
    return new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
      cause,
    });
  }

  return toUmbraUnavailable(message, cause);
}

function readPrimitiveString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  return null;
}

function sanitizeUmbraJsonValue(value: unknown, depth = 0): UmbraJsonValue | undefined {
  if (depth > MAX_UMBRA_SANITIZE_DEPTH) {
    return null;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_UMBRA_ARRAY_ITEMS)
      .map((entry) => sanitizeUmbraJsonValue(entry, depth + 1))
      .filter((entry): entry is UmbraJsonValue => entry !== undefined);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const sanitizedEntries: Array<[string, UmbraJsonValue]> = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    if (UMBRA_SENSITIVE_RESPONSE_KEY_PATTERN.test(key)) {
      continue;
    }

    const sanitizedValue = sanitizeUmbraJsonValue(nestedValue, depth + 1);
    if (sanitizedValue !== undefined) {
      sanitizedEntries.push([key, sanitizedValue]);
    }
  }

  return Object.fromEntries(sanitizedEntries);
}

function sanitizeUmbraJsonObject(value: unknown): UmbraJsonObject | null {
  const sanitizedValue = sanitizeUmbraJsonValue(value);
  return sanitizedValue && !Array.isArray(sanitizedValue) && isRecord(sanitizedValue)
    ? sanitizedValue
    : null;
}

function readRecordArrayCandidates(payload: unknown, candidateKeys: readonly string[]): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  for (const key of candidateKeys) {
    const directValue = payload[key];
    if (Array.isArray(directValue)) {
      return directValue;
    }
  }

  const nestedData = payload.data;
  if (isRecord(nestedData)) {
    for (const key of candidateKeys) {
      const nestedValue = nestedData[key];
      if (Array.isArray(nestedValue)) {
        return nestedValue;
      }
    }
  }

  return null;
}

function readShieldedBalanceEntries(payload: unknown): UmbraShieldedBalance[] {
  const entries = readRecordArrayCandidates(payload, ['shieldedBalances', 'balances', 'items', 'results']);
  if (!entries) {
    throw toUmbraUnavailable('Umbra shielded balance data is temporarily unavailable.');
  }

  const balances: UmbraShieldedBalance[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const mint =
      readTrimmedString(entry.mint) ??
      readTrimmedString(entry.mintAddress) ??
      readTrimmedString(entry.tokenMint);
    const amount =
      readPrimitiveString(entry.amount) ??
      readPrimitiveString(entry.balance) ??
      readPrimitiveString(entry.encryptedBalance);
    const commitment =
      readTrimmedString(entry.commitment) ??
      readTrimmedString(entry.commitmentHash) ??
      readTrimmedString(entry.balanceCommitment);

    if (!mint || !amount || !commitment) {
      continue;
    }

    balances.push({
      mint,
      amount,
      commitment,
    });
  }

  return balances;
}

function readAnnouncementEntries(payload: unknown): UmbraJsonObject[] {
  const entries = readRecordArrayCandidates(payload, ['announcements', 'items', 'results']);
  if (!entries) {
    throw toUmbraUnavailable('Umbra announcement scanning is temporarily unavailable.');
  }

  const announcements: UmbraJsonObject[] = [];
  for (const entry of entries) {
    const sanitizedEntry = sanitizeUmbraJsonObject(entry);
    if (sanitizedEntry) {
      announcements.push(sanitizedEntry);
    }
  }

  return announcements;
}

function createFetchedAt(): string {
  return new Date().toISOString();
}

function replaceUmbraPathParams(
  pathCandidates: readonly string[],
  params: Readonly<Record<string, string | number>>,
): string[] {
  return pathCandidates.map((path) => {
    let nextPath = path;
    for (const [key, value] of Object.entries(params)) {
      nextPath = nextPath.replaceAll(`:${key}`, encodeURIComponent(value.toString()));
    }

    return nextPath;
  });
}

function readOptionalPayloadString(payload: unknown, candidateKeys: readonly string[]): string | null {
  if (isRecord(payload)) {
    for (const key of candidateKeys) {
      const directValue = readPrimitiveString(payload[key]);
      if (directValue) {
        return directValue;
      }
    }

    if (isRecord(payload.data)) {
      for (const key of candidateKeys) {
        const nestedValue = readPrimitiveString(payload.data[key]);
        if (nestedValue) {
          return nestedValue;
        }
      }
    }
  }

  return null;
}

function readSanitizedObjectEntries(payload: unknown, candidateKeys: readonly string[]): UmbraJsonObject[] {
  const entries = readRecordArrayCandidates(payload, candidateKeys);
  if (!entries) {
    return [];
  }

  const sanitizedEntries: UmbraJsonObject[] = [];
  for (const entry of entries) {
    const sanitizedEntry = sanitizeUmbraJsonObject(entry);
    if (sanitizedEntry) {
      sanitizedEntries.push(sanitizedEntry);
    }
  }

  return sanitizedEntries;
}

function readUmbraProofValue(payload: unknown): UmbraJsonValue | null {
  if (isRecord(payload)) {
    const directProof = sanitizeUmbraJsonValue(payload.proof);
    if (directProof !== undefined) {
      return directProof;
    }

    const directMerkleProof = sanitizeUmbraJsonValue(payload.merkleProof);
    if (directMerkleProof !== undefined) {
      return directMerkleProof;
    }

    if (isRecord(payload.data)) {
      const nestedProof = sanitizeUmbraJsonValue(payload.data.proof);
      if (nestedProof !== undefined) {
        return nestedProof;
      }

      const nestedMerkleProof = sanitizeUmbraJsonValue(payload.data.merkleProof);
      if (nestedMerkleProof !== undefined) {
        return nestedMerkleProof;
      }
    }
  }

  return sanitizeUmbraJsonValue(payload) ?? null;
}

function readUmbraProofEntries(payload: unknown): UmbraJsonValue[] {
  const entries = readRecordArrayCandidates(payload, ['proofs', 'items', 'results', 'data']);
  if (!entries) {
    const singleProof = readUmbraProofValue(payload);
    return singleProof === null ? [] : [singleProof];
  }

  return entries
    .map((entry) => sanitizeUmbraJsonValue(entry))
    .filter((entry): entry is UmbraJsonValue => entry !== undefined);
}

function bigintToString(value: bigint | null | undefined): string | null {
  return typeof value === 'bigint' ? value.toString() : null;
}

function bigintToSafeNumber(value: bigint | null | undefined): number | null {
  if (typeof value !== 'bigint') {
    return null;
  }

  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : null;
}

function requestRangeToBigint(value: string | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}

function serializeUmbraIndexerUtxo(utxo: UmbraIndexerUtxoDataResponse): UmbraJsonObject {
  return {
    absolute_index: utxo.absolute_index.toString(),
    tree_index: utxo.tree_index.toString(),
    insertion_index: utxo.insertion_index.toString(),
    final_commitment: utxo.final_commitment,
    h1_hash: utxo.h1_hash,
    h2_hash: utxo.h2_hash,
    h1_version: utxo.h1_version,
    h1_commitment_index: utxo.h1_commitment_index,
    h1_sender_address: utxo.h1_sender_address,
    h1_mint_address: utxo.h1_mint_address,
    h1_relayer_fixed_sol_fees: utxo.h1_relayer_fixed_sol_fees.toString(),
    h1_year: utxo.h1_year.toString(),
    h1_month: utxo.h1_month.toString(),
    h1_day: utxo.h1_day.toString(),
    h1_hour: utxo.h1_hour.toString(),
    h1_minute: utxo.h1_minute.toString(),
    h1_second: utxo.h1_second.toString(),
    h1_pool_volume_spl: utxo.h1_pool_volume_spl.toString(),
    h1_pool_volume_sol: utxo.h1_pool_volume_sol.toString(),
    aes_encrypted_data: utxo.aes_encrypted_data,
    depositor_x25519_public_key: utxo.depositor_x25519_public_key,
    timestamp: utxo.timestamp.toString(),
    slot: utxo.slot.toString(),
    event_type: utxo.event_type,
  };
}

function serializeUmbraIndexerUtxoResponse(response: UmbraIndexerUtxoResponse): Omit<
  UmbraUtxosResponse,
  'network' | 'fetchedAt'
> {
  const firstItem = response.items[0];
  return {
    utxos: response.items.map(serializeUmbraIndexerUtxo),
    cursor: bigintToString(response.next_cursor),
    hasMore: response.has_more,
    totalCount: response.total_count.toString(),
    startIndex: response.start_index.toString(),
    endIndex: bigintToString(response.end_index),
    highestIndexedInsertionIndex: firstItem
      ? response.items.reduce((highest, utxo) => (
        utxo.insertion_index > highest ? utxo.insertion_index : highest
      ), firstItem.insertion_index).toString()
      : null,
  };
}

function serializeUmbraProofResponse(proof: UmbraIndexerProofResponse): UmbraJsonObject {
  return {
    root: proof.root,
    tree_index: proof.tree_index.toString(),
    insertion_index: proof.insertion_index.toString(),
    proof: proof.proof,
    leaf: proof.leaf,
  };
}

function serializeUmbraBatchProofResponse(proofBatch: UmbraIndexerBatchProofResponse): UmbraJsonValue[] {
  return proofBatch.proofs.map((proof) => ({
    insertion_index: proof.insertion_index.toString(),
    proof: proof.proof,
    leaf: proof.leaf,
  }));
}

function readUmbraTreeSummaries(payload: unknown): UmbraTreeSummary[] {
  const entries = readRecordArrayCandidates(payload, ['trees', 'items', 'results', 'data']);
  if (!entries) {
    throw toUmbraIndexerUnavailable('Umbra tree summary is temporarily unavailable.');
  }

  const trees: UmbraTreeSummary[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const treeIndex =
      readPrimitiveString(entry.treeIndex) ??
      readPrimitiveString(entry.tree_index) ??
      readPrimitiveString(entry.index);
    const numLeaves =
      readPrimitiveString(entry.numLeaves) ??
      readPrimitiveString(entry.num_leaves) ??
      readPrimitiveString(entry.leaves) ??
      readPrimitiveString(entry.leafCount) ??
      readPrimitiveString(entry.leaf_count);

    if (treeIndex && numLeaves && /^\d+$/.test(treeIndex) && /^\d+$/.test(numLeaves)) {
      trees.push({ treeIndex, numLeaves });
    }
  }

  if (trees.length === 0) {
    throw toUmbraIndexerUnavailable('Umbra tree summary is temporarily unavailable.');
  }

  return trees;
}

function readRelayerInfo(payload: unknown): UmbraJsonObject | null {
  if (isRecord(payload)) {
    const directRelayer = sanitizeUmbraJsonObject(payload.relayer);
    if (directRelayer) {
      return directRelayer;
    }

    const nestedData = sanitizeUmbraJsonObject(payload.data);
    if (nestedData) {
      return nestedData;
    }
  }

  return sanitizeUmbraJsonObject(payload);
}

function readClaimResult(payload: unknown): UmbraJsonObject | null {
  if (isRecord(payload) && isRecord(payload.data)) {
    return sanitizeUmbraJsonObject(payload.data);
  }

  return sanitizeUmbraJsonObject(payload);
}

function buildUmbraUtxosQuery(request: UmbraUtxosRequest): Record<string, string> {
  const query: Record<string, string> = {
    network: request.network,
  };

  if (request.start !== undefined) {
    query.start = request.start.toString();
  }

  if (request.end !== undefined) {
    query.end = request.end.toString();
  }

  if (request.limit !== undefined) {
    query.limit = request.limit.toString();
  }

  return query;
}

async function getShieldedBalanceMetadata(
  bindings: Bindings,
  request: UmbraShieldedBalanceRequest,
): Promise<UmbraShieldedBalanceResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      address: request.walletAddress,
      shieldedBalances: [],
    };
  }

  const cacheKey = createNetworkCacheKey(request.network, 'umbra:shielded-balance', [request.walletAddress]);

  return memoryCache.getOrSet(cacheKey, UMBRA_BALANCE_CACHE_TTL_MS, async () => {
    const { response, payload } = await fetchUmbraJson(
      bindings,
      SHIELDED_BALANCE_PATH_CANDIDATES,
      {
        method: 'GET',
      },
      'Umbra shielded balance metadata is temporarily unavailable.',
      {
        wallet: request.walletAddress,
        network: request.network,
      },
      {
        baseUrl: getUmbraIndexerUrl(bindings, request.network),
      },
    );

    if (!response.ok) {
      throw toUmbraUnavailable('Umbra shielded balance metadata is temporarily unavailable.');
    }

    return {
      address: request.walletAddress,
      shieldedBalances: readShieldedBalanceEntries(payload),
    };
  });
}

async function scanUmbraAnnouncements(
  bindings: Bindings,
  request: UmbraScanAnnouncementsRequest,
): Promise<UmbraScanAnnouncementsResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      announcements: [],
    };
  }

  const { response, payload } = await fetchUmbraJson(
    bindings,
    SCAN_ANNOUNCEMENTS_PATH_CANDIDATES,
    {
      method: 'GET',
    },
    'Umbra announcement scanning is temporarily unavailable.',
    {
      wallet: request.walletAddress,
      network: request.network,
    },
    {
      baseUrl: getUmbraIndexerUrl(bindings, request.network),
    },
  );

  if (!response.ok) {
    throw toUmbraUnavailable('Umbra announcement scanning is temporarily unavailable.');
  }

  return {
    announcements: readAnnouncementEntries(payload),
  };
}

async function registerUmbraViewingKey(
  bindings: Bindings,
  request: UmbraRegisterViewingKeyRequest,
): Promise<UmbraRegisterViewingKeyResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      registered: true,
    };
  }

  const { response, payload } = await fetchUmbraJson(
    bindings,
    REGISTER_VIEWING_KEY_PATH_CANDIDATES,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: request.walletAddress,
        viewingKeyPublicKey: request.viewingKeyPublicKey,
        network: request.network,
      }),
    },
    'Umbra viewing-key registration is temporarily unavailable.',
    undefined,
    {
      baseUrl: getUmbraRelayerUrl(bindings, request.network),
    },
  );

  if (!response.ok) {
    throw toUmbraUnavailable('Umbra viewing-key registration is temporarily unavailable.');
  }

  if (isRecord(payload) && payload.registered === false) {
    throw toUmbraUnavailable('Umbra viewing-key registration is temporarily unavailable.');
  }

  return {
    registered: true,
  };
}

async function getUmbraUtxos(
  bindings: Bindings,
  request: UmbraUtxosRequest,
): Promise<UmbraUtxosResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      utxos: [],
      cursor: null,
      hasMore: false,
      totalCount: '0',
      startIndex: request.start?.toString() ?? '0',
      endIndex: null,
      highestIndexedInsertionIndex: null,
      fetchedAt: createFetchedAt(),
    };
  }

  try {
    const client = createUmbraIndexerClient(bindings, request.network);
    const params: { start?: bigint; end?: bigint; limit?: bigint } = {};
    const start = requestRangeToBigint(request.start);
    const end = requestRangeToBigint(request.end);
    const limit = requestRangeToBigint(request.limit);
    if (start !== undefined) {
      params.start = start;
    }
    if (end !== undefined) {
      params.end = end;
    }
    if (limit !== undefined) {
      params.limit = limit;
    }

    const response = await client.getUtxoData(params);

    return {
      network: request.network,
      ...serializeUmbraIndexerUtxoResponse(response),
      fetchedAt: createFetchedAt(),
    };
  } catch (error) {
    throw toUmbraIndexerUnavailable('Umbra UTXO indexer is temporarily unavailable.', error);
  }
}

async function getUmbraTreeProof(
  bindings: Bindings,
  request: UmbraTreeProofRequest,
): Promise<UmbraTreeProofResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      treeIndex: request.treeIndex,
      insertionIndex: request.insertionIndex,
      proof: null,
      root: null,
      leaf: null,
      fetchedAt: createFetchedAt(),
    };
  }

  try {
    const client = createUmbraIndexerClient(bindings, request.network);
    const proof = await client.getProof(BigInt(request.treeIndex), BigInt(request.insertionIndex));

    return {
      network: request.network,
      treeIndex: request.treeIndex,
      insertionIndex: request.insertionIndex,
      proof: serializeUmbraProofResponse(proof),
      root: proof.root,
      leaf: proof.leaf,
      fetchedAt: createFetchedAt(),
    };
  } catch (error) {
    throw toUmbraIndexerUnavailable('Umbra Merkle proof lookup is temporarily unavailable.', error);
  }
}

async function getUmbraTreeProofs(
  bindings: Bindings,
  request: UmbraTreeProofsRequest,
): Promise<UmbraTreeProofsResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      treeIndex: request.treeIndex,
      proofs: [],
      root: null,
      fetchedAt: createFetchedAt(),
    };
  }

  try {
    const client = createUmbraIndexerClient(bindings, request.network);
    const proofBatch = await client.getBatchProof(
      BigInt(request.treeIndex),
      request.insertionIndexes.map((insertionIndex) => BigInt(insertionIndex)),
    );

    return {
      network: request.network,
      treeIndex: request.treeIndex,
      proofs: serializeUmbraBatchProofResponse(proofBatch),
      root: proofBatch.root,
      fetchedAt: createFetchedAt(),
    };
  } catch (error) {
    throw toUmbraIndexerUnavailable('Umbra Merkle proof batch lookup is temporarily unavailable.', error);
  }
}

async function getUmbraTreeSummaries(
  bindings: Bindings,
  request: UmbraTreeSummariesRequest,
): Promise<UmbraTreeSummariesResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      trees: [],
      fetchedAt: createFetchedAt(),
    };
  }

  const { response, payload } = await fetchUmbraJson(
    bindings,
    UMBRA_TREE_SUMMARIES_PATH_CANDIDATES,
    {
      method: 'GET',
    },
    'Umbra tree summary is temporarily unavailable.',
    undefined,
    {
      baseUrl: getUmbraIndexerUrl(bindings, request.network),
    },
  );

  if (!response.ok) {
    throw toUmbraIndexerUnavailable('Umbra tree summary is temporarily unavailable.');
  }

  return {
    network: request.network,
    trees: readUmbraTreeSummaries(payload),
    fetchedAt: createFetchedAt(),
  };
}

async function getUmbraRelayerInfo(
  bindings: Bindings,
  request: UmbraRelayerInfoRequest,
): Promise<UmbraRelayerInfoResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      relayer: null,
      endpoint: getUmbraRelayerUrl(bindings, request.network),
      fetchedAt: createFetchedAt(),
    };
  }

  const { response, payload } = await fetchUmbraJson(
    bindings,
    UMBRA_RELAYER_INFO_PATH_CANDIDATES,
    {
      method: 'GET',
    },
    'Umbra relayer metadata is temporarily unavailable.',
    {
      network: request.network,
    },
    {
      baseUrl: getUmbraRelayerUrl(bindings, request.network),
    },
  );

  if (!response.ok) {
    throw toUmbraUnavailable('Umbra relayer metadata is temporarily unavailable.');
  }

  return {
    network: request.network,
    relayer: readRelayerInfo(payload),
    endpoint: getUmbraRelayerUrl(bindings, request.network),
    fetchedAt: createFetchedAt(),
  };
}

async function readCurrentSolanaSlot(bindings: Bindings, network: Network): Promise<number | null> {
  try {
    return (await getRpcSlot(bindings, network)).slot;
  } catch {
    return null;
  }
}

function isUmbraIndexerStale(
  network: Network,
  ready: boolean,
  storageReady: boolean,
  laggingBySlots: number | null,
  laggingBySeconds: number | null,
): boolean {
  if (!ready || !storageReady) {
    return true;
  }

  if (laggingBySlots !== null && laggingBySlots > UMBRA_INDEXER_SLOT_STALE_THRESHOLD[network]) {
    return true;
  }

  return laggingBySeconds !== null && laggingBySeconds > UMBRA_INDEXER_SECONDS_STALE_THRESHOLD[network];
}

async function getUmbraIndexerHealth(
  bindings: Bindings,
  request: UmbraIndexerHealthRequest,
): Promise<UmbraIndexerHealthResponse> {
  const endpoint = getUmbraIndexerUrl(bindings, request.network);
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      endpoint,
      status: 'local-test',
      ready: true,
      storageReady: true,
      totalUtxos: '0',
      latestAbsoluteIndex: null,
      latestTreeRoot: null,
      latestTreeLeaves: null,
      latestUtxoSlot: null,
      latestUtxoTimestamp: null,
      currentSolanaSlot: null,
      laggingBySlots: null,
      laggingBySeconds: null,
      stale: false,
      fetchedAt: createFetchedAt(),
    };
  }

  const cacheKey = createNetworkCacheKey(request.network, 'umbra:indexer-health', [endpoint]);
  return memoryCache.getOrSet(cacheKey, UMBRA_INDEXER_HEALTH_CACHE_TTL_MS, async () => {
    try {
      const client = createUmbraIndexerClient(bindings, request.network);
      let status = 'unknown';

      try {
        const detailedHealth = await client.healthDetailed();
        status = detailedHealth.status || status;
      } catch {
        // Some deployments only expose readiness/stats; do not fail health on optional metadata.
      }

      const [readiness, stats]: [
        { ready: boolean; storage: boolean },
        UmbraIndexerStatsResponse,
      ] = await Promise.all([
        client.readiness(),
        client.getStats(),
      ]);

      let latestUtxo: UmbraIndexerUtxoDataResponse | null = null;
      let latestTreeInfo: UmbraIndexerTreeInfoResponse | null = null;
      if (stats.latest_absolute_index !== null) {
        latestUtxo = await client.getUtxo(stats.latest_absolute_index);
        if (latestUtxo) {
          latestTreeInfo = await client.getTreeInfo(latestUtxo.tree_index);
        }
      } else {
        try {
          latestTreeInfo = await client.getTreeInfo(0n);
        } catch {
          latestTreeInfo = null;
        }
      }

      const currentSolanaSlot = await readCurrentSolanaSlot(bindings, request.network);
      const latestUtxoSlot = bigintToSafeNumber(latestUtxo?.slot);
      const latestUtxoTimestamp = bigintToSafeNumber(latestUtxo?.timestamp);
      const laggingBySlots =
        currentSolanaSlot !== null && latestUtxoSlot !== null
          ? Math.max(0, currentSolanaSlot - latestUtxoSlot)
          : null;
      const laggingBySeconds =
        latestUtxoTimestamp !== null
          ? Math.max(0, Math.floor(Date.now() / 1000) - latestUtxoTimestamp)
          : null;
      const stale = isUmbraIndexerStale(
        request.network,
        readiness.ready,
        readiness.storage,
        laggingBySlots,
        laggingBySeconds,
      );

      return {
        network: request.network,
        endpoint,
        status,
        ready: readiness.ready,
        storageReady: readiness.storage,
        totalUtxos: stats.total_utxos.toString(),
        latestAbsoluteIndex: bigintToString(stats.latest_absolute_index),
        latestTreeRoot: latestTreeInfo?.root ?? null,
        latestTreeLeaves: bigintToString(latestTreeInfo?.num_leaves),
        latestUtxoSlot: bigintToString(latestUtxo?.slot),
        latestUtxoTimestamp: bigintToString(latestUtxo?.timestamp),
        currentSolanaSlot,
        laggingBySlots,
        laggingBySeconds,
        stale,
        fetchedAt: createFetchedAt(),
      };
    } catch (error) {
      throw toUmbraIndexerUnavailable('Umbra indexer health is temporarily unavailable.', error);
    }
  });
}

async function submitUmbraClaim(
  bindings: Bindings,
  request: UmbraClaimRequest,
): Promise<UmbraClaimResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      claimId: 'local-test-claim',
      status: 'submitted',
      result: {
        claimId: 'local-test-claim',
        status: 'submitted',
      },
      fetchedAt: createFetchedAt(),
    };
  }

  const body = {
    ...request.payload,
    network: request.network,
  };

  const { response, payload } = await fetchUmbraJson(
    bindings,
    UMBRA_CLAIM_PATH_CANDIDATES,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    'Umbra claim submission is temporarily unavailable.',
    undefined,
    {
      baseUrl: getUmbraRelayerUrl(bindings, request.network),
    },
  );

  if (!response.ok) {
    const message = readOptionalPayloadString(payload, ["message", "error"]) ?? "Umbra claim submission is temporarily unavailable.";
    const status = response.status >= 400 && response.status < 600 ? response.status : 503;
    throw new AppError({
      status: status >= 500 ? status : status === 400 ? 400 : status,
      code: status >= 500 ? "UPSTREAM_UNAVAILABLE" : "INVALID_REQUEST",
      message,
      retryable: status >= 500,
    });
  }

  return {
    network: request.network,
    claimId: readOptionalPayloadString(payload, [
      'requestId',
      'request_id',
      'claimId',
      'claim_id',
      'id',
    ]),
    status: readOptionalPayloadString(payload, ['status', 'state']),
    result: readClaimResult(payload),
    fetchedAt: createFetchedAt(),
  };
}

async function getUmbraClaimStatus(
  bindings: Bindings,
  request: UmbraClaimStatusRequest,
): Promise<UmbraClaimStatusResponse> {
  if (isUmbraLocalTestMode(bindings)) {
    return {
      network: request.network,
      id: request.id,
      status: 'unknown',
      result: null,
      fetchedAt: createFetchedAt(),
    };
  }

  const { response, payload } = await fetchUmbraJson(
    bindings,
    replaceUmbraPathParams(UMBRA_CLAIM_STATUS_PATH_CANDIDATES, {
      id: request.id,
    }),
    {
      method: 'GET',
    },
    'Umbra claim status is temporarily unavailable.',
    {
      network: request.network,
    },
    {
      baseUrl: getUmbraRelayerUrl(bindings, request.network),
    },
  );

  if (!response.ok) {
    throw toUmbraUnavailable('Umbra claim status is temporarily unavailable.');
  }

  return {
    network: request.network,
    id: request.id,
    status: readOptionalPayloadString(payload, ['status', 'state']),
    result: readClaimResult(payload),
    fetchedAt: createFetchedAt(),
  };
}

export {
  DEFAULT_UMBRA_CIRCUIT_VERSION,
  DEFAULT_UMBRA_INDEXER_URLS,
  DEFAULT_UMBRA_MIN_SDK_VERSION,
  DEFAULT_UMBRA_RELAYER_URLS,
  UMBRA_BALANCE_CACHE_TTL_MS,
  UMBRA_INDEXER_HEALTH_CACHE_TTL_MS,
  getShieldedBalanceMetadata,
  getUmbraCircuitMetadata,
  getUmbraClaimStatus,
  getUmbraIndexerHealth,
  getUmbraIndexerUrl,
  getUmbraRelayerInfo,
  getUmbraRelayerUrl,
  getUmbraTreeProof,
  getUmbraTreeProofs,
  getUmbraTreeSummaries,
  getUmbraUtxos,
  registerUmbraViewingKey,
  resetUmbraFetchImplementation,
  scanUmbraAnnouncements,
  setUmbraFetchImplementation,
  submitUmbraClaim,
  type UmbraClaimRequest,
  type UmbraClaimResponse,
  type UmbraClaimStatusRequest,
  type UmbraClaimStatusResponse,
  type UmbraCircuitMetadata,
  type UmbraFetchImplementation,
  type UmbraIndexerHealthRequest,
  type UmbraIndexerHealthResponse,
  type UmbraJsonObject,
  type UmbraJsonPrimitive,
  type UmbraJsonValue,
  type UmbraRelayerInfoRequest,
  type UmbraRelayerInfoResponse,
  type UmbraRegisterViewingKeyRequest,
  type UmbraRegisterViewingKeyResponse,
  type UmbraScanAnnouncementsRequest,
  type UmbraScanAnnouncementsResponse,
  type UmbraShieldedBalance,
  type UmbraShieldedBalanceRequest,
  type UmbraShieldedBalanceResponse,
  type UmbraTreeProofRequest,
  type UmbraTreeProofResponse,
  type UmbraTreeProofsRequest,
  type UmbraTreeProofsResponse,
  type UmbraTreeSummariesResponse,
  type UmbraUtxosRequest,
  type UmbraUtxosResponse,
};
