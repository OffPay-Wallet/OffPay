import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { offpayCapabilitiesQueryKey } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { getCapabilities } from '@/lib/api/offpay-api-client';
import {
  buildUnavailableCapabilities,
  CAPABILITIES_FAST_TIMEOUT_MS,
  CAPABILITIES_STALE_TIME_MS,
} from '@/lib/api/offpay-capability-fallback';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  hydrateWalletDisplayCacheIntoQueryClient,
  prefetchWalletDisplayData,
} from '@/lib/wallet/wallet-display-cache';
import { useOffpayLaunchStore } from '@/store/offpayLaunchStore';
import { useWalletStore, type WalletAccount } from '@/store/walletStore';

import type { CapabilitiesResponse } from '@/types/offpay-api';

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
  }, [canUseNetwork, isNetworkAccessSuspended, network, queryClient, walletAddress, walletHydrated]);

  useEffect(() => {
    if (!walletHydrated || walletAddress == null || network == null) return;
    if (!canUseNetwork || isNetworkAccessSuspended) return;

    const prefetchKey = `${network}:${walletAddress}:${walletId ?? 'active'}`;
    if (prefetchedKeyRef.current === prefetchKey) return;
    prefetchedKeyRef.current = prefetchKey;

    scheduledPrefetchRef.current?.cancel();
    let cancelled = false;

    void prefetchCapabilitiesInBackground({
      queryClient,
      walletAddress,
      walletId,
      network,
    })
      .then((capabilitiesResponse) => {
        if (cancelled || capabilitiesResponse == null) return;

        scheduledPrefetchRef.current = scheduleUiWorkAfterFirstPaint(
          () => {
            void prefetchWalletDisplayInBackground({
              queryClient,
              walletAddress,
              network,
              capabilities: capabilitiesResponse.capabilities,
            });
          },
          {
            timeoutMs: 1800,
            fallbackDelayMs: 150,
          },
        );
      })
      .catch(() => {
        if (!cancelled && prefetchedKeyRef.current === prefetchKey) {
          prefetchedKeyRef.current = null;
        }
      });

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

async function prefetchCapabilitiesInBackground(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  walletAddress: string;
  walletId: string | null;
  network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;
}): Promise<CapabilitiesResponse | null> {
  if (params.walletAddress.length === 0 || params.walletId == null) return null;

  const cached = params.queryClient.getQueryData<CapabilitiesResponse>(
    offpayCapabilitiesQueryKey(params.network),
  );
  if (cached?.network === params.network) return cached;

  try {
    return await params.queryClient.fetchQuery({
      queryKey: offpayCapabilitiesQueryKey(params.network),
      queryFn: ({ signal }) =>
        getCapabilities(params.network, {
          signal,
          timeoutMs: CAPABILITIES_FAST_TIMEOUT_MS,
        }),
      staleTime: CAPABILITIES_STALE_TIME_MS,
    });
  } catch {
    return buildUnavailableCapabilities(
      params.network,
      'OffPay API capabilities were unavailable during wallet warm start.',
    );
  }
}

async function prefetchWalletDisplayInBackground(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  walletAddress: string;
  network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;
  capabilities: CapabilitiesResponse['capabilities'];
}): Promise<void> {
  try {
    await prefetchWalletDisplayData({
      queryClient: params.queryClient,
      walletAddress: params.walletAddress,
      network: params.network,
      canFetchBalance: isOffpayFeatureAvailable(params.capabilities, 'wallet.balance'),
      canFetchTransactions: isOffpayFeatureAvailable(params.capabilities, 'wallet.transactions'),
      forceRefresh: false,
    });
    useOffpayLaunchStore.getState().setPortfolioPreloaded(Date.now());
  } catch {
    // The foreground queries keep their own retry/error handling.
  }
}
