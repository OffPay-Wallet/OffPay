import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import {
  requireMainnet,
  requireWallet,
  validateCollateral,
  validateLeverage,
  validateSide,
  findMarketBySymbol,
  errorCodeFromUnknown,
} from './helpers';
import type { FlashTradeDraft } from './types';

export const flashOpenPositionTool: AgenticToolDefinition = {
  name: 'flash_open_position',
  schema: {
    name: 'flash_open_position',
    description: 'Open a new leveraged position on Flash Trade (mainnet only). Returns preview with entry price, liquidation price, fees, and unsigned transaction for user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        marketSymbol: { type: 'string', description: 'Market to trade (SOL, BTC, ETH)' },
        side: { type: 'string', enum: ['long', 'short'], description: 'Position direction' },
        leverage: { type: 'number', description: 'Leverage multiplier (e.g., 5 for 5x)' },
        collateralUsd: { type: 'number', description: 'Collateral amount in USD' },
        inputTokenSymbol: { type: 'string', description: 'Token to pay with (USDC, SOL)' },
        tradeType: { type: 'string', enum: ['market', 'limit'], description: 'Market or limit order' },
        limitPrice: { type: 'number', description: 'Limit price (required if tradeType is limit)' },
        slippageBps: { type: 'number', description: 'Slippage tolerance in basis points (default 50 = 0.5%)' },
        degenMode: { type: 'boolean', description: 'Enable higher leverage limits' },
        takeProfitPrice: { type: 'number', description: 'Optional take-profit price to set after opening' },
        stopLossPrice: { type: 'number', description: 'Optional stop-loss price to set after opening' },
      },
      required: ['marketSymbol', 'side', 'leverage', 'collateralUsd', 'inputTokenSymbol', 'tradeType'],
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

    const args = call.args as {
      marketSymbol: string;
      side: string;
      leverage: number;
      collateralUsd: number;
      inputTokenSymbol: string;
      tradeType: 'market' | 'limit';
      limitPrice?: number;
      slippageBps?: number;
      degenMode?: boolean;
      takeProfitPrice?: number;
      stopLossPrice?: number;
    };

    const sideValidation = validateSide(args.side);
    if (!sideValidation.ok) {
      return { error: { code: sideValidation.code } };
    }

    const hasTpsl = args.takeProfitPrice != null || args.stopLossPrice != null;
    const collateralValidation = validateCollateral(args.collateralUsd, hasTpsl);
    if (!collateralValidation.ok) {
      return { error: { code: collateralValidation.code } };
    }

    if (args.leverage < 1) {
      return { error: { code: 'invalid_leverage' } };
    }

    if (args.tradeType === 'limit' && args.limitPrice == null) {
      return { error: { code: 'limit_price_required' } };
    }

    try {
      const client = getFlashTradeClient();

      const markets = await client.getMarkets(context.signal);
      const market = findMarketBySymbol(markets, args.marketSymbol);
      if (market == null) {
        return { error: { code: 'invalid_market' } };
      }

      if (market.status !== 'active') {
        return { error: { code: 'market_disabled' } };
      }

      const leverageValidation = validateLeverage(
        args.leverage,
        market.maxLeverage,
        args.degenMode ?? false,
      );
      if (!leverageValidation.ok) {
        return { error: { code: leverageValidation.code } };
      }

      const response = await client.openPosition(
        {
          marketSymbol: market.symbol,
          side: sideValidation.side,
          leverage: args.leverage,
          collateralUsd: args.collateralUsd,
          inputTokenSymbol: args.inputTokenSymbol,
          tradeType: args.tradeType,
          limitPrice: args.limitPrice,
          slippageBps: args.slippageBps ?? 50,
          degenMode: args.degenMode ?? false,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      const expiresAt = response.expiresAt;
      const expiresInMs = expiresAt - Date.now();
      if (expiresInMs < 10000) {
        return { error: { code: 'blockhash_expiring_soon' } };
      }

      const warnings: string[] = [];
      if (response.hourlyBorrowRatePercent > 0.01) {
        warnings.push('High borrow rate. Consider reducing leverage.');
      }
      if (response.entryFeeUsd > args.collateralUsd * 0.01) {
        warnings.push('Entry fee exceeds 1% of collateral.');
      }
      const requestedTriggerOrders: FlashTradeDraft['requestedTriggerOrders'] = [];
      if (args.takeProfitPrice != null) {
        requestedTriggerOrders.push({
          orderType: 'take_profit',
          triggerPrice: args.takeProfitPrice,
          sizePercent: 100,
        });
      }
      if (args.stopLossPrice != null) {
        requestedTriggerOrders.push({
          orderType: 'stop_loss',
          triggerPrice: args.stopLossPrice,
          sizePercent: 100,
        });
      }
      if (requestedTriggerOrders.length > 0) {
        warnings.push(
          'TP/SL is not included in this signature. Place trigger orders after the position confirms.',
        );
      }

      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'open_position',
        actionLabel: 'Open position',
        walletAddress: context.scope.walletAddress!,
        network: 'mainnet',
        marketSymbol: response.marketSymbol,
        side: response.side,
        leverage: response.leverage,
        collateralUsd: response.collateralUsd,
        inputTokenSymbol: args.inputTokenSymbol,
        tradeType: args.tradeType,
        limitPrice: args.limitPrice,
        entryPrice: response.entryPrice,
        liquidationPrice: response.liquidationPrice,
        sizeUsd: response.sizeUsd,
        entryFeeUsd: response.entryFeeUsd,
        transactionBase64: response.transactionBase64,
        expiresAt: response.expiresAt,
        requestedTriggerOrders:
          requestedTriggerOrders.length > 0 ? requestedTriggerOrders : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      return {
        result: {
          status: 'drafted',
          positionKey: response.positionKey,
          marketSymbol: response.marketSymbol,
          side: response.side,
          leverage: response.leverage,
          collateralUsd: response.collateralUsd,
          sizeUsd: response.sizeUsd,
          entryPrice: response.entryPrice,
          liquidationPrice: response.liquidationPrice,
          entryFeeUsd: response.entryFeeUsd,
          hourlyBorrowRatePercent: response.hourlyBorrowRatePercent,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
          expiresInMs,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        draft: {
          kind: 'flash_position',
          draft,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
