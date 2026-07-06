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
import {
  DEFAULT_JUPITER_RETRY_ATTEMPTS,
  paceSolanaRpcRead,
  paceSolanaTransaction,
  readRateLimitDelayMs,
  readPositiveIntegerEnv,
  withRetry,
} from './rwa-devnet-rate-limit.mjs';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_JUPITER_API_BASE_URL = 'https://api.jup.ag';
const DEFAULT_PROGRAM_ID = '4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7';
const DEFAULT_SANDBOX_PATH = 'target/rwa-devnet-sandbox.json';
const DEFAULT_DEVNET_PRICE_REFERENCE_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const DEFAULT_JUPITER_STOCK_SEARCH_QUERIES = ['xStock'];
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CONFIG_SEED = 'rwa_config';
const MARKET_SEED = 'rwa_market';
const VAULT_AUTHORITY_SEED = 'rwa_vault_authority';
const MINT_ACCOUNT_SIZE = 82;
const DECIMALS = 6;
const MAX_QUOTE_TTL_SECONDS = 300n;
const PRICE_TTL_SECONDS = 60n;
const VAULT_ASSET_SUPPLY = 1_000_000_000_000n;
const VAULT_SETTLEMENT_SUPPLY = 1_000_000_000_000n;
const ADMIN_ASSET_SUPPLY = 10_000_000_000n;
const ADMIN_SETTLEMENT_SUPPLY = 10_000_000_000n;

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

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readArgValue(name) {
  const prefixed = `${name}=`;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const inline = process.argv.find((entry) => entry.startsWith(prefixed));
  return inline == null ? null : inline.slice(prefixed.length);
}

function normalizeBaseUrl(rawValue) {
  return String(rawValue || DEFAULT_JUPITER_API_BASE_URL).replace(/\/$/, '');
}

function parseAssetLimit(rawValue) {
  const normalized = String(rawValue ?? 'all')
    .trim()
    .toLowerCase();
  if (normalized === 'all' || normalized === '*') return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('OFFPAY_RWA_DEVNET_ASSET_LIMIT/--limit must be a positive integer or "all".');
  }
  return parsed;
}

function isValidPublicKey(value) {
  try {
    new PublicKey(String(value));
    return true;
  } catch {
    return false;
  }
}

function readPublicKey(value, label) {
  if (!isValidPublicKey(value)) throw new Error(`${label} is not a valid Solana address.`);
  return new PublicKey(String(value));
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

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
}

function inferUnderlyingSymbol(symbol) {
  const normalized = String(symbol)
    .replace(/x$/i, '')
    .replace(/[^A-Za-z0-9.]/g, '')
    .toUpperCase();
  return normalized.length === 0 ? String(symbol).toUpperCase() : normalized;
}

function devnetSymbolFor(token, usedSymbols) {
  const underlying = inferUnderlyingSymbol(token.symbol);
  const base = `${underlying.slice(0, 20)}d`.slice(0, 24);
  if (!usedSymbols.has(base.toUpperCase())) {
    usedSymbols.add(base.toUpperCase());
    return base;
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `${index}`;
    const candidate = `${base.slice(0, 24 - suffix.length)}${suffix}`;
    if (!usedSymbols.has(candidate.toUpperCase())) {
      usedSymbols.add(candidate.toUpperCase());
      return candidate;
    }
  }

  throw new Error(`Unable to derive a unique devnet symbol for ${token.symbol}.`);
}

function devnetNameFor(token, underlyingSymbol) {
  const name = sanitizeText(token.name, 64);
  if (name == null) return `${underlyingSymbol} Sandbox RWA`;
  return `${name.replace(/\bxStock\b/gi, '').trim() || underlyingSymbol} Sandbox RWA`.slice(0, 80);
}

function readTags(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];
}

function isJupiterXStockToken(token) {
  if (typeof token !== 'object' || token === null) return false;
  const symbol = sanitizeText(token.symbol, 24) ?? '';
  const name = sanitizeText(token.name, 80) ?? '';
  const icon = sanitizeText(token.icon, 200) ?? '';

  return /x$/i.test(symbol) && (/xstock/i.test(name) || /xstocks-metadata\.backed\.fi/i.test(icon));
}

function isVerifiedStockToken(token) {
  if (typeof token !== 'object' || token === null) return false;
  const record = token;
  const tags = readTags(record.tags);
  const audit = typeof record.audit === 'object' && record.audit !== null ? record.audit : null;
  return (
    isValidPublicKey(record.id) &&
    sanitizeText(record.symbol, 24) != null &&
    sanitizeText(record.name, 80) != null &&
    (record.isVerified === true || tags.includes('verified') || isJupiterXStockToken(record)) &&
    audit?.isSus !== true
  );
}

function readJupiterTokenArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object' || payload === null) return null;

  for (const key of ['tokens', 'data', 'result', 'items']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object' && value !== null) {
      const nested = readJupiterTokenArray(value);
      if (nested != null) return nested;
    }
  }

  return null;
}

function describeJupiterPayload(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return `unexpected ${typeof payload} payload`;
  }

  const record = payload;
  const error = record.error;
  if (typeof error === 'string' && error.trim().length > 0) return error.trim();
  if (typeof error === 'object' && error !== null) {
    const errorMessage = sanitizeText(error.message, 240) ?? sanitizeText(error.code, 120);
    if (errorMessage != null) return errorMessage;
  }

  const message = sanitizeText(record.message, 240);
  if (message != null) return message;

  return `unexpected object payload with keys: ${Object.keys(record).slice(0, 8).join(', ')}`;
}

async function fetchJupiterTokenJson(baseUrl, apiKey, path, label) {
  return withRetry(
    label,
    async () => {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload == null
            ? `${label} failed with HTTP ${response.status}.`
            : `${label} failed with HTTP ${response.status}: ${describeJupiterPayload(payload)}.`;
        const error = new Error(message);
        error.retryAfter = response.headers.get('retry-after') ?? undefined;
        error.retryAfterMs = readRateLimitDelayMs(response.headers) ?? undefined;
        throw error;
      }

      if (payload != null && typeof payload === 'object' && payload.code === 429) {
        throw new Error(
          `${label} failed with Jupiter rate limit: ${describeJupiterPayload(payload)}.`,
        );
      }

      return payload;
    },
    {
      attempts: readPositiveIntegerEnv(
        'OFFPAY_RWA_JUPITER_RETRY_ATTEMPTS',
        DEFAULT_JUPITER_RETRY_ATTEMPTS,
      ),
      baseDelayMs: 1_000,
    },
  );
}

function readJupiterStockSearchQueries() {
  const rawValue = process.env.OFFPAY_RWA_JUPITER_STOCK_SEARCH_QUERIES?.trim();
  if (!rawValue) return DEFAULT_JUPITER_STOCK_SEARCH_QUERIES;

  const queries = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return queries.length > 0 ? queries : DEFAULT_JUPITER_STOCK_SEARCH_QUERIES;
}

async function fetchJupiterStocksFromSearch(baseUrl, apiKey) {
  const byMint = new Map();
  for (const query of readJupiterStockSearchQueries()) {
    const payload = await fetchJupiterTokenJson(
      baseUrl,
      apiKey,
      `/tokens/v2/search?query=${encodeURIComponent(query)}`,
      `Jupiter stock search for "${query}"`,
    );
    const tokens = readJupiterTokenArray(payload);
    if (tokens == null) {
      throw new Error(
        `Jupiter stock search for "${query}" returned an invalid response: ${describeJupiterPayload(
          payload,
        )}.`,
      );
    }

    for (const token of tokens.filter(isVerifiedStockToken)) {
      byMint.set(token.id, token);
    }
  }

  return Array.from(byMint.values());
}

async function fetchJupiterStocks() {
  const apiKey = process.env.JUPITER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Set JUPITER_API_KEY before creating the devnet RWA stock catalog.');
  }

  const baseUrl = normalizeBaseUrl(process.env.JUPITER_API_BASE_URL);
  let tagReason = 'unknown tag response';
  try {
    const payload = await fetchJupiterTokenJson(
      baseUrl,
      apiKey,
      '/tokens/v2/tag?query=stocks',
      'Jupiter stocks catalog',
    );
    const tokens = readJupiterTokenArray(payload);
    if (tokens != null) {
      const filtered = tokens.filter(isVerifiedStockToken);
      if (filtered.length > 0) return filtered;
    }
    tagReason = describeJupiterPayload(payload);
  } catch (error) {
    tagReason = error instanceof Error ? error.message : String(error);
  }

  console.warn(
    `Jupiter stocks tag is unavailable (${tagReason}); falling back to /tokens/v2/search?query=xStock.`,
  );
  const searchTokens = await fetchJupiterStocksFromSearch(baseUrl, apiKey);
  if (searchTokens.length === 0) {
    throw new Error(
      `Jupiter returned no verified xStock search results after the stocks tag failed: ${tagReason}.`,
    );
  }

  return searchTokens;
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

