import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

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

function buildWarmTokenTransactionsPage(params: {
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

  for (const page of params.pages) {
    if (page.address !== params.walletAddress || page.network !== params.network) continue;
    fetchedAt = Math.max(fetchedAt, page.fetchedAt);

    for (const transaction of page.transactions) {
      if (transactionsBySignature.has(transaction.signature)) continue;
      if (!transactionMatchesMint(transaction, params.mint)) continue;
      transactionsBySignature.set(transaction.signature, transaction);
    }
  }

  const transactions = Array.from(transactionsBySignature.values())
    .sort((left, right) => {
      const timestampDiff = right.timestamp - left.timestamp;
      if (timestampDiff !== 0) return timestampDiff;
      return left.signature.localeCompare(right.signature);
    })
    .slice(0, params.limit);

  if (transactions.length === 0) return undefined;

  const displayTransactions = transactions
    .map((transaction) => transaction.display)
    .filter((view): view is WalletTransactionView => view != null);

  return {
    address: params.walletAddress,
    network: params.network,
    transactions,
    displayTransactions,
    historyGroups: [],
    cursor: null,
    fetchedAt,
  };
}

export function useOffpayWalletTokenTransactions(options: {
  mint: string | null;
  walletAddress?: string | null;
  limit?: number;
  deferUntilAfterInteractions?: boolean;
  refetchOnMount?: boolean | 'always';
  useCache?: boolean;
  enabled?: boolean;
  requestOwner?: string;
}) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = options.walletAddress ?? activeWalletAddress;
  const mint = options.mint?.trim() || null;
  const limit = options.limit ?? 12;
  const deferUntilAfterInteractions = options.deferUntilAfterInteractions ?? false;
  const useCache = options.useCache;
  const enabledByCaller = options.enabled ?? true;
  const requestOwner = options.requestOwner ?? 'wallet.tokenTransactions';
  const [interactionsSettled, setInteractionsSettled] = useState(!deferUntilAfterInteractions);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const queryClient = useQueryClient();
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
  const enabled = canRequestTransactions && enabledByCaller && interactionsSettled;

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

  const getWarmInitialData = useMemo(() => {
    if (walletAddress == null || network == null || mint == null) return undefined;

    const walletHistoryQueries = queryClient.getQueriesData<WalletTransactionsInfiniteData>({
      queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
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
      if (bestPage == null || page.transactions.length > bestPage.transactions.length) {
        bestPage = page;
      }
    }

    return bestPage;
  }, [limit, mint, network, queryClient, walletAddress]);

  const query = useQuery({
    queryKey: transactionsQueryKey,
    queryFn: ({ signal }) => {
      if (walletAddress == null || network == null || mint == null) {
        throw new Error('Token transactions require an active wallet, network, and token mint.');
      }

      return getWalletTokenTransactions(walletAddress, network, mint, {
        limit,
        useCache,
        signal,
        requestOwner,
      });
    },
    enabled,
    staleTime: TOKEN_TRANSACTION_STALE_TIME_MS,
    gcTime: TOKEN_TRANSACTION_GC_TIME_MS,
    initialData: getWarmInitialData,
    initialDataUpdatedAt: () => (getWarmInitialData == null ? undefined : 0),
    placeholderData: getWarmInitialData,
    refetchOnMount: options.refetchOnMount ?? true,
    refetchOnReconnect: true,
    retry: false,
  });

  const transactions = query.data?.transactions ?? EMPTY_TRANSACTIONS;
  const transactionViews = getPageTransactionViews(query.data);
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
        (!interactionsSettled || query.isLoading || query.isFetching)));

  return {
    ...query,
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
