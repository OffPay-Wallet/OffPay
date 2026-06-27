/**
 * Home screen — wallet dashboard.
 *
 * Composes extracted feature components:
 *   - HomeHeader — greeting + notification bell
 *   - BalanceCard — balance display + quick actions
 *   - TokenHoldingsCard — gradient token holdings card
 *   - RecentActivityCard — gradient transaction history card
 *
 * Uses OffPay backend wallet and activity surfaces.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useQueryClient } from '@tanstack/react-query';

import { BalanceCard } from '@/components/features/home/BalanceCard';
import {
  HomeBalanceModeDivider,
  type HomeBalanceMode,
} from '@/components/features/home/HomeBalanceModeDivider';
import { HomeHeader } from '@/components/features/home/HomeHeader';
import { OfflineSlotsPromptModal } from '@/components/features/home/OfflineSlotsPromptModal';
import { RecentActivityCard } from '@/components/features/home/RecentActivityCard';
import { TokenHoldingsCard } from '@/components/features/home/TokenHoldingsCard';
import { TransactionDetailsSheet } from '@/components/features/history/TransactionDetailsSheet';
import { UmbraVaultContent } from '@/components/features/umbra-vault/umbra-vault-screen';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { colors } from '@/constants/colors';
import { OFFLINE_PAYMENT_SLOT_DEFAULT } from '@/constants/offline-payment-slots';
import { layout, spacing } from '@/constants/spacing';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { usePendingBackupQueueStats } from '@/hooks/usePendingBackupQueueStats';
import {
  fetchOffpaySwapTokensForLogos,
  offpaySwapTokensQueryKey,
  TOKEN_LOGO_CACHE_GC_MS,
  TOKEN_LOGO_CACHE_STALE_MS,
  useOffpayTokenLogoMap,
} from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayPortfolioValuation } from '@/hooks/useOffpayPortfolioValuation';
import { useOffpayHomeSnapshotCoordinator } from '@/hooks/useOffpayHomeSnapshotCoordinator';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOfflinePaymentSlots } from '@/hooks/useOfflinePaymentSlots';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import { formatFiatCurrency } from '@/lib/currency-rates';
import { formatLamportsAsExactSol } from '@/lib/crypto/solana-amounts';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { getViewportProfile } from '@/lib/ui/responsive-layout';
import { mark, measure } from '@/lib/perf/perf-marks';
import { hydrateWalletDisplayCacheIntoQueryClient } from '@/lib/wallet/wallet-display-cache';
import {
  buildStablecoinMetadataLookup,
  buildWalletRecentActivityItems,
  buildVisibleTokenHoldings,
  countSpamTokens,
} from '@/lib/api/offpay-wallet-data';
import { buildLocalHistoryReceiptInputs } from '@/lib/api/offpay-local-history-receipts';
import { buildTokenDetailsRouteParams } from '@/lib/navigation/token-details-params';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  WALLET_DEEP_HISTORY_PAGE_SIZE,
  pendingBackupQueueStatsQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
import { useSettlementEngineStore } from '@/store/settlementEngineStore';
import { useWalletStore } from '@/store/walletStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useAdvancedSwapStore } from '@/store/advancedSwapStore';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';
import type { TokenValuationView } from '@/hooks/useOffpayTokenValuations';
import type { OffpayRecentActivityView } from '@/lib/api/offpay-wallet-data';
import type { ScheduledUiWork } from '@/lib/perf/ui-work-scheduler';
import type { WalletMode } from '@/store/preferencesStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HOME_ACTIVITY_ITEMS = 4;
const MAX_HOME_HOLDINGS_ITEMS = 3;
const EMPTY_DISABLED_ACTION_IDS: readonly string[] = [];
const OFFLINE_DISABLED_ACTION_IDS: readonly string[] = ['swap'];
const HOME_REFRESH_SPINNER_MIN_MS = 360;
const EMPTY_TOKEN_VALUATIONS: Readonly<Record<string, TokenValuationView>> = {};

interface HomeBalanceModeState {
  scopeKey: string;
  mode: HomeBalanceMode;
  shieldedPaneMounted: boolean;
}

function getQueryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function runAfterTapFrame(task: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(task, 0);
  });
}

function countOfflineSetupPendingSlots(
  counts: { preparing: number; settling: number } | null | undefined,
): number {
  return (counts?.preparing ?? 0) + (counts?.settling ?? 0);
}

function buildOfflineSlotsLabel(params: {
  readySlots: number;
  pendingSlots: number;
  targetSlots: number;
  snapshotLoaded: boolean;
  preparePending: boolean;
}): string {
  if (params.preparePending) {
    return 'Preparing slots';
  }

  if (params.pendingSlots > 0) {
    return `${Math.min(params.pendingSlots, params.targetSlots)}/${params.targetSlots} pending`;
  }

  if (params.readySlots > 0) {
    return `${params.readySlots}/${params.targetSlots} slots`;
  }

  return params.snapshotLoaded ? 'Setup needed' : 'Checking slots';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const router = useRouter();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const publicKey = useWalletStore((s) => s.publicKey);
  const currency = usePreferencesStore((s) => s.currency);
  const setCurrency = usePreferencesStore((s) => s.setCurrency);
  const setOfflinePaymentsEnabled = usePreferencesStore((s) => s.setOfflinePaymentsEnabled);
  const setOfflinePaymentPoolSize = usePreferencesStore((s) => s.setOfflinePaymentPoolSize);
  const offlinePaymentPoolSize = usePreferencesStore((s) => s.offlinePaymentPoolSize);
  const offlineReceipts = useOfflinePaymentStore((s) => s.receipts);
  const privatePaymentReceipts = usePrivatePaymentStore((s) => s.receipts);
  const swapReceipts = useAdvancedSwapStore((s) => s.receipts);
  const { network } = useOffpayNetwork();
  const homeBalanceModeScopeKey = `${network ?? 'no-network'}:${publicKey ?? 'no-wallet'}`;
  const getScreenSignal = useScreenAbortSignal();
  const [privacyHidden, setPrivacyHidden] = useState(false);
  const [homeBalanceModeState, setHomeBalanceModeState] = useState<HomeBalanceModeState>(() => ({
    scopeKey: homeBalanceModeScopeKey,
    mode: 'default',
    shieldedPaneMounted: false,
  }));
  const [slotPromptVisible, setSlotPromptVisible] = useState(false);
  const [homeRefreshPending, setHomeRefreshPending] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<OffpayRecentActivityView | null>(
    null,
  );
  const slotPromptAutoShownRef = useRef<string | null>(null);
  const slotPrepareShouldEnterOfflineRef = useRef(false);
  const previousSlotStatusRef = useRef<{
    key: string | null;
    readySlots: number;
    pendingSlots: number;
  } | null>(null);
  const homeRefreshInFlightRef = useRef(false);
  const walletModeCommitRef = useRef<ScheduledUiWork | null>(null);
  const {
    effectiveWalletMode,
    canUseNetwork,
    isOnlineReachable,
    isNetworkSwitching,
    setPreferredWalletMode,
  } = useOffpayNetworkAccess();
  const homeBalanceMode =
    homeBalanceModeState.scopeKey === homeBalanceModeScopeKey
      ? homeBalanceModeState.mode
      : 'default';
  const shieldedPaneMounted =
    homeBalanceModeState.scopeKey === homeBalanceModeScopeKey
      ? homeBalanceModeState.shieldedPaneMounted
      : false;
  const shieldedLogoCatalogNeeded = homeBalanceMode === 'shielded' || shieldedPaneMounted;
  const homeDataReady = publicKey != null && network != null;
  const isOffline = effectiveWalletMode === 'offline';
  const promptRentEstimateTargetSlotCount = slotPromptVisible
    ? Math.max(offlinePaymentPoolSize, OFFLINE_PAYMENT_SLOT_DEFAULT)
    : undefined;
  const homeSnapshot = useOffpayHomeSnapshotCoordinator({
    walletAddress: publicKey,
    network,
    enabled: homeDataReady,
  });
  const openHomeForegroundFetchGate = homeSnapshot.openForegroundFetchGate;
  const capabilitiesQuery = useOffpayCapabilities({
    enabled: homeDataReady && homeSnapshot.foregroundFetchEnabled,
    requestOwner: 'home.capabilities.fallback',
  });
  const balanceQuery = useOffpayWalletBalance(null, {
    enabled: homeDataReady && homeSnapshot.foregroundFetchEnabled,
    // Home reads dashboard/cache data first. Direct balance fetches
    // are only a fallback after the snapshot coordinator opens the
    // foreground gate.
    eagerWithoutCapabilities: true,
    requestOwner: 'home.balance.fallback',
    waitForDashboard: false,
  });
  const offlinePaymentSlots = useOfflinePaymentSlots({
    enabled: homeDataReady,
    targetSlotCount: promptRentEstimateTargetSlotCount,
    statusEnabled: homeDataReady,
    rentEstimateEnabled: slotPromptVisible && homeDataReady,
  });
  const transactionsQuery = useOffpayWalletTransactions({
    enabled: homeDataReady && isFocused && homeSnapshot.foregroundFetchEnabled,
    eagerWithoutCapabilities: true,
    deferUntilAfterInteractions: true,
    limit: WALLET_DEEP_HISTORY_PAGE_SIZE,
    waitForDashboard: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    requestOwner: 'home.transactions.history',
    serverCacheOnly: true,
    useCache: true,
  });
  const pendingBackupStatsQuery = usePendingBackupQueueStats({
    walletAddress: publicKey,
    enabled: homeDataReady,
  });
  const tokenLogoMap = useOffpayTokenLogoMap({
    allowPendingCapabilities: shieldedLogoCatalogNeeded,
    enabled: homeDataReady,
    balanceData: balanceQuery.data,
    capabilities: capabilitiesQuery.capabilities,
    fetchSwapTokenCatalog: homeSnapshot.idleFetchEnabled || shieldedLogoCatalogNeeded,
  });
  const settlementStatus = useSettlementEngineStore((state) => state.status);
  const settlementError = useSettlementEngineStore((state) => state.error);
  const tokenMetadata = useMemo(
    () =>
      buildStablecoinMetadataLookup(capabilitiesQuery.capabilities?.offline?.supportedStablecoins),
    [capabilitiesQuery.capabilities?.offline?.supportedStablecoins],
  );

  const allVisibleHoldings = useMemo(() => {
    return balanceQuery.data == null
      ? []
      : buildVisibleTokenHoldings(balanceQuery.data, tokenLogoMap, tokenMetadata);
  }, [balanceQuery.data, tokenLogoMap, tokenMetadata]);
  const previewHoldings = useMemo(
    () => allVisibleHoldings.slice(0, MAX_HOME_HOLDINGS_ITEMS),
    [allVisibleHoldings],
  );
  const portfolioValuationQuery = useOffpayPortfolioValuation({
    holdings: allVisibleHoldings,
    currency,
    enabled: homeDataReady,
    networkFetchEnabled: homeSnapshot.marketFetchEnabled,
  });
  const hasPositiveHoldings = allVisibleHoldings.some((holding) => holding.balanceValue > 0);
  const portfolioValuationData = portfolioValuationQuery.data;
  const portfolioValuationComplete =
    portfolioValuationData != null &&
    portfolioValuationData.expectedCount > 0 &&
    portfolioValuationData.pricedCount >= portfolioValuationData.expectedCount;
  const portfolioValuationSettled =
    portfolioValuationQuery.isFetched || portfolioValuationQuery.isError || !hasPositiveHoldings;
  const portfolioValuationDisplayReady =
    !hasPositiveHoldings || portfolioValuationComplete || portfolioValuationSettled;
  const valuationValuesLoading =
    previewHoldings.length > 0 && hasPositiveHoldings && !portfolioValuationDisplayReady;
  const tokenValuations = portfolioValuationDisplayReady
    ? (portfolioValuationData?.tokenValues ?? EMPTY_TOKEN_VALUATIONS)
    : EMPTY_TOKEN_VALUATIONS;
  const recentActivity = useMemo(() => {
    const localReceiptsForNetwork = buildLocalHistoryReceiptInputs({
      network,
      walletAddress: publicKey,
      offlineReceipts,
      privatePaymentReceipts,
      swapReceipts,
    });

    return buildWalletRecentActivityItems({
      transactions: transactionsQuery.transactions,
      transactionViews: transactionsQuery.transactionViews,
      includeUnmatchedLocalReceipts: transactionsQuery.isFetched && !transactionsQuery.isError,
      localReceipts: localReceiptsForNetwork,
      network,
    }).slice(0, MAX_HOME_ACTIVITY_ITEMS);
  }, [
    network,
    offlineReceipts,
    privatePaymentReceipts,
    publicKey,
    swapReceipts,
    transactionsQuery.isError,
    transactionsQuery.isFetched,
    transactionsQuery.transactionViews,
    transactionsQuery.transactions,
  ]);
  const portfolioValueLabel =
    portfolioValuationDisplayReady && portfolioValuationData != null
      ? formatFiatCurrency(portfolioValuationData.total, portfolioValuationData.currency)
      : balanceQuery.data != null && !hasPositiveHoldings
        ? formatFiatCurrency(0, currency)
        : undefined;
  const networkLabel = network === 'mainnet' ? 'Mainnet' : network === 'devnet' ? 'Devnet' : null;
  const offlineSlotCounts = offlinePaymentSlots.snapshot?.counts ?? null;
  const offlineReadySlots = offlineSlotCounts?.ready ?? 0;
  const offlineSetupPendingSlots = countOfflineSetupPendingSlots(offlineSlotCounts);
  const offlinePreparePending = offlinePaymentSlots.prepareMutation.isPending;
  const offlineSlotSnapshotLoaded =
    offlinePaymentSlots.localSnapshotQuery.isFetched || offlinePaymentSlots.snapshot != null;
  const offlineSlotTarget = Math.max(
    offlinePaymentSlots.targetSlotCount,
    OFFLINE_PAYMENT_SLOT_DEFAULT,
  );
  const setPreferredWalletModeAfterPaint = useCallback(
    (mode: WalletMode): void => {
      walletModeCommitRef.current?.cancel();
      walletModeCommitRef.current = scheduleUiWorkAfterFirstPaint(
        () => {
          setPreferredWalletMode(mode);
          walletModeCommitRef.current = null;
        },
        {
          timeoutMs: 1200,
          fallbackDelayMs: 160,
        },
      );
    },
    [setPreferredWalletMode],
  );

  useEffect(
    () => () => {
      walletModeCommitRef.current?.cancel();
      walletModeCommitRef.current = null;
    },
    [],
  );

  const offlineToggleContextRef = useRef<{
    promptKey: string | null;
    offlineReadySlots: number;
    offlineSetupPendingSlots: number;
    offlineSlotSnapshotLoaded: boolean;
    canReadStatus: boolean;
    preparePending: boolean;
    isOnlineReachable: boolean;
    refetchStatus: () => Promise<{
      data?: { counts: { ready: number; preparing: number; settling: number } };
    }>;
    setPreferredWalletMode: (mode: WalletMode) => void;
    showToast: typeof showToast;
    notificationId?: string;
  } | null>(null);
  const slotStatusKey =
    network != null && publicKey != null ? `${network}:${publicKey}:${offlineSlotTarget}` : null;
  const slotStatusNotificationId =
    slotStatusKey != null ? `offline-slots-setup-${slotStatusKey}` : undefined;
  offlineToggleContextRef.current = {
    promptKey: network != null && publicKey != null ? `${network}:${publicKey}` : null,
    offlineReadySlots,
    offlineSetupPendingSlots,
    offlineSlotSnapshotLoaded,
    canReadStatus: offlinePaymentSlots.canReadStatus,
    preparePending: offlinePaymentSlots.prepareMutation.isPending,
    isOnlineReachable,
    refetchStatus: offlinePaymentSlots.statusQuery.refetch,
    setPreferredWalletMode: setPreferredWalletModeAfterPaint,
    showToast,
    notificationId: slotStatusNotificationId,
  };
  const offlineSlotsLabel = isOffline
    ? buildOfflineSlotsLabel({
        readySlots: offlineReadySlots,
        pendingSlots: offlineSetupPendingSlots,
        targetSlots: offlineSlotTarget,
        snapshotLoaded: offlineSlotSnapshotLoaded,
        preparePending: offlinePreparePending,
      })
    : null;
  const slotRentEstimateLabel =
    offlinePaymentSlots.rentEstimateQuery.data?.totalLamports != null
      ? `${formatLamportsAsExactSol(offlinePaymentSlots.rentEstimateQuery.data.totalLamports)} SOL`
      : offlinePaymentSlots.rentEstimateQuery.isFetching
        ? 'Checking estimate'
        : null;
  const balanceErrorMessage = getQueryErrorMessage(
    balanceQuery.error,
    'Unable to load wallet balance.',
  );
  const transactionsErrorMessage = getQueryErrorMessage(
    transactionsQuery.error,
    'Unable to load transaction history.',
  );
  const balanceLabel = balanceQuery.isCapabilityEnabled
    ? balanceQuery.isError
      ? balanceErrorMessage
      : 'Native SOL Balance'
    : balanceQuery.isCapabilitiesPending
      ? 'Loading OffPay features'
      : balanceQuery.capability.message;
  const pendingSettlementCount = pendingBackupStatsQuery.data?.pending ?? 0;
  const pendingUploadCount = pendingBackupStatsQuery.data?.uploadPending ?? 0;
  const failedSettlementCount = pendingBackupStatsQuery.data?.failed ?? 0;
  const queuedOfflineCount = pendingSettlementCount + pendingUploadCount;
  const streamStatusLabel = isOffline
    ? queuedOfflineCount > 0
      ? `${queuedOfflineCount} queued offline. Go online to finalize.`
      : failedSettlementCount > 0
        ? `${failedSettlementCount} queued payment${
            failedSettlementCount === 1 ? '' : 's'
          } need online retry.`
        : null
    : settlementStatus === 'running'
      ? 'Finalizing queued payments.'
      : settlementStatus === 'backoff'
        ? (settlementError ?? 'Finalization retry is scheduled.')
        : pendingSettlementCount > 0
          ? `${pendingSettlementCount} queued payment${
              pendingSettlementCount === 1 ? '' : 's'
            } waiting to finalize.`
          : failedSettlementCount > 0
            ? `${failedSettlementCount} queued payment${
                failedSettlementCount === 1 ? '' : 's'
              } need attention.`
            : pendingUploadCount > 0
              ? `${pendingUploadCount} queued payment${
                  pendingUploadCount === 1 ? '' : 's'
                } waiting to sync.`
              : null;
  const hasWallet = publicKey != null;
  const criticalSnapshotPending = homeSnapshot.criticalDataPending;
  const balanceWarmingUp =
    hasWallet && canUseNetwork && (criticalSnapshotPending || balanceQuery.isCapabilitiesPending);
  const firstBalancePayloadPending =
    hasWallet &&
    canUseNetwork &&
    balanceQuery.data == null &&
    !balanceQuery.isError &&
    (criticalSnapshotPending ||
      homeSnapshot.dashboardQuery.isFetching ||
      balanceQuery.isLoading ||
      balanceQuery.isFetching ||
      balanceQuery.isCapabilitiesPending ||
      (homeSnapshot.foregroundFetchEnabled &&
        balanceQuery.isCapabilityEnabled &&
        !balanceQuery.isFetched));
  const activityWarmingUp =
    hasWallet &&
    canUseNetwork &&
    (criticalSnapshotPending || transactionsQuery.isCapabilitiesPending);
  const activityFirstPaintLoading =
    recentActivity.length === 0 &&
    hasWallet &&
    canUseNetwork &&
    !transactionsQuery.isError &&
    (criticalSnapshotPending ||
      activityWarmingUp ||
      !homeSnapshot.foregroundFetchEnabled ||
      transactionsQuery.isCapabilitiesPending ||
      transactionsQuery.isInitialDataPending ||
      transactionsQuery.isLoading ||
      transactionsQuery.isFetching ||
      transactionsQuery.isRefetching ||
      (homeSnapshot.foregroundFetchEnabled &&
        transactionsQuery.isCapabilityEnabled &&
        !transactionsQuery.isFetched &&
        (transactionsQuery.isLoading || transactionsQuery.isFetching)));
  const holdingsLoading =
    previewHoldings.length === 0 &&
    (criticalSnapshotPending ||
      balanceWarmingUp ||
      firstBalancePayloadPending ||
      balanceQuery.isLoading ||
      balanceQuery.isCapabilitiesPending);
  const activityLoading = activityFirstPaintLoading;
  const holdingsEmptyTitle = balanceQuery.isCapabilityEnabled
    ? holdingsLoading || balanceQuery.isLoading
      ? 'Loading holdings'
      : balanceQuery.isError
        ? 'Unable to load holdings'
        : 'No tokens found'
    : balanceWarmingUp || balanceQuery.isCapabilitiesPending
      ? 'Loading holdings'
      : 'Holdings unavailable';
  const holdingsEmptySubtitle = balanceQuery.isCapabilityEnabled
    ? balanceQuery.isError
      ? balanceErrorMessage
      : undefined
    : balanceWarmingUp || balanceQuery.isCapabilitiesPending
      ? undefined
      : balanceQuery.capability.message;
  const activityEmptyTitle = transactionsQuery.isCapabilityEnabled
    ? activityLoading || transactionsQuery.isLoading
      ? 'Loading activity'
      : transactionsQuery.isError
        ? 'Unable to load activity'
        : 'No transactions yet'
    : activityWarmingUp || transactionsQuery.isCapabilitiesPending
      ? 'Loading activity'
      : 'Activity unavailable';
  const activityEmptySubtitle = transactionsQuery.isCapabilityEnabled
    ? transactionsQuery.isError
      ? transactionsErrorMessage
      : 'Your transaction history will appear here'
    : activityWarmingUp || transactionsQuery.isCapabilitiesPending
      ? 'Checking activity access'
      : transactionsQuery.capability.message;

  useEffect(() => {
    if (balanceQuery.data == null) return;
    router.prefetch('/holdings' as never);
    // Send and Receive are the most-tapped buttons on Home. Prefetch
    // their routes once we have wallet data so the first tap doesn't
    // pay for chunk resolution + the route's initial mount on the
    // same frame as the navigation transition. `router.prefetch` is a
    // no-op if the route is already in cache.
    router.prefetch('/receive-payment' as never);
    router.prefetch('/private-payment?mode=send' as never);
    router.prefetch('/(tabs)/history' as never);
  }, [balanceQuery.data, router]);

  const warmShieldedTokenLogos = useCallback(
    (mode: HomeBalanceMode): void => {
      if (mode !== 'shielded' || !homeDataReady || network == null || !canUseNetwork) return;

      void queryClient.prefetchQuery({
        queryKey: offpaySwapTokensQueryKey(network),
        queryFn: ({ signal }) => fetchOffpaySwapTokensForLogos(network, signal),
        staleTime: TOKEN_LOGO_CACHE_STALE_MS,
        gcTime: TOKEN_LOGO_CACHE_GC_MS,
      });
    },
    [canUseNetwork, homeDataReady, network, queryClient],
  );

  const handleChangeHomeBalanceMode = useCallback(
    (mode: HomeBalanceMode): void => {
      warmShieldedTokenLogos(mode);
      setHomeBalanceModeState((current) => {
        const keepMounted =
          current.scopeKey === homeBalanceModeScopeKey && current.shieldedPaneMounted;

        return {
          scopeKey: homeBalanceModeScopeKey,
          mode,
          shieldedPaneMounted: keepMounted || mode === 'shielded',
        };
      });
    },
    [homeBalanceModeScopeKey, warmShieldedTokenLogos],
  );

  const handleToggleOffline = useCallback((newOfflineState: boolean) => {
    const context = offlineToggleContextRef.current;
    if (context == null) return;

    if (!newOfflineState) {
      if (!context.isOnlineReachable) {
        context.setPreferredWalletMode('offline');
        context.showToast({
          title: 'No internet connection',
          message: 'Offline mode stays active until internet is reachable.',
          variant: 'warning',
        });
        return;
      }

      context.setPreferredWalletMode('online');
      return;
    }

    if (context.preparePending) {
      context.showToast({
        title: 'Slots preparing',
        message: 'Wait for setup to finish.',
        variant: 'info',
        notificationId: context.notificationId,
      });
      return;
    }

    const readySlots = context.offlineReadySlots;

    if (readySlots > 0) {
      context.setPreferredWalletMode('offline');
      return;
    }

    if (context.offlineSetupPendingSlots > 0) {
      context.showToast({
        title: 'Slots finalizing',
        message: `${context.offlineSetupPendingSlots} slots are still preparing.`,
        variant: 'info',
        notificationId: context.notificationId,
      });
      return;
    }

    if (context.canReadStatus) {
      void context
        .refetchStatus()
        .then((refreshed) => {
          const refreshedReadySlots = refreshed.data?.counts.ready ?? 0;
          const refreshedPendingSlots = countOfflineSetupPendingSlots(refreshed.data?.counts);
          if (refreshedReadySlots > 0) {
            setSlotPromptVisible(false);
            context.setPreferredWalletMode('offline');
            return;
          }

          if (refreshedPendingSlots > 0) {
            setSlotPromptVisible(false);
            context.showToast({
              title: 'Slots finalizing',
              message: `${refreshedPendingSlots} slots are still preparing.`,
              variant: 'info',
              notificationId: context.notificationId,
            });
          }
        })
        .catch(() => undefined);
    }

    if (context.promptKey != null) {
      slotPromptAutoShownRef.current = context.promptKey;
    }
    setSlotPromptVisible(true);
  }, []);

  const handlePrepareOfflineSlots = useCallback((): void => {
    if (offlinePaymentSlots.prepareMutation.isPending) {
      return;
    }

    if (!offlinePaymentSlots.canPrepare) {
      showToast({
        title: 'Go online first',
        message: 'Preparing slots needs network access.',
        variant: 'warning',
      });
      return;
    }

    setOfflinePaymentsEnabled(true);
    setOfflinePaymentPoolSize(offlineSlotTarget);
    slotPrepareShouldEnterOfflineRef.current = true;
    offlinePaymentSlots.prepareMutation.mutate(
      {
        targetSlotCount: offlineSlotTarget,
        spendAuthorization: 'user-confirmed',
      },
      {
        onSuccess: (result) => {
          setSlotPromptVisible(false);
          const readySlots = result.snapshot.counts.ready;
          const pendingSlots = countOfflineSetupPendingSlots(result.snapshot.counts);
          const promptKey = network != null && publicKey != null ? `${network}:${publicKey}` : null;
          if (promptKey != null && pendingSlots > 0) {
            slotPromptAutoShownRef.current = promptKey;
          }
          if (readySlots > 0) {
            setPreferredWalletModeAfterPaint('offline');
            slotPrepareShouldEnterOfflineRef.current = false;
          }
          const rentSol =
            result.rentEstimate?.totalLamports != null
              ? formatLamportsAsExactSol(result.rentEstimate.totalLamports)
              : null;
          const preparedLabel =
            readySlots > 0
              ? `${readySlots}/${offlineSlotTarget} ready`
              : pendingSlots > 0
                ? `${Math.min(pendingSlots, offlineSlotTarget)}/${offlineSlotTarget} pending`
                : `${result.preparedCount} slots`;
          showToast({
            title:
              readySlots > 0
                ? 'Offline slots ready'
                : pendingSlots > 0
                  ? 'Slots finalizing'
                  : 'No slots prepared',
            message: rentSol != null ? `${preparedLabel} · ${rentSol} SOL rent` : preparedLabel,
            variant: readySlots > 0 ? 'success' : pendingSlots > 0 ? 'info' : 'warning',
            notificationId: slotStatusNotificationId,
          });
        },
        onError: (error) => {
          slotPrepareShouldEnterOfflineRef.current = false;
          showToast({
            title: 'Slot preparation failed',
            message: error instanceof Error ? error.message : 'Could not prepare offline slots.',
            variant: 'error',
            durationMs: 3600,
          });
        },
      },
    );
  }, [
    offlinePaymentSlots.canPrepare,
    offlinePaymentSlots.prepareMutation,
    offlineSlotTarget,
    network,
    publicKey,
    setOfflinePaymentPoolSize,
    setOfflinePaymentsEnabled,
    setPreferredWalletModeAfterPaint,
    showToast,
    slotStatusNotificationId,
  ]);

  const handleGoOnlineForSlots = useCallback((): void => {
    setPreferredWalletModeAfterPaint('online');
    showToast({
      title: 'Online mode enabled',
      message: 'Prepare slots before going offline.',
      variant: 'info',
    });
  }, [setPreferredWalletModeAfterPaint, showToast]);

  const handleContinueOfflineWithoutSlots = useCallback((): void => {
    const context = offlineToggleContextRef.current;
    if (context?.promptKey != null) {
      slotPromptAutoShownRef.current = context.promptKey;
    }
    setSlotPromptVisible(false);
    setPreferredWalletModeAfterPaint('offline');
    showToast({
      title: 'Offline sends unavailable',
      message: 'Prepare slots online before sending offline.',
      variant: 'warning',
    });
  }, [setPreferredWalletModeAfterPaint, showToast]);

  const handleTogglePrivacy = useCallback((): void => {
    setPrivacyHidden((current) => !current);
  }, []);

  useEffect(() => {
    const previous = previousSlotStatusRef.current;
    const becameReady =
      slotStatusKey != null &&
      previous?.key === slotStatusKey &&
      previous.readySlots === 0 &&
      previous.pendingSlots > 0 &&
      offlineReadySlots > 0;

    previousSlotStatusRef.current = {
      key: slotStatusKey,
      readySlots: offlineReadySlots,
      pendingSlots: offlineSetupPendingSlots,
    };

    if (!becameReady) return;

    if (slotPrepareShouldEnterOfflineRef.current) {
      slotPrepareShouldEnterOfflineRef.current = false;
      setPreferredWalletModeAfterPaint('offline');
    }

    showToast({
      title: 'Offline slots ready',
      message: `${offlineReadySlots}/${offlineSlotTarget} ready`,
      variant: 'success',
      notificationId: slotStatusNotificationId,
    });
  }, [
    offlineReadySlots,
    offlineSetupPendingSlots,
    offlineSlotTarget,
    setPreferredWalletModeAfterPaint,
    showToast,
    slotStatusNotificationId,
    slotStatusKey,
  ]);

  useEffect(() => {
    if (
      !isOffline ||
      publicKey == null ||
      network == null ||
      offlineReadySlots > 0 ||
      offlineSetupPendingSlots > 0 ||
      !offlineSlotSnapshotLoaded
    ) {
      return;
    }

    const key = `${network}:${publicKey}`;
    if (slotPromptAutoShownRef.current === key) return;

    slotPromptAutoShownRef.current = key;
    setSlotPromptVisible(true);
  }, [
    isOffline,
    network,
    offlineReadySlots,
    offlineSetupPendingSlots,
    offlineSlotSnapshotLoaded,
    publicKey,
  ]);

  useEffect(() => {
    if (
      slotPromptVisible &&
      !offlinePaymentSlots.prepareMutation.isPending &&
      (offlineReadySlots > 0 || offlineSetupPendingSlots > 0)
    ) {
      setSlotPromptVisible(false);
    }
  }, [
    offlinePaymentSlots.prepareMutation.isPending,
    offlineReadySlots,
    offlineSetupPendingSlots,
    slotPromptVisible,
  ]);

  const navigateToStack = useCallback(
    (path: string): void => {
      router.push(path as never);
    },
    [router],
  );

  const navigateToTab = useCallback(
    (path: string): void => {
      router.navigate(path as never);
    },
    [router],
  );

  const handleOpenAccounts = useCallback((): void => {
    navigateToStack('/accounts');
  }, [navigateToStack]);

  const handleAction = useCallback(
    (actionId: string): void => {
      if (actionId === 'send') {
        navigateToStack('/private-payment?mode=send');
        return;
      }

      if (actionId === 'receive') {
        navigateToStack('/receive-payment');
        return;
      }

      if (actionId === 'swap') {
        navigateToTab('/(tabs)/swap');
      }
    },
    [navigateToStack, navigateToTab],
  );

  const handleRefreshHomeData = useCallback((): void => {
    if (homeRefreshInFlightRef.current) return;

    homeRefreshInFlightRef.current = true;
    setHomeRefreshPending(true);

    // The actual refetches are scheduled after this press frame so
    // the refresh tap can paint before network / JSON work begins.
    const signal = getScreenSignal();
    const refreshStartedAt = mark();
    const balanceKey =
      publicKey != null && network != null ? offpayWalletBalanceQueryKey(publicKey, network) : null;
    const dashboardKey =
      publicKey != null && network != null
        ? offpayWalletDashboardQueryKey(publicKey, network, WALLET_TRANSACTIONS_PAGE_SIZE)
        : null;
    const transactionsKey =
      publicKey != null && network != null
        ? offpayWalletTransactionsBaseQueryKey(publicKey, network)
        : null;
    const backupStatsKey =
      publicKey != null && network != null
        ? pendingBackupQueueStatsQueryKey(publicKey, network)
        : null;
    const portfolioKey = ['offpay', 'portfolioValuation', network, currency] as const;
    let minSpinnerTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshSettled = false;
    let minSpinnerElapsed = false;
    let released = false;
    const releaseSpinner = (): void => {
      if (released) return;
      released = true;
      if (minSpinnerTimer != null) {
        clearTimeout(minSpinnerTimer);
        minSpinnerTimer = null;
      }
      signal.removeEventListener('abort', cancelRefresh);
      homeRefreshInFlightRef.current = false;
      setHomeRefreshPending(false);
    };
    const maybeReleaseSpinner = (): void => {
      if (refreshSettled && minSpinnerElapsed) {
        releaseSpinner();
      }
    };
    const cancelRefresh = (): void => {
      if (dashboardKey != null) {
        void queryClient.cancelQueries({ queryKey: dashboardKey });
      }
      if (balanceKey != null) {
        void queryClient.cancelQueries({ queryKey: balanceKey });
      }
      if (transactionsKey != null) {
        void queryClient.cancelQueries({ queryKey: transactionsKey });
      }
      if (backupStatsKey != null) {
        void queryClient.cancelQueries({ queryKey: backupStatsKey });
      }
      void queryClient.cancelQueries({ queryKey: portfolioKey });
      releaseSpinner();
    };
    signal.addEventListener('abort', cancelRefresh, { once: true });
    minSpinnerTimer = setTimeout(() => {
      minSpinnerElapsed = true;
      maybeReleaseSpinner();
    }, HOME_REFRESH_SPINNER_MIN_MS);

    runAfterTapFrame(() => {
      if (signal.aborted) {
        releaseSpinner();
        return;
      }

      const finishRefresh = (): void => {
        refreshSettled = true;
        measure('home.manualRefresh', refreshStartedAt, {
          network,
          mode: canUseNetwork ? 'online' : 'cache',
          aborted: signal.aborted,
        });
        maybeReleaseSpinner();
      };

      if (!canUseNetwork) {
        const cacheRefreshes: Promise<unknown>[] = [];
        if (publicKey != null && network != null) {
          cacheRefreshes.push(
            hydrateWalletDisplayCacheIntoQueryClient({
              queryClient,
              walletAddress: publicKey,
              network,
              options: {
                includeTransactions: false,
              },
            }),
          );
        }
        if (backupStatsKey != null) {
          cacheRefreshes.push(pendingBackupStatsQuery.refetch({ cancelRefetch: true }));
        }
        cacheRefreshes.push(portfolioValuationQuery.refetch({ cancelRefetch: true }));

        void Promise.allSettled(cacheRefreshes).finally(finishRefresh);
        return;
      } else {
        const refreshWalletSnapshot = async (): Promise<void> => {
          const dashboardResult = await homeSnapshot.dashboardQuery.refetch({
            cancelRefetch: true,
          });
          if (signal.aborted) {
            return;
          }

          openHomeForegroundFetchGate();
          if (dashboardResult.data != null && !dashboardResult.isError) {
            await transactionsQuery.refetchFresh({ signal, useCache: false });
            return;
          }

          await Promise.allSettled([
            capabilitiesQuery.refetch({ cancelRefetch: true }),
            balanceQuery.refetch({ cancelRefetch: true }),
            transactionsQuery.refetchFresh({ signal, useCache: false }),
          ]);
        };
        const networkRefreshes: Promise<unknown>[] = [
          refreshWalletSnapshot(),
          pendingBackupStatsQuery.refetch({ cancelRefetch: true }),
          portfolioValuationQuery.refetch({ cancelRefetch: true }),
        ];

        void Promise.allSettled(networkRefreshes).finally(finishRefresh);
      }
    });
  }, [
    canUseNetwork,
    publicKey,
    network,
    currency,
    queryClient,
    getScreenSignal,
    openHomeForegroundFetchGate,
    capabilitiesQuery,
    homeSnapshot.dashboardQuery,
    balanceQuery,
    transactionsQuery,
    pendingBackupStatsQuery,
    portfolioValuationQuery,
  ]);

  const handleTokenPress = useCallback(
    (holding: TokenHolding): void => {
      const params = new URLSearchParams(buildTokenDetailsRouteParams(holding));
      navigateToStack(`/token-details?${params.toString()}`);
    },
    [navigateToStack],
  );

  const handleActivityPress = useCallback((transaction: OffpayRecentActivityView): void => {
    setSelectedTransaction(transaction);
  }, []);

  const handleDismissTransactionDetails = useCallback((): void => {
    setSelectedTransaction(null);
  }, []);

  const handleViewAllHoldings = useCallback((): void => {
    router.push('/holdings' as never);
  }, [router]);

  const handleViewAllActivity = useCallback((): void => {
    navigateToTab('/(tabs)/history');
  }, [navigateToTab]);

  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.md;
  const viewportProfile = getViewportProfile({
    width: windowWidth,
    height: windowHeight,
    fontScale,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
  const screenHorizontalPadding = viewportProfile.horizontalPadding;
  const sectionGap = viewportProfile.compact ? spacing.lg : spacing.xl;
  const shieldedPaneActive = !isNetworkSwitching && homeBalanceMode === 'shielded';
  const shouldRenderShieldedPane =
    !isNetworkSwitching && (shieldedPaneMounted || shieldedPaneActive);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: bottomPadding,
            paddingHorizontal: screenHorizontalPadding,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === 'android'}
      >
        <View style={styles.homeContentFrame}>
          <HomeHeader
            isOffline={isOffline}
            onToggleOffline={handleToggleOffline}
            onPressWalletDetails={handleOpenAccounts}
            privacyHidden={privacyHidden}
          />
        </View>

        <View style={styles.homeContentFrame}>
          <HomeBalanceModeDivider
            key={`home-balance-mode-${homeBalanceModeScopeKey}`}
            selectedMode={homeBalanceMode}
            onChangeMode={handleChangeHomeBalanceMode}
            onPrepareMode={warmShieldedTokenLogos}
            loading={isNetworkSwitching}
          />
        </View>

        {shouldRenderShieldedPane ? (
          <View
            style={[
              styles.homeContentFrame,
              styles.shieldedSection,
              !shieldedPaneActive && styles.inactiveModePane,
            ]}
            pointerEvents={shieldedPaneActive ? 'auto' : 'none'}
            accessibilityElementsHidden={!shieldedPaneActive}
            importantForAccessibility={shieldedPaneActive ? 'auto' : 'no-hide-descendants'}
          >
            <UmbraVaultContent showHeader={false} tokenLogoMap={tokenLogoMap} />
          </View>
        ) : null}

        <View
          style={[
            styles.homeContentFrame,
            styles.modeContent,
            shieldedPaneActive && styles.inactiveModePane,
          ]}
          pointerEvents={shieldedPaneActive ? 'none' : 'auto'}
          accessibilityElementsHidden={shieldedPaneActive}
          importantForAccessibility={shieldedPaneActive ? 'no-hide-descendants' : 'auto'}
        >
          <View style={[styles.balanceSection, { marginBottom: sectionGap }]}>
            <BalanceCard
              publicKey={publicKey}
              networkLabel={networkLabel}
              offlineSlotsLabel={offlineSlotsLabel}
              portfolioValueLabel={portfolioValueLabel}
              portfolioValueLoading={
                portfolioValueLabel == null &&
                (criticalSnapshotPending ||
                  valuationValuesLoading ||
                  portfolioValuationQuery.isLoading ||
                  balanceQuery.isLoading ||
                  balanceQuery.isCapabilitiesPending)
              }
              selectedCurrency={currency}
              onCurrencyChange={setCurrency}
              onRefresh={handleRefreshHomeData}
              refreshing={homeRefreshPending}
              privacyHidden={privacyHidden}
              onTogglePrivacy={handleTogglePrivacy}
              balanceTicker="Portfolio"
              balanceLabel={balanceLabel}
              onAction={handleAction}
              disabledActionIds={
                isOffline ? OFFLINE_DISABLED_ACTION_IDS : EMPTY_DISABLED_ACTION_IDS
              }
            />
          </View>

          <View>
            <TokenHoldingsCard
              holdings={previewHoldings}
              onTokenPress={handleTokenPress}
              onViewAll={handleViewAllHoldings}
              emptyTitle={holdingsEmptyTitle}
              emptySubtitle={holdingsEmptySubtitle}
              hiddenSpamTokenCount={countSpamTokens(balanceQuery.data)}
              privacyHidden={privacyHidden}
              valuations={tokenValuations}
              valuationsLoading={valuationValuesLoading}
              loading={holdingsLoading}
            />
          </View>

          <View>
            <RecentActivityCard
              transactions={recentActivity}
              onTransactionPress={handleActivityPress}
              onViewAll={handleViewAllActivity}
              statusLabel={streamStatusLabel}
              emptyTitle={activityEmptyTitle}
              emptySubtitle={activityEmptySubtitle}
              privacyHidden={privacyHidden}
              loading={activityLoading}
              tokenLogos={tokenLogoMap}
            />
          </View>
        </View>
      </ScrollView>

      {slotPromptVisible ? (
        <OfflineSlotsPromptModal
          visible={slotPromptVisible}
          readySlots={offlineReadySlots}
          pendingSlots={
            offlinePreparePending
              ? Math.max(
                  offlineSetupPendingSlots,
                  Math.max(0, offlineSlotTarget - offlineReadySlots),
                )
              : offlineSetupPendingSlots
          }
          targetSlotCount={offlineSlotTarget}
          snapshotLoaded={offlineSlotSnapshotLoaded}
          networkLabel={networkLabel}
          rentEstimateLabel={slotRentEstimateLabel}
          preparing={offlinePreparePending}
          canPrepare={offlinePaymentSlots.canPrepare}
          isOffline={isOffline}
          onPrepare={handlePrepareOfflineSlots}
          onGoOnline={handleGoOnlineForSlots}
          onContinueOffline={handleContinueOfflineWithoutSlots}
          onCancel={() => setSlotPromptVisible(false)}
        />
      ) : null}
      <TransactionDetailsSheet
        transaction={selectedTransaction}
        tokenLogos={tokenLogoMap}
        onDismiss={handleDismissTransactionDetails}
      />
    </View>
  );
}
// ---------------------------------------------------------------------------
// Styles — screen-level layout only; component styles live in their files
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  homeContentFrame: {
    width: '100%',
    maxWidth: 430,
  },
  modeContent: {
    width: '100%',
  },
  inactiveModePane: {
    display: 'none',
  },
  balanceSection: {
    width: '100%',
  },
  shieldedSection: {
    paddingBottom: spacing.md,
  },
});
