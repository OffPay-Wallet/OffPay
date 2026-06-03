import { buildVisibleTokenHoldings } from '@/lib/api/offpay-wallet-data';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

export const listWalletTokensTool: AgenticToolDefinition = {
  name: 'list_wallet_tokens',
  schema: {
    name: 'list_wallet_tokens',
    description:
      'Compatibility tool. Prefer get_wallet_balance. Returns active wallet token holdings as `{symbol, name, balance, verified, spam}` rows. No mints or addresses.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    if (context.balance == null) return { result: { status: 'loading' } };
    const holdings = buildVisibleTokenHoldings(context.balance);
    if (holdings.length === 0) return { result: { status: 'empty' } };
    return {
      result: {
        status: 'ok',
        tokens: holdings.map((holding) => ({
          symbol: holding.symbol,
          name: holding.name,
          balance: holding.balance,
          verified: holding.verified,
          spam: holding.spam,
        })),
      },
    };
  },
};
