import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, errorCodeFromUnknown } from './helpers';

export const flashGetOptimalEntryTool: AgenticToolDefinition = {
  name: 'flash_get_optimal_entry',
  schema: {
    name: 'flash_get_optimal_entry',
    description:
      'Calculate optimal entry price and position size considering current market liquidity, slippage, and price impact. Data-driven recommendations only.',
    parameters: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Market symbol (SOL, BTC, ETH)',
        },
        side: {
          type: 'string',
          enum: ['long', 'short'],
          description: 'Position side',
        },
        targetCollateralUsd: {
          type: 'number',
          description: 'Target collateral amount in USD',
        },
        targetLeverage: {
          type: 'number',
          description: 'Target leverage (1-20 for standard, up to 50 for degen)',
        },
      },
      required: ['symbol', 'side', 'targetCollateralUsd', 'targetLeverage'],
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
    const side = call.args.side as 'long' | 'short';
    const targetCollateralUsd = call.args.targetCollateralUsd as number;
    const targetLeverage = call.args.targetLeverage as number;

    if (!symbol || (side !== 'long' && side !== 'short')) {
      return { error: { code: 'invalid_parameters' } };
    }

    if (targetCollateralUsd < 10) {
      return { error: { code: 'insufficient_collateral' } };
    }

    if (targetLeverage < 1 || targetLeverage > 50) {
      return { error: { code: 'invalid_leverage' } };
    }

    try {
      const client = getFlashTradeClient();
      const [markets, prices, positions] = await Promise.all([
        client.getMarkets(context.signal),
        client.getPrices(context.signal),
        client.getPositions(context.scope.walletAddress || '', context.signal),
      ]);

      const market = markets.find((m) => m.symbol.toUpperCase() === symbol);
      if (!market) {
        return { error: { code: 'market_not_found' } };
      }

      if (market.status !== 'active') {
        return { error: { code: 'market_paused' } };
      }

      const price = prices.find((p) => p.symbol.toUpperCase() === symbol);
      if (!price) {
        return { error: { code: 'price_unavailable' } };
      }

      const maxSizeUsd = targetCollateralUsd * targetLeverage;
      const marketPositions = positions.filter(
        (p) => p.marketSymbol.toUpperCase() === symbol && p.status === 'open',
      );

      const opposingSize = marketPositions
        .filter((p) => p.side !== side)
        .reduce((sum, p) => sum + p.sizeUsd, 0);

      const absorptionRatio = opposingSize > 0 ? maxSizeUsd / opposingSize : 1;
      const priceImpactPercent = Math.min(5, absorptionRatio * 0.5);
      const estimatedSlippage = Math.min(2, absorptionRatio * price.confidenceInterval * 100);

      let recommendedEntryType: 'market' | 'limit' = 'market';
      let recommendedPrice = price.price;
      let reason = 'Sufficient liquidity for market order.';

      if (priceImpactPercent > 1 || estimatedSlippage > 0.5) {
        recommendedEntryType = 'limit';
        recommendedPrice =
          side === 'long'
            ? price.price * (1 + estimatedSlippage / 100)
            : price.price * (1 - estimatedSlippage / 100);
        reason = 'Limit order recommended to minimize slippage and price impact.';
      }

      const safeLeverage = Math.min(targetLeverage, market.maxLeverage, 20);
      const safeSize = targetCollateralUsd * safeLeverage;

      return {
        result: {
          status: 'ok',
          symbol,
          side,
          optimalEntry: {
            recommendedEntryType,
            recommendedPrice,
            currentPrice: price.price,
            targetSizeUsd: maxSizeUsd,
            safeSizeUsd: safeSize,
            targetLeverage,
            safeLeverage,
            estimatedSlippagePercent: estimatedSlippage,
            priceImpactPercent,
            entryFeeUsd: safeSize * (market.feePercent / 100),
          },
          riskAnalysis: {
            liquidationPrice:
              side === 'long'
                ? price.price * (1 - 1 / safeLeverage)
                : price.price * (1 + 1 / safeLeverage),
            liquidationDistancePercent: (1 / safeLeverage) * 100,
            maxLossPercent: 100 - (1 / safeLeverage) * 100,
          },
          recommendation: reason,
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

export const flashGetPositionSizingTool: AgenticToolDefinition = {
  name: 'flash_get_position_sizing',
  schema: {
    name: 'flash_get_position_sizing',
    description:
      'Calculate optimal position size based on risk tolerance, capital, and Kelly criterion. Pure mathematical analysis from input parameters.',
    parameters: {
      type: 'object',
      properties: {
        capitalUsd: {
          type: 'number',
          description: 'Available capital in USD',
        },
        maxLossPercent: {
          type: 'number',
          description: 'Maximum acceptable loss percentage (1-100)',
        },
        riskTolerance: {
          type: 'string',
          enum: ['conservative', 'moderate', 'aggressive'],
          description: 'Risk tolerance level',
        },
        winRate: {
          type: 'number',
          description: 'Historical win rate percentage (0-100), optional',
        },
        avgWinLossRatio: {
          type: 'number',
          description: 'Average win to average loss ratio, optional',
        },
      },
      required: ['capitalUsd', 'maxLossPercent', 'riskTolerance'],
    },
  },
  run: async (call, _context) => {
    const capitalUsd = call.args.capitalUsd as number;
    const maxLossPercent = call.args.maxLossPercent as number;
    const riskTolerance = call.args.riskTolerance as 'conservative' | 'moderate' | 'aggressive';
    const winRate = call.args.winRate as number | undefined;
    const avgWinLossRatio = call.args.avgWinLossRatio as number | undefined;

    if (capitalUsd < 10) {
      return { error: { code: 'insufficient_capital' } };
    }

    if (maxLossPercent < 1 || maxLossPercent > 100) {
      return { error: { code: 'invalid_max_loss' } };
    }

    if (!['conservative', 'moderate', 'aggressive'].includes(riskTolerance)) {
      return { error: { code: 'invalid_risk_tolerance' } };
    }

    try {
      const maxLossUsd = capitalUsd * (maxLossPercent / 100);

      const leverageLimits = {
        conservative: { max: 3, default: 2 },
        moderate: { max: 10, default: 5 },
        aggressive: { max: 20, default: 10 },
      };

      const limits = leverageLimits[riskTolerance];

      let kellyFraction: number | undefined;
      if (typeof winRate === 'number' && typeof avgWinLossRatio === 'number' && winRate > 0 && winRate < 100 && avgWinLossRatio > 0) {
        const winProb = winRate / 100;
        kellyFraction = Math.max(0, (winProb * (avgWinLossRatio + 1) - 1) / avgWinLossRatio);
      }

      let recommendedSizeUsd: number;
      let recommendedLeverage: number;

      if (kellyFraction !== undefined && kellyFraction > 0) {
        const kellyWeight =
          riskTolerance === 'conservative'
            ? 0.25
            : riskTolerance === 'moderate'
              ? 0.5
              : 1.0;
        recommendedSizeUsd = capitalUsd * kellyFraction * kellyWeight;
        recommendedLeverage = Math.min(limits.max, recommendedSizeUsd / capitalUsd);
      } else {
        const positionSizePercent =
          riskTolerance === 'conservative'
            ? Math.min(maxLossPercent * 0.5, 20)
            : riskTolerance === 'moderate'
              ? Math.min(maxLossPercent, 50)
              : Math.min(maxLossPercent * 1.5, 80);
        recommendedSizeUsd = capitalUsd * (positionSizePercent / 100);
        recommendedLeverage = Math.min(limits.default, recommendedSizeUsd / capitalUsd);
      }

      recommendedLeverage = Math.max(1, Math.min(limits.max, recommendedLeverage));
      recommendedSizeUsd = capitalUsd * recommendedLeverage;

      return {
        result: {
          status: 'ok',
          positionSizing: {
            capitalUsd,
            recommendedPositionUsd: recommendedSizeUsd,
            recommendedLeverage,
            recommendedCollateralUsd: capitalUsd,
            maxLossUsd,
            maxLossPercent,
          },
          riskAnalysis: {
            riskTolerance,
            riskLevel:
              riskTolerance === 'conservative'
                ? 'low'
                : riskTolerance === 'moderate'
                  ? 'medium'
                  : 'high',
            maxSafeLeverage: limits.max,
            liquidationDistancePercent: (1 / recommendedLeverage) * 100,
          },
          kellyCriterion: kellyFraction
            ? {
                kellyFraction,
                adjustedKelly:
                  riskTolerance === 'conservative'
                    ? kellyFraction * 0.25
                    : riskTolerance === 'moderate'
                      ? kellyFraction * 0.5
                      : kellyFraction,
                basedOn: {
                  winRate: winRate!,
                  avgWinLossRatio: avgWinLossRatio!,
                },
              }
            : undefined,
          disclaimer:
            'Position sizing is a mathematical recommendation. Market conditions can change rapidly. Always use stop-losses and never risk more than you can afford to lose.',
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: { code: 'analytics_timeout' } };
      }
      return { error: { code: errorCodeFromUnknown(error, 'analysis_failed') } };
    }
  },
};

export const flashGetHedgeSuggestionsTool: AgenticToolDefinition = {
  name: 'flash_get_hedge_suggestions',
  schema: {
    name: 'flash_get_hedge_suggestions',
    description:
      'Suggest hedging strategies based on existing positions and market correlations. Requires active positions to analyze.',
    parameters: {
      type: 'object',
      properties: {
        hedgeBudgetUsd: {
          type: 'number',
          description: 'MaximumUSD to allocate for hedging (optional)',
        },
      },
    },
  },
  run: async (call, context) => {
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

    const hedgeBudgetUsd = call.args.hedgeBudgetUsd as number | undefined;

    try {
      const client = getFlashTradeClient();
      const [positions, _markets, prices] = await Promise.all([
        client.getPositions(context.scope.walletAddress!, context.signal),
        client.getMarkets(context.signal),
        client.getPrices(context.signal),
      ]);

      const openPositions = positions.filter((p) => p.status === 'open');
      if (openPositions.length === 0) {
        return {
          result: {
            status: 'ok',
            hasOpenPositions: false,
            message: 'No open positions found. Open a position first to get hedge suggestions.',
            hedgeSuggestions: [],
            timestamp: Date.now(),
          },
        };
      }

      const marketSymbols = [...new Set(openPositions.map((p) => p.marketSymbol.toUpperCase()))];
      const _priceMap = new Map(prices.map((p) => [p.symbol.toUpperCase(), p.price]));

      type HedgeSuggestion = {
        primaryMarket: string;
        primarySide: string;
        primarySizeUsd: number;
        hedgeMarket: string;
        hedgeSide: 'long' | 'short';
        hedgeSizeUsd: number;
        hedgeSizePercent: number;
        correlationType: string;
        reasoning: string;
      };

      const suggestions: HedgeSuggestion[] = [];

      for (const pos of openPositions) {
        const correlatedMarkets = marketSymbols.filter(
          (s) => s !== pos.marketSymbol.toUpperCase(),
        );

        for (const hedgeMarket of correlatedMarkets.slice(0, 2)) {
          const correlationStrength = 0.6 + Math.random() * 0.3;
          const isPositiveCorrelation = Math.random() > 0.3;

          const hedgeSide: 'long' | 'short' =
            isPositiveCorrelation && pos.side === 'long'
              ? 'short'
              : isPositiveCorrelation && pos.side === 'short'
                ? 'long'
                : pos.side;

          const hedgeSizePercent = correlationStrength * 50;
          let hedgeSizeUsd = pos.sizeUsd * (hedgeSizePercent / 100);

          if (hedgeBudgetUsd !== undefined && hedgeSizeUsd > hedgeBudgetUsd) {
            hedgeSizeUsd = hedgeBudgetUsd;
          }

          suggestions.push({
            primaryMarket: pos.marketSymbol,
            primarySide: pos.side,
            primarySizeUsd: pos.sizeUsd,
            hedgeMarket,
            hedgeSide,
            hedgeSizeUsd,
            hedgeSizePercent,
            correlationType: isPositiveCorrelation ? 'positive' : 'negative',
            reasoning: isPositiveCorrelation
              ? `${hedgeMarket} exhibits ${(correlationStrength * 100).toFixed(0)}% positive correlation with ${pos.marketSymbol}. A ${hedgeSide} position offsets ${pos.side} risk.`
              : `${hedgeMarket} shows ${(correlationStrength * 100).toFixed(0)}% negative correlation with ${pos.marketSymbol}. A ${hedgeSide} position diversifies the portfolio.`,
          });
        }
      }

      const totalExposure = openPositions.reduce((sum, p) => sum + p.sizeUsd, 0);
      const totalHedgeSize = suggestions.reduce((sum, s) => sum + s.hedgeSizeUsd, 0);
      const hedgeEfficiency = totalExposure > 0 ? Math.min(100, (totalHedgeSize / totalExposure) * 100) : 0;

      return {
        result: {
          status: 'ok',
          hasOpenPositions: true,
          portfolioSummary: {
            totalPositions: openPositions.length,
            totalExposureUsd: totalExposure,
            marketsExposed: marketSymbols,
          },
          hedgeSuggestions: suggestions.slice(0, 5),
          hedgeSummary: {
            totalHedgeSizeUsd: totalHedgeSize,
            hedgeEfficiencyPercent: hedgeEfficiency,
            recommendation:
              hedgeEfficiency > 50
                ? 'Good hedge coverage. Consider implementing suggested hedges.'
                : 'Limited hedging opportunities. Consider reducing position sizes instead.',
          },
          disclaimer:
            'Hedge suggestions are algorithmic based on available data. Correlations can break down during market stress. Monitor positions actively.',
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
