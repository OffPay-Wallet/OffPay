import { Buffer } from 'buffer';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { AppError } from './errors.js';
import {
  broadcastRawTransaction,
  getLatestBlockhash,
  getMinimumBalanceForRentExemption,
  getRpcAccounts,
  getWalletLamports,
} from './helius.js';
import { runKvPipeline } from './provider-utils.js';
import type { Bindings } from './types.js';

const DEVNET_AIRDROP_LAMPORTS = 250_000_000;
const DEVNET_AIRDROP_SOL = DEVNET_AIRDROP_LAMPORTS / 1_000_000_000;
const MIN_TREASURY_FEE_BUFFER_LAMPORTS = 10_000n;
const FAUCET_CLAIM_WINDOW_SEC = 4 * 60 * 60;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSVAR_RENT_PROGRAM_ID = 'SysvarRent111111111111111111111111111111111';
const TOKEN_ACCOUNT_LENGTH = 165;
const DEVNET_DUSDC_MINT = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';
const DEVNET_DUSDT_MINT = 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6';
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const TOKEN_DECIMALS = 6;
const CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION = 1;
const TRANSFER_CHECKED_INSTRUCTION = 12;
const U64_MAX = (1n << 64n) - 1n;

interface FaucetTokenConfig {
  symbol: 'dUSDC' | 'dUSDT' | 'USDC';
  name: string;
  mint: string;
  decimals: number;
  capUiAmount: number;
  capRawAmount: bigint;
}

export interface DevnetTreasuryAirdropRequest {
  walletAddress: string;
}

export interface DevnetTreasuryTokenAirdrop {
  symbol: FaucetTokenConfig['symbol'];
  name: string;
  mint: string;
  decimals: number;
  rawAmount: string;
  amount: number;
  capRawAmount: string;
  capAmount: number;
  recipientTokenAccount: string;
}

export interface DevnetTreasuryAirdropResponse {
  network: 'devnet';
  walletAddress: string;
  treasuryAddress: string;
  signature: string;
  lamports: string;
  sol: number;
  tokens: DevnetTreasuryTokenAirdrop[];
  nextEligibleAt: number;
}

function decodeSecretKeyBytes(rawSecretKey: string): Uint8Array {
  const trimmed = rawSecretKey.trim();

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (entry) => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255,
      )
    ) {
      throw new Error('Expected JSON byte array.');
    }

    return Uint8Array.from(parsed.map((entry) => Number(entry)));
  }

  return bs58.decode(trimmed);
}

function readDevnetFaucetKeypair(bindings: Bindings): Keypair {
  const rawSecretKey = bindings.OFFPAY_DEVNET_FAUCET_SECRET_KEY?.trim();
  if (!rawSecretKey) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet faucet treasury is not configured.',
    });
  }

  try {
    const secretKey = decodeSecretKeyBytes(rawSecretKey);
    if (secretKey.length === 64) {
      return Keypair.fromSecretKey(secretKey);
    }

    if (secretKey.length === 32) {
      return Keypair.fromSeed(secretKey);
    }
  } catch (error) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet faucet treasury is misconfigured.',
      cause: error,
    });
  }

  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Devnet faucet treasury is misconfigured.',
  });
}

function assertConfiguredMint(value: string, label: string): string {
  const normalized = value.trim();
  try {
    new PublicKey(normalized);
    return normalized;
  } catch {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: `${label} is not configured with a valid devnet mint.`,
    });
  }
}

function getFaucetTokens(bindings: Bindings): FaucetTokenConfig[] {
  const usdcMint = assertConfiguredMint(bindings.OFFPAY_DEVNET_USDC_MINT ?? DEVNET_USDC_MINT, 'Devnet USDC');

  return [
    {
      symbol: 'dUSDC',
      name: 'Devnet USDC (Umbra test)',
      mint: DEVNET_DUSDC_MINT,
      decimals: TOKEN_DECIMALS,
      capUiAmount: 100,
      capRawAmount: 100_000_000n,
    },
    {
      symbol: 'dUSDT',
      name: 'Devnet USDT (Umbra test)',
      mint: DEVNET_DUSDT_MINT,
      decimals: TOKEN_DECIMALS,
      capUiAmount: 100,
      capRawAmount: 100_000_000n,
    },
    {
      symbol: 'USDC',
      name: 'Devnet USDC',
      mint: usdcMint,
      decimals: TOKEN_DECIMALS,
      capUiAmount: 5,
      capRawAmount: 5_000_000n,
    },
  ];
}

