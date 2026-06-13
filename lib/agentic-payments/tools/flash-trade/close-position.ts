import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, errorCodeFromUnknown } from './helpers';
import type { FlashTradeDraft } from './types';

export const flashClosePositionTool: AgenticToolDefinition = {
  name: 'flash_close_position',
  schema: {
    name: 'flash_close_position',
    description: 'Close a leveraged position on Flash Trade (mainnet only). Full or partial close supported. Returns preview with exit price, fees, PnL, and unsigned transaction.',
    parameters: {
      type: 'object',
      properties: {
        positionKey: { type: 'string', description: 'Position pubkey from get_positions' },
        closeAmountUsd: { type: 'number', description: 'Amount to close in USD. Omit for full close.' },
        withdrawTokenSymbol: { type: 'string', description: 'Token to receive (USDC, SOL)' },
        slippageBps: { type: 'number', description: 'Slippage tolerance (default 50)' },
      },
      required: ['positionKey', 'withdrawTokenSymbol'],
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
      closeAmountUsd?: number;
      withdrawTokenSymbol: string;
      slippageBps?: number;
    };

    try {
      const client = getFlashTradeClient();

      const position = await client.getPosition(args.positionKey, context.signal);

      if (position.status !== 'open') {
        return { error: { code: 'position_not_open' } };
      }

      if (args.closeAmountUsd != null) {
        if (args.closeAmountUsd > position.sizeUsd) {
          return { error: { code: 'close_amount_exceeds_position' } };
        }
        if (args.closeAmountUsd < 5 && position.sizeUsd - args.closeAmountUsd < 5) {
          return {
            result: {
              status: 'dust_warning',
              message: 'Remaining position would be dust. Suggest full close instead.',
              positionSizeUsd: position.sizeUsd,
            },
          };
        }
      }

      const response = await client.closePosition(
        {
          positionKey: args.positionKey,
          closeAmountUsd: args.closeAmountUsd,
          withdrawTokenSymbol: args.withdrawTokenSymbol,
          slippageBps: args.slippageBps ?? 50,
          owner: context.scope.walletAddress!,
        },
        context.signal,
      );

      const isFullClose = args.closeAmountUsd == null || args.closeAmountUsd >= position.sizeUsd;

      const draft: FlashTradeDraft = {
        kind: 'flash_position',
        operation: 'close_position',
        actionLabel: isFullClose ? 'Close position' : 'Partial close',
        walletAddress: context.scope.walletAddress!,
        network: 'mainnet',
        positionKey: args.positionKey,
        marketSymbol: position.marketSymbol,
        side: position.side,
        leverage: position.leverage,
        collateralUsd: position.collateralUsd,
        inputTokenSymbol: args.withdrawTokenSymbol,
        tradeType: 'market',
        entryPrice: position.entryPrice,
        liquidationPrice: position.liquidationPrice,
        sizeUsd: args.closeAmountUsd ?? position.sizeUsd,
        entryFeeUsd: 0,
        amountUsd: args.closeAmountUsd ?? position.sizeUsd,
        amountTokenSymbol: args.withdrawTokenSymbol,
        exitPrice: response.exitPrice,
        feesUsd: response.feesUsd,
        realizedPnlUsd: response.realizedPnlUsd,
        transactionBase64: response.transactionBase64,
        expiresAt: response.expiresAt,
        warnings:
          isFullClose && position.triggerOrderCount > 0
            ? ['Full close will cancel existing trigger orders.']
            : undefined,
      };

      return {
        result: {
          status: 'drafted',
          positionKey: args.positionKey,
          marketSymbol: position.marketSymbol,
          side: position.side,
          closeAmountUsd: args.closeAmountUsd ?? position.sizeUsd,
          isFullClose,
          exitPrice: response.exitPrice,
          feesUsd: response.feesUsd,
          realizedPnlUsd: response.realizedPnlUsd,
          transactionBase64: response.transactionBase64,
          expiresAt: response.expiresAt,
          triggerOrdersWillCancel: isFullClose && position.triggerOrderCount > 0,
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
