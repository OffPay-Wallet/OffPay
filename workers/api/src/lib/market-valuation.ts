import { fetchAlchemyTokenUsdPrice, type AlchemyTokenPriceIdentifier } from './alchemy-prices.js';
import { createCacheKey, memoryCache } from './cache.js';
import { fetchUsdToCurrencyRate } from './fx-rates.js';
import type { Bindings, Network } from './types.js';
import { isValidSolanaAddress } from './validation.js';

const ALCHEMY_SOLANA_MAINNET_NETWORK = 'solana-mainnet';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PRICE_CACHE_TTL_MS = 60_000;
const TOKEN_PRICE_BATCH_CONCURRENCY = 6;
const USD_STABLE_PRICE_SYMBOLS = new Set(['USDC', 'USDT', 'DUSDC', 'DUSDT']);

interface TokenPriceBatchInput {
  mint: string;
  symbol: string;
  priceSymbol: string;
}

interface TokenPriceBatchResponse {
  network: Network;
  currency: string;
  rate: number;
  fetchedAt: number;
  unitUsdPrices: Record<string, number>;
  pricedCount: number;
  expectedCount: number;
}

interface CachedUsdPrice {
  value: number | null;
}

function isPositiveUsdPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizePriceSymbol(value: string | null | undefined): string | null {
  const symbol = value?.trim().toUpperCase();
  if (!symbol) return null;
  if (symbol === 'WSOL') return 'SOL';
  if (symbol === 'DUSDC') return 'USDC';
  if (symbol === 'DUSDT') return 'USDT';
  return symbol;
}

function isUsdStablePriceSymbol(value: string): boolean {
  return USD_STABLE_PRICE_SYMBOLS.has(value.trim().toUpperCase());
}

function buildPriceLookups(
  params: TokenPriceBatchInput & { network: Network },
): AlchemyTokenPriceIdentifier[] {
  const mint = params.mint.trim();
  const symbol = normalizePriceSymbol(params.priceSymbol) ?? normalizePriceSymbol(params.symbol);
  const lookups: AlchemyTokenPriceIdentifier[] = [];
  const seen = new Set<string>();

  const addLookup = (lookup: AlchemyTokenPriceIdentifier): void => {
    const key =
      lookup.type === 'symbol'
        ? `symbol:${lookup.symbol}`
        : `address:${lookup.network}:${lookup.address}`;
    if (seen.has(key)) return;
    seen.add(key);
    lookups.push(lookup);
  };

  if (params.network === 'mainnet' && mint !== NATIVE_SOL_MINT && isValidSolanaAddress(mint)) {
    addLookup({ type: 'address', network: ALCHEMY_SOLANA_MAINNET_NETWORK, address: mint });
  }

  if (symbol != null) {
    addLookup({ type: 'symbol', symbol });
  }

  if (mint === NATIVE_SOL_MINT && symbol !== 'SOL') {
    addLookup({ type: 'symbol', symbol: 'SOL' });
  }

  return lookups;
}

function priceLookupCacheKey(lookup: AlchemyTokenPriceIdentifier): string {
  return lookup.type === 'symbol'
    ? createCacheKey('alchemy-token-price', ['symbol', lookup.symbol])
    : createCacheKey('alchemy-token-price', ['address', lookup.network, lookup.address]);
}

async function fetchCachedLookupUsdPrice(
  bindings: Bindings,
  lookup: AlchemyTokenPriceIdentifier,
): Promise<number | null> {
  const cached = await memoryCache.getOrSet<CachedUsdPrice>(
    priceLookupCacheKey(lookup),
    TOKEN_PRICE_CACHE_TTL_MS,
    async () => {
      const price = await fetchAlchemyTokenUsdPrice(bindings, lookup);
      return { value: isPositiveUsdPrice(price?.value) ? price.value : null };
    },
  );

  return cached.value;
}

async function resolveTokenUsdPrice(
  bindings: Bindings,
  network: Network,
  token: TokenPriceBatchInput,
): Promise<number | null> {
  if (isUsdStablePriceSymbol(token.priceSymbol)) {
    return 1;
  }

  for (const lookup of buildPriceLookups({ ...token, network })) {
    try {
      const price = await fetchCachedLookupUsdPrice(bindings, lookup);
      if (isPositiveUsdPrice(price)) return price;
    } catch {
      // Try the next identifier shape before giving up on this token.
    }
  }

  return null;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function uniqueTokens(tokens: readonly TokenPriceBatchInput[]): TokenPriceBatchInput[] {
  const seen = new Set<string>();
  return tokens.flatMap((token) => {
    const mint = token.mint.trim();
    const symbol = token.symbol.trim().toUpperCase();
    const priceSymbol = token.priceSymbol.trim().toUpperCase();
    const key = `${mint}:${symbol}:${priceSymbol}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ mint, symbol, priceSymbol }];
  });
}

async function resolveTokenPriceBatch(params: {
  bindings: Bindings;
  network: Network;
  currency: string;
  tokens: readonly TokenPriceBatchInput[];
}): Promise<TokenPriceBatchResponse> {
  const tokens = uniqueTokens(params.tokens);
  const [fxRate, prices] = await Promise.all([
    fetchUsdToCurrencyRate(params.currency),
    mapWithConcurrency(tokens, TOKEN_PRICE_BATCH_CONCURRENCY, async (token) => ({
      token,
      usdPrice: await resolveTokenUsdPrice(params.bindings, params.network, token),
    })),
  ]);

  const unitUsdPrices: Record<string, number> = {};
  for (const result of prices) {
    if (!isPositiveUsdPrice(result.usdPrice)) continue;
    unitUsdPrices[result.token.mint] = result.usdPrice;
  }

  return {
    network: params.network,
    currency: fxRate.currency,
    rate: fxRate.rate,
    fetchedAt: Date.now(),
    unitUsdPrices,
    pricedCount: Object.keys(unitUsdPrices).length,
    expectedCount: tokens.length,
  };
}

export { resolveTokenPriceBatch, type TokenPriceBatchInput, type TokenPriceBatchResponse };
