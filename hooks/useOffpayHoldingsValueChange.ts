import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import {
  buildTokenPriceHistoryQueryKey,
  fetchTokenPriceHistoryView,
  resolveTokenPriceHistoryTimeframe,
  TOKEN_PRICE_HISTORY_REFETCH_INTERVAL_MS,
  TOKEN_PRICE_HISTORY_STALE_TIME_MS,
  type TokenPriceHistoryTimeframe,
  type TokenPriceHistoryTimeframeId,
  type TokenPriceHistoryView,
} from '@/hooks/useOffpayTokenPriceHistory';
import {
  formatFiatCurrency,
  isUsdStablePriceSymbol,
  normalizeCurrency,
} from '@/lib/currency-rates';
import { formatPercentChange, type ChangeTone } from '@/lib/ui/token-change-format';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';

const MAX_HISTORY_PRICED_HOLDINGS = 6;
const MAX_HOLDINGS_VALUE_CHANGE_SAMPLES = 160;

export type HoldingsValueChangeTimeframeId = Extract<
  TokenPriceHistoryTimeframeId,
  '24H' | '7D' | '30D'
>;

export const HOLDINGS_VALUE_CHANGE_TIMEFRAMES = [
  resolveTokenPriceHistoryTimeframe('24H'),
  resolveTokenPriceHistoryTimeframe('7D'),
  resolveTokenPriceHistoryTimeframe('30D'),
] as const satisfies readonly TokenPriceHistoryTimeframe[];

export interface HoldingsValueChangeSample {
  timestamp: number;
  value: number;
  usdValue: number;
}

export interface HoldingsValueChange {
  absolute: number;
  usdAbsolute: number;
  percent: number;
  tone: ChangeTone;
}

export interface HoldingsValueChangeView {
  currency: string;
  rate: number;
  timeframe: HoldingsValueChangeTimeframeId;
  timeframeLabel: string;
  samples: HoldingsValueChangeSample[];
  change: HoldingsValueChange | null;
  changeAbsoluteLabel: string | null;
  changePercentLabel: string | null;
  fetchedAt: number;
  pricedHistoryCount: number;
  expectedHistoryCount: number;
}

export interface HoldingsValueChangeTokenInput {
  mint: string;
  priceMint: string;
  symbol: string;
  priceSymbol: string;
  balance: number;
  stableUsdPrice: number | null;
  currentUsdPrice: number | null;
}

interface CurrentValuationSnapshot {
  currency: string;
  rate: number;
  total: number;
  totalUsd: number;
  unitUsdPrices: Record<string, number>;
  fetchedAt: number;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeSignedZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < Number.EPSILON * 10 ? 0 : value;
}

function compareByEstimatedUsdValue(
  left: HoldingsValueChangeTokenInput,
  right: HoldingsValueChangeTokenInput,
): number {
  const leftPrice = left.stableUsdPrice ?? left.currentUsdPrice ?? 0;
  const rightPrice = right.stableUsdPrice ?? right.currentUsdPrice ?? 0;
  return right.balance * rightPrice - left.balance * leftPrice;
}

function downsampleHoldingsValueSamples(
  samples: HoldingsValueChangeSample[],
): HoldingsValueChangeSample[] {
  if (samples.length <= MAX_HOLDINGS_VALUE_CHANGE_SAMPLES) return samples;

  const result: HoldingsValueChangeSample[] = [];
  let previousIndex = -1;

  for (let index = 0; index < MAX_HOLDINGS_VALUE_CHANGE_SAMPLES; index += 1) {
    const sourceIndex = Math.round(
      (index / Math.max(MAX_HOLDINGS_VALUE_CHANGE_SAMPLES - 1, 1)) * (samples.length - 1),
    );
    if (sourceIndex === previousIndex) continue;
    previousIndex = sourceIndex;
    const sample = samples[sourceIndex];
    if (sample != null) result.push(sample);
  }

  return result;
}

function findClosestHistorySample(
  history: TokenPriceHistoryView | null | undefined,
  timestamp: number,
) {
  const samples = history?.samples ?? [];
  if (samples.length === 0) return null;

  let closest = samples[0];
  let closestDistance = Math.abs(closest.timestamp - timestamp);

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    const distance = Math.abs(sample.timestamp - timestamp);
    if (distance >= closestDistance) continue;
    closest = sample;
    closestDistance = distance;
  }

  return closest;
}

