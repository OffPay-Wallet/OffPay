#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { paceSolanaRpcRead, paceSolanaTransaction, withRetry } from './rwa-devnet-rate-limit.mjs';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_SANDBOX_PATH = 'target/rwa-devnet-sandbox.json';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const DECIMALS = 6;
const DEFAULT_ASSET_CAP = '10';
const DEFAULT_SETTLEMENT_CAP = '1000';

function expandHome(filePath) {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function readKeypair(filePath) {
  const parsed = JSON.parse(fs.readFileSync(expandHome(filePath), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected Solana keypair JSON array at ${filePath}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readArgValue(name) {
  const prefixed = `${name}=`;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const inline = process.argv.find((entry) => entry.startsWith(prefixed));
  return inline == null ? null : inline.slice(prefixed.length);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readFirstPositionalArg() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const entry = args[index];
    if (entry == null) continue;
    if (entry.startsWith('--')) {
      if (!entry.includes('=')) index += 1;
      continue;
    }
    return entry;
  }
  return null;
}

function parseUiAmount(value, decimals) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid token amount: ${value}`);
  }

  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount ${value} has more than ${decimals} decimals.`);
  }

  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals))
  );
}

function formatUiAmount(rawAmount, decimals) {
  const scale = 10n ** BigInt(decimals);
  const whole = rawAmount / scale;
  const fraction = rawAmount % scale;
  if (fraction === 0n) return whole.toString();

  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function u64Le(value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function associatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createAtaIdempotentInstruction({ payer, owner, mint, associatedTokenAccount }) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function createMintToInstruction({ mint, destination, authority, amount }) {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([7]), u64Le(amount)]),
  });
}

async function getTokenAccountBalanceWithRetry(connection, tokenAccount, label) {
  return withRetry(`${label} token balance`, async () => {
    await paceSolanaRpcRead();
    return connection.getTokenAccountBalance(tokenAccount, 'confirmed');
  });
}

async function send(connection, transaction, signers, label) {
  if (transaction.instructions.length === 0) {
    console.log(`${label}: no-op`);
    return null;
  }

  const signature = await withRetry(label, async () => {
    await paceSolanaTransaction();
    return sendAndConfirmTransaction(connection, transaction, signers, {
      commitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 8,
    });
  });
  console.log(`${label}: ${signature}`);
  return signature;
}

async function readTokenBalance(connection, tokenAccount, label) {
  try {
    const balance = await getTokenAccountBalanceWithRetry(connection, tokenAccount, label);
    return BigInt(balance.value.amount);
  } catch (error) {
    if (error instanceof Error && /could not find account/i.test(error.message)) {
      return 0n;
    }
    throw error;
  }
}

function readSandboxAssets(sandbox) {
  if (Array.isArray(sandbox.assets) && sandbox.assets.length > 0) return sandbox.assets;
  return [
    {
      symbol: sandbox.assetSymbol ?? 'AAPLd',
      name: sandbox.assetName ?? 'Apple Sandbox RWA',
      mint: sandbox.assetMint,
      decimals: sandbox.assetDecimals ?? DECIMALS,
    },
  ];
}

function selectAssets(sandboxAssets) {
  if (hasFlag('--all-assets')) return sandboxAssets;

  const assetMint = readArgValue('--asset-mint');
  if (assetMint != null) {
    const asset = sandboxAssets.find((entry) => entry.mint === assetMint);
    if (asset == null) throw new Error(`No sandbox asset found for mint ${assetMint}.`);
    return [asset];
  }

  const assetSymbol = readArgValue('--asset-symbol');
  if (assetSymbol != null) {
    const normalized = assetSymbol.trim().toUpperCase();
    const asset = sandboxAssets.find((entry) => String(entry.symbol).toUpperCase() === normalized);
    if (asset == null) throw new Error(`No sandbox asset found for symbol ${assetSymbol}.`);
    return [asset];
  }

  return [sandboxAssets[0]];
}

