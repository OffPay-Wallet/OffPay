import {
  fetchAlchemyHistoricalTokenUsdPrices,
  fetchAlchemyTokenUsdPrice,
} from '@/lib/api/alchemy-prices-api';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type {
  AlchemyHistoricalPriceInterval,
  AlchemyHistoricalUsdPricePoint,
  AlchemyTokenPriceIdentifier,
} from '@/lib/api/alchemy-prices-api';
import type { OffpayNetwork } from '@/types/offpay-api';

const ALCHEMY_SOLANA_MAINNET_NETWORK = 'solana-mainnet';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

function isPositiveUsdPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeAlchemySymbol(value: string | null | undefined): string | null {
  const symbol = value?.trim().toUpperCase();
  if (!symbol) return null;
  if (symbol === 'WSOL') return 'SOL';
  if (symbol === 'DUSDC') return 'USDC';
  if (symbol === 'DUSDT') return 'USDT';
  return symbol;
}

function buildAlchemyPriceLookups(params: {
  mint: string;
  network: OffpayNetwork;
  symbol?: string | null;
  priceSymbol?: string | null;
}): AlchemyTokenPriceIdentifier[] {
  const mint = params.mint.trim();
  const symbol =
    normalizeAlchemySymbol(params.priceSymbol) ?? normalizeAlchemySymbol(params.symbol);
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

export async function getTokenUsdPriceForValuation(params: {
  mint: string;
  network: OffpayNetwork;
  symbol?: string | null;
  priceSymbol?: string | null;
  signal?: AbortSignal;
}): Promise<number | null> {
  const lookups = buildAlchemyPriceLookups(params);
  if (lookups.length === 0) return null;

  for (const lookup of lookups) {
    try {
      const result = await fetchAlchemyTokenUsdPrice(lookup, { signal: params.signal });
      if (isPositiveUsdPrice(result?.value)) return result.value;
    } catch (error) {
      if (params.signal?.aborted) throw error;
      // Try the next documented identifier form before giving up.
    }
  }

  return null;
}

export async function getTokenUsdPriceHistory(params: {
  mint: string;
  network: OffpayNetwork;
  symbol?: string | null;
  priceSymbol?: string | null;
  startTime: string;
  endTime: string;
  interval: AlchemyHistoricalPriceInterval;
  withMarketData?: boolean;
  signal?: AbortSignal;
}): Promise<AlchemyHistoricalUsdPricePoint[]> {
  const lookups = buildAlchemyPriceLookups(params);
  if (lookups.length === 0) return [];

  for (const lookup of lookups) {
    try {
      const result = await fetchAlchemyHistoricalTokenUsdPrices(
        lookup,
        {
          startTime: params.startTime,
          endTime: params.endTime,
          interval: params.interval,
          withMarketData: params.withMarketData,
        },
        { signal: params.signal },
      );
      if (result.length > 0) return result;
    } catch (error) {
      if (params.signal?.aborted) throw error;
      // Historical address pricing is not guaranteed for every token;
      // fall back to symbol pricing when Alchemy has symbol-level market data.
    }
  }

  return [];
}
