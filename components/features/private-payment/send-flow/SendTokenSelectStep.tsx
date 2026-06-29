import { memo, useCallback } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { FiatMoneyText } from '@/components/ui/FiatMoneyText';
import { FiatUnitPriceText } from '@/components/ui/FiatUnitPriceText';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { formatTokenBalance } from '@/lib/api/offpay-wallet-data';
import { lookupSendTokenValuation } from './helpers';

import type { TokenValuationView } from '@/hooks/useOffpayTokenValuations';
import type { SendTokenOption } from './types';

interface SendTokenSelectStepProps {
  query: string;
  tokens: SendTokenOption[];
  tokenValuations?: Readonly<Record<string, TokenValuationView>>;
  loading: boolean;
  emptyMessage: string;
  onQueryChange: (value: string) => void;
  onSelectToken: (token: SendTokenOption) => void;
}

const SEND_PANEL_SHADOW =
  '0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const SEND_CONTROL_SHADOW =
  '0 14px 30px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const TOKEN_ROW_HEIGHT = 78;
const TOKEN_ROW_COMPACT_HEIGHT = 70;
const TOKEN_ROW_DENSE_HEIGHT = 64;
const TOKEN_LIST_MAX_HEIGHT_RATIO = 0.54;
const TOKEN_LIST_MIN_HEIGHT = 152;
const TOKEN_LIST_BOTTOM_PADDING = spacing.xs;

function TokenLoadingRow({
  compact,
  dense,
}: {
  compact: boolean;
  dense: boolean;
}): React.JSX.Element {
  const iconSize = dense ? 32 : compact ? 34 : 40;
  return (
    <View style={styles.tokenRowShell}>
      <View
        style={[
          { backgroundColor: colors.surface.cardElevated },
          [styles.tokenRow, compact && styles.tokenRowCompact, dense && styles.tokenRowDense],
        ]}
      >
        <SkeletonBlock width={iconSize} height={iconSize} radius={radii.full} />
        <View style={styles.tokenText}>
          <SkeletonBlock width="42%" height={16} radius={radii.full} />
          <SkeletonBlock width="64%" height={12} radius={radii.full} />
        </View>
        <View style={styles.balanceColumn}>
          <SkeletonBlock width="72%" height={14} radius={radii.full} />
          <SkeletonBlock width="46%" height={11} radius={radii.full} />
        </View>
      </View>
    </View>
  );
}

function hasNumericLabel(value: string | null | undefined): value is string {
  return typeof value === 'string' && /\d/.test(value);
}

interface SendTokenRowProps {
  token: SendTokenOption;
  valuation?: TokenValuationView;
  compact: boolean;
  dense: boolean;
  tokenIconSize: number;
  verifiedIconSize: number;
  balanceColumnWidth: number;
  onSelectToken: (token: SendTokenOption) => void;
}

