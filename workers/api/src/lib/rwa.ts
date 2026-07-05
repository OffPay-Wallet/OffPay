import { Buffer } from 'buffer';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { AppError } from './errors.js';
import {
  broadcastRawTransaction,
  getLatestBlockhash,
} from './helius.js';
import {
  createSwapQuote,
  executeSwapQuote,
  type SwapQuoteResponse,
} from './jupiter.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  sanitizeText,
} from './provider-utils.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

type RwaAssetCategory = 'equity' | 'etf' | 'treasury' | 'commodity' | 'unknown';
type RwaProvider = 'jupiter_stocks' | 'offpay_devnet_sandbox';
type RwaExecutionMode = 'jupiter_swap' | 'devnet_sandbox' | 'issuer' | 'disabled';
type RwaRiskLevel = 'sandbox' | 'regulated' | 'high';
type RwaProviderEnvironment = 'production' | 'devnet_sandbox';

interface RwaExecutionPolicy {
  buy: RwaExecutionMode;
  sell: RwaExecutionMode;
  transfer: RwaExecutionMode;
  magicBlock: RwaExecutionMode;
}

interface RwaAsset {
  id: string;
  symbol: string;
  name: string;
  mint: string;
  decimals: number | null;
  network: Network;
  category: RwaAssetCategory;
  provider: RwaProvider;
  providerLabel: string;
  providerEnvironment: RwaProviderEnvironment;
  tokenProgramId: string | null;
  settlementMint: string;
  settlementSymbol: 'USDC';
  priceUsd: number | null;
  change24hPct: number | null;
  verified: boolean;
  tradable: boolean;
  devnetSandbox: boolean;
  magicBlockEligible: boolean;
  riskLevel: RwaRiskLevel;
  logo: string | null;
  underlyingSymbol: string | null;
  complianceLabel: string;
  execution: RwaExecutionPolicy;
}

interface RwaAssetsResponse {
  network: Network;
  mode: 'jupiter_stocks' | 'devnet_sandbox' | 'devnet_unavailable';
  provider: RwaProvider;
  providerEnvironment: RwaProviderEnvironment;
  assets: RwaAsset[];
  fetchedAt: number;
}

interface RwaPriceResponse {
  network: Network;
  mint: string;
  symbol: string;
  price: number | null;
  currency: 'USD';
  change24hPct: number | null;
  provider: RwaProvider;
  providerEnvironment: RwaProviderEnvironment;
  fetchedAt: number;
}

interface RwaQuoteRequest {
  assetMint?: string;
  assetSymbol?: string;
  quantity?: string;
  cashAmount?: string;
  side?: 'buy' | 'sell';
  network: Network;
  walletAddress: string;
}

interface RwaQuoteResponse {
  quoteId: string;
  assetMint: string | null;
  assetSymbol: string | null;
  settlementMint: string | null;
  settlementSymbol: 'USDC' | null;
  side: 'buy' | 'sell';
  priceUsd: number | null;
  quantity: string | null;
  cashAmount: string | null;
  priceImpactPct: number;
  routeSummary: string;
  fee: string;
  slippageBps: number | null;
  expiresAt: number | null;
  provider: RwaProvider;
  providerEnvironment: RwaProviderEnvironment;
  unsignedTransaction: string;
  transactionFormat: 'solana_legacy_transaction_base64' | 'solana_versioned_transaction_base64';
  sandboxIntent?: {
    programId: string;
    intent: string;
    market: string;
    nonce: string;
    quoteHash: string;
  };
}

interface RwaExecuteRequest {
  quoteId: string;
  signedTransaction: string;
  network: Network;
  walletAddress: string;
}

interface RwaExecuteResponse {
  quoteId: string;
  network: Network;
  signature: string;
  status: 'submitted';
  submittedAt: number;
  provider: RwaProvider;
}

type RwaFetchImplementation = typeof fetch;

interface JupiterToken {
  id?: unknown;
  address?: unknown;
  name?: unknown;
  symbol?: unknown;
  icon?: unknown;
  logoURI?: unknown;
  decimals?: unknown;
  tokenProgram?: unknown;
  isVerified?: unknown;
  tags?: unknown;
}

const DEFAULT_JUPITER_API_BASE_URL = 'https://api.jup.ag';
const DEFAULT_MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const DEFAULT_DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DEFAULT_RWA_DELEGATE_PROGRAM_ID = '4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7';
const DEFAULT_DEVNET_PRICE_REFERENCE_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const DEFAULT_ASSET_LIMIT = 48;
const PRICE_LOOKUP_LIMIT = 16;
const JUPITER_TIMEOUT_MS = 12_000;
const USDC_DECIMALS = 6;
const DEFAULT_MAX_PRICE_IMPACT_BPS = 200;
const MAX_PRICE_IMPACT_BPS_LIMIT = 10_000;
const MIN_QUOTE_TTL_MS = 5_000;
const DEVNET_SANDBOX_QUOTE_TTL_MS = 60_000;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSVAR_RENT_PROGRAM_ID = 'SysvarRent111111111111111111111111111111111';
const CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION = 1;
const U64_MAX = (1n << 64n) - 1n;
const CONFIG_SEED = 'rwa_config';
const INTENT_SEED = 'rwa_intent';
const MARKET_SEED = 'rwa_market';
const VAULT_AUTHORITY_SEED = 'rwa_vault_authority';

