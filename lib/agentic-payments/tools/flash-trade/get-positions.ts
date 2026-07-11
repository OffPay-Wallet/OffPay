import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import {
  requireMainnet,
  requireWallet,
  errorCodeFromUnknown,
  positionRef,
  sortedPositions,
} from './helpers';

export const flashGetPositionsTool: AgenticToolDefinition = {
  name: 'flash_get_positions',
  schema: {
    name: 'flash_get_positions',
    description:
      'Get all open leveraged positions for the user wallet on Flash Trade (mainnet only). Returns position details including PnL and liquidation prices.',
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
      const [positions, readiness] = await Promise.all([
        client.getOwnerPositions(context.scope.walletAddress!, context.signal),
        client.getAccountReadiness(context.scope.walletAddress!, context.signal),
      ]);

      const openPositions = sortedPositions(positions.filter((p) => p.status === 'open'));
      const withdrawalCapability = context.capabilities?.perps?.withdrawal;

      return {
        result: {
          status: openPositions.length === 0 ? 'empty' : 'ok',
          basketAvailable: readiness.ready,
          readinessReason: readiness.reason,
          tradingReadiness: readiness.ready ? 'builder_verification_required' : 'setup_required',
          setupRequiredSteps: readiness.ready
            ? undefined
            : ['init_basket', 'init_deposit_ledger', 'delegate_basket', 'deposit_direct'],
          withdrawalAvailable:
            withdrawalCapability?.available === true && withdrawalCapability.reason === 'available',
          withdrawalReason: withdrawalCapability?.reason ?? 'not_implemented',
          withdrawalMessage:
            withdrawalCapability?.message ??
            'Flash withdrawal is disabled because the request requires an unavailable distinct co-signer.',
          positions: openPositions.map((p) => ({
            positionRef: positionRef(p),
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
            collateralSymbol: p.collateralSymbol,
            sizeAmountUi: p.sizeAmountUi,
          })),
          total: openPositions.length,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
