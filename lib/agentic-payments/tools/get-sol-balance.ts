import { formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

export const getSolBalanceTool: AgenticToolDefinition = {
  name: 'get_sol_balance',
  schema: {
    name: 'get_sol_balance',
    description:
      'Compatibility tool. Prefer get_wallet_balance. Returns the active wallet SOL balance as a human-readable amount and a lamport count.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    if (context.balance == null) return { result: { status: 'loading' } };
    return {
      result: {
        status: 'ok',
        sol: formatLamportsAsSol(context.balance.solBalance, 9).replace(/\.?0+$/, ''),
        lamports: context.balance.solBalance,
      },
    };
  },
};
