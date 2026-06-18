import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { getWalletDashboard } from '@/lib/api/offpay-api-client';
import { hydrateOffpayWalletDashboard } from '@/lib/api/offpay-dashboard-cache';
import {
  offpayWalletDashboardQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { hydrateWalletDisplayCacheIntoQueryClient } from '@/lib/wallet/wallet-display-cache';
import { useOffpayLaunchStore } from '@/store/offpayLaunchStore';
import { useWalletStore, type WalletAccount } from '@/store/walletStore';

import type { WalletDashboardResponse } from '@/types/offpay-api';

function getActiveWallet(
  wallets: WalletAccount[],
  activeWalletId: string | null,
): WalletAccount | null {
  if (activeWalletId == null) return wallets[0] ?? null;

  return wallets.find((wallet) => wallet.id === activeWalletId) ?? wallets[0] ?? null;
}

function getActiveWalletAddress(
  wallets: WalletAccount[],
  activeWalletId: string | null,
): string | null {
  return getActiveWallet(wallets, activeWalletId)?.publicKey ?? null;
}

export function useOffpayWalletWarmStart(): void {
  const queryClient = useQueryClient();
  const walletAddress = useWalletStore(
    (state) => state.publicKey ?? getActiveWalletAddress(state.wallets, state.activeWalletId),
  );
  const walletId = useWalletStore(
    (state) => getActiveWallet(state.wallets, state.activeWalletId)?.id ?? null,
  );
  const walletHydrated = useWalletStore((state) => state.isHydrated);
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const hydratedKeyRef = useRef<string | null>(null);
  const prefetchedKeyRef = useRef<string | null>(null);
  const scheduledHydrationRef = useRef<ReturnType<typeof scheduleUiWorkAfterFirstPaint> | null>(
    null,
  );
  const scheduledPrefetchRef = useRef<ReturnType<typeof scheduleUiWorkAfterFirstPaint> | null>(
    null,
  );

  useEffect(() => {
    if (!walletHydrated || walletAddress == null || network == null || isNetworkAccessSuspended) {
      return;
    }
    const hydrationKey = `${network}:${walletAddress}`;
    if (hydratedKeyRef.current === hydrationKey) return;
    hydratedKeyRef.current = hydrationKey;

    scheduledHydrationRef.current?.cancel();
    scheduledHydrationRef.current = scheduleUiWorkAfterFirstPaint(
      () => {
        void (async () => {
          try {
            await hydrateWalletDisplayCacheIntoQueryClient({
              queryClient,
              walletAddress,
              network,
              options: {
                includeBalance: true,
              },
            });
            useOffpayLaunchStore.getState().setWalletDisplayHydrated(Date.now());
          } catch {
            // Startup cache hydration is best-effort; online screen hooks still fetch directly.
          }

          if (useOffpayLaunchStore.getState().walletDisplayHydratedAt == null) {
            useOffpayLaunchStore.getState().setWalletDisplayHydrated(Date.now());
          }
        })();
      },
      {
        timeoutMs: 3500,
        // Keep the fallback short so a device without
        // `requestIdleCallback` does not delay cache hydration long
        // after first paint.
        fallbackDelayMs: 150,
      },
    );

    return () => {
      scheduledHydrationRef.current?.cancel();
      scheduledHydrationRef.current = null;
      if (hydratedKeyRef.current === hydrationKey) {
        hydratedKeyRef.current = null;
      }
    };
  }, [
    canUseNetwork,
    isNetworkAccessSuspended,
    network,
    queryClient,
    walletAddress,
    walletHydrated,
  ]);

  useEffect(() => {
    if (!walletHydrated || walletAddress == null || network == null) return;
    if (!canUseNetwork || isNetworkAccessSuspended) return;

    const prefetchKey = `${network}:${walletAddress}:${walletId ?? 'active'}`;
    if (prefetchedKeyRef.current === prefetchKey) return;
    prefetchedKeyRef.current = prefetchKey;

    scheduledPrefetchRef.current?.cancel();
    let cancelled = false;

    scheduledPrefetchRef.current = scheduleUiWorkAfterFirstPaint(
      () => {
        void prefetchWalletDashboardInBackground({
          queryClient,
          walletAddress,
          walletId,
          network,
        }).catch(() => {
          if (!cancelled && prefetchedKeyRef.current === prefetchKey) {
            prefetchedKeyRef.current = null;
          }
        });
      },
      {
        timeoutMs: 1800,
        fallbackDelayMs: 150,
      },
    );

    return () => {
      cancelled = true;
      scheduledPrefetchRef.current?.cancel();
      scheduledPrefetchRef.current = null;
      if (prefetchedKeyRef.current === prefetchKey) {
        prefetchedKeyRef.current = null;
      }
    };
  }, [
    canUseNetwork,
    isNetworkAccessSuspended,
    network,
    queryClient,
    walletAddress,
    walletHydrated,
    walletId,
  ]);
}

async function prefetchWalletDashboardInBackground(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  walletAddress: string;
  walletId: string | null;
  network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;
}): Promise<WalletDashboardResponse | null> {
  if (params.walletAddress.length === 0 || params.walletId == null) return null;

  const cached = params.queryClient.getQueryData<WalletDashboardResponse>(
    offpayWalletDashboardQueryKey(
      params.walletAddress,
      params.network,
      WALLET_TRANSACTIONS_PAGE_SIZE,
    ),
  );
  if (cached?.network === params.network && cached.address === params.walletAddress) {
    hydrateOffpayWalletDashboard({
      queryClient: params.queryClient,
      dashboard: cached,
      limit: WALLET_TRANSACTIONS_PAGE_SIZE,
    });
    return cached;
  }

  try {
    const dashboard = await params.queryClient.fetchQuery({
      queryKey: offpayWalletDashboardQueryKey(
        params.walletAddress,
        params.network,
        WALLET_TRANSACTIONS_PAGE_SIZE,
      ),
      queryFn: ({ signal }) =>
        getWalletDashboard(params.walletAddress, params.network, {
          signal,
          limit: WALLET_TRANSACTIONS_PAGE_SIZE,
        }),
      staleTime: 10 * 1000,
    });
    hydrateOffpayWalletDashboard({
      queryClient: params.queryClient,
      dashboard,
      limit: WALLET_TRANSACTIONS_PAGE_SIZE,
    });
    useOffpayLaunchStore.getState().setPortfolioPreloaded(Date.now());
    return dashboard;
  } catch {
    // Foreground hooks still fetch capabilities, balance, and history directly.
    return null;
  }
}
