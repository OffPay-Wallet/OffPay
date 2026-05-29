/**
 * History screen — chronological list of wallet transactions.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { InteractionManager, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PuffyRefreshIcon } from '@/components/ui/icons/PuffyRefreshIcon';
import { Text } from '@/components/ui/Text';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { HistoryList } from '@/components/features/history/HistoryList';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import {
  isOffpayOfflineP2pReceipt,
  shortenWalletAddress,
} from '@/lib/api/offpay-wallet-data';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';

import type { OffpayLocalReceiptViewInput } from '@/lib/api/offpay-wallet-data';
import type { PrivatePaymentReceipt } from '@/store/privatePaymentStore';
import type { UmbraPrivacyReceipt } from '@/store/umbraPrivacyStore';

function runAfterTapFrame(task: () => void): void {
  requestAnimationFrame(() => {
    InteractionManager.runAfterInteractions(task);
  });
}

/**
 * Map an Umbra-side receipt (claim / shield / unshield / register /
 * mixer-register) into the `OffpayLocalReceiptViewInput` shape that
 * `buildWalletHistoryGroups` already understands. This lets the
 * shared history list group claim activity alongside on-chain
 * transactions and offline-P2P receipts without growing a new
 * receipt-type pathway.
 */
function mapUmbraReceiptToHistoryInput(receipt: UmbraPrivacyReceipt): OffpayLocalReceiptViewInput {
  // 'unshield' moves value back to the public balance; everything
  // else either deposits into the encrypted balance or is a registry
  // operation. Direction is best-effort and only used for the row
  // amount tone in the history list.
  const direction: 'send' | 'receive' = receipt.action === 'unshield' ? 'receive' : 'send';
  return {
    id: `umbra-${receipt.action}-${receipt.id}`,
    direction,
    status: 'settled',
    title: receipt.title,
    subtitle: receipt.subtitle,
    createdAt: receipt.createdAt,
    signature: receipt.signature ?? null,
    privacyLabel: 'Private',
  };
}

function mapAgenticPrivateReceiptToHistoryInput(
  receipt: PrivatePaymentReceipt,
): OffpayLocalReceiptViewInput {
  const decimals =
    typeof receipt.tokenDecimals === 'number' && Number.isFinite(receipt.tokenDecimals)
      ? receipt.tokenDecimals
      : 6;
  const symbol = receipt.tokenSymbol?.trim() || 'USDC';
  const amountLabel = `-${formatAtomicAmount(receipt.amount, decimals)} ${symbol}`;
  const reference = receipt.signature ?? receipt.txId ?? receipt.id;

  return {
    id: `agentic-private-send-${receipt.network}-${reference}`,
    direction: 'send',
    status: receipt.status === 'queued' ? 'queued' : 'settled',
    title: 'Yuga transfer',
    subtitle: `To ${shortenWalletAddress(receipt.recipient)}`,
    amountLabel,
    rawAmount: receipt.amount,
    tokenMint: receipt.mint,
    tokenSymbol: receipt.tokenSymbol ?? symbol,
    tokenName: receipt.tokenName ?? receipt.tokenSymbol ?? symbol,
    tokenLogo: receipt.tokenLogo ?? null,
    tokenDecimals: decimals,
    createdAt: receipt.createdAt,
    signature: receipt.signature,
    recipient: receipt.recipient,
    routeLabel: 'Yuga Transfer',
    privacyLabel: receipt.route === 'normal' ? 'Public route' : 'Private route',
    programLabel:
      receipt.route === 'normal' ? 'Normal transfer' : receipt.route === 'umbra' ? 'Umbra' : 'MagicBlock',
  };
}

const HEADER_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const HEADER_CONTAINER_SHADOW =
  '0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.1)';

export function HistoryScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const router = useRouter();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);
  const { network } = useOffpayNetwork();
  const offlineReceipts = useOfflinePaymentStore((s) => s.receipts);
  const privatePaymentReceipts = usePrivatePaymentStore((s) => s.receipts);
  const umbraReceipts = useUmbraPrivacyStore((s) => s.receipts);
  const localReceipts = useMemo<OffpayLocalReceiptViewInput[]>(() => {
    const offline: OffpayLocalReceiptViewInput[] = offlineReceipts.filter(
      (receipt) =>
        (network == null || receipt.network === network) && isOffpayOfflineP2pReceipt(receipt),
    );
    const umbraInputs: OffpayLocalReceiptViewInput[] = umbraReceipts
      .filter((receipt) => network == null || receipt.network === network)
      .map(mapUmbraReceiptToHistoryInput);
    const agenticPrivateInputs = privatePaymentReceipts
      .filter(
        (receipt) =>
          receipt.source === 'agentic' && (network == null || receipt.network === network),
      )
      .map(mapAgenticPrivateReceiptToHistoryInput);
    return [...offline, ...umbraInputs, ...agenticPrivateInputs];
  }, [network, offlineReceipts, privatePaymentReceipts, umbraReceipts]);
  const transactionsQuery = useOffpayWalletTransactions({
    autoFetchAllPages: false,
    deferUntilAfterInteractions: true,
    // Hydrated display-cache rows can be missing transaction metadata
    // after an earlier RPC enrichment miss. Always refetch on entry so
    // those placeholders are replaced after the tab transition settles.
    refetchOnMount: 'always',
  });
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.08;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const refreshIconSize = dense ? 15 : compact ? 16 : 18;

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
  // being scheduled by an InteractionManager callback that resolves
  // after the screen has already lost focus.
  const getScreenSignal = useScreenAbortSignal();

  const refreshHistory = useCallback(() => {
    if (!transactionsQuery.isCapabilityEnabled) return;
    const signal = getScreenSignal();
    runAfterTapFrame(() => {
      if (signal.aborted) return;
      void transactionsQuery.refetch();
    });
    // The wrapper `transactionsQuery` is a fresh object every render;
    // we deliberately depend on the stable inner accessors so the
    // callback identity stays pinned and FlashList does not rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionsQuery.isCapabilityEnabled, transactionsQuery.refetch, getScreenSignal]);

  // First focus is already covered by the initial query mount — only
  // refetch on subsequent focuses (i.e., when the user re-enters the
  // tab from another screen). Without this guard, the very first
  // navigation into History would fire the API twice.
  const hasFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return undefined;
      }
      refreshHistory();
      return undefined;
    }, [refreshHistory]),
  );

  const handleRefresh = refreshHistory;

  const handleTransactionPress = (transactionId: string) => {
    router.push(`/transaction-details?id=${encodeURIComponent(transactionId)}` as never);
  };

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
            <LinearGradient
              colors={[...HEADER_GLASS_COLORS]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerIconGlass}
            >
              <Ionicons
                name="chevron-back"
                size={layout.iconSizeNav}
                color={colors.brand.azureCyan}
              />
            </LinearGradient>
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
            <LinearGradient
              colors={[...HEADER_GLASS_COLORS]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerIconGlass}
            >
              {transactionsQuery.isRefetching ? (
                <Animated.View
                  key="history-refresh-loader"
                  entering={FadeIn.duration(100)}
                  exiting={FadeOut.duration(80)}
                  style={styles.refreshLoader}
                >
                  <LazyLoadingSpinner size={refreshIconSize} color={colors.brand.azureCyan} />
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
                        ? colors.brand.azureCyan
                        : colors.text.tertiary
                    }
                  />
                </Animated.View>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.duration(180)} style={styles.listLayer}>
        <HistoryList
          transactionsQuery={transactionsQuery}
          localReceipts={localReceipts}
          onTransactionPress={handleTransactionPress}
        />
      </Animated.View>
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
