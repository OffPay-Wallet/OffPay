import { AppError } from './errors.js';

type FxRateSource = 'frankfurter' | 'currency-api';

interface FxRateResponse {
  base: 'USD';
  currency: string;
  rate: number;
  fetchedAt: number;
  source: FxRateSource;
}

const FX_FETCH_TIMEOUT_MS = 4000;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function assertCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Currency must be a three-letter ISO code.',
    });
  }

  return currency;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`FX request timed out after ${FX_FETCH_TIMEOUT_MS}ms`));
  }, FX_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assertRate(value: unknown, currency: string, source: FxRateSource): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  throw new AppError({
    status: 502,
    code: 'UPSTREAM_UNAVAILABLE',
    message: `USD/${currency} rate is unavailable from ${source}.`,
    retryable: true,
    retryAfterMs: 30_000,
  });
}

async function fetchFrankfurterUsdRate(currency: string): Promise<FxRateResponse> {
  const response = await fetchWithTimeout(
    `https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(currency)}`,
  );
  if (!response.ok) {
    throw new Error(`Frankfurter failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { rates?: Record<string, unknown> };
  return {
    base: 'USD',
    currency,
    rate: assertRate(body.rates?.[currency], currency, 'frankfurter'),
    fetchedAt: Date.now(),
    source: 'frankfurter',
  };
}

async function fetchCurrencyApiUsdRate(currency: string): Promise<FxRateResponse> {
  const response = await fetchWithTimeout(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
  );
  if (!response.ok) {
    throw new Error(`Currency API failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { usd?: Record<string, unknown> };
  return {
    base: 'USD',
    currency,
    rate: assertRate(body.usd?.[currency.toLowerCase()], currency, 'currency-api'),
    fetchedAt: Date.now(),
    source: 'currency-api',
  };
}

async function fetchUsdToCurrencyRate(currencyInput: string): Promise<FxRateResponse> {
  const currency = assertCurrency(currencyInput);
  if (currency === 'USD') {
    return {
      base: 'USD',
      currency,
      rate: 1,
      fetchedAt: Date.now(),
      source: 'frankfurter',
    };
  }

  try {
    return await fetchFrankfurterUsdRate(currency);
  } catch {
    return fetchCurrencyApiUsdRate(currency);
  }
}

export { fetchUsdToCurrencyRate };
