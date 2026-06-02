const ALCHEMY_PRICES_API_ORIGIN = 'https://api.g.alchemy.com/prices/v1';
const ALCHEMY_PRICES_TIMEOUT_MS = 12_000;

export type AlchemyTokenPriceIdentifier =
  | {
      type: 'symbol';
      symbol: string;
    }
  | {
      type: 'address';
      network: string;
      address: string;
    };

export type AlchemyHistoricalPriceInterval = '5m' | '1h' | '1d';

export interface AlchemyUsdPricePoint {
  value: number;
  lastUpdatedAt: string;
}

export interface AlchemyHistoricalUsdPricePoint {
  value: number;
  timestamp: number;
  timestampIso: string;
  marketCap: number | null;
  totalVolume: number | null;
}

interface ScopedAbortHandle {
  signal: AbortSignal;
  cleanup: () => void;
}

export class AlchemyPricesApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AlchemyPricesApiError';
    this.status = status;
  }
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number = ALCHEMY_PRICES_TIMEOUT_MS,
): ScopedAbortHandle {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Alchemy Prices request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  if (signal != null) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const onAbort = (): void => controller.abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });

      return {
        signal: controller.signal,
        cleanup: () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
        },
      };
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function extractAlchemyKeyFromRpcUrl(value: string | undefined): string | null {
  const rawUrl = value?.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\/v2\/([^/?#]+)/);
    return match?.[1]?.trim() || null;
  } catch {
    const match = rawUrl.match(/\/v2\/([^/?#]+)/);
    return match?.[1]?.trim() || null;
  }
}

export function getAlchemyPricesApiKey(): string | null {
  const explicitKey = process.env.EXPO_PUBLIC_ALCHEMY_PRICE_API_KEY?.trim();
  if (explicitKey) return explicitKey;

  return (
    extractAlchemyKeyFromRpcUrl(process.env.EXPO_PUBLIC_ALCHEMY_MAINNET_RPC_URL) ??
    extractAlchemyKeyFromRpcUrl(process.env.EXPO_PUBLIC_ALCHEMY_DEVNET_RPC_URL)
  );
}

function buildAlchemyPricesUrl(apiKey: string, path: `/${string}`): string {
  return `${ALCHEMY_PRICES_API_ORIGIN}/${encodeURIComponent(apiKey)}${path}`;
}

function readErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload == null || Array.isArray(payload)) return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error !== 'object' || error == null || Array.isArray(error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}

async function parseAlchemyJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AlchemyPricesApiError('Alchemy Prices returned invalid JSON.', response.status);
  }
}

async function fetchAlchemyJson(
  path: `/${string}`,
  init: RequestInit,
  options?: { signal?: AbortSignal },
): Promise<unknown> {
  const apiKey = getAlchemyPricesApiKey();
  if (apiKey == null) {
    throw new AlchemyPricesApiError('Alchemy Prices API key is not configured.', 0);
  }

  const handle = withTimeout(options?.signal);
  try {
    const response = await fetch(buildAlchemyPricesUrl(apiKey, path), {
      ...init,
      signal: handle.signal,
    });
    const payload = await parseAlchemyJson(response);
    if (!response.ok) {
      throw new AlchemyPricesApiError(
        readErrorMessage(payload) ?? `Alchemy Prices request failed with ${response.status}.`,
        response.status,
      );
    }
    return payload;
  } finally {
    handle.cleanup();
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

export async function fetchAlchemyTokenUsdPrice(
  identifier: AlchemyTokenPriceIdentifier,
  options?: { signal?: AbortSignal },
): Promise<AlchemyUsdPricePoint | null> {
  const payload =
    identifier.type === 'symbol'
      ? await fetchAlchemyJson(
          `/tokens/by-symbol?symbols=${encodeURIComponent(identifier.symbol)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          options,
        )
      : await fetchAlchemyJson(
          '/tokens/by-address',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              addresses: [{ network: identifier.network, address: identifier.address }],
            }),
          },
          options,
        );

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

export async function fetchAlchemyHistoricalTokenUsdPrices(
  identifier: AlchemyTokenPriceIdentifier,
  params: {
    startTime: string;
    endTime: string;
    interval: AlchemyHistoricalPriceInterval;
    withMarketData?: boolean;
  },
  options?: { signal?: AbortSignal },
): Promise<AlchemyHistoricalUsdPricePoint[]> {
  const payload = await fetchAlchemyJson(
    '/tokens/historical',
    {
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
    },
    options,
  );

  return readHistoricalPricePoints(payload);
}
