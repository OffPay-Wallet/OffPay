import { Keypair } from '@solana/web3.js';

import {
  confirmSwapTriggerCancellation,
  createRecurringSwap,
  createSwapTriggerOrder,
  executeRecurringSwap,
  prepareRecurringSwapCancellation,
  prepareSwapTriggerCancellation,
  prepareSwapTriggerOrder,
  requestSwapTriggerChallenge,
  simulateRawTransaction,
  verifySwapTriggerAuth,
} from '@/lib/api/offpay-api-client';
import {
  signMessageForWallet,
  signSerializedTransactionForWallet,
} from '@/lib/crypto/solana-transaction-signing';
import {
  areClassicSplMintAccounts,
  cancelRecurringOrder,
  cancelTriggerOrder,
  createAndExecuteRecurringSwap,
  createTriggerOrder,
  resolveRecurringOperationIdentity,
} from '@/lib/swap/advanced-swap';
import { SPL_TOKEN_PROGRAM_ID } from '@/lib/crypto/solana-token-accounts';

jest.mock('@/lib/api/offpay-api-client', () => ({
  OffpayApiError: class OffpayApiError extends Error {
    code = 'UPSTREAM_UNAVAILABLE';
  },
  broadcastRawTransaction: jest.fn(),
  confirmSwapTriggerCancellation: jest.fn(),
  createRecurringSwap: jest.fn(),
  createSwapTriggerOrder: jest.fn(),
  executeRecurringSwap: jest.fn(),
  finalizePrivacySwapEnvelope: jest.fn(),
  preparePrivacySwapEnvelope: jest.fn(),
  prepareRecurringSwapCancellation: jest.fn(),
  prepareSwapTriggerCancellation: jest.fn(),
  prepareSwapTriggerOrder: jest.fn(),
  refreshPrivacySwapEnvelopeQuote: jest.fn(),
  requestSwapTriggerChallenge: jest.fn(),
  simulateRawTransaction: jest.fn(),
  verifySwapTriggerAuth: jest.fn(),
}));

jest.mock('@/lib/crypto/solana-transaction-signing', () => ({
  getRequiredSignersForSerializedTransaction: jest.fn(),
  signMessageForWallet: jest.fn(),
  signSerializedTransactionForWallet: jest.fn(),
  signSerializedTransactionWithSeed: jest.fn(),
}));

const mockCreateRecurringSwap = jest.mocked(createRecurringSwap);
const mockConfirmSwapTriggerCancellation = jest.mocked(confirmSwapTriggerCancellation);
const mockCreateSwapTriggerOrder = jest.mocked(createSwapTriggerOrder);
const mockExecuteRecurringSwap = jest.mocked(executeRecurringSwap);
const mockPrepareRecurringSwapCancellation = jest.mocked(prepareRecurringSwapCancellation);
const mockPrepareSwapTriggerCancellation = jest.mocked(prepareSwapTriggerCancellation);
const mockPrepareSwapTriggerOrder = jest.mocked(prepareSwapTriggerOrder);
const mockRequestSwapTriggerChallenge = jest.mocked(requestSwapTriggerChallenge);
const mockSimulateRawTransaction = jest.mocked(simulateRawTransaction);
const mockVerifySwapTriggerAuth = jest.mocked(verifySwapTriggerAuth);
const mockSignMessageForWallet = jest.mocked(signMessageForWallet);
const mockSignSerializedTransactionForWallet = jest.mocked(signSerializedTransactionForWallet);

const walletAddress = Keypair.fromSeed(new Uint8Array(32).fill(71)).publicKey.toBase58();
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const recurringOrderId = Keypair.fromSeed(new Uint8Array(32).fill(72)).publicKey.toBase58();

