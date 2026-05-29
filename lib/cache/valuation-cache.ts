import { readPersistedJson, writePersistedJson } from '@/lib/cache/persistent-json-cache';

import type { OffpayNetwork } from '@/types/offpay-api';

const TOKEN_PRICE_CACHE_VERSION = 1;
const FX_RATE_CACHE_VERSION = 1;
const TOKEN_PRICE_KEY_PREFIX = 'offpay_token_usd_prices_v1';
const FX_RATE_KEY = 'offpay_usd_fx_rates_v1';

interface TokenPriceCache {
  version: 1;
  network: OffpayNetwork;
  prices: Record<string, { price: number; fetchedAt: number }>;
  updatedAt: number;
}

interface FxRateCache {
  version: 1;
  rates: Record<string, { rate: number; fetchedAt: number }>;
  updatedAt: number;
}

function safeKeyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function tokenPriceKey(network: OffpayNetwork): string {
  return `${TOKEN_PRICE_KEY_PREFIX}_${safeKeyPart(network)}`;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeTokenPriceCache(
  network: OffpayNetwork,
  value: unknown,
): TokenPriceCache | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const candidate = value as Partial<TokenPriceCache>;
  if (candidate.version !== TOKEN_PRICE_CACHE_VERSION || candidate.network !== network) {
    return null;
  }

  const prices: TokenPriceCache['prices'] = {};
  const entries =
    typeof candidate.prices === 'object' && candidate.prices != null && !Array.isArray(candidate.prices)
      ? Object.entries(candidate.prices)
      : [];

  for (const [mint, snapshot] of entries) {
    if (typeof snapshot !== 'object' || snapshot == null || Array.isArray(snapshot)) continue;
    const price = (snapshot as { price?: unknown }).price;
    const fetchedAt = (snapshot as { fetchedAt?: unknown }).fetchedAt;
    if (typeof mint === 'string' && isFinitePositiveNumber(price) && typeof fetchedAt === 'number') {
      prices[mint] = { price, fetchedAt };
    }
  }

  return {
    version: TOKEN_PRICE_CACHE_VERSION,
    network,
    prices,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
  };
}

function normalizeFxRateCache(value: unknown): FxRateCache | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const candidate = value as Partial<FxRateCache>;
  if (candidate.version !== FX_RATE_CACHE_VERSION) return null;

  const rates: FxRateCache['rates'] = {};
  const entries =
    typeof candidate.rates === 'object' && candidate.rates != null && !Array.isArray(candidate.rates)
      ? Object.entries(candidate.rates)
      : [];

  for (const [currency, snapshot] of entries) {
    if (typeof snapshot !== 'object' || snapshot == null || Array.isArray(snapshot)) continue;
    const rate = (snapshot as { rate?: unknown }).rate;
    const fetchedAt = (snapshot as { fetchedAt?: unknown }).fetchedAt;
    if (
      typeof currency === 'string' &&
      /^[A-Z]{3}$/.test(currency) &&
      isFinitePositiveNumber(rate) &&
      typeof fetchedAt === 'number'
    ) {
      rates[currency] = { rate, fetchedAt };
    }
  }

  return {
    version: FX_RATE_CACHE_VERSION,
    rates,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
  };
}

async function readTokenPriceCache(network: OffpayNetwork): Promise<TokenPriceCache> {
  return (
    (await readPersistedJson(tokenPriceKey(network), (value) =>
      normalizeTokenPriceCache(network, value),
    )) ?? {
      version: TOKEN_PRICE_CACHE_VERSION,
      network,
      prices: {},
      updatedAt: Date.now(),
    }
  );
}

async function readFxRateCache(): Promise<FxRateCache> {
  return (
    (await readPersistedJson(FX_RATE_KEY, normalizeFxRateCache)) ?? {
      version: FX_RATE_CACHE_VERSION,
      rates: {},
      updatedAt: Date.now(),
    }
  );
}

export async function readCachedTokenUsdPrices(
  network: OffpayNetwork,
): Promise<Record<string, number>> {
  const cache = await readTokenPriceCache(network);
  return Object.fromEntries(
    Object.entries(cache.prices).map(([mint, snapshot]) => [mint, snapshot.price]),
  );
}

export async function writeCachedTokenUsdPrices(
  network: OffpayNetwork,
  prices: Record<string, number>,
): Promise<void> {
  const cache = await readTokenPriceCache(network);
  const fetchedAt = Date.now();
  const nextPrices = { ...cache.prices };

  for (const [mint, price] of Object.entries(prices)) {
    if (!mint || !isFinitePositiveNumber(price)) continue;
    nextPrices[mint] = { price, fetchedAt };
  }

  await writePersistedJson(tokenPriceKey(network), {
    version: TOKEN_PRICE_CACHE_VERSION,
    network,
    prices: nextPrices,
    updatedAt: fetchedAt,
  } satisfies TokenPriceCache);
}

export async function readCachedUsdToCurrencyRate(currency: string): Promise<number | null> {
  const normalized = currency.trim().toUpperCase();
  if (normalized === 'USD') return 1;
  const cache = await readFxRateCache();
  return cache.rates[normalized]?.rate ?? null;
}

export async function writeCachedUsdToCurrencyRate(
  currency: string,
  rate: number,
): Promise<void> {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized) || !isFinitePositiveNumber(rate)) return;

  const cache = await readFxRateCache();
  const fetchedAt = Date.now();

  await writePersistedJson(FX_RATE_KEY, {
    version: FX_RATE_CACHE_VERSION,
    rates: {
      ...cache.rates,
      [normalized]: { rate, fetchedAt },
    },
    updatedAt: fetchedAt,
  } satisfies FxRateCache);
}
