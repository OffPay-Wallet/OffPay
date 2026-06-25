import { getWalletDashboard } from '@/lib/api/offpay-api-client';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardQueryKey,
  offpayWalletTransactionsQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type {
  CapabilitiesResponse,
  OffpayNetwork,
  StreamCapabilitiesResponse,
  WalletDashboardResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

export const WALLET_DASHBOARD_WARM_STALE_TIME_MS = 1000 * 60;

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
  const transactionsKey = offpayWalletTransactionsQueryKey(
    dashboard.address,
    dashboard.network,
    limit,
  );
  const existingTransactions =
    queryClient.getQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
      transactionsKey,
    );
  const existingFetchedAt = existingTransactions?.pages[0]?.fetchedAt ?? 0;
  if (dashboard.transactions.fetchedAt >= existingFetchedAt) {
    queryClient.setQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
      transactionsKey,
      {
        pages: [dashboard.transactions],
        pageParams: [undefined],
      },
      { updatedAt: dashboard.transactions.fetchedAt },
    );
  }
}

export async function prefetchOffpayWalletDashboard(params: {
  queryClient: QueryClient;
  walletAddress: string;
  network: OffpayNetwork;
  limit?: number;
  useCache?: boolean;
  requestOwner?: string;
}): Promise<WalletDashboardResponse | null> {
  if (params.walletAddress.length === 0) return null;

  const limit = params.limit ?? WALLET_TRANSACTIONS_PAGE_SIZE;
  const queryKey = offpayWalletDashboardQueryKey(params.walletAddress, params.network, limit);
  const cached = params.queryClient.getQueryData<WalletDashboardResponse>(queryKey);

  if (cached?.network === params.network && cached.address === params.walletAddress) {
    hydrateOffpayWalletDashboard({
      queryClient: params.queryClient,
      dashboard: cached,
      limit,
    });
  }

  try {
    const dashboard = await params.queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) =>
        getWalletDashboard(params.walletAddress, params.network, {
          signal,
          limit,
          useCache: params.useCache,
          requestOwner: params.requestOwner ?? 'wallet.dashboard.prefetch',
        }),
      staleTime: WALLET_DASHBOARD_WARM_STALE_TIME_MS,
    });

    hydrateOffpayWalletDashboard({
      queryClient: params.queryClient,
      dashboard,
      limit,
    });

    return dashboard;
  } catch {
    return cached?.network === params.network && cached.address === params.walletAddress
      ? cached
      : null;
  }
}
