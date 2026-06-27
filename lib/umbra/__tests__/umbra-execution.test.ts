import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

const mockSigningSeed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const mockWalletAddress = bs58.encode(ed25519.getPublicKey(mockSigningSeed));
const mockRecipientSeed = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
const mockRecipientAddress = bs58.encode(ed25519.getPublicKey(mockRecipientSeed));
const mockShield = jest.fn();
const mockUnshield = jest.fn();
const mockLegacyShield = jest.fn();
const mockLegacyUnshield = jest.fn();
const mockRegister = jest.fn();
const mockLegacyRegister = jest.fn();
const mockRotateMintKey = jest.fn();
const mockLegacyRotateMintKey = jest.fn();
const mockUserAccountX25519KeypairDeriver = jest.fn();
const mockCreatePublicReceiverUtxo = jest.fn();
const mockCreatePublicSelfUtxo = jest.fn();
const mockLegacyCreatePublicReceiverUtxo = jest.fn();
const mockLegacyCreatePublicSelfUtxo = jest.fn();
const mockCreateEncryptedReceiverUtxo = jest.fn();
const mockLegacyCreateEncryptedReceiverUtxo = jest.fn();
const mockAssertUmbraVaultFeeAccountsReady = jest.fn();
const mockMarkUmbraProtocolVersionUnsupported = jest.fn();
const mockGetRpcFeeForMessage = jest.fn();
const mockGetRpcSignatureStatuses = jest.fn();
const mockGetUmbraUtxos = jest.fn();
const mockQueryUser = jest.fn();
const mockLegacyQueryUser = jest.fn();
const mockQueryBalances = jest.fn();
const mockDecodeEncryptedUserAccount = jest.fn();
const mockDecodeEncryptedTokenAccount = jest.fn();
const mockDeriveNullifierFromModifiedGenerationIndex = jest.fn();
const mockExpandModifiedGenerationIndex = jest.fn();
const mockPoseidonHasher = jest.fn();
const mockPoseidonPrivateKeyDeriver = jest.fn();
const mockEphemeralUtxoPoseidonPrivateKeyDeriver = jest.fn();
const mockClaimableScanner = jest.fn();
const mockSdkFetchUtxoData = jest.fn();
const mockGetUtxoDataFetcher = jest.fn(() => mockSdkFetchUtxoData);
const mockGetUmbraTreeSummaries = jest.fn();
const mockGetUmbraTreeProofs = jest.fn();
const mockReadServiceClientGetUtxoDataColumnar = jest.fn();
const mockReadServiceClient = jest.fn(function MockReadServiceClient() {
  return {
    getUtxoDataColumnar: mockReadServiceClientGetUtxoDataColumnar,
  };
});
const mockSdkFetchTreeSummary = jest.fn();
const mockGetTreeSummaryFetcher = jest.fn(() => mockSdkFetchTreeSummary);
const mockSdkBatchMerkleProofFetcher = jest.fn();
const mockGetBatchMerkleProofFetcher = jest.fn(() => mockSdkBatchMerkleProofFetcher);
const mockMmkvValues = new Map<string, string>();
let mockClaimableScannerDeps: { fetchUtxoData?: unknown } | null = null;
let mockClaimableScannerArgs: { client?: unknown } | null = null;
let mockCapturedUmbraSigner: {
  address: string;
  signMessage: (
    message: Uint8Array,
  ) => Promise<{ message: Uint8Array; signature: Uint8Array; signer: string }>;
  signTransaction: (transaction: {
    messageBytes: Uint8Array;
    signatures: Record<string, Uint8Array>;
  }) => Promise<{
    messageBytes: Uint8Array;
    signatures: Record<string, Uint8Array>;
  }>;
} | null = null;
const mockTransactionForwarder = Object.assign(jest.fn(), {
  fireAndForget: jest.fn(),
  forwardInParallel: jest.fn(),
  forwardSequentially: jest.fn(),
});
const mockSdkDeps = {
  accountInfoProvider: jest.fn(),
  blockhashProvider: jest.fn(),
  transactionForwarder: mockTransactionForwarder,
  epochInfoProvider: jest.fn(),
  computationMonitor: jest.fn(),
};
const mockReceiverPoseidonPrivateKey = 1000n;
const mockEphemeralPoseidonPrivateKey = 2000n;
const mockClient = {
  networkConfig: {
    programId: 'UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh',
  },
  accountInfoProvider: mockSdkDeps.accountInfoProvider,
  blockhashProvider: mockSdkDeps.blockhashProvider,
  transactionForwarder: mockSdkDeps.transactionForwarder,
  epochInfoProvider: mockSdkDeps.epochInfoProvider,
  fetchUtxoData: jest.fn(),
  fetchMerkleProof: jest.fn(),
};
jest.mock('@umbra-privacy/sdk/account', () => ({
  __esModule: true,
  getMintEncryptionKeyRotatorFunction: jest.fn(() => mockRotateMintKey),
}));

jest.mock('@umbra-privacy/sdk/burn', () => ({
  __esModule: true,
  getBurnableStealthPoolNoteScannerFunction: jest.fn((_args, deps) => {
    mockClaimableScannerArgs = _args;
    mockClaimableScannerDeps = deps;
    return mockClaimableScanner;
  }),
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction: jest.fn(),
  getSelfBurnableStealthPoolNoteIntoETABurnerFunction: jest.fn(),
}));

jest.mock('@umbra-privacy/sdk/deposit', () => ({
  __esModule: true,
  getATAIntoETADirectDepositorFunction: jest.fn(() => mockShield),
  getATAIntoReceiverBurnableStealthPoolNoteCreatorFunction: jest.fn(
    () => mockCreatePublicReceiverUtxo,
  ),
  getATAIntoSelfBurnableStealthPoolNoteCreatorFunction: jest.fn(() => mockCreatePublicSelfUtxo),
  getETAIntoReceiverBurnableStealthPoolNoteCreatorFunction: jest.fn(
    () => mockCreateEncryptedReceiverUtxo,
  ),
}));

jest.mock('@umbra-privacy/sdk/query', () => ({
  __esModule: true,
  getEncryptedBalanceQuerierFunction: jest.fn(() => mockQueryBalances),
  getUserAccountQuerierFunction: jest.fn(() => mockQueryUser),
}));

jest.mock('@umbra-privacy/sdk/registration', () => ({
  __esModule: true,
  getUserRegistrationFunction: jest.fn(() => mockRegister),
}));

jest.mock('@umbra-privacy/sdk/withdrawal', () => ({
  __esModule: true,
  getETAIntoATAWithdrawerFunction: jest.fn(() => mockUnshield),
}));

jest.mock('@umbra-privacy/sdk-legacy', () => ({
  __esModule: true,
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction: jest.fn(
    () => mockLegacyCreateEncryptedReceiverUtxo,
  ),
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction: jest.fn(() => mockLegacyUnshield),
  getMintEncryptionKeyRotatorFunction: jest.fn(() => mockLegacyRotateMintKey),
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction: jest.fn(
    () => mockLegacyCreatePublicReceiverUtxo,
  ),
  getPublicBalanceToSelfClaimableUtxoCreatorFunction: jest.fn(() => mockLegacyCreatePublicSelfUtxo),
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction: jest.fn(),
  getSelfClaimableUtxoToEncryptedBalanceClaimerFunction: jest.fn(),
  getUserAccountQuerierFunction: jest.fn(() => mockLegacyQueryUser),
  getUserRegistrationFunction: jest.fn(() => mockLegacyRegister),
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction: jest.fn(() => mockLegacyShield),
}));

jest.mock('@umbra-privacy/sdk/crypto/key-derivation', () => ({
  __esModule: true,
  deriveNullifierFromModifiedGenerationIndex: mockDeriveNullifierFromModifiedGenerationIndex,
  expandModifiedGenerationIndex: mockExpandModifiedGenerationIndex,
  getEphemeralUtxoPoseidonPrivateKeyDeriver: jest.fn(
    () => mockEphemeralUtxoPoseidonPrivateKeyDeriver,
  ),
  getPoseidonPrivateKeyDeriver: jest.fn(() => mockPoseidonPrivateKeyDeriver),
  getTokenEncryptionX25519KeypairDeriver: jest.fn(() => mockUserAccountX25519KeypairDeriver),
}));

jest.mock('@umbra-privacy/sdk/crypto/poseidon', () => ({
  __esModule: true,
  getPoseidonHasher: jest.fn(() => mockPoseidonHasher),
}));

jest.mock('@umbra-privacy/sdk/indexer', () => ({
  __esModule: true,
  IndexerError: class IndexerError extends Error {
    stage: string;
    operation: string;
    statusCode: number | undefined;

    constructor(
      stage: string,
      message: string,
      options: { operation: string; statusCode?: number; cause?: Error },
    ) {
      super(message);
      this.name = 'IndexerError';
      this.stage = stage;
      this.operation = options.operation;
      this.statusCode = options.statusCode;
      if (options.cause != null) {
        (this as { cause?: Error }).cause = options.cause;
      }
    }
  },
  ReadServiceClient: mockReadServiceClient,
  getBatchMerkleProofFetcher: mockGetBatchMerkleProofFetcher,
  getTreeSummaryFetcher: mockGetTreeSummaryFetcher,
  getUtxoDataFetcher: mockGetUtxoDataFetcher,
}));

jest.mock('@umbra-privacy/umbra-codama', () => ({
  __esModule: true,
  decodeEncryptedUserAccount: mockDecodeEncryptedUserAccount,
  decodeEncryptedTokenAccount: mockDecodeEncryptedTokenAccount,
}));

jest.mock('react-native-mmkv', () => ({
  __esModule: true,
  createMMKV: jest.fn(() => ({
    contains: (key: string) => mockMmkvValues.has(key),
    getString: (key: string) => mockMmkvValues.get(key),
    set: (key: string, value: string) => {
      mockMmkvValues.set(key, value);
    },
    remove: (key: string) => {
      mockMmkvValues.delete(key);
    },
  })),
}));

jest.mock('@/lib/wallet/secure-wallet-store', () => ({
  __esModule: true,
  getStoredWalletInfo: jest.fn(async () => ({
    id: 'wallet-1',
    publicKey: mockWalletAddress,
    importMethod: 'generated',
  })),
  getStoredWalletSigningMaterialWithAuth: jest.fn(async () => ({
    mnemonic: null,
    privateKey: 'mock-seed',
  })),
}));

jest.mock('@/lib/wallet/wallet', () => ({
  __esModule: true,
  decodeSigningSeedFromPrivateKey: jest.fn(() => Uint8Array.from(mockSigningSeed)),
  deriveSigningSeedFromMnemonic: jest.fn(async () => Uint8Array.from(mockSigningSeed)),
}));

