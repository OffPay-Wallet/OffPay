import { CURRENCIES, DEFAULT_CURRENCY } from '@/constants/currencies';
import { fetchUsdToCurrencyRateFromNetwork } from '@/lib/api/offpay-api-client';
import { writeCachedUsdToCurrencyRate } from '@/lib/cache/valuation-cache';

import type { FiatCurrencyParts } from '@/lib/fiat-money-layout';

const KNOWN_CURRENCY_SYMBOLS = [...CURRENCIES]
  .map((entry) => entry.symbol)
  .sort((left, right) => right.length - left.length);

export function normalizeCurrency(code: string): string {
  const upper = code.trim().toUpperCase();
  return CURRENCIES.some((currency) => currency.code === upper) ? upper : DEFAULT_CURRENCY;
}

const USD_STABLE_PRICE_SYMBOLS = new Set(['USDC', 'USDT', 'DUSDC', 'DUSDT']);

/** Symbols priced at $1 for portfolio and token row valuations. */
export function isUsdStablePriceSymbol(symbol: string): boolean {
  return USD_STABLE_PRICE_SYMBOLS.has(symbol.trim().toUpperCase());
}

export function formatFiatCurrency(value: number, currencyCode: string): string {
  if (!Number.isFinite(value)) return '--';
  const normalized = normalizeCurrency(currencyCode);
  const currency = CURRENCIES.find((entry) => entry.code === normalized);
  const formattedNumber = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Object.is(value, -0) ? 0 : value);

  return `${currency?.symbol ?? normalized} ${formattedNumber}`;
}

export function formatFiatCurrencyParts(
  value: number,
  currencyCode: string,
): FiatCurrencyParts | null {
  if (!Number.isFinite(value)) return null;
  const normalized = normalizeCurrency(currencyCode);
  const currency = CURRENCIES.find((entry) => entry.code === normalized);
  const formattedNumber = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Object.is(value, -0) ? 0 : value);

  return {
    symbol: currency?.symbol ?? normalized,
    amount: formattedNumber,
  };
}

/** Splits a `formatFiatCurrency` label into symbol + amount for styled display. */
export function parseFormattedFiatCurrency(label: string): FiatCurrencyParts | null {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed === '--' || trimmed === '****') return null;

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex > 0) {
    const symbol = trimmed.slice(0, spaceIndex);
    const amount = trimmed.slice(spaceIndex + 1).trim();
    if (amount.length > 0) return { symbol, amount };
  }

  for (const symbol of KNOWN_CURRENCY_SYMBOLS) {
    if (!trimmed.startsWith(symbol)) continue;
    const amount = trimmed.slice(symbol.length).trim();
    if (amount.length > 0) return { symbol, amount };
  }

  return null;
}

/** Parses labels like `$ 1.00/USDC` into fiat parts + suffix. */
export function parseFiatUnitPriceLabel(
  label: string,
): { parts: FiatCurrencyParts; suffix: string } | null {
  const slashIndex = label.indexOf('/');
  if (slashIndex <= 0) return null;
  const parts = parseFormattedFiatCurrency(label.slice(0, slashIndex));
  if (parts == null) return null;
  const suffix = label.slice(slashIndex);
  return suffix.length > 0 ? { parts, suffix } : null;
}

export async function fetchUsdToCurrencyRate(currency: string): Promise<number> {
  const normalized = normalizeCurrency(currency);
  if (normalized === 'USD') return 1;

  const rate = await fetchUsdToCurrencyRateFromNetwork(normalized);
  void writeCachedUsdToCurrencyRate(normalized, rate).catch(() => undefined);
  return rate;
}