interface DevnetSandboxConfig {
  assetMint: string;
  settlementMint: string;
  priceReferenceMint: string;
  symbol: string;
  name: string;
  decimals: number;
  programId: string;
}

let rwaFetchImplementation: RwaFetchImplementation = (input, init) => fetch(input, init);

function readJupiterApiBaseUrl(bindings: Bindings): string {
  const configuredUrl = bindings.JUPITER_API_BASE_URL?.trim() || DEFAULT_JUPITER_API_BASE_URL;

  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported Jupiter API protocol.');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Jupiter API configuration is unavailable.',
      retryable: true,
      cause: error,
    });
  }
}

async function fetchJupiterJson(bindings: Bindings, path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JUPITER_TIMEOUT_MS);

  try {
    const response = await rwaFetchImplementation(`${readJupiterApiBaseUrl(bindings)}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': getRequiredBinding(bindings, 'JUPITER_API_KEY'),
        ...(init?.headers ?? {}),
      },
      signal: init?.signal ?? controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new AppError({
        status: response.status === 401 || response.status === 403 ? 503 : 502,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Jupiter RWA market data is currently unavailable.',
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Jupiter RWA market data is currently unavailable.',
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function readTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((entry) => readTrimmedString(entry)?.toLowerCase())
      .filter((entry): entry is string => entry != null)
    : [];
}

function readTokenMint(token: JupiterToken): string | null {
  const mint = readTrimmedString(token.id) ?? readTrimmedString(token.address);
  return mint != null && isValidSolanaAddress(mint) ? mint : null;
}

function readTokenDecimals(token: JupiterToken): number | null {
  const decimals = readFiniteNumber(token.decimals);
  return decimals != null && Number.isInteger(decimals) && decimals >= 0 ? decimals : null;
}

function inferCategory(name: string, symbol: string): RwaAssetCategory {
  const haystack = `${name} ${symbol}`.toLowerCase();
  if (/\betf\b|fund|trust|spy|spx|qqq|index/.test(haystack)) return 'etf';
  if (/treasury|bond|bill/.test(haystack)) return 'treasury';
  if (/gold|silver|commodity/.test(haystack)) return 'commodity';
  return 'equity';
}

function inferUnderlyingSymbol(symbol: string): string | null {
  const normalized = symbol
    .replace(/x$/i, '')
    .replace(/^b/i, '')
    .replace(/[^A-Za-z0-9.]/g, '')
    .toUpperCase();
  return normalized.length === 0 || normalized === symbol.toUpperCase() ? null : normalized;
}

function readMainnetUsdcMint(bindings: Bindings): string {
  const mint = bindings.OFFPAY_MAINNET_USDC_MINT?.trim() || DEFAULT_MAINNET_USDC_MINT;
  if (!isValidSolanaAddress(mint)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Mainnet USDC configuration is unavailable.',
      retryable: true,
    });
  }
  return mint;
}

function assertSolanaAddress(value: string, label: string): string {
  const normalized = value.trim();
  if (!isValidSolanaAddress(normalized)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: `${label} is not configured with a valid Solana address.`,
      retryable: true,
    });
  }
  return normalized;
}

function readDevnetSandboxConfig(bindings: Bindings): DevnetSandboxConfig | null {
  const configuredAssetMint = bindings.OFFPAY_RWA_DEVNET_SANDBOX_MINT?.trim();
  if (!configuredAssetMint) return null;

  const assetMint = assertSolanaAddress(configuredAssetMint, 'Devnet RWA sandbox mint');
  const settlementMint = assertSolanaAddress(
    bindings.OFFPAY_RWA_DEVNET_SETTLEMENT_MINT?.trim() ||
      bindings.OFFPAY_DEVNET_USDC_MINT?.trim() ||
      DEFAULT_DEVNET_USDC_MINT,
    'Devnet RWA settlement mint',
  );
  if (assetMint === settlementMint) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet RWA sandbox asset mint must differ from the settlement mint.',
      retryable: true,
    });
  }

  const decimals = readFiniteNumber(bindings.OFFPAY_RWA_DEVNET_SANDBOX_DECIMALS);
  if (decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet RWA sandbox mint decimals are misconfigured.',
      retryable: true,
    });
  }

  return {
    assetMint,
    settlementMint,
    priceReferenceMint: assertSolanaAddress(
      bindings.OFFPAY_RWA_DEVNET_PRICE_REFERENCE_MINT?.trim() ||
        DEFAULT_DEVNET_PRICE_REFERENCE_MINT,
      'Devnet RWA price reference mint',
    ),
    symbol: sanitizeText(bindings.OFFPAY_RWA_DEVNET_SANDBOX_SYMBOL, 24) ?? 'AAPLd',
    name: sanitizeText(bindings.OFFPAY_RWA_DEVNET_SANDBOX_NAME, 80) ?? 'Apple Sandbox RWA',
    decimals,
    programId: assertSolanaAddress(
      bindings.OFFPAY_RWA_DELEGATE_PROGRAM_ID?.trim() || DEFAULT_RWA_DELEGATE_PROGRAM_ID,
      'RWA delegate program',
    ),
  };
}

function readBooleanFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

function readAllowlistedRwaMints(bindings: Bindings): Set<string> {
  const rawValue = bindings.OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST?.trim() ?? '';
  if (rawValue.length === 0) return new Set();

  const mints = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const mint of mints) {
    if (!isValidSolanaAddress(mint)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'RWA allowlist configuration is invalid.',
        retryable: true,
      });
    }
  }

  return new Set(mints);
}

function readMaxPriceImpactBps(bindings: Bindings): number {
  const configured = readFiniteNumber(bindings.OFFPAY_RWA_MAX_PRICE_IMPACT_BPS);
  if (
    configured == null ||
    !Number.isInteger(configured) ||
    configured < 0 ||
    configured > MAX_PRICE_IMPACT_BPS_LIMIT
  ) {
    return DEFAULT_MAX_PRICE_IMPACT_BPS;
  }

  return configured;
}

function assertRwaMainnetTradingEnabled(bindings: Bindings): void {
  if (readBooleanFlag(bindings.OFFPAY_RWA_MAINNET_ENABLED)) return;

  throw new AppError({
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message: 'RWA mainnet trading is disabled for this deployment.',
  });
}

function getProviderEnvironment(): RwaProviderEnvironment {
  return 'production';
}

function getCatalogMode(network: Network): RwaAssetsResponse['mode'] {
  return network === 'mainnet' ? 'jupiter_stocks' : 'devnet_unavailable';
}

function buildComplianceLabel(network: Network): string {
  if (network !== 'mainnet') {
    return 'Real RWA secondary-market liquidity is not available on devnet.';
  }

  return 'Secondary-market tokenized asset route. Issuer redemption and jurisdiction eligibility remain external to OffPay.';
}

function buildRwaAsset(params: {
  token: JupiterToken;
  network: Network;
  settlementMint: string;
  priceUsd: number | null;
}): RwaAsset | null {
  const mint = readTokenMint(params.token);
  const decimals = readTokenDecimals(params.token);
  const symbol = sanitizeText(readTrimmedString(params.token.symbol), 24);
  const name = sanitizeText(readTrimmedString(params.token.name), 80);
  if (!mint || decimals == null || !symbol || !name) return null;

  const tags = readTags(params.token.tags);
  const verified = params.token.isVerified === true || tags.includes('verified');
  const tradable = params.network === 'mainnet';

  return {
    id: mint,
    symbol,
    name,
    mint,
    decimals,
    network: params.network,
    category: inferCategory(name, symbol),
    provider: 'jupiter_stocks',
    providerLabel: 'Jupiter verified stocks',
    providerEnvironment: getProviderEnvironment(),
    tokenProgramId: readTrimmedString(params.token.tokenProgram),
    settlementMint: params.settlementMint,
    settlementSymbol: 'USDC',
    priceUsd: params.priceUsd,
    change24hPct: null,
    verified,
    tradable,
    devnetSandbox: false,
    magicBlockEligible: false,
    riskLevel: 'regulated',
    logo: readTrimmedString(params.token.icon) ?? readTrimmedString(params.token.logoURI),
    underlyingSymbol: inferUnderlyingSymbol(symbol),
    complianceLabel: buildComplianceLabel(params.network),
    execution: {
      buy: tradable ? 'jupiter_swap' : 'disabled',
      sell: tradable ? 'jupiter_swap' : 'disabled',
      transfer: 'issuer',
      magicBlock: 'disabled',
    },
  };
}

function buildDevnetSandboxRwaAsset(params: {
  config: DevnetSandboxConfig;
  priceUsd: number | null;
}): RwaAsset {
  return {
    id: params.config.assetMint,
    symbol: params.config.symbol,
    name: params.config.name,
    mint: params.config.assetMint,
    decimals: params.config.decimals,
    network: 'devnet',
    category: inferCategory(params.config.name, params.config.symbol),
    provider: 'offpay_devnet_sandbox',
    providerLabel: 'OffPay devnet sandbox',
    providerEnvironment: 'devnet_sandbox',
    tokenProgramId: TOKEN_PROGRAM_ID,
    settlementMint: params.config.settlementMint,
    settlementSymbol: 'USDC',
    priceUsd: params.priceUsd,
    change24hPct: null,
    verified: true,
    tradable: true,
    devnetSandbox: true,
    magicBlockEligible: true,
    riskLevel: 'sandbox',
    logo: null,
    underlyingSymbol: inferUnderlyingSymbol(params.config.symbol),
    complianceLabel:
      'Devnet sandbox RWA backed by OffPay vault liquidity. Price is read from the configured Jupiter stock reference mint; issuer redemption and compliance are not simulated.',
    execution: {
      buy: 'devnet_sandbox',
      sell: 'devnet_sandbox',
      transfer: 'disabled',
      magicBlock: 'devnet_sandbox',
    },
  };
}

async function fetchJupiterStockTokens(bindings: Bindings, network: Network): Promise<JupiterToken[]> {
  if (network !== 'mainnet') return [];

  const payload = await fetchJupiterJson(bindings, '/tokens/v2/tag?query=stocks', {
    method: 'GET',
  });
  if (!Array.isArray(payload)) {
    throw new AppError({
      status: 502,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Jupiter RWA token catalog returned an invalid response.',
      retryable: true,
    });
  }

  return payload.filter(isRecord);
}

async function fetchJupiterPrice(bindings: Bindings, mint: string): Promise<number | null> {
  const payload = await fetchJupiterJson(
    bindings,
    `/price/v3?ids=${encodeURIComponent(mint)}`,
    { method: 'GET' },
  );

  if (!isRecord(payload)) return null;
  const entry = payload[mint];
  return isRecord(entry) ? readFiniteNumber(entry.usdPrice) : null;
}

async function getRwaAssets(bindings: Bindings, network: Network): Promise<RwaAssetsResponse> {
  const fetchedAt = Date.now();
  if (network === 'devnet') {
    const config = readDevnetSandboxConfig(bindings);
    if (config == null) {
      return {
        network,
        mode: 'devnet_unavailable',
        provider: 'jupiter_stocks',
        providerEnvironment: 'production',
        assets: [],
        fetchedAt,
      };
    }

    const priceUsd = await fetchJupiterPrice(bindings, config.priceReferenceMint);
    return {
      network,
      mode: 'devnet_sandbox',
      provider: 'offpay_devnet_sandbox',
      providerEnvironment: 'devnet_sandbox',
      assets: [
        buildDevnetSandboxRwaAsset({
          config,
          priceUsd,
        }),
      ],
      fetchedAt,
    };
  }

  const providerEnvironment = getProviderEnvironment();
  const settlementMint = readMainnetUsdcMint(bindings);
  const allowlist = readAllowlistedRwaMints(bindings);
  if (allowlist.size === 0) {
    return {
      network,
      mode: getCatalogMode(network),
      provider: 'jupiter_stocks',
      providerEnvironment,
      assets: [],
      fetchedAt,
    };
  }

  const tokens = (await fetchJupiterStockTokens(bindings, network))
    .filter((token) => {
      const mint = readTokenMint(token);
      return mint != null && allowlist.has(mint);
    })
    .slice(0, DEFAULT_ASSET_LIMIT);
  const prices = await Promise.allSettled(
    tokens
      .slice(0, PRICE_LOOKUP_LIMIT)
      .map((token) => {
        const mint = readTokenMint(token);
        return mint == null ? Promise.resolve(null) : fetchJupiterPrice(bindings, mint);
      }),
  );

  return {
    network,
    mode: getCatalogMode(network),
    provider: 'jupiter_stocks',
    providerEnvironment,
    assets: tokens.flatMap((token, index) => {
      const priceResult = prices[index];
      const priceUsd = priceResult?.status === 'fulfilled' ? priceResult.value : null;
      const asset = buildRwaAsset({
        token,
        network,
        settlementMint,
        priceUsd,
      });
      return asset == null ? [] : [asset];
    }),
    fetchedAt,
  };
}

async function resolveRwaAsset(
  bindings: Bindings,
  request: { mint?: string; symbol?: string; network: Network },
): Promise<RwaAsset> {
  const assets = (await getRwaAssets(bindings, request.network)).assets;
  const symbol = request.symbol?.trim().toUpperCase() ?? null;
  const asset = assets.find(
    (entry) =>
      (request.mint != null && entry.mint === request.mint) ||
      (symbol != null && entry.symbol.toUpperCase() === symbol),
  );

  if (!asset) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'RWA asset is not available on this network.',
    });
  }

  return asset;
}

async function getRwaPrice(
  bindings: Bindings,
  request: { mint: string; network: Network },
): Promise<RwaPriceResponse> {
  const asset = await resolveRwaAsset(bindings, {
    mint: request.mint,
    network: request.network,
  });
  const price = request.network === 'mainnet'
    ? await fetchJupiterPrice(bindings, asset.mint).catch(() => null)
    : asset.devnetSandbox
      ? await fetchJupiterPrice(
        bindings,
        readDevnetSandboxConfig(bindings)?.priceReferenceMint ?? asset.mint,
      ).catch(() => null)
      : null;

  return {
    network: request.network,
    mint: asset.mint,
    symbol: asset.symbol,
    price,
    currency: 'USD',
    change24hPct: asset.change24hPct,
    provider: asset.provider,
    providerEnvironment: asset.providerEnvironment,
    fetchedAt: Date.now(),
  };
}

function parseDecimalToAtomic(input: string, decimals: number, label: string): string {
  const trimmed = input.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${label} must be a positive decimal string.`,
    });
  }

  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${label} supports at most ${decimals} decimals.`,
    });
  }

  const atomic = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(atomic) || atomic === '0') {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${label} must be greater than zero.`,
    });
  }
  return atomic;
}

