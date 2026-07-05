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

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_PROGRAM_ID = '4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CONFIG_SEED = 'rwa_config';
const MARKET_SEED = 'rwa_market';
const VAULT_AUTHORITY_SEED = 'rwa_vault_authority';
const MINT_ACCOUNT_SIZE = 82;
const DECIMALS = 6;
const MAX_QUOTE_TTL_SECONDS = 300n;
const PRICE_TTL_SECONDS = 60n;
const VAULT_ASSET_SUPPLY = 1_000_000_000_000n; // 1,000,000 AAPLd at 6 decimals
const VAULT_SETTLEMENT_SUPPLY = 1_000_000_000_000n; // 1,000,000 sandbox USDC at 6 decimals
const ADMIN_ASSET_SUPPLY = 10_000_000_000n; // 10,000 AAPLd for sell testing
const ADMIN_SETTLEMENT_SUPPLY = 10_000_000_000n; // 10,000 sandbox USDC for buy testing

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

function createInitializeMintInstruction({ mint, decimals, mintAuthority }) {
  const data = Buffer.concat([
    Buffer.from([0, decimals]),
    mintAuthority.toBuffer(),
    Buffer.from([0, 0, 0, 0]),
  ]);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
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

function initializeConfigInstruction({ programId, config, admin, settlementMint }) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('initialize_config'),
      admin.toBuffer(),
      admin.toBuffer(),
      settlementMint.toBuffer(),
      i64Le(MAX_QUOTE_TTL_SECONDS),
    ]),
  });
}

function initializeMarketInstruction({
  programId,
  config,
  market,
  admin,
  assetMint,
  settlementMint,
  assetVault,
  settlementVault,
  vaultAuthority,
}) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: assetMint, isSigner: false, isWritable: false },
      { pubkey: settlementMint, isSigner: false, isWritable: false },
      { pubkey: assetVault, isSigner: false, isWritable: false },
      { pubkey: settlementVault, isSigner: false, isWritable: false },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorDiscriminator('initialize_market'), i64Le(PRICE_TTL_SECONDS)]),
  });
}

async function send(connection, transaction, signers, label) {
  const signature = await sendAndConfirmTransaction(connection, transaction, signers, {
    commitment: 'confirmed',
    skipPreflight: false,
  });
  console.log(`${label}: ${signature}`);
  return signature;
}

