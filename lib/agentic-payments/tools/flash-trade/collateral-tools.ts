import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, errorCodeFromUnknown } from './helpers';
import type { FlashTradeDraft } from './types';

export const flashAddCollateralTool: AgenticToolDefinition = {
  name: 'flash_add_collateral',
  schema: {
    name: 'flash_add_collateral',
    description: 'Add collateral to an existing position to reduce leverage and move liquidation price further away (mainnet only).',
    parameters: {
      type: 'object',
      properties: {
        positionKey: { type: 'string', description: 'Position pubkey' },
        depositAmount: { type: 'number', description: 'Amount to deposit in USD' },
        depositTokenSymbol: { type: 'string', description: 'Token to deposit (USDC, SOL)' },
      },
      required: ['positionKey', 'depositAmount', 'depositTokenSymbol'],
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
      depositAmount: number;
      depositTokenSymbol: string;
    };

    if (args.depositAmount <= 0) {
      return { error: { code: 'invalid_amount' } };
    }

    try {
      const client = getFlashTradeClient();

      const position = await client.getPosition(args.positionKey, context.signal);

      if (position.status !== 'open') {
        return { error: { code: 'position_not_open' } };
      }

      const response = await client.addCollateral(
        {
          positionKey: args.positionKey,
          depositAmount: args.depositAmount,
          depositTokenSymbol: args.depositTokenSymbol,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'add_collateral',
        actionLabel: 'Add collateral',
        walletAddress: context.scope.walletAddress!,
        network: 'mainnet',
        positionKey: args.positionKey,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: response.newLeverage,
        collateralUsd: position.collateralUsd + args.depositAmount,
        inputTokenSymbol: args.depositTokenSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: response.newLiquidationPrice,
        sizeUsd: position.sizeUsd,
        entryFeeUsd: 0,
        amountUsd: args.depositAmount,
        amountTokenSymbol: args.depositTokenSymbol,
        newLeverage: response.newLeverage,
        newLiquidationPrice: response.newLiquidationPrice,
        transactionBase64: response.transactionBase64,
        expiresAt: response.expiresAt,
        warnings:
          position.triggerOrderCount > 0
            ? [
                'Position has trigger orders. Adding collateral changes leverage and may affect TP/SL triggering.',
              ]
            : undefined,
      };

      return {
        result: {
          status: 'drafted',
          positionKey: args.positionKey,
          marketSymbol: position.marketSymbol,
          depositAmount: args.depositAmount,
          depositTokenSymbol: args.depositTokenSymbol,
          previousLeverage: position.leverage,
          previousLiquidationPrice: position.liquidationPrice,
          newLeverage: response.newLeverage,
          newLiquidationPrice: response.newLiquidationPrice,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
          warning: position.triggerOrderCount > 0
            ? 'Position has trigger orders. Adding collateral changes leverage and may affect TP/SL triggering.'
            : undefined,
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

export const flashRemoveCollateralTool: AgenticToolDefinition = {
  name: 'flash_remove_collateral',
  schema: {
    name: 'flash_remove_collateral',
    description: 'Remove collateral from a position to increase leverage (mainnet only). Riskier - moves liquidation price closer to current price.',
    parameters: {
      type: 'object',
      properties: {
        positionKey: { type: 'string', description: 'Position pubkey' },
        withdrawAmountUsd: { type: 'number', description: 'Amount to withdraw in USD' },
        withdrawTokenSymbol: { type: 'string', description: 'Token to receive (USDC, SOL)' },
      },
      required: ['positionKey', 'withdrawAmountUsd', 'withdrawTokenSymbol'],
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
      withdrawAmountUsd: number;
      withdrawTokenSymbol: string;
    };

    if (args.withdrawAmountUsd <= 0) {
      return { error: { code: 'invalid_amount' } };
    }

    try {
      const client = getFlashTradeClient();

      const position = await client.getPosition(args.positionKey, context.signal);

      if (position.status !== 'open') {
        return { error: { code: 'position_not_open' } };
      }

      if (args.withdrawAmountUsd >= position.collateralUsd) {
        return { error: { code: 'cannot_remove_all_collateral' } };
      }

      const response = await client.removeCollateral(
        {
          positionKey: args.positionKey,
          withdrawAmountUsd: args.withdrawAmountUsd,
          withdrawTokenSymbol: args.withdrawTokenSymbol,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      const priceDistancePercent = Math.abs(
        ((response.newLiquidationPrice - position.markPrice) / position.markPrice) * 100,
      );

      const warnings: string[] = [];
      if (priceDistancePercent < 5) {
        warnings.push('Liquidation price is within 5% of current price. High risk of liquidation.');
      } else if (priceDistancePercent < 10) {
        warnings.push('Liquidation price is within 10% of current price. Moderate risk.');
      }

      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'remove_collateral',
        actionLabel: 'Remove collateral',
        walletAddress: context.scope.walletAddress!,
        network: 'mainnet',
        positionKey: args.positionKey,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: response.newLeverage,
        collateralUsd: position.collateralUsd - args.withdrawAmountUsd,
        inputTokenSymbol: args.withdrawTokenSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: response.newLiquidationPrice,
        sizeUsd: position.sizeUsd,
        entryFeeUsd: 0,
        amountUsd: args.withdrawAmountUsd,
        amountTokenSymbol: args.withdrawTokenSymbol,
        newLeverage: response.newLeverage,
        newLiquidationPrice: response.newLiquidationPrice,
        transactionBase64: response.transactionBase64,
        expiresAt: response.expiresAt,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      return {
        result: {
          status: 'drafted',
          positionKey: args.positionKey,
          marketSymbol: position.marketSymbol,
          withdrawAmountUsd: args.withdrawAmountUsd,
          withdrawTokenSymbol: args.withdrawTokenSymbol,
          previousLeverage: position.leverage,
          previousLiquidationPrice: position.liquidationPrice,
          newLeverage: response.newLeverage,
          newLiquidationPrice: response.newLiquidationPrice,
          liquidationDistancePercent: priceDistancePercent,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
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