function currentUsdPriceForInput(
  input: HoldingsValueChangeTokenInput,
  liveUsdPricesByMint: ReadonlyMap<string, number>,
): number | null {
  return (
    input.stableUsdPrice ??
    liveUsdPricesByMint.get(input.priceMint) ??
    input.currentUsdPrice ??
    null
  );
}

function buildCurrentHoldingsValueSample(params: {
  inputs: HoldingsValueChangeTokenInput[];
  liveUsdPricesByMint: ReadonlyMap<string, number>;
  rate: number;
  timestamp: number;
}): HoldingsValueChangeSample | null {
  let usdValue = 0;
  let priced = false;

  for (const input of params.inputs) {
    const usdPrice = currentUsdPriceForInput(input, params.liveUsdPricesByMint);
    if (!isPositiveNumber(usdPrice)) continue;
    priced = true;
    usdValue += input.balance * usdPrice;
  }

  if (!priced || usdValue <= 0) return null;

  return {
    timestamp: params.timestamp,
    value: usdValue * params.rate,
    usdValue,
  };
}

export function selectHoldingsValueChangeInputs(params: {
  holdings: TokenHolding[];
  currentUnitUsdPrices?: Readonly<Record<string, number>> | null;
  maxHistoryPricedHoldings?: number;
}): {
  inputs: HoldingsValueChangeTokenInput[];
  historyInputs: HoldingsValueChangeTokenInput[];
} {
  const byPriceMint = new Map<string, HoldingsValueChangeTokenInput>();

  for (const holding of params.holdings) {
    if (!isPositiveNumber(holding.balanceValue)) continue;

    const priceMint = holding.priceMint.trim();
    if (priceMint.length === 0) continue;

    const priceSymbol =
      holding.priceSymbol.trim().toUpperCase() || holding.symbol.trim().toUpperCase();
    const stableUsdPrice = isUsdStablePriceSymbol(priceSymbol) ? 1 : null;
    const cachedUsdPrice = params.currentUnitUsdPrices?.[priceMint];
    const currentUsdPrice =
      stableUsdPrice ?? (isPositiveNumber(cachedUsdPrice) ? cachedUsdPrice : holding.usdPrice);
    const existing = byPriceMint.get(priceMint);

    if (existing != null) {
      existing.balance += holding.balanceValue;
      if (!isPositiveNumber(existing.currentUsdPrice) && isPositiveNumber(currentUsdPrice)) {
        existing.currentUsdPrice = currentUsdPrice;
      }
      continue;
    }

    byPriceMint.set(priceMint, {
      mint: holding.mint,
      priceMint,
      symbol: holding.symbol.trim().toUpperCase() || priceSymbol,
      priceSymbol,
      balance: holding.balanceValue,
      stableUsdPrice,
      currentUsdPrice: isPositiveNumber(currentUsdPrice) ? currentUsdPrice : null,
    });
  }

  const allInputs = Array.from(byPriceMint.values()).sort(compareByEstimatedUsdValue);
  const stableInputs = allInputs.filter((input) => input.stableUsdPrice != null);
  const historyInputs = allInputs
    .filter((input) => input.stableUsdPrice == null)
    .slice(0, params.maxHistoryPricedHoldings ?? MAX_HISTORY_PRICED_HOLDINGS);

  return {
    inputs: [...stableInputs, ...historyInputs],
    historyInputs,
  };
}