function associatedTokenAddress(owner: string, mint: string): string {
  const [tokenAccount] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );

  return tokenAccount.toBase58();
}

function readUint64Le(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

function writeUint64Le(data: Uint8Array, value: bigint, offset: number): void {
  if (value < 0n || value > U64_MAX) {
    throw new Error('u64 value is out of range.');
  }

  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    data[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function readTokenAccountRawAmount(
  account: Awaited<ReturnType<typeof getRpcAccounts>>['accounts'][number],
): bigint | null {
  if (!account || account.owner !== TOKEN_PROGRAM_ID || !account.dataBase64) return null;

  try {
    const data = Buffer.from(account.dataBase64, 'base64');
    if (data.length < 72) return null;
    return readUint64Le(data, 64);
  } catch {
    return null;
  }
}

function createAssociatedTokenAccountIdempotentInstruction(params: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  associatedTokenAccount: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.associatedTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSVAR_RENT_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION]),
  });
}

function createTransferCheckedInstruction(params: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  rawAmount: bigint;
  decimals: number;
}): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(TRANSFER_CHECKED_INSTRUCTION, 0);
  writeUint64Le(data, params.rawAmount, 1);
  data.writeUInt8(params.decimals, 9);

  return new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: params.source, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function claimFaucetWindow(bindings: Bindings, walletAddress: string): Promise<number> {
  const hashedWallet = await sha256Hex(walletAddress);
  const key = `devnet-faucet:v1:wallet:${hashedWallet}`;
  const now = Date.now();
  const [claimResult, ttlResult] = await runKvPipeline(
    bindings,
    [
      ['SET', key, now, 'EX', FAUCET_CLAIM_WINDOW_SEC, 'NX'],
      ['TTL', key],
    ],
    'Devnet faucet rate limit storage is unavailable.',
  );

  const ttl = typeof ttlResult === 'number' && ttlResult > 0 ? ttlResult : FAUCET_CLAIM_WINDOW_SEC;
  if (claimResult !== 'OK') {
    throw new AppError({
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Devnet faucet can be used once every 4 hours per wallet.',
      retryable: true,
      retryAfterMs: ttl * 1000,
      headers: {
        'Retry-After': ttl.toString(),
      },
    });
  }

  return now + FAUCET_CLAIM_WINDOW_SEC * 1000;
}

