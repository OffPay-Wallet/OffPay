const mockLiveEnv = {
  walletAddress: process.env.OFFPAY_LIVE_WALLET_ADDRESS,
  signingSeedHex: process.env.OFFPAY_LIVE_SIGNING_SEED_HEX,
  requestSecret: process.env.OFFPAY_LIVE_REQUEST_SECRET,
  deviceId: process.env.OFFPAY_LIVE_DEVICE_ID,
  bootstrapVersion: process.env.OFFPAY_LIVE_BOOTSTRAP_VERSION,
};
const liveEnabled =
  process.env.OFFPAY_LIVE_CONTRACT_TESTS === 'true' &&
  Object.values(mockLiveEnv).every((value) => typeof value === 'string' && value.length > 0);

function mockHexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error('OFFPAY_LIVE_SIGNING_SEED_HEX must be an even-length hex string.');
  }

  return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: process.env.OFFPAY_LIVE_APP_VERSION ?? '1.0.0' },
    nativeAppVersion: process.env.OFFPAY_LIVE_APP_VERSION ?? '1.0.0',
  },
}));

jest.mock('@umbra-privacy/sdk/arcium', () => ({
  __esModule: true,
  getPollingComputationMonitor: jest.fn(() => ({ prepareMonitor: jest.fn() })),
}));

jest.mock('@umbra-privacy/sdk/solana', () => ({
  __esModule: true,
  getPollingTransactionForwarder: jest.fn(() => ({
    fireAndForget: jest.fn(),
    forwardInParallel: jest.fn(),
    forwardSequentially: jest.fn(),
  })),
  getRpcBlockhashProvider: jest.fn(),
  getRpcEpochInfoProvider: jest.fn(),
}));

jest.mock('@umbra-privacy/sdk/client', () => ({
  __esModule: true,
  getUmbraClient: jest.fn(),
}));

jest.mock('@/lib/api/offpay-api-storage', () => ({
  __esModule: true,
  clearOffpayBootstrapCredentials: jest.fn(async () => undefined),
  getOffpayBootstrapVersion: jest.fn(async () => Number(mockLiveEnv.bootstrapVersion)),
  getOffpayRequestSecret: jest.fn(async () => mockLiveEnv.requestSecret ?? null),
  getOrCreateOffpayDeviceId: jest.fn(async () => mockLiveEnv.deviceId ?? 'offpay-live-device'),
  storeOffpayBootstrapCredentials: jest.fn(async () => undefined),
}));

jest.mock('@/lib/wallet/secure-wallet-store', () => ({
  __esModule: true,
  getStoredWalletInfo: jest.fn(async () => ({
    id: 'offpay-live-wallet',
    publicKey: mockLiveEnv.walletAddress,
    importMethod: 'generated',
  })),
  getStoredWalletSigningMaterialWithAuth: jest.fn(async () => ({
    mnemonic: null,
    privateKey: 'offpay-live-signing-seed',
  })),
}));

jest.mock('@/lib/wallet/wallet', () => ({
  __esModule: true,
  decodeSigningSeedFromPrivateKey: jest.fn(() =>
    mockHexToBytes(mockLiveEnv.signingSeedHex ?? ''.padStart(64, '0')),
  ),
  deriveSigningSeedFromMnemonic: jest.fn(async () =>
    mockHexToBytes(mockLiveEnv.signingSeedHex ?? ''.padStart(64, '0')),
  ),
}));

const { clearOffpaySigningSession } =
  require('@/lib/api/offpay-api-client') as typeof import('@/lib/api/offpay-api-client');
const { verifyOffpayUmbraRpcReadiness } =
  require('@/lib/umbra/umbra-offpay-providers') as typeof import('@/lib/umbra/umbra-offpay-providers');

const describeLive = liveEnabled ? describe : describe.skip;

describeLive('umbra-offpay live backend contract', () => {
  beforeEach(() => {
    clearOffpaySigningSession();
  });

  it('authenticates and reads deployed Umbra RPC proxy readiness on mainnet', async () => {
    const result = await verifyOffpayUmbraRpcReadiness('mainnet');

    expect(result.blockhash.length).toBeGreaterThan(0);
    expect(result.slot).toBeGreaterThan(0n);
  });
});
