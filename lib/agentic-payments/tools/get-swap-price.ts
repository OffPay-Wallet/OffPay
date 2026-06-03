import { getSwapPrice, getSwapTokens } from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';

import {
  errorCodeFromUnknown,
  hydrateStringArg,
  isNetworkReady,
  requireWalletAndNetwork,
  resolveSwapTokenReference,
} from './helpers';
import type { AgenticToolDefinition } from './types';

export const getSwapPriceTool: AgenticToolDefinition = {
  name: 'get_swap_price',
  schema: {
    name: 'get_swap_price',
    description:
      'Returns current USD price for a supported swap token. The model passes a symbol/name/mint placeholder; result contains no mint.',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol, name, or redacted mint placeholder.' },
      },
      required: ['token'],
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (
      !isOffpayFeatureAvailable(context.capabilities, 'swap.tokens') ||
      !isOffpayFeatureAvailable(context.capabilities, 'swap.price')
    ) {
      return { error: { code: 'feature_unavailable' } };
    }

    const tokenText = hydrateStringArg(call, 'token', context.redactions);
    try {
      const tokens = await getSwapTokens(scope.network, { signal: context.signal });
      const resolved = resolveSwapTokenReference({ tokens: tokens.tokens, value: tokenText });
      if (!resolved.ok) return { error: { code: resolved.code } };
      const price = await getSwapPrice(resolved.token.mint, scope.network, {
        signal: context.signal,
      });
      return {
        result: {
          status: 'ok',
          symbol: resolved.token.symbol,
          name: resolved.token.name,
          price: price.price,
          currency: price.currency,
          fetchedAt: price.fetchedAt,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'swap_price_failed') } };
    }
  },
};
