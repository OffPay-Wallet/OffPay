import { FLASH_ANALYTICS_TIMEOUT_MS, FLASH_ANALYTICS_CACHE_TTL_MS } from './constants';
import type {
  FlashPoolStats,
  FlashFundingRate,
  FlashOpenInterest,
  FlashLiquidationHeatmap,
  FlashCorrelation,
  FlashOptimalEntry,
  FlashPositionSizing,
  FlashHedgeSuggestion,
  FlashPriceCandle,
} from './types';
import type { FlashPosition, FlashMarket, FlashPrice } from './index';

interface AnalyticsCacheEntry<T> {
  data: T;
  timestamp: number;
}

interface SentimentData {
  pools: FlashPoolStats[];
  fundingRates: FlashFundingRate[];
  openInterest: FlashOpenInterest[];
  timestamp: number;
}

interface PositionSummary {
  marketSymbol: string;
  side: 'long' | 'short';
  sizeUsd: number;
  leverage: number;
  liquidationPrice: number;
  collateralUsd: number;
}

type CacheKey = string;

export class FlashAnalyticsClient {
  private cache = new Map<CacheKey, AnalyticsCacheEntry<unknown>>();
  private pendingRequests = new Map<CacheKey, Promise<unknown>>();

  constructor(
    private readonly baseClient: {
      getPositions(owner: string, signal?: AbortSignal): Promise<FlashPosition[]>;
      getMarkets(signal?: AbortSignal): Promise<FlashMarket[]>;
      getPrices(signal?: AbortSignal): Promise<FlashPrice[]>;
      getPoolData(poolPubkey?: string, signal?: AbortSignal): Promise<FlashPoolStats[]>;
    },
  ) {}

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = FLASH_ANALYTICS_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new Error('Request aborted');
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const result = await promise;
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private getCached<T>(key: CacheKey): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > FLASH_ANALYTICS_CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: CacheKey, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async getSentimentData(signal?: AbortSignal): Promise<SentimentData> {
    const cacheKey = 'sentiment_data';
    const cached = this.getCached<SentimentData>(cacheKey);
    if (cached) return cached;

    const existing = this.pendingRequests.get(cacheKey);
    if (existing) {
      return this.withTimeout(existing as Promise<SentimentData>, FLASH_ANALYTICS_TIMEOUT_MS, signal);
    }

    const request = this.fetchSentimentData(signal);
    this.pendingRequests.set(cacheKey, request);

    try {
      const data = await request;
      this.setCache(cacheKey, data);
      return data;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  private async fetchSentimentData(signal?: AbortSignal): Promise<SentimentData> {
    const [pools] = await Promise.all([
      this.baseClient.getPoolData(undefined, signal),
      this.baseClient.getMarkets(signal),
      this.baseClient.getPrices(signal),
    ]);

    const positions: PositionSummary[] = [];

    const fundingRates = this.calculateFundingRates(positions);
    const openInterest = this.calculateOpenInterest(positions);

    return {
      pools,
      fundingRates,
      openInterest,
      timestamp: Date.now(),
    };
  }

  private calculateFundingRates(positions: PositionSummary[]): FlashFundingRate[] {
    const byMarket = new Map<string, { long: number[]; short: number[] }>();

    for (const pos of positions) {
      const key = pos.marketSymbol.toUpperCase();
      if (!byMarket.has(key)) {
        byMarket.set(key, { long: [], short: [] });
      }
      const entry = byMarket.get(key)!;
      if (pos.side === 'long') {
        entry.long.push(pos.sizeUsd);
      } else {
        entry.short.push(pos.sizeUsd);
      }
    }

    const results: FlashFundingRate[] = [];

    for (const [symbol, { long, short }] of byMarket) {
      const longUsd = long.reduce((a, b) => a + b, 0);
      const shortUsd = short.reduce((a, b) => a + b, 0);
      const total = longUsd + shortUsd;
      const imbalance = total > 0 ? (longUsd - shortUsd) / total : 0;

      const longRate = imbalance * 0.01;
      const shortRate = -imbalance * 0.01;

      results.push({
        marketSymbol: symbol,
        longRatePercent: longRate * 100,
        shortRatePercent: shortRate * 100,
        longPositions: long.length,
        shortPositions: short.length,
        longUsd,
        shortUsd,
        imbalanceRatio: shortUsd > 0 ? longUsd / shortUsd : longUsd > 0 ? Infinity : 0,
        timestamp: Date.now(),
      });
    }

    return results;
  }

  private calculateOpenInterest(positions: PositionSummary[]): FlashOpenInterest[] {
    const byMarket = new Map<string, { long: number[]; short: number[]; leverage: number[] }>();

    for (const pos of positions) {
      const key = pos.marketSymbol.toUpperCase();
      if (!byMarket.has(key)) {
        byMarket.set(key, { long: [], short: [], leverage: [] });
      }
      const entry = byMarket.get(key)!;
      if (pos.side === 'long') {
        entry.long.push(pos.sizeUsd);
      } else {
        entry.short.push(pos.sizeUsd);
      }
      entry.leverage.push(pos.leverage);
    }

    const results: FlashOpenInterest[] = [];

    for (const [symbol, { long, short, leverage }] of byMarket) {
      const longUsd = long.reduce((a, b) => a + b, 0);
      const shortUsd = short.reduce((a, b) => a + b, 0);
      const avgLev = leverage.length > 0 ? leverage.reduce((a, b) => a + b, 0) / leverage.length : 0;

      results.push({
        marketSymbol: symbol,
        longUsd,
        shortUsd,
        totalUsd: longUsd + shortUsd,
        longPositions: long.length,
        shortPositions: short.length,
        avgLeverage: avgLev,
        timestamp: Date.now(),
      });
    }

    return results;
  }

  async getLiquidationHeatmap(
    _symbol: string,
    positions: PositionSummary[],
    currentPrice: number,
    bucketCount: number = 10,
    signal?: AbortSignal,
  ): Promise<FlashLiquidationHeatmap[]> {
    return this.withTimeout(
      Promise.resolve(this.calculateLiquidationHeatmap(positions, currentPrice, bucketCount)),
      FLASH_ANALYTICS_TIMEOUT_MS,
      signal,
    );
  }

  private calculateLiquidationHeatmap(
    positions: PositionSummary[],
    currentPrice: number,
    bucketCount: number,
  ): FlashLiquidationHeatmap[] {
    if (positions.length === 0 || currentPrice <= 0) return [];

    const minPrice = currentPrice * 0.5;
    const maxPrice = currentPrice * 1.5;
    const bucketSize = (maxPrice - minPrice) / bucketCount;

    const buckets: FlashLiquidationHeatmap[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const low = minPrice + i * bucketSize;
      const high = low + bucketSize;

      const inBucket = positions.filter((p) => p.liquidationPrice >= low && p.liquidationPrice < high);

      buckets.push({
        priceRangeLow: low,
        priceRangeHigh: high,
        totalSizeUsd: inBucket.reduce((sum, p) => sum + p.sizeUsd, 0),
        positionCount: inBucket.length,
        avgLeverage:
          inBucket.length > 0
            ? inBucket.reduce((sum, p) => sum + p.leverage, 0) / inBucket.length
            : 0,
      });
    }

    return buckets;
  }

  async getCorrelationMatrix(
    symbols: string[],
    priceHistory: Map<string, FlashPriceCandle[]>,
    signal?: AbortSignal,
  ): Promise<FlashCorrelation[]> {
    return this.withTimeout(
      Promise.resolve(this.calculateCorrelations(symbols, priceHistory)),
      FLASH_ANALYTICS_TIMEOUT_MS,
      signal,
    );
  }

  private calculateCorrelations(
    symbols: string[],
    priceHistory: Map<string, FlashPriceCandle[]>,
  ): FlashCorrelation[] {
    const results: FlashCorrelation[] = [];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const a = symbols[i];
        const b = symbols[j];
        const histA = priceHistory.get(a) || [];
        const histB = priceHistory.get(b) || [];

        const minLen = Math.min(histA.length, histB.length);
        if (minLen < 2) continue;

        const returnsA: number[] = [];
        const returnsB: number[] = [];

        for (let k = 1; k < minLen; k++) {
          if (histA[k - 1].close > 0 && histB[k - 1].close > 0) {
            returnsA.push((histA[k].close - histA[k - 1].close) / histA[k - 1].close);
            returnsB.push((histB[k].close - histB[k - 1].close) / histB[k - 1].close);
          }
        }

        const correlation = this.pearsonCorrelation(returnsA, returnsB);

        results.push({
          marketA: a,
          marketB: b,
          correlation,
          sampleSize: minLen,
        });
      }
    }

    return results;
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den > 0 ? num / den : 0;
  }

