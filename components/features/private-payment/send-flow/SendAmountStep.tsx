import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { FiatMoneyText } from '@/components/ui/FiatMoneyText';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { formatTokenBalance, shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { parseFormattedFiatCurrency } from '@/lib/currency-rates';

import { PrivateRouteSelector } from './PrivateRouteSelector';
import type { PrivatePaymentRoute, PrivatePaymentRouteOption, SendTokenOption } from './types';

const MIN_AMOUNT_FONT_SIZE = 12;
const AMOUNT_INPUT_BREATHING_ROOM = 8;
const AMOUNT_SYMBOL_GAP = spacing.sm;

function estimateAmountTextWidth(value: string, fontSize: number): number {
  const displayValue = value.trim().length > 0 ? value.trim() : '0';

  return Array.from(displayValue).reduce((total, character) => {
    if (character === '.') return total + fontSize * 0.34;
    if (character === ',' || character === "'") return total + fontSize * 0.26;
    if (character === '-' || character === '+') return total + fontSize * 0.42;
    return total + fontSize * 0.64;
  }, 0);
}

function getScaledAmountTextStyle({
  value,
  rowWidth,
  symbolWidth,
  baseFontSize,
  baseLineHeight,
}: {
  value: string;
  rowWidth: number;
  symbolWidth: number;
  baseFontSize: number;
  baseLineHeight: number;
}): { fontSize: number; lineHeight: number } {
  const estimatedBaseWidth = estimateAmountTextWidth(value, baseFontSize);
  const measuredSymbolWidth = Math.max(symbolWidth, 64);
  const availableWidth =
    rowWidth > 0
      ? Math.max(48, rowWidth - measuredSymbolWidth - AMOUNT_SYMBOL_GAP)
      : Number.POSITIVE_INFINITY;
  const targetTextWidth = Math.max(1, availableWidth - AMOUNT_INPUT_BREATHING_ROOM);
  const fontSize =
    estimatedBaseWidth <= targetTextWidth
      ? baseFontSize
      : Math.max(
          MIN_AMOUNT_FONT_SIZE,
          Math.floor(baseFontSize * (targetTextWidth / estimatedBaseWidth)),
        );

  return {
    fontSize,
    lineHeight: Math.min(baseLineHeight, Math.max(18, Math.ceil(fontSize * 1.18))),
  };
}

interface SendAmountStepProps {
  token: SendTokenOption | null;
  recipientAddress: string | null;
  recipientInput: string;
  amount: string;
  amountMetaLabel: string;
  helper: string | null;
  selfSend: boolean;
  /** Private-route options (empty in offline mode). */
  routeOptions: PrivatePaymentRouteOption[];
  /** Currently selected private route, or null when no choice applies. */
  selectedRoute: PrivatePaymentRoute | null;
  onSelectRoute: (route: PrivatePaymentRoute) => void;
  onAmountChange: (value: string) => void;
  onMax: () => void;
  onEditRecipient: () => void;
}

export function SendAmountStep({
  token,
  recipientAddress,
  recipientInput,
  amount,
  amountMetaLabel,
  helper,
  selfSend,
  routeOptions,
  selectedRoute,
  onSelectRoute,
  onAmountChange,
  onMax,
  onEditRecipient,
}: SendAmountStepProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [amountRowWidth, setAmountRowWidth] = useState(0);
  const [symbolWidth, setSymbolWidth] = useState(0);
  const symbol = token?.symbol ?? '';
  const recipientLabel =
    recipientAddress != null ? shortenWalletAddress(recipientAddress) : recipientInput.trim();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 350 || fontScale > 1.18;
  const amountBaseFontSize = dense ? 38 : compact ? 42 : 46;
  const amountBaseLineHeight = dense ? 45 : compact ? 50 : 55;
  const symbolFontSize = dense ? 32 : compact ? 36 : 40;
  const symbolLineHeight = dense ? 38 : compact ? 43 : 48;
  const amountTextStyle = useMemo(() => {
    return getScaledAmountTextStyle({
      value: amount,
      rowWidth: amountRowWidth,
      symbolWidth,
      baseFontSize: amountBaseFontSize,
      baseLineHeight: amountBaseLineHeight,
    });
  }, [amount, amountBaseFontSize, amountBaseLineHeight, amountRowWidth, symbolWidth]);
  const fiatMetaParts = useMemo(
    () => parseFormattedFiatCurrency(amountMetaLabel),
    [amountMetaLabel],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition.duration(220)}
      style={styles.step}
    >
      <View style={styles.toRow}>
        <Text
          variant="bodyBold"
          color={colors.text.secondary}
          numberOfLines={1}
          style={styles.recipientText}
        >
          To: {recipientLabel}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
          onPress={onEditRecipient}
          accessibilityRole="button"
          accessibilityLabel="Edit recipient"
        >
          <Text variant="captionBold" color={colors.text.primary}>
            Edit
          </Text>
        </Pressable>
      </View>

      <View style={styles.amountHero}>
        <LinearGradient
          pointerEvents="none"
          colors={[
            colors.holdingsCard.gradientTop,
            colors.holdingsCard.gradientMid,
            colors.holdingsCard.gradientBottom,
          ]}
          locations={[0, 0.48, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.amountHeroSheen} />
        <View
          style={styles.amountInputRow}
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            setAmountRowWidth((current) => (current === nextWidth ? current : nextWidth));
          }}
        >
          <TextInput
            value={amount}
            onChangeText={onAmountChange}
            placeholder="0"
            placeholderTextColor={colors.text.placeholder}
            style={[
              styles.amountInput,
              {
                height: amountTextStyle.lineHeight + 6,
                fontSize: amountTextStyle.fontSize,
                lineHeight: amountTextStyle.lineHeight,
              },
            ]}
            selectionColor={colors.brand.glossAccent}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1}
            multiline={false}
            allowFontScaling={false}
            textAlign="right"
          />
          <Text
            variant="h1"
            color={colors.text.primary}
            style={[styles.symbol, { fontSize: symbolFontSize, lineHeight: symbolLineHeight }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1}
            onLayout={(event) => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);
              setSymbolWidth((current) => (current === nextWidth ? current : nextWidth));
            }}
          >
            {symbol}
          </Text>
        </View>
        {fiatMetaParts != null ? (
          <FiatMoneyText
            value={amountMetaLabel}
            parts={fiatMetaParts}
            size="list"
            compact={compact}
            color={colors.text.secondary}
            style={styles.metaLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            maxFontSizeMultiplier={1}
          />
        ) : (
          <Text variant="h3" color={colors.text.secondary} align="center" style={styles.metaLabel}>
            {amountMetaLabel}
          </Text>
        )}
      </View>

      <View style={styles.availableCard}>
        <View>
          <Text variant="small" color={colors.text.secondary}>
            Available To Send
          </Text>
          <Text
            variant="bodyBold"
            color={colors.text.primary}
            style={styles.availableBalance}
            numberOfLines={1}
          >
            {token != null ? `${formatTokenBalance(token.balance, 5)} ${token.symbol}` : '--'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.maxButton, pressed && styles.pressed]}
          onPress={onMax}
          accessibilityRole="button"
          accessibilityLabel="Use maximum amount"
        >
          <Text variant="buttonSmall" color={colors.text.primary}>
            Max
          </Text>
        </Pressable>
      </View>

      {/* Route choice is embedded here so the user picks Normal vs.
          private route up front, rather than on a separate summary
          screen. Renders nothing when no route choice applies. */}
      {routeOptions.length > 1 && selectedRoute != null ? (
        <Animated.View layout={LinearTransition.duration(220)} style={styles.routeBlock}>
          <Text variant="small" color={colors.text.secondary} style={styles.routeBlockLabel}>
            Route
          </Text>
          <PrivateRouteSelector
            routes={routeOptions}
            selectedRoute={selectedRoute}
            onSelectRoute={onSelectRoute}
          />
        </Animated.View>
      ) : null}

      {selfSend ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          layout={LinearTransition.duration(220)}
          style={styles.warningBox}
        >
          <Text
            variant="caption"
            color={colors.text.inverse}
            align="center"
            numberOfLines={3}
            maxFontSizeMultiplier={1}
            style={styles.warningText}
          >
            This is your current address. Sending will incur fees with no balance change.
          </Text>
        </Animated.View>
      ) : null}

      {helper != null ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}>
          <Text variant="small" color={colors.semantic.warning} style={styles.helper}>
            {helper}
          </Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing.lg,
  },
  toRow: {
    minHeight: 54,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.frostFill,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    boxShadow: [
      '0 10px 24px rgba(0, 0, 0, 0.34)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.16)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.28)',
    ].join(', '),
  },
  recipientText: {
    flex: 1,
    minWidth: 0,
  },
  editButton: {
    minHeight: 36,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.smokeWash,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountHero: {
    minHeight: 248,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    boxShadow: [
      '0 20px 44px rgba(0, 0, 0, 0.46)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.36)',
    ].join(', '),
  },
  amountHeroSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: colors.glass.smokeWash,
    opacity: 0.55,
  },
  amountInputRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: AMOUNT_SYMBOL_GAP,
  },
  amountInput: {
    flexShrink: 0,
    flexGrow: 0,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.mono,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  symbol: {
    fontFamily: fontFamily.semiBold,
    flexShrink: 0,
  },
  metaLabel: {
    alignSelf: 'center',
  },
  availableBalance: {
    fontFamily: fontFamily.moneyLight,
    includeFontPadding: false,
  },
  availableCard: {
    minHeight: 82,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.frostFill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    boxShadow: [
      '0 12px 28px rgba(0, 0, 0, 0.36)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.14)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.28)',
    ].join(', '),
  },
  maxButton: {
    minHeight: 44,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.smokeWash,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningBox: {
    borderRadius: radii.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.frostFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: ['0 8px 16px rgba(0, 0, 0, 0.2)', 'inset 0 1px 1px rgba(255, 255, 255, 0.1)'].join(
      ', ',
    ),
  },
  warningText: {
    lineHeight: 20,
    includeFontPadding: false,
  },
  helper: {
    lineHeight: 18,
  },
  routeBlock: {
    gap: spacing.xs,
  },
  routeBlockLabel: {
    fontFamily: fontFamily.uiMedium,
    paddingHorizontal: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
  },
});