export function buildHoldingsValueChangeSamples(params: {
  inputs: HoldingsValueChangeTokenInput[];
  historiesByMint: ReadonlyMap<string, TokenPriceHistoryView>;
  rate: number;
  timestamp: number;
  timeframe: TokenPriceHistoryTimeframe;
}): HoldingsValueChangeSample[] {
  const eligibleInputs = params.inputs.filter((input) => {
    if (input.stableUsdPrice != null) return true;
    return (params.historiesByMint.get(input.priceMint)?.samples.length ?? 0) >= 2;
  });
  const histories = eligibleInputs
    .filter((input) => input.stableUsdPrice == null)
    .map((input) => params.historiesByMint.get(input.priceMint))
    .filter((history): history is TokenPriceHistoryView => (history?.samples.length ?? 0) >= 2);
  const anchorHistory = histories.reduce<TokenPriceHistoryView | null>((longest, history) => {
    if (longest == null || history.samples.length > longest.samples.length) return history;
    return longest;
  }, null);
  const stableUsdValue = eligibleInputs.reduce(
    (total, input) => total + input.balance * (input.stableUsdPrice ?? 0),
    0,
  );
  const liveUsdPricesByMint = new Map<string, number>();

  for (const input of eligibleInputs) {
    const history = params.historiesByMint.get(input.priceMint);
    if (isPositiveNumber(history?.liveUsdPrice)) {
      liveUsdPricesByMint.set(input.priceMint, history.liveUsdPrice);
    }
  }

  if (anchorHistory == null) {
    const currentSample = buildCurrentHoldingsValueSample({
      inputs: eligibleInputs,
      liveUsdPricesByMint,
      rate: params.rate,
      timestamp: params.timestamp,
    });
    if (currentSample == null || stableUsdValue <= 0) return [];

    const startTimestamp = params.timestamp - params.timeframe.durationMs;
    return [
      {
        timestamp: startTimestamp,
        value: stableUsdValue * params.rate,
        usdValue: stableUsdValue,
      },
      currentSample,
    ];
  }

  const samples: HoldingsValueChangeSample[] = [];

  for (const anchor of anchorHistory.samples) {
    let value = stableUsdValue * params.rate;
    let usdValue = stableUsdValue;
    let priced = stableUsdValue > 0;

    for (const input of eligibleInputs) {
      if (input.stableUsdPrice != null) continue;
      const sample = findClosestHistorySample(
        params.historiesByMint.get(input.priceMint),
        anchor.timestamp,
      );
      if (sample == null) continue;
      priced = true;
      value += input.balance * sample.price;
      usdValue += input.balance * sample.usdPrice;
    }

    if (priced && value > 0 && usdValue > 0) {
      samples.push({
        timestamp: anchor.timestamp,
        value,
        usdValue,
      });
    }
  }

  const currentSample = buildCurrentHoldingsValueSample({
    inputs: eligibleInputs,
    liveUsdPricesByMint,
    rate: params.rate,
    timestamp: params.timestamp,
  });
  const lastSample = samples.at(-1);
  if (
    currentSample != null &&
    (lastSample == null || currentSample.timestamp > lastSample.timestamp)
  ) {
    samples.push(currentSample);
  }

  return downsampleHoldingsValueSamples(samples);
}

export function calculateHoldingsValueChange(
  samples: readonly HoldingsValueChangeSample[],
): HoldingsValueChange | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (first == null || last == null || samples.length < 2 || first.value <= 0) return null;

  const absolute = normalizeSignedZero(last.value - first.value);
  const usdAbsolute = normalizeSignedZero(last.usdValue - first.usdValue);
  const percent = normalizeSignedZero((absolute / first.value) * 100);

  return {
    absolute,
    usdAbsolute,
    percent,
    tone: percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral',
  };
}

export function formatSignedFiatChange(value: number, currency: string): string {
  const normalized = normalizeSignedZero(value);
  if (!Number.isFinite(normalized)) return '--';

  const absolute = Math.abs(normalized);
  const sign = normalized > 0 ? '+' : normalized < 0 ? '-' : '';
  if (absolute > 0 && absolute < 0.01) {
    return `${sign}<${formatFiatCurrency(0.01, currency)}`;
  }

  return `${sign}${formatFiatCurrency(absolute, currency)}`;
}

