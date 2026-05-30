import { sha256 } from '@noble/hashes/sha2.js';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/addresses';
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
import { getMintEncryptionKeyRotatorFunction } from '@umbra-privacy/sdk/account';
import {
  getBurnableStealthPoolNoteScannerFunction as getClaimableUtxoScannerFunction,
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction as getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfBurnableStealthPoolNoteIntoETABurnerFunction as getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
} from '@umbra-privacy/sdk/burn';
import {
  getATAIntoETADirectDepositorFunction as getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getATAIntoReceiverBurnableStealthPoolNoteCreatorFunction as getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getATAIntoSelfBurnableStealthPoolNoteCreatorFunction as getPublicBalanceToSelfClaimableUtxoCreatorFunction,
  getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction as getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
} from '@umbra-privacy/sdk/deposit';
import {
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction as getLegacyEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction as getLegacyEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getMintEncryptionKeyRotatorFunction as getLegacyMintEncryptionKeyRotatorFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction as getLegacyPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction as getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getPublicBalanceToSelfClaimableUtxoCreatorFunction as getLegacyPublicBalanceToSelfClaimableUtxoCreatorFunction,
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

import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
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
import {
  createNobleUmbraSigner,
  deriveSigningSeedForUmbra,
} from '@/lib/umbra/umbra-signer';
import {
  assertUmbraClaimCompleted,
  createOffpayUmbraBatchMerkleProofFetcher,
  createOffpayUmbraClaimRelayer,
  createOffpayUmbraUtxoDataFetcher,
  getUtxoInsertionIndexAsNumber,
  isBenignAlreadyClaimedFailure,
  projectPendingClaimUtxo,
} from '@/lib/umbra/umbra-indexer-adapter';
import {
  getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getRnCreateReceiverClaimableUtxoFromEncryptedBalanceProver,
  getRnCreateReceiverClaimableUtxoFromPublicBalanceProver,
  getRnCreateSelfClaimableUtxoFromPublicBalanceProver,
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
import {
  byteArraysEqual,
  encodeU128LeBytes,
  getMapValueByStringKey,
  isStatusBitSet,
} from '@/lib/umbra/umbra-parsing';

import type { OffpayNetwork } from '@/types/offpay-api';
import type { IUmbraClient } from '@umbra-privacy/sdk/client';
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

const UMBRA_AWAIT_COMPUTATION_FINALIZATION = {
  maxSlotWindow: 200,
  safetyTimeoutMs: 120_000,
  reclaimComputationRent: false,
} as const;
const U64_MAX = (1n << 64n) - 1n;
const ENCRYPTED_USER_STATUS_BIT_MVK_KEY_REGISTERED = 2;
const ENCRYPTED_USER_STATUS_BIT_TOKEN_KEY_REGISTERED = 4;
const ENCRYPTED_TOKEN_STATUS_BIT_SHARED_MODE = 3;
const ENCRYPTED_TOKEN_STATUS_BIT_ARCIUM_BALANCE_INITIALISED = 4;

type UmbraSdkEncryptedBalanceEntry = {
  state: string;
  balance?: bigint;
};

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

const UMBRA_STRUCT_TEXT_ENCODER = new TextEncoder();
const ENCRYPTED_USER_ACCOUNT_SEED = sha256(
  UMBRA_STRUCT_TEXT_ENCODER.encode('EncryptedUserAccount'),
);
const ENCRYPTED_TOKEN_ACCOUNT_SEED = sha256(
  UMBRA_STRUCT_TEXT_ENCODER.encode('EncryptedTokenAccount'),
);
const NULLIFIER_SET_SEED = sha256(UMBRA_STRUCT_TEXT_ENCODER.encode('NullifierSet'));

async function findEncryptedUserAccountPda(
  userPubkey: unknown,
  umbraProgram: unknown,
): Promise<string> {
  const addressEncoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(String(umbraProgram)),
    seeds: [ENCRYPTED_USER_ACCOUNT_SEED, addressEncoder.encode(address(String(userPubkey)))],
  });
  return String(pda);
}

