jest.mock('@/lib/payments/pending-backup-queue', () => ({
  __esModule: true,
  enqueuePendingPaymentBackup: jest.fn(async () => ({
    uploaded: false,
  })),
}));

jest.mock('@/lib/wallet/secure-wallet-store', () => ({
  __esModule: true,
  getStoredWalletSigningMaterialWithAuth: jest.fn(async () => null),
}));

jest.mock('@/lib/wallet/wallet', () => ({
  __esModule: true,
  decodeSigningSeedFromPrivateKey: jest.fn(() => new Uint8Array(32).fill(7)),
  deriveSigningSeedFromMnemonic: jest.fn(async () => new Uint8Array(32).fill(9)),
}));

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import * as offpayApiClient from '@/lib/api/offpay-api-client';
import { getStoredWalletSigningMaterialWithAuth } from '@/lib/wallet/secure-wallet-store';
import {
  buildSignedStablecoinOfflinePayment,
  buildOfflinePaymentRequestQr,
  buildOffpayReceiveRequestQr,
  buildSolanaPayRequestQr,
  clearOfflineNonceState,
  enqueueReceivedOfflineSignedPayment,
  getOfflineNonceReadiness,
  isNativeOfflineSolToken,
  parseOfflineQrPayload,
  saveOfflineNonceState,
} from '@/lib/offline/offline-payments';
import {
  isOfflinePaymentSlotReclaimable,
  loadOfflinePaymentSlotSnapshot,
  lockOfflinePaymentSlotForTx,
  markOfflinePaymentSlotSettlingForTx,
  prepareOfflinePaymentSlots,
  reclaimOfflinePaymentSlotRent,
  refreshOfflinePaymentSlotsFromBackendStatus,
  syncOfflinePaymentSlotsFromBackendStatus,
} from '@/lib/offline/offline-payment-slots';

