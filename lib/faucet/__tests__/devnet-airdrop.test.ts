const mockRequestDevnetSolAirdropFromApi = jest.fn();

jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  requestDevnetSolAirdrop: mockRequestDevnetSolAirdropFromApi,
}));

const { getDevnetAirdropErrorMessage, requestDevnetSolAirdrop } =
  require('@/lib/faucet/devnet-airdrop') as typeof import('@/lib/faucet/devnet-airdrop');

describe('devnet airdrop faucet', () => {
  beforeEach(() => {
    mockRequestDevnetSolAirdropFromApi.mockReset();
  });

  it('requests Devnet SOL through the OffPay API treasury faucet', async () => {
    mockRequestDevnetSolAirdropFromApi.mockResolvedValueOnce({
      network: 'devnet',
      walletAddress: 'wallet-address',
      treasuryAddress: 'treasury-address',
      signature: 'signature-from-worker',
      lamports: '1000000000',
      sol: 0.25,
      tokens: [
        {
          symbol: 'dUSDC',
          name: 'Devnet USDC (Umbra test)',
          mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          decimals: 6,
          rawAmount: '100000000',
          amount: 100,
          capRawAmount: '100000000',
          capAmount: 100,
          recipientTokenAccount: 'recipient-dusdc-ata',
        },
      ],
      nextEligibleAt: 1_800_000,
    });

    await expect(requestDevnetSolAirdrop('wallet-address')).resolves.toEqual({
      signature: 'signature-from-worker',
      sol: 0.25,
      tokens: [{ symbol: 'dUSDC', amount: 100, capAmount: 100 }],
      nextEligibleAt: 1_800_000,
    });

    expect(mockRequestDevnetSolAirdropFromApi).toHaveBeenCalledWith({
      walletAddress: 'wallet-address',
      network: 'devnet',
    });
  });

  it('explains backend faucet treasury failures', () => {
    expect(getDevnetAirdropErrorMessage(new Error('Devnet faucet treasury needs more dUSDC.'))).toBe(
      'Devnet faucet treasury needs more dUSDC.',
    );
  });
});
