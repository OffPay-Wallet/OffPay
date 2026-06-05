const mockConnection = jest.fn();
const connectionInstances: MockConnectionInstance[] = [];

type MockConnectionInstance = {
  confirmTransaction: jest.Mock;
  endpoint: string;
  getLatestBlockhash: jest.Mock;
  requestAirdrop: jest.Mock;
};

const endpointResults = new Map<string, 'rate-limit' | 'success'>();

jest.mock('@solana/web3.js', () => ({
  __esModule: true,
  Connection: mockConnection,
  LAMPORTS_PER_SOL: 1_000,
  PublicKey: class PublicKey {
    readonly value: string;

    constructor(value: string) {
      if (!value) throw new Error('invalid public key');
      this.value = value;
    }
  },
}));

mockConnection.mockImplementation((endpoint: string, config: unknown) => {
  const instance: MockConnectionInstance = {
    endpoint,
    requestAirdrop: jest.fn(async () => {
      if (endpointResults.get(endpoint) === 'rate-limit') {
        throw new Error('Server responded with 429.');
      }
      return `signature:${endpoint}`;
    }),
    getLatestBlockhash: jest.fn(async () => ({
      blockhash: `blockhash:${endpoint}`,
      lastValidBlockHeight: 123,
    })),
    confirmTransaction: jest.fn(async () => undefined),
  };

  connectionInstances.push(instance);
  return { ...instance, config };
});

const { __devnetAirdropInternal, getDevnetAirdropErrorMessage, requestDevnetSolAirdrop } =
  require('@/lib/faucet/devnet-airdrop') as typeof import('@/lib/faucet/devnet-airdrop');

const ORIGINAL_ENV = { ...process.env };

function resetExpoPublicRpcEnv(): void {
  delete process.env.EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL;
  delete process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL;
  delete process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL;
  delete process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_FALLBACK_RPC_URL;
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('devnet airdrop faucet', () => {
  beforeEach(() => {
    resetExpoPublicRpcEnv();
    endpointResults.clear();
    connectionInstances.length = 0;
    mockConnection.mockClear();
  });

  it('prefers configured private devnet RPC URLs before the public endpoint', () => {
    process.env.EXPO_PUBLIC_SOLANA_DEVNET_RPC_URL = 'https://rpc.primary.example';
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL = 'https://rpc.helius.example';
    process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL = 'not-a-url';
    process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_FALLBACK_RPC_URL = 'https://rpc.helius.example';

    expect(__devnetAirdropInternal.getDevnetRpcCandidates('https://api.devnet.solana.com')).toEqual(
      [
        'https://rpc.primary.example',
        'https://rpc.helius.example',
        'https://api.devnet.solana.com',
      ],
    );
  });

  it('requests airdrop through the configured RPC without web3 same-endpoint rate-limit retries', async () => {
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL = 'https://rpc.helius.example';

    await expect(requestDevnetSolAirdrop('wallet-address')).resolves.toEqual({
      signature: 'signature:https://rpc.helius.example',
      sol: 1,
    });

    expect(mockConnection).toHaveBeenCalledWith('https://rpc.helius.example', {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
    expect(connectionInstances).toHaveLength(1);
    expect(connectionInstances[0]?.requestAirdrop).toHaveBeenCalledWith(expect.anything(), 1_000);
  });

  it('falls back to the next RPC candidate after a 429 response', async () => {
    process.env.EXPO_PUBLIC_HELIUS_DEVNET_RPC_URL = 'https://rpc.helius.example';
    endpointResults.set('https://rpc.helius.example', 'rate-limit');

    await expect(requestDevnetSolAirdrop('wallet-address')).resolves.toEqual({
      signature: 'signature:https://api.devnet.solana.com',
      sol: 1,
    });

    expect(connectionInstances.map((instance) => instance.endpoint)).toEqual([
      'https://rpc.helius.example',
      'https://api.devnet.solana.com',
    ]);
  });

  it('explains rate-limit failures with the private RPC action', () => {
    expect(getDevnetAirdropErrorMessage(new Error('Server responded with 429.'))).toContain(
      'Configure a private Devnet RPC',
    );
  });
});
