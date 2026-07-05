#!/usr/bin/env node
import crypto from 'node:crypto';
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

const DEFAULT_API_ORIGIN = 'https://offpay-api.mail-offpay.workers.dev';
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_SANDBOX_PATH = 'target/rwa-devnet-sandbox.json';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CONFIG_SEED = 'rwa_config';
const INTENT_SEED = 'rwa_intent';
const MARKET_SEED = 'rwa_market';
const VAULT_AUTHORITY_SEED = 'rwa_vault_authority';
const DECIMALS = 6;
const DEFAULT_BUY_CASH = '1';

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

function readArgValue(name) {
  const prefixed = `${name}=`;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const inline = process.argv.find((entry) => entry.startsWith(prefixed));
  return inline == null ? null : inline.slice(prefixed.length);
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
  return BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
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

function i64Le(value) {
  const data = Buffer.alloc(8);
  data.writeBigInt64LE(value);
  return data;
}

function anchorDiscriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function randomNonce() {
  return crypto.randomBytes(16);
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
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

function quoteHash(params) {
  const payload = [
    'offpay-rwa-devnet-sandbox:v1',
    params.walletAddress,
    params.side,
    params.assetMint,
    params.settlementMint,
    params.quantityAtoms.toString(),
    params.cashAtoms.toString(),
    params.priceMicros.toString(),
    params.quoteExpiresAt.toString(),
    toHex(params.nonce),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest();
}

function derivePdas({ programId, owner, assetMint, nonce }) {
  return {
    config: PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId)[0],
    intent: PublicKey.findProgramAddressSync(
      [Buffer.from(INTENT_SEED), owner.toBuffer(), Buffer.from(nonce)],
      programId,
    )[0],
    market: PublicKey.findProgramAddressSync(
      [Buffer.from(MARKET_SEED), assetMint.toBuffer()],
      programId,
    )[0],
    vaultAuthority: PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_AUTHORITY_SEED)],
      programId,
    )[0],
  };
}

function createIntentInstruction(params) {
  const data = Buffer.alloc(8 + 16 + 32 + 32 + 1 + 8 + 8 + 32 + 8);
  anchorDiscriminator('create_intent').copy(data, 0);
  Buffer.from(params.nonce).copy(data, 8);
  params.assetMint.toBuffer().copy(data, 24);
  params.settlementMint.toBuffer().copy(data, 56);
  data.writeUInt8(params.side === 'buy' ? 0 : 1, 88);
  u64Le(params.quantityAtoms).copy(data, 89);
  u64Le(params.cashAtoms).copy(data, 97);
  Buffer.from(params.hash).copy(data, 105);
  i64Le(BigInt(params.quoteExpiresAt)).copy(data, 137);

  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.config, isSigner: false, isWritable: false },
      { pubkey: params.intent, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function settleSandboxInstruction(params) {
  const data = Buffer.alloc(8 + 32 + 16);
  anchorDiscriminator('settle_sandbox').copy(data, 0);
  params.owner.toBuffer().copy(data, 8);
  Buffer.from(params.nonce).copy(data, 40);

  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.config, isSigner: false, isWritable: false },
      { pubkey: params.market, isSigner: false, isWritable: true },
      { pubkey: params.intent, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.userAssetAccount, isSigner: false, isWritable: true },
      { pubkey: params.userSettlementAccount, isSigner: false, isWritable: true },
      { pubkey: params.assetVault, isSigner: false, isWritable: true },
      { pubkey: params.settlementVault, isSigner: false, isWritable: true },
      { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function tokenBalance(connection, tokenAccount) {
  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount, 'confirmed');
    return BigInt(balance.value.amount);
  } catch (error) {
    if (error instanceof Error && /could not find account/i.test(error.message)) return 0n;
    throw error;
  }
}

