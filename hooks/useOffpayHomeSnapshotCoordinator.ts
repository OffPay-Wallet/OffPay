import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { getWalletDashboard } from '@/lib/api/offpay-api-client';
import {
  hydrateOffpayWalletDashboard,
  WALLET_DASHBOARD_WARM_STALE_TIME_MS,
} from '@/lib/api/offpay-dashboard-cache';
import {
  offpayWalletDashboardQueryKey,
  offpayWalletTransactionsQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
import {
  shouldEnableHomeForegroundFetch,
  shouldOpenHomeSnapshotFallbackGate,
  type HomeDisplayCacheStatus,
  type HomeFallbackDeadlineStatus,
} from '@/lib/api/offpay-home-loading-gates';
import { mark, measure } from '@/lib/perf/perf-marks';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  hydrateWalletDisplayCacheIntoQueryClient,
  persistWalletDisplayCacheFromQueryClient,
} from '@/lib/wallet/wallet-display-cache';

import type { OffpayNetwork, WalletDashboardResponse } from '@/types/offpay-api';

const HOME_SNAPSHOT_FALLBACK_DELAY_MS = 450;
const HOME_SNAPSHOT_IDLE_DELAY_MS = 900;
const HOME_SNAPSHOT_GC_TIME_MS = 1000 * 60 * 30;
const HOME_FIRST_PAINT_FRESH_MAX_SESSION_MS = 30_000;

interface UseOffpayHomeSnapshotCoordinatorParams {
  walletAddress: string | null;
  network: OffpayNetwork | null;
  enabled: boolean;
}

interface DisplayCacheHydrationRequest {
  identity: string;
  promise: Promise<boolean>;
}