  async getOptimalEntry(
    marketSymbol: string,
    side: 'long' | 'short',
    targetSizeUsd: number,
    opposingSizeUsd: number,
    currentPrice: number,
    _confidenceInterval: number,
    signal?: AbortSignal,
  ): Promise<FlashOptimalEntry> {
    const absorptionRatio = opposingSizeUsd > 0 ? targetSizeUsd / opposingSizeUsd : 1;
    const slippageMultiplier = Math.min(1 + absorptionRatio * 0.01, 1.1);

    return this.withTimeout(
      Promise.resolve({
        marketSymbol: marketSymbol.toUpperCase(),
        side,
        recommendedPrice: currentPrice,
        estimatedSlippage: (slippageMultiplier - 1) * 100,
        optimalSizeUsd: targetSizeUsd,
        priceImpactPercent: absorptionRatio * 0.5,
        entryFeeUsd: targetSizeUsd * 0.001,
      }),
      FLASH_ANALYTICS_TIMEOUT_MS,
      signal,
    );
  }

  async getPositionSizing(
    collateralUsd: number,
    riskTolerance: 'conservative' | 'moderate' | 'aggressive',
    maxLossPercent: number,
    winRate?: number,
    signal?: AbortSignal,
  ): Promise<FlashPositionSizing> {
    const kellyFraction = winRate !== undefined && winRate > 0 && winRate < 1 ? 2 * winRate - 1 : 0;

    const leverageMultipliers = {
      conservative: { max: 3, default: 2 },
      moderate: { max: 10, default: 5 },
      aggressive: { max: 20, default: 10 },
    };

    const maxLossMultipliers = {
      conservative: 0.02,
      moderate: 0.05,
      aggressive: 0.1,
    };

    const effectiveRisk = maxLossPercent > 0 ? maxLossPercent / 100 : maxLossMultipliers[riskTolerance];
    const maxLossUsd = collateralUsd * effectiveRisk;

    const recommendedLeverage = Math.min(
      leverageMultipliers[riskTolerance].max,
      Math.max(1, collateralUsd / maxLossUsd),
    );

    return this.withTimeout(
      Promise.resolve({
        recommendedCollateralUsd: collateralUsd,
        recommendedLeverage: Math.min(recommendedLeverage, 20),
        maxLossUsd,
        maxLossPercent: effectiveRisk * 100,
        kellyFraction: kellyFraction > 0 ? kellyFraction : undefined,
        riskLevel: riskTolerance,
      }),
      FLASH_ANALYTICS_TIMEOUT_MS,
      signal,
    );
  }

