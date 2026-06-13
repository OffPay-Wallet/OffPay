import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient, getAnalyticsClient } from '@/lib/flash-trade';
import { requireMainnet, errorCodeFromUnknown } from './helpers';

export const flashGetPoolStatsTool: AgenticToolDefinition = {
  name: 'flash_get_pool_stats',
  schema: {
    name: 'flash_get_pool_stats',
    description:
      'Get Flash Trade liquidity pool statistics including AUM, utilization, and LP token supply. Shows LP confidence and protocol health.',
    parameters: {
      type: 'object',
      properties: {
        poolPubkey: {
          type: 'string',
          description: 'Optional specific pool pubkey. Returns all pools if omitted.',
        },
      },
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    if (!context.canUseNetwork) {
      return { error: { code: 'network_unavailable' } };
    }

    const poolPubkey = call.args.poolPubkey as string | undefined;

    try {
      const client = getFlashTradeClient();
      const pools = await client.getPoolData(poolPubkey, context.signal);

      const sanitized = pools.map((p) => ({
        poolName: p.poolName || 'Unknown',
        totalAumUsd: p.totalAumUsd,
        totalCollateralUsd: p.totalCollateralUsd,
        utilizationPercent: p.utilizationPercent,
        aprPercent: p.aprPercent,
      }));

      return {
        result: {
          status: 'ok',
          poolCount: sanitized.length,
          pools: sanitized,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: { code: 'analytics_timeout' } };
      }
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashGetFundingRatesTool: AgenticToolDefinition = {
  name: 'flash_get_funding_rates',
  schema: {
    name: 'flash_get_funding_rates',
    description:
      'Get funding rates and long/short imbalance for all perpetual markets. Positive long rate means longs pay shorts. Derived from actual position distribution.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by market symbols (SOL, BTC, ETH). Returns all if omitted.',
        },
      },
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    if (!context.canUseNetwork) {
      return { error: { code: 'network_unavailable' } };
    }

    const symbols = call.args.symbols as string[] | undefined;

    try {
      const analytics = getAnalyticsClient();
      const data = await analytics.getSentimentData(context.signal);

      let filtered = data.fundingRates;
      if (symbols && symbols.length > 0) {
        const upperSymbols = symbols.map((s) => s.toUpperCase());
        filtered = filtered.filter((f) => upperSymbols.includes(f.marketSymbol));
      }

      return {
        result: {
          status: 'ok',
          fundingRates: filtered.map((f) => ({
            marketSymbol: f.marketSymbol,
            longRatePercent: f.longRatePercent,
            shortRatePercent: f.shortRatePercent,
            longPositions: f.longPositions,
            shortPositions: f.shortPositions,
            longUsd: f.longUsd,
            shortUsd: f.shortUsd,
            imbalanceRatio: f.imbalanceRatio,
            sentiment:
              f.longRatePercent > 0.5
                ? 'bullish_bias'
                : f.shortRatePercent > 0.5
                  ? 'bearish_bias'
                  : 'neutral',
          })),
          timestamp: data.timestamp,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: { code: 'analytics_timeout' } };
      }
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashGetOpenInterestTool: AgenticToolDefinition = {
  name: 'flash_get_open_interest',
  schema: {
    name: 'flash_get_open_interest',
    description:
      'Get total open interest (USD value of all open positions) for each market. Shows total market exposure and trading activity.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by market symbols (SOL, BTC, ETH). Returns all if omitted.',
        },
      },
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    if (!context.canUseNetwork) {
      return { error: { code: 'network_unavailable' } };
    }

    const symbols = call.args.symbols as string[] | undefined;

    try {
      const analytics = getAnalyticsClient();
      const data = await analytics.getSentimentData(context.signal);

      let filtered = data.openInterest;
      if (symbols && symbols.length > 0) {
        const upperSymbols = symbols.map((s) => s.toUpperCase());
        filtered = filtered.filter((o) => upperSymbols.includes(o.marketSymbol));
      }

      const totalOIAcrossMarkets = filtered.reduce((sum, o) => sum + o.totalUsd, 0);

      return {
        result: {
          status: 'ok',
          openInterest: filtered.map((o) => ({
            marketSymbol: o.marketSymbol,
            longUsd: o.longUsd,
            shortUsd: o.shortUsd,
            totalUsd: o.totalUsd,
            longPositions: o.longPositions,
            shortPositions: o.shortPositions,
            avgLeverage: o.avgLeverage,
            percentOfTotal: totalOIAcrossMarkets > 0 ? (o.totalUsd / totalOIAcrossMarkets) * 100 : 0,
          })),
          totalOpenInterestUsd: totalOIAcrossMarkets,
          timestamp: data.timestamp,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: { code: 'analytics_timeout' } };
      }
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashGetLiquidationClustersTool: AgenticToolDefinition = {
  name: 'flash_get_liquidation_clusters',
  schema: {
    name: 'flash_get_liquidation_clusters',
    description:
      'Identify price levels with concentrated liquidations. Shows cascade risk points where many positions would liquidate together.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by market symbols (SOL, BTC, ETH). Returns all if omitted.',
        },
      },
    },
  },
  run: async (call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    if (!context.canUseNetwork) {
      return { error: { code: 'network_unavailable' } };
    }

    try {
      const client = getFlashTradeClient();
      const positions = await client.getPositions(context.scope.walletAddress || '', context.signal);
      const prices = await client.getPrices(context.signal);

      const priceMap = new Map(prices.map((p) => [p.symbol.toUpperCase(), p.price]));

      interface LiquidationPos {
        marketSymbol: string;
        side: 'long' | 'short';
        sizeUsd: number;
        leverage: number;
        liquidationPrice: number;
        distancePercent: number;
      }

      const liquidationPositions: LiquidationPos[] = positions
        .filter((p) => p.status === 'open')
        .map((p) => {
          const currentPrice = priceMap.get(p.marketSymbol.toUpperCase()) || 0;
          const distance =
            currentPrice > 0 ? ((p.liquidationPrice - currentPrice) / currentPrice) * 100 : 0;
          return {
            marketSymbol: p.marketSymbol,
            side: p.side,
            sizeUsd: p.sizeUsd,
            leverage: p.leverage,
            liquidationPrice: p.liquidationPrice,
            distancePercent: distance,
          };
        });

      const byMarket = new Map<string, LiquidationPos[]>();
      for (const pos of liquidationPositions) {
        const key = pos.marketSymbol.toUpperCase();
        if (!byMarket.has(key)) byMarket.set(key, []);
        byMarket.get(key)!.push(pos);
      }

      const clusters: Array<{
        marketSymbol: string;
        priceLevel: number;
        totalSizeUsd: number;
        positionCount: number;
        riskLevel: string;
      }> = [];

      for (const [symbol, positions] of byMarket) {
        const sorted = [...positions].sort((a, b) => a.liquidationPrice - b.liquidationPrice);

        let currentLevel = 0;
        let currentSize = 0;
        let currentCount = 0;

        for (const pos of sorted) {
          if (currentCount === 0) {
            currentLevel = pos.liquidationPrice;
          }

          const priceDiff = Math.abs(pos.liquidationPrice - currentLevel) / currentLevel;
          if (priceDiff < 0.02) {
            currentSize += pos.sizeUsd;
            currentCount++;
          } else {
            if (currentCount > 0) {
              clusters.push({
                marketSymbol: symbol,
                priceLevel: currentLevel,
                totalSizeUsd: currentSize,
                positionCount: currentCount,
                riskLevel: currentSize > 10000 ? 'high' : currentSize > 5000 ? 'medium' : 'low',
              });
            }
            currentLevel = pos.liquidationPrice;
            currentSize = pos.sizeUsd;
            currentCount = 1;
          }
        }

        if (currentCount > 0) {
          clusters.push({
            marketSymbol: symbol,
            priceLevel: currentLevel,
            totalSizeUsd: currentSize,
            positionCount: currentCount,
            riskLevel: currentSize > 10000 ? 'high' : currentSize > 5000 ? 'medium' : 'low',
          });
        }
      }

      return {
        result: {
          status: 'ok',
          cascadeRiskLevel:
            clusters.filter((c) => c.riskLevel === 'high').length > 0
              ? 'elevated'
              : clusters.filter((c) => c.riskLevel === 'medium').length > 0
                ? 'moderate'
                : 'low',
          liquidationClusters: clusters.sort((a, b) => b.totalSizeUsd - a.totalSizeUsd),
          totalPositionsAnalyzed: liquidationPositions.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: { code: 'analytics_timeout' } };
      }
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
