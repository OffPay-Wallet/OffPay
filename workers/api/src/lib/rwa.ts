import { AppError } from './errors.js';
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
type RwaProvider = 'jupiter_stocks';
type RwaExecutionMode = 'jupiter_swap' | 'issuer' | 'disabled';
type RwaRiskLevel = 'regulated' | 'high';
type RwaProviderEnvironment = 'production';

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
  mode: 'jupiter_stocks' | 'devnet_unavailable';
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
  transactionFormat: 'solana_versioned_transaction_base64';
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
const DEFAULT_ASSET_LIMIT = 48;
const PRICE_LOOKUP_LIMIT = 16;
const JUPITER_TIMEOUT_MS = 12_000;
const USDC_DECIMALS = 6;
const DEFAULT_MAX_PRICE_IMPACT_BPS = 200;
const MAX_PRICE_IMPACT_BPS_LIMIT = 10_000;
const MIN_QUOTE_TTL_MS = 5_000;

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

async function createRwaQuote(
  bindings: Bindings,
  request: RwaQuoteRequest,
): Promise<RwaQuoteResponse> {
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
