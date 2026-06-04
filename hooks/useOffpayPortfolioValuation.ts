import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  fetchUsdToCurrencyRate,
  formatCompactFiatCurrency,
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
import { yieldToEventLoop, yieldToUi, yieldToUiIfNeeded } from '@/lib/perf/ui-work-scheduler';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';

const PORTFOLIO_VALUATION_STALE_TIME_MS = 60 * 1000;
const PORTFOLIO_VALUATION_REFETCH_INTERVAL_MS = 1000 * 60 * 5;

interface PortfolioValuationInput {
  holdings: TokenHolding[];
  currency: string;
  enabled?: boolean;
  deferCapabilitiesUntilAfterInteractions?: boolean;
}

interface PortfolioValuationData {
  currency: string;
  rate: number;
  totalUsd: number;
  total: number;
  pricedCount: number;
  expectedCount: number;
  fetchedAt: number;
  unitUsdPrices: Record<string, number>;
  tokenValues: Record<
    string,
    {
      fiatValueLabel: string;
      unitPriceLabel: string;
    }
  >;
}

function isPositiveUsdPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

interface LastPricingSnapshot {
  scopeKey: string;
  rate: number;
  unitUsdPrices: Record<string, number>;
}

function buildPortfolioValuationData(params: {
  holdings: TokenHolding[];
  priceInputs: {
    mint: string;
    balance: number;
    symbol: string;
    priceSymbol: string;
    usdPrice: number | null;
  }[];
  currency: string;
  rate: number;
  unitUsdPrices: Record<string, number>;
  fetchedAt: number;
  allowProviderUsdPriceFallback: boolean;
}): PortfolioValuationData {
  let totalUsd = 0;
  let pricedCount = 0;

  for (const item of params.priceInputs) {
    const usdPrice = isUsdStablePriceSymbol(item.priceSymbol)
      ? 1
      : (params.unitUsdPrices[item.mint] ??
        (params.allowProviderUsdPriceFallback ? item.usdPrice : null));
    if (!isPositiveUsdPrice(usdPrice)) {
      continue;
    }
    pricedCount += 1;
    totalUsd += item.balance * usdPrice;
  }

  const tokenValues: Record<string, { fiatValueLabel: string; unitPriceLabel: string }> = {};

  for (const holding of params.holdings) {
    const symbol = holding.symbol.trim().toUpperCase();
    const priceSymbol = holding.priceSymbol.trim().toUpperCase();
    const usdPrice = isUsdStablePriceSymbol(priceSymbol)
      ? 1
      : (params.unitUsdPrices[holding.priceMint] ??
        (params.allowProviderUsdPriceFallback ? holding.usdPrice : null));
    if (!isPositiveUsdPrice(usdPrice)) {
      continue;
    }

    const unitPrice = usdPrice * params.rate;
    tokenValues[holding.mint] = {
      fiatValueLabel: formatCompactFiatCurrency(holding.balanceValue * unitPrice, params.currency),
      unitPriceLabel: `${formatFiatCurrency(unitPrice, params.currency)}/${symbol}`,
    };
  }

  return {
    currency: params.currency,
    rate: params.rate,
    totalUsd,
    total: totalUsd * params.rate,
    pricedCount,
    expectedCount: params.priceInputs.length,
    fetchedAt: params.fetchedAt,
    unitUsdPrices: params.unitUsdPrices,
    tokenValues,
  };
}

