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
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { colors } from '@/constants/colors';
import { OFFLINE_PAYMENT_SLOT_DEFAULT } from '@/constants/offline-payment-slots';
import { layout, radii, spacing } from '@/constants/spacing';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { usePendingBackupQueueStats } from '@/hooks/usePendingBackupQueueStats';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayPortfolioValuation } from '@/hooks/useOffpayPortfolioValuation';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOfflinePaymentSlots } from '@/hooks/useOfflinePaymentSlots';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import { formatFiatCurrency } from '@/lib/currency-rates';
import { formatLamportsAsExactSol } from '@/lib/crypto/solana-amounts';
import { scheduleUiWorkAfterFirstPaint, yieldToUi } from '@/lib/perf/ui-work-scheduler';
import { mark, measure } from '@/lib/perf/perf-marks';
import { hydrateWalletDisplayCacheIntoQueryClient } from '@/lib/wallet/wallet-display-cache';
import {
  buildStablecoinMetadataLookup,
  buildWalletRecentActivityItems,
  buildVisibleTokenHoldings,
  countSpamTokens,
} from '@/lib/api/offpay-wallet-data';
import { buildLocalHistoryReceiptInputs } from '@/lib/api/offpay-local-history-receipts';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  pendingBackupQueueStatsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { useSettlementEngineStore } from '@/store/settlementEngineStore';
import { useWalletStore } from '@/store/walletStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useAdvancedSwapStore } from '@/store/advancedSwapStore';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';
import type { OffpayRecentActivityView } from '@/lib/api/offpay-wallet-data';
import type { ScheduledUiWork } from '@/lib/perf/ui-work-scheduler';
import type { WalletMode } from '@/store/preferencesStore';

// Lazy-load the Umbra vault surface so the heavy `@umbra-privacy/sdk`
// graph stays out of the cold-start bundle. Do not auto-prefetch this
// chunk on Home mount: in development it pulls in ~2k modules and can
// stall reload / navigation. We only warm it when the user presses the
// Shielded segment.
type UmbraVaultContentModule = {
  default: typeof import('@/components/features/umbra-vault/umbra-vault-screen').UmbraVaultContent;
};

let umbraVaultContentImportPromise: Promise<UmbraVaultContentModule> | null = null;
function loadUmbraVaultContent(reason: 'press-in' | 'render'): Promise<UmbraVaultContentModule> {
  if (umbraVaultContentImportPromise != null) return umbraVaultContentImportPromise;
  const startedAt = mark();
  umbraVaultContentImportPromise = import('@/components/features/umbra-vault/umbra-vault-screen')
    .then((module) => {
      return {
        default: module.UmbraVaultContent,
      };
    })
    .finally(() => {
      measure('home.umbraVault.import', startedAt, { reason });
    });

  return umbraVaultContentImportPromise;
}

function prefetchUmbraVaultContent(reason: 'press-in' | 'render'): void {
  void loadUmbraVaultContent(reason);
}

const UmbraVaultContent = lazy(() => loadUmbraVaultContent('render'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HOME_ACTIVITY_ITEMS = 4;
const MAX_HOME_HOLDINGS_ITEMS = 3;
const EMPTY_DISABLED_ACTION_IDS: readonly string[] = [];
const OFFLINE_DISABLED_ACTION_IDS: readonly string[] = ['swap'];
const HOME_DATA_STAGE_COUNT = 5;
const HOME_REFRESH_SPINNER_MIN_MS = 360;

const SHIELDED_SKELETON_TOKEN_ROWS = ['usdc', 'usdt', 'wsol', 'umbra'] as const;
const SHIELDED_SKELETON_CHIPS = ['shield', 'withdraw', 'token-a', 'token-b'] as const;

/**
 * Identities (`network:wallet:online|offline`) for which the staged
 * data ramp has already run to completion. Module-scoped so it
 * survives a Home unmount — without this, the 5-stage ramp would
 * replay on every cold start of the screen even when React Query has
 * the data warm in cache.
 */
const completedHomeStageIdentities = new Set<string>();

function getQueryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
}): string {
  if (params.readySlots > 0 || params.pendingSlots === 0) {
    return `${params.readySlots}/${params.targetSlots} slots`;
  }

  return `${Math.min(params.pendingSlots, params.targetSlots)}/${params.targetSlots} pending`;
}

