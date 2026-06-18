import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardQueryKey,
  offpayWalletTransactionsQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type {
  CapabilitiesResponse,
  StreamCapabilitiesResponse,
  WalletDashboardResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

export const offpayCapabilitiesCacheKey = (network: WalletDashboardResponse['network'] | null) =>
  ['offpay', 'capabilities', network] as const;

export const offpayStreamCapabilitiesCacheKey = (
  network: WalletDashboardResponse['network'] | null,
) => ['offpay', 'streamCapabilities', network] as const;

export function hydrateOffpayWalletDashboard(params: {
  queryClient: QueryClient;
  dashboard: WalletDashboardResponse;
  limit?: number;
}): void {
  const { dashboard, queryClient } = params;
  const limit = params.limit ?? WALLET_TRANSACTIONS_PAGE_SIZE;
  const updatedAt = Math.max(
    dashboard.fetchedAt,
    dashboard.balance.fetchedAt,
    dashboard.transactions.fetchedAt,
  );

  queryClient.setQueryData<WalletDashboardResponse>(
    offpayWalletDashboardQueryKey(dashboard.address, dashboard.network, limit),
    dashboard,
    { updatedAt },
  );
  queryClient.setQueryData<CapabilitiesResponse>(
    offpayCapabilitiesCacheKey(dashboard.network),
    dashboard.capabilities,
    { updatedAt: dashboard.fetchedAt },
  );
  queryClient.setQueryData<StreamCapabilitiesResponse>(
    offpayStreamCapabilitiesCacheKey(dashboard.network),
    dashboard.streamCapabilities,
    { updatedAt: dashboard.fetchedAt },
  );
  queryClient.setQueryData(
    offpayWalletBalanceQueryKey(dashboard.address, dashboard.network),
    dashboard.balance,
    { updatedAt: dashboard.balance.fetchedAt },
  );
  queryClient.setQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
    offpayWalletTransactionsQueryKey(dashboard.address, dashboard.network, limit),
    {
      pages: [dashboard.transactions],
      pageParams: [undefined],
    },
    { updatedAt: dashboard.transactions.fetchedAt },
  );
}
