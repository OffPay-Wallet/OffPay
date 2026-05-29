import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { formatTokenBalance, shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import type { SendTokenOption } from './types';

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
}): { fontSize: number; lineHeight: number; width: number } {
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
      : Math.max(MIN_AMOUNT_FONT_SIZE, Math.floor(baseFontSize * (targetTextWidth / estimatedBaseWidth)));
  const estimatedScaledWidth = estimateAmountTextWidth(value, fontSize);

  return {
    fontSize,
    lineHeight: Math.min(baseLineHeight, Math.max(18, Math.ceil(fontSize * 1.18))),
    width: Math.min(availableWidth, Math.max(32, Math.ceil(estimatedScaledWidth + AMOUNT_INPUT_BREATHING_ROOM))),
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

  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.step}>
      <View style={styles.toRow}>
        <Text variant="bodyBold" color={colors.text.secondary} numberOfLines={1}>
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
                width: amountTextStyle.width,
                height: amountTextStyle.lineHeight + 6,
                fontSize: amountTextStyle.fontSize,
                lineHeight: amountTextStyle.lineHeight,
              },
            ]}
            selectionColor={colors.brand.azureCyan}
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
        <Text variant="h3" color={colors.text.secondary} align="center" style={styles.metaLabel}>
          {amountMetaLabel}
        </Text>
      </View>

      <View style={styles.availableCard}>
        <View>
          <Text variant="small" color={colors.text.secondary}>
            Available To Send
          </Text>
          <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
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

      {selfSend ? (
        <View style={styles.warningBox}>
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
        </View>
      ) : null}

      {helper != null ? (
        <Text variant="small" color={colors.semantic.warning} style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: spacing.lg,
  },
  toRow: {
    minHeight: 56,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    boxShadow: `0 12px 24px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.76)`,
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
    backgroundColor: colors.glass.textBacking,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountHero: {
    minHeight: 260,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    boxShadow: `0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.12)`,
  },
  amountInputRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: AMOUNT_SYMBOL_GAP,
  },
  amountInput: {
    color: colors.text.primary,
    fontFamily: fontFamily.mono,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  symbol: {
    fontFamily: fontFamily.semiBold,
    flexShrink: 1,
  },
  metaLabel: {
    fontFamily: fontFamily.semiBold,
  },
  availableCard: {
    minHeight: 86,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    boxShadow: `0 12px 24px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.76)`,
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
    backgroundColor: colors.glass.textBacking,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningBox: {
    minHeight: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.semantic.warning,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningText: {
    lineHeight: 20,
    includeFontPadding: false,
  },
  helper: {
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.78,
  },
});