function ShieldedVaultSkeleton(): React.JSX.Element {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.shieldedSkeleton}
    >
      <View style={styles.shieldedSkeletonCard}>
        <View style={styles.shieldedSkeletonHeader}>
          <SkeletonBlock width="46%" height={24} radius={radii.sm} />
          <SkeletonBlock width={86} height={34} radius={radii.full} />
        </View>
        <View style={styles.shieldedSkeletonValueBlock}>
          <SkeletonBlock width="42%" height={50} radius={radii.sm} />
          <SkeletonBlock width={82} height={16} radius={radii.xs} />
        </View>
        <View style={styles.shieldedSkeletonTokenGrid}>
          {SHIELDED_SKELETON_TOKEN_ROWS.map((row) => (
            <View key={row} style={styles.shieldedSkeletonTokenRow}>
              <SkeletonBlock width={34} height={34} radius={radii.full} />
              <View style={styles.shieldedSkeletonTokenText}>
                <SkeletonBlock width="58%" height={18} radius={radii.xs} />
                <SkeletonBlock width="72%" height={14} radius={radii.xs} />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.shieldedSkeletonCard}>
        <View style={styles.shieldedSkeletonMoveHeader}>
          <SkeletonBlock width="34%" height={24} radius={radii.sm} />
          <SkeletonBlock width="40%" height={16} radius={radii.xs} />
        </View>
        <SkeletonBlock width="100%" height={50} radius={radii.full} />
        <View style={styles.shieldedSkeletonChipRow}>
          {SHIELDED_SKELETON_CHIPS.map((chip) => (
            <View key={chip} style={styles.shieldedSkeletonChip}>
              <SkeletonBlock width="100%" height={38} radius={radii.full} />
            </View>
          ))}
        </View>
        <View style={styles.shieldedSkeletonFormRow}>
          <View style={styles.shieldedSkeletonInput}>
            <SkeletonBlock width="100%" height={48} radius={radii.full} />
          </View>
          <View style={styles.shieldedSkeletonSubmit}>
            <SkeletonBlock width="100%" height={48} radius={radii.full} />
          </View>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const publicKey = useWalletStore((s) => s.publicKey);
  const currency = usePreferencesStore((s) => s.currency);
  const setCurrency = usePreferencesStore((s) => s.setCurrency);
  const setOfflinePaymentsEnabled = usePreferencesStore((s) => s.setOfflinePaymentsEnabled);
  const setOfflinePaymentPoolSize = usePreferencesStore((s) => s.setOfflinePaymentPoolSize);
  const offlineReceipts = useOfflinePaymentStore((s) => s.receipts);
  const privatePaymentReceipts = usePrivatePaymentStore((s) => s.receipts);
  const swapReceipts = useAdvancedSwapStore((s) => s.receipts);
  const { network } = useOffpayNetwork();
  const getScreenSignal = useScreenAbortSignal();
  const [privacyHidden, setPrivacyHidden] = useState(false);
  const [homeBalanceMode, setHomeBalanceMode] = useState<HomeBalanceMode>('default');
  const [shieldedPaneMounted, setShieldedPaneMounted] = useState(false);
  const [slotPromptVisible, setSlotPromptVisible] = useState(false);
  const [homeRefreshPending, setHomeRefreshPending] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<OffpayRecentActivityView | null>(
    null,
  );
  const slotPromptAutoShownRef = useRef<string | null>(null);
  const slotPrepareShouldEnterOfflineRef = useRef(false);
  const umbraVaultPrefetchRef = useRef<ScheduledUiWork | null>(null);
  const previousSlotStatusRef = useRef<{
    key: string | null;
    readySlots: number;
    pendingSlots: number;
  } | null>(null);
  const walletModeCommitRef = useRef<ScheduledUiWork | null>(null);
  const { effectiveWalletMode, canUseNetwork, isOnlineReachable, setPreferredWalletMode } =
    useWalletModeState();
  const homeDataIdentity =
    publicKey != null && network != null
      ? `${network}:${publicKey}:${canUseNetwork ? 'online' : 'offline'}`
      : null;
  const [homeDataStage, setHomeDataStage] = useState(0);
  const isOffline = effectiveWalletMode === 'offline';
  const capabilitiesReady = homeDataStage >= 1;
  const balanceReady = homeDataStage >= 2;
  const slotsStatusReady = homeDataStage >= 3;
  const tokenLogoReady = homeDataStage >= 3;
  const transactionsReady = homeDataStage >= 4;
  const backgroundStatsReady = homeDataStage >= 5;
  const balanceQuery = useOffpayWalletBalance(null, {
    enabled: balanceReady,
    // Capabilities are pre-warmed by the launch warm-start hook, so
    // there's no need to defer the capabilities probe here. Also fire
    // the balance request as soon as the wallet identity resolves —
    // the staged loader already gates this behind stage 2 of the
    // ramp, so we won't burst the JS thread.
    eagerWithoutCapabilities: true,
  });
  const offlinePaymentSlots = useOfflinePaymentSlots({
    enabled: capabilitiesReady,
    statusEnabled: slotsStatusReady,
    rentEstimateEnabled: backgroundStatsReady,
  });
  const transactionsQuery = useOffpayWalletTransactions({
    enabled: transactionsReady,
  });
  const pendingBackupStatsQuery = usePendingBackupQueueStats({
    walletAddress: publicKey,
    enabled: backgroundStatsReady,
  });
  const tokenLogoMap = useOffpayTokenLogoMap({
    enabled: tokenLogoReady,
  });
  const capabilitiesQuery = useOffpayCapabilities({
    enabled: capabilitiesReady,
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
    enabled: backgroundStatsReady,
  });
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
      localReceipts: localReceiptsForNetwork,
      network,
    }).slice(0, MAX_HOME_ACTIVITY_ITEMS);
  }, [
    network,
    offlineReceipts,
    privatePaymentReceipts,
    publicKey,
    swapReceipts,
    transactionsQuery.transactions,
  ]);
  const portfolioValueLabel =
    portfolioValuationQuery.data != null
      ? formatFiatCurrency(
          portfolioValuationQuery.data.total,
          portfolioValuationQuery.data.currency,
        )
      : balanceQuery.data != null && allVisibleHoldings.length === 0
        ? formatFiatCurrency(0, currency)
        : undefined;
  const networkLabel = network === 'mainnet' ? 'Mainnet' : network === 'devnet' ? 'Devnet' : null;
  const offlineSlotCounts = offlinePaymentSlots.snapshot?.counts ?? null;
  const offlineReadySlots = offlineSlotCounts?.ready ?? 0;
  const offlineSetupPendingSlots = countOfflineSetupPendingSlots(offlineSlotCounts);
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
      umbraVaultPrefetchRef.current?.cancel();
      umbraVaultPrefetchRef.current = null;
    },
    [],
  );

  // The completed-identity cache lives at module scope (see
  // `completedHomeStageIdentities` above) so it survives Home
  // unmounts — without that, every cold start of this screen would
  // replay the 5-stage ramp even when React Query has the data warm.

  useEffect(() => {
    if (homeDataIdentity == null) {
      setHomeDataStage(0);
      return undefined;
    }

    if (completedHomeStageIdentities.has(homeDataIdentity)) {
      setHomeDataStage(HOME_DATA_STAGE_COUNT);
      return undefined;
    }

    setHomeDataStage(0);

    let cancelled = false;

    // Start the ramp on the next animation frame so the first stage
    // doesn't fire on the same frame as the screen mount, but DON'T
    // wait for `requestIdleCallback` / `InteractionManager` first —
    // those cap at the 350ms fallback under load and that's exactly
    // the lag the user perceives after unlock. The `yieldToUi()`
    // between each stage already keeps the JS thread responsive.
    const frameHandle = requestAnimationFrame(() => {
      void (async () => {
        for (let stage = 1; stage <= HOME_DATA_STAGE_COUNT; stage += 1) {
          if (cancelled) return;
          setHomeDataStage(stage);
          await yieldToUi();
        }
        if (!cancelled) {
          completedHomeStageIdentities.add(homeDataIdentity);
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameHandle);
    };
  }, [homeDataIdentity]);

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
  // During the staged data ramp the balance/transactions queries are
  // intentionally disabled until their stage is reached. A disabled
  // query reports neither "loading" nor "capabilities pending", so the
  // empty-state logic would otherwise fall through to "unavailable" for
  // the ~0.5-1s warm-up window on cold open / resume. Treat that
  // pre-enablement window (online + wallet present, stage not yet
  // reached) as loading so the skeleton shows instead of a misleading
  // "unavailable" flash.
  const hasWallet = publicKey != null;
  const balanceWarmingUp =
    hasWallet && canUseNetwork && (!balanceReady || balanceQuery.isCapabilitiesPending);
  const activityWarmingUp =
    hasWallet && canUseNetwork && (!transactionsReady || transactionsQuery.isCapabilitiesPending);
  const holdingsLoading =
    previewHoldings.length === 0 &&
    (balanceWarmingUp || balanceQuery.isLoading || balanceQuery.isCapabilitiesPending);
  const activityLoading =
    recentActivity.length === 0 &&
    (activityWarmingUp || transactionsQuery.isLoading || transactionsQuery.isCapabilitiesPending);
  const holdingsEmptyTitle = balanceQuery.isCapabilityEnabled
    ? balanceQuery.isLoading
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
    ? transactionsQuery.isLoading
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
  }, [balanceQuery.data, router]);

  const handlePrefetchUmbraVaultContent = useCallback((): void => {
    if (umbraVaultContentImportPromise != null) return;
    umbraVaultPrefetchRef.current?.cancel();
    umbraVaultPrefetchRef.current = scheduleUiWorkAfterFirstPaint(
      () => {
        prefetchUmbraVaultContent('press-in');
        umbraVaultPrefetchRef.current = null;
      },
      {
        timeoutMs: 700,
        fallbackDelayMs: 80,
      },
    );
  }, []);

  const handleChangeHomeBalanceMode = useCallback((mode: HomeBalanceMode): void => {
    if (mode === 'shielded') {
      setShieldedPaneMounted(true);
    }
    setHomeBalanceMode(mode);
  }, []);

  // Warm the Umbra vault chunk the moment the user switches to the
  // Shielded segment. Kept in an effect (not inline in render) so the
  // dynamic `import()` side effect never runs during the render pass.
  useEffect(() => {
    if (homeBalanceMode === 'shielded') {
      setShieldedPaneMounted(true);
      prefetchUmbraVaultContent('render');
    }
  }, [homeBalanceMode]);

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

  // Entrance animations — opacity only.
  const headerOpacity = useSharedValue(0);
  const balanceOpacity = useSharedValue(0);
  const tokensOpacity = useSharedValue(0);

  useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) });

    balanceOpacity.value = withDelay(
      80,
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
    );

    tokensOpacity.value = withDelay(
      140,
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
    );
  }, [headerOpacity, balanceOpacity, tokensOpacity]);

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

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
  }));

  const balanceStyle = useAnimatedStyle(() => ({
    opacity: balanceOpacity.value,
  }));

  const tokensStyle = useAnimatedStyle(() => ({
    opacity: tokensOpacity.value,
  }));

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
    if (homeRefreshPending) return;
    setHomeRefreshPending(true);

    // A fresh signal scoped to the current screen focus. If the user
    // backs out of Home (or swaps tabs) mid-refresh, cancel active
    // query work immediately and release the button state. The
    // actual refetches are scheduled after this press frame so the
    // refresh tap can paint before network/JSON work begins.
    const signal = getScreenSignal();
    const balanceKey =
      publicKey != null && network != null ? offpayWalletBalanceQueryKey(publicKey, network) : null;
    const transactionsKey =
      publicKey != null && network != null
        ? offpayWalletTransactionsBaseQueryKey(publicKey, network)
        : null;
    const backupStatsKey =
      publicKey != null && network != null
        ? pendingBackupQueueStatsQueryKey(publicKey, network)
        : null;
    const portfolioKey = ['offpay', 'portfolioValuation', network, currency] as const;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    let released = false;
    const releaseSpinner = (): void => {
      if (released) return;
      released = true;
      if (releaseTimer != null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      signal.removeEventListener('abort', cancelRefresh);
      setHomeRefreshPending(false);
    };
    const cancelRefresh = (): void => {
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

    requestAnimationFrame(() => {
      if (signal.aborted) {
        releaseSpinner();
        return;
      }

      if (!canUseNetwork) {
        if (publicKey != null && network != null) {
          void hydrateWalletDisplayCacheIntoQueryClient({
            queryClient,
            walletAddress: publicKey,
            network,
          }).catch(() => false);
        }
        if (backupStatsKey != null) {
          void queryClient.invalidateQueries(
            { queryKey: backupStatsKey, refetchType: 'active' },
            { cancelRefetch: true },
          );
        }
      } else {
        if (balanceKey != null) {
          void queryClient.invalidateQueries(
            { queryKey: balanceKey, refetchType: 'active' },
            { cancelRefetch: true },
          );
        }
        void queryClient.invalidateQueries(
          { queryKey: portfolioKey, refetchType: 'active' },
          { cancelRefetch: true },
        );

        requestAnimationFrame(() => {
          if (signal.aborted) return;
          if (transactionsKey != null) {
            void queryClient.invalidateQueries(
              { queryKey: transactionsKey, refetchType: 'active' },
              { cancelRefetch: true },
            );
          }
          if (backupStatsKey != null) {
            void queryClient.invalidateQueries(
              { queryKey: backupStatsKey, refetchType: 'active' },
              { cancelRefetch: true },
            );
          }
        });
      }

      releaseTimer = setTimeout(releaseSpinner, HOME_REFRESH_SPINNER_MIN_MS);
    });
  }, [
    homeRefreshPending,
    canUseNetwork,
    publicKey,
    network,
    currency,
    queryClient,
    getScreenSignal,
  ]);

  const handleTokenPress = useCallback(
    (holding: TokenHolding): void => {
      const params = new URLSearchParams({ mint: holding.mint });
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

  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.md;
  const compactHome = windowWidth < 380 || windowHeight < 760 || fontScale > 1.08;
  const denseHome = windowWidth < 340 || fontScale > 1.18;
  const screenHorizontalPadding = denseHome
    ? spacing.md
    : compactHome
      ? spacing.lg
      : spacing['2xl'];
  const sectionGap = compactHome ? spacing.lg : spacing.xl;
  const shieldedPaneActive = homeBalanceMode === 'shielded';
  const shouldRenderShieldedPane = shieldedPaneMounted || shieldedPaneActive;

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
      >
        <Animated.View style={[styles.homeContentFrame, headerStyle]}>
          <HomeHeader
            isOffline={isOffline}
            onToggleOffline={handleToggleOffline}
            onPressWalletDetails={handleOpenAccounts}
            privacyHidden={privacyHidden}
          />
        </Animated.View>

        <View style={styles.homeContentFrame}>
          <HomeBalanceModeDivider
            selectedMode={homeBalanceMode}
            onChangeMode={handleChangeHomeBalanceMode}
            onShieldedPressIn={handlePrefetchUmbraVaultContent}
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
            <Suspense fallback={<ShieldedVaultSkeleton />}>
              <UmbraVaultContent showHeader={false} tokenLogoMap={tokenLogoMap} />
            </Suspense>
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
          <Animated.View
            style={[styles.balanceSection, { marginBottom: sectionGap }, balanceStyle]}
          >
            <BalanceCard
              publicKey={publicKey}
              networkLabel={networkLabel}
              offlineSlotsLabel={offlineSlotsLabel}
              portfolioValueLabel={portfolioValueLabel}
              portfolioValueLoading={
                portfolioValueLabel == null &&
                (portfolioValuationQuery.isLoading ||
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
          </Animated.View>

          <StaggerRevealItem index={0} style={tokensStyle}>
            <TokenHoldingsCard
              holdings={previewHoldings}
              onTokenPress={handleTokenPress}
              onViewAll={handleViewAllHoldings}
              emptyTitle={holdingsEmptyTitle}
              emptySubtitle={holdingsEmptySubtitle}
              hiddenSpamTokenCount={countSpamTokens(balanceQuery.data)}
              privacyHidden={privacyHidden}
              valuations={portfolioValuationQuery.data?.tokenValues}
              loading={holdingsLoading}
            />
          </StaggerRevealItem>

          <StaggerRevealItem index={1} style={tokensStyle}>
            <RecentActivityCard
              transactions={recentActivity}
              onTransactionPress={handleActivityPress}
              onViewAll={() => navigateToTab('/(tabs)/history')}
              statusLabel={streamStatusLabel}
              emptyTitle={activityEmptyTitle}
              emptySubtitle={activityEmptySubtitle}
              privacyHidden={privacyHidden}
              loading={activityLoading}
              tokenLogos={tokenLogoMap}
            />
          </StaggerRevealItem>
        </View>
      </ScrollView>

      {slotPromptVisible ? (
        <OfflineSlotsPromptModal
          visible={slotPromptVisible}
          readySlots={offlineReadySlots}
          pendingSlots={offlineSetupPendingSlots}
          targetSlotCount={offlineSlotTarget}
          networkLabel={networkLabel}
          rentEstimateLabel={slotRentEstimateLabel}
          preparing={offlinePaymentSlots.prepareMutation.isPending}
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
  shieldedSkeleton: {
    width: '100%',
    gap: spacing.lg,
  },
  shieldedSkeletonCard: {
    width: '100%',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.cardElevated,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 0 16px rgba(255, 255, 255, 0.03)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.3)',
      '0 8px 20px rgba(0, 0, 0, 0.3)',
    ].join(', '),
  },
  shieldedSkeletonHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  shieldedSkeletonValueBlock: {
    gap: spacing.xs,
  },
  shieldedSkeletonTokenGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  shieldedSkeletonTokenRow: {
    minHeight: 52,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.clearFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    padding: spacing.sm,
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 128,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shieldedSkeletonTokenText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  shieldedSkeletonMoveHeader: {
    gap: spacing.xs,
  },
  shieldedSkeletonChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  shieldedSkeletonChip: {
    flex: 1,
    minWidth: 64,
  },
  shieldedSkeletonFormRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shieldedSkeletonInput: {
    flex: 1,
    minWidth: 0,
  },
  shieldedSkeletonSubmit: {
    width: 124,
  },
});
