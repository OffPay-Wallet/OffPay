import { Buffer } from 'buffer';

import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
import { getUmbraClient } from '@umbra-privacy/sdk/client';
import { getDefaultArciumDeps, getPollingComputationMonitor } from '@umbra-privacy/sdk/arcium';
import {
  getPollingComputationMonitor as getLegacyPollingComputationMonitor,
  getPollingTransactionForwarder as getLegacyPollingTransactionForwarder,
  getRpcBlockhashProvider as getLegacyRpcBlockhashProvider,
  getRpcEpochInfoProvider as getLegacyRpcEpochInfoProvider,
  getUmbraClient as getLegacyUmbraClient,
  type GetUmbraClientDeps as LegacyGetUmbraClientDeps,
} from '@umbra-privacy/sdk-legacy';
import {
  getHardcodedCreateUtxoProtocolFeeProvider,
  getHardcodedDepositProtocolFeeProvider,
  getHardcodedWithdrawalProtocolFeeProvider,
} from '@umbra-privacy/sdk/fee-provider';
import {
  masterSeedSchemeV1,
  masterSeedSchemeV2,
  masterSeedSchemeV4,
} from '@umbra-privacy/sdk/master-seed-schemes';
import {
  DEPOSIT_FROM_PUBLIC_BALANCE_INTO_EXISTING_SHARED_BALANCE_V17_SEED,
  DEPOSIT_FROM_PUBLIC_BALANCE_INTO_EXISTING_NETWORK_BALANCE_V17_SEED,
  DEPOSIT_FROM_PUBLIC_BALANCE_INTO_NEW_NETWORK_BALANCE_V17_SEED,
  DEPOSIT_FROM_PUBLIC_BALANCE_INTO_NEW_SHARED_BALANCE_V17_SEED,
  DEPOSIT_INTO_STEALTH_POOL_FROM_PUBLIC_BALANCE_SEED,
  DEPOSIT_INTO_STEALTH_POOL_FROM_SHARED_BALANCE_V17_SEED,
  WITHDRAW_FROM_SHARED_BALANCE_INTO_PUBLIC_BALANCE_V17_SEED,
  findFeeSchedulePda,
  findProtocolFeeVaultPda,
} from '@umbra-privacy/sdk/pda';
import {
  getPollingTransactionForwarder,
  getRpcBlockhashProvider,
  getRpcEpochInfoProvider,
} from '@umbra-privacy/sdk/solana';
import {
  getFeeScheduleDiscriminatorBytes,
  getFeeScheduleSize,
  getFeeVaultDiscriminatorBytes,
  getFeeVaultSize,
} from '@umbra-privacy/umbra-codama';

import {
  broadcastRawTransaction,
  getRpcAccounts,
  getRpcEpochInfo,
  getRpcLatestBlockhash,
  getRpcSignatureStatuses,
  getRpcSignaturesForAddress,
  getRpcSlot,
  OFFPAY_API_ORIGIN,
} from '@/lib/api/offpay-api-client';
import { mark, measure } from '@/lib/perf/perf-marks';

import type { OffpayNetwork, RpcAccountRecord } from '@/types/offpay-api';
import type { Address } from '@solana/kit';
import type { FeeScheduleConfig, GetFeeConfig } from '@umbra-privacy/sdk/fee-provider';
import type {
  AccountInfoProviderFunction,
  CreateSolanaRpcFunction,
} from '@umbra-privacy/sdk/solana';
import type { ArciumDeps } from '@umbra-privacy/sdk/arcium';
import type { GetUmbraClientDeps, IUmbraClient, IUmbraSigner } from '@umbra-privacy/sdk/client';
import type {
  AccountInfoProviderFunction as LegacyAccountInfoProviderFunction,
  CreateSolanaRpcFunction as LegacyCreateSolanaRpcFunction,
  IUmbraClient as LegacyUmbraClient,
  IUmbraSigner as LegacyUmbraSigner,
} from '@umbra-privacy/sdk-legacy/interfaces';

type AccountInfoMap = Awaited<ReturnType<AccountInfoProviderFunction>>;
type AccountAddress = Parameters<AccountInfoProviderFunction>[0][number];
type MaybeEncodedAccount = AccountInfoMap extends Map<AccountAddress, infer Value> ? Value : never;

type RpcSendResult<T> = {
  send(options?: unknown): Promise<T>;
};

type RpcTransactionSendOptions = {
  skipPreflight?: boolean;
  maxRetries?: number;
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
};

type RpcAccountValue = {
  data: [string, 'base64'];
  executable: boolean;
  lamports: bigint;
  owner: string;
  space: bigint;
};

type RpcSignatureInput = { toString(): string } | string;

function toRpcString(value: RpcSignatureInput): string {
  return value.toString();
}

function toBase64Transaction(value: RpcSignatureInput): string {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }

  return value.toString();
}

function getUmbraRpcUrl(network: OffpayNetwork): string {
  return `${OFFPAY_API_ORIGIN}/api/rpc?network=${encodeURIComponent(network)}`;
}

const UMBRA_VAULT_UNAVAILABLE_MESSAGE =
  'Umbra vault is not enabled for this token/network yet. A required protocol fee account is missing or has an incompatible layout.';
const UMBRA_COMPACT_FEE_VAULT_SIZE = 368;

const UMBRA_PROGRAM_ID_BY_NETWORK: Partial<Record<OffpayNetwork, string>> = {
  mainnet: 'UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh',
  devnet: 'DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ',
};

