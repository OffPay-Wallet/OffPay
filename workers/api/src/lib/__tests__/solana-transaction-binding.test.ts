import { Buffer } from 'buffer';

import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it } from '@jest/globals';

import { readBoundTransactionMessage } from '../solana-transaction-binding';

function buildTransaction(params: {
  feePayer: Keypair;
  transferAuthority: Keypair;
  signers: readonly Keypair[];
}): string {
  const message = new TransactionMessage({
    payerKey: params.feePayer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: params.transferAuthority.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  if (params.signers.length > 0) transaction.sign([...params.signers]);
  return Buffer.from(transaction.serialize()).toString('base64');
}

describe('readBoundTransactionMessage', () => {
  it('accepts a transaction signed by the authenticated fee payer', () => {
    const wallet = Keypair.generate();
    const transactionBase64 = buildTransaction({
      feePayer: wallet,
      transferAuthority: wallet,
      signers: [wallet],
    });

    expect(
      readBoundTransactionMessage({
        transactionBase64,
        requiredSignerAddress: wallet.publicKey.toBase58(),
        requiredFeePayerAddress: wallet.publicKey.toBase58(),
        requireSignerSignature: true,
        label: 'Broadcast',
      }),
    ).toEqual(expect.any(String));
  });

  it('rejects a valid co-signed transaction whose fee payer is another wallet', () => {
    const wallet = Keypair.generate();
    const otherFeePayer = Keypair.generate();
    const transactionBase64 = buildTransaction({
      feePayer: otherFeePayer,
      transferAuthority: wallet,
      signers: [otherFeePayer, wallet],
    });

    expect(() =>
      readBoundTransactionMessage({
        transactionBase64,
        requiredSignerAddress: wallet.publicKey.toBase58(),
        requiredFeePayerAddress: wallet.publicKey.toBase58(),
        requireSignerSignature: true,
        label: 'Broadcast',
      }),
    ).toThrow('authenticated wallet as fee payer');
  });

  it('rejects an unsigned authenticated-wallet transaction', () => {
    const wallet = Keypair.generate();
    const transactionBase64 = buildTransaction({
      feePayer: wallet,
      transferAuthority: wallet,
      signers: [],
    });

    expect(() =>
      readBoundTransactionMessage({
        transactionBase64,
        requiredSignerAddress: wallet.publicKey.toBase58(),
        requiredFeePayerAddress: wallet.publicKey.toBase58(),
        requireSignerSignature: true,
        label: 'Broadcast',
      }),
    ).toThrow('not signed by the authenticated wallet');
  });
});
