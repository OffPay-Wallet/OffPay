import { Buffer } from 'buffer';

import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';

import {
  signSerializedTransactionWithSeed,
  verifySignedSerializedTransactionForWallet,
} from '@/lib/crypto/solana-transaction-signing';

const wallet = Keypair.fromSeed(new Uint8Array(32).fill(37));

function unsignedTransfer(lamports: number): string {
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
  }).add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports,
    }),
  );
  return transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}

function signedTransfer(lamports: number): { unsigned: string; signed: string } {
  const unsigned = unsignedTransfer(lamports);
  return {
    unsigned,
    signed: signSerializedTransactionWithSeed({
      unsignedTransaction: unsigned,
      walletAddress: wallet.publicKey.toBase58(),
      signingSeed: wallet.secretKey.subarray(0, 32),
    }),
  };
}

describe('serialized wallet signature verification', () => {
  it('accepts the exact approved message with a valid wallet signature', () => {
    const transaction = signedTransfer(1);
    expect(() =>
      verifySignedSerializedTransactionForWallet({
        unsignedTransaction: transaction.unsigned,
        signedTransaction: transaction.signed,
        walletAddress: wallet.publicKey.toBase58(),
      }),
    ).not.toThrow();
  });

  it('rejects a validly signed but substituted transaction message', () => {
    const approved = signedTransfer(1);
    const substituted = signedTransfer(2);
    expect(() =>
      verifySignedSerializedTransactionForWallet({
        unsignedTransaction: approved.unsigned,
        signedTransaction: substituted.signed,
        walletAddress: wallet.publicKey.toBase58(),
      }),
    ).toThrow('changed the transaction');
  });

  it('rejects an invalid wallet signature', () => {
    const transaction = signedTransfer(1);
    const bytes = Buffer.from(transaction.signed, 'base64');
    bytes[1] = (bytes[1] ?? 0) ^ 0xff;
    expect(() =>
      verifySignedSerializedTransactionForWallet({
        unsignedTransaction: transaction.unsigned,
        signedTransaction: bytes.toString('base64'),
        walletAddress: wallet.publicKey.toBase58(),
      }),
    ).toThrow('does not match the active wallet');
  });
});
