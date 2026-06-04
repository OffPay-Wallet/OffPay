import { getWalletTransactions } from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { offpayWalletTransactionsQueryKey } from '@/lib/api/offpay-wallet-query-keys';

import {
  errorCodeFromUnknown,
  isNetworkReady,
  readCappedInteger,
  requireWalletAndNetwork,
} from './helpers';
import type { AgenticToolDefinition } from './types';
import type { WalletTransactionsResponse } from '@/types/offpay-api';

const DEFAULT_HISTORY_LIMIT = 6;
const MAX_HISTORY_LIMIT = 10;

function readCachedTransactions(
  context: Parameters<AgenticToolDefinition['run']>[1],
  limit: number,
) {
  const walletAddress = context.scope.walletAddress;
  const network = context.scope.network;
  if (context.queryClient == null || walletAddress == null || network == null) return null;

  const cached = context.queryClient.getQueryData<{
    pages?: WalletTransactionsResponse[];
  }>(offpayWalletTransactionsQueryKey(walletAddress, network, limit));
  const firstPage = cached?.pages?.[0];
  return firstPage ?? null;
}

function summarizeTransactions(response: WalletTransactionsResponse, limit: number) {
  const transactions = response.transactions.slice(0, limit).map((transaction) => ({
    type: transaction.type,
    direction: transaction.direction ?? null,
    status: transaction.status,
    timestamp: transaction.timestamp,
    amount: transaction.amount ?? null,
    tokenSymbol: transaction.tokenSymbol ?? null,
    tokenName: transaction.tokenName ?? null,
    feeLamports: transaction.fee,
  }));
  return {
    status: transactions.length === 0 ? 'empty' : 'ok',
    transactions,
    count: transactions.length,
    hasMore: response.cursor != null,
    fetchedAt: response.fetchedAt,
  };
}

export const getWalletHistoryTool: AgenticToolDefinition = {
  name: 'get_wallet_history',
  schema: {
    name: 'get_wallet_history',
    description:
      'Returns a capped recent wallet activity summary. Never returns signatures, counterparties, full descriptions, or full transaction history.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many recent rows to summarize. Capped at 10.',
        },
      },
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };

    const limit = readCappedInteger({
      call,
      key: 'limit',
      fallback: DEFAULT_HISTORY_LIMIT,
      min: 1,
      max: MAX_HISTORY_LIMIT,
    });

    const cached = readCachedTransactions(context, limit);
    if (cached != null) {
      return { result: { ...summarizeTransactions(cached, limit), source: 'cache' } };
    }

    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (!isOffpayFeatureAvailable(context.capabilities, 'wallet.transactions')) {
      return { error: { code: 'feature_unavailable' } };
    }

    try {
      const response = await getWalletTransactions(scope.walletAddress, scope.network, {
        limit,
        signal: context.signal,
      });
      return { result: { ...summarizeTransactions(response, limit), source: 'network' } };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'wallet_history_failed') } };
    }
  },
};
