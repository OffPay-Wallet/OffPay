import type { AgenticToolDefinition } from '../types';
import { getFlashTradeClient } from '@/lib/flash-trade';
import { requireMainnet, requireWallet, isPriceStale, errorCodeFromUnknown } from './helpers';

export const flashGetPricesTool: AgenticToolDefinition = {
  name: 'flash_get_prices',
  schema: {
    name: 'flash_get_prices',
    description: 'Get current Pyth oracle prices for all perpetual markets (mainnet only). Returns prices with confidence intervals and freshness status.',
    parameters: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by market symbols (SOL, BTC, ETH). Returns all if omitted.',
        },
      },
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

    const symbols = call.args.symbols as string[] | undefined;

    try {
      const client = getFlashTradeClient();
      const prices = await client.getPrices(context.signal);

      const filtered = symbols
        ? prices.filter((p) =>
            symbols.some((s) => s.toUpperCase() === p.symbol.toUpperCase()),
          )
        : prices;

      const now = Date.now();
      const enriched = filtered.map((p) => ({
        symbol: p.symbol,
        price: p.price,
        confidenceInterval: p.confidenceInterval,
        updatedAt: p.updatedAt,
        ageMs: now - p.updatedAt,
        isStale: isPriceStale(p),
      }));

      const hasStale = enriched.some((p) => p.isStale);

      return {
        result: {
          status: hasStale ? 'stale_warning' : 'ok',
          prices: enriched.map((p) => ({
            symbol: p.symbol,
            price: p.price,
            confidenceInterval: p.confidenceInterval,
            isStale: p.isStale,
            ageMs: p.ageMs,
          })),
          warning: hasStale
            ? 'Some prices may be stale. Trading not recommended for stale markets.'
            : undefined,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'flash_api_unavailable') } };
    }
  },
};
