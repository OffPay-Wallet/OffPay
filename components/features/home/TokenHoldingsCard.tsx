/**
 * TokenHoldingsCard — token holdings list with compact valuation rows.
 *
 * Renders a list of token holdings with:
 *   - API token logos when available
 *   - 5-decimal token amounts
 *   - verified ticks from API/provider metadata
 *   - real token valuation labels when price data is available
 */
import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { FiatMoneyText } from '@/components/ui/FiatMoneyText';
import { FiatUnitPriceText } from '@/components/ui/FiatUnitPriceText';
import { SlotText } from '@/components/ui/SlotText';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

import type { TokenValuationView } from '@/hooks/useOffpayTokenValuations';
import type { OffpayTokenHoldingView } from '@/lib/api/offpay-wallet-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenHolding = OffpayTokenHoldingView;

interface TokenHoldingsCardProps {
  /** Section title displayed above the card */
  title?: string;
  holdings: TokenHolding[];
  /** Called when a token row is tapped */
  onTokenPress?: (holding: TokenHolding) => void;
  /** Called when "View All" is tapped */
  onViewAll?: () => void;
  emptyTitle?: string;
  emptySubtitle?: string;
  hiddenSpamTokenCount?: number;
  privacyHidden?: boolean;
  valuations?: Readonly<Record<string, TokenValuationView>>;
  loading?: boolean;
  separatedRows?: boolean;
}

function hasNumericLabel(value: string | null | undefined): value is string {
  return typeof value === 'string' && /\d/.test(value);
}

// Flat card treatment — single ambient shadow for lift on dark surfaces.
// Inset shadows are invisible on Android and cause extra GPU blur passes.
const HEADER_CONTAINER_SHADOW = '0 10px 22px rgba(0, 0, 0, 0.4)';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Single token row — extracted to minimise re-renders */
const TokenRow = memo(function TokenRow({
  holding,
  isLast,
  compact,
  dense,
  onPress,
  privacyHidden,
  valuation,
}: {
  holding: TokenHolding;
  isLast: boolean;
  compact: boolean;
  dense: boolean;
  onPress?: (holding: TokenHolding) => void;
  privacyHidden: boolean;
  valuation?: TokenValuationView;
}): React.JSX.Element {
  const [pressed, setPressed] = useState(false);
  const amountLabel = privacyHidden ? '****' : `${holding.balance} ${holding.symbol}`;
  const fiatValueLabel = privacyHidden
    ? '****'
    : hasNumericLabel(valuation?.fiatValueLabel)
      ? valuation.fiatValueLabel
      : '--';
  const unitPriceLabel = privacyHidden
    ? '****'
    : hasNumericLabel(valuation?.unitPriceLabel)
      ? valuation.unitPriceLabel
      : null;
  const iconSize = dense ? 30 : compact ? 32 : 38;
  const valueColumnWidth = dense ? 90 : compact ? 112 : 136;
  const interactive = onPress != null;

  const resetPressed = useCallback((): void => {
    setPressed(false);
  }, []);

  const handlePressIn = useCallback((): void => {
    if (!interactive) return;
    setPressed(true);
  }, [interactive]);

  const handlePress = useCallback((): void => {
    if (!interactive) return;
    resetPressed();
    onPress?.(holding);
  }, [holding, interactive, onPress, resetPressed]);

  return (
    <Pressable
      style={[
        styles.row,
        compact && styles.rowCompact,
        dense && styles.rowDense,
        !isLast && styles.rowBorder,
        pressed && interactive && styles.rowPressed,
      ]}
      disabled={!interactive}
      onPressIn={interactive ? handlePressIn : undefined}
      onPressOut={interactive ? resetPressed : undefined}
      onPress={interactive ? handlePress : undefined}
      onResponderTerminate={resetPressed}
      onResponderTerminationRequest={() => true}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={`${holding.name} balance: ${privacyHidden ? 'hidden' : amountLabel}`}
    >
      <View
        style={[styles.iconWrap, compact && styles.iconWrapCompact, dense && styles.iconWrapDense]}
      >
        <TokenIcon
          symbol={holding.symbol}
          name={holding.name}
          logoUri={holding.logo}
          size={iconSize}
          recyclingKey={holding.mint}
        />
      </View>

      <View style={styles.tokenInfo}>
        <View style={styles.nameRow}>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={[
              styles.tokenName,
              compact && styles.tokenNameCompact,
              dense && styles.tokenNameDense,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1}
          >
            {holding.name}
          </Text>
          {holding.verified ? (
            <Ionicons
              name="checkmark-circle"
              size={dense ? 14 : compact ? 15 : 16}
              color={colors.semantic.success}
              style={styles.verifiedIcon}
            />
          ) : null}
        </View>
        <Text
          variant="small"
          color={colors.text.secondary}
          style={[
            styles.amountText,
            compact && styles.amountTextCompact,
            dense && styles.amountTextDense,
          ]}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1}
        >
          {amountLabel}
        </Text>
      </View>

      <View style={[styles.valueCol, { width: valueColumnWidth }]}>
        <SlotText
          value={fiatValueLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.58}
          maxFontSizeMultiplier={1}
        >
          <FiatMoneyText
            value={fiatValueLabel}
            size="list"
            compact={compact || dense}
            align="right"
            color={colors.text.primary}
            style={styles.fiatValueWrap}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.58}
            maxFontSizeMultiplier={1}
          />
        </SlotText>
        {unitPriceLabel != null ? (
          <SlotText
            value={unitPriceLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
            maxFontSizeMultiplier={1}
          >
            <FiatUnitPriceText
              value={unitPriceLabel}
              size="caption"
              compact={compact || dense}
              align="right"
              color={colors.text.secondary}
              style={styles.unitPriceWrap}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.62}
              maxFontSizeMultiplier={1}
            />
          </SlotText>
        ) : null}
      </View>
    </Pressable>
  );
});

