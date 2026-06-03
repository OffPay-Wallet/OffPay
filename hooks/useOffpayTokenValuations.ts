import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  fetchUsdToCurrencyRate,
  formatFiatCurrency,
  isUsdStablePriceSymbol,
  normalizeCurrency,
} from '@/lib/currency-rates';
import { pooledAllSettled } from '@/lib/perf/concurrency';
import { getTokenUsdPriceForValuation } from '@/lib/market-prices';
import {
  readCachedTokenUsdPrices,
  readCachedUsdToCurrencyRate,
  writeCachedTokenUsdPrices,
} from '@/lib/cache/valuation-cache';
import { mark, measure } from '@/lib/perf/perf-marks';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';

const TOKEN_VALUATION_STALE_TIME_MS = 1000 * 60;
const TOKEN_VALUATION_REFETCH_INTERVAL_MS = 1000 * 60 * 5;

export interface TokenValuationView {
  fiatValueLabel: string;
  unitPriceLabel: string;
}

interface TokenValuationData {
  currency: string;
  rate: number;
  values: Record<string, TokenValuationView>;
  unitUsdPrices: Record<string, number>;
  fetchedAt: number;
}

interface TokenPriceInput {
  mint: string;
  rowKey: string;
  symbol: string;
  priceSymbol: string;
  balance: number;
  usdPrice: number | null;
}

interface LastPricingSnapshot {
  scopeKey: string;
  rate: number;
  unitUsdPrices: Record<string, number>;
}

function buildValuationsFromPrices(params: {
  priceInputs: TokenPriceInput[];
  currency: string;
  rate: number;
  unitUsdPrices: Record<string, number>;
  allowInputUsdPriceFallback: boolean;
}): Record<string, TokenValuationView> {
  const valuations: Record<string, TokenValuationView> = {};

  for (const item of params.priceInputs) {
    const usdPrice = isUsdStablePriceSymbol(item.priceSymbol)
      ? 1
      : (params.unitUsdPrices[item.mint] ??
        (params.allowInputUsdPriceFallback ? item.usdPrice : null));
    if (typeof usdPrice !== 'number' || !Number.isFinite(usdPrice) || usdPrice <= 0) {
      continue;
    }

    const unitPrice = usdPrice * params.rate;
    const fiatValue = item.balance * unitPrice;
    valuations[item.rowKey] = {
      fiatValueLabel: formatFiatCurrency(fiatValue, params.currency),
      unitPriceLabel: `${formatFiatCurrency(unitPrice, params.currency)}/${item.symbol}`,
    };
  }

  return valuations;
}

