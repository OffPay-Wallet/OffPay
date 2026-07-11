import { submitNormalTokenTransfer } from '@/lib/payments/normal-token-transfer';

const WALLET = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';
const RECIPIENT = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

jest.mock('@/lib/api/offpay-api-client', () => ({
  broadcastRawTransaction: jest.fn(),
  getRpcAccounts: jest.fn(),
  getRpcLatestBlockhash: jest.fn(),
  simulateRawTransaction: jest.fn(),
}));

jest.mock('@/lib/crypto/solana-transaction-signing', () => ({
  signSerializedTransactionForWallet: jest.fn(),
}));

const apiMock = jest.requireMock('@/lib/api/offpay-api-client') as {
  broadcastRawTransaction: jest.Mock;
  getRpcLatestBlockhash: jest.Mock;
  simulateRawTransaction: jest.Mock;
};
const signingMock = jest.requireMock('@/lib/crypto/solana-transaction-signing') as {
  signSerializedTransactionForWallet: jest.Mock;
};

describe('normal transfer preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiMock.getRpcLatestBlockhash.mockResolvedValue({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 1,
    });
  });

  it('does not sign or broadcast a transfer that cannot cover fee or rent', async () => {
    apiMock.simulateRawTransaction.mockResolvedValue({
      success: false,
      error: 'insufficient lamports for fee',
      unitsConsumed: 0,
    });

    await expect(
      submitNormalTokenTransfer({
        walletAddress: WALLET,
        walletId: 'wallet-1',
        recipient: RECIPIENT,
        mint: 'native-sol',
        rawAmount: '1000000000',
        decimals: 9,
        network: 'mainnet',
      }),
    ).rejects.toThrow('Transfer preflight failed: insufficient lamports for fee');
    expect(signingMock.signSerializedTransactionForWallet).not.toHaveBeenCalled();
    expect(apiMock.broadcastRawTransaction).not.toHaveBeenCalled();
  });

  it('signs and broadcasts only after the exact transaction simulates successfully', async () => {
    apiMock.simulateRawTransaction.mockResolvedValue({
      success: true,
      error: null,
      unitsConsumed: 300,
    });
    signingMock.signSerializedTransactionForWallet.mockResolvedValue('signed-base64');
    apiMock.broadcastRawTransaction.mockResolvedValue({ signature: 'signature-1' });

    await expect(
      submitNormalTokenTransfer({
        walletAddress: WALLET,
        walletId: 'wallet-1',
        recipient: RECIPIENT,
        mint: 'native-sol',
        rawAmount: '1000',
        decimals: 9,
        network: 'mainnet',
      }),
    ).resolves.toEqual({ status: 'submitted', signature: 'signature-1' });
    expect(apiMock.simulateRawTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'mainnet' }),
    );
    expect(signingMock.signSerializedTransactionForWallet).toHaveBeenCalledTimes(1);
    expect(apiMock.broadcastRawTransaction).toHaveBeenCalledWith({
      rawTransaction: 'signed-base64',
      network: 'mainnet',
    });
  });
});