const PROTOCOL_FEE_VAULT_OFFSET_ZERO = 0n as never;
const UMBRA_FORWARDER_SEND_MAX_RETRIES = 1;
const UMBRA_VAULT_READINESS_POSITIVE_CACHE_TTL_MS = 5 * 60_000;
const UMBRA_RPC_READINESS_POSITIVE_CACHE_TTL_MS = 10_000;
const depositProtocolFeeProvider = getHardcodedDepositProtocolFeeProvider();
const createUtxoProtocolFeeProvider = getHardcodedCreateUtxoProtocolFeeProvider();
const withdrawalProtocolFeeProvider = getHardcodedWithdrawalProtocolFeeProvider();
type UmbraCurrentInstructionSeed =
  typeof DEPOSIT_FROM_PUBLIC_BALANCE_INTO_NEW_SHARED_BALANCE_V17_SEED;
export type UmbraProtocolVersion = 'current' | 'legacy';
const unsupportedProtocolVersions = new Map<string, Set<UmbraProtocolVersion>>();
const positiveVaultReadinessCache = new Map<
  string,
  { expiresAt: number; readiness: UmbraVaultFeeAccountReadiness }
>();
const inFlightVaultReadinessCache = new Map<string, Promise<UmbraVaultFeeAccountReadiness>>();
const positiveRpcReadinessCache = new Map<
  OffpayNetwork,
  { expiresAt: number; readiness: { blockhash: string; slot: bigint } }
>();
const inFlightRpcReadinessCache = new Map<
  OffpayNetwork,
  Promise<{ blockhash: string; slot: bigint }>
>();

const LEGACY_FEE_SCHEDULE_SEED = Uint8Array.from([
  219, 103, 184, 147, 198, 147, 112, 38, 55, 38, 235, 215, 80, 203, 76, 46, 100, 134, 54, 137, 90,
  55, 236, 128, 221, 55, 222, 172, 164, 85, 109, 139,
]);
const LEGACY_FEE_VAULT_SEED = Uint8Array.from([
  179, 37, 45, 22, 96, 77, 187, 83, 214, 27, 136, 248, 186, 191, 16, 30, 30, 8, 127, 147, 114, 194,
  122, 73, 33, 5, 236, 62, 239, 130, 207, 221,
]);
const LEGACY_DOMAIN_PROTOCOL_FEES_SEED = Uint8Array.from([
  3, 90, 193, 96, 232, 76, 253, 129, 5, 160, 193, 17, 1, 189, 78, 77, 218, 76, 91, 45, 152, 246,
  251, 5, 111, 22, 232, 53, 164, 66, 26, 145,
]);
const LEGACY_U128_ZERO_OFFSET_SEED = new Uint8Array(16);

const UMBRA_DIRECT_SHIELD_INSTRUCTIONS = [
  {
    label: 'deposit_from_public_balance_into_new_network_balance_v17',
    seed: DEPOSIT_FROM_PUBLIC_BALANCE_INTO_NEW_NETWORK_BALANCE_V17_SEED,
    feeProvider: depositProtocolFeeProvider,
  },
  {
    label: 'deposit_from_public_balance_into_existing_network_balance_v17',
    seed: DEPOSIT_FROM_PUBLIC_BALANCE_INTO_EXISTING_NETWORK_BALANCE_V17_SEED,
    feeProvider: depositProtocolFeeProvider,
  },
  {
    label: 'deposit_from_public_balance_into_new_shared_balance_v17',
    seed: DEPOSIT_FROM_PUBLIC_BALANCE_INTO_NEW_SHARED_BALANCE_V17_SEED,
    feeProvider: depositProtocolFeeProvider,
  },
  {
    label: 'deposit_from_public_balance_into_existing_shared_balance_v17',
    seed: DEPOSIT_FROM_PUBLIC_BALANCE_INTO_EXISTING_SHARED_BALANCE_V17_SEED,
    feeProvider: depositProtocolFeeProvider,
  },
] as const;

const UMBRA_DIRECT_WITHDRAW_INSTRUCTIONS = [
  {
    label: 'withdraw_from_shared_balance_into_public_balance_v17',
    seed: WITHDRAW_FROM_SHARED_BALANCE_INTO_PUBLIC_BALANCE_V17_SEED,
    feeProvider: withdrawalProtocolFeeProvider,
  },
] as const;

const UMBRA_PRIVATE_P2P_PUBLIC_INSTRUCTIONS = [
  {
    label: 'deposit_into_stealth_pool_from_public_balance',
    seed: DEPOSIT_INTO_STEALTH_POOL_FROM_PUBLIC_BALANCE_SEED,
    feeProvider: createUtxoProtocolFeeProvider,
  },
] as const;

const UMBRA_PRIVATE_P2P_ENCRYPTED_INSTRUCTIONS = [
  {
    label: 'deposit_into_stealth_pool_from_shared_balance_v17',
    seed: DEPOSIT_INTO_STEALTH_POOL_FROM_SHARED_BALANCE_V17_SEED,
    feeProvider: createUtxoProtocolFeeProvider,
  },
] as const;

const UMBRA_LEGACY_DIRECT_SHIELD_INSTRUCTIONS = [
  {
    label: 'deposit_from_public_balance_into_new_shared_balance_v11',
    seed: Uint8Array.from([61, 68, 159, 187, 211, 5, 40, 78, 241, 50, 83, 190, 77, 251, 130, 72]),
  },
  {
    label: 'deposit_from_public_balance_into_existing_shared_balance_v11',
    seed: Uint8Array.from([
      111, 176, 14, 239, 187, 29, 185, 245, 215, 65, 8, 167, 146, 195, 241, 119,
    ]),
  },
] as const;

const UMBRA_LEGACY_DIRECT_WITHDRAW_INSTRUCTIONS = [
  {
    label: 'withdraw_from_shared_balance_into_public_balance_v11',
    seed: Uint8Array.from([60, 36, 38, 3, 110, 175, 227, 240, 86, 187, 218, 26, 46, 79, 3, 49]),
  },
] as const;

