import { memo, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { TokenIcon } from '@/components/ui/TokenIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { PuffySwapIcon } from '@/components/ui/icons/PuffySwapIcon';
import { SWAP_CONTROL_SHADOW, SWAP_PANEL_SHADOW } from './swapGlass';

import type { SwapTokenOption } from './types';

interface SwapCardProps {
  payToken: SwapTokenOption;
  receiveToken: SwapTokenOption;
  payAmount: string;
  receiveAmount: string;
  onPayAmountChange: (amount: string) => void;
  onFlip: () => void;
  onSelectToken: (type: 'pay' | 'receive') => void;
}

const MIN_AMOUNT_FONT_SIZE = 8;
const AMOUNT_INPUT_SIDE_BREATHING_ROOM = 6;

function getFractionDigits(value: string): number {
  const decimalIndex = value.indexOf('.');
  return decimalIndex >= 0 ? value.length - decimalIndex - 1 : 0;
}

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
  fieldWidth,
  baseFontSize,
  baseLineHeight,
}: {
  value: string;
  fieldWidth: number;
  baseFontSize: number;
  baseLineHeight: number;
}): { fontSize: number; lineHeight: number } {
  if (fieldWidth <= 0) {
    return { fontSize: baseFontSize, lineHeight: baseLineHeight };
  }

  const targetWidth = Math.max(1, fieldWidth - AMOUNT_INPUT_SIDE_BREATHING_ROOM);
  const estimatedWidth = estimateAmountTextWidth(value, baseFontSize);
  const fontSize =
    estimatedWidth <= targetWidth
      ? baseFontSize
      : Math.max(MIN_AMOUNT_FONT_SIZE, Math.floor(baseFontSize * (targetWidth / estimatedWidth)));

  return {
    fontSize,
    lineHeight: Math.min(baseLineHeight, Math.max(14, Math.ceil(fontSize * 1.18))),
  };
}

function formatQuickAmount(value: number, referenceAmount: string): string {
  if (!Number.isFinite(value)) return '';

  return value.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: Math.min(Math.max(getFractionDigits(referenceAmount), 2), 9),
  });
}