async function main() {
  const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || DEFAULT_RPC_URL;
  const programId = new PublicKey(process.env.OFFPAY_RWA_DELEGATE_PROGRAM_ID || DEFAULT_PROGRAM_ID);
  const payer = readKeypair(process.env.SOLANA_KEYPAIR || '~/.config/solana/id.json');
  const admin = payer.publicKey;
  const connection = new Connection(rpcUrl, 'confirmed');

  const assetMint = Keypair.generate();
  const settlementMint = Keypair.generate();
  const [config] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from(MARKET_SEED), assetMint.publicKey.toBuffer()],
    programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_AUTHORITY_SEED)],
    programId,
  );
  const assetVault = associatedTokenAddress(vaultAuthority, assetMint.publicKey);
  const settlementVault = associatedTokenAddress(vaultAuthority, settlementMint.publicKey);
  const adminAssetAccount = associatedTokenAddress(admin, assetMint.publicKey);
  const adminSettlementAccount = associatedTokenAddress(admin, settlementMint.publicKey);
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_ACCOUNT_SIZE);

  await send(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin,
        newAccountPubkey: assetMint.publicKey,
        lamports: mintRent,
        space: MINT_ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction({
        mint: assetMint.publicKey,
        decimals: DECIMALS,
        mintAuthority: admin,
      }),
      SystemProgram.createAccount({
        fromPubkey: admin,
        newAccountPubkey: settlementMint.publicKey,
        lamports: mintRent,
        space: MINT_ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction({
        mint: settlementMint.publicKey,
        decimals: DECIMALS,
        mintAuthority: admin,
      }),
    ),
    [payer, assetMint, settlementMint],
    'created sandbox mints',
  );

  await send(
    connection,
    new Transaction().add(
      createAtaIdempotentInstruction({
        payer: admin,
        owner: vaultAuthority,
        mint: assetMint.publicKey,
        associatedTokenAccount: assetVault,
      }),
      createAtaIdempotentInstruction({
        payer: admin,
        owner: vaultAuthority,
        mint: settlementMint.publicKey,
        associatedTokenAccount: settlementVault,
      }),
      createAtaIdempotentInstruction({
        payer: admin,
        owner: admin,
        mint: assetMint.publicKey,
        associatedTokenAccount: adminAssetAccount,
      }),
      createAtaIdempotentInstruction({
        payer: admin,
        owner: admin,
        mint: settlementMint.publicKey,
        associatedTokenAccount: adminSettlementAccount,
      }),
    ),
    [payer],
    'created sandbox token accounts',
  );

  await send(
    connection,
    new Transaction().add(
      createMintToInstruction({
        mint: assetMint.publicKey,
        destination: assetVault,
        authority: admin,
        amount: VAULT_ASSET_SUPPLY,
      }),
      createMintToInstruction({
        mint: settlementMint.publicKey,
        destination: settlementVault,
        authority: admin,
        amount: VAULT_SETTLEMENT_SUPPLY,
      }),
      createMintToInstruction({
        mint: assetMint.publicKey,
        destination: adminAssetAccount,
        authority: admin,
        amount: ADMIN_ASSET_SUPPLY,
      }),
      createMintToInstruction({
        mint: settlementMint.publicKey,
        destination: adminSettlementAccount,
        authority: admin,
        amount: ADMIN_SETTLEMENT_SUPPLY,
      }),
    ),
    [payer],
    'funded sandbox vaults and admin test accounts',
  );

  const configInfo = await connection.getAccountInfo(config, 'confirmed');
  if (configInfo == null) {
    await send(
      connection,
      new Transaction().add(
        initializeConfigInstruction({
          programId,
          config,
          admin,
          settlementMint: settlementMint.publicKey,
        }),
      ),
      [payer],
      'initialized RWA config',
    );
  } else {
    console.log(`initialized RWA config: already exists (${config.toBase58()})`);
  }

  await send(
    connection,
    new Transaction().add(
      initializeMarketInstruction({
        programId,
        config,
        market,
        admin,
        assetMint: assetMint.publicKey,
        settlementMint: settlementMint.publicKey,
        assetVault,
        settlementVault,
        vaultAuthority,
      }),
    ),
    [payer],
    'initialized RWA sandbox market',
  );

  const summary = {
    network: 'devnet',
    rpcUrl,
    programId: programId.toBase58(),
    admin: admin.toBase58(),
    config: config.toBase58(),
    market: market.toBase58(),
    vaultAuthority: vaultAuthority.toBase58(),
    assetMint: assetMint.publicKey.toBase58(),
    settlementMint: settlementMint.publicKey.toBase58(),
    assetVault: assetVault.toBase58(),
    settlementVault: settlementVault.toBase58(),
    adminAssetAccount: adminAssetAccount.toBase58(),
    adminSettlementAccount: adminSettlementAccount.toBase58(),
    assetVaultUiAmount: '1000000',
    settlementVaultUiAmount: '1000000',
    adminAssetUiAmount: '10000',
    adminSettlementUiAmount: '10000',
  };
  fs.mkdirSync('target', { recursive: true });
  fs.writeFileSync('target/rwa-devnet-sandbox.json', `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nWorker vars:');
  console.log(`OFFPAY_RWA_DEVNET_SANDBOX_MINT=${summary.assetMint}`);
  console.log(`OFFPAY_RWA_DEVNET_SETTLEMENT_MINT=${summary.settlementMint}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