export function useOffpayPortfolioValuation({
  holdings,
  currency,
  enabled: enabledOption,
}: PortfolioValuationInput) {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const enabledByCaller = enabledOption ?? true;
  const normalizedCurrency = normalizeCurrency(currency);
  const lastPricingRef = useRef<LastPricingSnapshot | null>(null);
  const [cachedData, setCachedData] = useState<PortfolioValuationData | null>(null);

  const priceInputs = useMemo(() => {
    const seen = new Set<string>();
    return holdings
      .map((holding) => ({
        mint: holding.priceMint,
        balance: holding.balanceValue,
        symbol: holding.symbol.trim().toUpperCase(),
        priceSymbol: holding.priceSymbol.trim().toUpperCase(),
        usdPrice: isPositiveUsdPrice(holding.usdPrice) ? holding.usdPrice : null,
      }))
      .filter((item) => {
        if (item.balance <= 0) return false;
        if (seen.has(item.mint)) return false;
        seen.add(item.mint);
        return true;
      });
  }, [holdings]);

  const enabled = network != null && enabledByCaller && priceInputs.length > 0;

  useEffect(() => {
    if (
      !enabledByCaller ||
      network == null ||
      isNetworkAccessSuspended ||
      priceInputs.length === 0
    ) {
      setCachedData(null);
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      await yieldToUi();
      const [cachedRate, cachedPrices] = await Promise.all([
        readCachedUsdToCurrencyRate(normalizedCurrency),
        readCachedTokenUsdPrices(network),
      ]);

      if (cancelled) return;
      if (cachedRate == null) {
        setCachedData(null);
        return;
      }

      await yieldToUi();
      if (cancelled) return;
      const nextData = buildPortfolioValuationData({
        holdings,
        priceInputs,
        currency: normalizedCurrency,
        rate: cachedRate,
        unitUsdPrices: cachedPrices,
        fetchedAt: Date.now(),
        allowProviderUsdPriceFallback: true,
      });
      setCachedData(nextData.pricedCount > 0 ? nextData : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    enabledByCaller,
    holdings,
    isNetworkAccessSuspended,
    network,
    normalizedCurrency,
    priceInputs,
  ]);

  const query = useQuery<PortfolioValuationData>({
    queryKey: [
      'offpay',
      'portfolioValuation',
      network,
      normalizedCurrency,
      // Key on the mint set plus provider-supplied prices. Unit prices
      // are independent of balances, but DAS price_info can refresh
      // alongside the balance payload and should update the portfolio
      // without waiting for the 5-minute valuation interval.
      priceInputs.map((item) => item.mint).join('|'),
      priceInputs.map((item) => item.priceSymbol).join('|'),
      priceInputs
        .map((item) => (item.usdPrice == null ? '' : item.usdPrice.toPrecision(12)))
        .join('|'),
      canUseNetwork ? 'online' : 'offline-cache',
    ],
    queryFn: async () => {
      if (network == null) {
        throw new Error('Portfolio valuation requires a supported network.');
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
          await yieldToEventLoop();
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
      let budgetStartedAt = Date.now();
      for (const result of priceResults) {
        if (result.status === 'fulfilled') {
          unitUsdPrices[result.value.mint] = result.value.usdPrice;
        }
        budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
      }

      if (canUseNetwork) {
        void (async () => {
          await yieldToUi();
          await writeCachedTokenUsdPrices(network, fetchedPrices);
        })().catch(() => undefined);
      }

      await yieldToUi();
      return buildPortfolioValuationData({
        holdings,
        priceInputs,
        currency: normalizedCurrency,
        rate: fxRate,
        unitUsdPrices,
        fetchedAt: Date.now(),
        allowProviderUsdPriceFallback: !canUseNetwork,
      });
    },
    enabled: enabled && !isNetworkAccessSuspended,
    staleTime: PORTFOLIO_VALUATION_STALE_TIME_MS,
    refetchInterval: enabled && canUseNetwork ? PORTFOLIO_VALUATION_REFETCH_INTERVAL_MS : false,
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

  const fallbackData = useMemo(() => {
    const snapshot = lastPricingRef.current;
    if (snapshot == null || snapshot.scopeKey !== pricingScopeKey) return undefined;
    return buildPortfolioValuationData({
      holdings,
      priceInputs,
      currency: normalizedCurrency,
      rate: snapshot.rate,
      unitUsdPrices: snapshot.unitUsdPrices,
      fetchedAt: Date.now(),
      allowProviderUsdPriceFallback: false,
    });
  }, [holdings, normalizedCurrency, priceInputs, pricingScopeKey]);

  return {
    ...query,
    data: query.data ?? fallbackData ?? cachedData ?? undefined,
  };
}
