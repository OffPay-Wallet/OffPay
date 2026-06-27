import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { buildWalletHistoryGroups } from '@/lib/api/offpay-wallet-data';
import { TransactionCard } from './TransactionCard';
import { getHistoryLoadingState } from './history-loading-state';

import type {
  OffpayHistoryTransactionGroup,
  OffpayHistoryTransactionView,
  TokenLogoLookup,
  OffpayLocalReceiptViewInput,
} from '@/lib/api/offpay-wallet-data';
import type { UseOffpayWalletTransactionsResult } from '@/hooks/useOffpayWalletTransactions';
import type { OfflinePaymentReceipt } from '@/store/offlinePaymentStore';

type HistoryRow =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'item'; key: string; transaction: OffpayHistoryTransactionView };

function getQueryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const HISTORY_CONTAINER_SHADOW =
  '0 16px 34px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const HISTORY_ROW_ESTIMATED_HEIGHT = 88;
const HISTORY_MIN_SKELETON_ROWS = 7;
const HISTORY_MAX_SKELETON_ROWS = 10;
const HISTORY_RENDER_AHEAD_MIN_PX = 900;
const EMPTY_HISTORY_ROWS: HistoryRow[] = [];

interface HistoryListProps {
  transactionsQuery: UseOffpayWalletTransactionsResult;
  localReceipts?: readonly (OffpayLocalReceiptViewInput | OfflinePaymentReceipt)[];
  includeUnmatchedLocalReceipts?: boolean;
  tokenLogos: TokenLogoLookup;
  onTransactionPress?: (transaction: OffpayHistoryTransactionView) => void;
}

function flattenHistorySections(sections: OffpayHistoryTransactionGroup[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const section of sections) {
    rows.push({
      kind: 'header',
      key: `header-${section.title}`,
      title: section.title,
    });
    for (const transaction of section.data) {
      rows.push({
        kind: 'item',
        key: transaction.id,
        transaction,
      });
    }
  }
  return rows;
}

interface HistoryItemRowProps {
  transaction: OffpayHistoryTransactionView;
  tokenLogos: TokenLogoLookup;
  compact: boolean;
  contentFrameWidth: number;
  onTransactionPress?: (transaction: OffpayHistoryTransactionView) => void;
}

const HistoryItemRow = React.memo(function HistoryItemRow({
  transaction,
  tokenLogos,
  compact,
  contentFrameWidth,
  onTransactionPress,
}: HistoryItemRowProps): React.JSX.Element {
  return (
    <View style={[styles.itemFrame, { width: contentFrameWidth }]}>
      <TransactionCard
        tx={transaction}
        tokenLogos={tokenLogos}
        compact={compact}
        onPress={onTransactionPress}
      />
    </View>
  );
});

interface HistorySectionHeaderProps {
  title: string;
  compact: boolean;
  contentFrameWidth: number;
  isFirstSection?: boolean;
}

const HistorySectionHeader = React.memo(function HistorySectionHeader({
  title,
  compact,
  contentFrameWidth,
  isFirstSection,
}: HistorySectionHeaderProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.sectionHeaderFrame,
        isFirstSection && styles.sectionHeaderFrameFirst,
        { width: contentFrameWidth },
      ]}
    >
      <Text
        variant="bodyBold"
        color={colors.text.secondary}
        style={[styles.sectionHeader, compact && styles.sectionHeaderCompact]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.86}
        maxFontSizeMultiplier={1}
      >
        {title}
      </Text>
    </View>
  );
});

function HistorySkeletonRow({ compact }: { compact: boolean }): React.JSX.Element {
  const iconSize = compact ? 42 : 46;
  return (
    <View style={[styles.skeletonRow, compact && styles.skeletonRowCompact]}>
      <SkeletonBlock width={iconSize} height={iconSize} radius={radii.full} />
      <View style={styles.skeletonTextBlock}>
        <SkeletonBlock width="48%" height={compact ? 15 : 17} radius={radii.xs} />
        <SkeletonBlock width="72%" height={compact ? 12 : 14} radius={radii.xs} />
      </View>
      <SkeletonBlock width={compact ? 74 : 88} height={compact ? 13 : 15} radius={radii.xs} />
    </View>
  );
}

const HistorySkeletonPanel = React.memo(function HistorySkeletonPanel({
  compact,
  contentFrameWidth,
  rowCount,
}: {
  compact: boolean;
  contentFrameWidth: number;
  rowCount: number;
}): React.JSX.Element {
  return (
    <View style={[styles.contentFrame, styles.skeletonPanel, { width: contentFrameWidth }]}>
      <SkeletonBlock width={116} height={18} radius={radii.xs} style={styles.skeletonDate} />
      {Array.from({ length: rowCount }, (_, index) => (
        <HistorySkeletonRow key={`history-skeleton-${index}`} compact={compact} />
      ))}
    </View>
  );
});