const UMBRA_LEGACY_PRIVATE_P2P_ENCRYPTED_INSTRUCTIONS = [
  {
    label: 'deposit_into_stealth_pool_from_shared_balance_v11',
    seed: Uint8Array.from([
      182, 239, 117, 203, 144, 24, 13, 246, 112, 235, 158, 193, 79, 252, 113, 64,
    ]),
  },
] as const;

export type UmbraDirectVaultAction =
  | 'shield'
  | 'withdraw'
  | 'privateP2pFromPublic'
  | 'privateP2pFromEncrypted';

interface UmbraCurrentProtocolFeeInstruction {
  label: string;
  seed: UmbraCurrentInstructionSeed;
  feeProvider: GetFeeConfig;
  protocolVersion: 'current';
}

interface UmbraLegacyProtocolFeeInstruction {
  label: string;
  seed: Uint8Array;
  protocolVersion: 'legacy';
}

type UmbraProtocolFeeInstruction =
  | UmbraCurrentProtocolFeeInstruction
  | UmbraLegacyProtocolFeeInstruction;

interface UmbraProtocolVersionReadiness {
  available: boolean;
  checkedAccounts: UmbraVaultFeeAccountCheck[];
  missingAccounts: UmbraVaultFeeAccountCheck[];
  protocolVersion: UmbraProtocolVersion;
}

interface UmbraProtocolFeeGroup {
  protocolVersion: UmbraProtocolVersion;
  instructions: readonly UmbraProtocolFeeInstruction[];
}

interface UmbraCurrentProtocolFeeGroup {
  protocolVersion: 'current';
  instructions: readonly UmbraCurrentProtocolFeeInstruction[];
}

interface UmbraLegacyProtocolFeeGroup {
  protocolVersion: 'legacy';
  instructions: readonly UmbraLegacyProtocolFeeInstruction[];
}

export interface UmbraVaultFeeAccountCheck {
  action: UmbraDirectVaultAction;
  address: string;
  exists: boolean;
  instruction: string;
  kind: 'feeSchedule' | 'feeVault';
  protocolVersion: UmbraProtocolVersion;
  validationError: string | null;
}

export interface UmbraVaultFeeAccountReadiness {
  action: UmbraDirectVaultAction;
  available: boolean;
  checkedAccounts: UmbraVaultFeeAccountCheck[];
  message: string | null;
  missingAccounts: UmbraVaultFeeAccountCheck[];
  mint: string;
  network: OffpayNetwork;
  protocolVersion: UmbraProtocolVersion | null;
  protocolVersions: UmbraProtocolVersionReadiness[];
}

function assertUmbraNetworkSupportedForProviders(network: OffpayNetwork): void {
  if (UMBRA_PROGRAM_ID_BY_NETWORK[network] == null) {
    throw new Error(`Umbra client providers are not available on ${network}.`);
  }
}

function toBigint(value: string | number | bigint | null | undefined, fallback = 0n): bigint {
  if (value == null) return fallback;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.trunc(value));
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return BigInt(trimmed);
}

function decodeBase64(value: string, label: string): Uint8Array {
  const decoded = Uint8Array.from(Buffer.from(value, 'base64'));
  if (decoded.length === 0 && value.length > 0) {
    throw new Error(`${label} could not be decoded.`);
  }

  return decoded;
}

function toMaybeEncodedAccount(
  requestedAddress: AccountAddress,
  record: RpcAccountRecord | null | undefined,
): MaybeEncodedAccount {
  if (record == null || record.data == null || record.owner == null) {
    return {
      address: requestedAddress,
      exists: false,
    } as MaybeEncodedAccount;
  }

  const data = decodeBase64(record.data, 'account data');
  const space = toBigint((record as { space?: string | number | null }).space, BigInt(data.length));

  return {
    address: requestedAddress,
    data,
    executable: record.executable === true,
    exists: true,
    lamports: toBigint(record.lamports),
    programAddress: record.owner,
    space,
  } as MaybeEncodedAccount;
}

function toRpcAccountValue(record: RpcAccountRecord | null | undefined): RpcAccountValue | null {
  if (record == null || record.data == null || record.owner == null) return null;
  const data = decodeBase64(record.data, 'account data');

  return {
    data: [record.data, 'base64'],
    executable: record.executable === true,
    lamports: toBigint(record.lamports),
    owner: record.owner,
    space: toBigint((record as { space?: string | number | null }).space, BigInt(data.length)),
  };
}

function getRpcAccountAddress(record: RpcAccountRecord | null | undefined): string | null {
  if (record == null) return null;
  return record.address ?? record.pubkey ?? null;
}

function getRpcAccountBase64Data(record: RpcAccountRecord | null | undefined): string | null {
  return record?.data ?? record?.dataBase64 ?? null;
}

function byteArraysEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

function getExpectedFeeAccountLayout(kind: UmbraVaultFeeAccountCheck['kind']): {
  discriminator: ArrayLike<number>;
  minimumSize: number;
  label: string;
} {
  if (kind === 'feeSchedule') {
    return {
      discriminator: getFeeScheduleDiscriminatorBytes(),
      minimumSize: getFeeScheduleSize(),
      label: 'FeeSchedule',
    };
  }

  return {
    discriminator: getFeeVaultDiscriminatorBytes(),
    minimumSize: Math.min(getFeeVaultSize(), UMBRA_COMPACT_FEE_VAULT_SIZE),
    label: 'FeeVault',
  };
}

