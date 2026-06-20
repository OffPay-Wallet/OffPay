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
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
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

type DisplayCacheStatus = 'idle' | 'pending' | 'hit' | 'miss';
type FallbackDeadlineStatus = 'idle' | 'pending' | 'elapsed';

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
  const [displayCacheStatus, setDisplayCacheStatus] = useState<DisplayCacheStatus>('idle');
  const [fallbackDeadlineStatus, setFallbackDeadlineStatus] =
    useState<FallbackDeadlineStatus>('idle');
  const [fallbackGateOpen, setFallbackGateOpen] = useState(false);
  const [idleGateOpen, setIdleGateOpen] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setFallbackDeadlineStatus(canCoordinate ? 'pending' : 'idle');
    setFallbackGateOpen(false);
    setIdleGateOpen(false);

    if (!enabled || walletAddress == null || network == null) {
      return undefined;
    }

    const currentWalletAddress = walletAddress;
    const currentNetwork = network;
    let cancelled = false;
    const startedAt = mark();

    void hydrateWalletDisplayCacheIntoQueryClient({
      queryClient,
      walletAddress: currentWalletAddress,
      network: currentNetwork,
      options: {
        includeBalance: true,
        includeTransactions: true,
        includePendingBackupStats: true,
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

    if (fallbackTimerRef.current != null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    hydrateOffpayWalletDashboard({
      queryClient,
      dashboard,
      limit: WALLET_TRANSACTIONS_PAGE_SIZE,
    });

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
  }, [dashboardQuery.data, queryClient]);

  useEffect(() => {
    if (!canCoordinate || !canUseNetwork || isNetworkAccessSuspended) return;
    if (fallbackGateOpen || dashboardQuery.data != null) return;
    if (fallbackDeadlineStatus !== 'elapsed') return;

    // If the display cache hits, Home already has a coherent first
    // snapshot. Keep waiting for the aggregate dashboard instead of
    // starting direct balance/history fallbacks that will be replaced
    // by the dashboard response moments later.
    if (displayCacheStatus === 'hit' || displayCacheStatus === 'pending') return;

    setFallbackGateOpen(true);
  }, [
    canCoordinate,
    canUseNetwork,
    dashboardQuery.data,
    displayCacheStatus,
    fallbackDeadlineStatus,
    fallbackGateOpen,
    isNetworkAccessSuspended,
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