export function useOffpayTokenValuations({
  holdings,
  currency,
}: {
  holdings: TokenHolding[];
  currency: string;
}) {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const normalizedCurrency = normalizeCurrency(currency);
  const lastPricingRef = useRef<LastPricingSnapshot | null>(null);
  const [cachedValues, setCachedValues] = useState<
    Record<string, TokenValuationView> | undefined
  >();

  const priceInputs = useMemo(() => {
    const seen = new Set<string>();
    return holdings
      .map((holding) => ({
        mint: holding.priceMint,
        rowKey: holding.mint,
        symbol: holding.symbol.trim().toUpperCase(),
        priceSymbol: holding.priceSymbol.trim().toUpperCase(),
        balance: holding.balanceValue,
        usdPrice:
          typeof holding.usdPrice === 'number' &&
          Number.isFinite(holding.usdPrice) &&
          holding.usdPrice > 0
            ? holding.usdPrice
            : null,
      }))
      .filter((item) => {
        if (item.balance <= 0) return false;
        if (seen.has(item.rowKey)) return false;
        seen.add(item.rowKey);
        return true;
      });
  }, [holdings]);

  const enabled = network != null && priceInputs.length > 0;

  useEffect(() => {
    if (network == null || isNetworkAccessSuspended || priceInputs.length === 0) {
      setCachedValues(undefined);
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      const [cachedRate, cachedPrices] = await Promise.all([
        readCachedUsdToCurrencyRate(normalizedCurrency),
        readCachedTokenUsdPrices(network),
      ]);

      if (cancelled) return;
      if (cachedRate == null) {
        setCachedValues(undefined);
        return;
      }

      const values = buildValuationsFromPrices({
        priceInputs,
        currency: normalizedCurrency,
        rate: cachedRate,
        unitUsdPrices: cachedPrices,
        allowInputUsdPriceFallback: true,
      });
      setCachedValues(Object.keys(values).length > 0 ? values : undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, [isNetworkAccessSuspended, network, normalizedCurrency, priceInputs]);

  const query = useQuery<TokenValuationData>({
    queryKey: [
      'offpay',
      'tokenValuations',
      network,
      normalizedCurrency,
      priceInputs
        .map(
          (item) =>
            `${item.rowKey}:${item.balance}:${item.priceSymbol}:${item.usdPrice?.toPrecision(12) ?? ''}`,
        )
        .join('|'),
      canUseNetwork ? 'online' : 'offline-cache',
    ],
    queryFn: async () => {
      const startedAt = mark();
      let fetchedCount = 0;
      let pricedCount = 0;

      try {
        if (network == null) {
          throw new Error('Token valuation requires a supported network.');
        }

        const [fxRate, cachedPrices] = await Promise.all([
          canUseNetwork
            ? fetchUsdToCurrencyRate(normalizedCurrency)
            : readCachedUsdToCurrencyRate(normalizedCurrency),
          readCachedTokenUsdPrices(network),
        ]);

        if (fxRate == null) {
          throw new Error(`Cached USD/${normalizedCurrency} rate is unavailable.`);
        }

        const fetchedPrices: Record<string, number> = {};
        // Cap fan-out at 6 concurrent requests so a wallet with 30+ tokens
        // doesn't fire 30 RPCs in parallel every refetch.
        const PRICE_CONCURRENCY_LIMIT = 6;
        const priceResults = await pooledAllSettled(
          priceInputs,
          PRICE_CONCURRENCY_LIMIT,
          async (item) => {
            if (isUsdStablePriceSymbol(item.priceSymbol)) {
              return { ...item, usdPrice: 1 };
            }

            if (!canUseNetwork) {
              const cachedPrice = cachedPrices[item.mint] ?? item.usdPrice;
              if (cachedPrice == null) {
                throw new Error(`Cached ${item.symbol} price is unavailable.`);
              }
              return { ...item, usdPrice: cachedPrice };
            }

            const usdPrice = await getTokenUsdPriceForValuation({
              mint: item.mint,
              network,
              symbol: item.symbol,
              priceSymbol: item.priceSymbol,
            });
            if (usdPrice == null) {
              throw new Error(`No price available for ${item.symbol}.`);
            }
            fetchedPrices[item.mint] = usdPrice;
            return { ...item, usdPrice };
          },
        );

        const unitUsdPrices: Record<string, number> = { ...cachedPrices };
        priceResults.forEach((result) => {
          if (result.status !== 'fulfilled') return;
          pricedCount += 1;
          unitUsdPrices[result.value.mint] = result.value.usdPrice;
        });
        fetchedCount = Object.keys(fetchedPrices).length;
        const valuations = buildValuationsFromPrices({
          priceInputs,
          currency: normalizedCurrency,
          rate: fxRate,
          unitUsdPrices,
          allowInputUsdPriceFallback: !canUseNetwork,
        });

        if (canUseNetwork) {
          void writeCachedTokenUsdPrices(network, fetchedPrices).catch(() => undefined);
        }

        return {
          currency: normalizedCurrency,
          rate: fxRate,
          values: valuations,
          unitUsdPrices,
          fetchedAt: Date.now(),
        };
      } finally {
        measure('prices.tokenValuations.query', startedAt, {
          network: network ?? 'unknown',
          tokenCount: priceInputs.length,
          pricedCount,
          fetchedCount,
          mode: canUseNetwork ? 'online' : 'cache',
        });
      }
    },
    enabled: enabled && !isNetworkAccessSuspended,
    staleTime: TOKEN_VALUATION_STALE_TIME_MS,
    refetchInterval: enabled && canUseNetwork ? TOKEN_VALUATION_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnReconnect: true,
    retry: 1,
  });
  const pricingScopeKey = `${network ?? 'none'}:${normalizedCurrency}`;

  useEffect(() => {
    if (query.data == null) return;
    lastPricingRef.current = {
      scopeKey: pricingScopeKey,
      rate: query.data.rate,
      unitUsdPrices: query.data.unitUsdPrices,
    };
  }, [pricingScopeKey, query.data]);

  const fallbackValues = useMemo(() => {
    const snapshot = lastPricingRef.current;
    if (snapshot == null || snapshot.scopeKey !== pricingScopeKey) return undefined;
    return buildValuationsFromPrices({
      priceInputs,
      currency: normalizedCurrency,
      rate: snapshot.rate,
      unitUsdPrices: snapshot.unitUsdPrices,
      allowInputUsdPriceFallback: false,
    });
  }, [normalizedCurrency, priceInputs, pricingScopeKey]);
  const mergedValues = useMemo(() => {
    const liveValues = query.data?.values;
    if (liveValues == null) return fallbackValues;
    if (fallbackValues == null) return liveValues;

    return { ...fallbackValues, ...liveValues };
  }, [fallbackValues, query.data?.values]);

  return {
    ...query,
    data: mergedValues ?? cachedValues,
  };
}
