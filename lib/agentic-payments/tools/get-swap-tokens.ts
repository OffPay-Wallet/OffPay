import { getSwapTokens } from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';

import { errorCodeFromUnknown, isNetworkReady, requireWalletAndNetwork } from './helpers';
import type { AgenticToolDefinition } from './types';

const MAX_SWAP_TOKEN_ROWS = 50;

export const getSwapTokensTool: AgenticToolDefinition = {
  name: 'get_swap_tokens',
  schema: {
    name: 'get_swap_tokens',
    description:
      'Returns supported normal-swap token symbols/names for the active network. No token mints are returned.',
    parameters: { type: 'object', properties: {} },
  },
  run: async (_call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (!isOffpayFeatureAvailable(context.capabilities, 'swap.tokens')) {
      return { error: { code: 'feature_unavailable' } };
    }

    try {
      const response = await getSwapTokens(scope.network, { signal: context.signal });
      return {
        result: {
          status: response.tokens.length === 0 ? 'empty' : 'ok',
          tokens: response.tokens.slice(0, MAX_SWAP_TOKEN_ROWS).map((token) => ({
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            verified: token.verified,
          })),
          truncated: response.tokens.length > MAX_SWAP_TOKEN_ROWS,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'swap_tokens_failed') } };
    }
  },
};
