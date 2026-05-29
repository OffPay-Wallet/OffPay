jest.mock('@/lib/api/offpay-api-client', () => ({
  __esModule: true,
  deletePendingBackup: jest.fn(async () => undefined),
  getRpcSignatureStatuses: jest.fn(),
  settlePrivatePayments: jest.fn(),
  uploadPendingBackup: jest.fn(async () => undefined),
}));

jest.mock('@/lib/wallet/secure-wallet-store', () => ({
  __esModule: true,
  getStoredWalletSigningMaterialWithAuth: jest.fn(async () => ({ privateKey: 'test-private-key' })),
}));

jest.mock('@/lib/wallet/wallet', () => ({
  __esModule: true,
  decodeSigningSeedFromPrivateKey: jest.fn(() => new Uint8Array(32).fill(7)),
  deriveSigningSeedFromMnemonic: jest.fn(async () => new Uint8Array(32).fill(9)),
}));

import * as FileSystem from 'expo-file-system';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { getRpcSignatureStatuses, settlePrivatePayments } from '@/lib/api/offpay-api-client';
import {
  enqueuePendingPaymentBackup,
  getPendingBackupQueueStats,
  settleQueuedPendingPayments,
} from '@/lib/payments/pending-backup-queue';

describe('pending-backup-queue', () => {
  const walletAddress = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(7)));
  const network = 'mainnet' as const;

  beforeEach(() => {
    (FileSystem as unknown as { __INTERNAL_RESET: () => void }).__INTERNAL_RESET();
    jest.clearAllMocks();
  });

  it('retries failed settlement items instead of leaving them stuck', async () => {
    await enqueuePendingPaymentBackup({
      walletAddress,
      walletId: 'wallet-1',
      network,
      txId: 'offline-tx-1',
      signedBlob: 'signed-blob',
      kind: 'offline-payment',
      uploadImmediately: false,
    });

    (settlePrivatePayments as jest.Mock).mockResolvedValueOnce({
      results: [{ status: 'failed', signature: null }],
    });

    const firstAttempt = await settleQueuedPendingPayments({
      walletAddress,
      walletId: 'wallet-1',
      network,
    });

    expect(firstAttempt.failedTxIds).toEqual(['offline-tx-1']);
    await expect(getPendingBackupQueueStats({ walletAddress, network })).resolves.toMatchObject({
      failed: 1,
      pending: 0,
    });

    (settlePrivatePayments as jest.Mock).mockResolvedValueOnce({
      results: [{ status: 'confirmed', signature: 'settlement-signature' }],
    });

    const retry = await settleQueuedPendingPayments({
      walletAddress,
      walletId: 'wallet-1',
      network,
    });

    expect(retry.confirmedTxIds).toEqual(['offline-tx-1']);
    expect(settlePrivatePayments).toHaveBeenCalledTimes(2);
    await expect(getPendingBackupQueueStats({ walletAddress, network })).resolves.toMatchObject({
      total: 0,
      failed: 0,
    });
  });

  it('treats a failed settlement result as confirmed when its signature is already on-chain', async () => {
    await enqueuePendingPaymentBackup({
      walletAddress,
      walletId: 'wallet-1',
      network,
      txId: 'offline-tx-1',
      signedBlob: 'signed-blob',
      kind: 'offline-payment',
      uploadImmediately: false,
    });

    (settlePrivatePayments as jest.Mock).mockResolvedValueOnce({
      results: [{ status: 'failed', signature: 'already-settled-signature' }],
    });
    (getRpcSignatureStatuses as jest.Mock).mockResolvedValueOnce({
      statuses: [
        {
          slot: 123,
          confirmations: null,
          err: null,
          confirmationStatus: 'confirmed',
        },
      ],
    });
    const onConfirmed = jest.fn();
    const onFailed = jest.fn();

    const result = await settleQueuedPendingPayments({
      walletAddress,
      walletId: 'wallet-1',
      network,
      onOfflinePaymentConfirmed: onConfirmed,
      onOfflinePaymentFailed: onFailed,
    });

    expect(result.confirmedTxIds).toEqual(['offline-tx-1']);
    expect(result.failedTxIds).toEqual([]);
    expect(onConfirmed).toHaveBeenCalledWith('offline-tx-1', 'already-settled-signature');
    expect(onFailed).not.toHaveBeenCalled();
    await expect(getPendingBackupQueueStats({ walletAddress, network })).resolves.toMatchObject({
      total: 0,
      failed: 0,
    });
  });

  it('checks the signed transaction signature when settlement omits it', async () => {
    const signatureBytes = new Uint8Array(64).fill(11);
    const signedBlob = Buffer.concat([
      Buffer.from([1]),
      Buffer.from(signatureBytes),
      Buffer.from([0]),
    ]).toString('base64');
    const derivedSignature = bs58.encode(signatureBytes);

    await enqueuePendingPaymentBackup({
      walletAddress,
      walletId: 'wallet-1',
      network,
      txId: 'offline-tx-1',
      signedBlob,
      kind: 'offline-payment',
      uploadImmediately: false,
    });

    (settlePrivatePayments as jest.Mock).mockResolvedValueOnce({
      results: [{ status: 'failed', signature: null }],
    });
    (getRpcSignatureStatuses as jest.Mock).mockResolvedValueOnce({
      statuses: [
        {
          slot: 123,
          confirmations: null,
          err: null,
          confirmationStatus: 'confirmed',
        },
      ],
    });
    const onConfirmed = jest.fn();
    const onFailed = jest.fn();

    const result = await settleQueuedPendingPayments({
      walletAddress,
      walletId: 'wallet-1',
      network,
      onOfflinePaymentConfirmed: onConfirmed,
      onOfflinePaymentFailed: onFailed,
    });

    expect(getRpcSignatureStatuses).toHaveBeenCalledWith({
      signatures: [derivedSignature],
      network,
    });
    expect(result.confirmedTxIds).toEqual(['offline-tx-1']);
    expect(result.failedTxIds).toEqual([]);
    expect(onConfirmed).toHaveBeenCalledWith('offline-tx-1', derivedSignature);
    expect(onFailed).not.toHaveBeenCalled();
  });
});
