import { useInfiniteQuery, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { getWalletTransactions } from '@/lib/api/offpay-api-client';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  offpayWalletDashboardBaseQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  offpayWalletTransactionsQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  mergeWalletTransactionsWithDisplayCache,
  writeWalletDisplayCacheSlice,
} from '@/lib/wallet/wallet-display-cache';
import { useWalletStore } from '@/store/walletStore';

import type { InfiniteData } from '@tanstack/react-query';
import type { CapabilityStatus, WalletTransactionsResponse } from '@/types/offpay-api';

// Live updates from the WS activity stream invalidate this cache the
// moment a notification arrives, so a high `staleTime` keeps RPC
// usage low without making the UI go stale. The 2-minute ceiling is
// the recovery floor: if the WS *and* the 60s fallback poll both
// silently stall, focus / reconnect refetches still kick in.
const TRANSACTION_STALE_TIME_MS = 1000 * 60 * 2;
const TRANSACTION_GC_TIME_MS = 1000 * 60 * 30;

const EMPTY_TRANSACTIONS: WalletTransactionsResponse['transactions'] = [];
const EMPTY_PAGES: WalletTransactionsResponse[] = [];

type WalletTransactionsInfiniteData = InfiniteData<WalletTransactionsResponse, string | undefined>;

interface WalletTransactionsSelectResult {
  pages: WalletTransactionsResponse[];
  pageParams: (string | undefined)[];
  transactions: WalletTransactionsResponse['transactions'];
}

function selectWalletTransactionPages(
  data: InfiniteData<WalletTransactionsResponse, string | undefined>,
): WalletTransactionsSelectResult {
  const transactions: WalletTransactionsResponse['transactions'] = [];
  for (const page of data.pages) {
    for (const transaction of page.transactions) transactions.push(transaction);
  }
  return {
    pages: data.pages,
    pageParams: data.pageParams,
    transactions,
  };
}