export function useOffpayHomeSnapshotCoordinator({
  walletAddress,
  network,
  enabled,
}: UseOffpayHomeSnapshotCoordinatorParams) {
  const queryClient = useQueryClient();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const [displayCacheStatus, setDisplayCacheStatus] = useState<HomeDisplayCacheStatus>('idle');
  const [transactionsCacheStatus, setTransactionsCacheStatus] =
    useState<HomeDisplayCacheStatus>('idle');
  const [fallbackDeadlineStatus, setFallbackDeadlineStatus] =
    useState<HomeFallbackDeadlineStatus>('idle');
  const [fallbackGateOpen, setFallbackGateOpen] = useState(false);
  const [idleGateOpen, setIdleGateOpen] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupMeasureRef = useRef<number | null>(null);
  const startupWallClockRef = useRef<number | null>(null);
  const fallbackFetchMarkKeyRef = useRef<string | null>(null);
  const freshPaintLoggedRef = useRef(false);
  const displayCacheHydrationRef = useRef<DisplayCacheHydrationRequest | null>(null);
  const identity = useMemo(
    () => `${network ?? 'no-network'}:${walletAddress ?? 'no-wallet'}:${enabled ? 'on' : 'off'}`,
    [enabled, network, walletAddress],
  );
  const canCoordinate = enabled && walletAddress != null && network != null;
  const canFetchDashboard = canCoordinate && canUseNetwork && !isNetworkAccessSuspended;

  const dashboardQuery = useQuery<WalletDashboardResponse>({
    queryKey: offpayWalletDashboardQueryKey(
      walletAddress,
      network,
      WALLET_TRANSACTIONS_PAGE_SIZE,
      false,
    ),
    queryFn: ({ signal }) => {
      if (walletAddress == null || network == null) {
        throw new Error('Home wallet snapshot requires an active wallet and supported network.');
      }

      return getWalletDashboard(walletAddress, network, {
        signal,
        limit: WALLET_TRANSACTIONS_PAGE_SIZE,
        useCache: true,
        includeTransactions: false,
        requestOwner: 'home.snapshot.dashboard',
      });
    },
    enabled: canFetchDashboard,
    staleTime: WALLET_DASHBOARD_WARM_STALE_TIME_MS,
    gcTime: HOME_SNAPSHOT_GC_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });

  useEffect(() => {
    if (fallbackTimerRef.current != null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setDisplayCacheStatus(canCoordinate ? 'pending' : 'idle');
    setTransactionsCacheStatus(canCoordinate ? 'pending' : 'idle');
    setFallbackDeadlineStatus(canCoordinate ? 'pending' : 'idle');
    setFallbackGateOpen(false);
    setIdleGateOpen(false);
    fallbackFetchMarkKeyRef.current = null;
    freshPaintLoggedRef.current = false;

    if (!enabled || walletAddress == null || network == null) {
      startupMeasureRef.current = null;
      startupWallClockRef.current = null;
      displayCacheHydrationRef.current = null;
      return undefined;
    }

    const currentWalletAddress = walletAddress;
    const currentNetwork = network;
    let cancelled = false;
    const startedAt = mark();
    startupMeasureRef.current = startedAt;
    startupWallClockRef.current = Date.now();

    const existingHydration =
      displayCacheHydrationRef.current?.identity === identity
        ? displayCacheHydrationRef.current
        : null;
    const hydrationPromise =
      existingHydration?.promise ??
      hydrateWalletDisplayCacheIntoQueryClient({
        queryClient,
        walletAddress: currentWalletAddress,
        network: currentNetwork,
        options: {
          includeBalance: true,
          includeTransactions: true,
          includePendingBackupStats: true,
          measurePrefix: 'home.snapshot.displayCacheHydrate',
          onTransactionsHydrated: (status) => {
            if (!cancelled) setTransactionsCacheStatus(status);
          },
        },
      });
    if (existingHydration == null) {
      displayCacheHydrationRef.current = {
        identity,
        promise: hydrationPromise,
      };
    }

    void hydrationPromise
      .then((hydrated) => {
        if (cancelled) return;
        const hydratedTransactions = queryClient.getQueryData(
          offpayWalletTransactionsQueryKey(
            currentWalletAddress,
            currentNetwork,
            WALLET_TRANSACTIONS_PAGE_SIZE,
            'cached',
          ),
        );
        setTransactionsCacheStatus(hydratedTransactions == null ? 'miss' : 'hit');
        setDisplayCacheStatus(hydrated ? 'hit' : 'miss');
        measure('home.snapshot.displayCacheReady', startedAt, {
          network: currentNetwork,
          result: hydrated ? 'hit' : 'miss',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDisplayCacheStatus('miss');
        setTransactionsCacheStatus('miss');
        measure('home.snapshot.displayCacheReady', startedAt, {
          network: currentNetwork,
          result: 'error',
        });
      });

    if (canFetchDashboard) {
      fallbackTimerRef.current = setTimeout(() => {
        fallbackTimerRef.current = null;
        if (cancelled) return;
        setFallbackDeadlineStatus('elapsed');
        measure('home.snapshot.fallbackDeadline', startedAt, {
          delayMs: HOME_SNAPSHOT_FALLBACK_DELAY_MS,
          network: currentNetwork,
        });
      }, HOME_SNAPSHOT_FALLBACK_DELAY_MS);
    } else {
      setFallbackDeadlineStatus('elapsed');
      setFallbackGateOpen(canUseNetwork && !isNetworkAccessSuspended);
    }

    return () => {
      cancelled = true;
      if (fallbackTimerRef.current != null) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [
    canCoordinate,
    canFetchDashboard,
    canUseNetwork,
    identity,
    isNetworkAccessSuspended,
    network,
    queryClient,
    walletAddress,
  ]);

  useEffect(() => {
    const dashboard = dashboardQuery.data;
    if (dashboard == null) return;
    let cancelled = false;

    if (fallbackTimerRef.current != null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    void (async () => {
      await queryClient.cancelQueries({
        queryKey: offpayWalletTransactionsQueryKey(
          dashboard.address,
          dashboard.network,
          WALLET_TRANSACTIONS_PAGE_SIZE,
          'cached',
        ),
        exact: true,
      });
      if (cancelled) return;

      hydrateOffpayWalletDashboard({
        queryClient,
        dashboard,
        limit: WALLET_TRANSACTIONS_PAGE_SIZE,
      });
      setTransactionsCacheStatus('hit');

      void persistWalletDisplayCacheFromQueryClient({
        queryClient,
        walletAddress: dashboard.address,
        network: dashboard.network,
        options: {
          includeBalance: true,
          includeTransactions: false,
          includePendingBackupStats: false,
        },
      }).catch(() => undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboardQuery.data, queryClient]);

  useEffect(() => {
    if (
      !shouldOpenHomeSnapshotFallbackGate({
        canCoordinate,
        canUseNetwork,
        isNetworkAccessSuspended,
        fallbackGateOpen,
        hasDashboardData: dashboardQuery.data != null,
        dashboardFetching: dashboardQuery.isFetching,
        hasUsableTransactions: transactionsCacheStatus === 'hit',
        displayCacheStatus,
        fallbackDeadlineStatus,
      })
    ) {
      return;
    }

    setFallbackGateOpen(true);
  }, [
    canCoordinate,
    canUseNetwork,
    dashboardQuery.data,
    dashboardQuery.isFetching,
    displayCacheStatus,
    fallbackDeadlineStatus,
    fallbackGateOpen,
    isNetworkAccessSuspended,
    transactionsCacheStatus,
  ]);

  useEffect(() => {
    if (!canCoordinate) return undefined;
    if (!fallbackGateOpen && dashboardQuery.data == null && displayCacheStatus !== 'hit') {
      return undefined;
    }

    const task = scheduleUiWorkAfterFirstPaint(
      () => {
        setIdleGateOpen(true);
      },
      {
        timeoutMs: 2500,
        fallbackDelayMs: HOME_SNAPSHOT_IDLE_DELAY_MS,
      },
    );

    return () => {
      task.cancel();
    };
  }, [canCoordinate, dashboardQuery.data, displayCacheStatus, fallbackGateOpen]);

  useEffect(() => {
    if (!dashboardQuery.isError) return;
    setFallbackGateOpen(true);
  }, [dashboardQuery.isError]);

  const openForegroundFetchGate = useCallback(() => {
    setFallbackGateOpen(true);
  }, []);

  const foregroundFetchEnabled = shouldEnableHomeForegroundFetch({
    canCoordinate,
    canUseNetwork,
    isNetworkAccessSuspended,
    fallbackGateOpen,
    hasDashboardData: dashboardQuery.data != null || displayCacheStatus === 'hit',
  });
  const marketFetchEnabled =
    canCoordinate &&
    canUseNetwork &&
    !isNetworkAccessSuspended &&
    (fallbackGateOpen || dashboardQuery.data != null || displayCacheStatus === 'hit');
  const criticalDataPending =
    canCoordinate &&
    canUseNetwork &&
    !isNetworkAccessSuspended &&
    dashboardQuery.data == null &&
    !fallbackGateOpen &&
    displayCacheStatus !== 'hit';

  useEffect(() => {
    if (!foregroundFetchEnabled) return;
    if (fallbackFetchMarkKeyRef.current === identity) return;
    fallbackFetchMarkKeyRef.current = identity;
    measure('home.snapshot.fallbackFetchStart', startupMeasureRef.current ?? mark(), {
      network,
      result: 'enabled',
    });
  }, [foregroundFetchEnabled, identity, network]);

  // First-meaningful-paint (Phase 0) is now only logged for the live dashboard.
  // Persisted snapshots are intentionally not painted on Home because they can
  // visibly flip stale activity/balances to the fresh response several seconds
  // later on slow provider scans.
  useEffect(() => {
    if (freshPaintLoggedRef.current) return;
    const startedAt = startupMeasureRef.current;
    const startedWallClock = startupWallClockRef.current;
    if (startedAt == null || startedWallClock == null) return;
    if (dashboardQuery.data == null) return;
    if (dashboardQuery.dataUpdatedAt < startedWallClock) return;
    freshPaintLoggedRef.current = true;
    const elapsedMs = mark() - startedAt;
    if (elapsedMs > HOME_FIRST_PAINT_FRESH_MAX_SESSION_MS) {
      measure('home.firstPaint.fresh.discarded', mark(), {
        network,
        elapsedMs: Math.round(elapsedMs),
        reason: 'session_elapsed',
      });
      return;
    }
    measure('home.firstPaint.fresh', startedAt, { network });
  }, [dashboardQuery.data, dashboardQuery.dataUpdatedAt, network]);

  return {
    dashboardQuery,
    foregroundFetchEnabled,
    marketFetchEnabled,
    idleFetchEnabled: canCoordinate && canUseNetwork && !isNetworkAccessSuspended && idleGateOpen,
    criticalDataPending,
    displayCacheStatus,
    openForegroundFetchGate,
  };
}
