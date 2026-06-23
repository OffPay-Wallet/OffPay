import { sha256 } from '@noble/hashes/sha2.js';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  deriveNullifierFromModifiedGenerationIndex,
  expandModifiedGenerationIndex,
  getEphemeralUtxoPoseidonPrivateKeyDeriver,
  getMasterViewingKeyX25519KeypairDeriver,
  getPoseidonPrivateKeyDeriver,
  getTokenEncryptionX25519KeypairDeriver as getUserAccountX25519KeypairDeriver,
} from '@umbra-privacy/sdk/crypto/key-derivation';
import { getPoseidonHasher } from '@umbra-privacy/sdk/crypto/poseidon';
import {
  currentMasterSeedScheme,
  withMasterSeedScheme,
} from '@umbra-privacy/sdk/master-seed-schemes';
import type { MasterSeedScheme } from '@umbra-privacy/sdk/master-seed-schemes';
import { isKeyConsistencyError } from '@umbra-privacy/sdk/errors';
import { getAesDecryptor } from '@umbra-privacy/sdk/crypto/aes';
import { getMintEncryptionKeyRotatorFunction } from '@umbra-privacy/sdk/account';
import {
  getBurnableStealthPoolNoteScannerFunction as getClaimableUtxoScannerFunction,
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction as getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfBurnableStealthPoolNoteIntoETABurnerFunction as getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
} from '@umbra-privacy/sdk/burn';
import {
  getATAIntoETADirectDepositorFunction as getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getATAIntoReceiverBurnableStealthPoolNoteCreatorFunction as getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction as getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
} from '@umbra-privacy/sdk/deposit';
import {
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction as getLegacyEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction as getLegacyEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getMintEncryptionKeyRotatorFunction as getLegacyMintEncryptionKeyRotatorFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction as getLegacyPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction as getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction as getLegacyReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfClaimableUtxoToEncryptedBalanceClaimerFunction as getLegacySelfClaimableUtxoToEncryptedBalanceClaimerFunction,
  getUserAccountQuerierFunction as getLegacyUserAccountQuerierFunction,
  getUserRegistrationFunction as getLegacyUserRegistrationFunction,
} from '@umbra-privacy/sdk-legacy';
import {
  getEncryptedBalanceQuerierFunction,
  getUserAccountQuerierFunction,
} from '@umbra-privacy/sdk/query';
import { getUserRegistrationFunction } from '@umbra-privacy/sdk/registration';
import { getETAIntoATAWithdrawerFunction as getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction } from '@umbra-privacy/sdk/withdrawal';
import {
  decodeEncryptedTokenAccount,
  decodeEncryptedUserAccount,
} from '@umbra-privacy/umbra-codama';

import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { getUmbraFriendlyErrorMessage } from '@/lib/umbra/umbra-error-messages';
import {
  assertRecipientAddress,
  assertUmbraComputationFinalized,
  assertWalletAddress,
  collectSignaturesFromResult,
  getUmbraPreferredSignature,
  getUmbraPublicCreateUtxoSignature,
} from '@/lib/umbra/umbra-result-helpers';
import {
  assertPositiveAtomicAmount,
  assertUmbraTransactionSignaturesLanded,
  isUmbraInstructionFallbackNotFound,
  sleep,
} from '@/lib/umbra/umbra-tx-helpers';
import { createUmbraSignerForWallet } from '@/lib/umbra/umbra-signer';
import {
  assertUmbraClaimCompleted,
  createOffpayUmbraBatchMerkleProofFetcher,
  createOffpayUmbraClaimRelayer,
  createOffpayUmbraTreeSummaryFetcher,
  createOffpayUmbraUtxoDataFetcher,
  getUtxoInsertionIndexAsNumber,
  isBenignAlreadyClaimedFailure,
  projectPendingClaimUtxo,
} from '@/lib/umbra/umbra-indexer-adapter';
import {
  getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getRnClaimSelfClaimableUtxoIntoEncryptedBalanceProver,
  getRnCreateReceiverClaimableUtxoFromEncryptedBalanceProver,
  getRnCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getRnUserRegistrationProver,
} from '@/lib/umbra/umbra-rn-zk-prover';
import {
  assertOffpayUmbraVaultFeeAccountsReady,
  createOffpayLegacyUmbraClient,
  createOffpayLegacyUmbraSdkDeps,
  createOffpayUmbraClient,
  createOffpayUmbraSdkDeps,
  markOffpayUmbraProtocolVersionUnsupported,
  verifyOffpayUmbraRpcReadiness,
  type UmbraProtocolVersion,
  type UmbraVaultFeeAccountReadiness,
} from '@/lib/umbra/umbra-offpay-providers';
import {
  isUmbraNetworkSupported,
  resolveUmbraSupportedToken,
  type UmbraSupportedToken,
  type UmbraTokenSymbol,
} from '@/lib/umbra/umbra-supported-tokens';
import { decimalInputToAtomicAmount, formatAtomicAmount } from '@/lib/policy/token-amounts';
import { mark, measure } from '@/lib/perf/perf-marks';
import { yieldToUi, yieldToUiIfNeeded } from '@/lib/perf/ui-work-scheduler';
import {
  byteArraysEqual,
  encodeU128LeBytes,
  getMapValueByStringKey,
  isStatusBitSet,
} from '@/lib/umbra/umbra-parsing';

import type { OffpayNetwork } from '@/types/offpay-api';
import type { IUmbraClient } from '@umbra-privacy/sdk/client';
import type { TreeSummaryFetcherFunction } from '@umbra-privacy/sdk/indexer';
import type {
  IUmbraClient as LegacyUmbraClient,
  IUmbraSigner as LegacyUmbraSigner,
} from '@umbra-privacy/sdk-legacy/interfaces';
import type {
  UmbraWalletExecutionParams,
  UmbraTokenExecutionParams,
  UmbraUnshieldParams,
  UmbraVaultKeyRepairParams,
  UmbraPrivateP2PParams,
  UmbraPrivateP2PFromEncryptedBalanceParams,
  UmbraEncryptedBalanceSummary,
  UmbraPendingClaimUtxo,
  UmbraExecutionResult,
  UmbraVaultRegistrationStatus,
} from '@/lib/umbra/umbra-types';

export type {
  UmbraExecutionAction,
  UmbraWalletExecutionParams,
  UmbraTokenExecutionParams,
  UmbraUnshieldParams,
  UmbraVaultKeyRepairParams,
  UmbraPrivateP2PParams,
  UmbraPrivateP2PFromEncryptedBalanceParams,
  UmbraEncryptedBalanceSummary,
  UmbraPendingClaimUtxo,
  UmbraExecutionResult,
  UmbraVaultRegistrationStatus,
} from '@/lib/umbra/umbra-types';

export { isBenignAlreadyClaimedFailure } from '@/lib/umbra/umbra-indexer-adapter';

interface UmbraRuntime {
  client: IUmbraClient;
  rpc: ReturnType<typeof createOffpayUmbraSdkDeps>;
  network: OffpayNetwork;
  dispose: () => void;
  /**
   * The master-seed scheme id that matched this wallet's on-chain
   * registration, if it could be determined. The claim scanner narrows
   * its per-note decrypt loop to this single scheme on the fast path
   * instead of trying all registered schemes (current + legacy v4/v2/v1),
   * which is the dominant JS-thread cost during a scan. `null` when the
   * registered scheme could not be resolved (e.g. unregistered wallet) —
   * the scanner then falls back to all schemes so notes are never missed.
   */
  activeMasterSeedSchemeId: string | null;
}

interface LegacyUmbraRuntime {
  client: LegacyUmbraClient;
  rpc: ReturnType<typeof createOffpayLegacyUmbraSdkDeps>;
  network: OffpayNetwork;
  dispose: () => void;
}

type UmbraQueriedUserAccount =
  | { state: 'non_existent' }
  | {
      state: 'exists';
      data?: {
        isInitialised?: boolean;
        isActiveForAnonymousUsage?: boolean;
        isUserCommitmentRegistered?: boolean;
        isUserAccountX25519KeyRegistered?: boolean;
      };
    };
type UmbraQueriedUserAccountData = NonNullable<
  Extract<UmbraQueriedUserAccount, { state: 'exists' }>['data']
>;

const UMBRA_AWAIT_COMPUTATION_FINALIZATION = {
  maxSlotWindow: 200,
  safetyTimeoutMs: 120_000,
  reclaimComputationRent: false,
} as const;
const UMBRA_CLAIM_RECENT_SCAN_LEAF_LIMIT = 384n;
const UMBRA_CLAIM_SCAN_PAGE_LIMIT = UMBRA_CLAIM_RECENT_SCAN_LEAF_LIMIT;
const U64_MAX = (1n << 64n) - 1n;
const ENCRYPTED_USER_STATUS_BIT_INITIALISED = 0;
const ENCRYPTED_USER_STATUS_BIT_ACTIVE_FOR_ANONYMOUS_USAGE = 1;
const ENCRYPTED_USER_STATUS_BIT_USER_COMMITMENT_REGISTERED = 2;
const ENCRYPTED_USER_STATUS_BIT_MVK_KEY_REGISTERED = 2;
const ENCRYPTED_USER_STATUS_BIT_TOKEN_KEY_REGISTERED = 4;
const ENCRYPTED_TOKEN_STATUS_BIT_SHARED_MODE = 3;
const ENCRYPTED_TOKEN_STATUS_BIT_ARCIUM_BALANCE_INITIALISED = 4;

type UmbraSdkEncryptedBalanceEntry = {
  state: string;
  balance?: bigint;
};

type UmbraClaimScanMode = 'recent' | 'deep' | 'range';

type UmbraClaimScanParams = {
  treeIndex?: number;
  startInsertionIndex?: number;
  endInsertionIndex?: number;
  scanMode?: UmbraClaimScanMode;
  recentLeafLimit?: number | bigint;
  signal?: AbortSignal | null;
  pageLimit?: number | bigint;
};

type UmbraUtxoDataStore = NonNullable<IUmbraClient['utxoDataStore']>;

type UmbraTreeSummary = Awaited<ReturnType<TreeSummaryFetcherFunction>>[number];

type UmbraClaimScanWindow = {
  mode: UmbraClaimScanMode;
  treeIndex: bigint;
  start: bigint;
  end: bigint;
  totalLeaves: bigint;
  leafCount: bigint;
  summaries: readonly UmbraTreeSummary[];
  fakeProgressStore: UmbraUtxoDataStore | undefined;
};

interface UmbraPrivateP2PUtxoScanResult {
  receiverClaimableUtxos: readonly unknown[];
  selfClaimableUtxos: readonly unknown[];
  nextScanStartIndex: string;
  scanMode: UmbraClaimScanMode;
  scanStartInsertionIndex: number;
  scanEndInsertionIndex: number;
}

interface UmbraClaimScanCacheEntry {
  scopeKey: string;
  start: bigint;
  end: bigint;
  expiresAt: number;
  result: UmbraPrivateP2PUtxoScanResult;
}

const UMBRA_CLAIM_SCAN_CACHE_TTL_MS = 30_000;
const UMBRA_CLAIM_SCAN_CACHE_MAX_ENTRIES = 6;
let umbraClaimScanCache: UmbraClaimScanCacheEntry[] = [];

export function __resetUmbraClaimScanCacheForTests(): void {
  umbraClaimScanCache = [];
}

function normalizePositiveBigint(value: number | bigint | undefined, fallback: bigint): bigint {
  if (value == null) return fallback;
  const normalized = typeof value === 'bigint' ? value : BigInt(Math.max(1, Math.trunc(value)));
  return normalized > 0n ? normalized : fallback;
}

function getUmbraClaimScanCacheScope(params: {
  runtime: UmbraRuntime;
  network: OffpayNetwork;
  walletAddress: string | null | undefined;
  walletId: string | null | undefined;
  treeIndex: bigint;
}): string {
  return [
    params.network,
    params.walletAddress ?? 'unknown-wallet',
    params.walletId ?? 'unknown-wallet-id',
    String(params.treeIndex),
    params.runtime.activeMasterSeedSchemeId ?? 'all-schemes',
  ].join('|');
}

function pruneUmbraClaimScanCache(now = Date.now()): void {
  umbraClaimScanCache = umbraClaimScanCache.filter((entry) => entry.expiresAt > now);
  if (umbraClaimScanCache.length > UMBRA_CLAIM_SCAN_CACHE_MAX_ENTRIES) {
    umbraClaimScanCache = umbraClaimScanCache.slice(
      umbraClaimScanCache.length - UMBRA_CLAIM_SCAN_CACHE_MAX_ENTRIES,
    );
  }
}

function filterUmbraUtxosToScanWindow(
  utxos: readonly unknown[],
  window: UmbraClaimScanWindow,
): unknown[] {
  return utxos.filter((utxo) => {
    const insertionIndex = getUtxoInsertionIndexAsNumber(utxo);
    if (insertionIndex == null) return false;
    const value = BigInt(insertionIndex);
    return value >= window.start && value <= window.end;
  });
}

function narrowUmbraClaimScanResultToWindow(
  cached: UmbraPrivateP2PUtxoScanResult,
  window: UmbraClaimScanWindow,
): UmbraPrivateP2PUtxoScanResult {
  return {
    receiverClaimableUtxos: filterUmbraUtxosToScanWindow(cached.receiverClaimableUtxos, window),
    selfClaimableUtxos: filterUmbraUtxosToScanWindow(cached.selfClaimableUtxos, window),
    nextScanStartIndex: String(window.end),
    scanMode: window.mode,
    scanStartInsertionIndex: Number(window.start),
    scanEndInsertionIndex: Number(window.end),
  };
}

function readUmbraClaimScanCache(
  scopeKey: string,
  window: UmbraClaimScanWindow,
): UmbraPrivateP2PUtxoScanResult | null {
  const now = Date.now();
  pruneUmbraClaimScanCache(now);
  const cached = umbraClaimScanCache.find(
    (entry) =>
      entry.scopeKey === scopeKey &&
      entry.start <= window.start &&
      entry.end >= window.end &&
      entry.expiresAt > now,
  );
  if (cached == null) return null;
  return narrowUmbraClaimScanResultToWindow(cached.result, window);
}

function writeUmbraClaimScanCache(
  scopeKey: string,
  window: UmbraClaimScanWindow,
  result: UmbraPrivateP2PUtxoScanResult,
): void {
  if (window.mode === 'deep') return;
  const now = Date.now();
  pruneUmbraClaimScanCache(now);
  umbraClaimScanCache = umbraClaimScanCache.filter(
    (entry) =>
      !(entry.scopeKey === scopeKey && entry.start === window.start && entry.end === window.end),
  );
  umbraClaimScanCache.push({
    scopeKey,
    start: window.start,
    end: window.end,
    expiresAt: now + UMBRA_CLAIM_SCAN_CACHE_TTL_MS,
    result,
  });
  pruneUmbraClaimScanCache(now);
}