export function useOffpayWalletTransactions(options?: {
  walletAddress?: string | null;
  limit?: number;
  deferUntilAfterInteractions?: boolean;
  autoFetchAllPages?: boolean;
  refetchOnMount?: boolean | 'always';
  useCache?: boolean;
  enabled?: boolean;
  requestOwner?: string;
}) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = options?.walletAddress ?? activeWalletAddress;
  const limit = options?.limit ?? WALLET_TRANSACTIONS_PAGE_SIZE;
  const deferUntilAfterInteractions = options?.deferUntilAfterInteractions ?? false;
  const autoFetchAllPages = options?.autoFetchAllPages ?? false;
  const useCache = options?.useCache;
  const enabledByCaller = options?.enabled ?? true;
  const requestOwner = options?.requestOwner ?? 'wallet.transactions';
  const [interactionsSettled, setInteractionsSettled] = useState(!deferUntilAfterInteractions);
  const [freshRefetching, setFreshRefetching] = useState(false);
  const freshRefetchingRef = useRef(false);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const dashboardFetching =
    useIsFetching({
      queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
    }) > 0;
  const capabilitiesQuery = useOffpayCapabilities({
    enabled: enabledByCaller,
    requestOwner: `${requestOwner}.capabilities`,
  });
  const { capabilities } = capabilitiesQuery;
  const queryClient = useQueryClient();
  const transactionsQueryKey = useMemo(
    () =>
      offpayWalletTransactionsQueryKey(
        walletAddress,
        network,
        limit,
        useCache === false ? 'network' : 'cached',
      ),
    [limit, network, useCache, walletAddress],
  );
  const capability: CapabilityStatus = !canUseNetwork
    ? {
        available: false,
        reason: 'temporarily_unavailable',
        message: 'Offline mode is using cached activity.',
      }
    : capabilities == null && capabilitiesQuery.hasCapabilityError
      ? {
          available: false,
          reason: 'temporarily_unavailable',
          message: capabilitiesQuery.errorMessage,
        }
      : getOffpayFeatureCapability(capabilities, 'wallet.transactions');
  const transactionsFeatureAvailable = isOffpayFeatureAvailable(
    capabilities,
    'wallet.transactions',
  );
  const canRequestTransactions =
    walletAddress != null && network != null && canUseNetwork && transactionsFeatureAvailable;
  const canFetchTransactions = canRequestTransactions && enabledByCaller && !dashboardFetching;
  const enabled = canFetchTransactions && interactionsSettled;

  useEffect(() => {
    if (!enabledByCaller) {
      setInteractionsSettled(false);
      return undefined;
    }

    if (!deferUntilAfterInteractions) {
      setInteractionsSettled(true);
      return undefined;
    }

    setInteractionsSettled(false);
    const task = scheduleUiWorkAfterFirstPaint(
      () => {
        setInteractionsSettled(true);
      },
      {
        timeoutMs: 2500,
        fallbackDelayMs: 350,
      },
    );

    return () => {
      task.cancel();
    };
  }, [deferUntilAfterInteractions, enabledByCaller, limit, network, walletAddress]);

  const query = useInfiniteQuery({
    queryKey: transactionsQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      if (walletAddress == null || network == null) {
        throw new Error('Wallet transactions require an active wallet and supported network.');
      }

      const page = await getWalletTransactions(walletAddress, network, {
        cursor: pageParam,
        limit,
        useCache,
        signal,
        requestOwner,
      });

      if (pageParam != null) return page;

      const fallback =
        queryClient.getQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
          transactionsQueryKey,
        )?.pages[0] ?? null;

      return mergeWalletTransactionsWithDisplayCache({
        walletAddress,
        network,
        transactions: page,
        fallback,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: WalletTransactionsResponse) => lastPage.cursor ?? undefined,
    enabled,
    staleTime: TRANSACTION_STALE_TIME_MS,
    gcTime: TRANSACTION_GC_TIME_MS,
    // Flatten the page list inside React Query. The output is memoized
    // by structural sharing, so renders that don't see a new transaction
    // skip the `flatMap` allocation and the downstream `useMemo` chains
    // never invalidate.
    select: selectWalletTransactionPages,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      const previousLimit = previousKey?.[4];
      return previousKey?.[2] === network &&
        previousKey?.[3] === walletAddress &&
        typeof previousLimit === 'object' &&
        previousLimit != null &&
        'limit' in previousLimit &&
        previousLimit.limit === limit
        ? previousData
        : undefined;
    },
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnReconnect: true,
  });
  const refetchTransactionsQuery = query.refetch;
  const transactions = query.data?.transactions ?? EMPTY_TRANSACTIONS;
  const pages = query.data?.pages ?? EMPTY_PAGES;
  const firstPage = pages[0] ?? null;
  const displayCachePage = useMemo(() => {
    if (firstPage == null) return null;
    const lastPage = pages[pages.length - 1] ?? firstPage;
    return {
      ...firstPage,
      transactions,
      cursor: lastPage.cursor ?? firstPage.cursor,
      fetchedAt: Math.max(...pages.map((page) => page.fetchedAt)),
    };
  }, [firstPage, pages, transactions]);

  useEffect(() => {
    if (
      !autoFetchAllPages ||
      !enabled ||
      !query.hasNextPage ||
      query.isFetchingNextPage ||
      query.isLoading ||
      query.isRefetching
    ) {
      return;
    }

    void query.fetchNextPage();
  }, [
    autoFetchAllPages,
    enabled,
    pages.length,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.isLoading,
    query.isRefetching,
  ]);

  useEffect(() => {
    if (displayCachePage == null) return;
    void writeWalletDisplayCacheSlice({
      walletAddress: displayCachePage.address,
      network: displayCachePage.network,
      transactions: displayCachePage,
      replaceTransactions: true,
    }).catch(() => undefined);
  }, [displayCachePage]);

  const refetchFresh = useCallback(
    async (options?: { signal?: AbortSignal }): Promise<void> => {
      if (walletAddress == null || network == null || !canRequestTransactions) {
        await refetchTransactionsQuery();
        return;
      }

      if (freshRefetchingRef.current || query.isFetching) {
        return;
      }

      freshRefetchingRef.current = true;
      setFreshRefetching(true);
      try {
        await queryClient.cancelQueries({
          queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
        });

        const fallback =
          queryClient.getQueryData<WalletTransactionsInfiniteData>(transactionsQueryKey)
            ?.pages[0] ?? null;
        const page = await getWalletTransactions(walletAddress, network, {
          limit,
          useCache: false,
          signal: options?.signal,
          requestOwner: `${requestOwner}.fresh`,
        });
        const mergedPage = await mergeWalletTransactionsWithDisplayCache({
          walletAddress,
          network,
          transactions: page,
          fallback,
        });
        const updatedAt = Date.now();
        const transactionsQueryKeyId = JSON.stringify(transactionsQueryKey);
        const queryKeys = [
          transactionsQueryKey,
          offpayWalletTransactionsQueryKey(walletAddress, network, limit, 'cached'),
          offpayWalletTransactionsQueryKey(walletAddress, network, limit, 'network'),
        ];
        const seenKeys = new Set<string>();

        for (const queryKey of queryKeys) {
          const keyId = JSON.stringify(queryKey);
          if (seenKeys.has(keyId)) continue;
          seenKeys.add(keyId);

          const existing = queryClient.getQueryData<WalletTransactionsInfiniteData>(queryKey);
          if (existing == null && keyId !== transactionsQueryKeyId) continue;

          queryClient.setQueryData<WalletTransactionsInfiniteData>(
            queryKey,
            {
              pages: [mergedPage, ...(existing?.pages.slice(1) ?? [])],
              pageParams: existing?.pageParams.length ? existing.pageParams : [undefined],
            },
            { updatedAt },
          );
        }

        await writeWalletDisplayCacheSlice({
          walletAddress: mergedPage.address,
          network: mergedPage.network,
          transactions: mergedPage,
          replaceTransactions: true,
        }).catch(() => undefined);
      } finally {
        freshRefetchingRef.current = false;
        setFreshRefetching(false);
      }
    },
    [
      canRequestTransactions,
      limit,
      network,
      query.isFetching,
      queryClient,
      refetchTransactionsQuery,
      requestOwner,
      transactionsQueryKey,
      walletAddress,
    ],
  );

  const isInitialDataPending =
    enabledByCaller &&
    walletAddress != null &&
    network != null &&
    canUseNetwork &&
    !query.isError &&
    transactions.length === 0 &&
    (capabilitiesQuery.isCapabilitiesPending ||
      dashboardFetching ||
      (transactionsFeatureAvailable &&
        (!interactionsSettled || query.isLoading || query.isFetching || freshRefetching)));

  return {
    ...query,
    isFetching: query.isFetching || freshRefetching,
    isRefetching: query.isRefetching || freshRefetching,
    walletAddress,
    network,
    capability,
    transactions,
    refetchFresh,
    isInitialDataPending,
    isCapabilitiesPending:
      canUseNetwork && (capabilitiesQuery.isCapabilitiesPending || dashboardFetching),
    isCapabilityEnabled: canRequestTransactions,
  };
}

export type UseOffpayWalletTransactionsResult = ReturnType<typeof useOffpayWalletTransactions>;