export const SwapCard = memo(function SwapCard({
  payToken,
  receiveToken,
  payAmount,
  receiveAmount,
  onPayAmountChange,
  onFlip,
  onSelectToken,
}: SwapCardProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [activePill, setActivePill] = useState<'0' | '50%' | 'Max' | null>(null);
  const [payInputWidth, setPayInputWidth] = useState(0);
  const [receiveInputWidth, setReceiveInputWidth] = useState(0);
  const compact = windowWidth < 390 || windowHeight < 820 || fontScale > 1.05;
  const dense = windowWidth < 350 || windowHeight < 720 || fontScale > 1.18;
  const cardPadding = dense ? spacing.md : compact ? 14 : spacing.lg;
  const assetBlockMinHeight = dense ? 124 : compact ? 134 : 148;
  const receiveBlockMinHeight = dense ? 104 : compact ? 114 : 126;
  const tokenIconSize = dense ? 22 : compact ? 24 : 26;
  const tokenPillMinHeight = dense ? 36 : compact ? 38 : 42;
  const tokenCheckIconSize = dense ? 15 : compact ? 16 : 17;
  const tokenChevronSize = dense ? 17 : 18;
  const directionSize = dense ? 38 : compact ? 42 : 46;
  const directionIconSize = dense ? 15 : compact ? 16 : 18;
  const amountBaseFontSize = dense ? 24 : compact ? 28 : 32;
  const amountBaseLineHeight = dense ? 30 : compact ? 34 : 39;
  const amountInputHeight = dense ? 34 : compact ? 38 : 42;
  const payAmountTextStyle = getScaledAmountTextStyle({
    value: payAmount,
    fieldWidth: payInputWidth,
    baseFontSize: amountBaseFontSize,
    baseLineHeight: amountBaseLineHeight,
  });
  const receiveAmountTextStyle = getScaledAmountTextStyle({
    value: receiveAmount,
    fieldWidth: receiveInputWidth,
    baseFontSize: amountBaseFontSize,
    baseLineHeight: amountBaseLineHeight,
  });

  const rotation = useSharedValue(90);
  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handleFlip = () => {
    rotation.value = withTiming(rotation.value + 180, {
      duration: 350,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
    onFlip();
  };

  const balanceVal = Number.parseFloat(payToken.balanceValue || '0');

  const handleManualInput = (value: string) => {
    setActivePill(null);
    onPayAmountChange(value);
  };

  const handlePillSelect = (type: '0' | '50%' | 'Max', value: string) => {
    setActivePill(type);
    onPayAmountChange(value);
  };

  const handlePayInputLayout = (width: number) => {
    const nextWidth = Math.round(width);
    setPayInputWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  };

  const handleReceiveInputLayout = (width: number) => {
    const nextWidth = Math.round(width);
    setReceiveInputWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  };

  return (
    <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.container]}>
      <View
        style={[
          styles.assetBlock,
          styles.payBlock,
          { padding: cardPadding, minHeight: assetBlockMinHeight },
        ]}
      >
        <View style={styles.blockHeader}>
          <Text variant="captionBold" color={colors.text.secondary} style={styles.blockLabel}>
            You Pay
          </Text>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { height: amountInputHeight }, payAmountTextStyle]}
            value={payAmount}
            onChangeText={handleManualInput}
            onLayout={(event) => handlePayInputLayout(event.nativeEvent.layout.width)}
            placeholder="0"
            placeholderTextColor="rgba(16, 16, 16, 0.18)"
            keyboardType="decimal-pad"
            selectionColor={colors.brand.glossAccent}
            numberOfLines={1}
            multiline={false}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            accessibilityLabel={`Amount to pay in ${payToken.symbol}`}
          />
          <Pressable
            style={({ pressed }) => [
              styles.assetPill,
              { minHeight: tokenPillMinHeight },
              pressed ? styles.controlPressed : null,
            ]}
            onPress={() => onSelectToken('pay')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Select pay token. Current token ${payToken.symbol}`}
          >
            <TokenIcon
              symbol={payToken.symbol}
              name={payToken.name}
              logoUri={payToken.logo}
              size={tokenIconSize}
            />
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={[styles.assetSymbol, dense && styles.assetSymbolDense]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {payToken.symbol}
            </Text>
            {payToken.verified ? (
              <Ionicons
                name="checkmark-circle"
                size={tokenCheckIconSize}
                color={colors.brand.glossAccent}
              />
            ) : null}
            <Ionicons
              name="chevron-down"
              size={tokenChevronSize}
              color={colors.text.secondary}
              style={styles.chevron}
            />
          </Pressable>
        </View>
        <View style={styles.quickAmountRow}>
          <View style={styles.quickPillContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.quickPill,
                compact && styles.quickPillCompact,
                activePill === '0' && styles.quickPillActive,
                pressed ? styles.controlPressed : null,
              ]}
              onPress={() => handlePillSelect('0', '')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: activePill === '0' }}
              accessibilityLabel="Clear amount"
            >
              <Text
                variant="caption"
                color={activePill === '0' ? colors.brand.graphiteDepth : colors.text.secondary}
              >
                0
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.quickPill,
                compact && styles.quickPillCompact,
                activePill === '50%' && styles.quickPillActive,
                pressed ? styles.controlPressed : null,
              ]}
              onPress={() =>
                handlePillSelect(
                  '50%',
                  Number.isFinite(balanceVal)
                    ? formatQuickAmount(balanceVal / 2, payToken.balanceValue)
                    : '',
                )
              }
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: activePill === '50%' }}
              accessibilityLabel="Use half of available balance"
            >
              <Text
                variant="caption"
                color={activePill === '50%' ? colors.brand.graphiteDepth : colors.text.secondary}
              >
                50%
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.quickPill,
                compact && styles.quickPillCompact,
                activePill === 'Max' && styles.quickPillActive,
                pressed ? styles.controlPressed : null,
              ]}
              onPress={() => handlePillSelect('Max', payToken.balanceValue)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: activePill === 'Max' }}
              accessibilityLabel="Use maximum available balance"
            >
              <Text
                variant="caption"
                color={activePill === 'Max' ? colors.brand.graphiteDepth : colors.text.secondary}
              >
                Max
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.toggleWrapper}>
        <Pressable
          style={({ pressed }) => [
            styles.toggleButton,
            { width: directionSize, height: directionSize },
            pressed ? styles.controlPressed : null,
          ]}
          onPress={handleFlip}
          accessibilityRole="button"
          accessibilityLabel="Swap direction"
        >
          <Animated.View style={animatedIconStyle}>
            <PuffySwapIcon size={directionIconSize} color={colors.brand.glossAccent} focused />
          </Animated.View>
        </Pressable>
      </View>

      <View style={[styles.assetBlock, { padding: cardPadding, minHeight: receiveBlockMinHeight }]}>
        <View style={styles.blockHeader}>
          <Text variant="captionBold" color={colors.text.secondary} style={styles.blockLabel}>
            You Receive
          </Text>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { height: amountInputHeight },
              receiveAmountTextStyle,
              styles.receiveInput,
            ]}
            value={receiveAmount}
            editable={false}
            onLayout={(event) => handleReceiveInputLayout(event.nativeEvent.layout.width)}
            placeholder="0"
            placeholderTextColor="rgba(16, 16, 16, 0.18)"
            numberOfLines={1}
            multiline={false}
            allowFontScaling={false}
            maxFontSizeMultiplier={1}
            accessibilityLabel={`Estimated amount to receive in ${receiveToken.symbol}`}
          />
          <Pressable
            style={({ pressed }) => [
              styles.assetPill,
              { minHeight: tokenPillMinHeight },
              pressed ? styles.controlPressed : null,
            ]}
            onPress={() => onSelectToken('receive')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Select receive token. Current token ${receiveToken.symbol}`}
          >
            <TokenIcon
              symbol={receiveToken.symbol}
              name={receiveToken.name}
              logoUri={receiveToken.logo}
              size={tokenIconSize}
            />
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={[styles.assetSymbol, dense && styles.assetSymbolDense]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {receiveToken.symbol}
            </Text>
            {receiveToken.verified ? (
              <Ionicons
                name="checkmark-circle"
                size={tokenCheckIconSize}
                color={colors.brand.glossAccent}
              />
            ) : null}
            <Ionicons
              name="chevron-down"
              size={tokenChevronSize}
              color={colors.text.secondary}
              style={styles.chevron}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SWAP_PANEL_SHADOW,
    overflow: 'hidden',
  },
  assetBlock: {
    padding: spacing.xl,
  },
  payBlock: {
    backgroundColor: colors.glass.clearFill,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.holdingsCard.divider,
  },
  blockHeader: {
    marginBottom: spacing.xs,
  },
  blockLabel: {
    fontFamily: fontFamily.displaySemiBold,
    color: colors.text.secondary,
    fontSize: 14,
    lineHeight: 18,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    minWidth: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.bold,
    fontSize: 32,
    lineHeight: 39,
    height: 42,
    padding: 0,
    margin: 0,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  receiveInput: {
    opacity: 0.84,
  },
  assetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glass.strongFill,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    minWidth: 0,
    flexShrink: 1,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  assetSymbol: {
    minWidth: 0,
    flexShrink: 1,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  assetSymbolDense: {
    fontSize: 14,
    lineHeight: 18,
  },
  chevron: {
    marginLeft: 2,
  },
  quickAmountRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  quickPillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  quickPill: {
    minHeight: 28,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.glass.strongFill,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickPillCompact: {
    minHeight: 26,
    paddingHorizontal: spacing.sm,
  },
  quickPillActive: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.glass.rim,
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  controlPressed: {
    opacity: 0.72,
  },
  toggleWrapper: {
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  toggleButton: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: SWAP_CONTROL_SHADOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
