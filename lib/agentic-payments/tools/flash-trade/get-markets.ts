import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, errorCodeFromUnknown } from './helpers';

export const flashGetMarketsTool: AgenticToolDefinition = {
  name: 'flash_get_markets',
  schema: {
    name: 'flash_get_markets',
    description:
      'List live Flash Trade V2 perpetual markets on mainnet. Markets and limits come from the current protocol pool configuration.',
    parameters: { type: 'object', properties: {} },
  },
  run: async (_call, context) => {
    const networkCheck = requireMainnet(context.scope.network);
    if (!networkCheck.ok) {
      return { error: { code: networkCheck.code } };
    }

    if (!context.canUseNetwork) {
      return { error: { code: 'network_unavailable' } };
    }

    try {
      const client = getFlashTradeClient();
      const markets = await client.getMarkets(context.signal);

      const activeMarkets = markets.filter((m) => m.status === 'active');

      return {
        result: {
          status: activeMarkets.length === 0 ? 'empty' : 'ok',
          markets: activeMarkets.map((m) => ({
            symbol: m.symbol,
            pool: m.poolName,
            minLeverage: m.minLeverage,
            maxLeverage: m.maxLeverage,
            maxLeverageDegen: m.maxLeverageDegen,
            feePercent: m.feePercent,
            status: m.status,
            marketSession: m.marketSession,
          })),
          total: markets.length,
          active: activeMarkets.length,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
