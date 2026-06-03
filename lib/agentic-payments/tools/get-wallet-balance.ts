import { buildVisibleTokenHoldings, formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

const MAX_BALANCE_ROWS = 16;

export const getWalletBalanceTool: AgenticToolDefinition = {
  name: 'get_wallet_balance',
  schema: {
    name: 'get_wallet_balance',
    description:
      'Returns the active wallet SOL and visible token balances as one unified summary. No wallet address or token mints.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    if (context.scope.walletAddress == null) return { error: { code: 'wallet_not_connected' } };
    if (context.scope.network == null) return { error: { code: 'network_not_selected' } };
    if (context.balance == null) return { result: { status: 'loading' } };

    const holdings = buildVisibleTokenHoldings(context.balance);
    return {
      result: {
        status: 'ok',
        network: context.scope.network,
        sol: formatLamportsAsSol(context.balance.solBalance, 9).replace(/\.?0+$/, ''),
        lamports: context.balance.solBalance,
        tokens: holdings.slice(0, MAX_BALANCE_ROWS).map((holding) => ({
          symbol: holding.symbol,
          name: holding.name,
          balance: holding.balance,
          verified: holding.verified,
          spam: holding.spam,
          usdPrice: holding.usdPrice,
        })),
        truncated: holdings.length > MAX_BALANCE_ROWS,
        fetchedAt: context.balance.fetchedAt,
      },
    };
  },
};
