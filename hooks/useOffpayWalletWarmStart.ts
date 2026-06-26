import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { prefetchOffpayWalletDashboard } from '@/lib/api/offpay-dashboard-cache';
import {
  offpayWalletDashboardBaseQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  hydrateWalletDisplayCacheIntoQueryClient,
  persistWalletDisplayCacheFromQueryClient,
} from '@/lib/wallet/wallet-display-cache';
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
                includeTransactions: false,
                includePendingBackupStats: true,
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

    let cancelled = false;

    scheduledPrefetchRef.current?.cancel();
    scheduledPrefetchRef.current = scheduleUiWorkAfterFirstPaint(
      () => {
        void (async () => {
          const dashboard = await prefetchWalletDashboardInBackground({
            queryClient,
            walletAddress,
            network,
          });

          if (dashboard == null && !cancelled && prefetchedKeyRef.current === prefetchKey) {
            prefetchedKeyRef.current = null;
          }
        })().catch(() => {
          if (!cancelled && prefetchedKeyRef.current === prefetchKey) {
            prefetchedKeyRef.current = null;
          }
        });
      },
      {
        timeoutMs: 5000,
        fallbackDelayMs: 220,
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
  network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;
}): Promise<WalletDashboardResponse | null> {
  if (params.walletAddress.length === 0) return null;
  if (
    params.queryClient.isFetching({
      queryKey: offpayWalletDashboardBaseQueryKey(params.walletAddress, params.network),
    }) > 0
  ) {
    return null;
  }

  const dashboard = await prefetchOffpayWalletDashboard({
    queryClient: params.queryClient,
    walletAddress: params.walletAddress,
    network: params.network,
    limit: WALLET_TRANSACTIONS_PAGE_SIZE,
    useCache: false,
    requestOwner: 'wallet.warmStart.dashboard',
  });

  if (dashboard != null) {
    useOffpayLaunchStore.getState().setPortfolioPreloaded(Date.now());
    await persistWalletDisplayCacheFromQueryClient({
      queryClient: params.queryClient,
      walletAddress: params.walletAddress,
      network: params.network,
      options: {
        includeBalance: true,
        includeTransactions: false,
        includePendingBackupStats: false,
      },
    });
  }

  // Foreground hooks subscribe to the dashboard-hydrated query cache and
  // only fall back to direct reads when the Home coordinator opens that gate.
  return dashboard;
}
