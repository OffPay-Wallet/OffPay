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

import { afterEach } from '@jest/globals';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import * as offpayApiClient from '@/lib/api/offpay-api-client';
import { getStoredWalletSigningMaterialWithAuth } from '@/lib/wallet/secure-wallet-store';
import {
  buildSignedStablecoinOfflinePayment,
  buildOfflinePaymentRequestQr,
  buildOffpayReceiveRequestQr,
  buildSolanaPayRequestQr,
  clearOfflineNonceState,
  enqueueOfflineSignedPayment,
  enqueueReceivedOfflineSignedPayment,
  getOfflineNonceReadiness,
  isNativeOfflineSolToken,
  parseOfflineQrPayload,
  saveOfflineNonceState,
  verifyOfflineSignedTransaction,
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

  async function buildAdversarialFixture(recipient = walletAddress) {
    const signingSeed = new Uint8Array(32).fill(7);
    const signer = Keypair.fromSeed(signingSeed);
    const derivedWalletAddress = signer.publicKey.toBase58();
    const nonceAccount = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(13)));
    (getStoredWalletSigningMaterialWithAuth as jest.Mock).mockResolvedValue({
      privateKey: 'test-private-key',
    });

    await saveOfflineNonceState({
      walletAddress: derivedWalletAddress,
      network: 'mainnet',
      nonceAccount,
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

    return { payment, signer };
  }

  function resignTransaction(transaction: Transaction, signer: Keypair): string {
    transaction.sign(signer);
    return transaction
      .serialize({ requireAllSignatures: true, verifySignatures: true })
      .toString('base64');
  }

  function replaceSignedRecentBlockhash(
    signedTransaction: string,
    signer: Keypair,
    recentBlockhash: Uint8Array,
  ): string {
    const bytes = Buffer.from(signedTransaction, 'base64');
    // The strict test fixture has one signature, a three-byte legacy header,
    // one-byte account count, and ten 32-byte account keys.
    const messageOffset = 1 + 64;
    const recentBlockhashOffset = messageOffset + 3 + 1 + 10 * 32;
    Buffer.from(recentBlockhash).copy(bytes, recentBlockhashOffset);
    const signature = ed25519.sign(bytes.subarray(messageOffset), signer.secretKey.subarray(0, 32));
    Buffer.from(signature).copy(bytes, 1);
    return bytes.toString('base64');
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('removes generated local placeholders when backend preparation rejects before broadcast', async () => {
    const localWallet = bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(31)));
    jest.spyOn(offpayApiClient, 'getOfflineRentEstimate').mockResolvedValueOnce({
      network: 'devnet',
      slotCount: 10,
      lamportsPerNonceAccount: '1447680',
      totalLamports: '14476800',
      estimatedSol: '0.0144768',
      expiresAt: Date.now() + 60_000,
    });
    jest.spyOn(offpayApiClient, 'getOfflineNoncePoolStatus').mockResolvedValueOnce({
      walletAddress: localWallet,
      network: 'devnet',
      targetSlotCount: 10,
      counts: {
        ready: 0,
        locked: 0,
        settling: 0,
        stale: 0,
        missing: 0,
        needsRefill: 10,
      },
      slots: [],
      fetchedAt: Date.now(),
    });
    jest
      .spyOn(offpayApiClient, 'prepareOfflineNoncePool')
      .mockRejectedValueOnce(
        new Error('Offline payment slot preparation exceeds the 50 slot maximum.'),
      );

    await expect(
      prepareOfflinePaymentSlots({
        walletAddress: localWallet,
        network: 'devnet',
        targetSlotCount: 10,
        spendAuthorization: 'user-confirmed',
      }),
    ).rejects.toThrow('exceeds the 50 slot maximum');

    await expect(
      loadOfflinePaymentSlotSnapshot({
        walletAddress: localWallet,
        network: 'devnet',
      }),
    ).resolves.toMatchObject({
      slots: [],
      counts: {
        error: 0,
        preparing: 0,
        needsRefill: 10,
      },
    });
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

  it('rejects a transfer redirected to an attacker even when the expected recipient remains in a decoy account instruction', async () => {
    const { payment, signer } = await buildAdversarialFixture();
    const transaction = Transaction.from(Buffer.from(payment.signedTransaction, 'base64'));
    const transfer = transaction.instructions[2];
    expect(transfer).toBeDefined();
    transaction.instructions[2] = new TransactionInstruction({
      programId: transfer.programId,
      keys: transfer.keys.map((key, index) =>
        index === 2 ? { ...key, pubkey: Keypair.generate().publicKey } : key,
      ),
      data: transfer.data,
    });

    await expect(
      verifyOfflineSignedTransaction({
        signedTransaction: resignTransaction(transaction, signer),
        network: 'mainnet',
        expectedSender: signer.publicKey.toBase58(),
        expectedRecipientOwner: walletAddress,
        expectedRecipient: payment.recipientTokenAccount,
        expectedAmount: payment.rawAmount,
        expectedAmountUnit: 'raw',
        expectedToken: payment.tokenMint,
      }),
    ).rejects.toThrow(/template|destination/i);
  });

  it('rejects any extra drain instruction even when the expected transfer is intact', async () => {
    const { payment, signer } = await buildAdversarialFixture();
    const transaction = Transaction.from(Buffer.from(payment.signedTransaction, 'base64'));
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );

    await expect(
      verifyOfflineSignedTransaction({
        signedTransaction: resignTransaction(transaction, signer),
        network: 'mainnet',
        expectedSender: signer.publicKey.toBase58(),
        expectedRecipientOwner: walletAddress,
        expectedRecipient: payment.recipientTokenAccount,
        expectedAmount: payment.rawAmount,
        expectedAmountUnit: 'raw',
        expectedToken: payment.tokenMint,
      }),
    ).rejects.toThrow(/template/i);
  });

  it('rejects a changed transfer amount even when a decoy instruction contains the expected amount bytes', async () => {
    const { payment, signer } = await buildAdversarialFixture();
    const transaction = Transaction.from(Buffer.from(payment.signedTransaction, 'base64'));
    const transfer = transaction.instructions[2];
    expect(transfer).toBeDefined();
    const changedTransferData = Buffer.from(transfer.data);
    changedTransferData.writeBigUInt64LE(2_000_000n, 1);
    transaction.instructions[2] = new TransactionInstruction({
      programId: transfer.programId,
      keys: transfer.keys,
      data: changedTransferData,
    });
    const expectedAmountBytes = Buffer.alloc(8);
    expectedAmountBytes.writeBigUInt64LE(BigInt(payment.rawAmount));
    transaction.add(
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [],
        data: Buffer.concat([Buffer.from([99]), expectedAmountBytes]),
      }),
    );

    await expect(
      verifyOfflineSignedTransaction({
        signedTransaction: resignTransaction(transaction, signer),
        network: 'mainnet',
        expectedSender: signer.publicKey.toBase58(),
        expectedRecipientOwner: walletAddress,
        expectedRecipient: payment.recipientTokenAccount,
        expectedAmount: payment.rawAmount,
        expectedAmountUnit: 'raw',
        expectedToken: payment.tokenMint,
      }),
    ).rejects.toThrow(/template|amount/i);
  });

  it('rejects a receiver payload whose transaction pays a different owner', async () => {
    const attacker = Keypair.generate().publicKey.toBase58();
    const { payment, signer } = await buildAdversarialFixture(attacker);

    await expect(
      verifyOfflineSignedTransaction({
        signedTransaction: payment.signedTransaction,
        network: 'mainnet',
        expectedSender: signer.publicKey.toBase58(),
        expectedRecipientOwner: walletAddress,
        // A malicious payload can truthfully advertise its own ATA. The
        // active receiver owner must still be bound independently.
        expectedRecipient: payment.recipientTokenAccount,
        expectedAmount: payment.rawAmount,
        expectedAmountUnit: 'raw',
        expectedToken: payment.tokenMint,
      }),
    ).rejects.toThrow(/recipient owner/i);
  });

  it('rejects an outgoing transaction whose signed nonce value differs from the cached slot', async () => {
    const { payment, signer } = await buildAdversarialFixture();
    const differentNonce = Keypair.generate().publicKey.toBytes();

    await expect(
      enqueueOfflineSignedPayment({
        walletAddress: signer.publicKey.toBase58(),
        walletId: 'wallet-1',
        network: 'mainnet',
        signedTransaction: replaceSignedRecentBlockhash(
          payment.signedTransaction,
          signer,
          differentNonce,
        ),
        expectedRecipientOwner: walletAddress,
        expectedRecipient: payment.recipientTokenAccount,
        expectedAmount: payment.rawAmount,
        expectedAmountUnit: 'raw',
        token: payment.tokenMint,
      }),
    ).rejects.toThrow(/cached durable nonce state/i);
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
