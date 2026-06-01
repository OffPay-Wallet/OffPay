const mockBroadcastRawTransaction = jest.fn();
const mockGetRpcAccounts = jest.fn();
const mockGetRpcEpochInfo = jest.fn();
const mockGetRpcLatestBlockhash = jest.fn();
const mockGetRpcSignatureStatuses = jest.fn();
const mockGetRpcSignaturesForAddress = jest.fn();
const mockGetRpcSlot = jest.fn();
const mockGetPrimaryRpcEndpoint = jest.fn<string | null, [string]>(
  (network: string) => `https://${network}.rpc.test`,
);
const mockDefaultCreateRpc = jest.fn();
const mockDefaultCreateRpcSubscriptions = jest.fn();
const mockGetDefaultArciumDeps = jest.fn(() => ({
  clock: { now: jest.fn(() => Date.now()) },
  timers: {
    setTimeout: jest.fn(() => jest.fn()),
    setInterval: jest.fn(() => jest.fn()),
    sleep: jest.fn(),
  },
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
  decoders: {
    decodeComputationAccount: jest.fn(),
    decodeMXEAccount: jest.fn(),
  },
  accountFetcher: {
    fetchEncodedAccount: jest.fn(),
  },
  rpcBuilders: {
    createRpc: mockDefaultCreateRpc,
    createRpcSubscriptions: mockDefaultCreateRpcSubscriptions,
  },
}));
const mockGetPollingComputationMonitor = jest.fn(() => ({
  prepareMonitor: jest.fn(),
}));
const mockGetPollingTransactionForwarder = jest.fn(() => ({
  fireAndForget: jest.fn(),
  forwardInParallel: jest.fn(),
  forwardSequentially: jest.fn(),
}));
const mockGetUmbraClient = jest.fn(async (args, deps) => ({
  ...args,
  ...deps,
}));

jest.mock('@umbra-privacy/sdk/arcium', () => ({
  __esModule: true,
  getDefaultArciumDeps: mockGetDefaultArciumDeps,
  getPollingComputationMonitor: mockGetPollingComputationMonitor,
}));

jest.mock('@umbra-privacy/sdk/solana', () => ({
  __esModule: true,
  getPollingTransactionForwarder: mockGetPollingTransactionForwarder,
  getRpcBlockhashProvider:
    (
      _config: unknown,
      deps: { createRpc: () => { getLatestBlockhash(): { send(): Promise<unknown> } } },
    ) =>
    async () => {
      const response = (await deps.createRpc().getLatestBlockhash().send()) as {
        value: { blockhash: string; lastValidBlockHeight: bigint };
      };
      return response.value;
    },
  getRpcEpochInfoProvider:
    (
      _config: unknown,
      deps: { createRpc: () => { getEpochInfo(): { send(): Promise<unknown> } } },
    ) =>
    async () =>
      deps.createRpc().getEpochInfo().send(),
}));

jest.mock('@umbra-privacy/sdk/client', () => ({
  __esModule: true,
  getUmbraClient: mockGetUmbraClient,
}));

jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  broadcastRawTransaction: mockBroadcastRawTransaction,
  getRpcAccounts: mockGetRpcAccounts,
  getRpcEpochInfo: mockGetRpcEpochInfo,
  getRpcLatestBlockhash: mockGetRpcLatestBlockhash,
  getRpcSignatureStatuses: mockGetRpcSignatureStatuses,
  getRpcSignaturesForAddress: mockGetRpcSignaturesForAddress,
  getRpcSlot: mockGetRpcSlot,
}));

jest.mock('@/services/rpc', () => ({
  __esModule: true,
  getPrimaryRpcEndpoint: mockGetPrimaryRpcEndpoint,
}));

