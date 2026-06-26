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
  const cachedPaintLoggedRef = useRef(false);
  const freshPaintLoggedRef = useRef(false);
  const identity = useMemo(
    () => `${network ?? 'no-network'}:${walletAddress ?? 'no-wallet'}:${enabled ? 'on' : 'off'}`,
    [enabled, network, walletAddress],
  );
  const canCoordinate = enabled && walletAddress != null && network != null;
  const canFetchDashboard = canCoordinate && canUseNetwork && !isNetworkAccessSuspended;

  const dashboardQuery = useQuery<WalletDashboardResponse>({
    queryKey: offpayWalletDashboardQueryKey(walletAddress, network, WALLET_TRANSACTIONS_PAGE_SIZE),
    queryFn: ({ signal }) => {
      if (walletAddress == null || network == null) {
        throw new Error('Home wallet snapshot requires an active wallet and supported network.');
      }

      return getWalletDashboard(walletAddress, network, {
        signal,
        limit: WALLET_TRANSACTIONS_PAGE_SIZE,
        requestOwner: 'home.snapshot.dashboard',
      });
    },
    enabled: canFetchDashboard,
    staleTime: WALLET_DASHBOARD_WARM_STALE_TIME_MS,
    gcTime: HOME_SNAPSHOT_GC_TIME_MS,
    refetchOnMount: false,
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
    cachedPaintLoggedRef.current = false;
    freshPaintLoggedRef.current = false;

    if (!enabled || walletAddress == null || network == null) {
      startupMeasureRef.current = null;
      startupWallClockRef.current = null;
      return undefined;
    }

    const currentWalletAddress = walletAddress;
    const currentNetwork = network;
    let cancelled = false;
    const startedAt = mark();
    startupMeasureRef.current = startedAt;
    startupWallClockRef.current = Date.now();

    void hydrateWalletDisplayCacheIntoQueryClient({
      queryClient,
      walletAddress: currentWalletAddress,
      network: currentNetwork,
      options: {
        includeBalance: true,
        includeTransactions: true,
        includePendingBackupStats: true,
        measurePrefix: 'home.snapshot.hydrate',
        onTransactionsHydrated: (status) => {
          if (cancelled) return;
          setTransactionsCacheStatus(status);
        },
      },
    })
      .then((hydrated) => {
        if (cancelled) return;
        setDisplayCacheStatus(hydrated ? 'hit' : 'miss');
        measure('home.snapshot.displayCacheHydrate', startedAt, {
          network: currentNetwork,
          result: hydrated ? 'hit' : 'miss',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDisplayCacheStatus('miss');
        setTransactionsCacheStatus('miss');
        measure('home.snapshot.displayCacheHydrate', startedAt, {
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
          includeTransactions: true,
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
        hasUsableTransactions: transactionsCacheStatus === 'hit' || dashboardQuery.data != null,
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

  const foregroundFetchEnabled =
    canCoordinate && canUseNetwork && !isNetworkAccessSuspended && fallbackGateOpen;
  const marketFetchEnabled =
    canCoordinate &&
    canUseNetwork &&
    !isNetworkAccessSuspended &&
    (fallbackGateOpen || dashboardQuery.data != null);
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

  // First-meaningful-paint (Phase 0). These fire on the React commit that
  // first makes usable data available, so the screen can show real content
  // instead of a skeleton — a close proxy for paint, and the metric that
  // matches the "screen keeps loading" complaint. `cached` = persisted/stale
  // rows hydrated; `fresh` = the live dashboard landed. On a cold cache only
  // `fresh` fires. Both measured from coordination start.
  useEffect(() => {
    if (cachedPaintLoggedRef.current) return;
    if (startupMeasureRef.current == null) return;
    if (displayCacheStatus !== 'hit') return;
    cachedPaintLoggedRef.current = true;
    measure('home.firstPaint.cached', startupMeasureRef.current, { network });
  }, [displayCacheStatus, network]);

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