export { TokenRow };

export function TokenRowSkeleton({
  compact,
  dense,
  isLast,
}: {
  compact: boolean;
  dense: boolean;
  isLast: boolean;
}): React.JSX.Element {
  const iconSize = dense ? 30 : compact ? 32 : 38;
  return (
    <View
      style={[
        styles.row,
        compact && styles.rowCompact,
        dense && styles.rowDense,
        !isLast && styles.rowBorder,
      ]}
    >
      <SkeletonBlock width={iconSize} height={iconSize} radius={999} />
      <View style={styles.tokenInfo}>
        <SkeletonBlock width="54%" height={compact ? 14 : 16} radius={8} />
        <SkeletonBlock
          width="42%"
          height={compact ? 11 : 12}
          radius={8}
          style={styles.skeletonSubline}
        />
      </View>
      <View style={[styles.valueCol, { width: dense ? 90 : compact ? 112 : 136 }]}>
        <SkeletonBlock width="78%" height={compact ? 13 : 15} radius={8} />
        <SkeletonBlock
          width="64%"
          height={compact ? 10 : 11}
          radius={8}
          style={styles.skeletonValueSubline}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TokenHoldingsCard({
  title = 'Holdings',
  holdings,
  onTokenPress,
  onViewAll,
  emptyTitle = 'No tokens found',
  emptySubtitle,
  hiddenSpamTokenCount = 0,
  privacyHidden = false,
  valuations,
  loading = false,
  separatedRows = false,
}: TokenHoldingsCardProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 360 || fontScale > 1.18;
  const hasHoldings = holdings.length > 0;
  return (
    <View style={styles.section}>
      {/* Section header with optional "View All" */}
      <View style={[styles.headerRow, compact && styles.headerRowCompact]}>
        {loading ? (
          <SkeletonBlock
            width={compact ? 86 : 104}
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
        ) : hasHoldings && onViewAll != null ? (
          <Pressable
            style={styles.viewAllButton}
            onPress={onViewAll}
            accessibilityRole="button"
            accessibilityLabel="View all holdings"
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
      {hiddenSpamTokenCount > 0 ? (
        <Text variant="small" color={colors.text.tertiary} style={styles.spamNotice}>
          {hiddenSpamTokenCount} spam token{hiddenSpamTokenCount === 1 ? '' : 's'} hidden
        </Text>
      ) : null}

      <View style={[separatedRows ? styles.separatedList : styles.cardShell]}>
        <View style={[styles.cardSurface, separatedRows && styles.hiddenWhenSeparated]}>
          {separatedRows ? null : loading ? (
            Array.from({ length: compact ? 2 : 3 }, (_, index) => (
              <TokenRowSkeleton
                key={`token-skeleton-${index}`}
                compact={compact}
                dense={dense}
                isLast={index === (compact ? 1 : 2)}
              />
            ))
          ) : holdings.length > 0 ? (
            holdings.map((holding, index) => (
              <TokenRow
                key={holding.mint}
                holding={holding}
                isLast={index === holdings.length - 1}
                compact={compact}
                dense={dense}
                onPress={onTokenPress}
                privacyHidden={privacyHidden}
                valuation={valuations?.[holding.mint]}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons
                name="wallet-outline"
                size={dense ? 26 : compact ? 28 : 32}
                color={colors.text.tertiary}
              />
              <Text variant="caption" color={colors.text.secondary} style={styles.emptyText}>
                {emptyTitle}
              </Text>
              {emptySubtitle != null ? (
                <Text variant="small" color={colors.text.tertiary} style={styles.emptySubtext}>
                  {emptySubtitle}
                </Text>
              ) : null}
            </View>
          )}
        </View>
        {separatedRows ? (
          loading ? (
            Array.from({ length: compact ? 3 : 4 }, (_, index) => (
              <View style={styles.rowCardShell} key={`token-separated-skeleton-${index}`}>
                <View style={styles.cardSurface}>
                  <TokenRowSkeleton compact={compact} dense={dense} isLast />
                </View>
              </View>
            ))
          ) : holdings.length > 0 ? (
            holdings.map((holding) => (
              <View style={styles.rowCardShell} key={holding.mint}>
                <View style={styles.cardSurface}>
                  <TokenRow
                    holding={holding}
                    isLast
                    compact={compact}
                    dense={dense}
                    onPress={onTokenPress}
                    privacyHidden={privacyHidden}
                    valuation={valuations?.[holding.mint]}
                  />
                </View>
              </View>
            ))
          ) : (
            <View style={styles.rowCardShell}>
              <View style={styles.cardSurface}>
                <View style={styles.emptyState}>
                  <Ionicons
                    name="wallet-outline"
                    size={dense ? 26 : compact ? 28 : 32}
                    color={colors.text.tertiary}
                  />
                  <Text variant="caption" color={colors.text.secondary} style={styles.emptyText}>
                    {emptyTitle}
                  </Text>
                  {emptySubtitle != null ? (
                    <Text variant="small" color={colors.text.tertiary} style={styles.emptySubtext}>
                      {emptySubtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          )
        ) : null}
      </View>
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
  spamNotice: {
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },

  cardShell: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: HEADER_CONTAINER_SHADOW,
  },
  cardSurface: {
    paddingVertical: spacing.xs,
    backgroundColor: 'transparent',
  },
  hiddenWhenSeparated: {
    display: 'none',
  },
  separatedList: {
    gap: spacing.sm,
  },
  rowCardShell: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: HEADER_CONTAINER_SHADOW,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minWidth: 0,
    minHeight: 74,
  },
  rowCompact: {
    minHeight: 66,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  rowDense: {
    minHeight: 60,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  rowPressed: {
    backgroundColor: colors.glass.textBacking,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.holdingsCard.divider,
  },

  /* Token icon */
  iconWrap: {
    width: 38,
    height: 38,
    flexShrink: 0,
  },
  iconWrapCompact: {
    width: 32,
    height: 32,
  },
  iconWrapDense: {
    width: 30,
    height: 30,
  },

  /* Token info column */
  tokenInfo: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  tokenName: {
    fontFamily: fontFamily.uiSemiBold,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 20,
  },
  tokenNameCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  tokenNameDense: {
    fontSize: 13,
    lineHeight: 17,
  },
  verifiedIcon: {
    flexShrink: 0,
  },
  amountText: {
    fontFamily: fontFamily.moneyLight,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 17,
  },
  amountTextCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  amountTextDense: {
    fontSize: 11,
    lineHeight: 14,
  },
  skeletonSubline: {
    marginTop: spacing.xs,
  },
  skeletonValueSubline: {
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },

  /* Balance column */
  valueCol: {
    width: 124,
    alignItems: 'flex-end',
    gap: 1,
    flexShrink: 0,
    minWidth: 0,
  },
  fiatValueWrap: {
    alignSelf: 'flex-end',
  },
  unitPriceWrap: {
    alignSelf: 'flex-end',
  },

  /* Empty state */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamily.uiMedium,
    textAlign: 'center',
  },
  emptySubtext: {
    textAlign: 'center',
  },
});