async function latestAaplPrice(apiOrigin) {
  const response = await fetch(`${apiOrigin.replace(/\/$/, '')}/api/rwa/assets?network=devnet`);
  if (!response.ok) {
    throw new Error(`RWA assets endpoint failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  const asset = payload?.assets?.find((entry) => entry?.symbol === 'AAPLd');
  if (!asset || typeof asset.priceUsd !== 'number' || !Number.isFinite(asset.priceUsd)) {
    throw new Error('AAPLd devnet sandbox price is unavailable.');
  }
  return asset.priceUsd;
}

async function ensureFunding({ connection, payer, recipient, assetMint, settlementMint, cashAtoms }) {
  const assetAccount = associatedTokenAddress(recipient, assetMint);
  const settlementAccount = associatedTokenAddress(recipient, settlementMint);
  const currentSettlement = await tokenBalance(connection, settlementAccount);
  const settlementTopUp = currentSettlement >= cashAtoms ? 0n : cashAtoms - currentSettlement;
  const transaction = new Transaction().add(
    createAtaIdempotentInstruction({
      payer: payer.publicKey,
      owner: recipient,
      mint: assetMint,
      associatedTokenAccount: assetAccount,
    }),
    createAtaIdempotentInstruction({
      payer: payer.publicKey,
      owner: recipient,
      mint: settlementMint,
      associatedTokenAccount: settlementAccount,
    }),
  );

  if (settlementTopUp > 0n) {
    transaction.add(
      createMintToInstruction({
        mint: settlementMint,
        destination: settlementAccount,
        authority: payer.publicKey,
        amount: settlementTopUp,
      }),
    );
  }

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
    skipPreflight: false,
  });

  return {
    signature,
    assetAccount,
    settlementAccount,
    settlementTopUp,
  };
}

async function sendSandboxTrade({
  connection,
  payer,
  programId,
  owner,
  assetMint,
  settlementMint,
  side,
  quantityAtoms,
  cashAtoms,
  priceMicros,
}) {
  const nonce = randomNonce();
  const pdas = derivePdas({ programId, owner, assetMint, nonce });
  const userAssetAccount = associatedTokenAddress(owner, assetMint);
  const userSettlementAccount = associatedTokenAddress(owner, settlementMint);
  const assetVault = associatedTokenAddress(pdas.vaultAuthority, assetMint);
  const settlementVault = associatedTokenAddress(pdas.vaultAuthority, settlementMint);
  const quoteExpiresAt = Math.floor(Date.now() / 1000) + 60;
  const hash = quoteHash({
    walletAddress: owner.toBase58(),
    side,
    assetMint: assetMint.toBase58(),
    settlementMint: settlementMint.toBase58(),
    quantityAtoms,
    cashAtoms,
    priceMicros,
    quoteExpiresAt,
    nonce,
  });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash,
  }).add(
    createAtaIdempotentInstruction({
      payer: owner,
      owner,
      mint: assetMint,
      associatedTokenAccount: userAssetAccount,
    }),
    createAtaIdempotentInstruction({
      payer: owner,
      owner,
      mint: settlementMint,
      associatedTokenAccount: userSettlementAccount,
    }),
    createIntentInstruction({
      programId,
      config: pdas.config,
      intent: pdas.intent,
      owner,
      nonce,
      assetMint,
      settlementMint,
      side,
      quantityAtoms,
      cashAtoms,
      hash,
      quoteExpiresAt,
    }),
    settleSandboxInstruction({
      programId,
      config: pdas.config,
      market: pdas.market,
      intent: pdas.intent,
      owner,
      nonce,
      userAssetAccount,
      userSettlementAccount,
      assetVault,
      settlementVault,
      vaultAuthority: pdas.vaultAuthority,
    }),
  );
  transaction.lastValidBlockHeight = lastValidBlockHeight;

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
    skipPreflight: false,
  });

  return {
    signature,
    intent: pdas.intent.toBase58(),
    quantityAtoms,
    cashAtoms,
  };
}

async function main() {
  const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || DEFAULT_RPC_URL;
  const apiOrigin = process.env.OFFPAY_API_ORIGIN || DEFAULT_API_ORIGIN;
  const sandboxPath = readArgValue('--sandbox') ?? process.env.OFFPAY_RWA_DEVNET_SANDBOX_PATH ?? DEFAULT_SANDBOX_PATH;
  const buyCash = readArgValue('--buy-cash') ?? process.env.OFFPAY_RWA_DEVNET_BUY_CASH ?? DEFAULT_BUY_CASH;
  const sandbox = JSON.parse(fs.readFileSync(sandboxPath, 'utf8'));
  const payer = readKeypair(process.env.SOLANA_KEYPAIR || '~/.config/solana/id.json');
  if (payer.publicKey.toBase58() !== sandbox.admin) {
    throw new Error(`Configured keypair ${payer.publicKey.toBase58()} is not sandbox admin ${sandbox.admin}.`);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const owner = payer.publicKey;
  const programId = new PublicKey(sandbox.programId);
  const assetMint = new PublicKey(sandbox.assetMint);
  const settlementMint = new PublicKey(sandbox.settlementMint);
  const priceUsd = await latestAaplPrice(apiOrigin);
  const priceMicros = BigInt(Math.round(priceUsd * 1_000_000));
  const cashAtoms = parseUiAmount(buyCash, DECIMALS);
  const quantityAtoms = (cashAtoms * 10n ** BigInt(DECIMALS)) / priceMicros;
  if (quantityAtoms <= 0n) {
    throw new Error('Buy amount is too small for the current AAPLd price.');
  }

  const funding = await ensureFunding({
    connection,
    payer,
    recipient: owner,
    assetMint,
    settlementMint,
    cashAtoms,
  });
  const balancesBefore = {
    asset: await tokenBalance(connection, funding.assetAccount),
    settlement: await tokenBalance(connection, funding.settlementAccount),
  };
  const buy = await sendSandboxTrade({
    connection,
    payer,
    programId,
    owner,
    assetMint,
    settlementMint,
    side: 'buy',
    quantityAtoms,
    cashAtoms,
    priceMicros,
  });
  const sellCashAtoms = (quantityAtoms * priceMicros) / 10n ** BigInt(DECIMALS);
  const sell = await sendSandboxTrade({
    connection,
    payer,
    programId,
    owner,
    assetMint,
    settlementMint,
    side: 'sell',
    quantityAtoms,
    cashAtoms: sellCashAtoms,
    priceMicros,
  });
  const balancesAfter = {
    asset: await tokenBalance(connection, funding.assetAccount),
    settlement: await tokenBalance(connection, funding.settlementAccount),
  };

  console.log(JSON.stringify({
    network: 'devnet',
    rpcUrl,
    apiOrigin,
    programId: programId.toBase58(),
    wallet: owner.toBase58(),
    assetMint: assetMint.toBase58(),
    settlementMint: settlementMint.toBase58(),
    priceUsd,
    funding: {
      signature: funding.signature,
      settlementTopUp: formatUiAmount(funding.settlementTopUp, DECIMALS),
    },
    buy: {
      signature: buy.signature,
      intent: buy.intent,
      cashAmount: formatUiAmount(cashAtoms, DECIMALS),
      quantity: formatUiAmount(quantityAtoms, DECIMALS),
    },
    sell: {
      signature: sell.signature,
      intent: sell.intent,
      cashAmount: formatUiAmount(sellCashAtoms, DECIMALS),
      quantity: formatUiAmount(quantityAtoms, DECIMALS),
    },
    balancesBefore: {
      AAPLd: formatUiAmount(balancesBefore.asset, DECIMALS),
      RWAUSDC: formatUiAmount(balancesBefore.settlement, DECIMALS),
    },
    balancesAfter: {
      AAPLd: formatUiAmount(balancesAfter.asset, DECIMALS),
      RWAUSDC: formatUiAmount(balancesAfter.settlement, DECIMALS),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