async function findEncryptedTokenAccountPda(
  userPubkey: unknown,
  mintPubkey: unknown,
  umbraProgram: unknown,
): Promise<string> {
  const addressEncoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(String(umbraProgram)),
    seeds: [
      ENCRYPTED_TOKEN_ACCOUNT_SEED,
      addressEncoder.encode(address(String(userPubkey))),
      addressEncoder.encode(address(String(mintPubkey))),
    ],
  });
  return String(pda);
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
}): Promise<IUmbraClient> {
  const schemes = Array.isArray(params.client.masterSeedSchemes)
    ? params.client.masterSeedSchemes
    : [];
  if (schemes.length === 0) return params.client;

  const userAccount = await fetchDecodedUmbraUserAccountForSchemeCheck(params);
  if (userAccount == null) return params.client;

  for (const scheme of schemes) {
    if (
      await umbraMasterSeedSchemeMatchesUserAccount({
        client: params.client,
        schemeId: scheme.id,
        userAccount: userAccount.decoded,
      })
    ) {
      return getUmbraClientForMasterSeedScheme(params.client, scheme.id);
    }
  }

  return params.client;
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
  const programAddress = address(String(umbraProgram));
  const indexBytes = encodeU128LeBytes(stealthPoolIndex);
  const derivePda = async (variant: number): Promise<string> => {
    const [pda] = await getProgramDerivedAddress({
      programAddress,
      seeds: [NULLIFIER_SET_SEED, indexBytes, new Uint8Array([variant])],
    });
    return String(pda);
  };
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
  const signingSeed = await deriveSigningSeedForUmbra(walletAddress, params.walletId);
  const { signer, dispose } = createNobleUmbraSigner(walletAddress, signingSeed);

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
    const client = await selectUmbraClientForRegisteredMasterSeedScheme({
      client: baseClient,
      rpc,
      walletAddress,
    });

    return {
      client,
      rpc,
      network: params.network,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    zeroOutBytes(signingSeed);
  }
}