const {
  createOffpaySolanaRpcFactory,
  createOffpayUmbraClient,
  createOffpayUmbraAccountInfoProvider,
  createOffpayUmbraSdkDeps,
  __clearOffpayUmbraProtocolVersionCacheForTesting,
  deriveUmbraProtocolFeeAccounts,
  markOffpayUmbraProtocolVersionUnsupported,
  verifyOffpayUmbraVaultFeeAccountReadiness,
  verifyOffpayUmbraRpcReadiness,
} = require('@/lib/umbra/umbra-offpay-providers') as typeof import('@/lib/umbra/umbra-offpay-providers');

const TEST_ADDRESS = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';
const TEST_OWNER = '11111111111111111111111111111111';
const MAINNET_UMBRA_PROGRAM_ID = 'UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh';
const DEVNET_UMBRA_PROGRAM_ID = 'DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ';
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEVNET_DUSDC_MINT = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';
const FEE_SCHEDULE_DISCRIMINATOR = Uint8Array.from([250, 80, 88, 27, 206, 216, 50, 199]);
const FEE_VAULT_DISCRIMINATOR = Uint8Array.from([192, 178, 69, 232, 58, 149, 157, 132]);
const FEE_SCHEDULE_SIZE = 157;
const FEE_VAULT_SIZE = 396;

function feeAccountData(kind: 'feeSchedule' | 'feeVault', size?: number): string {
  const discriminator =
    kind === 'feeSchedule' ? FEE_SCHEDULE_DISCRIMINATOR : FEE_VAULT_DISCRIMINATOR;
  const data = new Uint8Array(
    size ?? (kind === 'feeSchedule' ? FEE_SCHEDULE_SIZE : FEE_VAULT_SIZE),
  );
  data.set(discriminator);

  return Buffer.from(data).toString('base64');
}

function feeAccountRecord(
  account: { address: string; kind: 'feeSchedule' | 'feeVault' },
  owner: string,
  size?: number,
) {
  return {
    pubkey: account.address,
    data: feeAccountData(account.kind, size),
    owner,
    lamports: '1',
    executable: false,
    rentEpoch: null,
  };
}