const SendTokenRow = memo(function SendTokenRow({
  token,
  valuation,
  compact,
  dense,
  tokenIconSize,
  verifiedIconSize,
  balanceColumnWidth,
  onSelectToken,
}: SendTokenRowProps): React.JSX.Element {
  const fiatValueLabel = hasNumericLabel(valuation?.fiatValueLabel)
    ? valuation.fiatValueLabel
    : null;
  const unitPriceLabel = hasNumericLabel(valuation?.unitPriceLabel)
    ? valuation.unitPriceLabel
    : null;

  return (
    <Pressable
      style={({ pressed }) => [styles.tokenRowShell, pressed && styles.rowPressed]}
      onPress={() => onSelectToken(token)}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Send ${token.symbol}`}
    >
      <View
        style={[
          { backgroundColor: colors.surface.cardElevated },
          [styles.tokenRow, compact && styles.tokenRowCompact, dense && styles.tokenRowDense],
        ]}
      >
        <TokenIcon
          symbol={token.symbol}
          name={token.name}
          logoUri={token.logo}
          size={tokenIconSize}
          recyclingKey={token.mint}
        />
        <View style={styles.tokenText}>
          <View style={styles.nameRow}>
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={[styles.tokenSymbol, dense && styles.tokenSymbolDense]}
              numberOfLines={1}
              ellipsizeMode="tail"
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              maxFontSizeMultiplier={1}
            >
              {token.symbol}
            </Text>
            {token.verified ? (
              <Ionicons
                name="checkmark-circle"
                size={verifiedIconSize}
                color={colors.semantic.success}
              />
            ) : null}
          </View>
          <Text
            variant="small"
            color={colors.text.secondary}
            numberOfLines={1}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1}
          >
            {token.name}
          </Text>
        </View>
        <View style={[styles.balanceColumn, { width: balanceColumnWidth }]}>
          {fiatValueLabel != null ? (
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
          ) : (
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={[styles.balanceValue, dense && styles.balanceValueDense]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.64}
              maxFontSizeMultiplier={1}
            >
              {formatTokenBalance(token.balance, 5)}
            </Text>
          )}
          {unitPriceLabel != null ? (
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
          ) : (
            <Text
              variant="small"
              color={colors.text.secondary}
              style={[styles.balanceMeta, dense && styles.balanceMetaDense]}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              {formatTokenBalance(token.balance, 5)} {token.symbol}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
});

function TokenRowSeparator(): React.JSX.Element {
  return <View style={styles.tokenRowSeparator} />;
}

export function SendTokenSelectStep({
  query,
  tokens,
  tokenValuations,
  loading,
  emptyMessage,
  onQueryChange,
  onSelectToken,
}: SendTokenSelectStepProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 350 || fontScale > 1.18;
  const tokenIconSize = dense ? 32 : compact ? 36 : 40;
  const verifiedIconSize = dense ? 14 : compact ? 15 : 16;
  const balanceColumnWidth = dense ? 86 : compact ? 102 : 118;
  const tokenRowHeight = dense
    ? TOKEN_ROW_DENSE_HEIGHT
    : compact
      ? TOKEN_ROW_COMPACT_HEIGHT
      : TOKEN_ROW_HEIGHT;
  const tokenListMaxHeight = Math.max(
    TOKEN_LIST_MIN_HEIGHT,
    Math.floor(windowHeight * TOKEN_LIST_MAX_HEIGHT_RATIO),
  );
  const tokenListContentHeight =
    tokens.length * tokenRowHeight +
    Math.max(0, tokens.length - 1) * spacing.sm +
    TOKEN_LIST_BOTTOM_PADDING;
  const tokenListHeight = Math.min(tokenListMaxHeight, tokenListContentHeight);

  const keyExtractor = useCallback((token: SendTokenOption) => token.mint, []);
  const renderTokenRow = useCallback(
    ({ item: token }: ListRenderItemInfo<SendTokenOption>) => (
      <SendTokenRow
        token={token}
        valuation={lookupSendTokenValuation(token.mint, tokenValuations)}
        compact={compact}
        dense={dense}
        tokenIconSize={tokenIconSize}
        verifiedIconSize={verifiedIconSize}
        balanceColumnWidth={balanceColumnWidth}
        onSelectToken={onSelectToken}
      />
    ),
    [
      balanceColumnWidth,
      compact,
      dense,
      onSelectToken,
      tokenIconSize,
      tokenValuations,
      verifiedIconSize,
    ],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[styles.step, compact && styles.stepCompact]}
    >
      <View style={[styles.copyBlock, compact && styles.copyBlockCompact]}>
        <Text
          variant="h3"
          color={colors.text.primary}
          style={[styles.stepTitle, compact && styles.stepTitleCompact]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          maxFontSizeMultiplier={1}
        >
          Choose token
        </Text>
        <Text
          variant="caption"
          color={colors.text.secondary}
          style={styles.stepSubtitle}
          numberOfLines={2}
          maxFontSizeMultiplier={1}
        >
          Select any wallet token with a sendable balance.
        </Text>
      </View>

      <View style={styles.searchShell}>
        <View
          style={[
            { backgroundColor: colors.surface.cardElevated },
            [styles.searchRow, dense && styles.searchRowDense],
          ]}
        >
          <Ionicons name="search" size={layout.iconSizeInline} color={colors.text.secondary} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search token"
            placeholderTextColor={colors.text.placeholder}
            style={styles.searchInput}
            selectionColor={colors.brand.glossAccent}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1}
            accessibilityLabel="Search wallet tokens"
          />
        </View>
      </View>

      <View style={loading ? styles.loadingTokenList : styles.tokenList}>
        {loading ? (
          Array.from({ length: dense ? 2 : 3 }, (_, index) => (
            <TokenLoadingRow key={`send-token-loading-${index}`} compact={compact} dense={dense} />
          ))
        ) : tokens.length > 0 ? (
          <FlashList<SendTokenOption>
            style={{ height: tokenListHeight, width: '100%' }}
            data={tokens}
            renderItem={renderTokenRow}
            keyExtractor={keyExtractor}
            ItemSeparatorComponent={TokenRowSeparator}
            contentContainerStyle={styles.tokenListContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={tokens.length * tokenRowHeight > tokenListMaxHeight}
            nestedScrollEnabled
            drawDistance={tokenRowHeight * 3}
          />
        ) : (
          <View style={styles.emptyShell}>
            <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.emptyState]}>
              <Ionicons name="wallet-outline" size={dense ? 28 : 32} color={colors.text.tertiary} />
              <Text variant="bodyBold" color={colors.text.primary} align="center">
                No tokens found
              </Text>
              <Text
                variant="small"
                color={colors.text.secondary}
                align="center"
                style={styles.emptyText}
              >
                {emptyMessage}
              </Text>
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing.xl,
  },
  stepCompact: {
    gap: spacing.lg,
  },
  copyBlock: {
    gap: spacing.xs,
  },
  copyBlockCompact: {
    gap: 2,
  },
  stepTitle: {
    fontFamily: fontFamily.displaySemiBold,
  },
  stepTitleCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  stepSubtitle: {
    lineHeight: 20,
  },
  searchShell: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SEND_CONTROL_SHADOW,
  },
  searchRow: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  searchRowDense: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
  tokenList: {
    width: '100%',
  },
  loadingTokenList: {
    gap: spacing.sm,
  },
  tokenListContent: {
    paddingBottom: TOKEN_LIST_BOTTOM_PADDING,
  },
  tokenRowSeparator: {
    height: spacing.sm,
  },
  tokenRowShell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SEND_PANEL_SHADOW,
  },
  tokenRow: {
    minHeight: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tokenRowCompact: {
    minHeight: 70,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  tokenRowDense: {
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.72,
  },
  tokenText: {
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
  tokenSymbol: {
    flexShrink: 1,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 17,
    lineHeight: 22,
  },
  tokenSymbolDense: {
    fontSize: 15,
    lineHeight: 19,
  },
  balanceColumn: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  balanceValue: {
    fontFamily: fontFamily.moneyBold,
    textAlign: 'right',
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
  },
  balanceValueDense: {
    fontSize: 13,
    lineHeight: 17,
  },
  balanceMeta: {
    fontFamily: fontFamily.moneyLight,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 14,
    includeFontPadding: false,
  },
  balanceMetaDense: {
    fontSize: 10,
    lineHeight: 13,
  },
  fiatValueWrap: {
    alignSelf: 'flex-end',
  },
  unitPriceWrap: {
    alignSelf: 'flex-end',
  },
  emptyShell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SEND_PANEL_SHADOW,
  },
  emptyState: {
    minHeight: 140,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    lineHeight: 18,
  },
});
