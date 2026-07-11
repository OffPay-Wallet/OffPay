import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import {
  requireMainnet,
  requireWallet,
  errorCodeFromUnknown,
  orderRef,
  sortedOrders,
} from './helpers';

export const flashGetOrdersTool: AgenticToolDefinition = {
  name: 'flash_get_orders',
  schema: {
    name: 'flash_get_orders',
    description:
      'Get all trigger orders (take-profit and stop-loss) for the user wallet on Flash Trade (mainnet only).',
    parameters: {
      type: 'object',
      properties: {
        marketSymbol: {
          type: 'string',
          description: 'Optional market-symbol filter. Returns every trigger order if omitted.',
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

    const marketSymbol = call.args.marketSymbol as string | undefined;

    try {
      const client = getFlashTradeClient();
      const orders = await client.getOwnerOrders(context.scope.walletAddress!, context.signal);

      const openOrders = sortedOrders(orders.filter((o) => o.status === 'open'));

      const filtered = marketSymbol
        ? openOrders.filter(
            (order) => order.marketSymbol.toUpperCase() === marketSymbol.toUpperCase(),
          )
        : openOrders;

      return {
        result: {
          status: filtered.length === 0 ? 'empty' : 'ok',
          orders: filtered.map((o) => ({
            orderRef: orderRef(o),
            marketSymbol: o.marketSymbol,
            side: o.side,
            triggerPrice: o.triggerPrice,
            sizeUsd: o.sizeUsd,
            sizePercent: o.sizePercent,
            sizeAmountUi: o.sizeAmountUi,
            isStopLoss: o.isStopLoss,
            orderType: o.isStopLoss ? 'stop_loss' : 'take_profit',
          })),
          total: filtered.length,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
