import { offpayApiRequest } from '@/lib/api/offpay-api-client';

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

export class AlchemyPricesApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AlchemyPricesApiError';
    this.status = status;
  }
}

export async function fetchAlchemyTokenUsdPrice(
  identifier: AlchemyTokenPriceIdentifier,
  options?: { signal?: AbortSignal },
): Promise<AlchemyUsdPricePoint | null> {
  const response = await offpayApiRequest<{ price: AlchemyUsdPricePoint | null }>({
    path: '/api/market/token-price',
    method: 'POST',
    body: {
      identifier,
      network: 'mainnet',
    },
    network: 'mainnet',
    signal: options?.signal,
  });

  return response.price;
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
  const response = await offpayApiRequest<{ prices: AlchemyHistoricalUsdPricePoint[] }>({
    path: '/api/market/token-price-history',
    method: 'POST',
    body: {
      identifier,
      startTime: params.startTime,
      endTime: params.endTime,
      interval: params.interval,
      withMarketData: params.withMarketData,
      network: 'mainnet',
    },
    network: 'mainnet',
    signal: options?.signal,
  });

  return response.prices;
}