export function HistoryList({
  transactionsQuery,
  localReceipts = [],
  includeUnmatchedLocalReceipts = true,
  tokenLogos,
  onTransactionPress,
}: HistoryListProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const sections = useMemo(() => {
    return buildWalletHistoryGroups({
      transactions: transactionsQuery.transactions,
      transactionViews: transactionsQuery.transactionViews,
      localReceipts,
      includeUnmatchedLocalReceipts,
      network: transactionsQuery.network,
    });
  }, [
    includeUnmatchedLocalReceipts,
    localReceipts,
    transactionsQuery.network,
    transactionsQuery.transactionViews,
    transactionsQuery.transactions,
  ]);
  const rows = useMemo(() => flattenHistorySections(sections), [sections]);

  // Extra padding at the bottom so we can scroll past the custom Tab Bar
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.xl;
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.sm : compact ? spacing.md : spacing.lg;
  const contentFrameWidth = Math.min(430, Math.max(0, windowWidth - horizontalPadding * 2));
  const skeletonRowCount = Math.min(
    HISTORY_MAX_SKELETON_ROWS,
    Math.max(HISTORY_MIN_SKELETON_ROWS, Math.ceil(windowHeight / HISTORY_ROW_ESTIMATED_HEIGHT)),
  );
  const renderAheadDistance = Math.max(HISTORY_RENDER_AHEAD_MIN_PX, Math.round(windowHeight * 1.4));
  const { showInitialLoader } = getHistoryLoadingState({
    rowCount: rows.length,
    isInitialDataPending: transactionsQuery.isInitialDataPending,
  });
  const emptyMessage = transactionsQuery.isCapabilityEnabled
    ? transactionsQuery.isError
      ? getQueryErrorMessage(transactionsQuery.error, 'Unable to load transaction history.')
      : 'Your transaction history will appear here.'
    : transactionsQuery.isCapabilitiesPending
      ? 'Checking activity access.'
      : transactionsQuery.capability.message;
  const emptyTitle = transactionsQuery.isCapabilityEnabled
    ? transactionsQuery.isLoading
      ? 'Loading activity'
      : transactionsQuery.isError
        ? 'Unable to load activity'
        : 'No activity yet'
    : transactionsQuery.isCapabilitiesPending
      ? 'Loading activity'
      : 'Activity unavailable';

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<HistoryRow>) => {
      if (item.kind === 'header') {
        return (
          <HistorySectionHeader
            title={item.title}
            compact={compact}
            contentFrameWidth={contentFrameWidth}
            isFirstSection={index === 0}
          />
        );
      }
      return (
        <HistoryItemRow
          transaction={item.transaction}
          tokenLogos={tokenLogos}
          compact={compact}
          contentFrameWidth={contentFrameWidth}
          onTransactionPress={onTransactionPress}
        />
      );
    },
    [compact, contentFrameWidth, onTransactionPress, tokenLogos],
  );

  // FlashList recycles separate row pools per item type. Distinguishing
  // headers from rows lets the recycler reuse the right view shape and
  // avoids rebuilding header/row trees on every scroll.
  const getItemType = useCallback((item: HistoryRow) => item.kind, []);
  const keyExtractor = useCallback((item: HistoryRow) => item.key, []);

  const loadMoreDisabled =
    !transactionsQuery.isCapabilityEnabled ||
    !transactionsQuery.hasNextPage ||
    transactionsQuery.isFetching ||
    transactionsQuery.isFetchingNextPage;
  const showLoadMoreFooter = transactionsQuery.isCapabilityEnabled && transactionsQuery.hasNextPage;

  const handleLoadMorePress = useCallback(() => {
    if (
      !transactionsQuery.isCapabilityEnabled ||
      !transactionsQuery.hasNextPage ||
      transactionsQuery.isFetching ||
      transactionsQuery.isFetchingNextPage
    ) {
      return;
    }

    void transactionsQuery.fetchNextPage({ requestOwnerSuffix: 'buttonPage' });
  }, [
    transactionsQuery.fetchNextPage,
    transactionsQuery.hasNextPage,
    transactionsQuery.isCapabilityEnabled,
    transactionsQuery.isFetching,
    transactionsQuery.isFetchingNextPage,
  ]);

  const ListEmpty = useMemo(
    () =>
      showInitialLoader ? (
        <HistorySkeletonPanel
          compact={compact}
          contentFrameWidth={contentFrameWidth}
          rowCount={skeletonRowCount}
        />
      ) : (
        <View style={[styles.contentFrame, { width: contentFrameWidth }]}>
          <View style={styles.emptyStateShell}>
            <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.emptyState]}>
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                style={styles.emptyTitle}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                maxFontSizeMultiplier={1}
              >
                {emptyTitle}
              </Text>
              <Text
                variant="small"
                color={colors.text.secondary}
                style={styles.emptySubtitle}
                numberOfLines={3}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                maxFontSizeMultiplier={1}
              >
                {emptyMessage}
              </Text>
            </View>
          </View>
        </View>
      ),
    [compact, contentFrameWidth, emptyMessage, emptyTitle, showInitialLoader, skeletonRowCount],
  );

  const ListFooter = useMemo(() => {
    if (!showLoadMoreFooter) return null;

    return (
      <View style={[styles.contentFrame, { width: contentFrameWidth }]}>
        <Pressable
          style={({ pressed }) => [
            styles.loadMoreButton,
            loadMoreDisabled && styles.loadMoreButtonDisabled,
            pressed && !loadMoreDisabled && styles.loadMoreButtonPressed,
          ]}
          onPress={handleLoadMorePress}
          disabled={loadMoreDisabled}
          accessibilityRole="button"
          accessibilityLabel="Load more transactions"
          accessibilityState={{
            busy: transactionsQuery.isFetchingNextPage,
            disabled: loadMoreDisabled,
          }}
        >
          <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.loadMoreGlass]}>
            {transactionsQuery.isFetchingNextPage ? (
              <LazyLoadingSpinner size={18} color={colors.semantic.info} />
            ) : null}
            <Text
              variant="captionBold"
              color={colors.semantic.info}
              style={styles.loadMoreText}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              {transactionsQuery.isFetchingNextPage ? 'Loading' : 'Load more'}
            </Text>
          </View>
        </Pressable>
      </View>
    );
    // The wrapper `transactionsQuery` is a fresh object every render;
    // we deliberately track the stable inner accessors so this memo
    // does not invalidate every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    contentFrameWidth,
    handleLoadMorePress,
    loadMoreDisabled,
    showLoadMoreFooter,
    transactionsQuery.isFetchingNextPage,
  ]);

  return (
    <FlashList<HistoryRow>
      data={showInitialLoader ? EMPTY_HISTORY_ROWS : rows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      ListEmptyComponent={ListEmpty}
      ListFooterComponent={ListFooter}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: bottomPadding, paddingHorizontal: horizontalPadding },
      ]}
      drawDistance={renderAheadDistance}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
  },
  contentFrame: {
    alignSelf: 'center',
  },
  skeletonPanel: {
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  skeletonDate: {
    marginLeft: spacing.xs,
    marginBottom: spacing.xs,
  },
  paginationSpinner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  skeletonRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: colors.surface.cardElevated,
    boxShadow: '0 10px 22px rgba(0, 0, 0, 0.32)',
  },
  skeletonRowCompact: {
    minHeight: 74,
    gap: spacing.sm,
  },
  skeletonTextBlock: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  itemFrame: {
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sectionHeaderFrame: {
    alignSelf: 'center',
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.sm,
  },
  sectionHeaderFrameFirst: {
    paddingTop: spacing.xs,
  },
  sectionHeader: {
    textTransform: 'none',
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.2,
    textAlign: 'left',
    paddingHorizontal: spacing.xs,
    color: colors.text.secondary,
  },
  sectionHeaderCompact: {
    fontSize: 13,
    lineHeight: 17,
  },
  emptyStateShell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: HISTORY_CONTAINER_SHADOW,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.glass.strongFill,
  },
  emptyTitle: {
    textAlign: 'center',
    fontFamily: fontFamily.uiSemiBold,
  },
  emptySubtitle: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  footerSpacer: {
    minHeight: spacing.xl,
    marginVertical: spacing.xl,
  },
  loadMoreButton: {
    alignSelf: 'center',
    minHeight: layout.minTouchTarget,
    minWidth: 132,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: HISTORY_CONTAINER_SHADOW,
  },
  loadMoreButtonPressed: {
    opacity: 0.74,
  },
  loadMoreButtonDisabled: {
    opacity: 0.82,
  },
  loadMoreGlass: {
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loadMoreText: {
    fontFamily: fontFamily.uiSemiBold,
  },
});
