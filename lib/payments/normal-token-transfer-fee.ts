/**
 * On-chain fee estimation for the normal-transfer route.
 *
 * Builds the same compiled transaction message that
 * `submitNormalTokenTransfer` would broadcast and asks the RPC node
 * how many lamports the cluster would charge for it. The returned
 * value is exactly what the wallet will pay at submit time, so the
 * UI can show a real fee instead of the "Calculated on submit"
 * placeholder.
 */
import { Buffer } from 'buffer';

import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  getRpcAccounts,
  getRpcFeeForMessage,
  getRpcLatestBlockhash,
} from '@/lib/api/offpay-api-client';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  deriveAssociatedTokenAddress,
} from '@/lib/crypto/solana-token-accounts';

import type { OffpayNetwork, RpcAccountRecord } from '@/types/offpay-api';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const NATIVE_SOL_SENTINEL_MINT = 'native-sol';
const CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION = 1;
const TRANSFER_CHECKED_INSTRUCTION = 12;

interface EstimateNormalTransferFeeParams {
  walletAddress: string;
  recipient: string;
  mint: string;
  /** Atomic amount as a base-10 integer string. */
  rawAmount: string;
  decimals: number;
  network: OffpayNetwork;
  signal?: AbortSignal;
}

export interface NormalTransferFeeEstimate {
  /** Network fee, in lamports. `null` if the cluster could not price the message. */
  lamports: number | null;
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

async function resolveSenderTokenAccount(params: {
  walletAddress: string;
  mint: string;
  network: OffpayNetwork;
  signal?: AbortSignal;
}): Promise<{ tokenAccount: string; tokenProgramId: string } | null> {
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

  return (
    candidates.find((candidate, index) => {
      const account = response.accounts[index];
      return (
        account?.owner === candidate.tokenProgramId &&
        getTokenAccountMint(account) === params.mint
      );
    }) ?? null
  );
}

function compileMessageBase64(transaction: Transaction): string {
  // Compile the transaction's message exactly as the broadcast path
  // would, but skip signing — `getFeeForMessage` only needs the wire
  // representation of the compiled message.
  const message = transaction.compileMessage();
  return Buffer.from(message.serialize()).toString('base64');
}

export async function estimateNormalTokenTransferFee(
  params: EstimateNormalTransferFeeParams,
): Promise<NormalTransferFeeEstimate> {
  if (!/^\d+$/.test(params.rawAmount) || BigInt(params.rawAmount) <= 0n) {
    return { lamports: null };
  }

  const latestBlockhash = await getRpcLatestBlockhash(params.network);
  const payer = new PublicKey(params.walletAddress);
  const recipient = new PublicKey(params.recipient);
  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash: latestBlockhash.blockhash,
  });

  if (isNativeSolMint(params.mint)) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: BigInt(params.rawAmount),
      }),
    );
  } else {
    const senderAccount = await resolveSenderTokenAccount({
      walletAddress: params.walletAddress,
      mint: params.mint,
      network: params.network,
      signal: params.signal,
    });
    if (senderAccount == null) {
      // Wallet does not yet hold the mint — we can't compile a real
      // transfer instruction, but a fee for an SPL transfer is still
      // useful so we estimate a representative one using the SPL
      // legacy token program. The message size + signers are
      // identical, so the lamport answer is indistinguishable from
      // the actual broadcast.
      const fallbackTokenProgramId = SPL_TOKEN_PROGRAM_ID;
      const fallbackSource = new PublicKey(
        deriveAssociatedTokenAddress({
          owner: params.walletAddress,
          mint: params.mint,
          tokenProgramId: fallbackTokenProgramId,
        }),
      );
      const fallbackDestination = new PublicKey(
        deriveAssociatedTokenAddress({
          owner: params.recipient,
          mint: params.mint,
          tokenProgramId: fallbackTokenProgramId,
        }),
      );
      const mint = new PublicKey(params.mint);
      const tokenProgram = new PublicKey(fallbackTokenProgramId);
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction({
          payer,
          associatedTokenAccount: fallbackDestination,
          owner: recipient,
          mint,
          tokenProgramId: tokenProgram,
        }),
        createTransferCheckedInstruction({
          source: fallbackSource,
          mint,
          destination: fallbackDestination,
          owner: payer,
          amount: BigInt(params.rawAmount),
          decimals: params.decimals,
          tokenProgramId: tokenProgram,
        }),
      );
    } else {
      const tokenProgramId = senderAccount.tokenProgramId;
      const source = new PublicKey(senderAccount.tokenAccount);
      const destination = new PublicKey(
        deriveAssociatedTokenAddress({
          owner: params.recipient,
          mint: params.mint,
          tokenProgramId,
        }),
      );
      const mint = new PublicKey(params.mint);
      const tokenProgram = new PublicKey(tokenProgramId);
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
    }
  }

  const messageBase64 = compileMessageBase64(transaction);
  const result = await getRpcFeeForMessage({
    network: params.network,
    messageBase64,
    signal: params.signal,
  });
  return { lamports: result.lamports };
}