function validateUmbraFeeAccount(params: {
  account: Omit<UmbraVaultFeeAccountCheck, 'exists' | 'validationError'>;
  expectedOwner: string;
  record: RpcAccountRecord | null | undefined;
}): Pick<UmbraVaultFeeAccountCheck, 'exists' | 'validationError'> {
  const { account, expectedOwner, record } = params;
  if (record == null) {
    return {
      exists: false,
      validationError: 'account is missing',
    };
  }
  if (record.owner !== expectedOwner) {
    return {
      exists: false,
      validationError: `account owner is ${record.owner ?? 'unknown'}, expected ${expectedOwner}`,
    };
  }

  const encodedData = getRpcAccountBase64Data(record);
  if (encodedData == null) {
    return {
      exists: false,
      validationError: 'account data is missing',
    };
  }

  let data: Uint8Array;
  try {
    data = decodeBase64(encodedData, `${account.kind} account data`);
  } catch (error) {
    return {
      exists: false,
      validationError: error instanceof Error ? error.message : String(error),
    };
  }

  const expectedLayout = getExpectedFeeAccountLayout(account.kind);
  if (data.length < expectedLayout.minimumSize) {
    return {
      exists: false,
      validationError: `${expectedLayout.label} layout is ${String(
        data.length,
      )} bytes, expected at least ${String(expectedLayout.minimumSize)}`,
    };
  }

  const discriminator = data.slice(0, expectedLayout.discriminator.length);
  if (!byteArraysEqual(discriminator, expectedLayout.discriminator)) {
    return {
      exists: false,
      validationError: `${expectedLayout.label} discriminator does not match the installed Umbra program interface`,
    };
  }

  return {
    exists: true,
    validationError: null,
  };
}

function getCurrentProtocolFeeInstructions(
  action: UmbraDirectVaultAction,
): readonly UmbraCurrentProtocolFeeInstruction[] {
  const instructions =
    action === 'shield'
      ? UMBRA_DIRECT_SHIELD_INSTRUCTIONS
      : action === 'withdraw'
        ? UMBRA_DIRECT_WITHDRAW_INSTRUCTIONS
        : action === 'privateP2pFromPublic'
          ? UMBRA_PRIVATE_P2P_PUBLIC_INSTRUCTIONS
          : UMBRA_PRIVATE_P2P_ENCRYPTED_INSTRUCTIONS;

  return instructions.map((instruction) => ({
    ...instruction,
    protocolVersion: 'current' as const,
  }));
}

function getLegacyProtocolFeeInstructions(
  action: UmbraDirectVaultAction,
): readonly UmbraLegacyProtocolFeeInstruction[] {
  if (action === 'shield') {
    return UMBRA_LEGACY_DIRECT_SHIELD_INSTRUCTIONS.map((instruction) => ({
      ...instruction,
      protocolVersion: 'legacy' as const,
    }));
  }
  if (action === 'withdraw') {
    return UMBRA_LEGACY_DIRECT_WITHDRAW_INSTRUCTIONS.map((instruction) => ({
      ...instruction,
      protocolVersion: 'legacy' as const,
    }));
  }
  if (action === 'privateP2pFromEncrypted') {
    return UMBRA_LEGACY_PRIVATE_P2P_ENCRYPTED_INSTRUCTIONS.map((instruction) => ({
      ...instruction,
      protocolVersion: 'legacy' as const,
    }));
  }

  return [];
}

function getProtocolFeeGroups(action: UmbraDirectVaultAction): UmbraProtocolFeeGroup[] {
  const groups: UmbraProtocolFeeGroup[] = [
    {
      protocolVersion: 'current',
      instructions: getCurrentProtocolFeeInstructions(action),
    } satisfies UmbraCurrentProtocolFeeGroup,
  ];
  const legacyInstructions = getLegacyProtocolFeeInstructions(action);
  if (legacyInstructions.length > 0) {
    groups.push({
      protocolVersion: 'legacy',
      instructions: legacyInstructions,
    } satisfies UmbraLegacyProtocolFeeGroup);
  }

  return groups;
}

function protocolVersionCacheKey(network: OffpayNetwork): string {
  return `${network}:${UMBRA_PROGRAM_ID_BY_NETWORK[network] ?? 'unsupported'}`;
}

function vaultReadinessCacheKey(params: {
  action: UmbraDirectVaultAction;
  mint: string;
  network: OffpayNetwork;
}): string {
  return `${protocolVersionCacheKey(params.network)}:${params.action}:${params.mint}`;
}

function clearVaultReadinessCacheForNetwork(network: OffpayNetwork): void {
  const prefix = `${protocolVersionCacheKey(network)}:`;
  for (const key of positiveVaultReadinessCache.keys()) {
    if (key.startsWith(prefix)) positiveVaultReadinessCache.delete(key);
  }
  for (const key of inFlightVaultReadinessCache.keys()) {
    if (key.startsWith(prefix)) inFlightVaultReadinessCache.delete(key);
  }
}

function isProtocolVersionSupportedBySession(
  network: OffpayNetwork,
  protocolVersion: UmbraProtocolVersion,
): boolean {
  return (
    unsupportedProtocolVersions.get(protocolVersionCacheKey(network))?.has(protocolVersion) !== true
  );
}

function isProtocolVersionAcceptedByProgram(
  network: OffpayNetwork,
  protocolVersion: UmbraProtocolVersion,
): boolean {
  if (protocolVersion === 'legacy' && (network === 'mainnet' || network === 'devnet')) {
    return false;
  }

  return true;
}

function canSelectProtocolVersion(
  network: OffpayNetwork,
  protocolVersion: UmbraProtocolVersion,
): boolean {
  return (
    isProtocolVersionSupportedBySession(network, protocolVersion) &&
    isProtocolVersionAcceptedByProgram(network, protocolVersion)
  );
}

function withSingleUmbraSendAttempt<
  TForwarder extends {
    fireAndForget: (...args: never[]) => unknown;
    forwardInParallel: (...args: never[]) => unknown;
    forwardSequentially: (...args: never[]) => unknown;
  },