describe('advanced swap confirmation execution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestSwapTriggerChallenge.mockResolvedValue({
      challengeType: 'message',
      challenge: 'Sign in to Jupiter Trigger',
      unsignedChallengeTransaction: null,
    });
    mockSignMessageForWallet.mockResolvedValue('challenge-signature');
    mockVerifySwapTriggerAuth.mockResolvedValue({ authenticated: true, expiresAt: 123_456 });
    mockPrepareSwapTriggerOrder.mockResolvedValue({
      depositRequestId: 'deposit-1',
      unsignedTransaction: 'unsigned-deposit',
      receiverAddress: walletAddress,
      mint: inputMint,
      amount: '1000000',
      tokenDecimals: 9,
      vault: {
        walletAddress,
        vaultAddress: walletAddress,
        privyVaultId: 'vault-1',
        privyUserId: null,
      },
    });
    mockSimulateRawTransaction.mockResolvedValue({
      success: true,
      error: null,
      unitsConsumed: 10_000,
    });
    mockSignSerializedTransactionForWallet.mockResolvedValue('signed-transaction');
    mockCreateSwapTriggerOrder.mockResolvedValue({
      triggerId: 'trigger-1',
      status: 'open',
      depositSignature: 'deposit-signature',
    });
    mockCreateRecurringSwap.mockResolvedValue({
      recurringId: 'recurring-1',
      status: 'requires_signature',
      unsignedTransaction: 'unsigned-recurring',
    });
    mockExecuteRecurringSwap.mockResolvedValue({
      recurringId: 'recurring-1',
      status: 'Success',
      signature: 'recurring-signature',
      orderId: recurringOrderId,
      operation: 'create',
    });
    mockPrepareSwapTriggerCancellation.mockResolvedValue({
      orderId: 'trigger-1',
      cancelRequestId: 'trigger-cancel-1',
      unsignedTransaction: 'unsigned-trigger-cancel',
    });
    mockConfirmSwapTriggerCancellation.mockResolvedValue({
      orderId: 'trigger-1',
      status: 'cancelled',
      signature: 'trigger-cancel-signature',
    });
    mockPrepareRecurringSwapCancellation.mockResolvedValue({
      recurringId: 'recurring-cancel-1',
      orderId: recurringOrderId,
      status: 'requires_signature',
      unsignedTransaction: 'unsigned-recurring-cancel',
    });
  });

  it('binds the Trigger craft subtype and simulates before asking for the deposit signature', async () => {
    await expect(
      createTriggerOrder({
        walletAddress,
        walletId: 'wallet-1',
        inputMint,
        outputMint,
        amount: '1000000',
        orderType: 'single',
        triggerMint: outputMint,
        triggerCondition: 'above',
        triggerPriceUsd: 200,
        expiresAt: Date.now() + 60_000,
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({ triggerId: 'trigger-1', depositRequestId: 'deposit-1' });

    expect(mockPrepareSwapTriggerOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderSubType: 'single' }),
    );
    expect(mockSimulateRawTransaction).toHaveBeenCalledWith({
      transactionBase64: 'unsigned-deposit',
      network: 'mainnet',
    });
    expect(mockSimulateRawTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignSerializedTransactionForWallet.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('does not sign or create a Trigger order when preflight fails', async () => {
    mockSimulateRawTransaction.mockResolvedValueOnce({
      success: false,
      error: 'insufficient funds',
      unitsConsumed: null,
    });

    await expect(
      createTriggerOrder({
        walletAddress,
        inputMint,
        outputMint,
        amount: '1000000',
        orderType: 'single',
        triggerCondition: 'above',
        triggerPriceUsd: 200,
        expiresAt: Date.now() + 60_000,
        network: 'mainnet',
      }),
    ).rejects.toThrow('Trigger deposit preflight failed: insufficient funds');

    expect(mockSignSerializedTransactionForWallet).not.toHaveBeenCalled();
    expect(mockCreateSwapTriggerOrder).not.toHaveBeenCalled();
  });

  it('does not sign or execute a Recurring order when its create transaction fails preflight', async () => {
    mockSimulateRawTransaction.mockResolvedValueOnce({
      success: false,
      error: 'account unavailable',
      unitsConsumed: null,
    });

    await expect(
      createAndExecuteRecurringSwap({
        walletAddress,
        inputMint,
        outputMint,
        amount: '100000000',
        frequency: 'daily:2',
        idempotencyKey: 'recurring-operation-1',
        network: 'mainnet',
      }),
    ).rejects.toThrow('Recurring order preflight failed: account unavailable');

    expect(mockSignSerializedTransactionForWallet).not.toHaveBeenCalled();
    expect(mockExecuteRecurringSwap).not.toHaveBeenCalled();
    expect(mockCreateRecurringSwap).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'recurring-operation-1' }),
    );
  });

  it('rejects a Recurring response that does not verify successful creation', async () => {
    mockExecuteRecurringSwap.mockResolvedValueOnce({
      recurringId: 'recurring-1',
      status: 'Failed',
      signature: 'recurring-signature',
      orderId: null,
      operation: 'create',
    });

    await expect(
      createAndExecuteRecurringSwap({
        walletAddress,
        inputMint,
        outputMint,
        amount: '100000000',
        frequency: 'daily:2',
        idempotencyKey: 'recurring-operation-failed',
        network: 'mainnet',
      }),
    ).rejects.toThrow('Recurring order creation could not be verified');
  });

  it('freshly authenticates, simulates, signs, and confirms an exact Trigger cancellation', async () => {
    await expect(
      cancelTriggerOrder({
        walletAddress,
        walletId: 'wallet-1',
        orderId: 'trigger-1',
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({ orderId: 'trigger-1', status: 'cancelled' });

    expect(mockRequestSwapTriggerChallenge).toHaveBeenCalledTimes(1);
    expect(mockSimulateRawTransaction).toHaveBeenCalledWith({
      transactionBase64: 'unsigned-trigger-cancel',
      network: 'mainnet',
    });
    expect(mockConfirmSwapTriggerCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'trigger-1',
        cancelRequestId: 'trigger-cancel-1',
        signedTransaction: 'signed-transaction',
      }),
    );
  });

  it('simulates and signs a Recurring cancellation bound to the exact order account', async () => {
    mockExecuteRecurringSwap.mockResolvedValueOnce({
      recurringId: 'recurring-cancel-1',
      status: 'Success',
      signature: 'recurring-cancel-signature',
      orderId: recurringOrderId,
      operation: 'cancel',
    });

    await expect(
      cancelRecurringOrder({
        walletAddress,
        orderId: recurringOrderId,
        inputMint,
        outputMint,
        network: 'mainnet',
      }),
    ).resolves.toMatchObject({ orderId: recurringOrderId, status: 'Success' });
    expect(mockSimulateRawTransaction).toHaveBeenCalledWith({
      transactionBase64: 'unsigned-recurring-cancel',
      network: 'mainnet',
    });
    expect(mockPrepareRecurringSwapCancellation).toHaveBeenCalledWith({
      orderId: recurringOrderId,
      inputMint,
      outputMint,
      network: 'mainnet',
    });
    expect(mockExecuteRecurringSwap).toHaveBeenCalledWith({
      recurringId: 'recurring-cancel-1',
      signedTransaction: 'signed-transaction',
      network: 'mainnet',
    });
  });

  it('accepts only two classic SPL mint accounts for Recurring pairs', () => {
    const response = (owners: (string | null)[]) => ({
      network: 'mainnet' as const,
      accounts: owners.map((owner) =>
        owner == null ? null : { owner, lamports: 1, executable: false, rentEpoch: 0 },
      ),
    });

    expect(areClassicSplMintAccounts(response([SPL_TOKEN_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID]))).toBe(
      true,
    );
    expect(
      areClassicSplMintAccounts(
        response(['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', SPL_TOKEN_PROGRAM_ID]),
      ),
    ).toBe(false);
    expect(areClassicSplMintAccounts(response([SPL_TOKEN_PROGRAM_ID]))).toBe(false);
  });

  it('reuses a Recurring idempotency key for retries and rotates it after intent changes', () => {
    const createKey = jest
      .fn()
      .mockReturnValueOnce('operation-1')
      .mockReturnValueOnce('operation-2');
    const first = resolveRecurringOperationIdentity({
      existing: null,
      fingerprint: 'wallet:USDC:SOL:100:daily',
      createKey,
    });
    const retry = resolveRecurringOperationIdentity({
      existing: first,
      fingerprint: 'wallet:USDC:SOL:100:daily',
      createKey,
    });
    const changed = resolveRecurringOperationIdentity({
      existing: retry,
      fingerprint: 'wallet:USDC:SOL:200:daily',
      createKey,
    });

    expect(retry).toBe(first);
    expect(changed.idempotencyKey).toBe('operation-2');
    expect(createKey).toHaveBeenCalledTimes(2);
  });
});
