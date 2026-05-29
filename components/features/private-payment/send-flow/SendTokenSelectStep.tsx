import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { formatTokenBalance } from '@/lib/api/offpay-wallet-data';

import type { SendTokenOption } from './types';

interface SendTokenSelectStepProps {
  query: string;
  tokens: SendTokenOption[];
  loading: boolean;
  emptyMessage: string;
  onQueryChange: (value: string) => void;
  onSelectToken: (token: SendTokenOption) => void;
}

const SEND_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const SEND_PANEL_SHADOW =
  '0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.12)';
const SEND_CONTROL_SHADOW =
  '0 8px 16px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.86), inset 0 -8px 14px rgba(91, 200, 232, 0.1)';

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
      <LinearGradient
        colors={[...SEND_GLASS_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.tokenRow, compact && styles.tokenRowCompact, dense && styles.tokenRowDense]}
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
      </LinearGradient>
    </View>
  );
}

export function SendTokenSelectStep({
  query,
  tokens,
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
        <LinearGradient
          colors={[...SEND_GLASS_COLORS]}
          start={{ x: 0.04, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.searchRow, dense && styles.searchRowDense]}
        >
          <Ionicons name="search" size={layout.iconSizeInline} color={colors.text.secondary} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search token"
            placeholderTextColor={colors.text.placeholder}
            style={styles.searchInput}
            selectionColor={colors.brand.azureCyan}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1}
            accessibilityLabel="Search wallet tokens"
          />
        </LinearGradient>
      </View>

      <View style={styles.tokenList}>
        {loading ? (
          Array.from({ length: dense ? 2 : 3 }, (_, index) => (
            <TokenLoadingRow key={`send-token-loading-${index}`} compact={compact} dense={dense} />
          ))
        ) : tokens.length > 0 ? (
          tokens.map((token) => (
            <Pressable
              key={token.mint}
              style={({ pressed }) => [styles.tokenRowShell, pressed && styles.rowPressed]}
              onPress={() => onSelectToken(token)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Send ${token.symbol}`}
            >
              <LinearGradient
                colors={[...SEND_GLASS_COLORS]}
                start={{ x: 0.04, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.tokenRow,
                  compact && styles.tokenRowCompact,
                  dense && styles.tokenRowDense,
                ]}
              >
                <TokenIcon
                  symbol={token.symbol}
                  name={token.name}
                  logoUri={token.logo}
                  size={tokenIconSize}
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
                  <Text
                    variant="small"
                    color={colors.text.secondary}
                    style={styles.balanceSymbol}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1}
                  >
                    {token.symbol}
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>
          ))
        ) : (
          <View style={styles.emptyShell}>
            <LinearGradient
              colors={[...SEND_GLASS_COLORS]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.emptyState}
            >
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
            </LinearGradient>
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
    gap: spacing.sm,
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
    fontFamily: fontFamily.uiSemiBold,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  balanceValueDense: {
    fontSize: 13,
    lineHeight: 17,
  },
  balanceSymbol: {
    textAlign: 'right',
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
