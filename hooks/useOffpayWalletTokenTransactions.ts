import { useInfiniteQuery, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { getWalletTokenTransactions } from '@/lib/api/offpay-api-client';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  offpayWalletTokenTransactionsQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { useWalletStore } from '@/store/walletStore';

import type { InfiniteData } from '@tanstack/react-query';
import type {
  CapabilityStatus,
  WalletTransactionGroup,
  WalletTransactionView,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

const TOKEN_TRANSACTION_STALE_TIME_MS = 1000 * 60;
const TOKEN_TRANSACTION_GC_TIME_MS = 1000 * 60 * 15;
const TOKEN_HISTORY_FETCH_WAIT_MS = 6500;
// The token-history backfill is a background enrichment — the screen has
// already painted from cache/warm data by the time it runs. On a single RPC
// provider a native-SOL deep scan legitimately needs several seconds, so this
// gives it room to actually fetch (the worker degrades to partial results
// rather than hanging). Far below the old 25s that produced no data.
const TOKEN_TRANSACTION_REQUEST_TIMEOUT_MS = 14_000;
const EMPTY_TRANSACTIONS: WalletTransactionsResponse['transactions'] = [];
const EMPTY_TRANSACTION_VIEWS: WalletTransactionView[] = [];
const EMPTY_HISTORY_GROUPS: WalletTransactionGroup[] = [];
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

type WalletTransactionsInfiniteData = InfiniteData<WalletTransactionsResponse, string | undefined>;

function getPageTransactionViews(
  page: WalletTransactionsResponse | undefined,
): WalletTransactionView[] {
  if (page == null) return EMPTY_TRANSACTION_VIEWS;
  if (page.displayTransactions != null && page.displayTransactions.length > 0) {
    return page.displayTransactions;
  }

  return page.transactions
    .map((transaction) => transaction.display)
    .filter((view): view is WalletTransactionView => view != null);
}

interface TokenTransactionsSelectResult {
  pages: WalletTransactionsResponse[];
  transactions: WalletTransactionsResponse['transactions'];
  transactionViews: WalletTransactionView[];
  historyGroups: WalletTransactionGroup[];
}

// Flatten the cursor-paginated pages into a single list (mirrors
// selectWalletTransactionPages). React Query memoizes the output via structural
// sharing, so renders that don't add a page skip the work.
function selectTokenTransactionPages(
  data: WalletTransactionsInfiniteData,
): TokenTransactionsSelectResult {
  const transactions: WalletTransactionsResponse['transactions'] = [];
  const transactionViews: WalletTransactionView[] = [];
  const groupsByTitle = new Map<string, WalletTransactionView[]>();
  for (const page of data.pages) {
    for (const transaction of page.transactions) transactions.push(transaction);
    for (const view of getPageTransactionViews(page)) transactionViews.push(view);
    for (const group of page.historyGroups ?? []) {
      const grouped = groupsByTitle.get(group.title) ?? [];
      grouped.push(...group.data);
      groupsByTitle.set(group.title, grouped);
    }
  }
  return {
    pages: data.pages,
    transactions,
    transactionViews,
    historyGroups: Array.from(groupsByTitle.entries()).map(([title, data]) => ({ title, data })),
  };
}

function isNativeSolMint(value: string | null | undefined): boolean {
  return value === NATIVE_SOL_MINT || value === 'native-sol' || value === 'SOL';
}

function transactionMatchesMint(
  transaction: WalletTransactionsResponse['transactions'][number],
  mint: string,
): boolean {
  if (isNativeSolMint(mint)) {
    return (
      isNativeSolMint(transaction.tokenMint) ||
      transaction.tokenSymbol?.trim().toUpperCase() === 'SOL' ||
      isNativeSolMint(transaction.display?.tokenMint)
    );
  }

  return transaction.tokenMint === mint || transaction.display?.tokenMint === mint;
}

export function buildWarmTokenTransactionsPage(params: {
  walletAddress: string;
  network: WalletTransactionsResponse['network'];
  mint: string;
  limit: number;
  pages: readonly WalletTransactionsResponse[];
}): WalletTransactionsResponse | undefined {
  const transactionsBySignature = new Map<
    string,
    WalletTransactionsResponse['transactions'][number]
  >();
  let fetchedAt = 0;
  let sourceCursor: string | null = null;

  for (const page of params.pages) {
    if (page.address !== params.walletAddress || page.network !== params.network) continue;
    fetchedAt = Math.max(fetchedAt, page.fetchedAt);
    sourceCursor = page.cursor;

    for (const transaction of page.transactions) {
      if (transactionsBySignature.has(transaction.signature)) continue;
      if (!transactionMatchesMint(transaction, params.mint)) continue;
      transactionsBySignature.set(transaction.signature, transaction);
    }
  }

  const matchedTransactions = Array.from(transactionsBySignature.values()).sort((left, right) => {
    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.signature.localeCompare(right.signature);
  });
  const transactions = matchedTransactions.slice(0, params.limit);

  if (transactions.length === 0) return undefined;

  const displayTransactions = transactions
    .map((transaction) => transaction.display)
    .filter((view): view is WalletTransactionView => view != null);
  const lastIncludedTransaction = transactions.at(-1);
  const cursor =
    matchedTransactions.length > params.limit
      ? (lastIncludedTransaction?.signature ?? null)
      : (sourceCursor ?? null);

  return {
    address: params.walletAddress,
    network: params.network,
    transactions,
    displayTransactions,
    historyGroups: [],
    cursor,
    fetchedAt,
  };
}

export function useOffpayWalletTokenTransactions(options: {
  mint: string | null;
  walletAddress?: string | null;
  limit?: number;
  minWarmTransactionRows?: number;
  deferUntilAfterInteractions?: boolean;
  refetchOnMount?: boolean | 'always';
  refetchOnWindowFocus?: boolean | 'always';
  useCache?: boolean;
  enabled?: boolean;
  requestOwner?: string;
  timeoutMs?: number;
  allowPartialWarmData?: boolean;
  waitForWalletHistory?: boolean;
}) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = options.walletAddress ?? activeWalletAddress;
  const mint = options.mint?.trim() || null;
  const limit = options.limit ?? 12;
  const minWarmTransactionRows = options.minWarmTransactionRows ?? 0;
  const deferUntilAfterInteractions = options.deferUntilAfterInteractions ?? false;
  const useCache = options.useCache;
  const enabledByCaller = options.enabled ?? true;
  const requestOwner = options.requestOwner ?? 'wallet.tokenTransactions';
  const timeoutMs = options.timeoutMs ?? TOKEN_TRANSACTION_REQUEST_TIMEOUT_MS;
  const allowPartialWarmData = options.allowPartialWarmData ?? false;
  const waitForWalletHistory = options.waitForWalletHistory ?? true;
  const [interactionsSettled, setInteractionsSettled] = useState(!deferUntilAfterInteractions);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const queryClient = useQueryClient();
  const walletHistoryBaseQueryKey = useMemo(
    () => offpayWalletTransactionsBaseQueryKey(walletAddress, network),
    [network, walletAddress],
  );
  const walletHistoryFetching = useIsFetching({ queryKey: walletHistoryBaseQueryKey }) > 0;
  const [walletHistoryWaitExpired, setWalletHistoryWaitExpired] = useState(false);
  const nextPageRequestOwnerSuffixRef = useRef<string | null>(null);
  const capabilitiesQuery = useOffpayCapabilities({
    enabled: enabledByCaller,
    requestOwner: `${requestOwner}.capabilities`,
  });
  const { capabilities } = capabilitiesQuery;
  const transactionsQueryKey = useMemo(
    () =>
      offpayWalletTokenTransactionsQueryKey(
        walletAddress,
        network,
        mint,
        limit,
        useCache === false ? 'network' : 'cached',
      ),
    [limit, mint, network, useCache, walletAddress],
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
    walletAddress != null &&
    network != null &&
    mint != null &&
    canUseNetwork &&
    transactionsFeatureAvailable;

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
  }, [deferUntilAfterInteractions, enabledByCaller, limit, mint, network, walletAddress]);

  useEffect(() => {
    setWalletHistoryWaitExpired(false);

    if (
      !enabledByCaller ||
      walletAddress == null ||
      network == null ||
      mint == null ||
      !waitForWalletHistory ||
      !walletHistoryFetching
    ) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      setWalletHistoryWaitExpired(true);
    }, TOKEN_HISTORY_FETCH_WAIT_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [enabledByCaller, mint, network, waitForWalletHistory, walletAddress, walletHistoryFetching]);

  const warmInitialData = useMemo<WalletTransactionsInfiniteData | undefined>(() => {
    if (useCache === false) return undefined;
    if (walletAddress == null || network == null || mint == null) return undefined;

    const walletHistoryQueries = queryClient.getQueriesData<WalletTransactionsInfiniteData>({
      queryKey: walletHistoryBaseQueryKey,
    });
    let bestPage: WalletTransactionsResponse | undefined;

    for (const [, data] of walletHistoryQueries) {
      if (data == null || data.pages.length === 0) continue;
      const page = buildWarmTokenTransactionsPage({
        walletAddress,
        network,
        mint,
        limit,
        pages: data.pages,
      });

      if (page == null) continue;
      if (!allowPartialWarmData && page.transactions.length < minWarmTransactionRows) continue;
      if (bestPage == null || page.transactions.length > bestPage.transactions.length) {
        bestPage = page;
      }
    }

    return bestPage == null ? undefined : { pages: [bestPage], pageParams: [undefined] };
  }, [
    allowPartialWarmData,
    limit,
    minWarmTransactionRows,
    mint,
    network,
    queryClient,
    useCache,
    walletAddress,
    walletHistoryBaseQueryKey,
  ]);

  const shouldWaitForWalletHistory =
    waitForWalletHistory && walletHistoryFetching && !walletHistoryWaitExpired;
  const enabled =
    canRequestTransactions &&
    enabledByCaller &&
    interactionsSettled &&
    !shouldWaitForWalletHistory;

  useEffect(() => {
    if (warmInitialData == null) return;

    const existing = queryClient.getQueryData<WalletTransactionsInfiniteData>(transactionsQueryKey);
    const existingCount =
      existing?.pages.reduce((sum, page) => sum + page.transactions.length, 0) ?? 0;
    const warmCount = warmInitialData.pages[0]?.transactions.length ?? 0;
    if (existing != null && existingCount >= warmCount) {
      return;
    }

    queryClient.setQueryData(transactionsQueryKey, warmInitialData, { updatedAt: 0 });
  }, [queryClient, transactionsQueryKey, warmInitialData]);

  const query = useInfiniteQuery({
    queryKey: transactionsQueryKey,
    queryFn: ({ pageParam, signal }) => {
      if (walletAddress == null || network == null || mint == null) {
        throw new Error('Token transactions require an active wallet, network, and token mint.');
      }

      const pageRequestOwner =
        pageParam == null
          ? `${requestOwner}.initial`
          : `${requestOwner}.${nextPageRequestOwnerSuffixRef.current ?? 'page'}`;
      return getWalletTokenTransactions(walletAddress, network, mint, {
        cursor: pageParam ?? undefined,
        limit,
        useCache,
        signal,
        timeoutMs,
        requestOwner: pageRequestOwner,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: WalletTransactionsResponse) => lastPage.cursor ?? undefined,
    enabled,
    staleTime: TOKEN_TRANSACTION_STALE_TIME_MS,
    gcTime: TOKEN_TRANSACTION_GC_TIME_MS,
    select: selectTokenTransactionPages,
    initialData: warmInitialData,
    initialDataUpdatedAt: () => (warmInitialData == null ? undefined : 0),
    placeholderData: warmInitialData,
    refetchOnMount: options.refetchOnMount ?? true,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    refetchOnReconnect: true,
    retry: false,
  });

  const transactions = query.data?.transactions ?? EMPTY_TRANSACTIONS;
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
  const transactionViews = query.data?.transactionViews ?? EMPTY_TRANSACTION_VIEWS;
  const historyGroups = query.data?.historyGroups ?? EMPTY_HISTORY_GROUPS;
  const isInitialDataPending =
    enabledByCaller &&
    walletAddress != null &&
    network != null &&
    mint != null &&
    canUseNetwork &&
    !query.isError &&
    transactions.length === 0 &&
    (capabilitiesQuery.isCapabilitiesPending ||
      (transactionsFeatureAvailable &&
        (!interactionsSettled ||
          shouldWaitForWalletHistory ||
          query.isLoading ||
          query.isFetching)));

  return {
    ...query,
    fetchNextPage,
    walletAddress,
    network,
    capability,
    transactions,
    transactionViews,
    historyGroups,
    isInitialDataPending,
    isCapabilitiesPending: canUseNetwork && capabilitiesQuery.isCapabilitiesPending,
    isCapabilityEnabled: canRequestTransactions,
  };
}

export type UseOffpayWalletTokenTransactionsResult = ReturnType<
  typeof useOffpayWalletTokenTransactions
>;
