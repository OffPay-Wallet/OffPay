import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, errorCodeFromUnknown } from './helpers';

export const flashGetMarketMetricsTool: AgenticToolDefinition = {
  name: 'flash_get_market_metrics',
  schema: {
    name: 'flash_get_market_metrics',
    description:
      'Get advanced trading metrics per market: volume trends, fee distribution, and trader activity. Requires wallet connection for personalized metrics.',
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
      const client = getFlashTradeClient();
      const [markets, positions, prices] = await Promise.all([
        client.getMarkets(context.signal),
        client.getPositions(context.scope.walletAddress || '', context.signal),
        client.getPrices(context.signal),
      ]);

      let filteredMarkets = markets;
      if (symbols && symbols.length > 0) {
        const upperSymbols = symbols.map((s) => s.toUpperCase());
        filteredMarkets = markets.filter((m) => upperSymbols.includes(m.symbol.toUpperCase()));
      }

      const metrics = filteredMarkets.map((market) => {
        const marketPositions = positions.filter(
          (p) => p.marketSymbol.toUpperCase() === market.symbol.toUpperCase(),
        );

        const totalSizeUsd = marketPositions.reduce((sum, p) => sum + p.sizeUsd, 0);
        const totalCollateralUsd = marketPositions.reduce((sum, p) => sum + p.collateralUsd, 0);
        const avgLeverage =
          marketPositions.length > 0
            ? marketPositions.reduce((sum, p) => sum + p.leverage, 0) / marketPositions.length
            : 0;

        const price = prices.find((p) => p.symbol.toUpperCase() === market.symbol.toUpperCase());
        const priceConfidenceInterval = price?.confidenceInterval || 0;
        const priceSpread =
          price && price.price > 0 ? (priceConfidenceInterval / price.price) * 100 : 0;

        return {
          symbol: market.symbol,
          status: market.status,
          feePercent: market.feePercent,
          minLeverage: market.minLeverage,
          maxLeverage: market.maxLeverage,
          maxLeverageDegen: market.maxLeverageDegen,
          yourPositions: marketPositions.length,
          yourTotalSizeUsd: totalSizeUsd,
          yourTotalCollateralUsd: totalCollateralUsd,
          yourAvgLeverage: avgLeverage,
          priceSpreadPercent: priceSpread,
          liquidityRating: priceSpread < 0.1 ? 'excellent' : priceSpread < 0.3 ? 'good' : 'moderate',
        };
      });

      return {
        result: {
          status: 'ok',
          marketMetrics: metrics,
          totalMarkets: metrics.length,
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

export const flashGetPortfolioRiskTool: AgenticToolDefinition = {
  name: 'flash_get_portfolio_risk',
  schema: {
    name: 'flash_get_portfolio_risk',
    description:
      'Analyze portfolio risk across all Flash Trade positions: concentration, leverage exposure, and liquidation risk heat map.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  run: async (_call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    const walletCheck = requireWallet(context.scope.walletAddress);
    if (!walletCheck.ok) {
      return { error: { code: walletCheck.code } };
    }

    if (!context.canUseNetwork) {
      return { error: { code: 'network_unavailable' } };
    }

    try {
      const client = getFlashTradeClient();
      const [positions, prices] = await Promise.all([
        client.getPositions(context.scope.walletAddress!, context.signal),
        client.getPrices(context.signal),
      ]);

      const priceMap = new Map(prices.map((p) => [p.symbol.toUpperCase(), p.price]));

      const enrichedPositions = positions
        .filter((p) => p.status === 'open')
        .map((p) => {
          const currentPrice = priceMap.get(p.marketSymbol.toUpperCase()) || 0;
          const liquidationDistance =
            currentPrice > 0 ? Math.abs((p.liquidationPrice - currentPrice) / currentPrice) * 100 : 0;
          const pnlPercent = p.collateralUsd > 0 ? (p.unrealizedPnlUsd / p.collateralUsd) * 100 : 0;

          return {
            market: p.marketSymbol,
            side: p.side,
            sizeUsd: p.sizeUsd,
            collateralUsd: p.collateralUsd,
            leverage: p.leverage,
            liquidationDistancePercent: liquidationDistance,
            unrealizedPnlUsd: p.unrealizedPnlUsd,
            pnlPercent,
            riskLevel: liquidationDistance < 5 ? 'critical' : liquidationDistance < 10 ? 'high' : liquidationDistance < 20 ? 'moderate' : 'low',
          };
        });

      const totalCollateral = enrichedPositions.reduce((sum, p) => sum + p.collateralUsd, 0);
      const totalSize = enrichedPositions.reduce((sum, p) => sum + p.sizeUsd, 0);
      const avgLeverage = totalCollateral > 0 ? totalSize / totalCollateral : 0;
      const totalUnrealizedPnl = enrichedPositions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);

      const marketConcentration: { market: string; percent: number }[] = [];
      const byMarket = new Map<string, number>();
      for (const p of enrichedPositions) {
        byMarket.set(p.market, (byMarket.get(p.market) || 0) + p.sizeUsd);
      }
      for (const [market, size] of byMarket) {
        marketConcentration.push({
          market,
          percent: totalSize > 0 ? (size / totalSize) * 100 : 0,
        });
      }
      marketConcentration.sort((a, b) => b.percent - a.percent);

      const atRiskPositions = enrichedPositions.filter(
        (p) => p.riskLevel === 'critical' || p.riskLevel === 'high',
      );

      const portfolioRiskScore = Math.min(
        100,
        avgLeverage * 10 +
          (atRiskPositions.length / Math.max(enrichedPositions.length, 1)) * 50 +
          (marketConcentration.length > 0 && marketConcentration[0].percent > 50 ? 20 : 0),
      );

      return {
        result: {
          status: 'ok',
          portfolioSummary: {
            totalPositions: enrichedPositions.length,
            totalCollateralUsd: totalCollateral,
            totalSizeUsd: totalSize,
            avgLeverage,
            totalUnrealizedPnlUsd: totalUnrealizedPnl,
          },
          riskMetrics: {
            portfolioRiskScore,
            riskRating: portfolioRiskScore > 70 ? 'high' : portfolioRiskScore > 40 ? 'moderate' : 'low',
            atRiskPositionCount: atRiskPositions.length,
            worstCaseLiquidationLossUsd: atRiskPositions.reduce((sum, p) => sum + p.collateralUsd, 0),
          },
          marketConcentration,
          positionRisks: enrichedPositions.sort((a, b) => a.liquidationDistancePercent - b.liquidationDistancePercent),
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

export const flashGetAbsorptionAnalysisTool: AgenticToolDefinition = {
  name: 'flash_get_absorption_analysis',
  schema: {
    name: 'flash_get_absorption_analysis',
    description:
      'Analyze order absorption: how much size can be traded without significant price impact. Shows market depth vs position sizes.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Market symbol to analyze (SOL, BTC, ETH)',
        },
        tradeSizeUsd: {
          type: 'number',
          description: 'Proposed trade size in USD to analyze absorption for',
        },
      },
      required: ['symbol', 'tradeSizeUsd'],
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

    const symbol = (call.args.symbol as string)?.toUpperCase();
    const tradeSizeUsd = call.args.tradeSizeUsd as number;

    if (!symbol || typeof tradeSizeUsd !== 'number' || tradeSizeUsd <= 0) {
      return { error: { code: 'invalid_parameters' } };
    }

    try {
      const client = getFlashTradeClient();
      const [positions, prices] = await Promise.all([
        client.getPositions(context.scope.walletAddress || '', context.signal),
        client.getPrices(context.signal),
      ]);

      const marketPositions = positions.filter(
        (p) => p.marketSymbol.toUpperCase() === symbol && p.status === 'open',
      );

      const totalLongSize = marketPositions
        .filter((p) => p.side === 'long')
        .reduce((sum, p) => sum + p.sizeUsd, 0);
      const totalShortSize = marketPositions
        .filter((p) => p.side === 'short')
        .reduce((sum, p) => sum + p.sizeUsd, 0);

      const opposingSize = Math.max(totalLongSize, totalShortSize);
      const absorptionRatio = opposingSize > 0 ? tradeSizeUsd / opposingSize : 1;

      const price = prices.find((p) => p.symbol.toUpperCase() === symbol);
      const confidenceInterval = price?.confidenceInterval || 0;
      const estimatedSlippage = Math.min(10, absorptionRatio * confidenceInterval * 10);

      let recommendation: string;
      if (absorptionRatio > 2) {
        recommendation =
          'Large trade relative to existing positions. Expect high slippage. Consider splitting into smaller orders.';
      } else if (absorptionRatio > 1) {
        recommendation =
          'Moderate trade size. Some price impact expected. Consider using limit orders.';
      } else {
        recommendation = 'Trade size well-absorbed by existing liquidity. Market order suitable.';
      }

      return {
        result: {
          status: 'ok',
          symbol,
          absorption: {
            tradeSizeUsd,
            opposingPositionsUsd: opposingSize,
            absorptionRatio,
            estimatedSlippagePercent: estimatedSlippage,
            canAbsorb: absorptionRatio < 1.5,
          },
          marketDepth: {
            totalLongUsd: totalLongSize,
            totalShortUsd: totalShortSize,
            netBias: totalLongSize > totalShortSize ? 'long' : totalShortSize > totalLongSize ? 'short' : 'balanced',
          },
          recommendation,
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
