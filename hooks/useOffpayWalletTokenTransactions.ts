import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { getWalletTokenTransactions } from '@/lib/api/offpay-api-client';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import { offpayWalletTokenTransactionsQueryKey } from '@/lib/api/offpay-wallet-query-keys';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { useWalletStore } from '@/store/walletStore';

import type { CapabilityStatus, WalletTransactionsResponse } from '@/types/offpay-api';

const TOKEN_TRANSACTION_STALE_TIME_MS = 1000 * 60;
const TOKEN_TRANSACTION_GC_TIME_MS = 1000 * 60 * 15;
const EMPTY_TRANSACTIONS: WalletTransactionsResponse['transactions'] = [];

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
    refetchOnMount: options.refetchOnMount ?? true,
    refetchOnReconnect: true,
  });

  const transactions = query.data?.transactions ?? EMPTY_TRANSACTIONS;
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
    isInitialDataPending,
    isCapabilitiesPending: canUseNetwork && capabilitiesQuery.isCapabilitiesPending,
    isCapabilityEnabled: canRequestTransactions,
  };
}

export type UseOffpayWalletTokenTransactionsResult = ReturnType<
  typeof useOffpayWalletTokenTransactions
>;