>(forwarder: TForwarder): TForwarder {
  type PollingForwardOptions = Record<string, unknown> & { maxRetries?: number };
  const pollingForwarder = forwarder as TForwarder & {
    forwardInParallel: (transactions: unknown, options?: PollingForwardOptions) => unknown;
    forwardSequentially: (transactions: unknown, options?: PollingForwardOptions) => unknown;
  };

  return {
    ...forwarder,
    forwardInParallel: ((transactions: unknown, options?: PollingForwardOptions) =>
      pollingForwarder.forwardInParallel(transactions, {
        ...options,
        maxRetries: UMBRA_FORWARDER_SEND_MAX_RETRIES,
      })) as TForwarder['forwardInParallel'],
    forwardSequentially: ((transactions: unknown, options?: PollingForwardOptions) =>
      pollingForwarder.forwardSequentially(transactions, {
        ...options,
        maxRetries: UMBRA_FORWARDER_SEND_MAX_RETRIES,
      })) as TForwarder['forwardSequentially'],
  };
}

export function markOffpayUmbraProtocolVersionUnsupported(
  network: OffpayNetwork,
  protocolVersion: UmbraProtocolVersion,
): void {
  const key = protocolVersionCacheKey(network);
  const unsupported = unsupportedProtocolVersions.get(key) ?? new Set<UmbraProtocolVersion>();
  unsupported.add(protocolVersion);
  unsupportedProtocolVersions.set(key, unsupported);
  clearVaultReadinessCacheForNetwork(network);
}

export function __clearOffpayUmbraProtocolVersionCacheForTesting(): void {
  unsupportedProtocolVersions.clear();
  positiveVaultReadinessCache.clear();
  inFlightVaultReadinessCache.clear();
}

async function deriveCurrentProtocolFeeAccountAddresses(params: {
  feeConfig: FeeScheduleConfig;
  instruction: UmbraCurrentProtocolFeeInstruction;
  mintAddress: Address;
  programAddress: Address;
}): Promise<{
  feeSchedule: string;
  feeVault: string;
}> {
  const [feeSchedule] = await findFeeSchedulePda({
    instructionSeed: params.instruction.seed,
    mintAddress: params.mintAddress,
    allowedAddress: params.feeConfig.allowedAddress,
    umbraProgram: params.programAddress,
  });
  const [feeVault] = await findProtocolFeeVaultPda({
    instructionSeed: params.instruction.seed,
    mintAddress: params.mintAddress,
    offset: PROTOCOL_FEE_VAULT_OFFSET_ZERO,
    umbraProgram: params.programAddress,
  });

  return {
    feeSchedule: String(feeSchedule),
    feeVault: String(feeVault),
  };
}

async function deriveLegacyProtocolFeeAccountAddresses(params: {
  instruction: UmbraLegacyProtocolFeeInstruction;
  mintAddress: Address;
  programAddress: Address;
}): Promise<{
  feeSchedule: string;
  feeVault: string;
}> {
  const mintBytes = getAddressEncoder().encode(params.mintAddress);
  const [feeSchedule] = await getProgramDerivedAddress({
    programAddress: params.programAddress,
    seeds: [LEGACY_FEE_SCHEDULE_SEED, params.instruction.seed, mintBytes],
  });
  const [feeVault] = await getProgramDerivedAddress({
    programAddress: params.programAddress,
    seeds: [
      LEGACY_FEE_VAULT_SEED,
      LEGACY_DOMAIN_PROTOCOL_FEES_SEED,
      params.instruction.seed,
      mintBytes,
      LEGACY_U128_ZERO_OFFSET_SEED,
    ],
  });

  return {
    feeSchedule: String(feeSchedule),
    feeVault: String(feeVault),
  };
}

async function deriveProtocolFeeGroupAccountChecks(params: {
  action: UmbraDirectVaultAction;
  group: UmbraProtocolFeeGroup;
  mint: string;
  network: OffpayNetwork;
}): Promise<Omit<UmbraVaultFeeAccountCheck, 'exists' | 'validationError'>[]> {
  const programId = UMBRA_PROGRAM_ID_BY_NETWORK[params.network];
  if (programId == null) {
    throw new Error(`Umbra vault actions are not available on ${params.network}.`);
  }
  const programAddress = address(programId) as Address;
  const mintAddress = address(params.mint) as Address;

  const nestedChecks = await Promise.all(
    params.group.instructions.map(async (instruction) => {
      const { feeSchedule, feeVault } =
        instruction.protocolVersion === 'current'
          ? await deriveCurrentProtocolFeeAccountAddresses({
              feeConfig: await instruction.feeProvider(),
              instruction,
              mintAddress,
              programAddress,
            })
          : await deriveLegacyProtocolFeeAccountAddresses({
              instruction,
              mintAddress,
              programAddress,
            });

      return [
        {
          action: params.action,
          address: feeSchedule,
          instruction: instruction.label,
          kind: 'feeSchedule' as const,
          protocolVersion: instruction.protocolVersion,
        },
        {
          action: params.action,
          address: feeVault,
          instruction: instruction.label,
          kind: 'feeVault' as const,
          protocolVersion: instruction.protocolVersion,
        },
      ];
    }),
  );

  return nestedChecks.flat();
}

async function deriveProtocolFeeAccountChecks(params: {
  action: UmbraDirectVaultAction;
  mint: string;
  network: OffpayNetwork;
  protocolVersion?: UmbraProtocolVersion;
}): Promise<Omit<UmbraVaultFeeAccountCheck, 'exists' | 'validationError'>[]> {
  const groups = getProtocolFeeGroups(params.action).filter(
    (group) => params.protocolVersion == null || group.protocolVersion === params.protocolVersion,
  );
  const nestedChecks = await Promise.all(
    groups.map((group) =>
      deriveProtocolFeeGroupAccountChecks({
        action: params.action,
        group,
        mint: params.mint,
        network: params.network,
      }),
    ),
  );

  return nestedChecks.flat();
}

export async function deriveUmbraProtocolFeeAccounts(params: {
  action: UmbraDirectVaultAction;
  mint: string;
  network: OffpayNetwork;
}): Promise<Omit<UmbraVaultFeeAccountCheck, 'exists' | 'validationError'>[]> {
  return deriveProtocolFeeAccountChecks({ ...params, protocolVersion: 'current' });
}

