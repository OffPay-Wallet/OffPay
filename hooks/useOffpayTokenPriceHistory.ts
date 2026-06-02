import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { CURRENCIES } from '@/constants/currencies';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { readCachedUsdToCurrencyRate } from '@/lib/cache/valuation-cache';
import { fetchUsdToCurrencyRate, normalizeCurrency } from '@/lib/currency-rates';
import { getTokenUsdPriceForValuation, getTokenUsdPriceHistory } from '@/lib/market-prices';

import type {
  AlchemyHistoricalPriceInterval,
  AlchemyHistoricalUsdPricePoint,
} from '@/lib/api/alchemy-prices-api';

const TOKEN_PRICE_HISTORY_STALE_TIME_MS = 1000 * 60;
const TOKEN_PRICE_HISTORY_REFETCH_INTERVAL_MS = 1000 * 60 * 5;

export type TokenPriceHistoryTimeframeId = '1H' | '4H' | '24H' | '7D' | '30D' | '1Y';

export const TOKEN_PRICE_HISTORY_TIMEFRAMES = [
  {
    id: '1H',
    label: '1H',
    durationMs: 1000 * 60 * 60,
    interval: '5m',
  },
  {
    id: '4H',
    label: '4H',
    durationMs: 1000 * 60 * 60 * 4,
    interval: '5m',
  },
  {
    id: '24H',
    label: '24H',
    durationMs: 1000 * 60 * 60 * 24,
    interval: '5m',
  },
  {
    id: '7D',
    label: '7D',
    durationMs: 1000 * 60 * 60 * 24 * 7,
    interval: '5m',
  },
  {
    id: '30D',
    label: '30D',
    durationMs: 1000 * 60 * 60 * 24 * 30,
    interval: '1h',
  },
  {
    id: '1Y',
    label: '1Y',
    durationMs: 1000 * 60 * 60 * 24 * 365,
    interval: '1d',
  },
] as const satisfies ReadonlyArray<{
  id: TokenPriceHistoryTimeframeId;
  label: string;
  durationMs: number;
  interval: AlchemyHistoricalPriceInterval;
}>;

export interface ConvertedTokenPriceHistorySample {
  price: number;
  usdPrice: number;
  timestamp: number;
  marketCapUsd: number | null;
  totalVolumeUsd: number | null;
}