describe('umbra-offpay-providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __clearOffpayUmbraProtocolVersionCacheForTesting();
    mockGetPrimaryRpcEndpoint.mockImplementation(
      (network: string) => `https://${network}.rpc.test`,
    );
  });

  it('allows Umbra provider setup on supported backend networks', () => {
    expect(() => createOffpayUmbraAccountInfoProvider('mainnet')).not.toThrow();
    expect(() => createOffpaySolanaRpcFactory('mainnet')).not.toThrow();
    expect(() => createOffpayUmbraAccountInfoProvider('devnet')).not.toThrow();
    expect(() => createOffpaySolanaRpcFactory('devnet')).not.toThrow();
  });

  it('registers Umbra legacy master-seed schemes for existing on-chain accounts', async () => {
    await createOffpayUmbraClient({
      signer: { address: TEST_ADDRESS } as never,
      network: 'devnet',
    });

    const clientArgs = mockGetUmbraClient.mock.calls[0]?.[0] as {
      legacyMasterSeedSchemes?: Array<{ id: string }>;
      signSchemeMessages?: string;
    };
    expect(clientArgs.signSchemeMessages).toBe('deferred');
    expect(clientArgs.legacyMasterSeedSchemes?.map((scheme) => scheme.id)).toEqual([
      'v4',
      'v2',
      'v1',
    ]);
  });

  it('maps backend account records into SDK account info results', async () => {
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [
        {
          pubkey: TEST_ADDRESS,
          data: Buffer.from([1, 2, 3]).toString('base64'),
          owner: TEST_OWNER,
          lamports: '7',
          executable: false,
          rentEpoch: null,
        },
        null,
      ],
    });

    const provider = createOffpayUmbraAccountInfoProvider('mainnet');
    const result = await provider([TEST_ADDRESS as never, TEST_OWNER as never]);

    expect(result.get(TEST_ADDRESS as never)).toMatchObject({
      exists: true,
      lamports: 7n,
      programAddress: TEST_OWNER,
      space: 3n,
    });
    expect(result.get(TEST_OWNER as never)).toMatchObject({
      exists: false,
    });
    expect(mockGetRpcAccounts).toHaveBeenCalledWith({
      addresses: [TEST_ADDRESS, TEST_OWNER],
      network: 'mainnet',
    });
  });

  it('routes SDK RPC dependency calls through OffPay client helpers', async () => {
    mockGetRpcLatestBlockhash.mockResolvedValueOnce({
      blockhash: 'blockhash-1',
      lastValidBlockHeight: 99,
    });
    mockGetRpcEpochInfo.mockResolvedValueOnce({
      epoch: 3,
      slotIndex: 4,
      slotsInEpoch: 432000,
      absoluteSlot: 12345,
      blockHeight: 11111,
      transactionCount: 222,
    });

    const deps = createOffpayUmbraSdkDeps('mainnet');

    await expect(deps.blockhashProvider()).resolves.toEqual({
      blockhash: 'blockhash-1',
      lastValidBlockHeight: 99n,
    });
    await expect(deps.epochInfoProvider()).resolves.toMatchObject({
      epoch: 3n,
      slotIndex: 4n,
      slotsInEpoch: 432000n,
      absoluteSlot: 12345n,
      blockHeight: 11111n,
      transactionCount: 222n,
    });
    expect(mockGetPollingComputationMonitor).toHaveBeenCalledWith(
      { rpcUrl: 'https://mainnet.rpc.test' },
      expect.objectContaining({
        rpcBuilders: expect.objectContaining({
          createRpc: expect.any(Function),
          createRpcSubscriptions: mockDefaultCreateRpcSubscriptions,
        }),
      }),
    );
    const arciumDeps = (mockGetPollingComputationMonitor.mock.calls[0] as unknown[])[1] as {
      rpcBuilders: { createRpc: unknown };
    };
    expect(arciumDeps.rpcBuilders.createRpc).not.toBe(mockDefaultCreateRpc);

    const baseForwarder = mockGetPollingTransactionForwarder.mock.results[0]?.value as {
      forwardInParallel: jest.Mock;
      forwardSequentially: jest.Mock;
    };
    await deps.transactionForwarder.forwardSequentially(['tx-1'] as never);
    await deps.transactionForwarder.forwardInParallel(['tx-2'] as never);
    expect(baseForwarder.forwardSequentially).toHaveBeenCalledWith(['tx-1'], { maxRetries: 1 });
    expect(baseForwarder.forwardInParallel).toHaveBeenCalledWith(['tx-2'], { maxRetries: 1 });
  });

  it('fails Umbra SDK setup clearly when no client RPC endpoint is configured', () => {
    mockGetPrimaryRpcEndpoint.mockReturnValueOnce(null);

    expect(() => createOffpayUmbraSdkDeps('devnet')).toThrow(
      'Umbra devnet execution needs a configured Solana RPC endpoint.',
    );
  });

  it('routes devnet SDK RPC dependency calls through devnet OffPay client helpers', async () => {
    mockGetRpcLatestBlockhash.mockResolvedValueOnce({
      blockhash: 'devnet-blockhash-1',
      lastValidBlockHeight: 199,
    });
    mockGetRpcEpochInfo.mockResolvedValueOnce({
      epoch: 13,
      slotIndex: 14,
      slotsInEpoch: 432000,
      absoluteSlot: 22345,
      blockHeight: 21111,
      transactionCount: 322,
    });

    const deps = createOffpayUmbraSdkDeps('devnet');

    await expect(deps.blockhashProvider()).resolves.toEqual({
      blockhash: 'devnet-blockhash-1',
      lastValidBlockHeight: 199n,
    });
    await expect(deps.epochInfoProvider()).resolves.toMatchObject({
      epoch: 13n,
      slotIndex: 14n,
      slotsInEpoch: 432000n,
      absoluteSlot: 22345n,
      blockHeight: 21111n,
      transactionCount: 322n,
    });
    expect(mockGetRpcLatestBlockhash).toHaveBeenCalledWith('devnet');
    expect(mockGetRpcEpochInfo).toHaveBeenCalledWith('devnet');
  });

  it('exposes the Solana RPC facade needed by polling monitors and forwarders', async () => {
    mockGetRpcSlot.mockResolvedValueOnce({ slot: 42 });
    mockBroadcastRawTransaction.mockResolvedValueOnce({ signature: 'sig-1' });
    mockGetRpcSignatureStatuses.mockResolvedValueOnce({
      statuses: [
        {
          slot: 43,
          confirmations: null,
          err: null,
          confirmationStatus: 'confirmed',
        },
      ],
    });
    mockGetRpcSignaturesForAddress.mockResolvedValueOnce({
      signatures: [
        {
          signature: 'sig-2',
          slot: 44,
          err: null,
          confirmationStatus: 'finalized',
        },
      ],
    });

    const rpc = (
      createOffpaySolanaRpcFactory('mainnet') as never as () => {
        getSlot(): { send(): Promise<bigint> };
        sendTransaction(
          raw: string,
          options?: {
            skipPreflight?: boolean;
            maxRetries?: number;
            preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
          },
        ): { send(): Promise<string> };
        getSignatureStatuses(signatures: string[]): {
          send(): Promise<{ value: Array<{ slot: bigint | null }> }>;
        };
        getSignaturesForAddress(
          address: string,
          options: { limit: number },
        ): {
          send(): Promise<Array<{ signature: string; slot: bigint }>>;
        };
      }
    )();

    await expect(rpc.getSlot().send()).resolves.toBe(42n);
    await expect(
      rpc
        .sendTransaction('raw-tx', {
          skipPreflight: true,
          maxRetries: 1,
          preflightCommitment: 'processed',
        })
        .send(),
    ).resolves.toBe('sig-1');
    await expect(rpc.getSignatureStatuses(['sig-1']).send()).resolves.toMatchObject({
      value: [{ slot: 43n }],
    });
    await expect(
      rpc.getSignaturesForAddress(TEST_ADDRESS, { limit: 1 }).send(),
    ).resolves.toMatchObject([{ signature: 'sig-2', slot: 44n }]);
    expect(mockBroadcastRawTransaction).toHaveBeenCalledWith({
      rawTransaction: 'raw-tx',
      network: 'mainnet',
      skipPreflight: true,
      maxRetries: 1,
      preflightCommitment: 'processed',
    });
  });

  it('maps Umbra RPC readiness proxy responses', async () => {
    mockGetRpcLatestBlockhash.mockResolvedValueOnce({
      blockhash: 'blockhash-2',
      lastValidBlockHeight: 100,
    });
    mockGetRpcSlot.mockResolvedValueOnce({ slot: 55 });

    await expect(verifyOffpayUmbraRpcReadiness('mainnet')).resolves.toEqual({
      blockhash: 'blockhash-2',
      slot: 55n,
    });
  });

  it('maps devnet Umbra RPC readiness proxy responses', async () => {
    mockGetRpcLatestBlockhash.mockResolvedValueOnce({
      blockhash: 'devnet-blockhash-2',
      lastValidBlockHeight: 200,
    });
    mockGetRpcSlot.mockResolvedValueOnce({ slot: 155 });

    await expect(verifyOffpayUmbraRpcReadiness('devnet')).resolves.toEqual({
      blockhash: 'devnet-blockhash-2',
      slot: 155n,
    });
  });

  it('derives Umbra direct vault fee accounts used by the SDK on mainnet USDC', async () => {
    await expect(
      deriveUmbraProtocolFeeAccounts({
        action: 'shield',
        mint: MAINNET_USDC_MINT,
        network: 'mainnet',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'Em6nLGwWFW8XzZrfCCNDMDMz552iptDg3LJZJbUFr2Ej',
          instruction: 'deposit_from_public_balance_into_new_shared_balance_v17',
          kind: 'feeSchedule',
        }),
        expect.objectContaining({
          address: '9E4prQoasEBxRo6X4pyT29yx1QGEoD6v9bdcsD6Lt3Xh',
          instruction: 'deposit_from_public_balance_into_new_shared_balance_v17',
          kind: 'feeVault',
        }),
      ]),
    );

    await expect(
      deriveUmbraProtocolFeeAccounts({
        action: 'withdraw',
        mint: MAINNET_USDC_MINT,
        network: 'mainnet',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        address: 'ANCj2dLMipbAc4dYBQ61kFPSGfGfuFctKzSwtRkj8zbV',
        instruction: 'withdraw_from_shared_balance_into_public_balance_v17',
        kind: 'feeSchedule',
      }),
      expect.objectContaining({
        address: 'AVTMgK9kCa6hQDPvgxTJK3orxzS3Tg5wndoG9Wb6eYV9',
        instruction: 'withdraw_from_shared_balance_into_public_balance_v17',
        kind: 'feeVault',
      }),
    ]);
  });

  it('derives Umbra direct vault fee accounts used by the SDK on devnet dUSDC', async () => {
    await expect(
      deriveUmbraProtocolFeeAccounts({
        action: 'shield',
        mint: DEVNET_DUSDC_MINT,
        network: 'devnet',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: 'AYpSdxJRX4DmgbHevUV7iPNAYkZhDE6a8CmtuKCkpTza',
          instruction: 'deposit_from_public_balance_into_new_shared_balance_v17',
          kind: 'feeSchedule',
        }),
        expect.objectContaining({
          address: 'CV8npvD9T7Zh3ykC1wp5EtsJw95EhBNf7P96GWaE8CgJ',
          instruction: 'deposit_from_public_balance_into_new_shared_balance_v17',
          kind: 'feeVault',
        }),
      ]),
    );

    await expect(
      deriveUmbraProtocolFeeAccounts({
        action: 'withdraw',
        mint: DEVNET_DUSDC_MINT,
        network: 'devnet',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        address: 'C44vDFaCR3YYx32jBSpWwBv2kxGQN9ywL9Jgs3XZzneP',
        instruction: 'withdraw_from_shared_balance_into_public_balance_v17',
        kind: 'feeSchedule',
      }),
      expect.objectContaining({
        address: 'Gma3NtFUtxPMXBh3jjUrKJUmcnfiCWJonvukmTpgxH2D',
        instruction: 'withdraw_from_shared_balance_into_public_balance_v17',
        kind: 'feeVault',
      }),
    ]);
  });

  it('blocks direct vault actions when Umbra protocol fee accounts are missing', async () => {
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: [null, null, null, null],
    });

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'shield',
        mint: MAINNET_USDC_MINT,
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({
      available: false,
      message:
        'Umbra vault is not enabled for this token/network yet. A required protocol fee account is missing or has an incompatible layout.',
      missingAccounts: expect.arrayContaining([
        expect.objectContaining({
          address: 'Em6nLGwWFW8XzZrfCCNDMDMz552iptDg3LJZJbUFr2Ej',
          exists: false,
          kind: 'feeSchedule',
        }),
      ]),
    });
  });

  it('checks devnet direct vault readiness against current protocol fee accounts', async () => {
    const accounts = await deriveUmbraProtocolFeeAccounts({
      action: 'shield',
      mint: DEVNET_DUSDC_MINT,
      network: 'devnet',
    });
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'devnet',
      accounts: accounts.map((account) => feeAccountRecord(account, DEVNET_UMBRA_PROGRAM_ID)),
    });

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'shield',
        mint: DEVNET_DUSDC_MINT,
        network: 'devnet',
      }),
    ).resolves.toMatchObject({
      available: true,
      message: null,
      missingAccounts: [],
      protocolVersion: 'current',
      protocolVersions: expect.arrayContaining([
        expect.objectContaining({
          available: true,
          protocolVersion: 'current',
        }),
        expect.objectContaining({
          available: false,
          protocolVersion: 'legacy',
        }),
      ]),
    });
    expect(mockGetRpcAccounts).toHaveBeenCalledWith({
      addresses: expect.arrayContaining(accounts.map((account) => account.address)),
      network: 'devnet',
    });
  });

  it('does not select legacy fee accounts after current protocol is marked unsupported', async () => {
    mockGetRpcAccounts.mockImplementation(async ({ addresses }: { addresses: string[] }) => {
      return {
        network: 'mainnet',
        accounts: addresses.map((accountAddress, index) =>
          feeAccountRecord(
            {
              address: accountAddress,
              kind: index % 2 === 0 ? 'feeSchedule' : 'feeVault',
            },
            MAINNET_UMBRA_PROGRAM_ID,
          ),
        ),
      };
    });

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'shield',
        mint: MAINNET_USDC_MINT,
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({
      available: true,
      protocolVersion: 'current',
    });

    markOffpayUmbraProtocolVersionUnsupported('mainnet', 'current');

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'shield',
        mint: MAINNET_USDC_MINT,
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({
      available: false,
      protocolVersion: null,
      protocolVersions: expect.arrayContaining([
        expect.objectContaining({
          available: true,
          protocolVersion: 'legacy',
        }),
      ]),
    });
  });

  it('allows direct vault actions when every Umbra protocol fee account exists', async () => {
    const accounts = await deriveUmbraProtocolFeeAccounts({
      action: 'withdraw',
      mint: MAINNET_USDC_MINT,
      network: 'mainnet',
    });
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'mainnet',
      accounts: accounts.map((account) => feeAccountRecord(account, MAINNET_UMBRA_PROGRAM_ID)),
    });

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'withdraw',
        mint: MAINNET_USDC_MINT,
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({
      available: true,
      message: null,
      missingAccounts: [],
    });
  });

  it('allows private P2P from public when the current fee vault uses the compact layout', async () => {
    const accounts = await deriveUmbraProtocolFeeAccounts({
      action: 'privateP2pFromPublic',
      mint: DEVNET_DUSDC_MINT,
      network: 'devnet',
    });
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'devnet',
      accounts: accounts.map((account) =>
        account.kind === 'feeVault'
          ? feeAccountRecord(account, DEVNET_UMBRA_PROGRAM_ID, 368)
          : feeAccountRecord(account, DEVNET_UMBRA_PROGRAM_ID),
      ),
    });

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'privateP2pFromPublic',
        mint: DEVNET_DUSDC_MINT,
        network: 'devnet',
      }),
    ).resolves.toMatchObject({
      available: true,
      message: null,
      missingAccounts: [],
      protocolVersion: 'current',
    });
  });

  it('blocks vault actions when a fee vault is smaller than the compact layout', async () => {
    const accounts = await deriveUmbraProtocolFeeAccounts({
      action: 'privateP2pFromPublic',
      mint: DEVNET_DUSDC_MINT,
      network: 'devnet',
    });
    mockGetRpcAccounts.mockResolvedValueOnce({
      network: 'devnet',
      accounts: accounts.map((account) =>
        account.kind === 'feeVault'
          ? feeAccountRecord(account, DEVNET_UMBRA_PROGRAM_ID, 367)
          : feeAccountRecord(account, DEVNET_UMBRA_PROGRAM_ID),
      ),
    });

    await expect(
      verifyOffpayUmbraVaultFeeAccountReadiness({
        action: 'privateP2pFromPublic',
        mint: DEVNET_DUSDC_MINT,
        network: 'devnet',
      }),
    ).resolves.toMatchObject({
      available: false,
      message:
        'Umbra vault is not enabled for this token/network yet. A required protocol fee account is missing or has an incompatible layout.',
      missingAccounts: [
        expect.objectContaining({
          exists: false,
          kind: 'feeVault',
          validationError: 'FeeVault layout is 367 bytes, expected at least 368',
        }),
      ],
      protocolVersion: null,
    });
  });
});