async function verifyOffpayUmbraVaultFeeAccountReadinessUncached(params: {
  action: UmbraDirectVaultAction;
  mint: string;
  network: OffpayNetwork;
}): Promise<UmbraVaultFeeAccountReadiness> {
  const programId = UMBRA_PROGRAM_ID_BY_NETWORK[params.network];
  if (programId == null) {
    throw new Error(`Umbra vault actions are not available on ${params.network}.`);
  }
  const accountChecks = await deriveProtocolFeeAccountChecks(params);
  const addresses = Array.from(new Set(accountChecks.map((account) => account.address)));
  const response = await getRpcAccounts({
    addresses,
    network: params.network,
  });
  const accountsByAddress = new Map<string, RpcAccountRecord | null>();

  response.accounts.forEach((record, index) => {
    accountsByAddress.set(getRpcAccountAddress(record) ?? addresses[index], record);
  });

  const checkedAccounts = accountChecks.map((account) => {
    const validation = validateUmbraFeeAccount({
      account,
      expectedOwner: programId,
      record: accountsByAddress.get(account.address),
    });

    return {
      ...account,
      ...validation,
    };
  });
  const protocolVersions = getProtocolFeeGroups(params.action).map((group) => {
    const groupAccounts = checkedAccounts.filter(
      (account) => account.protocolVersion === group.protocolVersion,
    );
    const groupMissing = groupAccounts.filter((account) => !account.exists);
    return {
      available: groupAccounts.length > 0 && groupMissing.length === 0,
      checkedAccounts: groupAccounts,
      missingAccounts: groupMissing,
      protocolVersion: group.protocolVersion,
    };
  });
  const selectedAvailable =
    protocolVersions.find(
      (entry) =>
        entry.protocolVersion === 'current' &&
        entry.available &&
        canSelectProtocolVersion(params.network, entry.protocolVersion),
    ) ??
    protocolVersions.find(
      (entry) =>
        entry.protocolVersion === 'legacy' &&
        entry.available &&
        canSelectProtocolVersion(params.network, entry.protocolVersion),
    ) ??
    null;
  const selectedFallback =
    protocolVersions.find(
      (entry) =>
        entry.protocolVersion === 'current' &&
        canSelectProtocolVersion(params.network, entry.protocolVersion),
    ) ??
    protocolVersions.find(
      (entry) =>
        entry.protocolVersion === 'legacy' &&
        canSelectProtocolVersion(params.network, entry.protocolVersion),
    ) ??
    protocolVersions.find((entry) => entry.protocolVersion === 'current') ??
    protocolVersions.find((entry) => entry.protocolVersion === 'legacy') ??
    null;
  const available = selectedAvailable != null;
  const missingAccounts = available
    ? []
    : (selectedFallback?.missingAccounts ?? checkedAccounts.filter((account) => !account.exists));

  if (__DEV__ && !available && missingAccounts.length > 0) {
    console.warn('[umbra-vault-readiness] unavailable protocol fee accounts', {
      action: params.action,
      mint: params.mint,
      network: params.network,
      missingAccounts: missingAccounts.map((account) => ({
        address: account.address,
        instruction: account.instruction,
        kind: account.kind,
        protocolVersion: account.protocolVersion,
        validationError: account.validationError,
      })),
    });
  }

  return {
    action: params.action,
    available,
    checkedAccounts,
    message: available ? null : UMBRA_VAULT_UNAVAILABLE_MESSAGE,
    missingAccounts,
    mint: params.mint,
    network: params.network,
    protocolVersion: selectedAvailable?.protocolVersion ?? null,
    protocolVersions,
  };
}

export async function verifyOffpayUmbraVaultFeeAccountReadiness(params: {
  action: UmbraDirectVaultAction;
  mint: string;
  network: OffpayNetwork;
}): Promise<UmbraVaultFeeAccountReadiness> {
  const cacheKey = vaultReadinessCacheKey(params);
  const now = Date.now();
  const cached = positiveVaultReadinessCache.get(cacheKey);
  if (cached != null && cached.expiresAt > now) {
    const startedAt = mark();
    measure('umbra.vaultReadiness.cacheHit', startedAt, {
      action: params.action,
      mint: params.mint,
      network: params.network,
    });
    return cached.readiness;
  }
  if (cached != null) {
    positiveVaultReadinessCache.delete(cacheKey);
  }

  const inFlight = inFlightVaultReadinessCache.get(cacheKey);
  if (inFlight != null) {
    const startedAt = mark();
    try {
      return await inFlight;
    } finally {
      measure('umbra.vaultReadiness.inFlightJoin', startedAt, {
        action: params.action,
        mint: params.mint,
        network: params.network,
      });
    }
  }

  const promise = verifyOffpayUmbraVaultFeeAccountReadinessUncached(params).then((readiness) => {
    if (readiness.available) {
      positiveVaultReadinessCache.set(cacheKey, {
        expiresAt: Date.now() + UMBRA_VAULT_READINESS_POSITIVE_CACHE_TTL_MS,
        readiness,
      });
    }
    return readiness;
  });
  inFlightVaultReadinessCache.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    inFlightVaultReadinessCache.delete(cacheKey);
  }
}

export async function assertOffpayUmbraVaultFeeAccountsReady(params: {
  action: UmbraDirectVaultAction;
  mint: string;
  network: OffpayNetwork;
}): Promise<UmbraVaultFeeAccountReadiness> {
  const readiness = await verifyOffpayUmbraVaultFeeAccountReadiness(params);
  if (!readiness.available) {
    throw new Error(readiness.message ?? UMBRA_VAULT_UNAVAILABLE_MESSAGE);
  }

  return readiness;
}