async function topUpToken({ connection, payer, recipient, mint, decimals, capRawAmount, symbol }) {
  const tokenAccount = associatedTokenAddress(recipient, mint);
  const currentRaw = await readTokenBalance(connection, tokenAccount, symbol);
  const mintRawAmount = currentRaw >= capRawAmount ? 0n : capRawAmount - currentRaw;
  if (mintRawAmount === 0n) {
    console.log(`${symbol} token cap: already satisfied`);
    return {
      symbol,
      mint: mint.toBase58(),
      tokenAccount: tokenAccount.toBase58(),
      signature: null,
      mintedRawAmount: '0',
      mintedAmount: '0',
      capAmount: formatUiAmount(capRawAmount, decimals),
    };
  }

  const transaction = new Transaction().add(
    createAtaIdempotentInstruction({
      payer: payer.publicKey,
      owner: recipient,
      mint,
      associatedTokenAccount: tokenAccount,
    }),
  );

  if (mintRawAmount > 0n) {
    transaction.add(
      createMintToInstruction({
        mint,
        destination: tokenAccount,
        authority: payer.publicKey,
        amount: mintRawAmount,
      }),
    );
  }

  let signature = null;
  try {
    signature = await send(connection, transaction, [payer], `${symbol} token cap`);
  } catch (error) {
    const balanceAfterError = await readTokenBalance(
      connection,
      tokenAccount,
      `${symbol} post-error`,
    );
    if (balanceAfterError < capRawAmount) throw error;
    console.log(`${symbol} token cap: satisfied after retryable send error`);
  }

  return {
    symbol,
    mint: mint.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    signature,
    mintedRawAmount: mintRawAmount.toString(),
    mintedAmount: formatUiAmount(mintRawAmount, decimals),
    capAmount: formatUiAmount(capRawAmount, decimals),
  };
}

async function main() {
  const walletAddress =
    readArgValue('--wallet') ??
    process.env.OFFPAY_RWA_DEVNET_RECIPIENT ??
    readFirstPositionalArg() ??
    '';
  if (walletAddress.length === 0) {
    throw new Error(
      'Usage: npm run program:rwa:sandbox:fund-wallet:devnet -- --wallet <DEVNET_WALLET> [--all-assets | --asset-symbol AAPLd | --asset-mint <MINT>] [--settlement 1000] [--asset 10]',
    );
  }

  const recipient = new PublicKey(walletAddress);
  const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || DEFAULT_RPC_URL;
  const sandboxPath =
    readArgValue('--sandbox') ?? process.env.OFFPAY_RWA_DEVNET_SANDBOX_PATH ?? DEFAULT_SANDBOX_PATH;
  const sandbox = readJsonFile(sandboxPath);
  const payer = readKeypair(process.env.SOLANA_KEYPAIR || '~/.config/solana/id.json');
  const admin = new PublicKey(sandbox.admin);
  if (!payer.publicKey.equals(admin)) {
    throw new Error(
      `The configured Solana keypair ${payer.publicKey.toBase58()} is not the sandbox mint authority ${admin.toBase58()}.`,
    );
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const settlementMint = new PublicKey(sandbox.settlementMint);
  const settlementCap = parseUiAmount(
    readArgValue('--settlement') ??
      process.env.OFFPAY_RWA_DEVNET_SETTLEMENT_CAP ??
      DEFAULT_SETTLEMENT_CAP,
    DECIMALS,
  );
  const assetCapUiAmount =
    readArgValue('--asset') ?? process.env.OFFPAY_RWA_DEVNET_ASSET_CAP ?? DEFAULT_ASSET_CAP;
  const assets = selectAssets(readSandboxAssets(sandbox));
  const results = [];

  results.push(
    await topUpToken({
      connection,
      payer,
      recipient,
      mint: settlementMint,
      decimals: DECIMALS,
      capRawAmount: settlementCap,
      symbol: 'RWAUSDC',
    }),
  );

  for (const asset of assets) {
    const decimals = Number.isInteger(asset.decimals) ? Number(asset.decimals) : DECIMALS;
    results.push(
      await topUpToken({
        connection,
        payer,
        recipient,
        mint: new PublicKey(asset.mint),
        decimals,
        capRawAmount: parseUiAmount(assetCapUiAmount, decimals),
        symbol: asset.symbol,
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        network: 'devnet',
        rpcUrl,
        wallet: recipient.toBase58(),
        fundedAssets: assets.map((asset) => asset.symbol),
        tokens: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
