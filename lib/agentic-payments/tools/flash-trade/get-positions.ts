import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, errorCodeFromUnknown } from './helpers';

export const flashGetPositionsTool: AgenticToolDefinition = {
  name: 'flash_get_positions',
  schema: {
    name: 'flash_get_positions',
    description: 'Get all open leveraged positions for the user wallet on Flash Trade (mainnet only). Returns position details including PnL and liquidation prices.',
    parameters: { type: 'object', properties: {} },
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
      const positions = await client.getOwnerPositions(
        context.scope.walletAddress!,
        context.signal,
      );

      const openPositions = positions.filter((p) => p.status === 'open');

      return {
        result: {
          status: openPositions.length === 0 ? 'empty' : 'ok',
          positions: openPositions.map((p) => ({
            positionKey: p.positionKey,
            marketSymbol: p.marketSymbol,
            side: p.side,
            leverage: p.leverage,
            collateralUsd: p.collateralUsd,
            sizeUsd: p.sizeUsd,
            entryPrice: p.entryPrice,
            markPrice: p.markPrice,
            liquidationPrice: p.liquidationPrice,
            unrealizedPnlUsd: p.unrealizedPnlUsd,
            triggerOrderCount: p.triggerOrderCount,
            createdAt: p.createdAt,
          })),
          total: openPositions.length,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