jest.mock('@/lib/umbra/umbra-offpay-providers', () => ({
  __esModule: true,
  assertOffpayUmbraVaultFeeAccountsReady: mockAssertUmbraVaultFeeAccountsReady,
  createOffpayLegacyUmbraClient: jest.fn(async (params) => {
    mockCapturedUmbraSigner = params.signer;
    return mockClient;
  }),
  createOffpayLegacyUmbraSdkDeps: jest.fn(() => mockSdkDeps),
  createOffpayUmbraClient: jest.fn(async (params) => {
    mockCapturedUmbraSigner = params.signer;
    return mockClient;
  }),
  createOffpayUmbraSdkDeps: jest.fn(() => mockSdkDeps),
  markOffpayUmbraProtocolVersionUnsupported: mockMarkUmbraProtocolVersionUnsupported,
  verifyOffpayUmbraRpcReadiness: jest.fn(async () => ({
    blockhash: 'blockhash',
    slot: 1n,
  })),
}));

jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  getRpcFeeForMessage: mockGetRpcFeeForMessage,
  getRpcSignatureStatuses: mockGetRpcSignatureStatuses,
  getUmbraTreeProofs: mockGetUmbraTreeProofs,
  getUmbraTreeSummaries: mockGetUmbraTreeSummaries,
  getUmbraUtxos: mockGetUmbraUtxos,
}));

const {
  ensureUmbraEncryptedBalanceRegistration,
  ensureUmbraMixerRegistration,
  fetchUmbraEncryptedBalances,
  __resetUmbraClaimScanCacheForTests,
  claimUmbraPrivateP2PToEncryptedBalance,
  estimateUmbraPrivateP2PFromPublicBalanceFee,
  repairUmbraVaultEncryptionKey,
  resolveUmbraToken,
  scanUmbraPrivateP2PClaims,
  sendUmbraPrivateP2PFromEncryptedBalance,
  sendUmbraPrivateP2PFromPublicBalance,
  shieldTokenWithUmbra,
  withdrawTokenFromUmbra,
} = require('@/lib/umbra/umbra-execution') as typeof import('@/lib/umbra/umbra-execution');
const { getMintEncryptionKeyRotatorFunction } = require('@umbra-privacy/sdk/account') as {
  getMintEncryptionKeyRotatorFunction: jest.Mock;
};
const {
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction:
    getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getSelfBurnableStealthPoolNoteIntoETABurnerFunction:
    getSelfClaimableUtxoToEncryptedBalanceClaimerFunction,
} = require('@umbra-privacy/sdk/burn') as {
  getReceiverBurnableStealthPoolNoteIntoETABurnerFunction: jest.Mock;
  getSelfBurnableStealthPoolNoteIntoETABurnerFunction: jest.Mock;
};
const {
  getATAIntoETADirectDepositorFunction: getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getATAIntoReceiverBurnableStealthPoolNoteCreatorFunction:
    getPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getATAIntoSelfBurnableStealthPoolNoteCreatorFunction:
    getPublicBalanceToSelfClaimableUtxoCreatorFunction,
} = require('@umbra-privacy/sdk/deposit') as {
  getATAIntoETADirectDepositorFunction: jest.Mock;
  getATAIntoReceiverBurnableStealthPoolNoteCreatorFunction: jest.Mock;
  getATAIntoSelfBurnableStealthPoolNoteCreatorFunction: jest.Mock;
};
const { getUserRegistrationFunction } = require('@umbra-privacy/sdk/registration') as {
  getUserRegistrationFunction: jest.Mock;
};
const { getEncryptedBalanceQuerierFunction } = require('@umbra-privacy/sdk/query') as {
  getEncryptedBalanceQuerierFunction: jest.Mock;
};
const {
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction:
    getLegacyEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getMintEncryptionKeyRotatorFunction: getLegacyMintEncryptionKeyRotatorFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction:
    getLegacyPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction:
    getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction,
  getPublicBalanceToSelfClaimableUtxoCreatorFunction:
    getLegacyPublicBalanceToSelfClaimableUtxoCreatorFunction,
  getUserRegistrationFunction: getLegacyUserRegistrationFunction,
} = require('@umbra-privacy/sdk-legacy') as {
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction: jest.Mock;
  getMintEncryptionKeyRotatorFunction: jest.Mock;
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction: jest.Mock;
  getPublicBalanceToReceiverClaimableUtxoCreatorFunction: jest.Mock;
  getPublicBalanceToSelfClaimableUtxoCreatorFunction: jest.Mock;
  getUserRegistrationFunction: jest.Mock;
};
const { getTokenEncryptionX25519KeypairDeriver: getUserAccountX25519KeypairDeriver } =
  require('@umbra-privacy/sdk/crypto/key-derivation') as {
    getTokenEncryptionX25519KeypairDeriver: jest.Mock;
  };
const {
  getETAIntoATAWithdrawerFunction: getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
} = require('@umbra-privacy/sdk/withdrawal') as {
  getETAIntoATAWithdrawerFunction: jest.Mock;
};
const { getUmbraSupportedTokens } =
  require('@/lib/umbra/umbra-supported-tokens') as typeof import('@/lib/umbra/umbra-supported-tokens');

function makeClaimableScanResult(indices: readonly number[]) {
  return {
    selfBurnable: [],
    received: indices.map((index) => ({
      insertionIndex: BigInt(index),
    })),
    publicSelfBurnable: [],
    publicReceived: [],
    nextScanStartIndex: BigInt(indices.length > 0 ? Math.max(...indices) + 1 : 0),
  };
}

function makeClaimableUtxo(index: number, generationIndex = index) {
  return {
    insertionIndex: BigInt(index),
    modifiedGenerationIndex: makeU128LeBytes(generationIndex),
    unlockerType: 'received',
  };
}

function makeU128LeBytes(value: number): Uint8Array {
  const bytes = new Uint8Array(16);
  let remaining = BigInt(value);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function makeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function makeMockNullifierFieldValue(seed: number): bigint {
  return BigInt(seed);
}

function makeU256LeBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function makeMockNullifierHash(seed: number, poseidonPrivateKey = mockReceiverPoseidonPrivateKey) {
  return makeU256LeBytes(poseidonPrivateKey + makeMockNullifierFieldValue(seed));
}

function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return bytes;
}

function configureRegisteredUmbraVault(): void {
  mockQueryUser.mockResolvedValue({
    state: 'exists',
    data: {
      isInitialised: true,
      isUserAccountX25519KeyRegistered: true,
      isUserCommitmentRegistered: true,
      isActiveForAnonymousUsage: true,
    },
  });
}

function resetUmbraPrivacyStore(): void {
  const { useUmbraPrivacyStore } =
    require('@/store/umbraPrivacyStore') as typeof import('@/store/umbraPrivacyStore');
  useUmbraPrivacyStore.setState({
    receipts: [],
    registeredVaultKeys: [],
    registeredMixerKeys: [],
    registeredMixerVerifiedAt: {},
    claimedUtxoInsertionIndices: {},
  });
}

function getClaimedUmbraIndices(): readonly number[] {
  const { useUmbraPrivacyStore } =
    require('@/store/umbraPrivacyStore') as typeof import('@/store/umbraPrivacyStore');
  return (
    useUmbraPrivacyStore.getState().claimedUtxoInsertionIndices[`devnet:${mockWalletAddress}`] ?? []
  );
}

function getLatestReceiveExcludedIndices(): ReadonlySet<number> {
  const { getClaimedUmbraUtxoIndexSet, useUmbraPrivacyStore } =
    require('@/store/umbraPrivacyStore') as typeof import('@/store/umbraPrivacyStore');
  return getClaimedUmbraUtxoIndexSet(
    {
      claimedUtxoInsertionIndices: useUmbraPrivacyStore.getState().claimedUtxoInsertionIndices,
    },
    'devnet',
    mockWalletAddress,
  );
}

function markClaimedUmbraIndices(indices: readonly number[]): void {
  const { useUmbraPrivacyStore } =
    require('@/store/umbraPrivacyStore') as typeof import('@/store/umbraPrivacyStore');
  useUmbraPrivacyStore.getState().markUtxosClaimed({
    network: 'devnet',
    walletAddress: mockWalletAddress,
    insertionIndices: indices,
  });
}