async function getAccountInfoWithRetry(connection, publicKey, label) {
  return withRetry(`${label} account lookup`, async () => {
    await paceSolanaRpcRead();
    return connection.getAccountInfo(publicKey, 'confirmed');
  });
}

async function getTokenAccountBalanceWithRetry(connection, tokenAccount, label) {
  return withRetry(`${label} token balance`, async () => {
    await paceSolanaRpcRead();
    return connection.getTokenAccountBalance(tokenAccount, 'confirmed');
  });
}

async function getMinimumBalanceForRentExemptionWithRetry(connection, space, label) {
  return withRetry(`${label} rent exemption`, async () => {
    await paceSolanaRpcRead();
    return connection.getMinimumBalanceForRentExemption(space);
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

async function tokenBalance(connection, tokenAccount, label) {
  try {
    const balance = await getTokenAccountBalanceWithRetry(connection, tokenAccount, label);
    return BigInt(balance.value.amount);
  } catch (error) {
    if (error instanceof Error && /could not find account/i.test(error.message)) return 0n;
    throw error;
  }
}

async function ensureMint({ connection, payer, mint, mintKeypair, label }) {
  const existing = await getAccountInfoWithRetry(connection, mint, label);
  if (existing != null) {
    console.log(`${label}: already exists (${mint.toBase58()})`);
    return;
  }
  if (mintKeypair == null) {
    throw new Error(`${label} ${mint.toBase58()} is missing on-chain and no keypair is available.`);
  }

  const mintRent = await getMinimumBalanceForRentExemptionWithRetry(
    connection,
    MINT_ACCOUNT_SIZE,
    label,
  );
  try {
    await send(
      connection,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint,
          lamports: mintRent,
          space: MINT_ACCOUNT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction({
          mint,
          decimals: DECIMALS,
          mintAuthority: payer.publicKey,
        }),
      ),
      [payer, mintKeypair],
      `created ${label}`,
    );
  } catch (error) {
    const maybeCreated = await getAccountInfoWithRetry(connection, mint, `${label} post-error`);
    if (maybeCreated != null) {
      console.log(`${label}: exists after retryable send error (${mint.toBase58()})`);
      return;
    }
    throw error;
  }
}

async function ensureTokenCap({
  connection,
  payer,
  owner,
  mint,
  tokenAccount,
  capRawAmount,
  label,
}) {
  const currentRawAmount = await tokenBalance(connection, tokenAccount, label);
  const topUpRawAmount = currentRawAmount >= capRawAmount ? 0n : capRawAmount - currentRawAmount;
  if (topUpRawAmount === 0n) {
    console.log(`${label} token cap: already satisfied`);
    return 0n;
  }

  const transaction = new Transaction().add(
    createAtaIdempotentInstruction({
      payer: payer.publicKey,
      owner,
      mint,
      associatedTokenAccount: tokenAccount,
    }),
  );

  transaction.add(
    createMintToInstruction({
      mint,
      destination: tokenAccount,
      authority: payer.publicKey,
      amount: topUpRawAmount,
    }),
  );

  try {
    await send(connection, transaction, [payer], `${label} token cap`);
  } catch (error) {
    const balanceAfterError = await tokenBalance(connection, tokenAccount, `${label} post-error`);
    if (balanceAfterError >= capRawAmount) {
      console.log(`${label} token cap: satisfied after retryable send error`);
      return balanceAfterError - currentRawAmount;
    }
    throw error;
  }
  return topUpRawAmount;
}

function readPreviousAssets(previous) {
  if (previous == null) return [];
  if (Array.isArray(previous.assets)) return previous.assets;
  if (typeof previous.assetMint !== 'string') return [];

  return [
    {
      mint: previous.assetMint,
      symbol: previous.assetSymbol ?? process.env.OFFPAY_RWA_DEVNET_SANDBOX_SYMBOL ?? 'AAPLd',
      name: previous.assetName ?? process.env.OFFPAY_RWA_DEVNET_SANDBOX_NAME ?? 'Apple Sandbox RWA',
      decimals: previous.assetDecimals ?? DECIMALS,
      priceReferenceMint:
        previous.priceReferenceMint ??
        process.env.OFFPAY_RWA_DEVNET_PRICE_REFERENCE_MINT ??
        DEFAULT_DEVNET_PRICE_REFERENCE_MINT,
      market: previous.market,
      assetVault: previous.assetVault,
      adminAssetAccount: previous.adminAssetAccount,
    },
  ];
}

function buildTargetAssets(tokens, previousAssets, limit) {
  const previousByReferenceMint = new Map(
    previousAssets
      .filter((entry) => typeof entry?.priceReferenceMint === 'string')
      .map((entry) => [entry.priceReferenceMint, entry]),
  );
  const usedSymbols = new Set();
  const selectedTokens = tokens.slice(0, Number.isFinite(limit) ? limit : tokens.length);

  return selectedTokens.map((token) => {
    const previous = previousByReferenceMint.get(token.id);
    const underlyingSymbol = inferUnderlyingSymbol(token.symbol);
    const symbol = devnetSymbolFor(token, usedSymbols);
    usedSymbols.add(String(symbol).toUpperCase());
    return {
      existingMint: previous?.mint ?? null,
      mintKeypair: previous?.mint ? null : Keypair.generate(),
      symbol,
      name: devnetNameFor(token, underlyingSymbol),
      decimals: DECIMALS,
      priceReferenceMint: token.id,
      logo: sanitizeText(token.icon ?? token.logoURI, 240),
      underlyingSymbol,
      sourceSymbol: token.symbol,
      sourceName: token.name,
      previous,
    };
  });
}

function catalogForWorker(summaryAssets) {
  return summaryAssets.map((asset) => ({
    mint: asset.mint,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    priceReferenceMint: asset.priceReferenceMint,
    underlyingSymbol: asset.underlyingSymbol,
  }));
}

async function main() {
  const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || DEFAULT_RPC_URL;
  const programId = readPublicKey(
    process.env.OFFPAY_RWA_DELEGATE_PROGRAM_ID || DEFAULT_PROGRAM_ID,
    'RWA delegate program id',
  );
  const payer = readKeypair(process.env.SOLANA_KEYPAIR || '~/.config/solana/id.json');
  const admin = payer.publicKey;
  const connection = new Connection(rpcUrl, 'confirmed');
  const sandboxPath =
    readArgValue('--sandbox') ?? process.env.OFFPAY_RWA_DEVNET_SANDBOX_PATH ?? DEFAULT_SANDBOX_PATH;
  const previous = readJsonFileIfExists(sandboxPath);
  const stocks = await fetchJupiterStocks();
  const limit = parseAssetLimit(
    readArgValue('--limit') ?? process.env.OFFPAY_RWA_DEVNET_ASSET_LIMIT ?? 'all',
  );
  const targetAssets = buildTargetAssets(stocks, readPreviousAssets(previous), limit);

  if (targetAssets.length === 0) {
    throw new Error('Jupiter returned no verified stock tokens for the devnet sandbox.');
  }

  const settlementMintKeypair = previous?.settlementMint ? null : Keypair.generate();
  const settlementMint = previous?.settlementMint
    ? readPublicKey(previous.settlementMint, 'Previous RWA settlement mint')
    : settlementMintKeypair.publicKey;
  const [config] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId);
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_AUTHORITY_SEED)],
    programId,
  );
  const settlementVault = associatedTokenAddress(vaultAuthority, settlementMint);
  const adminSettlementAccount = associatedTokenAddress(admin, settlementMint);

  await ensureMint({
    connection,
    payer,
    mint: settlementMint,
    mintKeypair: settlementMintKeypair,
    label: 'RWA settlement mint',
  });

  await ensureTokenCap({
    connection,
    payer,
    owner: vaultAuthority,
    mint: settlementMint,
    tokenAccount: settlementVault,
    capRawAmount: VAULT_SETTLEMENT_SUPPLY,
    label: 'settlement vault',
  });
  await ensureTokenCap({
    connection,
    payer,
    owner: admin,
    mint: settlementMint,
    tokenAccount: adminSettlementAccount,
    capRawAmount: ADMIN_SETTLEMENT_SUPPLY,
    label: 'admin settlement',
  });

  const configInfo = await getAccountInfoWithRetry(connection, config, 'RWA config');
  if (configInfo == null) {
    try {
      await send(
        connection,
        new Transaction().add(
          initializeConfigInstruction({
            programId,
            config,
            admin,
            settlementMint,
          }),
        ),
        [payer],
        'initialized RWA config',
      );
    } catch (error) {
      const maybeInitialized = await getAccountInfoWithRetry(
        connection,
        config,
        'RWA config post-error',
      );
      if (maybeInitialized == null) throw error;
      console.log(
        `initialized RWA config: exists after retryable send error (${config.toBase58()})`,
      );
    }
  } else {
    console.log(`initialized RWA config: already exists (${config.toBase58()})`);
  }

  const summaryAssets = [];
  for (const target of targetAssets) {
    const assetMint = target.existingMint
      ? readPublicKey(target.existingMint, `${target.symbol} mint`)
      : target.mintKeypair.publicKey;
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from(MARKET_SEED), assetMint.toBuffer()],
      programId,
    );
    const assetVault = associatedTokenAddress(vaultAuthority, assetMint);
    const adminAssetAccount = associatedTokenAddress(admin, assetMint);

    await ensureMint({
      connection,
      payer,
      mint: assetMint,
      mintKeypair: target.mintKeypair,
      label: `${target.symbol} asset mint`,
    });

    await ensureTokenCap({
      connection,
      payer,
      owner: vaultAuthority,
      mint: assetMint,
      tokenAccount: assetVault,
      capRawAmount: VAULT_ASSET_SUPPLY,
      label: `${target.symbol} asset vault`,
    });
    await ensureTokenCap({
      connection,
      payer,
      owner: admin,
      mint: assetMint,
      tokenAccount: adminAssetAccount,
      capRawAmount: ADMIN_ASSET_SUPPLY,
      label: `${target.symbol} admin asset`,
    });

    const marketInfo = await getAccountInfoWithRetry(connection, market, `${target.symbol} market`);
    if (marketInfo == null) {
      try {
        await send(
          connection,
          new Transaction().add(
            initializeMarketInstruction({
              programId,
              config,
              market,
              admin,
              assetMint,
              settlementMint,
              assetVault,
              settlementVault,
              vaultAuthority,
            }),
          ),
          [payer],
          `initialized ${target.symbol} RWA sandbox market`,
        );
      } catch (error) {
        const maybeInitialized = await getAccountInfoWithRetry(
          connection,
          market,
          `${target.symbol} market post-error`,
        );
        if (maybeInitialized == null) throw error;
        console.log(
          `initialized ${target.symbol} RWA sandbox market: exists after retryable send error`,
        );
      }
    } else {
      console.log(`initialized ${target.symbol} RWA sandbox market: already exists`);
    }

    summaryAssets.push({
      symbol: target.symbol,
      name: target.name,
      mint: assetMint.toBase58(),
      decimals: target.decimals,
      priceReferenceMint: target.priceReferenceMint,
      logo: target.logo,
      underlyingSymbol: target.underlyingSymbol,
      sourceSymbol: target.sourceSymbol,
      sourceName: target.sourceName,
      market: market.toBase58(),
      assetVault: assetVault.toBase58(),
      settlementVault: settlementVault.toBase58(),
      adminAssetAccount: adminAssetAccount.toBase58(),
      assetVaultUiAmount: '1000000',
      adminAssetUiAmount: '10000',
    });
  }

  const firstAsset = summaryAssets[0];
  const summary = {
    network: 'devnet',
    rpcUrl,
    programId: programId.toBase58(),
    admin: admin.toBase58(),
    config: config.toBase58(),
    vaultAuthority: vaultAuthority.toBase58(),
    settlementMint: settlementMint.toBase58(),
    settlementVault: settlementVault.toBase58(),
    adminSettlementAccount: adminSettlementAccount.toBase58(),
    settlementVaultUiAmount: '1000000',
    adminSettlementUiAmount: '10000',
    assets: summaryAssets,
    market: firstAsset.market,
    assetMint: firstAsset.mint,
    assetSymbol: firstAsset.symbol,
    assetName: firstAsset.name,
    assetDecimals: firstAsset.decimals,
    priceReferenceMint: firstAsset.priceReferenceMint,
    assetVault: firstAsset.assetVault,
    adminAssetAccount: firstAsset.adminAssetAccount,
    assetVaultUiAmount: firstAsset.assetVaultUiAmount,
    adminAssetUiAmount: firstAsset.adminAssetUiAmount,
  };
  const workerCatalog = catalogForWorker(summaryAssets);

  fs.mkdirSync(path.dirname(sandboxPath), { recursive: true });
  fs.writeFileSync(sandboxPath, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(
    path.join(path.dirname(sandboxPath), 'rwa-devnet-assets.worker.json'),
    `${JSON.stringify(workerCatalog)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nWorker vars:');
  console.log(`OFFPAY_RWA_DEVNET_SETTLEMENT_MINT=${summary.settlementMint}`);
  console.log(`OFFPAY_RWA_DEVNET_ASSETS_JSON='${JSON.stringify(workerCatalog)}'`);
  console.log('\nWorker secret command for the asset catalog:');
  console.log(
    'npx wrangler secret put OFFPAY_RWA_DEVNET_ASSETS_JSON --config workers/api/wrangler.toml < target/rwa-devnet-assets.worker.json',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