function formatAtomicAmount(amount: string, decimals: number): string {
  if (!/^\d+$/.test(amount)) return amount;
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, '') || '0';
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function inferQuotePriceUsd(params: {
  side: 'buy' | 'sell';
  quantity: string | null;
  cashAmount: string | null;
}): number | null {
  if (params.quantity == null || params.cashAmount == null) return null;
  const quantity = Number(params.quantity);
  const cashAmount = Number(params.cashAmount);
  if (!Number.isFinite(quantity) || !Number.isFinite(cashAmount) || quantity <= 0) return null;
  return params.side === 'buy' ? cashAmount / quantity : cashAmount / quantity;
}

function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

function bigintToU64(value: bigint, label: string): bigint {
  if (value <= 0n || value > U64_MAX) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${label} is outside the supported token amount range.`,
    });
  }
  return value;
}

function writeU64Le(buffer: Buffer, value: bigint, offset: number): void {
  bigintToU64(value, 'Token amount');
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    buffer[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function writeI64Le(buffer: Buffer, value: bigint, offset: number): void {
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) {
    throw new Error('i64 value is out of range.');
  }
  let remaining = value < 0n ? (1n << 64n) + value : value;
  for (let index = 0; index < 8; index += 1) {
    buffer[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  return nonce;
}

async function anchorDiscriminator(name: string): Promise<Buffer> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`global:${name}`),
  );
  return Buffer.from(digest).subarray(0, 8);
}

async function quoteHash(params: {
  walletAddress: string;
  side: 'buy' | 'sell';
  assetMint: string;
  settlementMint: string;
  quantityAtoms: bigint;
  cashAtoms: bigint;
  priceMicros: bigint;
  quoteExpiresAt: number;
  nonce: Uint8Array;
}): Promise<Uint8Array> {
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
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
}

function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  )[0];
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

function deriveRwaPdas(params: {
  programId: PublicKey;
  owner: PublicKey;
  assetMint: PublicKey;
  nonce: Uint8Array;
}) {
  const config = PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    params.programId,
  )[0];
  const intent = PublicKey.findProgramAddressSync(
    [Buffer.from(INTENT_SEED), params.owner.toBuffer(), Buffer.from(params.nonce)],
    params.programId,
  )[0];
  const market = PublicKey.findProgramAddressSync(
    [Buffer.from(MARKET_SEED), params.assetMint.toBuffer()],
    params.programId,
  )[0];
  const vaultAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_AUTHORITY_SEED)],
    params.programId,
  )[0];

  return {
    config,
    intent,
    market,
    vaultAuthority,
  };
}

async function createIntentInstruction(params: {
  programId: PublicKey;
  config: PublicKey;
  intent: PublicKey;
  owner: PublicKey;
  nonce: Uint8Array;
  assetMint: PublicKey;
  settlementMint: PublicKey;
  side: 'buy' | 'sell';
  quantityAtoms: bigint;
  cashAtoms: bigint;
  hash: Uint8Array;
  quoteExpiresAt: number;
}): Promise<TransactionInstruction> {
  const data = Buffer.alloc(8 + 16 + 32 + 32 + 1 + 8 + 8 + 32 + 8);
  (await anchorDiscriminator('create_intent')).copy(data, 0);
  Buffer.from(params.nonce).copy(data, 8);
  params.assetMint.toBuffer().copy(data, 24);
  params.settlementMint.toBuffer().copy(data, 56);
  data.writeUInt8(params.side === 'buy' ? 0 : 1, 88);
  writeU64Le(data, params.quantityAtoms, 89);
  writeU64Le(data, params.cashAtoms, 97);
  Buffer.from(params.hash).copy(data, 105);
  writeI64Le(data, BigInt(Math.trunc(params.quoteExpiresAt)), 137);

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

async function settleSandboxInstruction(params: {
  programId: PublicKey;
  config: PublicKey;
  market: PublicKey;
  intent: PublicKey;
  owner: PublicKey;
  ownerKey: PublicKey;
  nonce: Uint8Array;
  userAssetAccount: PublicKey;
  userSettlementAccount: PublicKey;
  assetVault: PublicKey;
  settlementVault: PublicKey;
  vaultAuthority: PublicKey;
}): Promise<TransactionInstruction> {
  const data = Buffer.alloc(8 + 32 + 16);
  (await anchorDiscriminator('settle_sandbox')).copy(data, 0);
  params.ownerKey.toBuffer().copy(data, 8);
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
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function buildDevnetSandboxTransaction(params: {
  bindings: Bindings;
  walletAddress: string;
  asset: RwaAsset;
  config: DevnetSandboxConfig;
  side: 'buy' | 'sell';
  quantityAtoms: bigint;
  cashAtoms: bigint;
  priceMicros: bigint;
  quoteExpiresAt: number;
}): Promise<{
  unsignedTransaction: string;
  quoteId: string;
  intent: string;
  market: string;
  nonce: string;
  quoteHash: string;
}> {
  const owner = new PublicKey(params.walletAddress);
  const programId = new PublicKey(params.config.programId);
  const assetMint = new PublicKey(params.asset.mint);
  const settlementMint = new PublicKey(params.asset.settlementMint);
  const nonce = randomNonce();
  const hash = await quoteHash({
    walletAddress: params.walletAddress,
    side: params.side,
    assetMint: params.asset.mint,
    settlementMint: params.asset.settlementMint,
    quantityAtoms: params.quantityAtoms,
    cashAtoms: params.cashAtoms,
    priceMicros: params.priceMicros,
    quoteExpiresAt: params.quoteExpiresAt,
    nonce,
  });
  const pdas = deriveRwaPdas({ programId, owner, assetMint, nonce });
  const userAssetAccount = associatedTokenAddress(owner, assetMint);
  const userSettlementAccount = associatedTokenAddress(owner, settlementMint);
  const assetVault = associatedTokenAddress(pdas.vaultAuthority, assetMint);
  const settlementVault = associatedTokenAddress(pdas.vaultAuthority, settlementMint);
  const { blockhash } = await getLatestBlockhash(params.bindings, 'devnet');
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash,
  });

  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction({
      payer: owner,
      owner,
      mint: assetMint,
      associatedTokenAccount: userAssetAccount,
    }),
    createAssociatedTokenAccountIdempotentInstruction({
      payer: owner,
      owner,
      mint: settlementMint,
      associatedTokenAccount: userSettlementAccount,
    }),
    await createIntentInstruction({
      programId,
      config: pdas.config,
      intent: pdas.intent,
      owner,
      nonce,
      assetMint,
      settlementMint,
      side: params.side,
      quantityAtoms: params.quantityAtoms,
      cashAtoms: params.cashAtoms,
      hash,
      quoteExpiresAt: params.quoteExpiresAt,
    }),
    await settleSandboxInstruction({
      programId,
      config: pdas.config,
      market: pdas.market,
      intent: pdas.intent,
      owner,
      ownerKey: owner,
      nonce,
      userAssetAccount,
      userSettlementAccount,
      assetVault,
      settlementVault,
      vaultAuthority: pdas.vaultAuthority,
    }),
  );

  return {
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64'),
    quoteId: `devnet-${toHex(nonce)}`,
    intent: pdas.intent.toBase58(),
    market: pdas.market.toBase58(),
    nonce: toHex(nonce),
    quoteHash: toHex(hash),
  };
}

function assertRwaTradingNetwork(network: Network): void {
  if (network === 'mainnet') return;
  throw new AppError({
    status: 400,
    code: 'INVALID_NETWORK',
    message: 'RWA secondary-market execution is available only on mainnet because Jupiter swap execution is mainnet-only.',
  });
}

function assertPositiveAtomicAmount(value: string, label: string): void {
  if (!/^\d+$/.test(value) || value === '0') {
    throw new AppError({
      status: 502,
      code: 'UPSTREAM_UNAVAILABLE',
      message: `Jupiter RWA quote returned an invalid ${label}.`,
      retryable: true,
    });
  }
}

function assertQuoteSafety(params: {
  quote: SwapQuoteResponse;
  inputMint: string;
  outputMint: string;
  maxPriceImpactBps: number;
}): void {
  if (
    params.quote.inputMint !== params.inputMint ||
    params.quote.outputMint !== params.outputMint ||
    params.quote.unsignedTransaction.trim().length === 0 ||
    params.quote.quoteId.trim().length === 0
  ) {
    throw new AppError({
      status: 502,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Jupiter RWA quote returned an unexpected route.',
      retryable: true,
    });
  }

  assertPositiveAtomicAmount(params.quote.inAmount, 'input amount');
  assertPositiveAtomicAmount(params.quote.outAmount, 'output amount');

  if (params.quote.expiresAt <= Date.now() + MIN_QUOTE_TTL_MS) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'RWA quote expired before it could be signed. Please request a fresh quote.',
      retryable: true,
    });
  }

  const impactBps = Math.abs(params.quote.priceImpactPct) * 100;
  if (Number.isFinite(impactBps) && impactBps > params.maxPriceImpactBps) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `RWA quote price impact exceeds the configured ${params.maxPriceImpactBps / 100}% limit.`,
    });
  }
}

async function createDevnetSandboxQuote(
  bindings: Bindings,
  request: RwaQuoteRequest,
): Promise<RwaQuoteResponse> {
  const config = readDevnetSandboxConfig(bindings);
  if (config == null) {
    throw new AppError({
      status: 501,
      code: 'NOT_IMPLEMENTED',
      message: 'Devnet RWA sandbox is not configured for this deployment.',
    });
  }
  if (request.side == null) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'RWA quote requires a buy or sell side.',
    });
  }

  const asset = await resolveRwaAsset(bindings, {
    mint: request.assetMint,
    symbol: request.assetSymbol,
    network: request.network,
  });
  if (!asset.tradable || asset.execution[request.side] !== 'devnet_sandbox') {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'This RWA asset is not currently enabled for devnet sandbox settlement.',
    });
  }

  const priceUsd = await fetchJupiterPrice(bindings, config.priceReferenceMint);
  if (priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet RWA sandbox pricing is currently unavailable from Jupiter.',
      retryable: true,
    });
  }

  const priceMicros = BigInt(Math.round(priceUsd * 1_000_000));
  if (priceMicros <= 0n) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Devnet RWA sandbox pricing is invalid.',
      retryable: true,
    });
  }

  const assetDecimals = asset.decimals ?? config.decimals;
  const assetScale = pow10(assetDecimals);
  let quantityAtoms: bigint;
  let cashAtoms: bigint;
  if (request.side === 'buy') {
    cashAtoms = BigInt(parseDecimalToAtomic(request.cashAmount ?? '', USDC_DECIMALS, 'Cash amount'));
    quantityAtoms = (cashAtoms * assetScale) / priceMicros;
  } else {
    quantityAtoms = BigInt(parseDecimalToAtomic(request.quantity ?? '', assetDecimals, 'Quantity'));
    cashAtoms = (quantityAtoms * priceMicros) / assetScale;
  }
  quantityAtoms = bigintToU64(quantityAtoms, 'RWA quantity');
  cashAtoms = bigintToU64(cashAtoms, 'Cash amount');

  const now = Date.now();
  const expiresAt = now + DEVNET_SANDBOX_QUOTE_TTL_MS;
  const quoteExpiresAt = Math.floor(expiresAt / 1000);
  const transaction = await buildDevnetSandboxTransaction({
    bindings,
    walletAddress: request.walletAddress,
    asset,
    config,
    side: request.side,
    quantityAtoms,
    cashAtoms,
    priceMicros,
    quoteExpiresAt,
  });
  const quantity = formatAtomicAmount(quantityAtoms.toString(), assetDecimals);
  const cashAmount = formatAtomicAmount(cashAtoms.toString(), USDC_DECIMALS);

  return {
    quoteId: transaction.quoteId,
    assetMint: asset.mint,
    assetSymbol: asset.symbol,
    settlementMint: asset.settlementMint,
    settlementSymbol: asset.settlementSymbol,
    side: request.side,
    priceUsd,
    quantity,
    cashAmount,
    priceImpactPct: 0,
    routeSummary: 'OffPay devnet sandbox vault settlement via delegated RWA intent',
    fee: '0',
    slippageBps: 0,
    expiresAt,
    provider: 'offpay_devnet_sandbox',
    providerEnvironment: 'devnet_sandbox',
    unsignedTransaction: transaction.unsignedTransaction,
    transactionFormat: 'solana_legacy_transaction_base64',
    sandboxIntent: {
      programId: config.programId,
      intent: transaction.intent,
      market: transaction.market,
      nonce: transaction.nonce,
      quoteHash: transaction.quoteHash,
    },
  };
}

async function createRwaQuote(
  bindings: Bindings,
  request: RwaQuoteRequest,
): Promise<RwaQuoteResponse> {
  if (request.network === 'devnet') {
    return createDevnetSandboxQuote(bindings, request);
  }

  assertRwaTradingNetwork(request.network);
  assertRwaMainnetTradingEnabled(bindings);
  if (request.side == null) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'RWA quote requires a buy or sell side.',
    });
  }

  const asset = await resolveRwaAsset(bindings, {
    mint: request.assetMint,
    symbol: request.assetSymbol,
    network: request.network,
  });
  if (!asset.tradable || asset.execution[request.side] !== 'jupiter_swap') {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'This RWA asset is not currently tradable through Jupiter secondary-market liquidity.',
    });
  }

  const amount =
    request.side === 'buy'
      ? parseDecimalToAtomic(request.cashAmount ?? '', USDC_DECIMALS, 'Cash amount')
      : parseDecimalToAtomic(request.quantity ?? '', asset.decimals ?? 0, 'Quantity');
  const inputMint = request.side === 'buy' ? asset.settlementMint : asset.mint;
  const outputMint = request.side === 'buy' ? asset.mint : asset.settlementMint;
  const quote = await createSwapQuote(bindings, {
    takerAddress: request.walletAddress,
    inputMint,
    outputMint,
    amount,
    network: request.network,
  });
  assertQuoteSafety({
    quote,
    inputMint,
    outputMint,
    maxPriceImpactBps: readMaxPriceImpactBps(bindings),
  });

  return buildRwaQuoteResponse({
    asset,
    quote,
    side: request.side,
  });
}

function buildRwaQuoteResponse(params: {
  asset: RwaAsset;
  quote: SwapQuoteResponse;
  side: 'buy' | 'sell';
}): RwaQuoteResponse {
  const quantity =
    params.side === 'buy'
      ? formatAtomicAmount(params.quote.outAmount, params.asset.decimals ?? 0)
      : formatAtomicAmount(params.quote.inAmount, params.asset.decimals ?? 0);
  const cashAmount =
    params.side === 'buy'
      ? formatAtomicAmount(params.quote.inAmount, USDC_DECIMALS)
      : formatAtomicAmount(params.quote.outAmount, USDC_DECIMALS);

  return {
    quoteId: params.quote.quoteId,
    assetMint: params.asset.mint,
    assetSymbol: params.asset.symbol,
    settlementMint: params.asset.settlementMint,
    settlementSymbol: params.asset.settlementSymbol,
    side: params.side,
    priceUsd: inferQuotePriceUsd({ side: params.side, quantity, cashAmount }),
    quantity,
    cashAmount,
    priceImpactPct: params.quote.priceImpactPct,
    routeSummary: params.quote.routeSummary,
    fee: params.quote.fee,
    slippageBps: params.quote.slippageBps ?? null,
    expiresAt: params.quote.expiresAt,
    provider: 'jupiter_stocks',
    providerEnvironment: params.asset.providerEnvironment,
    unsignedTransaction: params.quote.unsignedTransaction,
    transactionFormat: 'solana_versioned_transaction_base64',
  };
}

async function executeRwaQuote(
  bindings: Bindings,
  request: RwaExecuteRequest,
): Promise<RwaExecuteResponse> {
  if (request.network === 'devnet') {
    if (!request.quoteId.startsWith('devnet-')) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Devnet RWA execution requires a devnet sandbox quote.',
      });
    }

    const result = await broadcastRawTransaction(bindings, {
      rawTransaction: request.signedTransaction,
      network: 'devnet',
      skipPreflight: false,
      maxRetries: 2,
      preflightCommitment: 'confirmed',
    });

    return {
      quoteId: request.quoteId,
      network: request.network,
      signature: result.signature,
      status: 'submitted',
      submittedAt: Date.now(),
      provider: 'offpay_devnet_sandbox',
    };
  }

  assertRwaTradingNetwork(request.network);
  assertRwaMainnetTradingEnabled(bindings);
  const result = await executeSwapQuote(bindings, {
    takerAddress: request.walletAddress,
    quoteId: request.quoteId,
    signedTransaction: request.signedTransaction,
    network: request.network,
  });

  return {
    quoteId: request.quoteId,
    network: request.network,
    signature: result.signature,
    status: 'submitted',
    submittedAt: Date.now(),
    provider: 'jupiter_stocks',
  };
}

function setRwaFetchImplementation(implementation: RwaFetchImplementation): void {
  rwaFetchImplementation = implementation;
}

function resetRwaFetchImplementation(): void {
  rwaFetchImplementation = (input, init) => fetch(input, init);
}

export {
  getRwaAssets,
  getRwaPrice,
  createRwaQuote,
  executeRwaQuote,
  resetRwaFetchImplementation,
  setRwaFetchImplementation,
  type RwaAsset,
  type RwaAssetCategory,
  type RwaAssetsResponse,
  type RwaExecuteRequest,
  type RwaExecuteResponse,
  type RwaExecutionMode,
  type RwaExecutionPolicy,
  type RwaPriceResponse,
  type RwaProvider,
  type RwaProviderEnvironment,
  type RwaQuoteRequest,
  type RwaQuoteResponse,
  type RwaRiskLevel,
};
