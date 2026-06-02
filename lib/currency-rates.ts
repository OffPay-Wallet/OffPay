import { CURRENCIES, DEFAULT_CURRENCY } from '@/constants/currencies';
import { fetchUsdToCurrencyRateFromNetwork } from '@/lib/api/offpay-api-client';
import { writeCachedUsdToCurrencyRate } from '@/lib/cache/valuation-cache';

export function normalizeCurrency(code: string): string {
  const upper = code.trim().toUpperCase();
  return CURRENCIES.some((currency) => currency.code === upper) ? upper : DEFAULT_CURRENCY;
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

/** Splits a `formatFiatCurrency` label into symbol + amount for styled display. */
export function parseFormattedFiatCurrency(
  label: string,
): { symbol: string; amount: string } | null {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed === '--' || trimmed === '****') return null;

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex > 0) {
    const symbol = trimmed.slice(0, spaceIndex);
    const amount = trimmed.slice(spaceIndex + 1).trim();
    if (amount.length > 0) return { symbol, amount };
  }

  const symbols = [...CURRENCIES]
    .map((entry) => entry.symbol)
    .sort((left, right) => right.length - left.length);
  for (const symbol of symbols) {
    if (!trimmed.startsWith(symbol)) continue;
    const amount = trimmed.slice(symbol.length).trim();
    if (amount.length > 0) return { symbol, amount };
  }

  return null;
}

export async function fetchUsdToCurrencyRate(currency: string): Promise<number> {
  const normalized = normalizeCurrency(currency);
  if (normalized === 'USD') return 1;

  const rate = await fetchUsdToCurrencyRateFromNetwork(normalized);
  void writeCachedUsdToCurrencyRate(normalized, rate).catch(() => undefined);
  return rate;
}
