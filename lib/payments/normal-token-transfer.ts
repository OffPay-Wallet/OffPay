import { Buffer } from 'buffer';

import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  broadcastRawTransaction,
  getRpcAccounts,
  getRpcLatestBlockhash,
} from '@/lib/api/offpay-api-client';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  deriveAssociatedTokenAddress,
} from '@/lib/crypto/solana-token-accounts';
import { signSerializedTransactionForWallet } from '@/lib/crypto/solana-transaction-signing';

import type { OffpayNetwork, RpcAccountRecord } from '@/types/offpay-api';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const NATIVE_SOL_SENTINEL_MINT = 'native-sol';
const CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION = 1;
const TRANSFER_CHECKED_INSTRUCTION = 12;

interface SubmitNormalTokenTransferParams {
  walletAddress: string;
  walletId: string;
  recipient: string;
  mint: string;
  rawAmount: string;
  decimals: number;
  network: OffpayNetwork;
}

interface SubmitNormalTokenTransferResult {
  status: 'submitted';
  signature: string;
}

function u64LittleEndian(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  let next = value;
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number(next & 0xffn);
    next >>= 8n;
  }
  return bytes;
}

function getTokenAccountMint(record: RpcAccountRecord | null | undefined): string | null {
  const dataBase64 = record?.data ?? record?.dataBase64 ?? null;
  if (dataBase64 == null || record?.owner == null) {
    return null;
  }

  const data = Uint8Array.from(Buffer.from(dataBase64, 'base64'));
  if (data.length < 32) return null;
  return bs58.encode(data.subarray(0, 32));
}

function isNativeSolMint(mint: string): boolean {
  const normalized = mint.trim();
  return (
    normalized === NATIVE_SOL_MINT ||
    normalized === NATIVE_SOL_SENTINEL_MINT ||
    normalized.toUpperCase() === 'SOL'
  );
}

async function signAndBroadcastTransaction(params: {
  transaction: Transaction;
  walletAddress: string;
  walletId: string;
  network: OffpayNetwork;
}): Promise<SubmitNormalTokenTransferResult> {
  const unsignedTransaction = params.transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
  const signedTransaction = await signSerializedTransactionForWallet({
    unsignedTransaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
  });
  const result = await broadcastRawTransaction({
    rawTransaction: signedTransaction,
    network: params.network,
  });

  return {
    status: 'submitted',
    signature: result.signature,
  };
}

async function submitNativeSolTransfer(
  params: SubmitNormalTokenTransferParams,
): Promise<SubmitNormalTokenTransferResult> {
  const latestBlockhash = await getRpcLatestBlockhash(params.network);
  const payer = new PublicKey(params.walletAddress);
  const recipient = new PublicKey(params.recipient);
  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash: latestBlockhash.blockhash,
  });

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: recipient,
      lamports: BigInt(params.rawAmount),
    }),
  );

  return signAndBroadcastTransaction({
    transaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
    network: params.network,
  });
}

async function resolveSenderTokenAccount(params: {
  walletAddress: string;
  mint: string;
  network: OffpayNetwork;
}): Promise<{ tokenAccount: string; tokenProgramId: string }> {
  const candidates = [
    {
      tokenProgramId: SPL_TOKEN_PROGRAM_ID,
      tokenAccount: deriveAssociatedTokenAddress({
        owner: params.walletAddress,
        mint: params.mint,
        tokenProgramId: SPL_TOKEN_PROGRAM_ID,
      }),
    },
    {
      tokenProgramId: TOKEN_2022_PROGRAM_ID,
      tokenAccount: deriveAssociatedTokenAddress({
        owner: params.walletAddress,
        mint: params.mint,
        tokenProgramId: TOKEN_2022_PROGRAM_ID,
      }),
    },
  ];

  const response = await getRpcAccounts({
    addresses: candidates.map((candidate) => candidate.tokenAccount),
    network: params.network,
  });

  const match = candidates.find((candidate, index) => {
    const account = response.accounts[index];
    return (
      account?.owner === candidate.tokenProgramId &&
      getTokenAccountMint(account) === params.mint
    );
  });

  if (match == null) {
    throw new Error('Token account is not available for a normal transfer.');
  }

  return match;
}

function createAssociatedTokenAccountIdempotentInstruction(params: {
  payer: PublicKey;
  associatedTokenAccount: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgramId: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.associatedTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: params.tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION]),
  });
}

function createTransferCheckedInstruction(params: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
  tokenProgramId: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.tokenProgramId,
    keys: [
      { pubkey: params.source, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([TRANSFER_CHECKED_INSTRUCTION]),
      u64LittleEndian(params.amount),
      Buffer.from([params.decimals]),
    ]),
  });
}

export async function submitNormalTokenTransfer(
  params: SubmitNormalTokenTransferParams,
): Promise<SubmitNormalTokenTransferResult> {
  if (!/^\d+$/.test(params.rawAmount) || BigInt(params.rawAmount) <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  if (isNativeSolMint(params.mint)) {
    return submitNativeSolTransfer(params);
  }

  const { tokenAccount, tokenProgramId } = await resolveSenderTokenAccount({
    walletAddress: params.walletAddress,
    mint: params.mint,
    network: params.network,
  });
  const latestBlockhash = await getRpcLatestBlockhash(params.network);
  const payer = new PublicKey(params.walletAddress);
  const recipient = new PublicKey(params.recipient);
  const mint = new PublicKey(params.mint);
  const tokenProgram = new PublicKey(tokenProgramId);
  const source = new PublicKey(tokenAccount);
  const destination = new PublicKey(
    deriveAssociatedTokenAddress({
      owner: params.recipient,
      mint: params.mint,
      tokenProgramId,
    }),
  );
  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash: latestBlockhash.blockhash,
  });

  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction({
      payer,
      associatedTokenAccount: destination,
      owner: recipient,
      mint,
      tokenProgramId: tokenProgram,
    }),
    createTransferCheckedInstruction({
      source,
      mint,
      destination,
      owner: payer,
      amount: BigInt(params.rawAmount),
      decimals: params.decimals,
      tokenProgramId: tokenProgram,
    }),
  );

  return signAndBroadcastTransaction({
    transaction,
    walletAddress: params.walletAddress,
    walletId: params.walletId,
    network: params.network,
  });
}
