/**
 * RecentActivityCard — glass-styled card for transaction history.
 *
 * Displays either:
 *   - A list of recent transactions (when available)
 *   - An empty state with a subtle animation prompt
 *
 * Uses the same neutral glossy glass material as the home header,
 * portfolio card, and token holdings card.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TransactionActivityRow } from '@/components/features/history/TransactionActivityRow';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { OffpayRecentActivityView, TokenLogoLookup } from '@/lib/api/offpay-wallet-data';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Transaction = OffpayRecentActivityView;

interface RecentActivityCardProps {
  /** Section title */
  title?: string;
  /** List of recent transactions backed by the current OffPay wallet surfaces. */
  transactions: Transaction[];
  /** Called when a transaction row is tapped */
  onTransactionPress?: (transaction: Transaction) => void;
  /** Called when "View All" is tapped */
  onViewAll?: () => void;
  statusLabel?: string | null;
  emptyTitle?: string;
  emptySubtitle?: string;
  privacyHidden?: boolean;
  loading?: boolean;
  /**
   * Token logo lookup. Pass the same map the parent already owns so
   * this card never needs to subscribe to the wallet-balance / swap-
   * tokens queries on its own — every extra subscriber forces the
   * component tree to re-render whenever those queries refetch.
   */
  tokenLogos: TokenLogoLookup;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Flat card treatment — see BalanceCard. Soft ambient lift + 1px top
// highlight only, with neutral dark depth instead of coloured glow.
const HOME_CONTAINER_SHADOW =
  '0 12px 26px rgba(0, 0, 0, 0.42), inset 0 1px 1px rgba(255, 255, 255, 0.14)';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Single transaction row */
const TransactionRow = memo(function TransactionRow({
  transaction,
  compact,
  onPress,
  privacyHidden,
  tokenLogos,
}: {
  transaction: Transaction;
  compact: boolean;
  onPress?: (transaction: Transaction) => void;
  privacyHidden: boolean;
  tokenLogos: TokenLogoLookup;
}): React.JSX.Element {
  return (
    <TransactionActivityRow
      tx={transaction}
      compact={compact}
      onPress={onPress == null ? undefined : () => onPress(transaction)}
      privacyHidden={privacyHidden}
      variant="home"
      tokenLogos={tokenLogos}
    />
  );
});

/** Empty state — shown when no transactions exist */
function EmptyState({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="time-outline" size={layout.iconSizeTab} color={colors.text.tertiary} />
      </View>
      <Text variant="body" color={colors.text.secondary} style={styles.emptyTitle}>
        {title}
      </Text>
      <Text variant="small" color={colors.text.tertiary} style={styles.emptySubtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

function ActivityRowSkeleton({ compact }: { compact: boolean }): React.JSX.Element {
  return (
    <View style={[styles.skeletonRow, compact && styles.skeletonRowCompact]}>
      <SkeletonBlock width={compact ? 42 : 48} height={compact ? 42 : 48} radius={999} />
      <View style={styles.skeletonTextCol}>
        <SkeletonBlock width="44%" height={compact ? 14 : 16} radius={8} />
        <SkeletonBlock
          width="58%"
          height={compact ? 11 : 12}
          radius={8}
          style={styles.skeletonSubline}
        />
      </View>
      <SkeletonBlock width={compact ? 76 : 88} height={compact ? 12 : 14} radius={8} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RecentActivityCard({
  title = 'Recent Activity',
  transactions,
  onTransactionPress,
  onViewAll,
  statusLabel,
  emptyTitle = 'No transactions yet',
  emptySubtitle = 'Your transaction history will appear here',
  privacyHidden = false,
  loading = false,
  tokenLogos,
}: RecentActivityCardProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const hasTransactions = transactions.length > 0;

  return (
    <View style={styles.section}>
      {/* Section header with optional "View All" */}
      <View style={[styles.headerRow, compact && styles.headerRowCompact]}>
        {loading ? (
          <SkeletonBlock
            width={compact ? 122 : 142}
            height={18}
            radius={radii.full}
            style={styles.sectionTitle}
          />
        ) : (
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.86}
            maxFontSizeMultiplier={1}
          >
            {title}
          </Text>
        )}
        {loading ? (
          <SkeletonBlock width={54} height={18} radius={radii.full} />
        ) : hasTransactions && onViewAll != null ? (
          <Pressable
            style={styles.viewAllButton}
            onPress={onViewAll}
            accessibilityRole="button"
            accessibilityLabel="View all transactions"
            hitSlop={6}
          >
            <Text
              variant="captionBold"
              color={colors.semantic.info}
              style={styles.viewAllText}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              View All
            </Text>
          </Pressable>
        ) : null}
      </View>
      {loading && statusLabel != null ? (
        <SkeletonBlock width="64%" height={12} radius={radii.full} style={styles.statusLabel} />
      ) : statusLabel != null ? (
        <Text
          variant="small"
          color={colors.text.tertiary}
          style={styles.statusLabel}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={1}
        >
          {statusLabel}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: compact ? 2 : 3 }, (_, index) => (
            <View style={styles.cardShell} key={`activity-skeleton-${index}`}>
              <View style={styles.cardSurface}>
                <ActivityRowSkeleton compact={compact} />
              </View>
            </View>
          ))}
        </View>
      ) : hasTransactions ? (
        <View style={styles.list}>
          {transactions.map((tx) => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              compact={compact}
              onPress={onTransactionPress}
              privacyHidden={privacyHidden}
              tokenLogos={tokenLogos}
            />
          ))}
        </View>
      ) : (
        <View style={styles.cardShell}>
          <View style={styles.cardSurface}>
            <EmptyState title={emptyTitle} subtitle={emptySubtitle} />
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  headerRowCompact: {
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fontFamily.displaySemiBold,
    flex: 1,
    minWidth: 0,
  },
  sectionTitleCompact: {
    fontSize: 18,
    lineHeight: 23,
  },
  viewAllButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  viewAllText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  statusLabel: {
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },

  /* Card shell */
  cardShell: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: colors.surface.cardElevated,
    boxShadow: HOME_CONTAINER_SHADOW,
  },
  cardSurface: {
    paddingVertical: spacing.xs,
    position: 'relative',
    backgroundColor: 'transparent',
  },

  /* Transaction row */
  list: {
    gap: spacing.sm,
  },

  /* Empty state */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    gap: spacing.sm,
  },
  emptyIconWrap: {
    width: layout.avatarLg,
    height: layout.avatarLg,
    borderRadius: radii.full,
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontFamily: fontFamily.uiMedium,
  },
  emptySubtitle: {
    textAlign: 'center',
  },
  skeletonRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  skeletonRowCompact: {
    minHeight: 66,
    paddingVertical: spacing.sm,
  },
  skeletonTextCol: {
    flex: 1,
    minWidth: 0,
  },
  skeletonSubline: {
    marginTop: spacing.xs,
  },
});