describe('offline-payments', () => {
  const walletAddress = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';
  const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  it('parses OffPay and Solana QR payloads without inventing fields', () => {
    const offpayQr = buildOfflinePaymentRequestQr({
      recipient: walletAddress,
      amount: '1.25',
      token: usdcMint,
      memo: 'Lunch',
    });
    const solanaQr = buildSolanaPayRequestQr({
      recipient: walletAddress,
      amount: '0.5',
      token: usdcMint,
      memo: null,
    });

    expect(parseOfflineQrPayload(offpayQr)).toMatchObject({
      type: 'offpay-offline-request',
      request: {
        recipient: walletAddress,
        amount: '1.25',
        token: usdcMint,
        memo: 'Lunch',
      },
    });

    expect(parseOfflineQrPayload(solanaQr)).toMatchObject({
      type: 'solana-address',
      request: {
        recipient: walletAddress,
        amount: '0.5',
        token: usdcMint,
      },
    });
  });

  it('includes Android BLE discovery hints in receive QR payloads', () => {
    const receiveQr = buildOffpayReceiveRequestQr({
      recipient: walletAddress,
      network: 'devnet',
    });

    expect(parseOfflineQrPayload(receiveQr)).toMatchObject({
      type: 'offpay-receive-request',
      request: {
        recipient: walletAddress,
        network: 'devnet',
        bleServiceUuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
        bleName: 'OffPay-Arbj-fwiw',
      },
    });
  });

  it('prefixes receive QR username hints for reliable Android BLE discovery', () => {
    const receiveQr = buildOffpayReceiveRequestQr({
      recipient: walletAddress,
      network: 'devnet',
      bleName: 'karan',
    });

    expect(parseOfflineQrPayload(receiveQr)).toMatchObject({
      type: 'offpay-receive-request',
      request: {
        bleName: 'OffPay-karan',
      },
    });
  });

  it('tracks durable nonce readiness through secure storage', async () => {
    await expect(
      getOfflineNonceReadiness({
        walletAddress,
        network: 'mainnet',
        walletMode: 'offline',
      }),
    ).resolves.toMatchObject({
      status: 'setup_required',
    });

    await saveOfflineNonceState({
      walletAddress,
      network: 'mainnet',
      nonceAccount: '11111111111111111111111111111111',
      nonceAuthority: walletAddress,
      cachedNonce: '11111111111111111111111111111111',
    });

    await expect(
      getOfflineNonceReadiness({
        walletAddress,
        network: 'mainnet',
        walletMode: 'offline',
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      nonceState: {
        nonceAuthority: walletAddress,
      },
    });

    await clearOfflineNonceState({
      walletAddress,
      network: 'mainnet',
    });

    await expect(
      getOfflineNonceReadiness({
        walletAddress,
        network: 'mainnet',
        walletMode: 'offline',
      }),
    ).resolves.toMatchObject({
      status: 'setup_required',
    });
  });

  it('recognizes only native SOL request tokens for local construction', () => {
    expect(isNativeOfflineSolToken(null)).toBe(true);
    expect(isNativeOfflineSolToken('SOL')).toBe(true);
    expect(isNativeOfflineSolToken('WSOL')).toBe(true);
    expect(isNativeOfflineSolToken('So11111111111111111111111111111111111111112')).toBe(true);
    expect(isNativeOfflineSolToken(usdcMint)).toBe(false);
  });

  it('requires explicit confirmation before slot preparation or recovery can spend funds', async () => {
    await expect(
      prepareOfflinePaymentSlots({
        walletAddress,
        network: 'mainnet',
        targetSlotCount: 10,
      } as never),
    ).rejects.toThrow('explicit user confirmation');

    await expect(
      reclaimOfflinePaymentSlotRent({
        walletAddress,
        network: 'mainnet',
        targetSlotCount: 10,
      } as never),
    ).rejects.toThrow('explicit user confirmation');
  });

  it('persists local slot count changes without a backend refresh', async () => {
    const localWallet = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(12)));
    const nonceOne = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(13)));
    const nonceTwo = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(14)));

    await syncOfflinePaymentSlotsFromBackendStatus({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 2,
      counts: {
        ready: 2,
        locked: 0,
        settling: 0,
        stale: 0,
        missing: 0,
        needsRefill: 0,
      },
      slots: [nonceOne, nonceTwo].map((nonceAccount) => ({
        nonceAccount,
        state: 'ready',
        nonceValue: '11111111111111111111111111111111',
        authority: localWallet,
        lamports: '1447680',
        rentExempt: true,
        checkedAt: Date.now(),
      })),
      fetchedAt: Date.now(),
    });

    await lockOfflinePaymentSlotForTx({
      walletAddress: localWallet,
      network: 'devnet',
      nonceAccount: nonceOne,
      txId: 'offline-tx-1',
    });

    await expect(
      loadOfflinePaymentSlotSnapshot({
        walletAddress: localWallet,
        network: 'devnet',
      }),
    ).resolves.toMatchObject({
      counts: {
        ready: 1,
        locked: 1,
      },
    });
  });

  it('preserves local pending slots when provider status is still stale', async () => {
    const localWallet = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(15)));
    const nonceAccount = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(16)));

    await syncOfflinePaymentSlotsFromBackendStatus({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 1,
      counts: {
        ready: 1,
        locked: 0,
        settling: 0,
        stale: 0,
        missing: 0,
        needsRefill: 0,
      },
      slots: [
        {
          nonceAccount,
          state: 'ready',
          nonceValue: '11111111111111111111111111111111',
          authority: localWallet,
          lamports: '1447680',
          rentExempt: true,
          checkedAt: Date.now(),
        },
      ],
      fetchedAt: Date.now(),
    });
    await lockOfflinePaymentSlotForTx({
      walletAddress: localWallet,
      network: 'devnet',
      nonceAccount,
      txId: 'offline-tx-pending',
    });
    await markOfflinePaymentSlotSettlingForTx({
      walletAddress: localWallet,
      network: 'devnet',
      txId: 'offline-tx-pending',
    });

    await expect(
      syncOfflinePaymentSlotsFromBackendStatus({
        walletAddress: localWallet,
        network: 'devnet',
        targetSlotCount: 1,
        counts: {
          ready: 0,
          locked: 0,
          settling: 0,
          stale: 0,
          missing: 1,
          needsRefill: 1,
        },
        slots: [
          {
            nonceAccount,
            state: 'missing',
            nonceValue: null,
            authority: localWallet,
            lamports: '0',
            rentExempt: false,
            checkedAt: Date.now(),
          },
        ],
        fetchedAt: Date.now(),
      }),
    ).resolves.toMatchObject({
      counts: {
        ready: 0,
        settling: 1,
        needsRefill: 9,
      },
    });
  });

  it('promotes setup-finalizing slots to ready when provider status catches up', async () => {
    const localWallet = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(17)));
    const nonceAccount = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(18)));

    await syncOfflinePaymentSlotsFromBackendStatus({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 1,
      counts: {
        ready: 0,
        locked: 0,
        settling: 1,
        stale: 0,
        missing: 0,
        needsRefill: 0,
      },
      slots: [
        {
          nonceAccount,
          state: 'settling',
          nonceValue: null,
          authority: localWallet,
          lamports: '1447680',
          rentExempt: true,
          checkedAt: Date.now(),
        },
      ],
      fetchedAt: Date.now(),
    });

    await expect(
      syncOfflinePaymentSlotsFromBackendStatus({
        walletAddress: localWallet,
        network: 'devnet',
        targetSlotCount: 1,
        counts: {
          ready: 1,
          locked: 0,
          settling: 0,
          stale: 0,
          missing: 0,
          needsRefill: 0,
        },
        slots: [
          {
            nonceAccount,
            state: 'ready',
            nonceValue: '11111111111111111111111111111111',
            authority: localWallet,
            lamports: '1447680',
            rentExempt: true,
            checkedAt: Date.now(),
          },
        ],
        fetchedAt: Date.now(),
      }),
    ).resolves.toMatchObject({
      counts: {
        ready: 1,
        settling: 0,
        needsRefill: 9,
      },
      slots: [
        {
          nonceAccount,
          status: 'ready',
          nonceValue: '11111111111111111111111111111111',
        },
      ],
    });
  });

  it('refreshes provider status for the locally generated slot accounts', async () => {
    const localWallet = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(19)));
    const nonceAccount = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(20)));
    const statusSpy = jest.spyOn(offpayApiClient, 'getOfflineNoncePoolStatus');

    await syncOfflinePaymentSlotsFromBackendStatus({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 1,
      counts: {
        ready: 0,
        locked: 0,
        settling: 1,
        stale: 0,
        missing: 0,
        needsRefill: 0,
      },
      slots: [
        {
          nonceAccount,
          state: 'settling',
          nonceValue: null,
          authority: localWallet,
          lamports: '1447680',
          rentExempt: true,
          checkedAt: Date.now(),
        },
      ],
      fetchedAt: Date.now(),
    });

    statusSpy.mockResolvedValueOnce({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 1,
      counts: {
        ready: 1,
        locked: 0,
        settling: 0,
        stale: 0,
        missing: 0,
        needsRefill: 0,
      },
      slots: [
        {
          nonceAccount,
          state: 'ready',
          nonceValue: '11111111111111111111111111111111',
          authority: localWallet,
          lamports: '1447680',
          rentExempt: true,
          checkedAt: Date.now(),
        },
      ],
      fetchedAt: Date.now(),
    });

    await expect(
      refreshOfflinePaymentSlotsFromBackendStatus({
        walletAddress: localWallet,
        network: 'devnet',
        targetSlotCount: 1,
      }),
    ).resolves.toMatchObject({
      counts: {
        ready: 1,
        settling: 0,
      },
    });
    expect(statusSpy).toHaveBeenCalledWith({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 1,
      nonceAccounts: [nonceAccount],
    });
  });

  it('builds offline stablecoin sends from local token metadata without recipient prefetch', async () => {
    const signingSeed = new Uint8Array(32).fill(7);
    const derivedWalletAddress = bs58.encode(ed25519.getPublicKey(signingSeed));
    const recipient = walletAddress;
    (getStoredWalletSigningMaterialWithAuth as jest.Mock).mockResolvedValueOnce({
      privateKey: 'test-private-key',
    });

    await saveOfflineNonceState({
      walletAddress: derivedWalletAddress,
      network: 'mainnet',
      nonceAccount: '11111111111111111111111111111111',
      nonceAuthority: derivedWalletAddress,
      cachedNonce: '11111111111111111111111111111111',
    });

    const payment = await buildSignedStablecoinOfflinePayment({
      walletAddress: derivedWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
      recipient,
      amount: '1',
      token: usdcMint,
    });

    expect(payment.rawAmount).toBe('1000000');
    expect(payment.tokenMint).toBe(usdcMint);
    expect(payment.tokenSymbol).toBe('USDC');
    expect(payment.recipientTokenAccount).not.toBe(recipient);
    expect(payment.verification.recipientVerified).toBe(true);
    expect(payment.verification.instructionCount).toBe(3);
  });

  it('rejects received offline payments when the advertised sender did not sign', async () => {
    const signingSeed = new Uint8Array(32).fill(7);
    const derivedWalletAddress = bs58.encode(ed25519.getPublicKey(signingSeed));
    const recipient = walletAddress;
    (getStoredWalletSigningMaterialWithAuth as jest.Mock).mockResolvedValueOnce({
      privateKey: 'test-private-key',
    });

    await saveOfflineNonceState({
      walletAddress: derivedWalletAddress,
      network: 'mainnet',
      nonceAccount: '11111111111111111111111111111111',
      nonceAuthority: derivedWalletAddress,
      cachedNonce: '11111111111111111111111111111111',
    });

    const payment = await buildSignedStablecoinOfflinePayment({
      walletAddress: derivedWalletAddress,
      walletId: 'wallet-1',
      network: 'mainnet',
      recipient,
      amount: '1',
      token: usdcMint,
    });

    await expect(
      enqueueReceivedOfflineSignedPayment({
        walletAddress: recipient,
        walletId: 'recipient-wallet',
        network: 'mainnet',
        txId: payment.verification.txId,
        signedTransaction: payment.signedTransaction,
        expectedRecipient: payment.recipientTokenAccount,
        expectedAmount: payment.rawAmount,
        token: payment.tokenMint,
        sender: recipient,
      }),
    ).rejects.toThrow('sender does not match');
  });

  it('only marks inactive funded offline slots as reclaimable', () => {
    const baseSlot = {
      version: 1 as const,
      walletAddress,
      network: 'mainnet' as const,
      nonceAccount: '11111111111111111111111111111111',
      nonceAuthority: walletAddress,
      nonceValue: '11111111111111111111111111111111',
      lamports: '1500000',
      rentExempt: true,
      checkedAt: Date.now(),
      updatedAt: Date.now(),
      lockedTxId: null,
      pendingSignature: null,
      errorMessage: null,
    };

    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'ready' })).toBe(true);
    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'stale' })).toBe(true);
    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'settled' })).toBe(true);
    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'locked' })).toBe(false);
    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'queued' })).toBe(false);
    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'settling' })).toBe(false);
    expect(isOfflinePaymentSlotReclaimable({ ...baseSlot, status: 'ready', lamports: '0' })).toBe(
      false,
    );
    expect(
      isOfflinePaymentSlotReclaimable({
        ...baseSlot,
        status: 'ready',
        nonceAuthority: '11111111111111111111111111111111',
      }),
    ).toBe(false);
  });
});
