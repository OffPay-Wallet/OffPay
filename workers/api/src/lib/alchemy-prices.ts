import { AppError } from './errors.js';
import { getRequiredBinding } from './provider-utils.js';
import type { Bindings } from './types.js';

const ALCHEMY_PRICES_API_ORIGIN = 'https://api.g.alchemy.com/prices/v1';
const ALCHEMY_PRICES_TIMEOUT_MS = 12_000;

type AlchemyTokenPriceIdentifier =
  | {
      type: 'symbol';
      symbol: string;
    }
  | {
      type: 'address';
      network: string;
      address: string;
    };

type AlchemyHistoricalPriceInterval = '5m' | '1h' | '1d';

interface AlchemyUsdPricePoint {
  value: number;
  lastUpdatedAt: string;
}

interface AlchemyHistoricalUsdPricePoint {
  value: number;
  timestamp: number;
  timestampIso: string;
  marketCap: number | null;
  totalVolume: number | null;
}

function buildAlchemyPricesUrl(bindings: Bindings, path: `/${string}`): string {
  return `${ALCHEMY_PRICES_API_ORIGIN}/${encodeURIComponent(
    getRequiredBinding(bindings, 'ALCHEMY_PRICE_API_KEY'),
  )}${path}`;
}

function readErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload == null || Array.isArray(payload)) return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error !== 'object' || error == null || Array.isArray(error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}

async function fetchAlchemyJson(
  bindings: Bindings,
  path: `/${string}`,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Alchemy Prices request timed out after ${ALCHEMY_PRICES_TIMEOUT_MS}ms`));
  }, ALCHEMY_PRICES_TIMEOUT_MS);

  try {
    const response = await fetch(buildAlchemyPricesUrl(bindings, path), {
      ...init,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new AppError({
        status: response.status,
        code: response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE',
        message: readErrorMessage(payload) ?? `Alchemy Prices request failed with ${response.status}.`,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Alchemy Prices is temporarily unavailable.',
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readUsdPrice(prices: unknown): AlchemyUsdPricePoint | null {
  if (!Array.isArray(prices)) return null;

  for (const item of prices) {
    if (typeof item !== 'object' || item == null || Array.isArray(item)) continue;
    const currency = (item as { currency?: unknown }).currency;
    if (typeof currency !== 'string' || currency.trim().toUpperCase() !== 'USD') continue;
    const value = parsePositiveNumber((item as { value?: unknown }).value);
    const lastUpdatedAt = (item as { lastUpdatedAt?: unknown }).lastUpdatedAt;
    if (value == null || typeof lastUpdatedAt !== 'string' || !lastUpdatedAt.trim()) continue;
    return { value, lastUpdatedAt };
  }

  return null;
}

function readFirstDataItem(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload == null || Array.isArray(payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const firstItem = data[0];
  if (typeof firstItem !== 'object' || firstItem == null || Array.isArray(firstItem)) return null;
  return firstItem as Record<string, unknown>;
}

async function fetchAlchemyTokenUsdPrice(
  bindings: Bindings,
  identifier: AlchemyTokenPriceIdentifier,
): Promise<AlchemyUsdPricePoint | null> {
  const payload =
    identifier.type === 'symbol'
      ? await fetchAlchemyJson(
          bindings,
          `/tokens/by-symbol?symbols=${encodeURIComponent(identifier.symbol)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
        )
      : await fetchAlchemyJson(bindings, '/tokens/by-address', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            addresses: [{ network: identifier.network, address: identifier.address }],
          }),
        });

  const dataItem = readFirstDataItem(payload);
  if (dataItem == null || typeof dataItem.error === 'string') return null;
  return readUsdPrice(dataItem.prices);
}

function readHistoricalPricePoints(payload: unknown): AlchemyHistoricalUsdPricePoint[] {
  if (typeof payload !== 'object' || payload == null || Array.isArray(payload)) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (typeof item !== 'object' || item == null || Array.isArray(item)) return null;
      const value = parsePositiveNumber((item as { value?: unknown }).value);
      const timestampIso = (item as { timestamp?: unknown }).timestamp;
      if (value == null || typeof timestampIso !== 'string' || !timestampIso.trim()) return null;
      const timestamp = Date.parse(timestampIso);
      if (!Number.isFinite(timestamp)) return null;

      return {
        value,
        timestamp,
        timestampIso,
        marketCap: parsePositiveNumber((item as { marketCap?: unknown }).marketCap),
        totalVolume: parsePositiveNumber((item as { totalVolume?: unknown }).totalVolume),
      };
    })
    .filter((item): item is AlchemyHistoricalUsdPricePoint => item != null)
    .sort((left, right) => left.timestamp - right.timestamp);
}

async function fetchAlchemyHistoricalTokenUsdPrices(
  bindings: Bindings,
  identifier: AlchemyTokenPriceIdentifier,
  params: {
    startTime: string;
    endTime: string;
    interval: AlchemyHistoricalPriceInterval;
    withMarketData?: boolean;
  },
): Promise<AlchemyHistoricalUsdPricePoint[]> {
  const payload = await fetchAlchemyJson(bindings, '/tokens/historical', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(identifier.type === 'symbol'
        ? { symbol: identifier.symbol }
        : { network: identifier.network, address: identifier.address }),
      startTime: params.startTime,
      endTime: params.endTime,
      interval: params.interval,
      withMarketData: params.withMarketData ?? false,
    }),
  });

  return readHistoricalPricePoints(payload);
}

export {
  fetchAlchemyHistoricalTokenUsdPrices,
  fetchAlchemyTokenUsdPrice,
  type AlchemyHistoricalPriceInterval,
  type AlchemyHistoricalUsdPricePoint,
  type AlchemyTokenPriceIdentifier,
  type AlchemyUsdPricePoint,
};