describe('umbra-execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    [
      mockShield,
      mockUnshield,
      mockLegacyShield,
      mockLegacyUnshield,
      mockRegister,
      mockLegacyRegister,
      mockRotateMintKey,
      mockLegacyRotateMintKey,
      mockUserAccountX25519KeypairDeriver,
      mockCreatePublicReceiverUtxo,
      mockCreatePublicSelfUtxo,
      mockLegacyCreatePublicReceiverUtxo,
      mockLegacyCreatePublicSelfUtxo,
      mockCreateEncryptedReceiverUtxo,
      mockLegacyCreateEncryptedReceiverUtxo,
      mockAssertUmbraVaultFeeAccountsReady,
      mockMarkUmbraProtocolVersionUnsupported,
      mockGetRpcFeeForMessage,
      mockGetRpcSignatureStatuses,
      mockGetUmbraUtxos,
      mockGetUmbraTreeSummaries,
      mockGetUmbraTreeProofs,
      mockQueryUser,
      mockLegacyQueryUser,
      mockQueryBalances,
      mockDecodeEncryptedUserAccount,
      mockDecodeEncryptedTokenAccount,
      mockDeriveNullifierFromModifiedGenerationIndex,
      mockExpandModifiedGenerationIndex,
      mockPoseidonHasher,
      mockPoseidonPrivateKeyDeriver,
      mockEphemeralUtxoPoseidonPrivateKeyDeriver,
      mockClaimableScanner,
      mockSdkFetchUtxoData,
      mockGetUtxoDataFetcher,
      mockReadServiceClientGetUtxoDataColumnar,
      mockReadServiceClient,
      mockSdkFetchTreeSummary,
      mockGetTreeSummaryFetcher,
      mockSdkBatchMerkleProofFetcher,
      mockGetBatchMerkleProofFetcher,
      mockSdkDeps.accountInfoProvider,
      mockSdkDeps.blockhashProvider,
      mockSdkDeps.transactionForwarder,
      mockSdkDeps.transactionForwarder.fireAndForget,
      mockSdkDeps.transactionForwarder.forwardInParallel,
      mockSdkDeps.transactionForwarder.forwardSequentially,
      mockSdkDeps.epochInfoProvider,
      mockSdkDeps.computationMonitor,
    ].forEach((mock) => mock.mockReset());
    getUserAccountX25519KeypairDeriver.mockReset();
    getUserAccountX25519KeypairDeriver.mockImplementation(
      () => mockUserAccountX25519KeypairDeriver,
    );
    mockCapturedUmbraSigner = null;
    mockClaimableScannerDeps = null;
    mockClaimableScannerArgs = null;
    mockMmkvValues.clear();
    delete (mockClient as { masterSeed?: unknown }).masterSeed;
    delete (mockClient as { masterSeedSchemes?: unknown }).masterSeedSchemes;
    delete (mockClient as { getSchemeMasterSeed?: unknown }).getSchemeMasterSeed;
    __resetUmbraClaimScanCacheForTests();
    resetUmbraPrivacyStore();
    mockReadServiceClient.mockImplementation(function MockReadServiceClient() {
      return {
        getUtxoDataColumnar: mockReadServiceClientGetUtxoDataColumnar,
      };
    });
    mockAssertUmbraVaultFeeAccountsReady.mockResolvedValue({
      available: true,
      checkedAccounts: [],
      message: null,
      missingAccounts: [],
      protocolVersion: 'current',
      protocolVersions: [
        { available: true, checkedAccounts: [], missingAccounts: [], protocolVersion: 'current' },
        { available: true, checkedAccounts: [], missingAccounts: [], protocolVersion: 'legacy' },
      ],
    });
    mockGetRpcFeeForMessage.mockResolvedValue({ lamports: 5000 });
    mockGetRpcSignatureStatuses.mockImplementation(
      async ({ signatures }: { signatures: string[] }) => ({
        statuses: signatures.map(() => ({
          slot: 1,
          confirmations: 1,
          err: null,
          confirmationStatus: 'confirmed',
        })),
      }),
    );
    mockGetUmbraUtxos.mockResolvedValue({
      network: 'devnet',
      utxos: [],
      cursor: null,
      hasMore: false,
      totalCount: '0',
      startIndex: '0',
      endIndex: null,
      highestIndexedInsertionIndex: null,
      fetchedAt: new Date(0).toISOString(),
    });
    mockGetUmbraTreeSummaries.mockImplementation(async (network: string) => {
      const summaries = await mockSdkFetchTreeSummary();
      return {
        network,
        trees: summaries.map((tree: { treeIndex: bigint; numLeaves: bigint }) => ({
          treeIndex: tree.treeIndex.toString(),
          numLeaves: tree.numLeaves.toString(),
        })),
        fetchedAt: new Date(0).toISOString(),
      };
    });
    mockGetUmbraTreeProofs.mockImplementation(
      async ({ network, treeIndex }: { network: string; treeIndex: number }) => {
        const batch = (await mockSdkBatchMerkleProofFetcher()) as {
          root: Uint8Array;
          proofs: Map<bigint, { merklePath: Uint8Array[]; leaf: Uint8Array }>;
        };
        return {
          network,
          treeIndex,
          proofs: Array.from(batch.proofs.entries()).map(([insertionIndex, proof]) => ({
            insertionIndex: insertionIndex.toString(),
            proof: proof.merklePath.map((entry) => Buffer.from(entry).toString('base64')),
            leaf: Buffer.from(proof.leaf).toString('base64'),
          })),
          root: Buffer.from(batch.root).toString('base64'),
          fetchedAt: new Date(0).toISOString(),
        };
      },
    );
    mockGetUtxoDataFetcher.mockImplementation(() => mockSdkFetchUtxoData);
    mockGetTreeSummaryFetcher.mockImplementation(() => mockSdkFetchTreeSummary);
    mockGetBatchMerkleProofFetcher.mockImplementation(() => mockSdkBatchMerkleProofFetcher);
    mockSdkFetchUtxoData.mockResolvedValue({
      items: new Map(),
      hasMore: false,
      totalCount: 0n,
    });
    mockReadServiceClientGetUtxoDataColumnar.mockResolvedValue({
      columns: null,
      count: 0n,
      has_more: false,
      next_cursor: null,
      total_count: 0n,
      start_index: 0n,
      end_index: null,
    });
    mockSdkFetchTreeSummary.mockResolvedValue([{ treeIndex: 0n, numLeaves: 1_000n }]);
    mockSdkBatchMerkleProofFetcher.mockResolvedValue({
      root: new Uint8Array(32),
      proofs: new Map(),
    });
    mockClaimableScanner.mockResolvedValue({
      selfBurnable: [],
      received: [],
      publicSelfBurnable: [],
      publicReceived: [],
      nextScanStartIndex: 0n,
    });
    mockRotateMintKey.mockResolvedValue('repair-key-sig');
    mockLegacyRotateMintKey.mockResolvedValue('repair-key-sig');
    mockUserAccountX25519KeypairDeriver.mockResolvedValue({
      ed25519Keypair: {
        seed: Uint8Array.from({ length: 32 }, (_, index) => index + 10),
        publicKey: Uint8Array.from({ length: 32 }, (_, index) => index + 20),
      },
      x25519Keypair: {
        privateKey: Uint8Array.from({ length: 32 }, (_, index) => index + 30),
        publicKey: Uint8Array.from({ length: 32 }, (_, index) => index + 40),
      },
    });
    mockDeriveNullifierFromModifiedGenerationIndex.mockImplementation((bytes: Uint8Array) =>
      makeMockNullifierFieldValue(bytes[0] ?? 0),
    );
    mockExpandModifiedGenerationIndex.mockImplementation((bytes: Uint8Array) => {
      const expanded = new Uint8Array(32);
      expanded.set(bytes);
      return expanded;
    });
    mockPoseidonHasher.mockImplementation(
      async ([poseidonPrivateKey, nullifier]: bigint[]) =>
        BigInt(poseidonPrivateKey) + BigInt(nullifier),
    );
    mockPoseidonPrivateKeyDeriver.mockResolvedValue(mockReceiverPoseidonPrivateKey);
    mockEphemeralUtxoPoseidonPrivateKeyDeriver.mockResolvedValue(mockEphemeralPoseidonPrivateKey);
    mockDecodeEncryptedUserAccount.mockImplementation(() => {
      throw new Error('decode not configured');
    });
    mockDecodeEncryptedTokenAccount.mockImplementation(() => {
      throw new Error('decode not configured');
    });
    mockSdkDeps.accountInfoProvider.mockImplementation(async (addresses: readonly string[]) => {
      const accounts = new Map();
      addresses.forEach((address) => {
        accounts.set(address, {
          exists: true,
          data: Uint8Array.of(1),
          programAddress: '11111111111111111111111111111111',
        });
      });
      return accounts;
    });
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
      },
    });
    mockLegacyQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
      },
    });
    mockQueryBalances.mockResolvedValue(new Map());
  });

  it('enforces the Umbra token support matrix', async () => {
    await expect(
      resolveUmbraToken({
        network: 'mainnet',
        token: 'BONK',
        amount: '1',
      }),
    ).rejects.toThrow('do not support this token');

    await expect(
      resolveUmbraToken({
        network: 'mainnet',
        token: 'USDC',
        amount: '1.25',
      }),
    ).resolves.toMatchObject({
      amountAtomic: '1250000',
      amountDisplay: '1.25',
      metadata: {
        symbol: 'USDC',
      },
    });

    await expect(
      resolveUmbraToken({
        network: 'mainnet',
        token: 'wSOL',
        amount: '0.25',
      }),
    ).resolves.toMatchObject({
      amountAtomic: '250000000',
      metadata: {
        symbol: 'wSOL',
      },
    });

    await expect(
      resolveUmbraToken({
        network: 'devnet',
        token: 'USDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({
      amountAtomic: '1000000',
      amountDisplay: '1',
      metadata: {
        symbol: 'dUSDC',
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      },
    });

    await expect(
      resolveUmbraToken({
        network: 'devnet',
        token: 'dUSDT',
        amount: '2.5',
      }),
    ).resolves.toMatchObject({
      amountAtomic: '2500000',
      amountDisplay: '2.5',
      metadata: {
        symbol: 'dUSDT',
        mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
      },
    });
  });

  it('registers encrypted-balance mode without requiring a local ZK prover', async () => {
    mockRegister.mockResolvedValueOnce(['register-x25519-sig']);
    mockQueryUser.mockResolvedValueOnce({ state: 'non_existent' });

    const result = await ensureUmbraEncryptedBalanceRegistration({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
    });

    expect(mockRegister).toHaveBeenCalledWith({
      confidential: true,
      anonymous: false,
    });
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(getUserRegistrationFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.not.objectContaining({
        zkProver: expect.anything(),
      }),
    );
    expect(getLegacyUserRegistrationFunction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'register',
      title: 'Private vault ready',
      signatures: ['register-x25519-sig'],
    });
  });

  it('routes devnet anonymous registration through the current Umbra SDK', async () => {
    mockRegister.mockResolvedValueOnce(['register-anonymous-sig']);
    mockQueryUser.mockResolvedValueOnce({ state: 'non_existent' }).mockResolvedValueOnce({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });

    await expect(
      ensureUmbraMixerRegistration({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
      }),
    ).resolves.toMatchObject({
      mixerRegistered: true,
      signatures: ['register-anonymous-sig'],
      title: 'Private P2P ready',
    });

    expect(mockRegister).toHaveBeenCalledWith({ confidential: true, anonymous: true });
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(getUserRegistrationFunction).toHaveBeenCalled();
    expect(getLegacyUserRegistrationFunction).not.toHaveBeenCalled();
  });

  it('rejects encrypted-balance setup when no transaction was submitted and on-chain setup is missing', async () => {
    mockRegister.mockResolvedValueOnce([]);
    mockQueryUser.mockResolvedValue({ state: 'non_existent' });

    await expect(
      ensureUmbraEncryptedBalanceRegistration({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('did not submit a transaction');

    expect(mockRegister).toHaveBeenCalledWith({
      confidential: true,
      anonymous: false,
    });
    expect(mockLegacyRegister).not.toHaveBeenCalled();
  });

  it('rejects encrypted-balance setup when the submitted signature is not visible on-chain', async () => {
    mockRegister.mockResolvedValueOnce(['missing-setup-sig']);
    mockQueryUser.mockResolvedValueOnce({ state: 'non_existent' });
    mockGetRpcSignatureStatuses.mockResolvedValue({ statuses: [null] });

    await expect(
      ensureUmbraEncryptedBalanceRegistration({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('Refresh vault and retry if unchanged');
  });

  it('rejects encrypted-balance setup when the submitted transaction failed on-chain', async () => {
    mockRegister.mockResolvedValueOnce(['failed-setup-sig']);
    mockQueryUser.mockResolvedValueOnce({ state: 'non_existent' });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        {
          slot: 1,
          confirmations: 1,
          err: { InstructionError: [0, { Custom: 9999 }] },
          confirmationStatus: 'confirmed',
        },
      ],
    });

    await expect(
      ensureUmbraEncryptedBalanceRegistration({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('Rejected on-chain');
  });

  it('treats an Arcium 6204 duplicate-callback race as a successful setup', async () => {
    // The MPC cluster occasionally lands two CallbackComputation txs in the same
    // slot. The first succeeds, the second fails with Custom(6204). The flow
    // should still surface the computation as successful because the on-chain
    // callback already ran on the first landing.
    mockRegister.mockResolvedValueOnce(['queue-sig', 'callback-sig']);
    mockQueryUser.mockResolvedValueOnce({ state: 'non_existent' });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        {
          slot: 1,
          confirmations: 1,
          err: null,
          confirmationStatus: 'confirmed',
        },
        {
          slot: 1,
          confirmations: 1,
          err: { InstructionError: [1, { Custom: 6204 }] },
          confirmationStatus: 'confirmed',
        },
      ],
    });
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
      },
    });

    await expect(
      ensureUmbraEncryptedBalanceRegistration({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({
      action: 'register',
      signatures: ['queue-sig', 'callback-sig'],
    });
  });

  it('does not re-register the Umbra X25519 key when the vault is already active', async () => {
    const result = await ensureUmbraEncryptedBalanceRegistration({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
    });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'register',
      signatures: [],
      vaultCanShield: true,
    });
  });

  it('treats an Arcium 6204 duplicate-callback race as a successful shield', async () => {
    // Same Arcium-cluster race condition the registration flow already handles,
    // but for shielding into the encrypted balance. The SDK reports the queue
    // tx + the winning callback sig; the losing callback (Custom(6204)) lands
    // on-chain too and would surface in the signature-statuses scan.
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'shield-ok-callback-sig',
    });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        { slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' },
        { slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' },
        // Hypothetical "loser" callback that bubbled up in the result blob.
        {
          slot: 1,
          confirmations: 1,
          err: { InstructionError: [1, { Custom: 6204 }] },
          confirmationStatus: 'confirmed',
        },
      ],
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({ action: 'shield' });
  });

  it('treats an Arcium 6204 duplicate-callback race as a successful withdraw', async () => {
    mockUnshield.mockResolvedValueOnce({
      queueSignature: 'withdraw-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'withdraw-ok-callback-sig',
    });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        { slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' },
        { slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' },
        {
          slot: 1,
          confirmations: 1,
          err: { InstructionError: [1, { Custom: 6204 }] },
          confirmationStatus: 'confirmed',
        },
      ],
    });

    await expect(
      withdrawTokenFromUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({ action: 'unshield' });
  });

  it('accepts the current Umbra SDK nested callback finalization result', async () => {
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
      callback: {
        status: 'finalized',
        signature: 'shield-callback-sig',
      },
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({
      action: 'shield',
      signatures: ['shield-queue-sig', 'shield-callback-sig'],
    });

    expect(mockGetRpcSignatureStatuses).toHaveBeenCalledWith({
      network: 'mainnet',
      signatures: ['shield-queue-sig', 'shield-callback-sig'],
    });
  });

  it('routes devnet direct shield through the current Umbra SDK', async () => {
    mockAssertUmbraVaultFeeAccountsReady.mockResolvedValueOnce({
      available: true,
      checkedAccounts: [],
      message: null,
      missingAccounts: [],
      protocolVersion: 'current',
      protocolVersions: [
        { available: true, checkedAccounts: [], missingAccounts: [], protocolVersion: 'current' },
      ],
    });
    mockShield.mockResolvedValueOnce({
      queueSignature: 'devnet-shield-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'devnet-shield-callback-sig',
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: 'dUSDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({
      action: 'shield',
      signatures: ['devnet-shield-queue-sig', 'devnet-shield-callback-sig'],
    });
    expect(mockShield).toHaveBeenCalled();
    expect(mockLegacyShield).not.toHaveBeenCalled();
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'shield',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
  });

  it('uses current direct shield on mainnet when both protocol fee account sets exist', async () => {
    mockAssertUmbraVaultFeeAccountsReady.mockResolvedValueOnce({
      available: true,
      checkedAccounts: [],
      message: null,
      missingAccounts: [],
      protocolVersion: 'current',
      protocolVersions: [
        { available: true, checkedAccounts: [], missingAccounts: [], protocolVersion: 'current' },
        { available: true, checkedAccounts: [], missingAccounts: [], protocolVersion: 'legacy' },
      ],
    });
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'shield-callback-sig',
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({
      action: 'shield',
      signatures: ['shield-queue-sig', 'shield-callback-sig'],
    });
    expect(mockShield).toHaveBeenCalled();
    expect(mockMarkUmbraProtocolVersionUnsupported).not.toHaveBeenCalled();
    expect(mockLegacyShield).not.toHaveBeenCalled();
  });

  it('routes devnet direct withdraw through the current Umbra SDK', async () => {
    mockAssertUmbraVaultFeeAccountsReady.mockResolvedValueOnce({
      available: true,
      checkedAccounts: [],
      message: null,
      missingAccounts: [],
      protocolVersion: 'current',
      protocolVersions: [
        { available: true, checkedAccounts: [], missingAccounts: [], protocolVersion: 'current' },
      ],
    });
    mockUnshield.mockResolvedValueOnce({
      queueSignature: 'devnet-withdraw-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'devnet-withdraw-callback-sig',
    });

    await expect(
      withdrawTokenFromUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: 'dUSDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({
      action: 'unshield',
      signatures: ['devnet-withdraw-queue-sig', 'devnet-withdraw-callback-sig'],
    });
    expect(mockUnshield).toHaveBeenCalled();
    expect(mockLegacyUnshield).not.toHaveBeenCalled();
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'withdraw',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
  });

  it('treats stringified Arcium 6204 errors as benign duplicate-callback races', async () => {
    // Some upstream paths bubble the Arcium error up as an opaque string instead
    // of a structured InstructionError. The carve-out should still match the
    // human-readable AnchorError message and the 0x183c hex code.
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-q',
      callbackStatus: 'finalized',
      callbackSignature: 'shield-cb',
    });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        { slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' },
        { slot: 1, confirmations: 1, err: null, confirmationStatus: 'confirmed' },
        {
          slot: 1,
          confirmations: 1,
          err: 'Program failed to complete: custom program error: 0x183c',
          confirmationStatus: 'confirmed',
        },
      ],
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).resolves.toMatchObject({ action: 'shield' });
  });

  it('sends public-balance private P2P without re-running anonymous sender setup when active', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockCreatePublicReceiverUtxo.mockResolvedValueOnce({
      createProofAccountSignature: 'create-proof-sig',
      createUtxoSignature: 'create-utxo-sig',
    });

    const result = await sendUmbraPrivateP2PFromPublicBalance({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      token: 'dUSDC',
      amount: '1',
      recipient: mockRecipientAddress,
    });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'privateP2pFromPublic',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
    expect(getPublicBalanceToReceiverClaimableUtxoCreatorFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.objectContaining({
        rpc: expect.objectContaining({
          transactionForwarder: expect.objectContaining({
            fireAndForget: mockSdkDeps.transactionForwarder.fireAndForget,
          }),
        }),
      }),
    );
    const publicP2PForwarder = (
      getPublicBalanceToReceiverClaimableUtxoCreatorFunction.mock.calls[0]?.[1] as {
        rpc?: { transactionForwarder?: typeof mockSdkDeps.transactionForwarder };
      }
    ).rpc?.transactionForwarder;
    expect(publicP2PForwarder).not.toBe(mockSdkDeps.transactionForwarder);
    expect(publicP2PForwarder?.forwardSequentially).not.toBe(
      mockSdkDeps.transactionForwarder.forwardSequentially,
    );
    expect(getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction).not.toHaveBeenCalled();
    expect(mockCreatePublicReceiverUtxo).toHaveBeenCalledWith(
      {
        amount: 1000000n,
        destinationAddress: mockRecipientAddress,
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      },
      {
        optionalData: expect.any(Uint8Array),
      },
    );
    expect(result).toMatchObject({
      action: 'private-p2p',
      p2pSource: 'public-balance',
      primarySignature: 'create-utxo-sig',
      signatures: ['create-proof-sig', 'create-utxo-sig'],
    });
    expect(mockGetRpcSignatureStatuses).not.toHaveBeenCalled();
  });

  it('estimates public-balance private P2P fees from SDK-built transaction messages without broadcasting', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockGetRpcFeeForMessage.mockResolvedValueOnce({ lamports: 5000 }).mockResolvedValueOnce({
      lamports: 7000,
    });
    mockCreatePublicReceiverUtxo.mockImplementationOnce(async () => {
      const publicP2PForwarder = (
        getPublicBalanceToReceiverClaimableUtxoCreatorFunction.mock.calls[0]?.[1] as {
          rpc?: {
            transactionForwarder?: {
              forwardSequentially?: (
                transactions: readonly unknown[],
              ) => Promise<readonly string[]>;
            };
          };
        }
      ).rpc?.transactionForwarder;
      const signatures = await publicP2PForwarder?.forwardSequentially?.([
        { messageBytes: Uint8Array.of(1, 2, 3), signatures: {} },
        { messageBytes: Uint8Array.of(4, 5, 6), signatures: {} },
      ]);

      return {
        createProofAccountSignature: signatures?.[0],
        createUtxoSignature: signatures?.[1],
      };
    });

    const result = await estimateUmbraPrivateP2PFromPublicBalanceFee({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      token: 'dUSDC',
      amount: '1',
      recipient: mockRecipientAddress,
    });

    expect(mockGetRpcFeeForMessage).toHaveBeenCalledTimes(2);
    expect(mockGetRpcFeeForMessage).toHaveBeenNthCalledWith(1, {
      network: 'devnet',
      messageBase64: Buffer.from(Uint8Array.of(1, 2, 3)).toString('base64'),
      signal: undefined,
    });
    expect(mockGetRpcFeeForMessage).toHaveBeenNthCalledWith(2, {
      network: 'devnet',
      messageBase64: Buffer.from(Uint8Array.of(4, 5, 6)).toString('base64'),
      signal: undefined,
    });
    expect(mockSdkDeps.transactionForwarder.fireAndForget).not.toHaveBeenCalled();
    expect(mockSdkDeps.transactionForwarder.forwardSequentially).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      lamports: 12000,
      transactionCount: 2,
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
      protocol: 'current',
    });
  });

  it('accepts a token mint for public-balance private P2P sends', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockCreatePublicReceiverUtxo.mockResolvedValueOnce({
      createProofAccountSignature: 'mint-create-proof-sig',
      createUtxoSignature: 'mint-create-utxo-sig',
    });

    const result = await sendUmbraPrivateP2PFromPublicBalance({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      token: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      amount: '2',
      recipient: mockRecipientAddress,
    });

    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'privateP2pFromPublic',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
    expect(mockCreatePublicReceiverUtxo).toHaveBeenCalledWith(
      {
        amount: 2000000n,
        destinationAddress: mockRecipientAddress,
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      },
      {
        optionalData: expect.any(Uint8Array),
      },
    );
    expect(result).toMatchObject({
      action: 'private-p2p',
      p2pSource: 'public-balance',
      primarySignature: 'mint-create-utxo-sig',
      tokenSymbol: 'dUSDC',
      amountDisplay: '2',
    });
  });

  it('uses a receiver-claimable public-balance UTXO for private sends to the same wallet', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockCreatePublicReceiverUtxo.mockResolvedValueOnce({
      createProofAccountSignature: 'self-receiver-create-proof-sig',
      createUtxoSignature: 'self-receiver-create-utxo-sig',
    });

    const result = await sendUmbraPrivateP2PFromPublicBalance({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      token: 'dUSDC',
      amount: '1',
      recipient: mockWalletAddress,
    });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'privateP2pFromPublic',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
    expect(getPublicBalanceToReceiverClaimableUtxoCreatorFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.objectContaining({
        rpc: expect.objectContaining({
          transactionForwarder: expect.objectContaining({
            fireAndForget: mockSdkDeps.transactionForwarder.fireAndForget,
          }),
        }),
      }),
    );
    const publicP2PForwarder = (
      getPublicBalanceToReceiverClaimableUtxoCreatorFunction.mock.calls[0]?.[1] as {
        rpc?: { transactionForwarder?: typeof mockSdkDeps.transactionForwarder };
      }
    ).rpc?.transactionForwarder;
    expect(publicP2PForwarder).not.toBe(mockSdkDeps.transactionForwarder);
    expect(publicP2PForwarder?.forwardSequentially).not.toBe(
      mockSdkDeps.transactionForwarder.forwardSequentially,
    );
    expect(getPublicBalanceToSelfClaimableUtxoCreatorFunction).not.toHaveBeenCalled();
    expect(getLegacyPublicBalanceToReceiverClaimableUtxoCreatorFunction).not.toHaveBeenCalled();
    expect(getLegacyPublicBalanceToSelfClaimableUtxoCreatorFunction).not.toHaveBeenCalled();
    expect(mockCreatePublicReceiverUtxo).toHaveBeenCalledWith(
      {
        amount: 1000000n,
        destinationAddress: mockWalletAddress,
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      },
      {
        optionalData: expect.any(Uint8Array),
      },
    );
    expect(result).toMatchObject({
      action: 'private-p2p',
      p2pSource: 'public-balance',
      primarySignature: 'self-receiver-create-utxo-sig',
      signatures: ['self-receiver-create-proof-sig', 'self-receiver-create-utxo-sig'],
    });
  });

  it('routes devnet encrypted-balance private P2P through the current Umbra SDK', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockCreateEncryptedReceiverUtxo.mockResolvedValueOnce({
      queueSignature: 'devnet-encrypted-p2p-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'devnet-encrypted-p2p-callback-sig',
    });

    await expect(
      sendUmbraPrivateP2PFromEncryptedBalance({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: 'dUSDC',
        amount: '1',
        recipient: mockRecipientAddress,
      }),
    ).resolves.toMatchObject({
      action: 'private-p2p',
      p2pSource: 'encrypted-balance',
      signatures: ['devnet-encrypted-p2p-queue-sig', 'devnet-encrypted-p2p-callback-sig'],
    });

    expect(mockCreateEncryptedReceiverUtxo).toHaveBeenCalled();
    expect(mockLegacyCreateEncryptedReceiverUtxo).not.toHaveBeenCalled();
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'privateP2pFromEncrypted',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
  });

  it('does not auto-register a devnet sender before public-balance private P2P when setup is not requested', async () => {
    mockQueryUser
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: true,
          isActiveForAnonymousUsage: true,
        },
      })
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: true,
          isActiveForAnonymousUsage: false,
        },
      });
    mockCreatePublicReceiverUtxo.mockResolvedValueOnce({
      createUtxoSignature: 'create-utxo-sig',
    });

    await sendUmbraPrivateP2PFromPublicBalance({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      token: 'dUSDC',
      amount: '1',
      recipient: mockRecipientAddress,
    });

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(getUserRegistrationFunction).not.toHaveBeenCalled();
    expect(getLegacyUserRegistrationFunction).not.toHaveBeenCalled();
    expect(mockCreatePublicReceiverUtxo).toHaveBeenCalled();
    expect(mockLegacyCreatePublicReceiverUtxo).not.toHaveBeenCalled();
  });

  it('auto-registers a devnet sender for public-balance private P2P when setup is requested', async () => {
    mockQueryUser
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: true,
          isActiveForAnonymousUsage: false,
        },
      })
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: true,
          isActiveForAnonymousUsage: false,
        },
      })
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: true,
          isActiveForAnonymousUsage: true,
        },
      });
    mockRegister.mockResolvedValueOnce(['register-anonymous-sig']);
    mockCreatePublicReceiverUtxo.mockResolvedValueOnce({
      createProofAccountSignature: 'create-proof-sig',
      createUtxoSignature: 'create-utxo-sig',
    });

    const result = await sendUmbraPrivateP2PFromPublicBalance({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      token: 'dUSDC',
      amount: '1',
      recipient: mockWalletAddress,
      autoSetupSender: true,
    });

    expect(mockRegister).toHaveBeenCalledWith({ confidential: false, anonymous: true });
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(mockCreatePublicReceiverUtxo).toHaveBeenCalledWith(
      {
        amount: 1000000n,
        destinationAddress: mockWalletAddress,
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      },
      {
        optionalData: expect.any(Uint8Array),
      },
    );
    expect(result).toMatchObject({
      action: 'private-p2p',
      mixerRegistered: true,
      p2pSource: 'public-balance',
      primarySignature: 'create-utxo-sig',
      signatures: ['create-proof-sig', 'create-utxo-sig'],
    });
  });

  it('requires explicit private P2P setup instead of auto-registering during send by default', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: false,
      },
    });

    await expect(
      sendUmbraPrivateP2PFromPublicBalance({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
        recipient: mockWalletAddress,
      }),
    ).rejects.toThrow('Set up Umbra private P2P before sending');

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(mockCreatePublicSelfUtxo).not.toHaveBeenCalled();
    expect(mockLegacyCreatePublicSelfUtxo).not.toHaveBeenCalled();
  });

  it('fails public-balance private P2P fast when the receiver has not set up Umbra P2P', async () => {
    mockQueryUser
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: false,
          isActiveForAnonymousUsage: false,
        },
      })
      .mockResolvedValueOnce({
        state: 'exists',
        data: {
          isInitialised: true,
          isUserAccountX25519KeyRegistered: true,
          isUserCommitmentRegistered: true,
          isActiveForAnonymousUsage: true,
        },
      });

    await expect(
      sendUmbraPrivateP2PFromPublicBalance({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: 'dUSDC',
        amount: '1',
        recipient: mockRecipientAddress,
      }),
    ).rejects.toThrow('Recipient has not set up Umbra private P2P yet');

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLegacyRegister).not.toHaveBeenCalled();
    expect(mockCreatePublicReceiverUtxo).not.toHaveBeenCalled();
    expect(mockLegacyCreatePublicReceiverUtxo).not.toHaveBeenCalled();
  });

  it('bounds default Umbra claim scans to the recent wallet-key decrypt window', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockClaimableScanner.mockImplementationOnce(async () => {
      const client = mockClaimableScannerArgs?.client as
        | {
            fetchTreeSummary?: () => Promise<readonly { treeIndex: bigint; numLeaves: bigint }[]>;
            utxoDataStore?: {
              getScanProgress: (
                network: string,
                signerAddress: string,
                treeIndex: bigint,
              ) => Promise<{ ranges: readonly { start: bigint; end: bigint }[] } | null>;
            };
          }
        | undefined;
      await expect(client?.fetchTreeSummary?.()).resolves.toEqual([
        { treeIndex: 0n, numLeaves: 1000n },
      ]);
      await expect(
        client?.utxoDataStore?.getScanProgress('devnet', mockWalletAddress, 0n),
      ).resolves.toEqual({
        ranges: [{ start: 0n, end: 615n }],
        highWaterMark: 615n,
      });
      const fetchUtxoData = mockClaimableScannerDeps?.fetchUtxoData as
        | ((start: bigint, end?: bigint, limit?: bigint) => Promise<unknown>)
        | undefined;
      await fetchUtxoData?.(616n, 999n, 1000n);

      return {
        selfBurnable: [],
        received: [],
        publicSelfBurnable: [],
        publicReceived: [],
        nextScanStartIndex: 0n,
      };
    });

    await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
    });

    expect(mockGetUmbraUtxos).toHaveBeenCalledWith({
      network: 'devnet',
      start: '616',
      end: '999',
      limit: '384',
    });
  });

  it('uses exact insertion ranges when the claim scan is seeded by pending indices', async () => {
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockImplementationOnce(async () => {
      const client = mockClaimableScannerArgs?.client as
        | {
            fetchTreeSummary?: () => Promise<readonly { treeIndex: bigint; numLeaves: bigint }[]>;
            utxoDataStore?: {
              getScanProgress: (
                network: string,
                signerAddress: string,
                treeIndex: bigint,
              ) => Promise<{ ranges: readonly { start: bigint; end: bigint }[] } | null>;
            };
          }
        | undefined;
      await expect(client?.fetchTreeSummary?.()).resolves.toEqual([
        { treeIndex: 0n, numLeaves: 778n },
      ]);
      await expect(
        client?.utxoDataStore?.getScanProgress('devnet', mockWalletAddress, 0n),
      ).resolves.toEqual({
        ranges: [{ start: 0n, end: 776n }],
        highWaterMark: 776n,
      });
      const fetchUtxoData = mockClaimableScannerDeps?.fetchUtxoData as
        | ((start: bigint, end?: bigint, limit?: bigint) => Promise<unknown>)
        | undefined;
      await fetchUtxoData?.(777n, 777n, 1000n);

      return {
        selfBurnable: [],
        received: [],
        publicSelfBurnable: [],
        publicReceived: [],
        nextScanStartIndex: 778n,
      };
    });

    await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      startInsertionIndex: 777,
      endInsertionIndex: 777,
    });

    expect(mockGetUmbraUtxos).toHaveBeenCalledWith({
      network: 'devnet',
      start: '777',
      end: '777',
      limit: '384',
    });
  });

  it('normalizes current indexer columnar UTXO values before scanning claims', async () => {
    configureRegisteredUmbraVault();
    let fetchedResult:
      | {
          items: Map<
            bigint,
            {
              absoluteIndex: bigint;
              treeIndex: bigint;
              insertionIndex: bigint;
              h1Components: {
                version: bigint;
                commitmentIndex: bigint;
                relayerFixedSolFees: bigint;
                poolVolumeSpl: bigint;
                poolVolumeSol: bigint;
                timestamp: {
                  year: bigint;
                  month: bigint;
                  day: bigint;
                  hour: bigint;
                  minute: bigint;
                  second: bigint;
                };
              };
              timestamp: bigint;
              slot: bigint;
            }
          >;
        }
      | undefined;

    mockGetUmbraUtxos.mockResolvedValueOnce({
      network: 'devnet',
      utxos: [
        {
          absolute_index: '0',
          tree_index: '0',
          insertion_index: '42',
          final_commitment: makeBase64(makeU256LeBytes(101n)),
          h1_version: makeBase64(makeU128LeBytes(1)),
          h1_commitment_index: makeBase64(makeU128LeBytes(42)),
          h1_sender_address: makeBase64(bs58.decode(mockWalletAddress)),
          h1_mint_address: makeBase64(bs58.decode(mockRecipientAddress)),
          h1_relayer_fixed_sol_fees: '17',
          h1_year: '2026',
          h1_month: '5',
          h1_day: '31',
          h1_hour: '8',
          h1_minute: '9',
          h1_second: '10',
          h1_pool_volume_spl: '5000000',
          h1_pool_volume_sol: '7000',
          h1_hash: makeBase64(makeU256LeBytes(102n)),
          h2_hash: makeBase64(makeU256LeBytes(103n)),
          aes_encrypted_data: makeBase64(Uint8Array.of(1, 2, 3, 4)),
          depositor_x25519_public_key: makeBase64(
            Uint8Array.from({ length: 32 }, (_, index) => index),
          ),
          timestamp: '1780000000',
          slot: '12345',
          event_type: 'deposit',
        },
      ],
      cursor: null,
      hasMore: false,
      totalCount: '1',
      startIndex: '0',
      endIndex: '42',
      highestIndexedInsertionIndex: '42',
      fetchedAt: new Date(0).toISOString(),
    });
    mockClaimableScanner.mockImplementationOnce(async () => {
      const fetchUtxoData = mockClaimableScannerDeps?.fetchUtxoData as
        | ((start: bigint, end?: bigint, limit?: bigint) => Promise<typeof fetchedResult>)
        | undefined;
      fetchedResult = await fetchUtxoData?.(0n, 42n, 10n);
      return {
        selfBurnable: [],
        received: [],
        publicSelfBurnable: [],
        publicReceived: [],
        nextScanStartIndex: 0n,
      };
    });

    await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
    });

    const item = fetchedResult?.items.get(42n);
    expect(item?.absoluteIndex).toBe(0n);
    expect(item?.treeIndex).toBe(0n);
    expect(item?.insertionIndex).toBe(42n);
    expect(item?.h1Components.version).toBe(1n);
    expect(item?.h1Components.commitmentIndex).toBe(42n);
    expect(item?.h1Components.relayerFixedSolFees).toBe(17n);
    expect(item?.h1Components.poolVolumeSpl).toBe(5_000_000n);
    expect(item?.h1Components.poolVolumeSol).toBe(7_000n);
    expect(item?.h1Components.timestamp.year).toBe(2026n);
    expect(item?.timestamp).toBe(1_780_000_000n);
    expect(item?.slot).toBe(12_345n);
  });

  it('filters scan results by excludedInsertionIndices so locally-claimed UTXOs are not re-surfaced', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockClaimableScanner.mockResolvedValueOnce({
      selfBurnable: [],
      received: [
        { insertionIndex: 1106n, encryptedAmount: '0xabc' },
        { insertionIndex: 2042n, encryptedAmount: '0xdef' },
      ],
      publicSelfBurnable: [{ insertionIndex: '777', encryptedAmount: '0x111' }],
      publicReceived: [],
      nextScanStartIndex: 0n,
    });

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: new Set<number>([1106, 777]),
    });

    expect(result.pendingClaimCount).toBe(1);
    expect(result.action).toBe('claim');
  });

  it('treats an empty exclusion set as a no-op for scanUmbraPrivateP2PClaims', async () => {
    mockQueryUser.mockResolvedValue({
      state: 'exists',
      data: {
        isInitialised: true,
        isUserAccountX25519KeyRegistered: true,
        isUserCommitmentRegistered: true,
        isActiveForAnonymousUsage: true,
      },
    });
    mockClaimableScanner.mockResolvedValueOnce({
      selfBurnable: [],
      received: [{ insertionIndex: 1106n }, { insertionIndex: 2042n }],
      publicSelfBurnable: [],
      publicReceived: [],
      nextScanStartIndex: 0n,
    });

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: [],
    });

    expect(result.pendingClaimCount).toBe(2);
  });

  it('surfaces pending claims from current SDK v5 scanner buckets', async () => {
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValueOnce({
      etaToStealthPoolReceiverBurnable: [makeClaimableUtxo(3101, 31)],
      ataToStealthPoolReceiverBurnable: [makeClaimableUtxo(3102, 32)],
      networkBalanceToStealthPoolReceiverBurnableWithEncryptedAddress: [
        makeClaimableUtxo(3103, 33),
      ],
      etaToStealthPoolSelfBurnable: [makeClaimableUtxo(3104, 34)],
      ataToStealthPoolSelfBurnable: [makeClaimableUtxo(3105, 35)],
      networkBalanceToStealthPoolSelfBurnableWithEncryptedAddress: [makeClaimableUtxo(3106, 36)],
      scannedTrees: [
        {
          treeIndex: 0n,
          scannedRange: { start: 0n, end: 3106n },
          totalLeaves: 3107n,
          fullyScanned: true,
        },
      ],
    });

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: [],
    });

    expect(result.pendingClaimCount).toBe(6);
    expect(result.pendingClaimUtxoInsertionIndices).toEqual([3101, 3102, 3103, 3104, 3105, 3106]);
    expect(result.pendingClaimUtxoDetails).toHaveLength(6);
  });

  it('injects a yielding aesDecryptor into the SDK claim scanner', async () => {
    // The scanner decrypts every note synchronously per scheme; the OffPay
    // adapter must hand it an async `aesDecryptor` that yields to the UI
    // thread so a large window cannot freeze the JS thread. We only assert the
    // dependency is wired (an async function), not its internal scheduling.
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValueOnce({
      selfBurnable: [],
      received: [],
      publicSelfBurnable: [],
      publicReceived: [],
      nextScanStartIndex: 0n,
    });

    await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: [],
    });

    const deps = mockClaimableScannerDeps as { aesDecryptor?: unknown } | null;
    expect(typeof deps?.aesDecryptor).toBe('function');
  });

  it('passes the matched legacy master-seed scheme into receiver claim generation', async () => {
    const claimableIndex = 7001;
    const currentTokenKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const legacyTokenKey = Uint8Array.from({ length: 32 }, (_, index) => index + 101);
    const mockReceiverClaim = jest.fn(async () => ({
      batches: new Map([
        [
          0,
          {
            status: 'completed',
            stealthPoolNoteIds: [`0:${claimableIndex}`],
          },
        ],
      ]),
      signatures: ['claim-sig'],
    }));

    Object.assign(mockClient, {
      masterSeedSchemes: [{ id: 'current' }, { id: 'v4' }],
      getSchemeMasterSeed: jest.fn(async (schemeId: string) =>
        Uint8Array.from({ length: 64 }, (_, index) =>
          index === 0 && schemeId === 'v4' ? 4 : index,
        ),
      ),
    });
    mockDecodeEncryptedUserAccount.mockReturnValue({
      exists: true,
      data: {
        statusBits: {
          first: 1n << 4n,
        },
        x25519PublicKeyForTokenEncryption: {
          first: legacyTokenKey,
        },
      },
    });
    getUserAccountX25519KeypairDeriver.mockImplementation(
      ({ client }: { client: { masterSeed?: { getMasterSeed: () => Promise<Uint8Array> } } }) =>
        async () => {
          const seed = await client.masterSeed?.getMasterSeed();
          return {
            ed25519Keypair: {
              seed: new Uint8Array(32),
              publicKey: new Uint8Array(32),
            },
            x25519Keypair: {
              privateKey: new Uint8Array(32),
              publicKey: seed?.[0] === 4 ? legacyTokenKey : currentTokenKey,
            },
          };
        },
    );
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValueOnce(makeClaimableScanResult([claimableIndex]));
    getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction.mockReturnValueOnce(
      mockReceiverClaim,
    );

    await claimUmbraPrivateP2PToEncryptedBalance({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      startInsertionIndex: claimableIndex,
      endInsertionIndex: claimableIndex,
      excludedInsertionIndices: [],
    });

    expect(getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.any(Object),
        masterSeedSchemeId: 'v4',
      }),
      expect.any(Object),
    );
    expect(mockReceiverClaim).toHaveBeenCalledWith(
      [expect.objectContaining({ insertionIndex: BigInt(claimableIndex) })],
      expect.any(Uint8Array),
    );
    expect(getSelfClaimableUtxoToEncryptedBalanceClaimerFunction).not.toHaveBeenCalled();
  });

  it('keeps all master-seed schemes for pending P2P scans when scheme probing fails', async () => {
    const claimableIndex = 7101;
    const tokenKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    Object.assign(mockClient, {
      masterSeedSchemes: [{ id: 'current' }, { id: 'v4' }],
    });
    mockDecodeEncryptedUserAccount.mockReturnValue({
      exists: true,
      data: {
        statusBits: {
          first: 1n << 4n,
        },
        x25519PublicKeyForTokenEncryption: {
          first: tokenKey,
        },
      },
    });
    mockUserAccountX25519KeypairDeriver.mockRejectedValueOnce(
      new TypeError('undefined is not a function'),
    );
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValueOnce(makeClaimableScanResult([claimableIndex]));

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: [],
    });
    const scanClient = mockClaimableScannerArgs?.client as
      | { masterSeedSchemes?: readonly { id: string }[] }
      | undefined;

    expect(scanClient?.masterSeedSchemes).toEqual([{ id: 'current' }, { id: 'v4' }]);
    expect(result.pendingClaimUtxoInsertionIndices).toContain(claimableIndex);
  });

  it('filters cold-boot scan results by on-chain Umbra nullifier-set membership', async () => {
    const claimedIndex = 4401;
    const unrelatedIndex = 4402;
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValueOnce({
      selfBurnable: [],
      received: [makeClaimableUtxo(claimedIndex, 1), makeClaimableUtxo(unrelatedIndex, 2)],
      publicSelfBurnable: [],
      publicReceived: [],
      nextScanStartIndex: 4403n,
    });
    mockSdkDeps.accountInfoProvider.mockImplementationOnce(async (addresses: readonly string[]) => {
      const accounts = new Map();
      addresses.forEach((address) => {
        accounts.set(address, {
          exists: true,
          data:
            address === addresses[2]
              ? concatBytes(Uint8Array.of(9), makeMockNullifierHash(1), Uint8Array.of(8))
              : Uint8Array.of(0),
          programAddress: mockClient.networkConfig.programId,
        });
      });
      return accounts;
    });

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: [],
    });

    expect(result.pendingClaimUtxoInsertionIndices).toEqual([unrelatedIndex]);
    expect(result.pendingClaimCount).toBe(1);
    const nullifierSetAddresses = mockSdkDeps.accountInfoProvider.mock.calls[0]?.[0] as
      | readonly string[]
      | undefined;
    expect(nullifierSetAddresses).toHaveLength(5);
    expect(new Set(nullifierSetAddresses).size).toBe(5);
  });

  it('does not re-surface a fully claimed Umbra UTXO on cold boot without local MMKV state', async () => {
    const claimedIndex = 5501;
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValueOnce({
      selfBurnable: [],
      received: [makeClaimableUtxo(claimedIndex, 7)],
      publicSelfBurnable: [],
      publicReceived: [],
      nextScanStartIndex: 5502n,
    });
    mockSdkDeps.accountInfoProvider.mockImplementationOnce(async (addresses: readonly string[]) => {
      const accounts = new Map();
      addresses.forEach((address) => {
        accounts.set(address, {
          exists: true,
          data:
            address === addresses[0]
              ? concatBytes(Uint8Array.of(1), makeMockNullifierHash(7), Uint8Array.of(2))
              : Uint8Array.of(0),
          programAddress: mockClient.networkConfig.programId,
        });
      });
      return accounts;
    });

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
    });

    expect(getLatestReceiveExcludedIndices().size).toBe(0);
    expect(result.pendingClaimUtxoInsertionIndices).not.toContain(claimedIndex);
    expect(result.pendingClaimCount).toBe(0);
  });

  it('rejects encrypted-balance setup when the signature landed but the vault account is still missing', async () => {
    mockRegister.mockResolvedValueOnce(['landed-setup-sig']);
    mockQueryUser.mockResolvedValue({ state: 'non_existent' });

    await expect(
      ensureUmbraEncryptedBalanceRegistration({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('not confirmed on-chain');
  }, 10_000);

  it('waits for Arcium callback finalization during direct vault transfers', async () => {
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'shield-callback-sig',
    });
    mockUnshield.mockResolvedValueOnce({
      queueSignature: 'withdraw-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'withdraw-callback-sig',
    });

    const shieldResult = await shieldTokenWithUmbra({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
      token: 'USDC',
      amount: '1',
    });
    const unshieldResult = await withdrawTokenFromUmbra({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
      token: 'USDC',
      amount: '1',
    });

    expect(getPublicBalanceToEncryptedBalanceDirectDepositorFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.objectContaining({
        arcium: {
          awaitComputationFinalization: expect.objectContaining({
            maxSlotWindow: 200,
            safetyTimeoutMs: 120_000,
            reclaimComputationRent: false,
          }),
        },
        rpc: expect.objectContaining({
          transactionForwarder: mockSdkDeps.transactionForwarder,
        }),
      }),
    );
    expect(getLegacyPublicBalanceToEncryptedBalanceDirectDepositorFunction).not.toHaveBeenCalled();
    expect(getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.objectContaining({
        arcium: {
          awaitComputationFinalization: expect.objectContaining({
            maxSlotWindow: 200,
            safetyTimeoutMs: 120_000,
            reclaimComputationRent: false,
          }),
        },
        rpc: expect.objectContaining({
          transactionForwarder: mockSdkDeps.transactionForwarder,
        }),
      }),
    );
    expect(getLegacyEncryptedBalanceToPublicBalanceDirectWithdrawerFunction).not.toHaveBeenCalled();
    expect(mockShield).toHaveBeenCalledWith(
      mockWalletAddress,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      1000000n,
    );
    expect(mockLegacyShield).not.toHaveBeenCalled();
    expect(mockUnshield).toHaveBeenCalledWith(
      mockWalletAddress,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      1000000n,
    );
    expect(mockLegacyUnshield).not.toHaveBeenCalled();
    expect(shieldResult).toMatchObject({
      action: 'shield',
      title: 'Shield complete',
      signatures: ['shield-queue-sig', 'shield-callback-sig'],
    });
    expect(unshieldResult).toMatchObject({
      action: 'unshield',
      title: 'Withdraw complete',
      signatures: ['withdraw-queue-sig', 'withdraw-callback-sig'],
    });
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'shield',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      network: 'mainnet',
    });
    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'withdraw',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      network: 'mainnet',
    });
  });

  it('rejects direct vault transfers when no transaction signature is returned', async () => {
    mockUnshield.mockResolvedValueOnce({});

    await expect(
      withdrawTokenFromUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('Unlock wallet and try again');
  });

  it('rejects direct vault transfers when the submitted signature is not on-chain', async () => {
    mockShield.mockResolvedValueOnce({
      queueSignature: 'missing-shield-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'missing-shield-callback-sig',
    });
    mockGetRpcSignatureStatuses.mockResolvedValue({ statuses: [null] });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('Refresh vault and retry if unchanged');
  });

  it('rejects direct vault transfers when the submitted transaction failed on-chain', async () => {
    mockUnshield.mockResolvedValueOnce({
      queueSignature: 'failed-withdraw-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'failed-withdraw-callback-sig',
    });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        {
          slot: 1,
          confirmations: 1,
          err: { InstructionError: [1, { Custom: 1 }] },
          confirmationStatus: 'confirmed',
        },
        {
          slot: 1,
          confirmations: 1,
          err: null,
          confirmationStatus: 'confirmed',
        },
      ],
    });

    await expect(
      withdrawTokenFromUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('Need SOL for temporary accounts');
  });

  it('does not report shield success when Arcium settlement only timed out', async () => {
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
      callbackStatus: 'timed-out',
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('settlement is still pending');
  });

  it('does not report shield success when Arcium settlement polling is pruned', async () => {
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
      callbackStatus: 'pruned',
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('settlement is still pending');
  });

  it('rejects direct vault transfers when the SDK omits callback finalization entirely', async () => {
    // A queue signature without either the old top-level callback fields or
    // the current nested callback result means the SDK did not report
    // settlement. That must stay a failure.
    mockShield.mockResolvedValueOnce({
      queueSignature: 'shield-queue-sig',
    });

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('Umbra computation did not return a callback finalization result.');
  });

  it('blocks direct vault transfers when Umbra protocol fee accounts are missing', async () => {
    mockAssertUmbraVaultFeeAccountsReady.mockRejectedValueOnce(
      new Error(
        'Umbra vault is not enabled for this token/network yet. A required protocol fee account is missing or has an incompatible layout.',
      ),
    );

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: 'USDC',
        amount: '1',
      }),
    ).rejects.toThrow('protocol fee account is missing or has an incompatible layout');

    expect(mockShield).not.toHaveBeenCalled();
    expect(mockCapturedUmbraSigner).toBeNull();
  });

  it('blocks devnet direct vault transfers before unlocking the wallet when fee accounts are missing', async () => {
    mockAssertUmbraVaultFeeAccountsReady.mockRejectedValueOnce(
      new Error(
        'Umbra vault is not enabled for this token/network yet. A required protocol fee account is missing or has an incompatible layout.',
      ),
    );

    await expect(
      shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: 'dUSDC',
        amount: '1',
      }),
    ).rejects.toThrow('protocol fee account is missing or has an incompatible layout');

    expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
      action: 'shield',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      network: 'devnet',
    });
    expect(mockShield).not.toHaveBeenCalled();
    expect(mockCapturedUmbraSigner).toBeNull();
  });

  it('routes mainnet shield and withdraw for every mainnet Umbra-supported token mint', async () => {
    const tokens = getUmbraSupportedTokens('mainnet');
    mockShield.mockResolvedValue({
      queueSignature: 'shield-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'shield-callback-sig',
    });
    mockUnshield.mockResolvedValue({
      queueSignature: 'withdraw-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'withdraw-callback-sig',
    });

    for (const token of tokens) {
      const amount = token.decimals === 9 ? '0.000000001' : '0.000001';
      await shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: token.symbol,
        amount,
      });
      await withdrawTokenFromUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'mainnet',
        token: token.symbol,
        amount,
      });
    }

    tokens.forEach((token) => {
      expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
        action: 'shield',
        mint: token.mint,
        network: 'mainnet',
      });
      expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
        action: 'withdraw',
        mint: token.mint,
        network: 'mainnet',
      });
    });
    expect(mockShield).toHaveBeenCalledTimes(tokens.length);
    expect(mockUnshield).toHaveBeenCalledTimes(tokens.length);
    expect(mockLegacyShield).not.toHaveBeenCalled();
    expect(mockLegacyUnshield).not.toHaveBeenCalled();
  });

  it('routes devnet shield and withdraw for every devnet Umbra-supported token mint', async () => {
    const tokens = getUmbraSupportedTokens('devnet');
    mockShield.mockResolvedValue({
      queueSignature: 'devnet-shield-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'devnet-shield-callback-sig',
    });
    mockUnshield.mockResolvedValue({
      queueSignature: 'devnet-withdraw-queue-sig',
      callbackStatus: 'finalized',
      callbackSignature: 'devnet-withdraw-callback-sig',
    });

    for (const token of tokens) {
      const amount = token.decimals === 9 ? '0.000000001' : '0.000001';
      await shieldTokenWithUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: token.symbol,
        amount,
      });
      await withdrawTokenFromUmbra({
        walletAddress: mockWalletAddress,
        walletId: 'wallet-1',
        network: 'devnet',
        token: token.symbol,
        amount,
      });
    }

    tokens.forEach((token) => {
      expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
        action: 'shield',
        mint: token.mint,
        network: 'devnet',
      });
      expect(mockAssertUmbraVaultFeeAccountsReady).toHaveBeenCalledWith({
        action: 'withdraw',
        mint: token.mint,
        network: 'devnet',
      });
    });
    expect(mockShield).toHaveBeenCalledTimes(tokens.length);
    expect(mockUnshield).toHaveBeenCalledTimes(tokens.length);
    expect(mockLegacyShield).not.toHaveBeenCalled();
    expect(mockLegacyUnshield).not.toHaveBeenCalled();
  });

  it('returns Umbra vault registration state with encrypted balances', async () => {
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          {
            state: 'shared',
            balance: 1_000_000n,
          },
        ],
      ]),
    );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
      tokens: ['USDC'],
    });

    expect(result).toMatchObject({
      action: 'balance',
      vaultState: 'exists',
      vaultRegistered: true,
      vaultCanShield: true,
      balances: [
        {
          symbol: 'USDC',
          displayBalance: '1',
        },
      ],
    });
  });

  it('falls back to local registration decoding when SDK PDA derivation is unavailable', async () => {
    mockQueryUser.mockRejectedValueOnce(
      new Error('Failed to derive user account PDA: undefined is not a function'),
    );
    mockDecodeEncryptedUserAccount.mockReturnValueOnce({
      exists: true,
      data: {
        statusBits: {
          first: (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 4n),
        },
        x25519PublicKeyForTokenEncryption: {
          first: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
        },
      },
    });
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          {
            state: 'shared',
            balance: 1_000_000n,
          },
        ],
      ]),
    );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC'],
    });

    expect(result).toMatchObject({
      vaultState: 'exists',
      vaultRegistered: true,
      vaultCanShield: true,
      mixerRegistered: true,
    });
    expect(mockQueryBalances).toHaveBeenCalledTimes(1);
    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        state: 'shared',
        displayBalance: '1',
      }),
    ]);
  });

  it('refreshes encrypted balances with the full client when scheme probing fails', async () => {
    const tokenKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    Object.assign(mockClient, {
      masterSeedSchemes: [{ id: 'current' }, { id: 'v4' }],
    });
    mockDecodeEncryptedUserAccount.mockReturnValue({
      exists: true,
      data: {
        statusBits: {
          first: 1n << 4n,
        },
        x25519PublicKeyForTokenEncryption: {
          first: tokenKey,
        },
      },
    });
    mockUserAccountX25519KeypairDeriver.mockRejectedValueOnce(
      new TypeError('undefined is not a function'),
    );
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          {
            state: 'shared',
            balance: 1_000_000n,
          },
        ],
      ]),
    );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC'],
    });

    expect(getEncryptedBalanceQuerierFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.objectContaining({
        accountInfoProvider: mockSdkDeps.accountInfoProvider,
      }),
    );
    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        state: 'shared',
        displayBalance: '1',
      }),
    ]);
  });

  it('tries legacy schemes for encrypted balances when the default scheme key mismatches', async () => {
    Object.assign(mockClient, {
      masterSeedSchemes: [{ id: 'current' }, { id: 'v4' }],
      getSchemeMasterSeed: jest.fn(),
    });
    mockQueryBalances
      .mockRejectedValueOnce(
        new Error('On-chain token encryption X25519 public key does not match locally-derived key'),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
            {
              state: 'shared',
              balance: 2_000_000n,
            },
          ],
        ]),
      );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC'],
    });
    const legacyQueryClient = getEncryptedBalanceQuerierFunction.mock.calls[1]?.[0]?.client as
      | { masterSeed?: { getMasterSeed?: unknown } }
      | undefined;

    expect(getEncryptedBalanceQuerierFunction).toHaveBeenCalledTimes(2);
    expect(legacyQueryClient).not.toBe(mockClient);
    expect(typeof legacyQueryClient?.masterSeed?.getMasterSeed).toBe('function');
    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        state: 'shared',
        displayBalance: '2',
      }),
    ]);
  });

  it('returns devnet Umbra token metadata with encrypted balances', async () => {
    const dusdcMintKey = {
      toString: () => '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
    };
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          dusdcMintKey,
          {
            state: 'shared',
            balance: 1_000_000n,
          },
        ],
        [
          'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
          {
            state: 'non_existent',
          },
        ],
      ]),
    );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC', 'dUSDT'],
    });

    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        displayBalance: '1',
      }),
      expect.objectContaining({
        symbol: 'dUSDT',
        mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
        displayBalance: null,
      }),
    ]);
  });

  it('formats valid SDK U64 balances with the supported token decimals', async () => {
    const sdkBalance = 1_837_000_000n;
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          {
            state: 'shared',
            balance: sdkBalance,
          },
        ],
      ]),
    );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC'],
    });

    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        state: 'shared',
        rawBalance: sdkBalance.toString(),
        displayBalance: '1837',
      }),
    ]);
  });

  it('rejects non-U64 SDK shared balances before token formatting', async () => {
    const invalidSdkBalance = 1n << 80n;
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          {
            state: 'shared',
            balance: invalidSdkBalance,
          },
        ],
      ]),
    );

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC'],
    });

    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        state: 'shared_unreadable',
        rawBalance: null,
        displayBalance: null,
      }),
    ]);
  });

  it('classifies unreadable shared balances with mismatched Umbra account keys', async () => {
    const invalidSdkBalance = 1n << 80n;
    const userTokenKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const tokenAccountKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    mockQueryBalances.mockResolvedValueOnce(
      new Map([
        [
          '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          {
            state: 'shared',
            balance: invalidSdkBalance,
          },
        ],
      ]),
    );
    mockDecodeEncryptedUserAccount.mockReturnValueOnce({
      exists: true,
      data: {
        x25519PublicKeyForTokenEncryption: {
          first: userTokenKey,
        },
      },
    });
    mockDecodeEncryptedTokenAccount.mockReturnValueOnce({
      exists: true,
      data: {
        statusBits: {
          first: 31n,
        },
        x25519PublicKey: {
          first: tokenAccountKey,
        },
      },
    });

    const result = await fetchUmbraEncryptedBalances({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      tokens: ['dUSDC'],
    });

    expect(result.balances).toEqual([
      expect.objectContaining({
        symbol: 'dUSDC',
        state: 'shared_key_mismatch',
        rawBalance: null,
        displayBalance: null,
        unreadableReason: 'key_mismatch',
        encryptionKeyStatus: 'mismatched',
        encryptedUserAccount: expect.any(String),
        encryptedTokenAccount: expect.any(String),
      }),
    ]);
  });

  it('repairs a mismatched encrypted token account by rotating it to the current wallet key', async () => {
    const userTokenKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const oldTokenAccountKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    mockDecodeEncryptedUserAccount.mockReturnValue({
      exists: true,
      data: {
        x25519PublicKeyForTokenEncryption: {
          first: userTokenKey,
        },
      },
    });
    mockDecodeEncryptedTokenAccount
      .mockReturnValueOnce({
        exists: true,
        data: {
          statusBits: {
            first: 31n,
          },
          x25519PublicKey: {
            first: oldTokenAccountKey,
          },
        },
      })
      .mockReturnValueOnce({
        exists: true,
        data: {
          statusBits: {
            first: 31n,
          },
          x25519PublicKey: {
            first: userTokenKey,
          },
        },
      });

    const result = await repairUmbraVaultEncryptionKey({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
      tokens: ['USDC'],
    });

    expect(getMintEncryptionKeyRotatorFunction).toHaveBeenCalledWith(
      { client: mockClient },
      expect.objectContaining({
        keys: expect.objectContaining({
          mintX25519KeypairDeriver: expect.any(Function),
        }),
      }),
    );
    expect(getLegacyMintEncryptionKeyRotatorFunction).not.toHaveBeenCalled();
    expect(getUserAccountX25519KeypairDeriver).toHaveBeenCalledWith({ client: mockClient });
    expect(mockRotateMintKey).toHaveBeenCalledWith(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      expect.any(Uint8Array),
    );
    expect(mockLegacyRotateMintKey).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'repair',
      title: 'Vault key repaired',
      signatures: ['repair-key-sig'],
      tokenSymbol: 'USDC',
    });
  });

  it('does not resurface a claimed Umbra UTXO when the store updates after a stale exclusion set is captured', async () => {
    const claimedIndex = 1106;
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValue(makeClaimableScanResult([claimedIndex]));

    const staleExcludedIndices = getLatestReceiveExcludedIndices();
    markClaimedUmbraIndices([claimedIndex]);

    const staleRescan = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: staleExcludedIndices,
    });
    const fixedRescan = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: getLatestReceiveExcludedIndices(),
    });

    expect(staleRescan.pendingClaimUtxoInsertionIndices).toContain(claimedIndex);
    expect(getClaimedUmbraIndices()).toContain(claimedIndex);
    expect(fixedRescan.pendingClaimUtxoInsertionIndices).not.toContain(claimedIndex);
    expect(fixedRescan.pendingClaimCount).toBe(0);
  });

  it('keeps unrelated Umbra UTXOs pending when only one insertion index is claimed', async () => {
    const claimedIndex = 2207;
    const unrelatedIndex = 2208;
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValue(makeClaimableScanResult([claimedIndex, unrelatedIndex]));
    markClaimedUmbraIndices([claimedIndex]);

    const result = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: getLatestReceiveExcludedIndices(),
    });

    expect(result.pendingClaimUtxoInsertionIndices).toEqual([unrelatedIndex]);
    expect(result.pendingClaimCount).toBe(1);
  });

  it('does not resurface an already-claimed Umbra UTXO after fallback reconciliation marks it locally', async () => {
    const claimedIndex = 3309;
    configureRegisteredUmbraVault();
    mockClaimableScanner.mockResolvedValue(makeClaimableScanResult([claimedIndex]));

    const initialScan = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: getLatestReceiveExcludedIndices(),
    });
    markClaimedUmbraIndices(initialScan.pendingClaimUtxoInsertionIndices ?? []);
    const reconciledScan = await scanUmbraPrivateP2PClaims({
      walletAddress: mockWalletAddress,
      walletId: 'wallet-1',
      network: 'devnet',
      excludedInsertionIndices: getLatestReceiveExcludedIndices(),
    });

    expect(initialScan.pendingClaimUtxoInsertionIndices).toEqual([claimedIndex]);
    expect(getClaimedUmbraIndices()).toContain(claimedIndex);
    expect(reconciledScan.pendingClaimUtxoInsertionIndices).not.toContain(claimedIndex);
    expect(reconciledScan.pendingClaimCount).toBe(0);
  });
});