function createOffpaySolanaRpc(network: OffpayNetwork) {
  return {
    getAccountInfo(address: RpcSignatureInput): RpcSendResult<{ value: RpcAccountValue | null }> {
      return {
        send: async () => {
          const response = await getRpcAccounts({
            addresses: [toRpcString(address)],
            network,
          });

          return {
            value: toRpcAccountValue(response.accounts[0]),
          };
        },
      };
    },
    getMultipleAccounts(
      addresses: readonly RpcSignatureInput[],
    ): RpcSendResult<{ value: Array<RpcAccountValue | null> }> {
      return {
        send: async () => {
          const response = await getRpcAccounts({
            addresses: addresses.map(toRpcString),
            network,
          });

          return {
            value: response.accounts.map(toRpcAccountValue),
          };
        },
      };
    },
    getLatestBlockhash(): RpcSendResult<{
      value: { blockhash: string; lastValidBlockHeight: bigint };
    }> {
      return {
        send: async () => {
          const response = await getRpcLatestBlockhash(network);
          return {
            value: {
              blockhash: response.blockhash,
              lastValidBlockHeight: toBigint(response.lastValidBlockHeight),
            },
          };
        },
      };
    },
    getEpochInfo(): RpcSendResult<{
      epoch: bigint;
      slotIndex: bigint;
      slotsInEpoch: bigint;
      absoluteSlot: bigint;
      blockHeight: bigint;
      transactionCount: bigint | null;
    }> {
      return {
        send: async () => {
          const response = await getRpcEpochInfo(network);
          const transactionCount = (
            response as {
              transactionCount?: number | string | bigint | null;
            }
          ).transactionCount;

          return {
            epoch: toBigint(response.epoch),
            slotIndex: toBigint(response.slotIndex),
            slotsInEpoch: toBigint(response.slotsInEpoch),
            absoluteSlot: toBigint(
              (response as { absoluteSlot?: number | string | bigint }).absoluteSlot,
              toBigint(response.slotIndex),
            ),
            blockHeight: toBigint(
              (response as { blockHeight?: number | string | bigint }).blockHeight,
              0n,
            ),
            transactionCount: transactionCount == null ? null : toBigint(transactionCount),
          };
        },
      };
    },
    getSlot(): RpcSendResult<bigint> {
      return {
        send: async () => {
          const response = await getRpcSlot(network);
          return toBigint(response.slot);
        },
      };
    },
    sendTransaction(
      rawTransaction: RpcSignatureInput,
      options?: RpcTransactionSendOptions,
    ): RpcSendResult<string> {
      return {
        send: async () => {
          const response = await broadcastRawTransaction({
            rawTransaction: toBase64Transaction(rawTransaction),
            network,
            skipPreflight: options?.skipPreflight,
            maxRetries: options?.maxRetries,
            preflightCommitment: options?.preflightCommitment,
          });
          return response.signature;
        },
      };
    },
    getSignatureStatuses(signatures: readonly RpcSignatureInput[]): RpcSendResult<{
      value: Array<{
        slot: bigint | null;
        confirmations: number | null;
        err: unknown;
        confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
      } | null>;
    }> {
      return {
        send: async () => {
          const response = await getRpcSignatureStatuses({
            signatures: signatures.map(toRpcString),
            network,
          });

          return {
            value: response.statuses.map((status) =>
              status == null
                ? null
                : {
                    slot: status.slot == null ? null : toBigint(status.slot),
                    confirmations: status.confirmations,
                    err: status.err,
                    confirmationStatus: status.confirmationStatus,
                  },
            ),
          };
        },
      };
    },
    getSignaturesForAddress(
      address: RpcSignatureInput,
      options?: { limit?: number; before?: string },
    ): RpcSendResult<
      Array<{
        signature: string;
        slot: bigint;
        err: unknown;
        confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
      }>
    > {
      return {
        send: async () => {
          const response = await getRpcSignaturesForAddress({
            address: toRpcString(address),
            limit: options?.limit,
            before: options?.before,
            network,
          });

          return response.signatures.map((entry) => ({
            signature: entry.signature,
            slot: toBigint(entry.slot),
            err: entry.err,
            confirmationStatus: entry.confirmationStatus,
          }));
        },
      };
    },
  };
}

export function createOffpaySolanaRpcFactory(network: OffpayNetwork): CreateSolanaRpcFunction {
  assertUmbraNetworkSupportedForProviders(network);
  return (() => createOffpaySolanaRpc(network)) as unknown as CreateSolanaRpcFunction;
}

function createOffpayArciumDeps(network: OffpayNetwork): ArciumDeps {
  const defaultDeps = getDefaultArciumDeps();
  const createRpc = createOffpaySolanaRpcFactory(network);

  return {
    ...defaultDeps,
    rpcBuilders: {
      ...defaultDeps.rpcBuilders,
      createRpc,
    },
  };
}

export function createOffpayUmbraAccountInfoProvider(
  network: OffpayNetwork,
): AccountInfoProviderFunction {
  assertUmbraNetworkSupportedForProviders(network);
  return async (addresses) => {
    if (addresses.length === 0) return new Map();

    const startedAt = mark();
    try {
      const response = await getRpcAccounts({
        addresses: addresses.map(toRpcString),
        network,
      });
      const result = new Map<AccountAddress, MaybeEncodedAccount>();

      addresses.forEach((requestedAddress, index) => {
        result.set(
          requestedAddress,
          toMaybeEncodedAccount(requestedAddress, response.accounts[index]),
        );
      });

      return result;
    } finally {
      measure('umbra.rpc.accountInfoProvider', startedAt, {
        accountCount: addresses.length,
        network,
      });
    }
  };
}

export function createOffpayUmbraSdkDeps(
  network: OffpayNetwork,
): Required<
  Pick<
    GetUmbraClientDeps,
    | 'accountInfoProvider'
    | 'blockhashProvider'
    | 'transactionForwarder'
    | 'epochInfoProvider'
    | 'computationMonitor'
  >