export async function requestDevnetTreasuryAirdrop(
  bindings: Bindings,
  request: DevnetTreasuryAirdropRequest,
): Promise<DevnetTreasuryAirdropResponse> {
  const faucetKeypair = readDevnetFaucetKeypair(bindings);
  const treasuryAddress = faucetKeypair.publicKey.toBase58();
  const treasuryLamports = BigInt(
    await getWalletLamports(bindings, { address: treasuryAddress, network: 'devnet' }),
  );
  const faucetTokens = getFaucetTokens(bindings);
  const recipientAddress = request.walletAddress;
  const tokenPlans = faucetTokens.map((token) => ({
    token,
    treasuryTokenAccount: associatedTokenAddress(treasuryAddress, token.mint),
    recipientTokenAccount: associatedTokenAddress(recipientAddress, token.mint),
  }));
  const accounts = await getRpcAccounts(bindings, {
    network: 'devnet',
    addresses: tokenPlans.flatMap((plan) => [plan.treasuryTokenAccount, plan.recipientTokenAccount]),
  });
  const tokenAirdrops: DevnetTreasuryTokenAirdrop[] = [];
  let missingRecipientTokenAccountCount = 0;

  for (let index = 0; index < tokenPlans.length; index += 1) {
    const plan = tokenPlans[index]!;
    const treasuryAccount = accounts.accounts[index * 2] ?? null;
    const recipientAccount = accounts.accounts[index * 2 + 1] ?? null;
    const treasuryRawAmount = readTokenAccountRawAmount(treasuryAccount);
    const recipientRawAmount = readTokenAccountRawAmount(recipientAccount);
    const recipientBalance = recipientRawAmount ?? 0n;
    const transferRawAmount =
      recipientBalance >= plan.token.capRawAmount ? 0n : plan.token.capRawAmount - recipientBalance;

    if (treasuryRawAmount === null) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: `Devnet faucet treasury is missing ${plan.token.symbol}.`,
      });
    }

    if (recipientAccount != null && recipientRawAmount === null) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: `${plan.token.symbol} recipient token account is invalid.`,
      });
    }

    if (recipientAccount == null && transferRawAmount > 0n) {
      missingRecipientTokenAccountCount += 1;
    }

    if (treasuryRawAmount < transferRawAmount) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: `Devnet faucet treasury needs more ${plan.token.symbol}.`,
      });
    }

    tokenAirdrops.push({
      symbol: plan.token.symbol,
      name: plan.token.name,
      mint: plan.token.mint,
      decimals: plan.token.decimals,
      rawAmount: transferRawAmount.toString(),
      amount: Number(transferRawAmount) / 10 ** plan.token.decimals,
      capRawAmount: plan.token.capRawAmount.toString(),
      capAmount: plan.token.capUiAmount,
      recipientTokenAccount: plan.recipientTokenAccount,
    });
  }

  const tokenAccountRentLamports =
    missingRecipientTokenAccountCount === 0
      ? 0n
      : BigInt(
          await getMinimumBalanceForRentExemption(bindings, {
            network: 'devnet',
            space: TOKEN_ACCOUNT_LENGTH,
          }),
        ) * BigInt(missingRecipientTokenAccountCount);
  const requiredLamports =
    BigInt(DEVNET_AIRDROP_LAMPORTS) + tokenAccountRentLamports + MIN_TREASURY_FEE_BUFFER_LAMPORTS;
  if (treasuryLamports < requiredLamports) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet faucet treasury needs more SOL.',
    });
  }

  const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(bindings, 'devnet');
  const nextEligibleAt = await claimFaucetWindow(bindings, request.walletAddress);
  const transaction = new Transaction({
    feePayer: faucetKeypair.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: faucetKeypair.publicKey,
      toPubkey: new PublicKey(recipientAddress),
      lamports: DEVNET_AIRDROP_LAMPORTS,
    }),
  );

  for (const plan of tokenPlans) {
    const tokenAirdrop = tokenAirdrops.find((entry) => entry.mint === plan.token.mint);
    if (tokenAirdrop == null || BigInt(tokenAirdrop.rawAmount) <= 0n) continue;

    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction({
        payer: faucetKeypair.publicKey,
        owner: new PublicKey(recipientAddress),
        mint: new PublicKey(plan.token.mint),
        associatedTokenAccount: new PublicKey(plan.recipientTokenAccount),
      }),
      createTransferCheckedInstruction({
        source: new PublicKey(plan.treasuryTokenAccount),
        mint: new PublicKey(plan.token.mint),
        destination: new PublicKey(plan.recipientTokenAccount),
        owner: faucetKeypair.publicKey,
        rawAmount: BigInt(tokenAirdrop.rawAmount),
        decimals: plan.token.decimals,
      }),
    );
  }

  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.sign(faucetKeypair);

  const { signature } = await broadcastRawTransaction(bindings, {
    rawTransaction: Buffer.from(transaction.serialize()).toString('base64'),
    network: 'devnet',
  });

  return {
    network: 'devnet',
    walletAddress: request.walletAddress,
    treasuryAddress,
    signature,
    lamports: DEVNET_AIRDROP_LAMPORTS.toString(),
    sol: DEVNET_AIRDROP_SOL,
    tokens: tokenAirdrops,
    nextEligibleAt,
  };
}
