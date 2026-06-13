import type { AgenticToolDefinition } from '../types';
import {
  getFlashTradeClient,
  FLASH_MAX_TRIGGER_ORDERS_PER_POSITION,
  FLASH_MIN_COLLATERAL_WITH_TPSL_USD,
} from '@/lib/flash-trade';
import {
  requireMainnet,
  requireWallet,
  validateTriggerPrice,
  errorCodeFromUnknown,
} from './helpers';
import type { FlashTradeDraft } from './types';

export const flashPlaceTriggerOrderTool: AgenticToolDefinition = {
  name: 'flash_place_trigger_order',
  schema: {
    name: 'flash_place_trigger_order',
    description: 'Place a take-profit or stop-loss order on an existing position (mainnet only). Validates trigger price direction and position collateral.',
    parameters: {
      type: 'object',
      properties: {
        positionKey: { type: 'string', description: 'Position pubkey' },
        orderType: { type: 'string', enum: ['take_profit', 'stop_loss'], description: 'Order type' },
        triggerPrice: { type: 'number', description: 'Price at which order triggers' },
        sizeUsd: { type: 'number', description: 'Position size to close. Omit for full position.' },
        sizePercent: { type: 'number', description: 'Percentage of position to close (default 100)' },
      },
      required: ['positionKey', 'orderType', 'triggerPrice'],
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
      positionKey: string;
      orderType: 'take_profit' | 'stop_loss';
      triggerPrice: number;
      sizeUsd?: number;
      sizePercent?: number;
    };

    try {
      const client = getFlashTradeClient();

      const position = await client.getPosition(args.positionKey, context.signal);

      if (position.status !== 'open') {
        return { error: { code: 'position_not_open' } };
      }

      if (position.triggerOrderCount >= FLASH_MAX_TRIGGER_ORDERS_PER_POSITION) {
        return { error: { code: 'max_trigger_orders' } };
      }

      if (position.collateralUsd < FLASH_MIN_COLLATERAL_WITH_TPSL_USD) {
        return { error: { code: 'collateral_too_low_for_tpsl' } };
      }

      const triggerValidation = validateTriggerPrice({
        orderType: args.orderType,
        side: position.side,
        triggerPrice: args.triggerPrice,
        entryPrice: position.entryPrice,
        currentPrice: position.markPrice,
      });

      if (!triggerValidation.ok) {
        return { error: { code: triggerValidation.code } };
      }

      if (args.sizeUsd != null && args.sizeUsd > position.sizeUsd) {
        return { error: { code: 'order_size_exceeds_position' } };
      }

      const response = await client.placeTriggerOrder(
        {
          positionKey: args.positionKey,
          marketSymbol: position.marketSymbol,
          side: position.side,
          triggerPrice: args.triggerPrice,
          sizeUsd: args.sizeUsd ?? position.sizeUsd,
          sizePercent: args.sizePercent ?? 100,
          isStopLoss: args.orderType === 'stop_loss',
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'place_trigger_order',
        actionLabel: args.orderType === 'stop_loss' ? 'Place stop loss' : 'Place take profit',
        walletAddress: context.scope.walletAddress!,
        network: 'mainnet',
        positionKey: args.positionKey,
        orderId: response.orderId,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: position.leverage,
        collateralUsd: position.collateralUsd,
        inputTokenSymbol: 'USDC',
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: position.liquidationPrice,
        sizeUsd: args.sizeUsd ?? position.sizeUsd,
        entryFeeUsd: 0,
        amountUsd: args.sizeUsd ?? position.sizeUsd,
        transactionBase64: response.transactionBase64,
        expiresAt: response.expiresAt,
        triggerOrders: [
          {
            orderType: args.orderType,
            triggerPrice: args.triggerPrice,
            sizePercent: args.sizePercent ?? 100,
          },
        ],
      };

      return {
        result: {
          status: 'drafted',
          orderId: response.orderId,
          positionKey: args.positionKey,
          marketSymbol: position.marketSymbol,
          orderType: args.orderType,
          triggerPrice: args.triggerPrice,
          sizeUsd: args.sizeUsd ?? position.sizeUsd,
          sizePercent: args.sizePercent ?? 100,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
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