> {
  assertUmbraNetworkSupportedForProviders(network);
  const createRpc = createOffpaySolanaRpcFactory(network);
  const arciumDeps = createOffpayArciumDeps(network);
  const rpcUrl = getUmbraRpcUrl(network);

  return {
    accountInfoProvider: createOffpayUmbraAccountInfoProvider(network),
    blockhashProvider: getRpcBlockhashProvider({ rpcUrl }, { createRpc }),
    transactionForwarder: withSingleUmbraSendAttempt(
      getPollingTransactionForwarder({ rpcUrl }, { createRpc }),
    ),
    epochInfoProvider: getRpcEpochInfoProvider({ rpcUrl }, { createRpc }),
    computationMonitor: getPollingComputationMonitor({ rpcUrl }, arciumDeps),
  };
}

export function createOffpayLegacySolanaRpcFactory(
  network: OffpayNetwork,
): LegacyCreateSolanaRpcFunction {
  assertUmbraNetworkSupportedForProviders(network);
  return (() => createOffpaySolanaRpc(network)) as unknown as LegacyCreateSolanaRpcFunction;
}

export function createOffpayLegacyUmbraAccountInfoProvider(
  network: OffpayNetwork,
): LegacyAccountInfoProviderFunction {
  return createOffpayUmbraAccountInfoProvider(
    network,
  ) as unknown as LegacyAccountInfoProviderFunction;
}

export function createOffpayLegacyUmbraSdkDeps(
  network: OffpayNetwork,
): Required<
  Pick<
    LegacyGetUmbraClientDeps,
    | 'accountInfoProvider'
    | 'blockhashProvider'
    | 'transactionForwarder'
    | 'epochInfoProvider'
    | 'computationMonitor'
  >
> {
  assertUmbraNetworkSupportedForProviders(network);
  const createRpc = createOffpayLegacySolanaRpcFactory(network);
  const rpcUrl = getUmbraRpcUrl(network);

  return {
    accountInfoProvider: createOffpayLegacyUmbraAccountInfoProvider(network),
    blockhashProvider: getLegacyRpcBlockhashProvider({ rpcUrl }, { createRpc }),
    transactionForwarder: withSingleUmbraSendAttempt(
      getLegacyPollingTransactionForwarder({ rpcUrl }, { createRpc }),
    ),
    epochInfoProvider: getLegacyRpcEpochInfoProvider({ rpcUrl }, { createRpc }),
    computationMonitor: getLegacyPollingComputationMonitor({ rpcUrl }, { createRpc }),
  };
}

export async function createOffpayUmbraClient(params: {
  signer: IUmbraSigner;
  network: OffpayNetwork;
  deferMasterSeedSignature?: boolean;
}): Promise<IUmbraClient> {
  assertUmbraNetworkSupportedForProviders(params.network);
  const deps = createOffpayUmbraSdkDeps(params.network);
  const rpcUrl = getUmbraRpcUrl(params.network);
  const client = await getUmbraClient(
    {
      signer: params.signer,
      network: params.network,
      rpcUrl,
      rpcSubscriptionsUrl: rpcUrl,
      deferMasterSeedSignature: params.deferMasterSeedSignature ?? true,
      legacyMasterSeedSchemes: [masterSeedSchemeV4, masterSeedSchemeV2, masterSeedSchemeV1],
      signSchemeMessages: 'deferred',
    },
    deps,
  );

  return client;
}

export async function createOffpayLegacyUmbraClient(params: {
  signer: LegacyUmbraSigner;
  network: OffpayNetwork;
  deferMasterSeedSignature?: boolean;
}): Promise<LegacyUmbraClient> {
  assertUmbraNetworkSupportedForProviders(params.network);
  const deps = createOffpayLegacyUmbraSdkDeps(params.network);
  const rpcUrl = getUmbraRpcUrl(params.network);
  const client = await getLegacyUmbraClient(
    {
      signer: params.signer,
      network: params.network,
      rpcUrl,
      rpcSubscriptionsUrl: rpcUrl,
      deferMasterSeedSignature: params.deferMasterSeedSignature ?? true,
    },
    deps,
  );

  return client;
}

export async function verifyOffpayUmbraRpcReadiness(network: OffpayNetwork): Promise<{
  blockhash: string;
  slot: bigint;
}> {
  assertUmbraNetworkSupportedForProviders(network);
  const now = Date.now();
  const cached = positiveRpcReadinessCache.get(network);
  if (cached != null && cached.expiresAt > now) {
    const startedAt = mark();
    measure('umbra.rpc.readiness.cacheHit', startedAt, { network });
    return cached.readiness;
  }
  if (cached != null) {
    positiveRpcReadinessCache.delete(network);
  }

  const inFlight = inFlightRpcReadinessCache.get(network);
  if (inFlight != null) {
    const startedAt = mark();
    try {
      return await inFlight;
    } finally {
      measure('umbra.rpc.readiness.inFlightJoin', startedAt, { network });
    }
  }

  const startedAt = mark();
  const promise = Promise.all([getRpcLatestBlockhash(network), getRpcSlot(network)]).then(
    ([blockhash, slot]) => {
      const readiness = {
        blockhash: blockhash.blockhash,
        slot: toBigint(slot.slot),
      };
      positiveRpcReadinessCache.set(network, {
        expiresAt: Date.now() + UMBRA_RPC_READINESS_POSITIVE_CACHE_TTL_MS,
        readiness,
      });
      return readiness;
    },
  );
  inFlightRpcReadinessCache.set(network, promise);

  try {
    return await promise;
  } finally {
    inFlightRpcReadinessCache.delete(network);
    measure('umbra.rpc.readiness', startedAt, {
      network,
    });
  }
}