export interface TokenPriceHistoryChange {
  absolute: number;
  usdAbsolute: number;
  percent: number;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface TokenPriceHistoryView {
  currency: string;
  rate: number;
  timeframe: TokenPriceHistoryTimeframeId;
  timeframeLabel: string;
  interval: AlchemyHistoricalPriceInterval;
  liveUsdPrice: number | null;
  livePrice: number | null;
  unitPriceLabel: string | null;
  samples: ConvertedTokenPriceHistorySample[];
  change: TokenPriceHistoryChange | null;
  latestMarketCapUsd: number | null;
  latestTotalVolumeUsd: number | null;
  fetchedAt: number;
  statusMessage: string | null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveTimeframe(timeframe: TokenPriceHistoryTimeframeId) {
  return (
    TOKEN_PRICE_HISTORY_TIMEFRAMES.find((entry) => entry.id === timeframe) ??
    TOKEN_PRICE_HISTORY_TIMEFRAMES[0]
  );
}

function formatUnitFiatCurrency(value: number, currencyCode: string): string {
  if (!Number.isFinite(value)) return '--';
  const normalizedCurrency = normalizeCurrency(currencyCode);
  const currency = CURRENCIES.find((entry) => entry.code === normalizedCurrency);
  const absoluteValue = Math.abs(value);
  const maximumFractionDigits = absoluteValue >= 1 ? 4 : absoluteValue >= 0.01 ? 6 : 8;
  const minimumFractionDigits = absoluteValue >= 1 ? 2 : 0;
  const formattedNumber = new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(Object.is(value, -0) ? 0 : value);

  return `${currency?.symbol ?? normalizedCurrency} ${formattedNumber}`;
}

function convertSamples(
  samples: AlchemyHistoricalUsdPricePoint[],
  rate: number,
): ConvertedTokenPriceHistorySample[] {
  return samples
    .filter((sample) => isPositiveNumber(sample.value) && Number.isFinite(sample.timestamp))
    .map((sample) => ({
      price: sample.value * rate,
      usdPrice: sample.value,
      timestamp: sample.timestamp,
      marketCapUsd: sample.marketCap,
      totalVolumeUsd: sample.totalVolume,
    }));
}

function calculateChange(
  samples: ConvertedTokenPriceHistorySample[],
): TokenPriceHistoryChange | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (first == null || last == null || samples.length < 2 || first.price <= 0) return null;

  const absolute = last.price - first.price;
  const usdAbsolute = last.usdPrice - first.usdPrice;
  const percent = (absolute / first.price) * 100;
  const normalizedPercent = Object.is(percent, -0) ? 0 : percent;

  return {
    absolute: Object.is(absolute, -0) ? 0 : absolute,
    usdAbsolute: Object.is(usdAbsolute, -0) ? 0 : usdAbsolute,
    percent: normalizedPercent,
    tone: normalizedPercent > 0 ? 'positive' : normalizedPercent < 0 ? 'negative' : 'neutral',
  };
}

export function useOffpayTokenPriceHistory({
  mint,
  symbol,
  priceSymbol,
  currency,
  timeframe,
  enabled = true,
}: {
  mint: string | null | undefined;
  symbol: string | null | undefined;
  priceSymbol: string | null | undefined;
  currency: string;
  timeframe: TokenPriceHistoryTimeframeId;
  enabled?: boolean;
}) {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedMint = mint?.trim() ?? '';
  const normalizedSymbol = symbol?.trim().toUpperCase() || priceSymbol?.trim().toUpperCase() || '';
  const normalizedPriceSymbol = priceSymbol?.trim().toUpperCase() || normalizedSymbol;
  const activeTimeframe = resolveTimeframe(timeframe);

  const queryKey = useMemo(
    () => [
      'offpay',
      'tokenPriceHistory',
      'alchemy',
      network,
      normalizedCurrency,
      normalizedMint,
      normalizedSymbol,
      normalizedPriceSymbol,
      activeTimeframe.id,
      activeTimeframe.interval,
      canUseNetwork ? 'online' : 'offline',
    ],
    [
      activeTimeframe.id,
      activeTimeframe.interval,
      canUseNetwork,
      network,
      normalizedCurrency,
      normalizedMint,
      normalizedPriceSymbol,
      normalizedSymbol,
    ],
  );

  return useQuery<TokenPriceHistoryView>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (network == null || normalizedMint.length === 0) {
        throw new Error('Token price history requires a supported network and token mint.');
      }
      if (!canUseNetwork || isNetworkAccessSuspended) {
        throw new Error('Network access is unavailable for Alchemy price history.');
      }

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - activeTimeframe.durationMs);
      const [historicalUsdSamples, livePrice, cachedRate] = await Promise.all([
        getTokenUsdPriceHistory({
          mint: normalizedMint,
          network,
          symbol: normalizedSymbol,
          priceSymbol: normalizedPriceSymbol,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          interval: activeTimeframe.interval,
          withMarketData: true,
          signal,
        }),
        getTokenUsdPriceForValuation({
          mint: normalizedMint,
          network,
          symbol: normalizedSymbol,
          priceSymbol: normalizedPriceSymbol,
          signal,
        }),
        readCachedUsdToCurrencyRate(normalizedCurrency),
      ]);

      const rate =
        normalizedCurrency === 'USD'
          ? 1
          : await fetchUsdToCurrencyRate(normalizedCurrency).catch(() => cachedRate);
      const normalizedRate = isPositiveNumber(rate)
        ? rate
        : normalizedCurrency === 'USD'
          ? 1
          : null;
      const samples =
        normalizedRate == null ? [] : convertSamples(historicalUsdSamples, normalizedRate);
      const latestSample = samples.at(-1);
      const liveUsdPrice = isPositiveNumber(livePrice)
        ? livePrice
        : (latestSample?.usdPrice ?? null);
      const livePriceConverted =
        normalizedRate != null && isPositiveNumber(liveUsdPrice)
          ? liveUsdPrice * normalizedRate
          : null;

      return {
        currency: normalizedCurrency,
        rate: normalizedRate ?? 1,
        timeframe: activeTimeframe.id,
        timeframeLabel: activeTimeframe.label,
        interval: activeTimeframe.interval,
        liveUsdPrice,
        livePrice: livePriceConverted,
        unitPriceLabel:
          livePriceConverted != null
            ? `${formatUnitFiatCurrency(livePriceConverted, normalizedCurrency)}/${normalizedSymbol}`
            : null,
        samples,
        change: calculateChange(samples),
        latestMarketCapUsd: latestSample?.marketCapUsd ?? null,
        latestTotalVolumeUsd: latestSample?.totalVolumeUsd ?? null,
        fetchedAt: Date.now(),
        statusMessage:
          samples.length >= 2
            ? null
            : `Alchemy has no ${activeTimeframe.label} chart data for this token.`,
      };
    },
    enabled:
      enabled &&
      network != null &&
      normalizedMint.length > 0 &&
      canUseNetwork &&
      !isNetworkAccessSuspended,
    staleTime: TOKEN_PRICE_HISTORY_STALE_TIME_MS,
    refetchInterval: enabled && canUseNetwork ? TOKEN_PRICE_HISTORY_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnReconnect: true,
    placeholderData: (previousData) => previousData,
    retry: 1,
  });
}