export function useOffpayHoldingsValueChange({
  holdings,
  currency,
  timeframe,
  enabled = true,
  networkFetchEnabled = true,
  currentValuation,
}: {
  holdings: TokenHolding[];
  currency: string;
  timeframe: HoldingsValueChangeTimeframeId;
  enabled?: boolean;
  networkFetchEnabled?: boolean;
  currentValuation?: CurrentValuationSnapshot | null;
}) {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const normalizedCurrency = normalizeCurrency(currency);
  const activeTimeframe = resolveTokenPriceHistoryTimeframe(timeframe);
  const { inputs, historyInputs } = useMemo(
    () =>
      selectHoldingsValueChangeInputs({
        holdings,
        currentUnitUsdPrices: currentValuation?.unitUsdPrices ?? null,
      }),
    [currentValuation?.unitUsdPrices, holdings],
  );
  const queryEnabled =
    enabled &&
    networkFetchEnabled &&
    network != null &&
    canUseNetwork &&
    !isNetworkAccessSuspended &&
    historyInputs.length > 0;

  const historyQueries = useQueries({
    queries: historyInputs.map((input) => {
      const normalizedMint = input.priceMint;
      const normalizedSymbol = input.symbol || input.priceSymbol;
      const normalizedPriceSymbol = input.priceSymbol || normalizedSymbol;

      return {
        queryKey: buildTokenPriceHistoryQueryKey({
          network,
          currency: normalizedCurrency,
          mint: normalizedMint,
          symbol: normalizedSymbol,
          priceSymbol: normalizedPriceSymbol,
          timeframe: activeTimeframe,
          onlineState: canUseNetwork ? 'online' : 'offline',
        }),
        queryFn: ({ signal }: { signal: AbortSignal }) => {
          if (network == null) {
            throw new Error('Holdings value change requires a supported network.');
          }
          if (!canUseNetwork || isNetworkAccessSuspended) {
            throw new Error('Network access is unavailable for holdings value change.');
          }

          return fetchTokenPriceHistoryView({
            network,
            normalizedMint,
            normalizedSymbol,
            normalizedPriceSymbol,
            normalizedCurrency,
            activeTimeframe,
            signal,
          });
        },
        enabled: queryEnabled,
        staleTime: TOKEN_PRICE_HISTORY_STALE_TIME_MS,
        refetchInterval:
          enabled && networkFetchEnabled && canUseNetwork
            ? TOKEN_PRICE_HISTORY_REFETCH_INTERVAL_MS
            : false,
        refetchIntervalInBackground: false,
        refetchOnMount: false,
        refetchOnReconnect: true,
        placeholderData: (previousData: TokenPriceHistoryView | undefined) => previousData,
        retry: 1,
      };
    }),
  });

  const view = useMemo<HoldingsValueChangeView>(() => {
    const historiesByMint = new Map<string, TokenPriceHistoryView>();
    historyQueries.forEach((query, index) => {
      const input = historyInputs[index];
      if (input == null || query.data == null) return;
      historiesByMint.set(input.priceMint, query.data);
    });
    const rate =
      currentValuation?.currency === normalizedCurrency && isPositiveNumber(currentValuation.rate)
        ? currentValuation.rate
        : (historyQueries.find((query) => isPositiveNumber(query.data?.rate))?.data?.rate ?? 1);
    const samples = buildHoldingsValueChangeSamples({
      inputs,
      historiesByMint,
      rate,
      timestamp: Date.now(),
      timeframe: activeTimeframe,
    });
    const change = calculateHoldingsValueChange(samples);

    return {
      currency: normalizedCurrency,
      rate,
      timeframe,
      timeframeLabel: activeTimeframe.label,
      samples,
      change,
      changeAbsoluteLabel:
        change == null ? null : formatSignedFiatChange(change.absolute, normalizedCurrency),
      changePercentLabel: change == null ? null : formatPercentChange(change.percent),
      fetchedAt: Date.now(),
      pricedHistoryCount: historiesByMint.size,
      expectedHistoryCount: historyInputs.length,
    };
  }, [
    activeTimeframe,
    currentValuation?.currency,
    currentValuation?.rate,
    historyInputs,
    historyQueries,
    inputs,
    normalizedCurrency,
    timeframe,
  ]);
  const isInitialLoading =
    queryEnabled &&
    view.samples.length < 2 &&
    historyQueries.some((query) => query.isLoading || query.isPending);
  const isFetching = historyQueries.some((query) => query.isFetching);
  const refetch = useCallback(() => {
    if (!queryEnabled) {
      return Promise.resolve([]);
    }

    return Promise.allSettled(
      historyQueries.map((query) => query.refetch({ cancelRefetch: true })),
    );
  }, [historyQueries, queryEnabled]);

  return {
    data: view,
    isLoading: isInitialLoading,
    isFetching,
    refetch,
  };
}
