import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { buildWalletHistoryGroups } from '@/lib/api/offpay-wallet-data';
import { TransactionCard } from './TransactionCard';

import type {
  OffpayHistoryTransactionGroup,
  OffpayHistoryTransactionView,
  TokenLogoLookup,
 OffpayLocalReceiptViewInput } from '@/lib/api/offpay-wallet-data';
import type { UseOffpayWalletTransactionsResult } from '@/hooks/useOffpayWalletTransactions';
import type { OfflinePaymentReceipt } from '@/store/offlinePaymentStore';

type HistoryRow =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'item'; key: string; transaction: OffpayHistoryTransactionView };

function getQueryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const HISTORY_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const HISTORY_CONTAINER_SHADOW =
  '0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.12)';

interface HistoryListProps {
  transactionsQuery: UseOffpayWalletTransactionsResult;
  localReceipts?: readonly (OffpayLocalReceiptViewInput | OfflinePaymentReceipt)[];
  includeUnmatchedLocalReceipts?: boolean;
  onTransactionPress?: (id: string) => void;
}

function flattenHistorySections(
  sections: OffpayHistoryTransactionGroup[],
): HistoryRow[] {
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
  onTransactionPress?: (id: string) => void;
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

export function HistoryList({
  transactionsQuery,
  localReceipts = [],
  includeUnmatchedLocalReceipts = true,
  onTransactionPress,
}: HistoryListProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const tokenLogos = useOffpayTokenLogoMap();
  const sections = useMemo(() => {
    return buildWalletHistoryGroups({
      transactions: transactionsQuery.transactions,
      localReceipts,
      includeUnmatchedLocalReceipts,
    });
  }, [includeUnmatchedLocalReceipts, localReceipts, transactionsQuery.transactions]);
  const rows = useMemo(() => flattenHistorySections(sections), [sections]);

  // Extra padding at the bottom so we can scroll past the custom Tab Bar
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.xl;
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.sm : compact ? spacing.md : spacing.lg;
  const contentFrameWidth = Math.min(430, Math.max(0, windowWidth - horizontalPadding * 2));
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

  const handleEndReached = useCallback(() => {
    if (
      transactionsQuery.isCapabilityEnabled &&
      transactionsQuery.hasNextPage &&
      !transactionsQuery.isFetchingNextPage
    ) {
      void transactionsQuery.fetchNextPage();
    }
    // Depending on the stable inner accessors instead of the wrapper
    // object keeps this callback memoised across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    transactionsQuery.fetchNextPage,
    transactionsQuery.hasNextPage,
    transactionsQuery.isCapabilityEnabled,
    transactionsQuery.isFetchingNextPage,
  ]);

  const ListEmpty = useMemo(
    () => (
      <View style={[styles.contentFrame, { width: contentFrameWidth }]}>
        <View style={styles.emptyStateShell}>
          <LinearGradient
            colors={[...HISTORY_GLASS_COLORS]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.emptyState}
          >
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
          </LinearGradient>
        </View>
      </View>
    ),
    [contentFrameWidth, emptyMessage, emptyTitle],
  );

  const ListFooter = useMemo(() => {
    if (transactionsQuery.isFetchingNextPage) {
      return <View style={styles.footerSpacer} />;
    }
    if (!transactionsQuery.hasNextPage) return null;
    return (
      <View style={[styles.contentFrame, { width: contentFrameWidth }]}>
        <Pressable
          style={({ pressed }) => [
            styles.loadMoreButton,
            pressed && styles.loadMoreButtonPressed,
          ]}
          onPress={() => {
            if (!transactionsQuery.isCapabilityEnabled) return;
            void transactionsQuery.fetchNextPage();
          }}
          accessibilityRole="button"
          accessibilityLabel="Load more transactions"
        >
          <LinearGradient
            colors={[...HISTORY_GLASS_COLORS]}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.loadMoreGlass}
          >
            <Text
              variant="captionBold"
              color={colors.semantic.info}
              style={styles.loadMoreText}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              Load more
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
    // The wrapper `transactionsQuery` is a fresh object every render;
    // we deliberately track the stable inner accessors so this memo
    // does not invalidate every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    contentFrameWidth,
    transactionsQuery.fetchNextPage,
    transactionsQuery.hasNextPage,
    transactionsQuery.isCapabilityEnabled,
    transactionsQuery.isFetchingNextPage,
  ]);

  return (
    <FlashList<HistoryRow>
      data={rows}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      ListEmptyComponent={ListEmpty}
      ListFooterComponent={ListFooter}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.4}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: bottomPadding, paddingHorizontal: horizontalPadding },
      ]}
      drawDistance={400}
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
    color: colors.text.tertiary,
    opacity: 0.85,
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
  loadMoreGlass: {
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreText: {
    fontFamily: fontFamily.uiSemiBold,
  },
});