async function createLegacyUmbraRuntime(
  params: UmbraWalletExecutionParams,
): Promise<LegacyUmbraRuntime> {
  const walletAddress = assertWalletAddress(params.walletAddress);
  const signingSeed = await deriveSigningSeedForUmbra(walletAddress, params.walletId);
  const { signer, dispose } = createNobleUmbraSigner(walletAddress, signingSeed);

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
  } finally {
    zeroOutBytes(signingSeed);
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

async function queryUmbraVaultRegistrationStatus(
  runtime: UmbraRuntime,
  walletAddress: string,
): Promise<UmbraVaultRegistrationStatus> {
  const queryUser = getUserAccountQuerierFunction({ client: runtime.client }, {
    accountInfoProvider: runtime.rpc.accountInfoProvider,
  } as never);
  const userAccount = (await queryUser(walletAddress as never)) as UmbraQueriedUserAccount;
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
  const metadata = resolveUmbraSupportedToken({
    network: params.network,
    token: params.token,
    tokenMint: params.tokenMint,
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
  if (params.network === 'devnet') return registrationStatus;
  if (registrationStatus.mixerRegistered) return registrationStatus;

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
  await verifyOffpayUmbraRpcReadiness(params.network);
  const readiness = await assertOffpayUmbraVaultFeeAccountsReady({
    action: 'shield',
    mint: token.metadata.mint,
    network: params.network,
  });
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
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  const recipient = assertRecipientAddress(params.recipient);
  const token = await resolveUmbraToken({ ...params, requireMixer: true });
  await verifyOffpayUmbraRpcReadiness(params.network);
  await assertOffpayUmbraVaultFeeAccountsReady({
    action: 'privateP2pFromPublic',
    mint: token.metadata.mint,
    network: params.network,
  });

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

  const runLegacyPublicPrivateP2P = (): Promise<UmbraExecutionResult> =>
    withLegacyUmbraRuntime(params, async (runtime) => {
      const isSelfPayment = recipient === walletAddress;
      if (!isSelfPayment) {
        const receiverRegistrationStatus = await queryLegacyUmbraVaultRegistrationStatus(
          runtime,
          recipient,
        );
        if (!receiverRegistrationStatus.mixerRegistered) {
          throw new Error(
            'Recipient has not set up Umbra private P2P yet. Ask them to open Receive, choose Umbra private P2P, complete setup, then retry.',
          );
        }
      }

      const senderRegistrationStatus = await ensureLegacyUmbraPrivateP2PSenderReady(
        runtime,
        walletAddress,
        { autoSetup: params.autoSetupSender === true },
      );
      let result: unknown;

      if (isSelfPayment) {
        const createUtxo = getLegacyPublicBalanceToSelfClaimableUtxoCreatorFunction(
          { client: runtime.client },
          {
            zkProver: getRnCreateSelfClaimableUtxoFromPublicBalanceProver(),
            rpc: buildLegacyRpcDeps(runtime),
          } as never,
        );
        result = await createUtxo(
          {
            amount: BigInt(token.amountAtomic) as never,
            destinationAddress: recipient as never,
            mint: token.metadata.mint as never,
          } as never,
          {
            optionalData: new Uint8Array(32) as never,
          } as never,
        );
      } else {
        const createUtxo = getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client: runtime.client },
          {
            zkProver: getRnCreateReceiverClaimableUtxoFromPublicBalanceProver(),
            rpc: buildLegacyRpcDeps(runtime),
          } as never,
        );
        result = await createUtxo(
          {
            amount: BigInt(token.amountAtomic) as never,
            destinationAddress: recipient as never,
            mint: token.metadata.mint as never,
          } as never,
          {
            optionalData: new Uint8Array(32) as never,
          } as never,
        );
      }

      return buildResult(result, senderRegistrationStatus);
    });

  const runCurrentPublicPrivateP2P = (): Promise<UmbraExecutionResult> =>
    withUmbraRuntime(params, async (runtime) => {
      const isSelfPayment = recipient === walletAddress;
      if (!isSelfPayment) {
        const receiverRegistrationStatus = await queryUmbraVaultRegistrationStatus(
          runtime,
          recipient,
        );
        if (!receiverRegistrationStatus.mixerRegistered) {
          throw new Error(
            'Recipient has not set up Umbra private P2P yet. Ask them to open Receive, choose Umbra private P2P, complete setup, then retry.',
          );
        }
      }

      const senderRegistrationStatus = await ensureUmbraPrivateP2PSenderReady(
        runtime,
        walletAddress,
        params,
        { autoSetup: params.autoSetupSender === true },
      );
      if (isSelfPayment && !senderRegistrationStatus.mixerRegistered) {
        throw new Error(
          'Umbra private P2P setup is not confirmed yet. Try again after setup lands.',
        );
      }
      let result: unknown;

      if (isSelfPayment) {
        const createUtxo = getPublicBalanceToSelfClaimableUtxoCreatorFunction(
          { client: runtime.client },
          {
            zkProver: getRnCreateSelfClaimableUtxoFromPublicBalanceProver(),
            rpc: buildRpcDeps(runtime),
          } as never,
        );
        result = await createUtxo(
          {
            amount: BigInt(token.amountAtomic) as never,
            destinationAddress: recipient as never,
            mint: token.metadata.mint as never,
          } as never,
          {
            optionalData: new Uint8Array(32) as never,
          } as never,
        );
      } else {
        const createUtxo = getPublicBalanceToReceiverClaimableUtxoCreatorFunction(
          { client: runtime.client },
          {
            zkProver: getRnCreateReceiverClaimableUtxoFromPublicBalanceProver(),
            rpc: buildRpcDeps(runtime),
          } as never,
        );
        result = await createUtxo(
          {
            amount: BigInt(token.amountAtomic) as never,
            destinationAddress: recipient as never,
            mint: token.metadata.mint as never,
          } as never,
          {
            optionalData: new Uint8Array(32) as never,
          } as never,
        );
      }

      return buildResult(result, senderRegistrationStatus);
    });

  if (shouldPreferLegacyUmbraProtocol(params.network)) {
    return runLegacyPublicPrivateP2P();
  }

  try {
    return await runCurrentPublicPrivateP2P();
  } catch (error) {
    if (!isUmbraInstructionFallbackNotFound(error)) throw error;
    if (!isLegacyUmbraProtocolAccepted(params.network)) throw error;
    markOffpayUmbraProtocolVersionUnsupported(params.network, 'current');
    return runLegacyPublicPrivateP2P();
  }
}

export async function sendUmbraPrivateP2PFromEncryptedBalance(
  params: UmbraPrivateP2PFromEncryptedBalanceParams,
): Promise<UmbraExecutionResult> {
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  const recipient = assertRecipientAddress(params.recipient);
  const token = await resolveUmbraToken({ ...params, requireMixer: true });
  await verifyOffpayUmbraRpcReadiness(params.network);
  const readiness = await assertOffpayUmbraVaultFeeAccountsReady({
    action: 'privateP2pFromEncrypted',
    mint: token.metadata.mint,
    network: params.network,
  });

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
  params: {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
  },
) {
  const fetchUtxoData = createOffpayUmbraUtxoDataFetcher(network);
  const clientWithIndexer = {
    ...runtime.client,
    fetchUtxoData,
  } as IUmbraClient;
  const scanner = getClaimableUtxoScannerFunction({ client: clientWithIndexer }, {
    fetchUtxoData,
  } as never);
  const scanResult = (await scanner()) as {
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

  return {
    receiverClaimableUtxos: [
      ...(scanResult.etaIntoReceiverBurnable ?? scanResult.received ?? []),
      ...(scanResult.ataIntoReceiverBurnable ?? scanResult.publicReceived ?? []),
    ],
    selfClaimableUtxos: [
      ...(scanResult.etaIntoSelfBurnable ?? scanResult.selfBurnable ?? []),
      ...(scanResult.ataIntoSelfBurnable ?? scanResult.publicSelfBurnable ?? []),
    ],
    nextScanStartIndex: String(nextScanStartIndex),
  };
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
  return claimedInsertionIndices;
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

export async function scanUmbraPrivateP2PClaims(
  params: UmbraWalletExecutionParams & {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
    excludedInsertionIndices?: ReadonlySet<number> | readonly number[] | null;
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
    const registrationStatus = await queryUmbraVaultRegistrationStatus(runtime, walletAddress);
    const scanResult = await scanUmbraPrivateP2PUtxos(runtime, params.network, params);
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
}

export async function claimUmbraPrivateP2PToEncryptedBalance(
  params: UmbraWalletExecutionParams & {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
    excludedInsertionIndices?: ReadonlySet<number> | readonly number[] | null;
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
    const registrationStatus = await queryUmbraVaultRegistrationStatus(runtime, walletAddress);
    const scanResult = await scanUmbraPrivateP2PUtxos(runtime, params.network, params);
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
                { client: runtime.client },
                {
                  fetchBatchMerkleProof: createOffpayUmbraBatchMerkleProofFetcher(params.network),
                  relayer: createOffpayUmbraClaimRelayer(params.network),
                  zkProver: getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
                  awaitCompletion: true,
                } as never,
              );
        try {
          const result = await claimReceiver(
            receiverClaimableUtxos as never,
            new Uint8Array(32) as never,
          );
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
                  zkProver: getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
                  awaitCompletion: true,
                } as never,
              )
            : getSelfClaimableUtxoToEncryptedBalanceClaimerFunction({ client: runtime.client }, {
                fetchBatchMerkleProof: createOffpayUmbraBatchMerkleProofFetcher(params.network),
                relayer: createOffpayUmbraClaimRelayer(params.network),
                zkProver: getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
                awaitCompletion: true,
              } as never);
        try {
          const result = await claimSelf(selfClaimableUtxos as never, new Uint8Array(32) as never);
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
          // per-UTXO ids. Without this we'd lose the exclusion record
          // and the scanner would resurface the same UTXO forever.
          if (
            classified.outcome === 'completed' &&
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
      const sawTotalFailure =
        claimedUtxoInsertionIndices.length === 0 && unresolvedInsertionIndices.length > 0;

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
  await verifyOffpayUmbraRpcReadiness(params.network);
  const readiness = await assertOffpayUmbraVaultFeeAccountsReady({
    action: 'withdraw',
    mint: token.metadata.mint,
    network: params.network,
  });
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
  assertUmbraNetworkSupported(params.network);
  const walletAddress = assertWalletAddress(params.walletAddress);
  await verifyOffpayUmbraRpcReadiness(params.network);
  return withUmbraRuntime(params, async (runtime) => {
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

    const registrationStatus = await queryUmbraVaultRegistrationStatus(runtime, walletAddress);
    const queryBalances = getEncryptedBalanceQuerierFunction({ client: runtime.client }, {
      accountInfoProvider: runtime.rpc.accountInfoProvider,
    } as never);
    const uniqueMints = mints.filter(
      (token, index, tokens) =>
        tokens.findIndex((candidate) => candidate.mint === token.mint) === index,
    );
    const result = await queryBalances(uniqueMints.map((token) => token.mint as never));
    const balances = await Promise.all(
      uniqueMints.map(async (token) => {
        const entry = getUmbraSdkEncryptedBalanceEntry(result, token.mint);
        const balance = normalizeUmbraEncryptedBalanceEntry(entry, token.decimals);
        const keyStatus =
          balance.state === 'shared_unreadable'
            ? await queryUmbraVaultEncryptionKeyStatus(runtime, walletAddress, token.mint)
            : null;
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
}
