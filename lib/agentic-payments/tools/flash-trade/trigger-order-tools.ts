import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, errorCodeFromUnknown } from './helpers';
import type { FlashTradeDraft } from './types';

export const flashEditTriggerOrderTool: AgenticToolDefinition = {
  name: 'flash_edit_trigger_order',
  schema: {
    name: 'flash_edit_trigger_order',
    description: 'Edit an existing take-profit or stop-loss order (mainnet only). Change trigger price or size.',
    parameters: {
      type: 'object',
      properties: {
        marketSymbol: { type: 'string', description: 'Market symbol (SOL, BTC, ETH)' },
        side: { type: 'string', enum: ['long', 'short'], description: 'Position side' },
        orderId: { type: 'string', description: 'Order ID to edit' },
        newTriggerPrice: { type: 'number', description: 'New trigger price' },
        newSizeUsd: { type: 'number', description: 'New size (optional)' },
        isStopLoss: { type: 'boolean', description: 'Whether this is a stop-loss order' },
      },
      required: ['marketSymbol', 'side', 'orderId', 'newTriggerPrice', 'isStopLoss'],
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
      side: 'long' | 'short';
      orderId: string;
      newTriggerPrice: number;
      newSizeUsd?: number;
      isStopLoss: boolean;
    };

    try {
      const client = getFlashTradeClient();

      const response = await client.editTriggerOrder(
        {
          marketSymbol: args.marketSymbol,
          side: args.side,
          orderId: args.orderId,
          newTriggerPrice: args.newTriggerPrice,
          newSizeUsd: args.newSizeUsd,
          isStopLoss: args.isStopLoss,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      return {
        result: {
          status: 'drafted',
          orderId: args.orderId,
          marketSymbol: args.marketSymbol,
          orderType: args.isStopLoss ? 'stop_loss' : 'take_profit',
          newTriggerPrice: args.newTriggerPrice,
          newSizeUsd: args.newSizeUsd,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
        },
        draft: {
          kind: 'flash_position',
          draft: {
            kind: 'flash_position',
            operation: 'edit_trigger_order',
            actionLabel: args.isStopLoss ? 'Edit stop loss' : 'Edit take profit',
            walletAddress: context.scope.walletAddress!,
            network: 'mainnet',
            orderId: args.orderId,
            marketSymbol: args.marketSymbol,
            side: args.side,
            leverage: 1,
            collateralUsd: 0,
            inputTokenSymbol: 'USDC',
            tradeType: 'market',
            entryPrice: 0,
            liquidationPrice: 0,
            sizeUsd: args.newSizeUsd ?? 0,
            entryFeeUsd: 0,
            amountUsd: args.newSizeUsd ?? null,
            transactionBase64: response.transactionBase64,
            expiresAt: response.expiresAt,
            triggerOrders: [
              {
                orderType: args.isStopLoss ? 'stop_loss' : 'take_profit',
                triggerPrice: args.newTriggerPrice,
                sizePercent: 100,
              },
            ],
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashCancelTriggerOrderTool: AgenticToolDefinition = {
  name: 'flash_cancel_trigger_order',
  schema: {
    name: 'flash_cancel_trigger_order',
    description: 'Cancel a single take-profit or stop-loss order (mainnet only).',
    parameters: {
      type: 'object',
      properties: {
        marketSymbol: { type: 'string', description: 'Market symbol' },
        side: { type: 'string', enum: ['long', 'short'], description: 'Position side' },
        orderId: { type: 'string', description: 'Order ID to cancel' },
        isStopLoss: { type: 'boolean', description: 'Whether this is a stop-loss order' },
      },
      required: ['marketSymbol', 'side', 'orderId', 'isStopLoss'],
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
      side: 'long' | 'short';
      orderId: string;
      isStopLoss: boolean;
    };

    try {
      const client = getFlashTradeClient();

      const response = await client.cancelTriggerOrder(
        {
          marketSymbol: args.marketSymbol,
          side: args.side,
          orderId: args.orderId,
          isStopLoss: args.isStopLoss,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      return {
        result: {
          status: 'drafted',
          orderId: args.orderId,
          marketSymbol: args.marketSymbol,
          orderType: args.isStopLoss ? 'stop_loss' : 'take_profit',
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
        },
        draft: {
          kind: 'flash_position',
          draft: {
            kind: 'flash_position',
            operation: 'cancel_trigger_order',
            actionLabel: args.isStopLoss ? 'Cancel stop loss' : 'Cancel take profit',
            walletAddress: context.scope.walletAddress!,
            network: 'mainnet',
            orderId: args.orderId,
            marketSymbol: args.marketSymbol,
            side: args.side,
            leverage: 1,
            collateralUsd: 0,
            inputTokenSymbol: 'USDC',
            tradeType: 'market',
            entryPrice: 0,
            liquidationPrice: 0,
            sizeUsd: 0,
            entryFeeUsd: 0,
            transactionBase64: response.transactionBase64,
            expiresAt: response.expiresAt,
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashCancelAllTriggerOrdersTool: AgenticToolDefinition = {
  name: 'flash_cancel_all_trigger_orders',
  schema: {
    name: 'flash_cancel_all_trigger_orders',
    description: 'Cancel all trigger orders (TP and SL) for a market and side (mainnet only).',
    parameters: {
      type: 'object',
      properties: {
        marketSymbol: { type: 'string', description: 'Market symbol' },
        side: { type: 'string', enum: ['long', 'short'], description: 'Position side' },
      },
      required: ['marketSymbol', 'side'],
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
      side: 'long' | 'short';
    };

    try {
      const client = getFlashTradeClient();

      const response = await client.cancelAllTriggerOrders(
        {
          marketSymbol: args.marketSymbol,
          side: args.side,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      return {
        result: {
          status: 'drafted',
          marketSymbol: args.marketSymbol,
          side: args.side,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
        },
        draft: {
          kind: 'flash_position',
          draft: {
            kind: 'flash_position',
            operation: 'cancel_all_trigger_orders',
            actionLabel: 'Cancel all trigger orders',
            walletAddress: context.scope.walletAddress!,
            network: 'mainnet',
            marketSymbol: args.marketSymbol,
            side: args.side,
            leverage: 1,
            collateralUsd: 0,
            inputTokenSymbol: 'USDC',
            tradeType: 'market',
            entryPrice: 0,
            liquidationPrice: 0,
            sizeUsd: 0,
            entryFeeUsd: 0,
            transactionBase64: response.transactionBase64,
            expiresAt: response.expiresAt,
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};

export const flashReversePositionTool: AgenticToolDefinition = {
  name: 'flash_reverse_position',
  schema: {
    name: 'flash_reverse_position',
    description: 'Reverse a position from long to short or vice versa (mainnet only). Closes existing position and opens opposite direction.',
    parameters: {
      type: 'object',
      properties: {
        positionKey: { type: 'string', description: 'Position pubkey to reverse' },
      },
      required: ['positionKey'],
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

    const args = call.args as { positionKey: string };

    try {
      const client = getFlashTradeClient();

      const position = await client.getPosition(args.positionKey, context.signal);

      if (position.status !== 'open') {
        return { error: { code: 'position_not_open' } };
      }

      const response = await client.reversePosition(
        {
          positionKey: args.positionKey,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      const newSide = position.side === 'long' ? 'short' : 'long';

      return {
        result: {
          status: 'drafted',
          oldPositionKey: args.positionKey,
          newPositionKey: response.newPositionKey,
          marketSymbol: position.marketSymbol,
          previousSide: position.side,
          newSide,
          leverage: position.leverage,
          collateralUsd: position.collateralUsd,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
          warning: position.triggerOrderCount > 0
            ? 'Existing trigger orders will be cancelled when position is reversed.'
            : undefined,
        },
        draft: {
          kind: 'flash_position',
          draft: {
            kind: 'flash_position',
            operation: 'reverse_position',
            actionLabel: 'Reverse position',
            walletAddress: context.scope.walletAddress!,
            network: 'mainnet',
            positionKey: args.positionKey,
            marketSymbol: position.marketSymbol,
            side: newSide,
            leverage: position.leverage,
            collateralUsd: position.collateralUsd,
            inputTokenSymbol: 'USDC',
            tradeType: 'market',
            entryPrice: position.markPrice,
            liquidationPrice: position.liquidationPrice,
            sizeUsd: position.sizeUsd,
            entryFeeUsd: 0,
            transactionBase64: response.transactionBase64,
            expiresAt: response.expiresAt,
            warnings:
              position.triggerOrderCount > 0
                ? ['Existing trigger orders will be cancelled when the position is reversed.']
                : undefined,
          },
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