function createPreScannedUmbraUtxoDataStore(start: bigint): UmbraUtxoDataStore | undefined {
  if (start <= 0n) return undefined;

  const progress = {
    ranges: [{ start: 0n, end: start - 1n }],
    highWaterMark: start - 1n,
  };

  return {
    put: async () => undefined,
    get: async () => null,
    query: async () => [],
    count: async () => 0,
    remove: async () => undefined,
    getScanProgress: async () => progress as never,
    addScannedRange: async () => undefined,
    onError: (error, operation) => {
      if (__DEV__) {
        console.warn('[umbra-claims] bounded scan progress store error', {
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  } as UmbraUtxoDataStore;
}

async function resolveUmbraClaimScanWindow(
  network: OffpayNetwork,
  params: UmbraClaimScanParams,
): Promise<UmbraClaimScanWindow> {
  const fetchTreeSummary = createOffpayUmbraTreeSummaryFetcher(network);
  const allSummaries = await fetchTreeSummary();
  const requestedTreeIndex = BigInt(params.treeIndex ?? 0);
  const selectedSummary =
    allSummaries.find((summary) => BigInt(summary.treeIndex) === requestedTreeIndex) ??
    allSummaries[0];

  if (selectedSummary == null) {
    return {
      mode: params.scanMode ?? 'recent',
      treeIndex: requestedTreeIndex,
      start: 0n,
      end: -1n,
      totalLeaves: 0n,
      leafCount: 0n,
      summaries: [],
      fakeProgressStore: undefined,
    };
  }

  const totalLeaves = BigInt(selectedSummary.numLeaves);
  if (totalLeaves <= 0n) {
    return {
      mode: params.scanMode ?? 'recent',
      treeIndex: BigInt(selectedSummary.treeIndex),
      start: 0n,
      end: -1n,
      totalLeaves: 0n,
      leafCount: 0n,
      summaries: [{ ...selectedSummary, numLeaves: 0n as never }],
      fakeProgressStore: undefined,
    };
  }

  const maxIndex = totalLeaves - 1n;
  const explicitStart =
    params.startInsertionIndex == null ? null : BigInt(Math.max(0, params.startInsertionIndex));
  const explicitEnd =
    params.endInsertionIndex == null ? null : BigInt(Math.max(0, params.endInsertionIndex));
  const mode: UmbraClaimScanMode =
    explicitStart != null || explicitEnd != null ? 'range' : (params.scanMode ?? 'recent');

  let start: bigint;
  let end: bigint;
  if (mode === 'deep') {
    start = 0n;
    end = maxIndex;
  } else if (mode === 'range') {
    start = explicitStart ?? 0n;
    end = explicitEnd ?? maxIndex;
  } else {
    const recentLeafLimit = normalizePositiveBigint(
      params.recentLeafLimit,
      UMBRA_CLAIM_RECENT_SCAN_LEAF_LIMIT,
    );
    end = maxIndex;
    start = end >= recentLeafLimit ? end - recentLeafLimit + 1n : 0n;
  }

  if (start > maxIndex) start = maxIndex;
  if (end > maxIndex) end = maxIndex;
  if (end < start) end = start;

  const boundedSummary = {
    ...selectedSummary,
    numLeaves: end + 1n,
  } as UmbraTreeSummary;

  return {
    mode,
    treeIndex: BigInt(selectedSummary.treeIndex),
    start,
    end,
    totalLeaves,
    leafCount: end >= start ? end - start + 1n : 0n,
    summaries: [boundedSummary],
    fakeProgressStore: createPreScannedUmbraUtxoDataStore(start),
  };
}

interface NormalizedUmbraEncryptedBalance {
  state: string;
  rawBalance: string | null;
  displayBalance: string | null;
  unreadableReason?: UmbraEncryptedBalanceSummary['unreadableReason'];
}

interface UmbraVaultEncryptionKeyStatus {
  state:
    | 'matched'
    | 'mismatched'
    | 'missing_user_account'
    | 'missing_token_account'
    | 'not_shared_balance'
    | 'unknown';
  encryptedUserAccount: string | null;
  encryptedTokenAccount: string | null;
}

type DecodedUmbraUserAccountForKeyCheck = {
  exists?: boolean;
  data: {
    isInitialised?: boolean;
    isActiveForAnonymousUsage?: boolean;
    isUserCommitmentRegistered?: boolean;
    isUserAccountX25519KeyRegistered?: boolean;
    statusBits?: {
      first: bigint;
    };
    x25519PublicKeyForTokenEncryption: {
      first: Uint8Array | readonly number[];
    };
    x25519PublicKeyForMasterViewingKeyEncryption?: {
      first: Uint8Array | readonly number[];
    };
  };
};

type DecodedUmbraTokenAccountForKeyCheck = {
  exists?: boolean;
  data: {
    statusBits: {
      first: bigint;
    };
    x25519PublicKey: {
      first: Uint8Array | readonly number[];
    };
  };
};

function isUmbraSdkEncryptedBalanceEntry(value: unknown): value is UmbraSdkEncryptedBalanceEntry {
  if (typeof value !== 'object' || value == null) return false;
  const candidate = value as Partial<UmbraSdkEncryptedBalanceEntry>;
  return typeof candidate.state === 'string';
}

function getUmbraSdkEncryptedBalanceEntry(
  result: ReadonlyMap<unknown, unknown>,
  mint: string,
): UmbraSdkEncryptedBalanceEntry | undefined {
  const direct = result.get(mint);
  if (isUmbraSdkEncryptedBalanceEntry(direct)) return direct;

  for (const [key, value] of result.entries()) {
    if (String(key) === mint && isUmbraSdkEncryptedBalanceEntry(value)) {
      return value;
    }
  }

  return undefined;
}

function normalizeUmbraEncryptedBalanceEntry(
  entry: UmbraSdkEncryptedBalanceEntry | undefined,
  decimals: number,
): NormalizedUmbraEncryptedBalance {
  const state = entry?.state ?? 'unknown';
  if (state !== 'shared') {
    return {
      state,
      rawBalance: null,
      displayBalance: null,
    };
  }

  const balance = entry?.balance;
  if (balance == null || balance < 0n || balance > U64_MAX) {
    return {
      state: 'shared_unreadable',
      rawBalance: null,
      displayBalance: null,
      unreadableReason: 'invalid_u64',
    };
  }

  const rawBalance = balance.toString();
  return {
    state,
    rawBalance,
    displayBalance: formatAtomicAmount(rawBalance, decimals, 6),
  };
}

function getCurrentUmbraMasterSeedScheme(client: IUmbraClient): MasterSeedScheme {
  return currentMasterSeedScheme(client.masterSeedSchemes);
}

function getUmbraClientForMasterSeedScheme(client: IUmbraClient, schemeId: string): IUmbraClient {
  const currentScheme = getCurrentUmbraMasterSeedScheme(client);
  return schemeId === currentScheme.id ? client : withMasterSeedScheme(client, schemeId);
}

function warnUmbraSchemeProbeFallback(params: {
  stage: string;
  schemeId?: string | null;
  error: unknown;
}): void {
  if (typeof __DEV__ !== 'boolean' || !__DEV__) return;
  console.warn('[umbra-runtime] using full master-seed scheme registry after probe failure', {
    stage: params.stage,
    schemeId: params.schemeId ?? null,
    error: params.error instanceof Error ? params.error.message : String(params.error),
  });
}

/**
 * Build a scanner client whose `masterSeedSchemes` registry contains only the
 * one scheme that matched this wallet's on-chain registration.
 *
 * The SDK claim scanner loops `client.masterSeedSchemes` and runs a full
 * X25519 shared-secret + keccak + AES-GCM decrypt attempt per note *per
 * scheme* — with the default 4-scheme registry (current + legacy v4/v2/v1)
 * that is ~4× the per-note crypto. Narrowing the registry to the active
 * scheme is the single biggest JS-thread saving on the scan hot path.
 *
 * Safe because the SDK's internal `getSchemeMasterSeed` closure resolves
 * against its own private scheme array, not the exposed `masterSeedSchemes`
 * field — so narrowing the exposed array does not break key derivation. When
 * `schemeId` is null (registration not resolvable) the full client is returned
 * unchanged so the scanner still tries every scheme and never misses a note.
 */
function narrowUmbraClientToScheme(client: IUmbraClient, schemeId: string | null): IUmbraClient {
  if (schemeId == null) return client;
  const schemes = Array.isArray(client.masterSeedSchemes) ? client.masterSeedSchemes : [];
  const matched = schemes.find((scheme) => scheme.id === schemeId);
  if (matched == null || schemes.length <= 1) return client;
  return {
    ...client,
    masterSeedSchemes: [matched] as unknown as IUmbraClient['masterSeedSchemes'],
  };
}

/**
 * Wrap the SDK AES-GCM decryptor so the scan loop yields to the UI thread when
 * a frame budget is exceeded.
 *
 * The SDK calls `x25519GetSharedSecret` synchronously (its return value is
 * hashed immediately), so that hook must stay synchronous — wrapping it in a
 * Promise would break decryption. But the SDK `await`s `aesDecryptor`, which
 * runs right after each (expensive) X25519 op. Yielding there breaks the
 * otherwise-uninterruptible per-note decrypt loop into UI-friendly slices.
 *
 * We yield via `yieldToUiIfNeeded`, which only pays the ~1-frame round-trip
 * cost once the accumulated synchronous work crosses `budgetMs`, so throughput
 * stays high while the JS thread still gets regular frames.
 */
function createYieldingUmbraAesDecryptor(budgetMs = 8, signal?: AbortSignal | null) {
  const baseDecryptor = getAesDecryptor();
  let sliceStartedAt = Date.now();
  const assertNotAborted = () => {
    if (signal?.aborted !== true) return;
    const error = new Error('Umbra scan cancelled.');
    error.name = 'AbortError';
    throw error;
  };
  return async (key: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> => {
    assertNotAborted();
    sliceStartedAt = await yieldToUiIfNeeded(sliceStartedAt, budgetMs);
    assertNotAborted();
    return baseDecryptor(key as never, ciphertext as never) as Promise<Uint8Array>;
  };
}

function getUmbraClaimFactoryArgs(runtime: UmbraRuntime): {
  client: IUmbraClient;
  masterSeedSchemeId?: string;
} {
  return runtime.activeMasterSeedSchemeId == null
    ? { client: runtime.client }
    : { client: runtime.client, masterSeedSchemeId: runtime.activeMasterSeedSchemeId };
}

const UMBRA_STRUCT_TEXT_ENCODER = new TextEncoder();
const ENCRYPTED_USER_ACCOUNT_SEED = sha256(
  UMBRA_STRUCT_TEXT_ENCODER.encode('EncryptedUserAccount'),
);
const ENCRYPTED_TOKEN_ACCOUNT_SEED = sha256(
  UMBRA_STRUCT_TEXT_ENCODER.encode('EncryptedTokenAccount'),
);
const NULLIFIER_SET_SEED = sha256(UMBRA_STRUCT_TEXT_ENCODER.encode('NullifierSet'));

function publicKeyBytes(value: unknown): Uint8Array {
  return new PublicKey(String(value)).toBytes();
}

function findUmbraProgramAddress(seeds: readonly Uint8Array[], programAddress: unknown): string {
  const [pda] = PublicKey.findProgramAddressSync(
    seeds.map((seed) => Buffer.from(seed)),
    new PublicKey(String(programAddress)),
  );
  return pda.toBase58();
}

async function findEncryptedUserAccountPda(
  userPubkey: unknown,
  umbraProgram: unknown,
): Promise<string> {
  return findUmbraProgramAddress(
    [ENCRYPTED_USER_ACCOUNT_SEED, publicKeyBytes(userPubkey)],
    umbraProgram,
  );
}

async function findEncryptedTokenAccountPda(
  userPubkey: unknown,
  mintPubkey: unknown,
  umbraProgram: unknown,
): Promise<string> {
  return findUmbraProgramAddress(
    [ENCRYPTED_TOKEN_ACCOUNT_SEED, publicKeyBytes(userPubkey), publicKeyBytes(mintPubkey)],
    umbraProgram,
  );
}

async function fetchDecodedUmbraUserAccountForSchemeCheck(params: {
  client: IUmbraClient;
  rpc: ReturnType<typeof createOffpayUmbraSdkDeps>;
  walletAddress: string;
}): Promise<{
  encryptedUserAccount: string;
  decoded: DecodedUmbraUserAccountForKeyCheck;
} | null> {
  const encryptedUserAccount = String(
    await findEncryptedUserAccountPda(
      params.walletAddress as never,
      params.client.networkConfig.programId as never,
    ),
  );
  const accountMap = await params.rpc.accountInfoProvider([encryptedUserAccount as never]);
  const maybeAccount = getMapValueByStringKey(accountMap, encryptedUserAccount);
  if (maybeAccount == null || (maybeAccount as { exists?: unknown }).exists !== true) return null;

  let decoded: DecodedUmbraUserAccountForKeyCheck;
  try {
    decoded = decodeEncryptedUserAccount(
      maybeAccount as never,
    ) as unknown as DecodedUmbraUserAccountForKeyCheck;
  } catch {
    return null;
  }
  if (decoded.exists === false) return null;

  return { encryptedUserAccount, decoded };
}

async function umbraMasterSeedSchemeMatchesUserAccount(params: {
  client: IUmbraClient;
  schemeId: string;
  userAccount: DecodedUmbraUserAccountForKeyCheck;
}): Promise<boolean> {
  const statusBits = params.userAccount.data.statusBits?.first ?? 0n;
  const tokenKeyRegistered = isStatusBitSet(
    statusBits,
    ENCRYPTED_USER_STATUS_BIT_TOKEN_KEY_REGISTERED,
  );
  const mvkKeyRegistered = isStatusBitSet(statusBits, ENCRYPTED_USER_STATUS_BIT_MVK_KEY_REGISTERED);
  if (!tokenKeyRegistered && !mvkKeyRegistered) return true;

  const schemeClient = getUmbraClientForMasterSeedScheme(params.client, params.schemeId);

  if (tokenKeyRegistered) {
    const onChainTokenKey = Uint8Array.from(
      params.userAccount.data.x25519PublicKeyForTokenEncryption.first,
    );
    const tokenKeypair = await getUserAccountX25519KeypairDeriver({ client: schemeClient })();
    if (!byteArraysEqual(tokenKeypair.x25519Keypair.publicKey, onChainTokenKey)) {
      return false;
    }
  }

  if (mvkKeyRegistered && params.userAccount.data.x25519PublicKeyForMasterViewingKeyEncryption) {
    const onChainMvkKey = Uint8Array.from(
      params.userAccount.data.x25519PublicKeyForMasterViewingKeyEncryption.first,
    );
    const mvkKeypair = await getMasterViewingKeyX25519KeypairDeriver({
      client: schemeClient,
    })();
    if (!byteArraysEqual(mvkKeypair.x25519Keypair.publicKey, onChainMvkKey)) {
      return false;
    }
  }

  return true;
}

async function selectUmbraClientForRegisteredMasterSeedScheme(params: {
  client: IUmbraClient;
  rpc: ReturnType<typeof createOffpayUmbraSdkDeps>;
  walletAddress: string;
}): Promise<{ client: IUmbraClient; schemeId: string | null }> {
  const schemes = Array.isArray(params.client.masterSeedSchemes)
    ? params.client.masterSeedSchemes
    : [];
  if (schemes.length === 0) return { client: params.client, schemeId: null };

  let userAccount: Awaited<ReturnType<typeof fetchDecodedUmbraUserAccountForSchemeCheck>>;
  try {
    userAccount = await fetchDecodedUmbraUserAccountForSchemeCheck(params);
  } catch (error) {
    warnUmbraSchemeProbeFallback({ stage: 'user-account-fetch', error });
    return { client: params.client, schemeId: null };
  }
  if (userAccount == null) return { client: params.client, schemeId: null };

  for (const scheme of schemes) {
    try {
      if (
        await umbraMasterSeedSchemeMatchesUserAccount({
          client: params.client,
          schemeId: scheme.id,
          userAccount: userAccount.decoded,
        })
      ) {
        return {
          client: getUmbraClientForMasterSeedScheme(params.client, scheme.id),
          schemeId: scheme.id,
        };
      }
    } catch (error) {
      warnUmbraSchemeProbeFallback({ stage: 'scheme-match', schemeId: scheme.id, error });
      return { client: params.client, schemeId: null };
    }
  }

  return { client: params.client, schemeId: null };
}

function isUmbraKeyConsistencyFailure(error: unknown): boolean {
  if (isKeyConsistencyError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /KeyConsistencyError|key consistency|X25519.*does not match|locally-derived key|per-mint key/i.test(
    message,
  );
}

async function queryUmbraEncryptedBalanceEntries(params: {
  runtime: UmbraRuntime;
  mints: readonly UmbraSupportedToken[];
}): Promise<ReadonlyMap<unknown, unknown>> {
  const mintAddresses = params.mints.map((token) => token.mint as never);
  const runQuery = async (client: IUmbraClient): Promise<ReadonlyMap<unknown, unknown>> => {
    const queryBalances = getEncryptedBalanceQuerierFunction({ client }, {
      accountInfoProvider: params.runtime.rpc.accountInfoProvider,
    } as never);
    return (await queryBalances(mintAddresses)) as ReadonlyMap<unknown, unknown>;
  };

  try {
    return await runQuery(params.runtime.client);
  } catch (error) {
    const schemes = Array.isArray(params.runtime.client.masterSeedSchemes)
      ? params.runtime.client.masterSeedSchemes
      : [];
    if (
      params.runtime.activeMasterSeedSchemeId != null ||
      schemes.length <= 1 ||
      !isUmbraKeyConsistencyFailure(error)
    ) {
      throw error;
    }

    const currentSchemeId = getCurrentUmbraMasterSeedScheme(params.runtime.client).id;
    let lastError = error;
    for (const scheme of schemes) {
      if (scheme.id === currentSchemeId) continue;
      try {
        return await runQuery(getUmbraClientForMasterSeedScheme(params.runtime.client, scheme.id));
      } catch (fallbackError) {
        lastError = fallbackError;
        if (!isUmbraKeyConsistencyFailure(fallbackError)) throw fallbackError;
      }
    }

    throw lastError;
  }
}

async function findNullifierSetPdas(
  stealthPoolIndex: bigint,
  umbraProgram: unknown,
): Promise<{
  treap0: string;
  treap1: string;
  treap2: string;
  treap3: string;
  treap4: string;
}> {
  const indexBytes = encodeU128LeBytes(stealthPoolIndex);
  const derivePda = (variant: number): string =>
    findUmbraProgramAddress(
      [NULLIFIER_SET_SEED, indexBytes, new Uint8Array([variant])],
      umbraProgram,
    );
  const [treap0, treap1, treap2, treap3, treap4] = await Promise.all([
    derivePda(0),
    derivePda(1),
    derivePda(2),
    derivePda(3),
    derivePda(4),
  ]);
  return { treap0, treap1, treap2, treap3, treap4 };
}

async function queryUmbraVaultEncryptionKeyStatus(
  runtime: UmbraRuntime | LegacyUmbraRuntime,
  walletAddress: string,
  mint: string,
): Promise<UmbraVaultEncryptionKeyStatus> {
  let encryptedUserAccount: string | null = null;
  let encryptedTokenAccount: string | null = null;

  try {
    encryptedUserAccount = String(
      await findEncryptedUserAccountPda(
        walletAddress as never,
        runtime.client.networkConfig.programId as never,
      ),
    );
    encryptedTokenAccount = String(
      await findEncryptedTokenAccountPda(
        walletAddress as never,
        mint as never,
        runtime.client.networkConfig.programId as never,
      ),
    );
    const accountMap = await runtime.rpc.accountInfoProvider([
      encryptedUserAccount as never,
      encryptedTokenAccount as never,
    ]);
    const userMaybeAccount = getMapValueByStringKey(accountMap, encryptedUserAccount);
    const tokenMaybeAccount = getMapValueByStringKey(accountMap, encryptedTokenAccount);

    if (userMaybeAccount == null || (userMaybeAccount as { exists?: unknown }).exists !== true) {
      return { state: 'missing_user_account', encryptedUserAccount, encryptedTokenAccount };
    }
    if (tokenMaybeAccount == null || (tokenMaybeAccount as { exists?: unknown }).exists !== true) {
      return { state: 'missing_token_account', encryptedUserAccount, encryptedTokenAccount };
    }

    const userAccount = decodeEncryptedUserAccount(
      userMaybeAccount as never,
    ) as unknown as DecodedUmbraUserAccountForKeyCheck;
    const tokenAccount = decodeEncryptedTokenAccount(
      tokenMaybeAccount as never,
    ) as unknown as DecodedUmbraTokenAccountForKeyCheck;
    if (userAccount.exists === false) {
      return { state: 'missing_user_account', encryptedUserAccount, encryptedTokenAccount };
    }
    if (tokenAccount.exists === false) {
      return { state: 'missing_token_account', encryptedUserAccount, encryptedTokenAccount };
    }

    const tokenStatusBits = tokenAccount.data.statusBits.first;
    const isSharedMode = isStatusBitSet(tokenStatusBits, ENCRYPTED_TOKEN_STATUS_BIT_SHARED_MODE);
    const isArciumBalanceInitialised = isStatusBitSet(
      tokenStatusBits,
      ENCRYPTED_TOKEN_STATUS_BIT_ARCIUM_BALANCE_INITIALISED,
    );
    if (!isSharedMode || !isArciumBalanceInitialised) {
      return { state: 'not_shared_balance', encryptedUserAccount, encryptedTokenAccount };
    }

    const tokenPublicKey = Uint8Array.from(tokenAccount.data.x25519PublicKey.first);
    const userTokenPublicKey = Uint8Array.from(
      userAccount.data.x25519PublicKeyForTokenEncryption.first,
    );

    return {
      state: byteArraysEqual(tokenPublicKey, userTokenPublicKey) ? 'matched' : 'mismatched',
      encryptedUserAccount,
      encryptedTokenAccount,
    };
  } catch {
    return {
      state: 'unknown',
      encryptedUserAccount,
      encryptedTokenAccount,
    };
  }
}

async function createUmbraRuntime(params: UmbraWalletExecutionParams): Promise<UmbraRuntime> {
  const walletAddress = assertWalletAddress(params.walletAddress);
  const { signer, dispose } = await createUmbraSignerForWallet(walletAddress, params.walletId);

  try {
    if (String(signer.address) !== walletAddress) {
      throw new Error('Umbra signer address does not match the active wallet.');
    }

    const baseClient = await createOffpayUmbraClient({
      signer,
      network: params.network,
      deferMasterSeedSignature: true,
    });
    const rpc = createOffpayUmbraSdkDeps(params.network);
    const { client, schemeId } = await selectUmbraClientForRegisteredMasterSeedScheme({
      client: baseClient,
      rpc,
      walletAddress,
    });

    return {
      client,
      rpc,
      network: params.network,
      dispose,
      activeMasterSeedSchemeId: schemeId,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function createLegacyUmbraRuntime(
  params: UmbraWalletExecutionParams,
): Promise<LegacyUmbraRuntime> {
  const walletAddress = assertWalletAddress(params.walletAddress);
  const { signer, dispose } = await createUmbraSignerForWallet(walletAddress, params.walletId);

  try {
    if (String(signer.address) !== walletAddress) {
      throw new Error('Umbra signer address does not match the active wallet.');
    }

    const client = await createOffpayLegacyUmbraClient({
      signer: signer as unknown as LegacyUmbraSigner,
      network: params.network,
      deferMasterSeedSignature: true,
    });
    const rpc = createOffpayLegacyUmbraSdkDeps(params.network);

    return {
      client,
      rpc,
      network: params.network,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function withUmbraRuntime<T>(
  params: UmbraWalletExecutionParams,
  run: (runtime: UmbraRuntime) => Promise<T>,
): Promise<T> {
  const runtime = await createUmbraRuntime(params);
  try {
    return await run(runtime);
  } finally {
    runtime.dispose();
  }
}

async function withLegacyUmbraRuntime<T>(
  params: UmbraWalletExecutionParams,
  run: (runtime: LegacyUmbraRuntime) => Promise<T>,
): Promise<T> {
  const runtime = await createLegacyUmbraRuntime(params);
  try {
    return await run(runtime);
  } finally {
    runtime.dispose();
  }
}

function isProtocolAvailable(
  readiness: UmbraVaultFeeAccountReadiness,
  protocolVersion: UmbraProtocolVersion,
): boolean {
  if (protocolVersion === 'legacy' && !isLegacyUmbraProtocolAccepted(readiness.network)) {
    return false;
  }

  return (
    readiness.protocolVersions?.find((entry) => entry.protocolVersion === protocolVersion)
      ?.available === true
  );
}

function isLegacyUmbraProtocolAccepted(network: OffpayNetwork): boolean {
  return network !== 'mainnet' && network !== 'devnet';
}

function shouldPreferLegacyUmbraProtocol(_network: OffpayNetwork): boolean {
  // Current mainnet/devnet use the SDK's v17 handlers. Legacy v11 is kept for
  // non-production clusters only; forcing it on devnet causes Anchor fallback.
  return false;
}

function assertPreferredLegacyUmbraProtocolAvailable(
  readiness: UmbraVaultFeeAccountReadiness,
): void {
  if (readiness.protocolVersion === 'legacy' && isProtocolAvailable(readiness, 'legacy')) return;
  if (isProtocolAvailable(readiness, 'legacy')) return;
  throw new Error(
    `Umbra ${readiness.network} uses the legacy v11 program for this action, but the v11 protocol fee accounts are missing for ${readiness.action}.`,
  );
}

function registrationStatusFromQueriedUserAccount(
  userAccount: UmbraQueriedUserAccount,
): UmbraVaultRegistrationStatus {
  const vaultRegistered = userAccount.state === 'exists';
  const vaultCanShield =
    userAccount.state === 'exists' &&
    userAccount.data?.isInitialised === true &&
    userAccount.data?.isUserAccountX25519KeyRegistered === true;
  const mixerRegistered =
    vaultCanShield &&
    userAccount.data?.isUserCommitmentRegistered === true &&
    userAccount.data?.isActiveForAnonymousUsage === true;

  return {
    vaultState: userAccount.state,
    vaultRegistered,
    vaultCanShield,
    mixerRegistered,
  };
}

function readUmbraUserAccountStatusFlag(
  decoded: DecodedUmbraUserAccountForKeyCheck,
  field: keyof UmbraQueriedUserAccountData,
  bitPosition: number,
): boolean {
  const direct = decoded.data[field];
  if (typeof direct === 'boolean') return direct;
  return isStatusBitSet(decoded.data.statusBits?.first ?? 0n, bitPosition);
}

function queriedUserAccountFromDecodedUmbraUserAccount(
  decoded: DecodedUmbraUserAccountForKeyCheck,
): UmbraQueriedUserAccount {
  if (decoded.exists === false) return { state: 'non_existent' };
  return {
    state: 'exists',
    data: {
      isInitialised: readUmbraUserAccountStatusFlag(
        decoded,
        'isInitialised',
        ENCRYPTED_USER_STATUS_BIT_INITIALISED,
      ),
      isActiveForAnonymousUsage: readUmbraUserAccountStatusFlag(
        decoded,
        'isActiveForAnonymousUsage',
        ENCRYPTED_USER_STATUS_BIT_ACTIVE_FOR_ANONYMOUS_USAGE,
      ),
      isUserCommitmentRegistered: readUmbraUserAccountStatusFlag(
        decoded,
        'isUserCommitmentRegistered',
        ENCRYPTED_USER_STATUS_BIT_USER_COMMITMENT_REGISTERED,
      ),
      isUserAccountX25519KeyRegistered: readUmbraUserAccountStatusFlag(
        decoded,
        'isUserAccountX25519KeyRegistered',
        ENCRYPTED_USER_STATUS_BIT_TOKEN_KEY_REGISTERED,
      ),
    },
  };
}

function isUmbraPdaDerivationRuntimeFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /pda-derivation|undefined is not a function|is not a function \(it is undefined\)|No digest implementation|SUBTLE_CRYPTO|crypto\.subtle|ExpoCrypto\.digest/i.test(
      message,
    )
  ) {
    return true;
  }

  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : null;
  return cause == null ? false : isUmbraPdaDerivationRuntimeFailure(cause);
}

function warnUmbraRegistrationStatusFallback(error: unknown): void {
  if (typeof __DEV__ !== 'boolean' || !__DEV__) return;
  console.warn('[umbra-runtime] reading registration with local PDA fallback', {
    error: error instanceof Error ? error.message : String(error),
  });
}

async function queryUmbraVaultRegistrationStatus(
  runtime: UmbraRuntime,
  walletAddress: string,
): Promise<UmbraVaultRegistrationStatus> {
  const queryUser = getUserAccountQuerierFunction({ client: runtime.client }, {
    accountInfoProvider: runtime.rpc.accountInfoProvider,
  } as never);
  let userAccount: UmbraQueriedUserAccount;
  try {
    userAccount = (await queryUser(walletAddress as never)) as UmbraQueriedUserAccount;
  } catch (error) {
    if (!isUmbraPdaDerivationRuntimeFailure(error)) throw error;
    warnUmbraRegistrationStatusFallback(error);
    const decoded = await fetchDecodedUmbraUserAccountForSchemeCheck({
      client: runtime.client,
      rpc: runtime.rpc,
      walletAddress,
    });
    userAccount =
      decoded == null
        ? { state: 'non_existent' }
        : queriedUserAccountFromDecodedUmbraUserAccount(decoded.decoded);
  }
  return registrationStatusFromQueriedUserAccount(userAccount);
}

async function queryLegacyUmbraVaultRegistrationStatus(
  runtime: LegacyUmbraRuntime,
  walletAddress: string,
): Promise<UmbraVaultRegistrationStatus> {
  const queryUser = getLegacyUserAccountQuerierFunction({ client: runtime.client }, {
    accountInfoProvider: runtime.rpc.accountInfoProvider,
  } as never);
  const userAccount = (await queryUser(walletAddress as never)) as UmbraQueriedUserAccount;
  return registrationStatusFromQueriedUserAccount(userAccount);
}

async function confirmUmbraVaultRegistrationStatus(
  runtime: UmbraRuntime,
  walletAddress: string,
  submittedSignatureCount: number,
  requireMixerRegistration = false,
): Promise<UmbraVaultRegistrationStatus> {
  let latest = await queryUmbraVaultRegistrationStatus(runtime, walletAddress);
  const isReady = (status: UmbraVaultRegistrationStatus) =>
    requireMixerRegistration ? status.mixerRegistered : status.vaultCanShield;

  if (isReady(latest) || submittedSignatureCount === 0) {
    return latest;
  }

  const attempts = requireMixerRegistration ? 10 : 4;
  const delayMs = requireMixerRegistration ? 2_000 : 1_500;

  for (let attempt = 0; attempt < attempts && !isReady(latest); attempt += 1) {
    await sleep(delayMs);
    latest = await queryUmbraVaultRegistrationStatus(runtime, walletAddress);
  }

  return latest;
}

async function confirmLegacyUmbraVaultRegistrationStatus(
  runtime: LegacyUmbraRuntime,
  walletAddress: string,
  submittedSignatureCount: number,
  requireMixerRegistration = false,
): Promise<UmbraVaultRegistrationStatus> {
  let latest = await queryLegacyUmbraVaultRegistrationStatus(runtime, walletAddress);
  const isReady = (status: UmbraVaultRegistrationStatus) =>
    requireMixerRegistration ? status.mixerRegistered : status.vaultCanShield;

  if (isReady(latest) || submittedSignatureCount === 0) {
    return latest;
  }

  const attempts = requireMixerRegistration ? 10 : 4;
  const delayMs = requireMixerRegistration ? 2_000 : 1_500;

  for (let attempt = 0; attempt < attempts && !isReady(latest); attempt += 1) {
    await sleep(delayMs);
    latest = await queryLegacyUmbraVaultRegistrationStatus(runtime, walletAddress);
  }

  return latest;
}

export async function resolveUmbraToken(params: {
  network: OffpayNetwork;
  token: string;
  tokenMint?: string | null;
  amount: string;
  requireMixer?: boolean;
}): Promise<{
  metadata: UmbraSupportedToken;
  amountAtomic: string;
  amountDisplay: string;
}> {
  const normalizedToken = params.token.trim();
  const tokenMint =
    params.tokenMint?.trim() ?? (isValidSolanaAddress(normalizedToken) ? normalizedToken : null);
  const metadata = resolveUmbraSupportedToken({
    network: params.network,
    token: normalizedToken,
    tokenMint,
    requireMixer: params.requireMixer,
  });

  const amountAtomic = decimalInputToAtomicAmount(params.amount, metadata.decimals);
  if (amountAtomic == null) {
    throw new Error('Enter an amount.');
  }

  return {
    metadata,
    amountAtomic: assertPositiveAtomicAmount(amountAtomic),
    amountDisplay: formatAtomicAmount(amountAtomic, metadata.decimals, 6),
  };
}

function buildRpcDeps(runtime: UmbraRuntime) {
  return {
    accountInfoProvider: runtime.rpc.accountInfoProvider,
    blockhashProvider: runtime.rpc.blockhashProvider,
    transactionForwarder: runtime.rpc.transactionForwarder,
    epochInfo: runtime.rpc.epochInfoProvider,
  };
}

function buildLegacyRpcDeps(runtime: LegacyUmbraRuntime) {
  return {
    accountInfoProvider: runtime.rpc.accountInfoProvider,
    blockhashProvider: runtime.rpc.blockhashProvider,
    transactionForwarder: runtime.rpc.transactionForwarder,
    epochInfo: runtime.rpc.epochInfoProvider,
  };
}

type UmbraSubmitOnlyForwarderPayload = {
  mint: string;
  network: OffpayNetwork;
  protocol: UmbraProtocolVersion;
  source: 'public-balance';
};

function toTransactionList(transactions: unknown): readonly unknown[] {
  return Array.isArray(transactions) ? transactions : [transactions];
}

function createSubmitOnlyUmbraTransactionForwarder<
  TForwarder extends {
    fireAndForget: (...args: never[]) => unknown;
    forwardInParallel: (...args: never[]) => unknown;
    forwardSequentially: (...args: never[]) => unknown;
  },
>(forwarder: TForwarder, payload: UmbraSubmitOnlyForwarderPayload): TForwarder {
  const submit = forwarder.fireAndForget as (transaction: unknown) => Promise<unknown>;

  return {
    ...forwarder,
    forwardInParallel: (async (transactions: unknown) => {
      const transactionList = toTransactionList(transactions);
      const startedAt = mark();
      let submittedCount = 0;
      try {
        const signatures = await Promise.all(
          transactionList.map(async (transaction) => {
            const signature = await submit(transaction);
            submittedCount += 1;
            return signature;
          }),
        );
        return signatures;
      } finally {
        measure('umbra.txForwarder.submitOnly.forwardInParallel', startedAt, {
          ...payload,
          transactionCount: transactionList.length,
          submittedCount,
        });
      }
    }) as TForwarder['forwardInParallel'],
    forwardSequentially: (async (transactions: unknown) => {
      const transactionList = toTransactionList(transactions);
      const startedAt = mark();
      const signatures: unknown[] = [];
      try {
        for (const transaction of transactionList) {
          signatures.push(await submit(transaction));
        }
        return signatures;
      } finally {
        measure('umbra.txForwarder.submitOnly.forwardSequentially', startedAt, {
          ...payload,
          transactionCount: transactionList.length,
          submittedCount: signatures.length,
        });
      }
    }) as TForwarder['forwardSequentially'],
  };
}

function buildPublicP2PSubmitOnlyRpcDeps(runtime: UmbraRuntime, token: UmbraSupportedToken) {
  return {
    ...buildRpcDeps(runtime),
    transactionForwarder: createSubmitOnlyUmbraTransactionForwarder(
      runtime.rpc.transactionForwarder,
      {
        mint: token.mint,
        network: runtime.network,
        protocol: 'current',
        source: 'public-balance',
      },
    ),
  };
}

function buildLegacyPublicP2PSubmitOnlyRpcDeps(
  runtime: LegacyUmbraRuntime,
  token: UmbraSupportedToken,
) {
  return {
    ...buildLegacyRpcDeps(runtime),
    transactionForwarder: createSubmitOnlyUmbraTransactionForwarder(
      runtime.rpc.transactionForwarder,
      {
        mint: token.mint,
        network: runtime.network,
        protocol: 'legacy',
        source: 'public-balance',
      },
    ),
  };
}

async function ensureUmbraRegistrationForRuntime(params: {
  runtime: UmbraRuntime;
  walletAddress: string;
  anonymous: boolean;
}): Promise<{
  registrationStatus: UmbraVaultRegistrationStatus;
  signatures: string[];
}> {
  const currentStatus = await queryUmbraVaultRegistrationStatus(
    params.runtime,
    params.walletAddress,
  );
  if (!params.anonymous && currentStatus.vaultCanShield) {
    return {
      registrationStatus: currentStatus,
      signatures: [],
    };
  }
  if (params.anonymous && currentStatus.mixerRegistered) {
    return {
      registrationStatus: currentStatus,
      signatures: [],
    };
  }

  const register = getUserRegistrationFunction({ client: params.runtime.client }, {
    rpc: buildRpcDeps(params.runtime),
    ...(params.anonymous ? { zkProver: getRnUserRegistrationProver() } : {}),
  } as never);
  const registerConfidentialKey = !currentStatus.vaultCanShield;
  const signatures = collectSignaturesFromResult(
    await register({ confidential: registerConfidentialKey, anonymous: params.anonymous } as never),
  );
  await assertUmbraTransactionSignaturesLanded({
    network: params.runtime.network,
    signatures,
    action: 'setup',
  });
  const registrationStatus = await confirmUmbraVaultRegistrationStatus(
    params.runtime,
    params.walletAddress,
    signatures.length,
    params.anonymous,
  );

  return {
    registrationStatus,
    signatures,
  };
}

async function ensureLegacyUmbraRegistrationForRuntime(params: {
  runtime: LegacyUmbraRuntime;
  walletAddress: string;
  anonymous: boolean;
}): Promise<{
  registrationStatus: UmbraVaultRegistrationStatus;
  signatures: string[];
}> {
  const currentStatus = await queryLegacyUmbraVaultRegistrationStatus(
    params.runtime,
    params.walletAddress,
  );
  if (!params.anonymous && currentStatus.vaultCanShield) {
    return {
      registrationStatus: currentStatus,
      signatures: [],
    };
  }
  if (params.anonymous && currentStatus.mixerRegistered) {
    return {
      registrationStatus: currentStatus,
      signatures: [],
    };
  }

  const register = getLegacyUserRegistrationFunction({ client: params.runtime.client }, {
    rpc: buildLegacyRpcDeps(params.runtime),
    ...(params.anonymous ? { zkProver: getRnUserRegistrationProver() } : {}),
  } as never);
  const registerConfidentialKey = !currentStatus.vaultCanShield;
  const signatures = collectSignaturesFromResult(
    await register({ confidential: registerConfidentialKey, anonymous: params.anonymous } as never),
  );
  await assertUmbraTransactionSignaturesLanded({
    network: params.runtime.network,
    signatures,
    action: 'setup',
  });
  const registrationStatus = await confirmLegacyUmbraVaultRegistrationStatus(
    params.runtime,
    params.walletAddress,
    signatures.length,
    params.anonymous,
  );

  return {
    registrationStatus,
    signatures,
  };
}

async function ensureUmbraRegistrationForPreferredProtocol(
  params: UmbraWalletExecutionParams,
  anonymous: boolean,
): Promise<{
  registrationStatus: UmbraVaultRegistrationStatus;
  signatures: string[];
}> {
  const walletAddress = assertWalletAddress(params.walletAddress);
  if (shouldPreferLegacyUmbraProtocol(params.network)) {
    return withLegacyUmbraRuntime(params, (runtime) =>
      ensureLegacyUmbraRegistrationForRuntime({
        runtime,
        walletAddress,
        anonymous,
      }),
    );
  }

  try {
    return await withUmbraRuntime(params, (runtime) =>
      ensureUmbraRegistrationForRuntime({
        runtime,
        walletAddress,
        anonymous,
      }),
    );
  } catch (error) {
    if (!isUmbraInstructionFallbackNotFound(error)) throw error;
    if (!isLegacyUmbraProtocolAccepted(params.network)) throw error;
    return withLegacyUmbraRuntime(params, (runtime) =>
      ensureLegacyUmbraRegistrationForRuntime({
        runtime,
        walletAddress,
        anonymous,
      }),
    );
  }
}

async function waitForUmbraVaultEncryptionKeyMatch(params: {
  runtime: UmbraRuntime | LegacyUmbraRuntime;
  walletAddress: string;
  mint: string;
}): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(attempt === 0 ? 1_500 : 3_000);
    const status = await queryUmbraVaultEncryptionKeyStatus(
      params.runtime,
      params.walletAddress,
      params.mint,
    );
    if (status.state === 'matched') return true;
    if (status.state !== 'mismatched' && status.state !== 'unknown') return false;
  }

  return false;
}

export async function repairUmbraVaultEncryptionKey(
  params: UmbraVaultKeyRepairParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  await verifyOffpayUmbraRpcReadiness(params.network);

  const runRepair = async (
    runtime: UmbraRuntime | LegacyUmbraRuntime,
    protocolVersion: UmbraProtocolVersion,
  ): Promise<UmbraExecutionResult> => {
    const tokens = params.tokens.flatMap((token) => {
      try {
        return [resolveUmbraSupportedToken({ network: params.network, token })];
      } catch {
        return [];
      }
    });
    const uniqueTokens = tokens.filter(
      (token, index, allTokens) =>
        allTokens.findIndex((candidate) => candidate.mint === token.mint) === index,
    );
    if (uniqueTokens.length === 0) {
      throw new Error(
        `Umbra vault key repair does not support this token set on ${params.network}.`,
      );
    }

    const statuses = await Promise.all(
      uniqueTokens.map(async (token) => ({
        token,
        status: await queryUmbraVaultEncryptionKeyStatus(runtime, walletAddress, token.mint),
      })),
    );
    const mismatched = statuses.filter((entry) => entry.status.state === 'mismatched');
    if (mismatched.length === 0) {
      throw new Error('No Umbra vault key mismatch found for this wallet.');
    }

    const userAccountX25519KeypairDeriver = getUserAccountX25519KeypairDeriver({
      client: runtime.client as never,
    });
    const rotateMintKey =
      protocolVersion === 'legacy'
        ? getLegacyMintEncryptionKeyRotatorFunction({ client: runtime.client as never }, {
            rpc: buildLegacyRpcDeps(runtime as LegacyUmbraRuntime),
            keys: {
              mintX25519KeypairDeriver: async () => userAccountX25519KeypairDeriver(),
            },
          } as never)
        : getMintEncryptionKeyRotatorFunction({ client: runtime.client as never }, {
            rpc: buildRpcDeps(runtime as UmbraRuntime),
            keys: {
              mintX25519KeypairDeriver: async () => userAccountX25519KeypairDeriver(),
            },
          } as never);
    const signatures: string[] = [];
    const repairedSymbols: UmbraTokenSymbol[] = [];

    for (const { token } of mismatched) {
      const signature = String(
        await rotateMintKey(token.mint as never, new Uint8Array(32) as never),
      );
      signatures.push(signature);
      await assertUmbraTransactionSignaturesLanded({
        network: params.network,
        signatures: [signature],
        action: 'setup',
        requireSignature: true,
      });
      const matched = await waitForUmbraVaultEncryptionKeyMatch({
        runtime,
        walletAddress,
        mint: token.mint,
      });
      if (matched) {
        repairedSymbols.push(token.symbol);
      }
    }

    const allRepaired = repairedSymbols.length === mismatched.length;
    const repairedLabel =
      repairedSymbols.length > 0
        ? repairedSymbols.join(', ')
        : mismatched.map((entry) => entry.token.symbol).join(', ');

    return {
      action: 'repair',
      walletAddress,
      network: params.network,
      title: allRepaired ? 'Vault key repaired' : 'Vault key repair submitted',
      subtitle: allRepaired
        ? `${repairedLabel} can be refreshed and withdrawn.`
        : `${repairedLabel} re-encryption is settling. Refresh shielded balance in a moment.`,
      signatures,
      ...(mismatched.length === 1
        ? {
            mint: mismatched[0].token.mint,
            tokenSymbol: mismatched[0].token.symbol,
          }
        : {}),
    };
  };

  if (shouldPreferLegacyUmbraProtocol(params.network)) {
    return withLegacyUmbraRuntime(params, (runtime) => runRepair(runtime, 'legacy'));
  }

  try {
    return await withUmbraRuntime(params, (runtime) => runRepair(runtime, 'current'));
  } catch (error) {
    if (!isUmbraInstructionFallbackNotFound(error)) throw error;
    if (!isLegacyUmbraProtocolAccepted(params.network)) throw error;
    markOffpayUmbraProtocolVersionUnsupported(params.network, 'current');
    return withLegacyUmbraRuntime(params, (runtime) => runRepair(runtime, 'legacy'));
  }
}

async function ensureUmbraPrivateP2PSenderReady(
  runtime: UmbraRuntime,
  walletAddress: string,
  params: UmbraWalletExecutionParams,
  options: { autoSetup: boolean },
): Promise<UmbraVaultRegistrationStatus> {
  let registrationStatus = await queryUmbraVaultRegistrationStatus(runtime, walletAddress);
  if (registrationStatus.mixerRegistered) return registrationStatus;
  if (params.network === 'devnet' && !options.autoSetup && registrationStatus.vaultCanShield) {
    return registrationStatus;
  }

  if (!options.autoSetup) {
    throw new Error(
      'Set up Umbra private P2P before sending. Open Receive, choose Umbra, tap Set Up, wait for confirmation, then retry.',
    );
  }

  const setupResult = shouldPreferLegacyUmbraProtocol(params.network)
    ? await withLegacyUmbraRuntime(params, (legacyRuntime) =>
        ensureLegacyUmbraRegistrationForRuntime({
          runtime: legacyRuntime,
          walletAddress,
          anonymous: true,
        }),
      )
    : await ensureUmbraRegistrationForRuntime({
        runtime,
        walletAddress,
        anonymous: true,
      });
  registrationStatus = setupResult.registrationStatus;
  if (registrationStatus.mixerRegistered) return registrationStatus;

  throw new Error(
    setupResult.signatures.length > 0
      ? `Umbra private P2P setup was submitted but anonymous usage is not active on-chain yet. Wait for setup confirmation, then retry. Signature: ${
          setupResult.signatures[0] ?? 'unknown'
        }`
      : 'Umbra private P2P is not active for this wallet. Open Receive, choose Umbra, complete setup, then retry.',
  );
}

async function ensureLegacyUmbraPrivateP2PSenderReady(
  runtime: LegacyUmbraRuntime,
  walletAddress: string,
  options: { autoSetup: boolean },
): Promise<UmbraVaultRegistrationStatus> {
  let registrationStatus = await queryLegacyUmbraVaultRegistrationStatus(runtime, walletAddress);
  if (registrationStatus.mixerRegistered) return registrationStatus;

  if (!options.autoSetup) {
    throw new Error(
      'Set up Umbra private P2P before sending. Open Receive, choose Umbra, tap Set Up, wait for confirmation, then retry.',
    );
  }

  const setupResult = await ensureLegacyUmbraRegistrationForRuntime({
    runtime,
    walletAddress,
    anonymous: true,
  });
  registrationStatus = setupResult.registrationStatus;
  if (registrationStatus.mixerRegistered) return registrationStatus;

  throw new Error(
    setupResult.signatures.length > 0
      ? `Umbra private P2P setup was submitted but anonymous usage is not active on-chain yet. Wait for setup confirmation, then retry. Signature: ${
          setupResult.signatures[0] ?? 'unknown'
        }`
      : 'Umbra private P2P is not active for this wallet. Open Receive, choose Umbra, complete setup, then retry.',
  );
}

function assertUmbraNetworkSupported(network: OffpayNetwork): void {
  if (!isUmbraNetworkSupported(network)) {
    throw new Error(`Umbra is not available on ${network} yet.`);
  }
}

export async function ensureUmbraEncryptedBalanceRegistration(
  params: UmbraWalletExecutionParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  await verifyOffpayUmbraRpcReadiness(params.network);
  const { registrationStatus, signatures } = await ensureUmbraRegistrationForPreferredProtocol(
    params,
    false,
  );
  if (!registrationStatus.vaultCanShield && signatures.length === 0) {
    throw new Error(
      'Umbra vault setup did not submit a transaction and is not confirmed on-chain. Unlock the wallet and try setup again.',
    );
  }
  if (!registrationStatus.vaultCanShield) {
    throw new Error(
      `Umbra vault setup transaction was submitted, but the encrypted-balance account is not confirmed on-chain yet. Signature: ${signatures[0] ?? 'unknown'}`,
    );
  }
  const confirmed = registrationStatus.vaultCanShield;

  return {
    action: 'register',
    walletAddress,
    network: params.network,
    title: confirmed ? 'Private vault ready' : 'Vault setup pending',
    subtitle: confirmed ? 'On-chain setup confirmed.' : 'Submitted; refresh soon.',
    signatures,
    vaultState: registrationStatus.vaultState,
    vaultRegistered: registrationStatus.vaultRegistered,
    vaultCanShield: registrationStatus.vaultCanShield,
    mixerRegistered: registrationStatus.mixerRegistered,
  };
}

export async function ensureUmbraMixerRegistration(
  params: UmbraWalletExecutionParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  await verifyOffpayUmbraRpcReadiness(params.network);
  const { registrationStatus, signatures } = await ensureUmbraRegistrationForPreferredProtocol(
    params,
    true,
  );
  if (!registrationStatus.mixerRegistered && signatures.length === 0) {
    throw new Error(
      'Umbra private P2P setup did not submit a transaction and is not confirmed on-chain. Unlock the wallet and try setup again.',
    );
  }
  if (!registrationStatus.mixerRegistered) {
    throw new Error(
      `Umbra private P2P setup transaction was submitted, but anonymous mixer registration is not confirmed on-chain yet. Signature: ${signatures[0] ?? 'unknown'}`,
    );
  }

  return {
    action: 'register',
    walletAddress,
    network: params.network,
    title: 'Private P2P ready',
    subtitle: 'Umbra anonymous setup confirmed.',
    signatures,
    vaultState: registrationStatus.vaultState,
    vaultRegistered: registrationStatus.vaultRegistered,
    vaultCanShield: registrationStatus.vaultCanShield,
    mixerRegistered: registrationStatus.mixerRegistered,
  };
}

export async function shieldTokenWithUmbra(
  params: UmbraTokenExecutionParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  const recipient = params.recipient?.trim()
    ? assertRecipientAddress(params.recipient)
    : walletAddress;
  const token = await resolveUmbraToken(params);
  // RPC readiness and vault fee account checks are independent — the latter
  // only needs (mint, network) which are already available, so we can fan
  // them out concurrently. On a cold cache this saves up to ~1s (each leg
  // pays its own upstream round-trip); on a warm cache the second leg is a
  // free `Promise.all` join.
  const [, readiness] = await Promise.all([
    verifyOffpayUmbraRpcReadiness(params.network),
    assertOffpayUmbraVaultFeeAccountsReady({
      action: 'shield',
      mint: token.metadata.mint,
      network: params.network,
    }),
  ]);
  const runLegacyShield = (): Promise<UmbraExecutionResult> =>
    withLegacyUmbraRuntime(params, async (runtime) => {
      const deposit = getLegacyPublicBalanceToEncryptedBalanceDirectDepositorFunction(
        { client: runtime.client },
        {
          rpc: buildLegacyRpcDeps(runtime),
          arcium: { awaitComputationFinalization: UMBRA_AWAIT_COMPUTATION_FINALIZATION },
        } as never,
      );
      const result = await deposit(
        recipient as never,
        token.metadata.mint as never,
        BigInt(token.amountAtomic) as never,
      );
      const signatures = collectSignaturesFromResult(result);
      await assertUmbraTransactionSignaturesLanded({
        network: params.network,
        signatures,
        action: 'shield',
        requireSignature: true,
      });
      assertUmbraComputationFinalized({ result, action: 'shield' });
      const selfDeposit = recipient === walletAddress;

      return {
        action: 'shield',
        walletAddress,
        network: params.network,
        title: selfDeposit ? 'Shield complete' : 'Vault deposit complete',
        subtitle: selfDeposit
          ? `${token.amountDisplay} ${token.metadata.symbol}`
          : `${token.amountDisplay} ${token.metadata.symbol} → ${recipient.slice(
              0,
              4,
            )}...${recipient.slice(-4)}`,
        signatures,
        mint: token.metadata.mint,
        tokenSymbol: token.metadata.symbol,
        amountAtomic: token.amountAtomic,
        amountDisplay: token.amountDisplay,
        recipient,
      };
    });

  const runCurrentShield = (): Promise<UmbraExecutionResult> =>
    withUmbraRuntime(params, async (runtime) => {
      const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction(
        { client: runtime.client },
        {
          rpc: buildRpcDeps(runtime),
          arcium: { awaitComputationFinalization: UMBRA_AWAIT_COMPUTATION_FINALIZATION },
        } as never,
      );
      const result = await deposit(
        recipient as never,
        token.metadata.mint as never,
        BigInt(token.amountAtomic) as never,
      );
      const signatures = collectSignaturesFromResult(result);
      await assertUmbraTransactionSignaturesLanded({
        network: params.network,
        signatures,
        action: 'shield',
        requireSignature: true,
      });
      assertUmbraComputationFinalized({ result, action: 'shield' });
      const selfDeposit = recipient === walletAddress;

      return {
        action: 'shield',
        walletAddress,
        network: params.network,
        title: selfDeposit ? 'Shield complete' : 'Vault deposit complete',
        subtitle: selfDeposit
          ? `${token.amountDisplay} ${token.metadata.symbol}`
          : `${token.amountDisplay} ${token.metadata.symbol} → ${recipient.slice(
              0,
              4,
            )}...${recipient.slice(-4)}`,
        signatures,
        mint: token.metadata.mint,
        tokenSymbol: token.metadata.symbol,
        amountAtomic: token.amountAtomic,
        amountDisplay: token.amountDisplay,
        recipient,
      };
    });

  if (shouldPreferLegacyUmbraProtocol(params.network)) {
    assertPreferredLegacyUmbraProtocolAvailable(readiness);
    return runLegacyShield();
  }

  if (readiness.protocolVersion === 'legacy' && isProtocolAvailable(readiness, 'legacy')) {
    return runLegacyShield();
  }

  try {
    return await runCurrentShield();
  } catch (error) {
    if (isUmbraInstructionFallbackNotFound(error) && isProtocolAvailable(readiness, 'legacy')) {
      markOffpayUmbraProtocolVersionUnsupported(params.network, 'current');
      if (__DEV__) {
        console.warn(
          '[umbra-execution] current Umbra protocol instruction unsupported; retrying legacy shield',
          {
            network: params.network,
            mint: token.metadata.mint,
          },
        );
      }
      return runLegacyShield();
    }
    throw error;
  }
}

export async function sendUmbraPrivateP2PFromPublicBalance(
  params: UmbraPrivateP2PParams,
): Promise<UmbraExecutionResult> {
  const totalStartedAt = mark();
  const totalStartTime = Date.now();
  let ok = false;
  let signatureCount = 0;
  let tokenMint: string | null = null;
  assertUmbraNetworkSupported(params.network);

  if (__DEV__) {
    console.log('[umbra-p2p] Starting Umbra private P2P send from public balance');
  }

  try {
    const walletAddress = assertWalletAddress(params.walletAddress);
    const recipient = assertRecipientAddress(params.recipient);
    const token = await resolveUmbraToken({ ...params, requireMixer: true });
    tokenMint = token.metadata.mint;

    if (__DEV__) {
      console.log(
        `[umbra-p2p] Sending ${token.amountDisplay} ${token.metadata.symbol} to ${recipient.slice(0, 8)}...`,
      );
    }

    const readinessStartedAt = mark();
    const readinessStartTime = Date.now();
    try {
      if (__DEV__) {
        console.log('[umbra-p2p] Checking RPC readiness and vault fee accounts...');
      }

      // RPC readiness and vault fee account checks are independent — both
      // need only (mint, network) which are already known, so we can fan
      // them out concurrently. On a cold cache this saves up to ~1s.
      await Promise.all([
        verifyOffpayUmbraRpcReadiness(params.network),
        assertOffpayUmbraVaultFeeAccountsReady({
          action: 'privateP2pFromPublic',
          mint: token.metadata.mint,
          network: params.network,
        }),
      ]);

      if (__DEV__) {
        const readinessDuration = Date.now() - readinessStartTime;
        console.log(
          `[umbra-p2p] Readiness check completed in ${(readinessDuration / 1000).toFixed(2)}s`,
        );
      }
    } finally {
      measure('umbra.p2p.public.readiness', readinessStartedAt, {
        mint: token.metadata.mint,
        network: params.network,
      });
    }

    const buildResult = (
      result: unknown,
      senderRegistrationStatus: UmbraVaultRegistrationStatus,
    ): UmbraExecutionResult => {
      const signatures = collectSignaturesFromResult(result);
      const primarySignature = getUmbraPublicCreateUtxoSignature(result);
      if (primarySignature == null) {
        throw new Error(
          getUmbraFriendlyErrorMessage('Umbra private P2P did not submit a transaction.', 'shield'),
        );
      }

      return {
        action: 'private-p2p',
        walletAddress,
        network: params.network,
        title: 'Umbra private payment sent',
        subtitle: `${token.amountDisplay} ${token.metadata.symbol} → ${recipient.slice(
          0,
          4,
        )}...${recipient.slice(-4)}`,
        signatures,
        primarySignature,
        mint: token.metadata.mint,
        tokenSymbol: token.metadata.symbol,
        amountAtomic: token.amountAtomic,
        amountDisplay: token.amountDisplay,
        recipient,
        p2pSource: 'public-balance',
        vaultState: senderRegistrationStatus.vaultState,
        vaultRegistered: senderRegistrationStatus.vaultRegistered,
        vaultCanShield: senderRegistrationStatus.vaultCanShield,
        mixerRegistered: senderRegistrationStatus.mixerRegistered,
      };
    };

    const runLegacyPublicPrivateP2P = (): Promise<UmbraExecutionResult> => {
      const runtimeStartedAt = mark();
      return withLegacyUmbraRuntime(params, async (runtime) => {
        measure('umbra.p2p.public.runtimeReady', runtimeStartedAt, {
          mint: token.metadata.mint,
          network: params.network,
          protocol: 'legacy',
        });
        const recipientIsSender = recipient === walletAddress;
        const queryReceiverRegistration = async (): Promise<void> => {
          if (recipientIsSender) return;
          const receiverStartedAt = mark();
          const receiverRegistrationStatus = await queryLegacyUmbraVaultRegistrationStatus(
            runtime,
            recipient,
          ).finally(() => {
            measure('umbra.p2p.public.receiverRegistration', receiverStartedAt, {
              mint: token.metadata.mint,
              network: params.network,
              protocol: 'legacy',
            });
          });
          if (!receiverRegistrationStatus.mixerRegistered) {
            throw new Error(
              'Recipient has not set up Umbra private P2P yet. Ask them to open Receive, choose Umbra private P2P, complete setup, then retry.',
            );
          }
        };
        const querySenderRegistration = async (): Promise<UmbraVaultRegistrationStatus> => {
          const senderStartedAt = mark();
          return ensureLegacyUmbraPrivateP2PSenderReady(runtime, walletAddress, {
            autoSetup: params.autoSetupSender === true,
          }).finally(() => {
            measure('umbra.p2p.public.senderReady', senderStartedAt, {
              autoSetup: params.autoSetupSender === true,
              mint: token.metadata.mint,
              network: params.network,
              protocol: 'legacy',
            });
          });
        };
        let senderRegistrationStatus: UmbraVaultRegistrationStatus;
        if (!recipientIsSender && params.autoSetupSender !== true) {
          const [receiverResult, senderResult] = await Promise.allSettled([
            queryReceiverRegistration(),
            querySenderRegistration(),
          ]);
          if (receiverResult.status === 'rejected') throw receiverResult.reason;
          if (senderResult.status === 'rejected') throw senderResult.reason;
          senderRegistrationStatus = senderResult.value;
        } else {
          await queryReceiverRegistration();
          senderRegistrationStatus = await querySenderRegistration();
        }
        if (recipientIsSender && !senderRegistrationStatus.mixerRegistered) {
          throw new Error(
            'Umbra private P2P setup is not confirmed yet. Try again after setup lands.',
          );
        }
        const createUtxo = getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client: runtime.client },
          {
            zkProver: getRnCreateReceiverClaimableUtxoFromPublicBalanceProver(),
            rpc: buildLegacyPublicP2PSubmitOnlyRpcDeps(runtime, token.metadata),
          } as never,
        );
        const createUtxoStartedAt = mark();
        const createUtxoStartTime = Date.now();

        if (__DEV__) {
          console.log(
            '[umbra-p2p] Starting UTXO creation (this includes ZK proof generation, may take 1-2 minutes on device)...',
          );
        }

        const result = await createUtxo(
          {
            amount: BigInt(token.amountAtomic) as never,
            destinationAddress: recipient as never,
            mint: token.metadata.mint as never,
          } as never,
          {
            optionalData: new Uint8Array(32) as never,
          } as never,
        ).finally(() => {
          const createUtxoDuration = Date.now() - createUtxoStartTime;
          if (__DEV__) {
            console.log(
              `[umbra-p2p] UTXO creation completed in ${(createUtxoDuration / 1000).toFixed(2)}s`,
            );
          }
          measure('umbra.p2p.public.createUtxo', createUtxoStartedAt, {
            mint: token.metadata.mint,
            network: params.network,
            protocol: 'legacy',
            durationMs: createUtxoDuration,
          });
        });

        return buildResult(result, senderRegistrationStatus);
      });
    };

    const runCurrentPublicPrivateP2P = (): Promise<UmbraExecutionResult> => {
      const runtimeStartedAt = mark();
      return withUmbraRuntime(params, async (runtime) => {
        measure('umbra.p2p.public.runtimeReady', runtimeStartedAt, {
          mint: token.metadata.mint,
          network: params.network,
          protocol: 'current',
        });
        const recipientIsSender = recipient === walletAddress;
        const queryReceiverRegistration = async (): Promise<void> => {
          if (recipientIsSender) return;
          const receiverStartedAt = mark();
          const receiverRegistrationStatus = await queryUmbraVaultRegistrationStatus(
            runtime,
            recipient,
          ).finally(() => {
            measure('umbra.p2p.public.receiverRegistration', receiverStartedAt, {
              mint: token.metadata.mint,
              network: params.network,
              protocol: 'current',
            });
          });
          if (!receiverRegistrationStatus.mixerRegistered) {
            throw new Error(
              'Recipient has not set up Umbra private P2P yet. Ask them to open Receive, choose Umbra private P2P, complete setup, then retry.',
            );
          }
        };
        const querySenderRegistration = async (): Promise<UmbraVaultRegistrationStatus> => {
          const senderStartedAt = mark();
          return ensureUmbraPrivateP2PSenderReady(runtime, walletAddress, params, {
            autoSetup: params.autoSetupSender === true,
          }).finally(() => {
            measure('umbra.p2p.public.senderReady', senderStartedAt, {
              autoSetup: params.autoSetupSender === true,
              mint: token.metadata.mint,
              network: params.network,
              protocol: 'current',
            });
          });
        };
        let senderRegistrationStatus: UmbraVaultRegistrationStatus;
        if (!recipientIsSender && params.autoSetupSender !== true) {
          const [receiverResult, senderResult] = await Promise.allSettled([
            queryReceiverRegistration(),
            querySenderRegistration(),
          ]);
          if (receiverResult.status === 'rejected') throw receiverResult.reason;
          if (senderResult.status === 'rejected') throw senderResult.reason;
          senderRegistrationStatus = senderResult.value;
        } else {
          await queryReceiverRegistration();
          senderRegistrationStatus = await querySenderRegistration();
        }
        if (recipientIsSender && !senderRegistrationStatus.mixerRegistered) {
          throw new Error(
            'Umbra private P2P setup is not confirmed yet. Try again after setup lands.',
          );
        }
        const createUtxo = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client: runtime.client },
          {
            zkProver: getRnCreateReceiverClaimableUtxoFromPublicBalanceProver(),
            rpc: buildPublicP2PSubmitOnlyRpcDeps(runtime, token.metadata),
          } as never,
        );
        const createUtxoStartedAt = mark();
        const createUtxoStartTime = Date.now();

        if (__DEV__) {
          console.log(
            '[umbra-p2p] Starting UTXO creation (this includes ZK proof generation, may take 1-2 minutes on device)...',
          );
        }

        const result = await createUtxo(
          {
            amount: BigInt(token.amountAtomic) as never,
            destinationAddress: recipient as never,
            mint: token.metadata.mint as never,
          } as never,
          {
            optionalData: new Uint8Array(32) as never,
          } as never,
        ).finally(() => {
          const createUtxoDuration = Date.now() - createUtxoStartTime;
          if (__DEV__) {
            console.log(
              `[umbra-p2p] UTXO creation completed in ${(createUtxoDuration / 1000).toFixed(2)}s`,
            );
          }
          measure('umbra.p2p.public.createUtxo', createUtxoStartedAt, {
            mint: token.metadata.mint,
            network: params.network,
            protocol: 'current',
            durationMs: createUtxoDuration,
          });
        });

        return buildResult(result, senderRegistrationStatus);
      });
    };

    let result: UmbraExecutionResult;
    if (shouldPreferLegacyUmbraProtocol(params.network)) {
      result = await runLegacyPublicPrivateP2P();
    } else {
      try {
        result = await runCurrentPublicPrivateP2P();
      } catch (error) {
        if (!isUmbraInstructionFallbackNotFound(error)) throw error;
        if (!isLegacyUmbraProtocolAccepted(params.network)) throw error;
        markOffpayUmbraProtocolVersionUnsupported(params.network, 'current');
        result = await runLegacyPublicPrivateP2P();
      }
    }

    ok = true;
    signatureCount = result.signatures.length;

    if (__DEV__) {
      const totalDuration = Date.now() - totalStartTime;
      console.log(
        `[umbra-p2p] Private P2P send completed successfully in ${(totalDuration / 1000).toFixed(2)}s`,
      );
    }

    return result;
  } finally {
    measure('umbra.p2p.public.total', totalStartedAt, {
      mint: tokenMint,
      network: params.network,
      ok,
      signatureCount,
    });
  }
}

export async function sendUmbraPrivateP2PFromEncryptedBalance(
  params: UmbraPrivateP2PFromEncryptedBalanceParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  const recipient = assertRecipientAddress(params.recipient);
  const token = await resolveUmbraToken({ ...params, requireMixer: true });
  // RPC readiness and vault fee account checks are independent — both
  // need only (mint, network) which are already known, so we can fan
  // them out concurrently. On a cold cache this saves up to ~1s.
  const [, readiness] = await Promise.all([
    verifyOffpayUmbraRpcReadiness(params.network),
    assertOffpayUmbraVaultFeeAccountsReady({
      action: 'privateP2pFromEncrypted',
      mint: token.metadata.mint,
      network: params.network,
    }),
  ]);

  const buildResult = async (
    result: unknown,
    registrationStatus: UmbraVaultRegistrationStatus,
  ): Promise<UmbraExecutionResult> => {
    const signatures = collectSignaturesFromResult(result);
    const primarySignature = getUmbraPreferredSignature(result);
    await assertUmbraTransactionSignaturesLanded({
      network: params.network,
      signatures,
      action: 'shield',
      requireSignature: true,
    });
    assertUmbraComputationFinalized({ result, action: 'shield' });

    return {
      action: 'private-p2p',
      walletAddress,
      network: params.network,
      title: 'Umbra vault payment sent',
      subtitle: `${token.amountDisplay} ${token.metadata.symbol} → ${recipient.slice(
        0,
        4,
      )}...${recipient.slice(-4)}`,
      signatures,
      ...(primarySignature == null ? {} : { primarySignature }),
      mint: token.metadata.mint,
      tokenSymbol: token.metadata.symbol,
      amountAtomic: token.amountAtomic,
      amountDisplay: token.amountDisplay,
      recipient,
      p2pSource: 'encrypted-balance',
      vaultState: registrationStatus.vaultState,
      vaultRegistered: registrationStatus.vaultRegistered,
      vaultCanShield: registrationStatus.vaultCanShield,
      mixerRegistered: registrationStatus.mixerRegistered,
    };
  };

  const runLegacyEncryptedPrivateP2P = (): Promise<UmbraExecutionResult> =>
    withLegacyUmbraRuntime(params, async (runtime) => {
      const { registrationStatus } = await ensureLegacyUmbraRegistrationForRuntime({
        runtime,
        walletAddress,
        anonymous: true,
      });
      if (!registrationStatus.mixerRegistered) {
        throw new Error(
          'Umbra private P2P setup is not confirmed yet. Try again after setup lands.',
        );
      }

      const createUtxo = getLegacyEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
        { client: runtime.client },
        {
          zkProver: getRnCreateReceiverClaimableUtxoFromEncryptedBalanceProver(),
          rpc: buildLegacyRpcDeps(runtime),
          arcium: { awaitComputationFinalization: UMBRA_AWAIT_COMPUTATION_FINALIZATION },
        } as never,
      );
      const result = await createUtxo(
        {
          amount: BigInt(token.amountAtomic) as never,
          destinationAddress: recipient as never,
          mint: token.metadata.mint as never,
        } as never,
        {
          optionalData: new Uint8Array(32) as never,
        } as never,
      );

      return buildResult(result, registrationStatus);
    });

  const runCurrentEncryptedPrivateP2P = (): Promise<UmbraExecutionResult> =>
    withUmbraRuntime(params, async (runtime) => {
      const { registrationStatus } = await ensureUmbraRegistrationForRuntime({
        runtime,
        walletAddress,
        anonymous: true,
      });
      if (!registrationStatus.mixerRegistered) {
        throw new Error(
          'Umbra private P2P setup is not confirmed yet. Try again after setup lands.',
        );
      }

      const createUtxo = getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
        { client: runtime.client },
        {
          zkProver: getRnCreateReceiverClaimableUtxoFromEncryptedBalanceProver(),
          rpc: buildRpcDeps(runtime),
          arcium: { awaitComputationFinalization: UMBRA_AWAIT_COMPUTATION_FINALIZATION },
        } as never,
      );
      const result = await createUtxo(
        {
          amount: BigInt(token.amountAtomic) as never,
          destinationAddress: recipient as never,
          mint: token.metadata.mint as never,
        } as never,
        {
          optionalData: new Uint8Array(32) as never,
        } as never,
      );

      return buildResult(result, registrationStatus);
    });

  if (shouldPreferLegacyUmbraProtocol(params.network)) {
    assertPreferredLegacyUmbraProtocolAvailable(readiness);
    return runLegacyEncryptedPrivateP2P();
  }

  try {
    return await runCurrentEncryptedPrivateP2P();
  } catch (error) {
    if (!isUmbraInstructionFallbackNotFound(error)) throw error;
    if (!isProtocolAvailable(readiness, 'legacy')) throw error;
    markOffpayUmbraProtocolVersionUnsupported(params.network, 'current');
    return runLegacyEncryptedPrivateP2P();
  }
}

async function scanUmbraPrivateP2PUtxos(
  runtime: UmbraRuntime,
  network: OffpayNetwork,
  params: UmbraClaimScanParams,
): Promise<UmbraPrivateP2PUtxoScanResult> {
  const pageLimit =
    params.pageLimit == null
      ? UMBRA_CLAIM_SCAN_PAGE_LIMIT
      : typeof params.pageLimit === 'bigint'
        ? params.pageLimit
        : BigInt(Math.max(1, Math.trunc(params.pageLimit)));
  const window = await resolveUmbraClaimScanWindow(network, params);
  const walletParams = params as Partial<UmbraWalletExecutionParams>;
  const cacheScope = getUmbraClaimScanCacheScope({
    runtime,
    network,
    walletAddress: walletParams.walletAddress,
    walletId: walletParams.walletId,
    treeIndex: window.treeIndex,
  });
  const cachedScanResult = readUmbraClaimScanCache(cacheScope, window);
  if (cachedScanResult != null) {
    measure('umbra.claims.sdkScan.cacheHit', mark(), {
      network,
      scanMode: window.mode,
      schemeCount:
        runtime.activeMasterSeedSchemeId == null
          ? (runtime.client.masterSeedSchemes?.length ?? 0)
          : 1,
      treeIndex: Number(window.treeIndex),
      startInsertionIndex: window.start.toString(),
      endInsertionIndex: window.end.toString(),
      leafCount: Number(window.leafCount),
    });
    return cachedScanResult;
  }
  const fetchUtxoData = createOffpayUmbraUtxoDataFetcher(network, {
    maxLimit: pageLimit,
    signal: params.signal,
    // Yielding between indexer pages keeps deep scans responsive; fast
    // recent/range scans skip the ~16ms frame tax per page.
    yieldAfterPage: window.mode === 'deep',
  });
  // Deep scans intentionally try every registered master-seed scheme so older
  // notes created under a legacy scheme are still discovered. Recent/range
  // (the auto/fast paths) narrow to the wallet's active scheme to cut the
  // dominant per-note X25519 cost ~4×.
  const scanClient =
    window.mode === 'deep'
      ? runtime.client
      : narrowUmbraClientToScheme(runtime.client, runtime.activeMasterSeedSchemeId);
  const schemeCount = Array.isArray(scanClient.masterSeedSchemes)
    ? scanClient.masterSeedSchemes.length
    : 0;
  const clientWithIndexer = {
    ...scanClient,
    fetchUtxoData,
    fetchTreeSummary: async () => window.summaries,
    ...(window.fakeProgressStore == null ? {} : { utxoDataStore: window.fakeProgressStore }),
  } as IUmbraClient;
  const scanner = getClaimableUtxoScannerFunction({ client: clientWithIndexer }, {
    fetchUtxoData,
    aesDecryptor: createYieldingUmbraAesDecryptor(window.mode === 'deep' ? 8 : 4, params.signal),
  } as never);
  const startedAt = mark();
  const scanResult = (await scanner()) as {
    etaToStealthPoolReceiverBurnable?: readonly unknown[];
    ataToStealthPoolReceiverBurnable?: readonly unknown[];
    networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress?: readonly unknown[];
    etaToStealthPoolSelfBurnable?: readonly unknown[];
    ataToStealthPoolSelfBurnable?: readonly unknown[];
    networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress?: readonly unknown[];
    etaIntoReceiverBurnable?: readonly unknown[];
    ataIntoReceiverBurnable?: readonly unknown[];
    etaIntoSelfBurnable?: readonly unknown[];
    ataIntoSelfBurnable?: readonly unknown[];
    received?: readonly unknown[];
    publicReceived?: readonly unknown[];
    selfBurnable?: readonly unknown[];
    publicSelfBurnable?: readonly unknown[];
    scannedTrees?: readonly {
      treeIndex: bigint;
      scannedRange: { end: bigint } | null;
    }[];
    nextScanStartIndex?: unknown;
  };
  const selectedTreeIndex = BigInt(params.treeIndex ?? 0);
  const scannedTrees = Array.isArray(scanResult.scannedTrees) ? scanResult.scannedTrees : [];
  const selectedProgress =
    scannedTrees.find((tree) => tree.treeIndex === selectedTreeIndex) ?? scannedTrees[0] ?? null;
  const nextScanStartIndex =
    scanResult.nextScanStartIndex ??
    selectedProgress?.scannedRange?.end ??
    BigInt(params.startInsertionIndex ?? 0);
  measure('umbra.claims.sdkScan', startedAt, {
    network,
    scanMode: window.mode,
    schemeCount,
    pageLimit: Number(pageLimit),
    treeIndex: Number(window.treeIndex),
    startInsertionIndex: window.start.toString(),
    endInsertionIndex: window.end.toString(),
    leafCount: Number(window.leafCount),
    totalLeaves: window.totalLeaves.toString(),
    receiverCount:
      (scanResult.etaToStealthPoolReceiverBurnable?.length ?? 0) +
      (scanResult.ataToStealthPoolReceiverBurnable?.length ?? 0) +
      (scanResult.networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress?.length ?? 0) +
      (scanResult.etaIntoReceiverBurnable?.length ?? scanResult.received?.length ?? 0) +
      (scanResult.ataIntoReceiverBurnable?.length ?? scanResult.publicReceived?.length ?? 0),
    selfCount:
      (scanResult.etaToStealthPoolSelfBurnable?.length ?? 0) +
      (scanResult.ataToStealthPoolSelfBurnable?.length ?? 0) +
      (scanResult.networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress?.length ?? 0) +
      (scanResult.etaIntoSelfBurnable?.length ?? scanResult.selfBurnable?.length ?? 0) +
      (scanResult.ataIntoSelfBurnable?.length ?? scanResult.publicSelfBurnable?.length ?? 0),
  });

  const result: UmbraPrivateP2PUtxoScanResult = {
    receiverClaimableUtxos: [
      ...(scanResult.etaToStealthPoolReceiverBurnable ?? []),
      ...(scanResult.ataToStealthPoolReceiverBurnable ?? []),
      ...(scanResult.networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress ?? []),
      ...(scanResult.etaIntoReceiverBurnable ?? scanResult.received ?? []),
      ...(scanResult.ataIntoReceiverBurnable ?? scanResult.publicReceived ?? []),
    ],
    selfClaimableUtxos: [
      ...(scanResult.etaToStealthPoolSelfBurnable ?? []),
      ...(scanResult.ataToStealthPoolSelfBurnable ?? []),
      ...(scanResult.networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress ?? []),
      ...(scanResult.etaIntoSelfBurnable ?? scanResult.selfBurnable ?? []),
      ...(scanResult.ataIntoSelfBurnable ?? scanResult.publicSelfBurnable ?? []),
    ],
    nextScanStartIndex: String(nextScanStartIndex),
    scanMode: window.mode,
    scanStartInsertionIndex: Number(window.start),
    scanEndInsertionIndex: Number(window.end),
  };
  writeUmbraClaimScanCache(cacheScope, window, result);
  return result;
}

function getU128LeBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array && value.length === 16) return value;

  let numeric: bigint | null = null;
  if (typeof value === 'bigint') {
    numeric = value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    numeric = BigInt(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    numeric = BigInt(value);
  }

  if (numeric == null || numeric < 0n || numeric >= 1n << 128n) return null;

  const bytes = new Uint8Array(16);
  let remaining = numeric;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function getU256BeBytes(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError('Value does not fit in U256');
  }

  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function getU256LeBytes(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError('Value does not fit in U256');
  }

  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function decodeU256LeBytes(value: Uint8Array): bigint {
  let decoded = 0n;
  for (let index = 0; index < value.length; index += 1) {
    decoded |= BigInt(value[index] ?? 0) << BigInt(index * 8);
  }
  return decoded;
}

function getUtxoModifiedGenerationIndexBytes(utxo: unknown): Uint8Array | null {
  if (utxo == null || typeof utxo !== 'object') return null;
  const value = utxo as {
    modifiedGenerationIndex?: unknown;
    depositModifiedGenerationIndex?: unknown;
  };
  return (
    getU128LeBytes(value.modifiedGenerationIndex) ??
    getU128LeBytes(value.depositModifiedGenerationIndex)
  );
}

async function getUtxoNullifierValue(utxo: unknown): Promise<bigint | null> {
  const modifiedGenerationIndexBytes = getUtxoModifiedGenerationIndexBytes(utxo);
  if (modifiedGenerationIndexBytes == null) return null;
  return BigInt(
    await deriveNullifierFromModifiedGenerationIndex(modifiedGenerationIndexBytes as never),
  );
}

function getUtxoUnlockerType(utxo: unknown): string | null {
  if (utxo == null || typeof utxo !== 'object') return null;
  const value = (utxo as { unlockerType?: unknown }).unlockerType;
  return typeof value === 'string' ? value : null;
}

function getU256SearchSequences(value: bigint): Uint8Array[] {
  const littleEndian = getU256LeBytes(value);
  const bigEndian = getU256BeBytes(value);
  return byteArraysEqual(littleEndian, bigEndian) ? [littleEndian] : [littleEndian, bigEndian];
}

function bytesContainSequence(bytes: Uint8Array, sequence: Uint8Array): boolean {
  if (sequence.length === 0 || bytes.length < sequence.length) return false;
  const lastStart = bytes.length - sequence.length;
  for (let offset = 0; offset <= lastStart; offset += 1) {
    let matches = true;
    for (let index = 0; index < sequence.length; index += 1) {
      if (bytes[offset + index] !== sequence[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function getMaybeEncodedAccountData(account: unknown): Uint8Array | null {
  if (account == null || typeof account !== 'object') return null;
  if ((account as { exists?: unknown }).exists !== true) return null;
  const data = (account as { data?: unknown }).data;
  return data instanceof Uint8Array ? data : null;
}

async function getOnChainClaimedUmbraInsertionIndexSet(
  runtime: UmbraRuntime,
  treeIndex: number | undefined,
  utxos: readonly unknown[],
): Promise<ReadonlySet<number>> {
  const startedAt = mark();
  let candidateCount = 0;
  let nullifierSetAccountCount = 0;
  let claimedCount = 0;
  try {
    const candidates = (
      await Promise.all(
        utxos.map(async (utxo) => {
          const insertionIndex = getUtxoInsertionIndexAsNumber(utxo);
          const modifiedGenerationIndexBytes = getUtxoModifiedGenerationIndexBytes(utxo);
          const nullifier = await getUtxoNullifierValue(utxo);
          if (insertionIndex == null || modifiedGenerationIndexBytes == null || nullifier == null) {
            return null;
          }

          return {
            insertionIndex,
            modifiedGenerationIndexBytes,
            nullifier,
            unlockerType: getUtxoUnlockerType(utxo),
          };
        }),
      )
    ).filter(
      (
        candidate,
      ): candidate is {
        insertionIndex: number;
        modifiedGenerationIndexBytes: Uint8Array;
        nullifier: bigint;
        unlockerType: string | null;
      } => candidate != null,
    );
    candidateCount = candidates.length;
    if (candidates.length === 0) return new Set();

    const poseidonHasher = getPoseidonHasher();
    const receiverPoseidonPrivateKey = candidates.some(
      (candidate) =>
        candidate.unlockerType !== 'self-burnable' &&
        candidate.unlockerType !== 'public-self-burnable',
    )
      ? await getPoseidonPrivateKeyDeriver({ client: runtime.client })()
      : null;
    const ephemeralPoseidonPrivateKeyDeriver = candidates.some(
      (candidate) =>
        candidate.unlockerType === 'self-burnable' ||
        candidate.unlockerType === 'public-self-burnable',
    )
      ? getEphemeralUtxoPoseidonPrivateKeyDeriver({ client: runtime.client })
      : null;
    const candidateNullifierHashes = await Promise.all(
      candidates.map(async (candidate) => {
        const poseidonPrivateKey =
          candidate.unlockerType === 'self-burnable' ||
          candidate.unlockerType === 'public-self-burnable'
            ? await ephemeralPoseidonPrivateKeyDeriver!(
                decodeU256LeBytes(
                  await expandModifiedGenerationIndex(
                    candidate.modifiedGenerationIndexBytes as never,
                  ),
                ) as never,
              )
            : receiverPoseidonPrivateKey;
        if (poseidonPrivateKey == null) return null;
        const nullifierHash = BigInt(
          await poseidonHasher([poseidonPrivateKey, candidate.nullifier] as never),
        );
        return {
          insertionIndex: candidate.insertionIndex,
          sequences: getU256SearchSequences(nullifierHash),
        };
      }),
    );

    const nullifierSetPdas = await findNullifierSetPdas(
      BigInt(treeIndex ?? 0) as never,
      runtime.client.networkConfig.programId as never,
    );
    const nullifierSetAddresses = [
      nullifierSetPdas.treap0,
      nullifierSetPdas.treap1,
      nullifierSetPdas.treap2,
      nullifierSetPdas.treap3,
      nullifierSetPdas.treap4,
    ];
    const accountMap = await runtime.rpc.accountInfoProvider(nullifierSetAddresses as never);
    const nullifierSetData = nullifierSetAddresses
      .map((address) =>
        getMaybeEncodedAccountData(getMapValueByStringKey(accountMap, String(address))),
      )
      .filter((data): data is Uint8Array => data != null);
    nullifierSetAccountCount = nullifierSetData.length;

    if (nullifierSetData.length === 0) return new Set();

    const claimedInsertionIndices = new Set<number>();
    for (const candidate of candidateNullifierHashes) {
      if (candidate == null) continue;
      if (
        nullifierSetData.some((data) =>
          candidate.sequences.some((sequence) => bytesContainSequence(data, sequence)),
        )
      ) {
        const { insertionIndex } = candidate;
        claimedInsertionIndices.add(insertionIndex);
      }
    }
    claimedCount = claimedInsertionIndices.size;
    return claimedInsertionIndices;
  } finally {
    measure('umbra.claims.nullifierCheck', startedAt, {
      network: runtime.network,
      treeIndex: treeIndex ?? 0,
      inputCount: utxos.length,
      candidateCount,
      nullifierSetAccountCount,
      claimedCount,
    });
  }
}

function filterClaimableUtxos<T>(
  utxos: readonly T[],
  excluded: ReadonlySet<number> | null | undefined,
): T[] {
  if (!excluded || excluded.size === 0) return [...utxos];
  return utxos.filter((utxo) => {
    const index = getUtxoInsertionIndexAsNumber(utxo);
    return index == null ? true : !excluded.has(index);
  });
}

export function getUmbraClaimScanRangeForInsertionIndices(
  insertionIndices: readonly number[] | null | undefined,
): Pick<UmbraClaimScanParams, 'scanMode' | 'startInsertionIndex' | 'endInsertionIndex'> {
  const validIndices = (insertionIndices ?? []).filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
  if (validIndices.length === 0) {
    return { scanMode: 'recent' };
  }

  return {
    scanMode: 'range',
    startInsertionIndex: Math.min(...validIndices),
    endInsertionIndex: Math.max(...validIndices),
  };
}

export async function scanUmbraPrivateP2PClaims(
  params: UmbraWalletExecutionParams & {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
    scanMode?: UmbraClaimScanMode;
    recentLeafLimit?: number | bigint;
    excludedInsertionIndices?: ReadonlySet<number> | readonly number[] | null;
    signal?: AbortSignal | null;
    pageLimit?: number | bigint;
  },
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  const startedAt = mark();
  await verifyOffpayUmbraRpcReadiness(params.network);

  const excluded =
    params.excludedInsertionIndices == null
      ? null
      : params.excludedInsertionIndices instanceof Set
        ? (params.excludedInsertionIndices as ReadonlySet<number>)
        : new Set(params.excludedInsertionIndices as readonly number[]);

  try {
    return await withUmbraRuntime(params, async (runtime) => {
      const [registrationStatus, scanResult] = await Promise.all([
        queryUmbraVaultRegistrationStatus(runtime, walletAddress),
        scanUmbraPrivateP2PUtxos(runtime, params.network, params),
      ]);
      const onChainClaimedIndices = await getOnChainClaimedUmbraInsertionIndexSet(
        runtime,
        params.treeIndex,
        [...scanResult.receiverClaimableUtxos, ...scanResult.selfClaimableUtxos],
      );
      const effectiveExcluded =
        excluded == null || excluded.size === 0
          ? onChainClaimedIndices
          : new Set([...excluded, ...onChainClaimedIndices]);
      const receiverClaimableUtxos = filterClaimableUtxos(
        scanResult.receiverClaimableUtxos,
        effectiveExcluded,
      );
      const selfClaimableUtxos = filterClaimableUtxos(
        scanResult.selfClaimableUtxos,
        effectiveExcluded,
      );
      const nextScanStartIndex = scanResult.nextScanStartIndex;
      const pendingClaimCount = receiverClaimableUtxos.length + selfClaimableUtxos.length;
      const pendingClaimUtxoInsertionIndices = [...receiverClaimableUtxos, ...selfClaimableUtxos]
        .map(getUtxoInsertionIndexAsNumber)
        .filter((value): value is number => value != null);
      const pendingClaimUtxoDetails: UmbraPendingClaimUtxo[] = [
        ...receiverClaimableUtxos
          .map((utxo) => projectPendingClaimUtxo(utxo, 'receiver'))
          .filter((value): value is UmbraPendingClaimUtxo => value != null),
        ...selfClaimableUtxos
          .map((utxo) => projectPendingClaimUtxo(utxo, 'self'))
          .filter((value): value is UmbraPendingClaimUtxo => value != null),
      ];

      if (!registrationStatus.mixerRegistered && receiverClaimableUtxos.length > 0) {
        return {
          action: 'claim',
          walletAddress,
          network: params.network,
          title: 'Umbra setup required',
          subtitle: 'Register Umbra privacy before claiming receiver private P2P payments.',
          signatures: [],
          pendingClaimCount,
          claimedUtxoCount: 0,
          pendingClaimUtxoInsertionIndices,
          pendingClaimUtxoDetails,
          nextScanStartIndex,
          vaultState: registrationStatus.vaultState,
          vaultRegistered: registrationStatus.vaultRegistered,
          vaultCanShield: registrationStatus.vaultCanShield,
          mixerRegistered: registrationStatus.mixerRegistered,
        };
      }

      if (!registrationStatus.vaultCanShield && selfClaimableUtxos.length > 0) {
        return {
          action: 'claim',
          walletAddress,
          network: params.network,
          title: 'Umbra vault setup required',
          subtitle: 'Set up your Umbra vault before claiming private payments to your wallet.',
          signatures: [],
          pendingClaimCount,
          claimedUtxoCount: 0,
          pendingClaimUtxoInsertionIndices,
          pendingClaimUtxoDetails,
          nextScanStartIndex,
          vaultState: registrationStatus.vaultState,
          vaultRegistered: registrationStatus.vaultRegistered,
          vaultCanShield: registrationStatus.vaultCanShield,
          mixerRegistered: registrationStatus.mixerRegistered,
        };
      }

      return {
        action: 'claim',
        walletAddress,
        network: params.network,
        title: pendingClaimCount === 0 ? 'No private payments found' : 'Private payment ready',
        subtitle:
          pendingClaimCount === 0
            ? 'There are no claimable Umbra UTXOs for this wallet.'
            : `${pendingClaimCount} Umbra UTXO${
                pendingClaimCount === 1 ? '' : 's'
              } ready to claim into encrypted balance.`,
        signatures: [],
        pendingClaimCount,
        claimedUtxoCount: 0,
        pendingClaimUtxoInsertionIndices,
        pendingClaimUtxoDetails,
        nextScanStartIndex,
        vaultState: registrationStatus.vaultState,
        vaultRegistered: registrationStatus.vaultRegistered,
        vaultCanShield: registrationStatus.vaultCanShield,
        mixerRegistered: registrationStatus.mixerRegistered,
      };
    });
  } finally {
    measure('umbra.claims.scan', startedAt, {
      network: params.network,
      scanMode: params.scanMode ?? (params.startInsertionIndex != null ? 'range' : 'recent'),
      pageLimit:
        params.pageLimit == null ? Number(UMBRA_CLAIM_SCAN_PAGE_LIMIT) : Number(params.pageLimit),
    });
  }
}

export async function claimUmbraPrivateP2PToEncryptedBalance(
  params: UmbraWalletExecutionParams & {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
    scanMode?: UmbraClaimScanMode;
    recentLeafLimit?: number | bigint;
    excludedInsertionIndices?: ReadonlySet<number> | readonly number[] | null;
    signal?: AbortSignal | null;
    pageLimit?: number | bigint;
    /**
     * Called synchronously as soon as the SDK confirms the on-chain
     * nullifier is set for a UTXO (relayer status `completed` or
     * benign already-claimed). The receive flow uses this to persist
     * the local exclusion set BEFORE the React component has a chance
     * to unmount. Without this, a user navigating away mid-claim
     * could lose the persistence and the next scan would resurface
     * the UTXO that has already been claimed on-chain.
     */
    onUtxoClaimedOnChain?: (insertionIndices: readonly number[]) => void;
  },
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  await verifyOffpayUmbraRpcReadiness(params.network);

  const excluded =
    params.excludedInsertionIndices == null
      ? null
      : params.excludedInsertionIndices instanceof Set
        ? (params.excludedInsertionIndices as ReadonlySet<number>)
        : new Set(params.excludedInsertionIndices as readonly number[]);

  return withUmbraRuntime(params, async (runtime) => {
    const [registrationStatus, scanResult] = await Promise.all([
      queryUmbraVaultRegistrationStatus(runtime, walletAddress),
      scanUmbraPrivateP2PUtxos(runtime, params.network, params),
    ]);
    const receiverClaimableUtxos = filterClaimableUtxos(
      scanResult.receiverClaimableUtxos,
      excluded,
    );
    const selfClaimableUtxos = filterClaimableUtxos(scanResult.selfClaimableUtxos, excluded);
    const nextScanStartIndex = scanResult.nextScanStartIndex;
    const pendingClaimCount = receiverClaimableUtxos.length + selfClaimableUtxos.length;

    if (!registrationStatus.mixerRegistered && receiverClaimableUtxos.length > 0) {
      throw new Error(
        'Set up Umbra private P2P before claiming receiver private payments. Open Receive, choose Umbra private P2P, complete setup, then retry.',
      );
    }

    if (!registrationStatus.vaultCanShield && selfClaimableUtxos.length > 0) {
      throw new Error(
        'Set up your Umbra vault before claiming private payments to your wallet. Open Receive, choose Umbra private P2P, complete setup, then retry.',
      );
    }

    if (pendingClaimCount === 0) {
      return {
        action: 'claim',
        walletAddress,
        network: params.network,
        title: 'No private payments found',
        subtitle: 'There are no claimable Umbra UTXOs for this wallet.',
        signatures: [],
        pendingClaimCount: 0,
        claimedUtxoCount: 0,
        nextScanStartIndex,
        vaultState: registrationStatus.vaultState,
        vaultRegistered: registrationStatus.vaultRegistered,
        vaultCanShield: registrationStatus.vaultCanShield,
        mixerRegistered: registrationStatus.mixerRegistered,
      };
    }

    const legacyClaimRuntime = shouldPreferLegacyUmbraProtocol(params.network)
      ? await createLegacyUmbraRuntime(params)
      : null;

    try {
      const claimResults: unknown[] = [];
      // Track per-batch outcomes so we can persist exclusion indices
      // only for UTXOs whose nullifier is now set on-chain. The earlier
      // shape persisted *every* attempted UTXO on success, which would
      // hide UTXOs that the relayer reported as `failed`.
      const resolvedReceiverIndices = new Set<number>();
      const unresolvedReceiverIndices = new Set<number>();
      const resolvedSelfIndices = new Set<number>();
      const unresolvedSelfIndices = new Set<number>();
      let alreadyClaimedAllReceiver = false;
      let alreadyClaimedAllSelf = false;
      let firstFailureReason: string | null = null;
      if (receiverClaimableUtxos.length > 0) {
        const claimReceiver =
          legacyClaimRuntime != null
            ? getLegacyReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
                { client: legacyClaimRuntime.client },
                {
                  fetchBatchMerkleProof: createOffpayUmbraBatchMerkleProofFetcher(params.network),
                  relayer: createOffpayUmbraClaimRelayer(params.network),
                  zkProver: getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
                  awaitCompletion: true,
                } as never,
              )
            : getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
                getUmbraClaimFactoryArgs(runtime) as never,
                {
                  fetchBatchMerkleProof: createOffpayUmbraBatchMerkleProofFetcher(params.network),
                  relayer: createOffpayUmbraClaimRelayer(params.network),
                  zkProver: getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
                  awaitCompletion: true,
                } as never,
              );
        try {
          const claimStartedAt = mark();
          let result: unknown;
          try {
            result = await claimReceiver(
              receiverClaimableUtxos as never,
              new Uint8Array(32) as never,
            );
            measure('umbra.claims.claimReceiver', claimStartedAt, {
              network: params.network,
              utxoCount: receiverClaimableUtxos.length,
              ok: true,
            });
          } catch (claimCallError) {
            measure('umbra.claims.claimReceiver', claimStartedAt, {
              network: params.network,
              utxoCount: receiverClaimableUtxos.length,
              ok: false,
              error:
                claimCallError instanceof Error ? claimCallError.message : String(claimCallError),
            });
            throw claimCallError;
          }
          const classified = assertUmbraClaimCompleted(result);
          for (const index of classified.resolvedInsertionIndices) {
            resolvedReceiverIndices.add(index);
          }
          for (const index of classified.unresolvedInsertionIndices) {
            unresolvedReceiverIndices.add(index);
          }
          // Defensive fallback: if the SDK reports `completed` but
          // didn't surface specific `utxoIds`, every UTXO we just
          // submitted has had its nullifier set on-chain (the relayer
          // would not return `completed` otherwise). Treat all
          // attempted UTXOs as resolved so the local exclusion set
          // captures them and the next scan stops re-surfacing them.
          if (
            classified.outcome === 'completed' &&
            resolvedReceiverIndices.size === 0 &&
            unresolvedReceiverIndices.size === 0
          ) {
            for (const utxo of receiverClaimableUtxos) {
              const index = getUtxoInsertionIndexAsNumber(utxo);
              if (index != null) resolvedReceiverIndices.add(index);
            }
          }
          if (
            classified.outcome === 'already_claimed' &&
            classified.unresolvedInsertionIndices.length === 0
          ) {
            alreadyClaimedAllReceiver = true;
            // Same fallback for the already-claimed path: every UTXO
            // we submitted is already on-chain (or its nullifier is
            // already set), so each one belongs in the exclusion set.
            if (resolvedReceiverIndices.size === 0) {
              for (const utxo of receiverClaimableUtxos) {
                const index = getUtxoInsertionIndexAsNumber(utxo);
                if (index != null) resolvedReceiverIndices.add(index);
              }
            }
          }
          if (classified.failureReason != null && firstFailureReason == null) {
            firstFailureReason = classified.failureReason;
          }
          // Persist resolved indices NOW, before any further await,
          // so the local exclusion set is populated even if the React
          // component unmounts before the function returns. The
          // existing post-success persistence in the receive flow
          // remains as a belt-and-braces safety net.
          if (params.onUtxoClaimedOnChain != null && resolvedReceiverIndices.size > 0) {
            params.onUtxoClaimedOnChain(Array.from(resolvedReceiverIndices));
          }
          claimResults.push(result);
        } catch (error: unknown) {
          if (isBenignAlreadyClaimedFailure(error)) {
            alreadyClaimedAllReceiver = true;
            for (const utxo of receiverClaimableUtxos) {
              const index = getUtxoInsertionIndexAsNumber(utxo);
              if (index != null) resolvedReceiverIndices.add(index);
            }
            if (params.onUtxoClaimedOnChain != null && resolvedReceiverIndices.size > 0) {
              params.onUtxoClaimedOnChain(Array.from(resolvedReceiverIndices));
            }
          } else {
            // Track every receiver UTXO as unresolved so the caller knows
            // the on-chain state is unchanged. Then surface the error so
            // the receive flow can run its retry path.
            for (const utxo of receiverClaimableUtxos) {
              const index = getUtxoInsertionIndexAsNumber(utxo);
              if (index != null) unresolvedReceiverIndices.add(index);
            }
            throw error;
          }
        }
      }

      if (selfClaimableUtxos.length > 0) {
        const claimSelf =
          legacyClaimRuntime != null
            ? getLegacySelfClaimableUtxoToEncryptedBalanceClaimerFunction(
                { client: legacyClaimRuntime.client },
                {
                  fetchBatchMerkleProof: createOffpayUmbraBatchMerkleProofFetcher(params.network),
                  relayer: createOffpayUmbraClaimRelayer(params.network),
                  zkProver: getRnClaimSelfClaimableUtxoIntoEncryptedBalanceProver(),
                  awaitCompletion: true,
                } as never,
              )
            : getSelfClaimableUtxoToEncryptedBalanceClaimerFunction(
                getUmbraClaimFactoryArgs(runtime) as never,
                {
                  fetchBatchMerkleProof: createOffpayUmbraBatchMerkleProofFetcher(params.network),
                  relayer: createOffpayUmbraClaimRelayer(params.network),
                  zkProver: getRnClaimSelfClaimableUtxoIntoEncryptedBalanceProver(),
                  awaitCompletion: true,
                } as never,
              );
        try {
          const claimStartedAt = mark();
          let result: unknown;
          try {
            result = await claimSelf(selfClaimableUtxos as never, new Uint8Array(32) as never);
            measure('umbra.claims.claimSelf', claimStartedAt, {
              network: params.network,
              utxoCount: selfClaimableUtxos.length,
              ok: true,
            });
          } catch (claimCallError) {
            measure('umbra.claims.claimSelf', claimStartedAt, {
              network: params.network,
              utxoCount: selfClaimableUtxos.length,
              ok: false,
              error:
                claimCallError instanceof Error ? claimCallError.message : String(claimCallError),
            });
            throw claimCallError;
          }
          const classified = assertUmbraClaimCompleted(result);
          for (const index of classified.resolvedInsertionIndices) {
            resolvedSelfIndices.add(index);
          }
          for (const index of classified.unresolvedInsertionIndices) {
            unresolvedSelfIndices.add(index);
          }
          // Defensive fallback for the self-claim path: same rationale
          // as the receiver path above. When the relayer reports
          // `completed` we trust the on-chain nullifier landed for
          // every UTXO we submitted, even if the SDK didn't surface
          // per-UTXO ids. Guarded by `failureReason == null` so a failed
          // batch (e.g. UnableToVerifyGroth16Proof) can never be silently
          // marked as resolved here.
          if (
            classified.outcome === 'completed' &&
            classified.failureReason == null &&
            resolvedSelfIndices.size === 0 &&
            unresolvedSelfIndices.size === 0
          ) {
            for (const utxo of selfClaimableUtxos) {
              const index = getUtxoInsertionIndexAsNumber(utxo);
              if (index != null) resolvedSelfIndices.add(index);
            }
          }
          if (
            classified.outcome === 'already_claimed' &&
            classified.unresolvedInsertionIndices.length === 0
          ) {
            alreadyClaimedAllSelf = true;
            if (resolvedSelfIndices.size === 0) {
              for (const utxo of selfClaimableUtxos) {
                const index = getUtxoInsertionIndexAsNumber(utxo);
                if (index != null) resolvedSelfIndices.add(index);
              }
            }
          }
          if (classified.failureReason != null && firstFailureReason == null) {
            firstFailureReason = classified.failureReason;
          }
          if (params.onUtxoClaimedOnChain != null && resolvedSelfIndices.size > 0) {
            params.onUtxoClaimedOnChain(Array.from(resolvedSelfIndices));
          }
          claimResults.push(result);
        } catch (error: unknown) {
          if (isBenignAlreadyClaimedFailure(error)) {
            alreadyClaimedAllSelf = true;
            for (const utxo of selfClaimableUtxos) {
              const index = getUtxoInsertionIndexAsNumber(utxo);
              if (index != null) resolvedSelfIndices.add(index);
            }
            if (params.onUtxoClaimedOnChain != null && resolvedSelfIndices.size > 0) {
              params.onUtxoClaimedOnChain(Array.from(resolvedSelfIndices));
            }
          } else {
            for (const utxo of selfClaimableUtxos) {
              const index = getUtxoInsertionIndexAsNumber(utxo);
              if (index != null) unresolvedSelfIndices.add(index);
            }
            throw error;
          }
        }
      }

      const signatures = claimResults.flatMap(collectSignaturesFromResult);
      const primarySignature = claimResults.map(getUmbraPreferredSignature).find(Boolean);
      // Persist only insertion indices whose nullifier is now set on-chain.
      // UTXOs that the relayer reported as `failed` (no nullifier inserted,
      // tx never landed) stay in the pending set so the user can retry.
      const claimedUtxoInsertionIndices = Array.from(
        new Set([...resolvedReceiverIndices, ...resolvedSelfIndices]),
      );
      const unresolvedInsertionIndices = Array.from(
        new Set([...unresolvedReceiverIndices, ...unresolvedSelfIndices]),
      );

      const allBatchesAlreadyClaimed =
        (receiverClaimableUtxos.length === 0 || alreadyClaimedAllReceiver) &&
        (selfClaimableUtxos.length === 0 || alreadyClaimedAllSelf) &&
        pendingClaimCount > 0;

      // Partial-success: at least one batch landed but at least one
      // failed. We surface the failure reason on the result so the caller
      // can decide whether to retry, but we still persist the resolved
      // indices so they don't show up as pending again.
      const sawPartialFailure =
        claimedUtxoInsertionIndices.length > 0 && unresolvedInsertionIndices.length > 0;
      // Total failure: nothing landed on-chain. We detect this from the
      // unresolved index set OR from a captured relayer failure reason — the
      // latter is the authoritative signal, because a relayer that omits the
      // per-batch UTXO ids on a failed batch would otherwise leave the
      // unresolved set empty and make a hard on-chain failure
      // (e.g. UnableToVerifyGroth16Proof) look like a success.
      const sawTotalFailure =
        claimedUtxoInsertionIndices.length === 0 &&
        (unresolvedInsertionIndices.length > 0 || firstFailureReason != null);

      if (sawTotalFailure) {
        // No batches resolved on-chain. Throw with the relayer's failure
        // reason so the receive flow's retry/friendly-error path runs.
        throw new Error(firstFailureReason ?? 'Umbra claim did not land on-chain. Please retry.');
      }

      const claimedUtxoCount = claimedUtxoInsertionIndices.length;

      return {
        action: 'claim',
        walletAddress,
        network: params.network,
        title: allBatchesAlreadyClaimed
          ? 'Already claimed'
          : sawPartialFailure
            ? 'Claim partly succeeded'
            : 'Private payment claimed',
        subtitle: allBatchesAlreadyClaimed
          ? `${pendingClaimCount} Umbra UTXO${
              pendingClaimCount === 1 ? '' : 's'
            } already moved into encrypted balance.`
          : sawPartialFailure
            ? `${claimedUtxoCount} of ${pendingClaimCount} Umbra UTXOs moved into encrypted balance. ${unresolvedInsertionIndices.length} pending — tap claim again.`
            : `${pendingClaimCount} Umbra UTXO${
                pendingClaimCount === 1 ? '' : 's'
              } moved into encrypted balance.`,
        signatures,
        ...(primarySignature == null ? {} : { primarySignature }),
        pendingClaimCount: unresolvedInsertionIndices.length,
        claimedUtxoCount,
        claimedUtxoInsertionIndices,
        pendingClaimUtxoInsertionIndices: unresolvedInsertionIndices,
        nextScanStartIndex,
        vaultState: registrationStatus.vaultState,
        vaultRegistered: registrationStatus.vaultRegistered,
        vaultCanShield: registrationStatus.vaultCanShield,
        mixerRegistered: registrationStatus.mixerRegistered,
      };
    } finally {
      legacyClaimRuntime?.dispose();
    }
  });
}

export async function withdrawTokenFromUmbra(
  params: UmbraUnshieldParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  const recipient = params.recipient?.trim()
    ? assertRecipientAddress(params.recipient)
    : walletAddress;
  const token = await resolveUmbraToken(params);
  // RPC readiness and vault fee account checks are independent — both
  // need only (mint, network) which are already known, so we can fan
  // them out concurrently. On a cold cache this saves up to ~1s.
  const [, readiness] = await Promise.all([
    verifyOffpayUmbraRpcReadiness(params.network),
    assertOffpayUmbraVaultFeeAccountsReady({
      action: 'withdraw',
      mint: token.metadata.mint,
      network: params.network,
    }),
  ]);
  const runLegacyWithdraw = (): Promise<UmbraExecutionResult> =>
    withLegacyUmbraRuntime(params, async (runtime) => {
      const withdraw = getLegacyEncryptedBalanceToPublicBalanceDirectWithdrawerFunction(
        { client: runtime.client },
        {
          rpc: buildLegacyRpcDeps(runtime),
          arcium: { awaitComputationFinalization: UMBRA_AWAIT_COMPUTATION_FINALIZATION },
        } as never,
      );
      const result = await withdraw(
        recipient as never,
        token.metadata.mint as never,
        BigInt(token.amountAtomic) as never,
      );
      const signatures = collectSignaturesFromResult(result);
      await assertUmbraTransactionSignaturesLanded({
        network: params.network,
        signatures,
        action: 'withdraw',
        requireSignature: true,
      });
      assertUmbraComputationFinalized({ result, action: 'withdraw' });

      return {
        action: 'unshield',
        walletAddress,
        network: params.network,
        title: 'Withdraw complete',
        subtitle: `${token.amountDisplay} ${token.metadata.symbol} → ${
          recipient === walletAddress ? 'wallet' : 'recipient'
        }`,
        signatures,
        mint: token.metadata.mint,
        tokenSymbol: token.metadata.symbol,
        amountAtomic: token.amountAtomic,
        amountDisplay: token.amountDisplay,
        recipient,
      };
    });

  const runCurrentWithdraw = (): Promise<UmbraExecutionResult> =>
    withUmbraRuntime(params, async (runtime) => {
      const withdraw = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction(
        { client: runtime.client },
        {
          rpc: buildRpcDeps(runtime),
          arcium: { awaitComputationFinalization: UMBRA_AWAIT_COMPUTATION_FINALIZATION },
        } as never,
      );
      const result = await withdraw(
        recipient as never,
        token.metadata.mint as never,
        BigInt(token.amountAtomic) as never,
      );
      const signatures = collectSignaturesFromResult(result);
      await assertUmbraTransactionSignaturesLanded({
        network: params.network,
        signatures,
        action: 'withdraw',
        requireSignature: true,
      });
      assertUmbraComputationFinalized({ result, action: 'withdraw' });

      return {
        action: 'unshield',
        walletAddress,
        network: params.network,
        title: 'Withdraw complete',
        subtitle: `${token.amountDisplay} ${token.metadata.symbol} → ${
          recipient === walletAddress ? 'wallet' : 'recipient'
        }`,
        signatures,
        mint: token.metadata.mint,
        tokenSymbol: token.metadata.symbol,
        amountAtomic: token.amountAtomic,
        amountDisplay: token.amountDisplay,
        recipient,
      };
    });

  if (shouldPreferLegacyUmbraProtocol(params.network)) {
    assertPreferredLegacyUmbraProtocolAvailable(readiness);
    return runLegacyWithdraw();
  }

  if (readiness.protocolVersion === 'legacy' && isProtocolAvailable(readiness, 'legacy')) {
    return runLegacyWithdraw();
  }

  try {
    return await runCurrentWithdraw();
  } catch (error) {
    if (isUmbraInstructionFallbackNotFound(error) && isProtocolAvailable(readiness, 'legacy')) {
      markOffpayUmbraProtocolVersionUnsupported(params.network, 'current');
      if (__DEV__) {
        console.warn(
          '[umbra-execution] current Umbra protocol instruction unsupported; retrying legacy withdraw',
          {
            network: params.network,
            mint: token.metadata.mint,
          },
        );
      }
      return runLegacyWithdraw();
    }
    throw error;
  }
}

export async function fetchUmbraVaultRegistrationStatus(
  params: UmbraWalletExecutionParams,
): Promise<UmbraVaultRegistrationStatus> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  await verifyOffpayUmbraRpcReadiness(params.network);
  return withUmbraRuntime(params, async (runtime) =>
    queryUmbraVaultRegistrationStatus(runtime, walletAddress),
  );
}

/**
 * Reads the Umbra registration status of ONE OR MORE arbitrary addresses
 * (e.g. payroll recipients) using the SIGNER wallet's runtime. The signer is
 * always the active wallet — only the queried address varies — so this does
 * NOT require the looked-up addresses to be owned/unlockable on this device.
 *
 * This is the read-only counterpart to `fetchUmbraVaultRegistrationStatus`,
 * which derives signing material for the queried address itself and therefore
 * only works for the active wallet. The signer runtime is built once and
 * reused across all lookups, so probing N recipients is N cheap account reads,
 * not N runtime constructions.
 *
 * Results are keyed by the looked-up address. A per-address failure resolves
 * to `null` (caller treats as not registered) rather than failing the batch.
 */
export async function fetchUmbraRegistrationStatusForAddresses(params: {
  signerWalletAddress: string;
  walletId: string | null;
  lookupAddresses: readonly string[];
  network: OffpayNetwork;
}): Promise<Record<string, UmbraVaultRegistrationStatus | null>> {
  assertUmbraNetworkSupported(params.network);
  const signerWalletAddress = assertWalletAddress(params.signerWalletAddress);

  const unique = Array.from(new Set(params.lookupAddresses));
  if (unique.length === 0) return {};

  await verifyOffpayUmbraRpcReadiness(params.network);

  return withUmbraRuntime(
    { walletAddress: signerWalletAddress, walletId: params.walletId, network: params.network },
    async (runtime) => {
      const byAddress: Record<string, UmbraVaultRegistrationStatus | null> = {};
      for (const lookupAddress of unique) {
        try {
          byAddress[lookupAddress] = await queryUmbraVaultRegistrationStatus(
            runtime,
            lookupAddress,
          );
        } catch {
          byAddress[lookupAddress] = null;
        }
      }
      return byAddress;
    },
  );
}

export async function fetchUmbraEncryptedBalances(
  params: UmbraWalletExecutionParams & { tokens: string[] },
): Promise<UmbraExecutionResult> {
  const totalStartedAt = mark();
  let ok = false;
  let tokenCount = 0;
  let unreadableCount = 0;
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  try {
    const readinessStartedAt = mark();
    try {
      await verifyOffpayUmbraRpcReadiness(params.network);
    } finally {
      measure('umbra.encryptedBalances.readiness', readinessStartedAt, {
        network: params.network,
      });
    }
    return await withUmbraRuntime(params, async (runtime) => {
      const mints = params.tokens.flatMap((token) => {
        try {
          return [resolveUmbraSupportedToken({ network: params.network, token })];
        } catch {
          return [];
        }
      });
      if (mints.length === 0) {
        throw new Error(
          `Umbra encrypted balances do not support this token set on ${params.network}.`,
        );
      }

      const registrationStartedAt = mark();
      const registrationStatus = await queryUmbraVaultRegistrationStatus(
        runtime,
        walletAddress,
      ).finally(() => {
        measure('umbra.encryptedBalances.registrationStatus', registrationStartedAt, {
          network: params.network,
        });
      });
      const uniqueMints = mints.filter(
        (token, index, tokens) =>
          tokens.findIndex((candidate) => candidate.mint === token.mint) === index,
      );
      tokenCount = uniqueMints.length;
      const queryStartedAt = mark();
      const result = await queryUmbraEncryptedBalanceEntries({
        runtime,
        mints: uniqueMints,
      }).finally(() => {
        measure('umbra.encryptedBalances.querySdk', queryStartedAt, {
          network: params.network,
          tokenCount: uniqueMints.length,
        });
      });
      const keyStatusStartedAt = mark();
      const balances = await Promise.all(
        uniqueMints.map(async (token) => {
          const entry = getUmbraSdkEncryptedBalanceEntry(result, token.mint);
          const balance = normalizeUmbraEncryptedBalanceEntry(entry, token.decimals);
          const keyStatus =
            balance.state === 'shared_unreadable'
              ? await queryUmbraVaultEncryptionKeyStatus(runtime, walletAddress, token.mint)
              : null;
          if (balance.state === 'shared_unreadable') {
            unreadableCount += 1;
          }
          const unreadableReason =
            keyStatus?.state === 'mismatched' ? 'key_mismatch' : balance.unreadableReason;

          return {
            mint: token.mint,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            logoUri: token.logoUri ?? null,
            state: keyStatus?.state === 'mismatched' ? 'shared_key_mismatch' : balance.state,
            rawBalance: balance.rawBalance,
            displayBalance: balance.displayBalance,
            ...(unreadableReason == null ? {} : { unreadableReason }),
            ...(keyStatus == null
              ? {}
              : {
                  encryptionKeyStatus: keyStatus.state,
                  encryptedUserAccount: keyStatus.encryptedUserAccount,
                  encryptedTokenAccount: keyStatus.encryptedTokenAccount,
                }),
          };
        }),
      );
      measure('umbra.encryptedBalances.keyStatus', keyStatusStartedAt, {
        network: params.network,
        tokenCount: uniqueMints.length,
        unreadableCount,
      });

      ok = true;
      return {
        action: 'balance',
        walletAddress,
        network: params.network,
        title: 'Encrypted balance refreshed',
        subtitle: `${balances.length} balance${balances.length === 1 ? '' : 's'} checked.`,
        signatures: [],
        vaultState: registrationStatus.vaultState,
        vaultRegistered: registrationStatus.vaultRegistered,
        vaultCanShield: registrationStatus.vaultCanShield,
        mixerRegistered: registrationStatus.mixerRegistered,
        balances,
      };
    });
  } finally {
    measure('umbra.encryptedBalances.fetch', totalStartedAt, {
      network: params.network,
      ok,
      tokenCount,
      unreadableCount,
    });
  }
}