  async getHedgeSuggestions(
    correlations: FlashCorrelation[],
    openPositions: { marketSymbol: string; side: 'long' | 'short'; sizeUsd: number }[],
    signal?: AbortSignal,
  ): Promise<FlashHedgeSuggestion[]> {
    return this.withTimeout(
      Promise.resolve(this.calculateHedges(correlations, openPositions)),
      FLASH_ANALYTICS_TIMEOUT_MS,
      signal,
    );
  }

  private calculateHedges(
    correlations: FlashCorrelation[],
    positions: { marketSymbol: string; side: 'long' | 'short'; sizeUsd: number }[],
  ): FlashHedgeSuggestion[] {
    const suggestions: FlashHedgeSuggestion[] = [];

    for (const pos of positions) {
      const relevantCorr = correlations.filter(
        (c) =>
          (c.marketA === pos.marketSymbol || c.marketB === pos.marketSymbol) &&
          Math.abs(c.correlation) > 0.5,
      );

      for (const corr of relevantCorr) {
        const hedgeMarket = corr.marketA === pos.marketSymbol ? corr.marketB : corr.marketA;
        const hedgeSide: 'long' | 'short' =
          corr.correlation > 0 ? (pos.side === 'long' ? 'short' : 'long') : pos.side;

        suggestions.push({
          primaryMarket: pos.marketSymbol,
          primarySide: pos.side,
          hedgeMarket,
          hedgeSide,
          hedgeSizePercent: Math.min(100, Math.abs(corr.correlation) * 100),
          correlation: corr.correlation,
          reasoning:
            corr.correlation > 0
              ? `${hedgeMarket} has ${Math.abs(corr.correlation * 100).toFixed(0)}% positive correlation with ${pos.marketSymbol}. A ${hedgeSide} position provides natural hedge.`
              : `${hedgeMarket} has ${Math.abs(corr.correlation * 100).toFixed(0)}% negative correlation with ${pos.marketSymbol}. A ${hedgeSide} position amplifies exposure.`,
        });
      }
    }

    return suggestions;
  }

  clearCache(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}
