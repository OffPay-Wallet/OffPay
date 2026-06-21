/**
 * History screen — chronological list of wallet transactions.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router/react-navigation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PuffyRefreshIcon } from '@/components/ui/icons/PuffyRefreshIcon';
import { Text } from '@/components/ui/Text';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { HistoryList } from '@/components/features/history/HistoryList';
import { TransactionDetailsSheet } from '@/components/features/history/TransactionDetailsSheet';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import { buildLocalHistoryReceiptInputs } from '@/lib/api/offpay-local-history-receipts';
import { WALLET_DEEP_HISTORY_PAGE_SIZE } from '@/lib/api/offpay-wallet-query-keys';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useAdvancedSwapStore } from '@/store/advancedSwapStore';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  OffpayHistoryTransactionView,
  OffpayLocalReceiptViewInput,
} from '@/lib/api/offpay-wallet-data';

function runAfterTapFrame(task: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(task, 0);
  });
}

const HEADER_CONTAINER_SHADOW =
  '0 14px 30px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const HISTORY_BACKGROUND_PAGE_TARGET = 1;
const HISTORY_BACKGROUND_PAGE_DELAY_MS = 180;

export function HistoryScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const router = useRouter();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);
  const isFocused = useIsFocused();
  const { network } = useOffpayNetwork();
  const walletAddress = useWalletStore((s) => s.publicKey);
  const offlineReceipts = useOfflinePaymentStore((s) => s.receipts);
  const privatePaymentReceipts = usePrivatePaymentStore((s) => s.receipts);
  const swapReceipts = useAdvancedSwapStore((s) => s.receipts);
  const localReceipts = useMemo<OffpayLocalReceiptViewInput[]>(() => {
    return buildLocalHistoryReceiptInputs({
      network,
      walletAddress,
      offlineReceipts,
      privatePaymentReceipts,
      swapReceipts,
    });
  }, [network, offlineReceipts, privatePaymentReceipts, swapReceipts, walletAddress]);
  const transactionsQuery = useOffpayWalletTransactions({
    autoFetchAllPages: false,
    deferUntilAfterInteractions: false,
    enabled: isFocused,
    // History is the canonical activity surface, so it needs enough
    // depth on first fetch to include SOL/custom-token rows that can be
    // pushed behind repeated stablecoin activity.
    limit: WALLET_DEEP_HISTORY_PAGE_SIZE,
    refetchOnMount: true,
    requestOwner: 'history.transactions',
    waitForDashboard: false,
  });
  const tokenLogoMap = useOffpayTokenLogoMap();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.08;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const refreshIconSize = dense ? 15 : compact ? 16 : 18;
  const canRefreshHistory = transactionsQuery.isCapabilityEnabled;
  const isHistoryStale = transactionsQuery.isStale;
  const refetchFreshHistoryQuery = transactionsQuery.refetchFresh;
  const prefetchHistoryPageQuery = transactionsQuery.fetchNextPage;
  const refreshHistoryInFlightRef = useRef(false);
  const backgroundPrefetchInFlightRef = useRef(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<OffpayHistoryTransactionView | null>(null);

  const handleBack = () => {
    const target =
      previousRoute !== 'index' && previousRoute !== 'history'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  };

  // Cancel-on-blur signal: if the user navigates away (tab swap or
  // back gesture) before `refreshHistory` lands, the imperative
  // refetch is skipped before it kicks in. The query itself is still
  // managed by React Query; this just prevents a stale request from
  // being scheduled by a post-frame callback that resolves after the
  // screen has already lost focus.
  const getScreenSignal = useScreenAbortSignal();

  const refreshHistory = useCallback(
    (options?: { force?: boolean }) => {
      if (!canRefreshHistory) return;
      if (options?.force !== true && !isHistoryStale) return;
      if (refreshHistoryInFlightRef.current) return;
      const signal = getScreenSignal();
      refreshHistoryInFlightRef.current = true;
      runAfterTapFrame(() => {
        if (signal.aborted) {
          refreshHistoryInFlightRef.current = false;
          return;
        }
        void refetchFreshHistoryQuery({ signal })
          .catch(() => undefined)
          .finally(() => {
            refreshHistoryInFlightRef.current = false;
          });
      });
    },
    [canRefreshHistory, getScreenSignal, isHistoryStale, refetchFreshHistoryQuery],
  );

  // First focus is already covered by the initial query mount. Later
  // focuses only refresh when React Query marks the deep history page
  // stale; the manual refresh button still forces a network fetch.
  const hasFocusedOnceRef = useRef(false);
  const refreshHistoryRef = useRef(refreshHistory);
  useEffect(() => {
    refreshHistoryRef.current = refreshHistory;
  }, [refreshHistory]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return undefined;
      }
      refreshHistoryRef.current();
      return undefined;
    }, []),
  );

  const loadedHistoryPages = transactionsQuery.data?.pages.length ?? 0;
  useEffect(() => {
    if (!isFocused) return undefined;
    if (!transactionsQuery.isCapabilityEnabled) return undefined;
    if (backgroundPrefetchInFlightRef.current) return undefined;
    if (loadedHistoryPages <= 0 || loadedHistoryPages >= HISTORY_BACKGROUND_PAGE_TARGET) {
      return undefined;
    }
    if (
      !transactionsQuery.hasNextPage ||
      transactionsQuery.isFetchingNextPage ||
      transactionsQuery.isLoading ||
      transactionsQuery.isRefetching
    ) {
      return undefined;
    }

    const signal = getScreenSignal();
    backgroundPrefetchInFlightRef.current = true;
    const timer = setTimeout(() => {
      if (signal.aborted) {
        backgroundPrefetchInFlightRef.current = false;
        return;
      }

      void prefetchHistoryPageQuery()
        .catch(() => undefined)
        .finally(() => {
          backgroundPrefetchInFlightRef.current = false;
        });
    }, HISTORY_BACKGROUND_PAGE_DELAY_MS);

    return () => {
      clearTimeout(timer);
      backgroundPrefetchInFlightRef.current = false;
    };
  }, [
    getScreenSignal,
    isFocused,
    loadedHistoryPages,
    prefetchHistoryPageQuery,
    transactionsQuery.hasNextPage,
    transactionsQuery.isCapabilityEnabled,
    transactionsQuery.isFetchingNextPage,
    transactionsQuery.isLoading,
    transactionsQuery.isRefetching,
  ]);

  const handleRefresh = useCallback(() => refreshHistory({ force: true }), [refreshHistory]);

  const handleTransactionPress = useCallback((transaction: OffpayHistoryTransactionView) => {
    setSelectedTransaction(transaction);
  }, []);

  const handleDismissTransactionDetails = useCallback(() => {
    setSelectedTransaction(null);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <Animated.View entering={FadeIn.duration(180)} style={styles.headerFrame}>
          <Pressable
            style={({ pressed }) => [styles.headerIconBtn, pressed && styles.headerIconBtnPressed]}
            onPress={handleBack}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <View
              style={[{ backgroundColor: colors.surface.cardElevated }, styles.headerIconGlass]}
            >
              <Ionicons
                name="chevron-back"
                size={layout.iconSizeNav}
                color={colors.brand.glossAccent}
              />
            </View>
          </Pressable>
          <Text
            variant="h2"
            color={colors.text.inverse}
            style={[styles.headerTitle, compact && styles.headerTitleCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            maxFontSizeMultiplier={1.1}
          >
            Recent Activity
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              pressed && !transactionsQuery.isRefetching && styles.headerIconBtnPressed,
            ]}
            onPress={handleRefresh}
            disabled={!transactionsQuery.isCapabilityEnabled || transactionsQuery.isRefetching}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Refresh transaction history"
            accessibilityState={{
              busy: transactionsQuery.isRefetching,
              disabled: !transactionsQuery.isCapabilityEnabled || transactionsQuery.isRefetching,
            }}
          >
            <View
              style={[{ backgroundColor: colors.surface.cardElevated }, styles.headerIconGlass]}
            >
              {transactionsQuery.isRefetching ? (
                <Animated.View
                  key="history-refresh-loader"
                  entering={FadeIn.duration(100)}
                  exiting={FadeOut.duration(80)}
                  style={styles.refreshLoader}
                >
                  <LazyLoadingSpinner size={refreshIconSize} color={colors.brand.glossAccent} />
                </Animated.View>
              ) : (
                <Animated.View
                  key="history-refresh-icon"
                  entering={FadeIn.duration(100)}
                  exiting={FadeOut.duration(80)}
                  style={styles.refreshIcon}
                >
                  <PuffyRefreshIcon
                    size={refreshIconSize}
                    color={
                      transactionsQuery.isCapabilityEnabled
                        ? colors.brand.glossAccent
                        : colors.text.tertiary
                    }
                  />
                </Animated.View>
              )}
            </View>
          </Pressable>
        </Animated.View>
      </View>

      <StaggerRevealItem index={0} style={styles.listLayer}>
        <HistoryList
          transactionsQuery={transactionsQuery}
          localReceipts={localReceipts}
          tokenLogos={tokenLogoMap}
          onTransactionPress={handleTransactionPress}
        />
      </StaggerRevealItem>
      <TransactionDetailsSheet
        transaction={selectedTransaction}
        tokenLogos={tokenLogoMap}
        onDismiss={handleDismissTransactionDetails}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  header: {
    paddingTop: spacing.xl,
    marginBottom: spacing.xs,
    alignItems: 'center',
    zIndex: 1,
  },
  headerFrame: {
    width: '100%',
    maxWidth: 430,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: HEADER_CONTAINER_SHADOW,
  },
  headerIconBtnPressed: {
    opacity: 0.72,
  },
  headerIconGlass: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.display,
    textAlign: 'center',
  },
  headerTitleCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  refreshLoader: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  listLayer: {
    flex: 1,
    width: '100%',
  },
});
