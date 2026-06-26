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
import { shouldWaitForDashboardData } from '@/lib/api/offpay-home-loading-gates';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  hydrateWalletDisplayCacheIntoQueryClient,
  mergeWalletTransactionsWithDisplayCache,
  writeWalletDisplayCacheSlice,
} from '@/lib/wallet/wallet-display-cache';
import { useWalletStore } from '@/store/walletStore';

import type { InfiniteData } from '@tanstack/react-query';
import type {
  CapabilityStatus,
  WalletTransactionGroup,
  WalletTransactionView,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

// Live updates from the WS activity stream invalidate this cache the
// moment a notification arrives, so a high `staleTime` keeps RPC
// usage low without making the UI go stale. The 2-minute ceiling is
// the recovery floor: if the WS *and* the 60s fallback poll both
// silently stall, focus / reconnect refetches still kick in.
const TRANSACTION_STALE_TIME_MS = 1000 * 60 * 2;
const TRANSACTION_GC_TIME_MS = 1000 * 60 * 30;
// A legitimate cold transactions scan returns in ~5-8s, and the worker now
// self-bounds (6s per-RPC cap + scan budget + graceful partial results), so a
// 25s client wait only ever fires on a dead/stalled socket — e.g. a request
// in flight when the app was backgrounded, which then hung the screen for the
// full 25s on resume. 15s keeps ample headroom for a slow scan while bounding
// that stall.
const TRANSACTION_REQUEST_TIMEOUT_MS = 15_000;

const EMPTY_TRANSACTIONS: WalletTransactionsResponse['transactions'] = [];
const EMPTY_PAGES: WalletTransactionsResponse[] = [];
const EMPTY_TRANSACTION_VIEWS: WalletTransactionView[] = [];
const EMPTY_HISTORY_GROUPS: WalletTransactionGroup[] = [];

type WalletTransactionsInfiniteData = InfiniteData<WalletTransactionsResponse, string | undefined>;

interface WalletTransactionsSelectResult {
  pages: WalletTransactionsResponse[];
  pageParams: (string | undefined)[];
  transactions: WalletTransactionsResponse['transactions'];
  transactionViews: WalletTransactionView[];
  historyGroups: WalletTransactionGroup[];
}

function getPageTransactionViews(page: WalletTransactionsResponse): WalletTransactionView[] {
  if (page.displayTransactions != null && page.displayTransactions.length > 0) {
    return page.displayTransactions;
  }

  return page.transactions
    .map((transaction) => transaction.display)
    .filter((view): view is WalletTransactionView => view != null);
}

function selectWalletTransactionPages(
  data: InfiniteData<WalletTransactionsResponse, string | undefined>,
): WalletTransactionsSelectResult {
  const transactions: WalletTransactionsResponse['transactions'] = [];
  const transactionViews: WalletTransactionView[] = [];
  const groupsByTitle = new Map<string, WalletTransactionView[]>();
  for (const page of data.pages) {
    for (const transaction of page.transactions) transactions.push(transaction);
    for (const view of getPageTransactionViews(page)) transactionViews.push(view);
    for (const group of page.historyGroups ?? []) {
      const groupedViews = groupsByTitle.get(group.title) ?? [];
      groupedViews.push(...group.data);
      groupsByTitle.set(group.title, groupedViews);
    }
  }
  return {
    pages: data.pages,
    pageParams: data.pageParams,
    transactions,
    transactionViews,
    historyGroups: Array.from(groupsByTitle.entries()).map(([title, data]) => ({ title, data })),
  };
}

export function useOffpayWalletTransactions(options?: {
  walletAddress?: string | null;
  limit?: number;
  minWarmTransactionRows?: number;
  deferUntilAfterInteractions?: boolean;
  autoFetchAllPages?: boolean;
  refetchOnMount?: boolean | 'always';
  refetchOnWindowFocus?: boolean | 'always';
  useCache?: boolean;
  enabled?: boolean;
  requestOwner?: string;
  waitForDashboard?: boolean;
  timeoutMs?: number;
  hydrateDisplayCacheOnMount?: boolean;
  allowPartialWarmData?: boolean;
  retry?: false | number;
}) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = options?.walletAddress ?? activeWalletAddress;
  const limit = options?.limit ?? WALLET_TRANSACTIONS_PAGE_SIZE;
  const minWarmTransactionRows = options?.minWarmTransactionRows ?? 0;
  const deferUntilAfterInteractions = options?.deferUntilAfterInteractions ?? false;
  const autoFetchAllPages = options?.autoFetchAllPages ?? false;
  const useCache = options?.useCache;
  const enabledByCaller = options?.enabled ?? true;
  const requestOwner = options?.requestOwner ?? 'wallet.transactions';
  const waitForDashboard = options?.waitForDashboard ?? true;
  const timeoutMs = options?.timeoutMs ?? TRANSACTION_REQUEST_TIMEOUT_MS;
  const hydrateDisplayCacheOnMount = options?.hydrateDisplayCacheOnMount ?? false;
  const allowPartialWarmData = options?.allowPartialWarmData ?? false;
  const [interactionsSettled, setInteractionsSettled] = useState(!deferUntilAfterInteractions);
  const [freshRefetching, setFreshRefetching] = useState(false);
  const [displayCacheHydrationVersion, setDisplayCacheHydrationVersion] = useState(0);
  const freshRefetchingRef = useRef(false);
  const nextPageRequestOwnerSuffixRef = useRef<string | null>(null);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const dashboardFetching =
    useIsFetching({
      queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
    }) > 0;
  const dashboardPending = shouldWaitForDashboardData({ waitForDashboard, dashboardFetching });
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
  const warmTransactionsQueryKey = useMemo(
    () =>
      offpayWalletTransactionsQueryKey(
        walletAddress,
        network,
        WALLET_TRANSACTIONS_PAGE_SIZE,
        'cached',
      ),
    [network, walletAddress],
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
  const canFetchTransactions = canRequestTransactions && enabledByCaller && !dashboardPending;
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

  // Cold-start paint accelerator. Transaction history enrichment can take
  // several seconds on a release build over cellular, so without warm data the
  // screen shows a skeleton the whole time. Pulling the persisted display cache
  // into the query client lets cached rows paint immediately while the first
  // network page loads in the background. Mirrors
  // `useOffpayWalletTokenTransactions`. Best-effort: a miss or read failure
  // just falls back to the network-only path.
  useEffect(() => {
    if (
      !hydrateDisplayCacheOnMount ||
      !enabledByCaller ||
      walletAddress == null ||
      network == null
    ) {
      return undefined;
    }

    let cancelled = false;
    let transactionHydrationNotified = false;
    void hydrateWalletDisplayCacheIntoQueryClient({
      queryClient,
      walletAddress,
      network,
      options: {
        includeBalance: false,
        includeTransactions: true,
        includePendingBackupStats: false,
        onTransactionsHydrated: () => {
          if (cancelled) return;
          transactionHydrationNotified = true;
          setDisplayCacheHydrationVersion((version) => version + 1);
        },
      },
    })
      .catch(() => false)
      .finally(() => {
        if (cancelled || transactionHydrationNotified) return;
        setDisplayCacheHydrationVersion((version) => version + 1);
      });

    return () => {
      cancelled = true;
    };
  }, [enabledByCaller, hydrateDisplayCacheOnMount, network, queryClient, walletAddress]);

  const getWarmInitialTransactionsData = useCallback(():
    | WalletTransactionsInfiniteData
    | undefined => {
    if (limit === WALLET_TRANSACTIONS_PAGE_SIZE || walletAddress == null || network == null) {
      return undefined;
    }

    const warmData =
      queryClient.getQueryData<WalletTransactionsInfiniteData>(warmTransactionsQueryKey);
    if (warmData == null) return undefined;

    const firstPage = warmData?.pages[0];
    if (firstPage?.address !== walletAddress || firstPage.network !== network) {
      return undefined;
    }

    if (!allowPartialWarmData && minWarmTransactionRows > 0) {
      const warmTransactionViews = selectWalletTransactionPages(warmData).transactionViews.length;
      if (warmTransactionViews < minWarmTransactionRows) {
        return undefined;
      }
    }

    return warmData;
  }, [
    displayCacheHydrationVersion,
    allowPartialWarmData,
    limit,
    minWarmTransactionRows,
    network,
    queryClient,
    warmTransactionsQueryKey,
    walletAddress,
  ]);

  const query = useInfiniteQuery({
    queryKey: transactionsQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      if (walletAddress == null || network == null) {
        throw new Error('Wallet transactions require an active wallet and supported network.');
      }

      const pageRequestOwner =
        pageParam == null
          ? `${requestOwner}.initial`
          : `${requestOwner}.${nextPageRequestOwnerSuffixRef.current ?? 'page'}`;
      const page = await getWalletTransactions(walletAddress, network, {
        cursor: pageParam,
        limit,
        useCache,
        signal,
        timeoutMs,
        requestOwner: pageRequestOwner,
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
        : getWarmInitialTransactionsData();
    },
    initialData: getWarmInitialTransactionsData,
    // A shallow warm page is only a paint accelerator for deep history.
    // Mark it stale so React Query starts the full fetch immediately.
    initialDataUpdatedAt: () => (getWarmInitialTransactionsData() == null ? undefined : 0),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
    refetchOnReconnect: true,
    retry: options?.retry,
  });
  const refetchTransactionsQuery = query.refetch;
  const fetchNextPage = useCallback(
    async (
      options?: Parameters<typeof query.fetchNextPage>[0] & {
        requestOwnerSuffix?: string;
      },
    ) => {
      const { requestOwnerSuffix = 'page', ...fetchOptions } = options ?? {};
      const skippedEmptyCursors = new Set<string>();

      try {
        nextPageRequestOwnerSuffixRef.current = requestOwnerSuffix;
        let result = await query.fetchNextPage(fetchOptions);

        while (true) {
          const lastPage = result.data?.pages.at(-1);
          const cursor = lastPage?.cursor?.trim() || null;
          if (lastPage == null || cursor == null || lastPage.transactions.length > 0) {
            return result;
          }

          if (skippedEmptyCursors.has(cursor)) {
            return result;
          }
          skippedEmptyCursors.add(cursor);

          nextPageRequestOwnerSuffixRef.current = `${requestOwnerSuffix}.emptyPage`;
          result = await query.fetchNextPage(fetchOptions);
        }
      } finally {
        nextPageRequestOwnerSuffixRef.current = null;
      }
    },
    [query.fetchNextPage],
  );
  const transactions = query.data?.transactions ?? EMPTY_TRANSACTIONS;
  const transactionViews = query.data?.transactionViews ?? EMPTY_TRANSACTION_VIEWS;
  const historyGroups = query.data?.historyGroups ?? EMPTY_HISTORY_GROUPS;
  const pages = query.data?.pages ?? EMPTY_PAGES;
  const firstPage = pages[0] ?? null;
  const displayCachePage = useMemo(() => {
    if (firstPage == null) return null;
    const lastPage = pages[pages.length - 1] ?? firstPage;
    return {
      ...firstPage,
      transactions,
      displayTransactions: transactionViews,
      historyGroups,
      cursor: lastPage.cursor ?? firstPage.cursor,
      fetchedAt: Math.max(...pages.map((page) => page.fetchedAt)),
    };
  }, [firstPage, historyGroups, pages, transactionViews, transactions]);

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

    void fetchNextPage({ requestOwnerSuffix: 'autoPage' });
  }, [
    autoFetchAllPages,
    enabled,
    pages.length,
    fetchNextPage,
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
    async (options?: { signal?: AbortSignal; useCache?: boolean }): Promise<void> => {
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
        const refreshUseCache = options?.useCache ?? useCache ?? true;
        const page = await getWalletTransactions(walletAddress, network, {
          limit,
          useCache: refreshUseCache,
          signal: options?.signal,
          timeoutMs,
          requestOwner: `${requestOwner}.${refreshUseCache ? 'refresh' : 'fresh'}`,
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
              pages: [mergedPage],
              pageParams: [undefined],
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
      timeoutMs,
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
      dashboardPending ||
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
    transactionViews,
    historyGroups,
    refetchFresh,
    fetchNextPage,
    isInitialDataPending,
    isCapabilitiesPending:
      canUseNetwork && (capabilitiesQuery.isCapabilitiesPending || dashboardPending),
    isCapabilityEnabled: canRequestTransactions,
  };
}

export type UseOffpayWalletTransactionsResult = ReturnType<typeof useOffpayWalletTransactions>;
