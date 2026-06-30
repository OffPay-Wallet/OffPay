import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type {
  EntryAnimationsValues,
  ExitAnimationsValues,
  LayoutAnimation,
} from 'react-native-reanimated';
import { FiatMoneyText } from '@/components/ui/FiatMoneyText';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { formatTokenBalance, shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { parseFormattedFiatCurrency } from '@/lib/currency-rates';
import { getViewportProfile } from '@/lib/ui/responsive-layout';

import type { PrivatePaymentRoute, PrivatePaymentRouteOption, SendTokenOption } from './types';

const MIN_AMOUNT_FONT_SIZE = 12;
const AMOUNT_DISPLAY_BREATHING_ROOM = 48;
const AMOUNT_SMOOTH_DURATION_MS = 80;
const AMOUNT_SMOOTH_DISTANCE = 2;
const AMOUNT_FEEDBACK_DURATION_MS = 120;
const DROPDOWN_MORPH_OPEN_DURATION_MS = 280;
const DROPDOWN_MORPH_CLOSE_DURATION_MS = 230;
const DROPDOWN_MORPH_FADE_DURATION_MS = 160;
const DROPDOWN_MORPH_TRANSLATE_Y = 6;
const DROPDOWN_MORPH_SCALE_X = 0.985;
const DROPDOWN_MORPH_WIDTH_START_SCALE = 0.72;
const DROPDOWN_MORPH_START_RADIUS = 16;
const KEYPAD_PRESS_IN_MS = 40;
const KEYPAD_PRESS_OUT_MS = 120;
const KEYPAD_PRESS_FILL = 'rgba(255, 255, 255, 0.035)';
const AMOUNT_SMOOTH_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const DROPDOWN_MORPH_EASING = Easing.bezier(0.2, 0, 0, 1);
const AMOUNT_FADE_EASING = Easing.out(Easing.quad);
const MAX_AMOUNT_WHOLE_DIGITS = 10;
const TOKEN_INPUT_EXTRA_HORIZONTAL_GAP = 6;
const AMOUNT_BREATHING_ROOM_HEIGHT_THRESHOLD = 820;
const TOKEN_DROPDOWN_ROW_HEIGHT = 48;
const TOKEN_DROPDOWN_TRIGGER_EXPANSION = 56;
const TOKEN_DROPDOWN_MAX_CARD_FRACTION = 0.72;
const TOKEN_DROPDOWN_SYMBOL_CHAR_WIDTH = 9.4;
const TOKEN_DROPDOWN_BALANCE_CHAR_WIDTH = 7.2;
const ROUTE_DROPDOWN_LABEL_CHAR_WIDTH = 8.8;
const ROUTE_DROPDOWN_DESCRIPTION_CHAR_WIDTH = 6.9;

type AmountMotionDirection = 'up' | 'down';

type NumpadKeyValue = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | '.' | 'backspace';

type AmountPresetValue = 0.25 | 0.5 | 0.75 | 'max';

const NUMPAD_ROWS: readonly (readonly NumpadKeyValue[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'backspace'],
] as const;

const AMOUNT_PRESET_OPTIONS: readonly { label: string; value: AmountPresetValue }[] = [
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: 'MAX', value: 'max' },
] as const;

function parseAmountNumber(value: string | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function stripTrailingDecimalZeros(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
}

function formatPresetAmount(balance: string, fraction: number, decimals: number): string {
  const balanceNumber = parseAmountNumber(balance);
  if (balanceNumber <= 0) return '';

  const fractionDigits = Math.min(Math.max(decimals, 0), 6);
  return stripTrailingDecimalZeros((balanceNumber * fraction).toFixed(fractionDigits));
}

function getAmountMotionDirection(
  currentAmount: string,
  nextAmount: string,
): AmountMotionDirection {
  const currentNumber = parseAmountNumber(currentAmount);
  const nextNumber = parseAmountNumber(nextAmount);
  return nextNumber < currentNumber ? 'down' : 'up';
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
  rowWidth,
  baseFontSize,
  baseLineHeight,
}: {
  value: string;
  rowWidth: number;
  baseFontSize: number;
  baseLineHeight: number;
}): { fontSize: number; lineHeight: number } {
  const estimatedBaseWidth = estimateAmountTextWidth(value, baseFontSize);
  const availableWidth =
    rowWidth > 0
      ? Math.max(48, rowWidth - AMOUNT_DISPLAY_BREATHING_ROOM)
      : Number.POSITIVE_INFINITY;
  const fontSize =
    estimatedBaseWidth <= availableWidth
      ? baseFontSize
      : Math.max(
          MIN_AMOUNT_FONT_SIZE,
          Math.floor(baseFontSize * (availableWidth / estimatedBaseWidth)),
        );

  return {
    fontSize,
    lineHeight: Math.min(baseLineHeight, Math.max(18, Math.ceil(fontSize * 1.18))),
  };
}

function formatDisplayAmount(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '0';

  const hasDecimal = trimmed.includes('.');
  const [wholePartRaw = '0', fractionPart = ''] = trimmed.split('.');
  const wholePart = wholePartRaw.length > 0 ? wholePartRaw : '0';
  const formattedWholePart = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return hasDecimal ? `${formattedWholePart}.${fractionPart}` : formattedWholePart;
}

function appendNumpadKey(
  currentAmount: string,
  key: NumpadKeyValue,
  maxFractionDigits: number,
): string {
  const current = currentAmount.trim();

  if (key === 'backspace') {
    if (current.length <= 1) return '';
    return current.slice(0, -1);
  }

  if (key === '.') {
    if (maxFractionDigits <= 0 || current.includes('.')) return current;
    return current.length === 0 ? '0.' : `${current}.`;
  }

  if (current.includes('.')) {
    const [wholePart = '', fractionPart = ''] = current.split('.');
    if (fractionPart.length >= maxFractionDigits) return current;
    if (wholePart.length > MAX_AMOUNT_WHOLE_DIGITS) return current;
    return `${current}${key}`;
  }

  if (current === '0') return key === '0' ? current : key;
  if (current.length >= MAX_AMOUNT_WHOLE_DIGITS) return current;
  return `${current}${key}`;
}

function feedbackEnter() {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 4 }],
    },
    animations: {
      opacity: withTiming(1, {
        duration: AMOUNT_FEEDBACK_DURATION_MS,
        easing: AMOUNT_FADE_EASING,
      }),
      transform: [
        {
          translateY: withTiming(0, {
            duration: AMOUNT_FEEDBACK_DURATION_MS,
            easing: AMOUNT_FADE_EASING,
          }),
        },
      ],
    },
  };
}

function feedbackExit() {
  'worklet';
  return {
    initialValues: {
      opacity: 1,
      transform: [{ translateY: 0 }],
    },
    animations: {
      opacity: withTiming(0, {
        duration: AMOUNT_FEEDBACK_DURATION_MS,
        easing: AMOUNT_FADE_EASING,
      }),
      transform: [
        {
          translateY: withTiming(-4, {
            duration: AMOUNT_FEEDBACK_DURATION_MS,
            easing: AMOUNT_FADE_EASING,
          }),
        },
      ],
    },
  };
}

function dropdownMorphEnter(values: EntryAnimationsValues): LayoutAnimation {
  'worklet';
  const targetRadius =
    typeof values.targetBorderRadius === 'number'
      ? values.targetBorderRadius
      : DROPDOWN_MORPH_START_RADIUS;
  const targetWidth = typeof values.targetWidth === 'number' ? values.targetWidth : null;

  return {
    initialValues: {
      opacity: 0,
      height: 0,
      ...(targetWidth != null
        ? { width: Math.max(1, targetWidth * DROPDOWN_MORPH_WIDTH_START_SCALE) }
        : {}),
      borderRadius: DROPDOWN_MORPH_START_RADIUS,
      transform: [{ translateY: -DROPDOWN_MORPH_TRANSLATE_Y }, { scaleX: DROPDOWN_MORPH_SCALE_X }],
    },
    animations: {
      opacity: withTiming(1, {
        duration: DROPDOWN_MORPH_FADE_DURATION_MS,
        easing: AMOUNT_FADE_EASING,
      }),
      height: withTiming(values.targetHeight, {
        duration: DROPDOWN_MORPH_OPEN_DURATION_MS,
        easing: DROPDOWN_MORPH_EASING,
      }),
      ...(targetWidth != null
        ? {
            width: withTiming(targetWidth, {
              duration: DROPDOWN_MORPH_OPEN_DURATION_MS,
              easing: DROPDOWN_MORPH_EASING,
            }),
          }
        : {}),
      borderRadius: withTiming(targetRadius, {
        duration: DROPDOWN_MORPH_OPEN_DURATION_MS,
        easing: DROPDOWN_MORPH_EASING,
      }),
      transform: [
        {
          translateY: withTiming(0, {
            duration: DROPDOWN_MORPH_OPEN_DURATION_MS,
            easing: DROPDOWN_MORPH_EASING,
          }),
        },
        {
          scaleX: withTiming(1, {
            duration: DROPDOWN_MORPH_OPEN_DURATION_MS,
            easing: DROPDOWN_MORPH_EASING,
          }),
        },
      ],
    },
  };
}

function dropdownMorphExit(values: ExitAnimationsValues): LayoutAnimation {
  'worklet';
  const currentRadius =
    typeof values.currentBorderRadius === 'number'
      ? values.currentBorderRadius
      : DROPDOWN_MORPH_START_RADIUS;
  const currentWidth = typeof values.currentWidth === 'number' ? values.currentWidth : undefined;

  return {
    initialValues: {
      opacity: 1,
      height: values.currentHeight,
      ...(currentWidth != null ? { width: currentWidth } : {}),
      borderRadius: currentRadius,
      transform: [{ translateY: 0 }, { scaleX: 1 }],
    },
    animations: {
      opacity: withTiming(0, {
        duration: DROPDOWN_MORPH_FADE_DURATION_MS,
        easing: AMOUNT_FADE_EASING,
      }),
      height: withTiming(0, {
        duration: DROPDOWN_MORPH_CLOSE_DURATION_MS,
        easing: DROPDOWN_MORPH_EASING,
      }),
      ...(currentWidth != null
        ? {
            width: withTiming(currentWidth, {
              duration: DROPDOWN_MORPH_CLOSE_DURATION_MS,
              easing: DROPDOWN_MORPH_EASING,
            }),
          }
        : {}),
      borderRadius: withTiming(DROPDOWN_MORPH_START_RADIUS, {
        duration: DROPDOWN_MORPH_CLOSE_DURATION_MS,
        easing: DROPDOWN_MORPH_EASING,
      }),
      transform: [
        {
          translateY: withTiming(-DROPDOWN_MORPH_TRANSLATE_Y, {
            duration: DROPDOWN_MORPH_CLOSE_DURATION_MS,
            easing: DROPDOWN_MORPH_EASING,
          }),
        },
        {
          scaleX: withTiming(DROPDOWN_MORPH_SCALE_X, {
            duration: DROPDOWN_MORPH_CLOSE_DURATION_MS,
            easing: DROPDOWN_MORPH_EASING,
          }),
        },
      ],
    },
  };
}

interface SendAmountStepProps {
  token: SendTokenOption | null;
  tokenOptions: SendTokenOption[];
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
  onSelectToken: (token: SendTokenOption) => void;
  onAmountChange: (value: string) => void;
  onMax: () => void;
  onEditRecipient: () => void;
  canContinue: boolean;
  onContinue: () => void;
  showContinue: boolean;
}

interface AmountNumpadKeyProps {
  value: NumpadKeyValue;
  keyFontSize: number;
  onPress: (value: NumpadKeyValue) => void;
}

const AmountNumpadKey = memo(function AmountNumpadKey({
  value,
  keyFontSize,
  onPress,
}: AmountNumpadKeyProps): React.JSX.Element {
  const pressProgress = useSharedValue(0);
  const isBackspace = value === 'backspace';
  const pressFillStyle = useAnimatedStyle(() => ({
    opacity: pressProgress.value,
  }));

  const releasePress = useCallback((): void => {
    pressProgress.value = withTiming(0, {
      duration: KEYPAD_PRESS_OUT_MS,
      easing: AMOUNT_FADE_EASING,
    });
  }, [pressProgress]);

  const handlePressIn = useCallback((): void => {
    pressProgress.value = withTiming(1, {
      duration: KEYPAD_PRESS_IN_MS,
      easing: AMOUNT_FADE_EASING,
    });
  }, [pressProgress]);

  const handlePressOut = useCallback((): void => {
    releasePress();
  }, [releasePress]);

  const handlePress = useCallback((): void => {
    onPress(value);
  }, [onPress, value]);

  const handleTerminate = useCallback((): void => {
    releasePress();
  }, [releasePress]);

  return (
    <Pressable
      style={styles.numpadKey}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      onResponderTerminate={handleTerminate}
      onResponderTerminationRequest={() => true}
      unstable_pressDelay={0}
      accessibilityRole="button"
      accessibilityLabel={isBackspace ? 'Delete last digit' : `Enter ${value}`}
    >
      <Animated.View pointerEvents="none" style={[styles.numpadPressFill, pressFillStyle]} />
      {isBackspace ? (
        <Ionicons name="backspace-outline" size={keyFontSize + 2} color={colors.text.primary} />
      ) : (
        <Text
          variant="body"
          color={colors.text.primary}
          align="center"
          maxFontSizeMultiplier={1}
          style={[styles.numpadKeyLabel, { fontSize: keyFontSize, lineHeight: keyFontSize + 6 }]}
        >
          {value}
        </Text>
      )}
    </Pressable>
  );
});

interface AmountPresetKeyProps {
  label: string;
  disabled: boolean;
  onPress: () => void;
}

function AmountPresetKey({ label, disabled, onPress }: AmountPresetKeyProps): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.presetKey,
        disabled && styles.presetKeyDisabled,
        pressed && !disabled && styles.keyPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === 'MAX' ? 'Use maximum amount' : `Use ${label} of balance`}
    >
      <Text
        variant="buttonSmall"
        color={disabled ? colors.text.tertiary : colors.text.primary}
        maxFontSizeMultiplier={1}
        style={styles.presetKeyLabel}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface AmountTokenDropdownProps {
  token: SendTokenOption | null;
  tokenOptions: SendTokenOption[];
  balanceLabel: string;
  minHeight: number;
  borderRadius: number;
  horizontalPadding: number;
  verticalPadding: number;
  compact: boolean;
  dense: boolean;
  routeOptions: PrivatePaymentRouteOption[];
  selectedRoute: PrivatePaymentRoute | null;
  routeOpen: boolean;
  open: boolean;
  onToggle: () => void;
  onToggleRoute: () => void;
  onSelectToken: (token: SendTokenOption) => void;
  onSelectRoute: (route: PrivatePaymentRoute) => void;
}

interface AmountTokenDropdownRowProps {
  option: SendTokenOption;
  selected: boolean;
  optionIconSize: number;
  onSelectToken: (token: SendTokenOption) => void;
}

const AmountTokenDropdownRow = memo(function AmountTokenDropdownRow({
  option,
  selected,
  optionIconSize,
  onSelectToken,
}: AmountTokenDropdownRowProps): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.tokenDropdownOption,
        selected && styles.tokenDropdownOptionSelected,
        pressed && styles.pressed,
      ]}
      onPress={() => onSelectToken(option)}
      accessibilityRole="button"
      accessibilityLabel={`Select ${option.symbol}`}
      accessibilityState={{ selected }}
    >
      <TokenIcon
        symbol={option.symbol}
        name={option.name}
        logoUri={option.logo}
        size={optionIconSize}
        recyclingKey={option.mint}
      />
      <View style={styles.tokenDropdownOptionText}>
        <Text
          variant="bodyBold"
          color={colors.text.primary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
        >
          {option.symbol}
        </Text>
        <Text
          variant="small"
          color={colors.text.secondary}
          numberOfLines={1}
          maxFontSizeMultiplier={1}
        >
          {formatTokenBalance(option.balance, 5)}
        </Text>
      </View>
      {selected ? (
        <Ionicons
          name="checkmark-circle"
          size={18}
          color={colors.text.primary}
          style={styles.tokenDropdownOptionCheck}
        />
      ) : null}
    </Pressable>
  );
});

function TokenDropdownOptionSeparator(): React.JSX.Element {
  return <View style={styles.tokenDropdownOptionSeparator} />;
}

function AmountTokenDropdown({
  token,
  tokenOptions,
  balanceLabel,
  minHeight,
  borderRadius,
  horizontalPadding,
  verticalPadding,
  compact,
  dense,
  routeOptions,
  selectedRoute,
  routeOpen,
  open,
  onToggle,
  onToggleRoute,
  onSelectToken,
  onSelectRoute,
}: AmountTokenDropdownProps): React.JSX.Element {
  const symbol = token?.symbol ?? '';
  const iconSize = dense ? 34 : compact ? 36 : 40;
  const optionIconSize = dense ? 28 : 32;
  const menuMaxHeight = dense ? 168 : compact ? 192 : 216;
  const [tokenButtonWidth, setTokenButtonWidth] = useState(0);
  const [routeButtonWidth, setRouteButtonWidth] = useState(0);
  const [selectorCardWidth, setSelectorCardWidth] = useState(0);
  const tokenDropdownContentHeight =
    tokenOptions.length * TOKEN_DROPDOWN_ROW_HEIGHT +
    Math.max(0, tokenOptions.length - 1) * spacing.xs +
    spacing.xs * 2;
  const tokenDropdownMenuHeight = Math.min(
    menuMaxHeight,
    Math.max(TOKEN_DROPDOWN_ROW_HEIGHT + spacing.xs * 2, tokenDropdownContentHeight),
  );
  const selectedRouteOption =
    selectedRoute == null
      ? null
      : (routeOptions.find((route) => route.id === selectedRoute) ?? null);
  const routeDropdownVisible = routeOptions.length > 1 && selectedRouteOption != null;
  const tokenKeyExtractor = useCallback((option: SendTokenOption) => option.mint, []);
  const renderTokenOption = useCallback(
    ({ item: option }: ListRenderItemInfo<SendTokenOption>) => (
      <AmountTokenDropdownRow
        option={option}
        selected={option.mint === token?.mint}
        optionIconSize={optionIconSize}
        onSelectToken={onSelectToken}
      />
    ),
    [onSelectToken, optionIconSize, token?.mint],
  );
  const handleTokenButtonLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setTokenButtonWidth((currentWidth) =>
      Math.abs(currentWidth - nextWidth) <= 1 ? currentWidth : nextWidth,
    );
  }, []);
  const handleRouteButtonLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setRouteButtonWidth((currentWidth) =>
      Math.abs(currentWidth - nextWidth) <= 1 ? currentWidth : nextWidth,
    );
  }, []);
  const handleSelectorCardLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setSelectorCardWidth((currentWidth) =>
      Math.abs(currentWidth - nextWidth) <= 1 ? currentWidth : nextWidth,
    );
  }, []);
  const tokenDropdownMenuWidth = useMemo(() => {
    const selectedCheckWidth = 18 + spacing.sm;
    const optionOuterPadding = spacing.xs * 2 + spacing.sm * 2;
    const longestOptionTextWidth = tokenOptions.reduce((widest, option) => {
      const symbolWidth = option.symbol.length * TOKEN_DROPDOWN_SYMBOL_CHAR_WIDTH;
      const balanceWidth =
        formatTokenBalance(option.balance, 5).length * TOKEN_DROPDOWN_BALANCE_CHAR_WIDTH;
      return Math.max(widest, symbolWidth, balanceWidth);
    }, 0);
    const contentWidth =
      optionIconSize + spacing.sm + longestOptionTextWidth + selectedCheckWidth + optionOuterPadding;
    const preferredWidth = Math.ceil(
      Math.max(tokenButtonWidth + TOKEN_DROPDOWN_TRIGGER_EXPANSION, contentWidth),
    );
    const maxWidth =
      selectorCardWidth > 0
        ? Math.min(
            selectorCardWidth - horizontalPadding * 2,
            selectorCardWidth * TOKEN_DROPDOWN_MAX_CARD_FRACTION,
          )
        : preferredWidth;
    return Math.max(tokenButtonWidth, Math.min(preferredWidth, Math.max(maxWidth, tokenButtonWidth)));
  }, [horizontalPadding, optionIconSize, selectorCardWidth, tokenButtonWidth, tokenOptions]);
  const routeDropdownMenuWidth = useMemo(() => {
    const selectedCheckWidth = 18 + spacing.sm;
    const optionOuterPadding = spacing.sm * 2 + spacing.md * 2;
    const longestOptionTextWidth = routeOptions.reduce((widest, route) => {
      const description =
        route.disabled === true ? (route.disabledReason ?? route.description) : route.description;
      const labelWidth = route.label.length * ROUTE_DROPDOWN_LABEL_CHAR_WIDTH;
      const descriptionWidth = description.length * ROUTE_DROPDOWN_DESCRIPTION_CHAR_WIDTH;
      return Math.max(widest, labelWidth, descriptionWidth);
    }, 0);
    const preferredWidth = Math.ceil(
      Math.max(routeButtonWidth, longestOptionTextWidth + optionOuterPadding + selectedCheckWidth),
    );
    const maxWidth = selectorCardWidth > 0 ? selectorCardWidth - horizontalPadding * 2 : preferredWidth;
    return Math.max(routeButtonWidth, Math.min(preferredWidth, Math.max(maxWidth, routeButtonWidth)));
  }, [horizontalPadding, routeButtonWidth, routeOptions, selectorCardWidth]);

  return (
    <View style={styles.tokenDropdownHost}>
      <View
        style={[
          styles.tokenDropdownCard,
          {
            minHeight,
            borderRadius,
            paddingHorizontal: horizontalPadding,
            paddingVertical: verticalPadding,
          },
        ]}
        onLayout={handleSelectorCardLayout}
      >
        <Pressable
          style={styles.tokenDropdownButton}
          onLayout={handleTokenButtonLayout}
          onPress={onToggle}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={
            symbol.length > 0 ? `Choose token, selected ${symbol}` : 'Choose token'
          }
          accessibilityState={{ expanded: open }}
        >
          <View style={styles.tokenDropdownLeft}>
            <TokenIcon
              symbol={token?.symbol}
              name={token?.name}
              logoUri={token?.logo}
              size={iconSize}
              recyclingKey={token?.mint ?? null}
            />
            <View style={styles.tokenDropdownNameStack}>
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                style={styles.tokenDropdownSymbol}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
              >
                {symbol || 'Token'}
              </Text>
              <Text
                variant="small"
                color={colors.text.secondary}
                style={styles.tokenDropdownBalance}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
              >
                {balanceLabel}
              </Text>
            </View>
          </View>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.text.primary}
          />
        </Pressable>
        {routeDropdownVisible ? (
          <View style={styles.tokenDropdownMetaColumn}>
            <Pressable
              style={styles.routeDropdownButton}
              onLayout={handleRouteButtonLayout}
              onPress={onToggleRoute}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Choose route, selected ${selectedRouteOption.label}`}
              accessibilityState={{ expanded: routeOpen }}
            >
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                numberOfLines={1}
                maxFontSizeMultiplier={1}
                style={styles.routeDropdownButtonText}
              >
                {selectedRouteOption.label}
              </Text>
              <Ionicons
                name={routeOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.text.primary}
              />
            </Pressable>
          </View>
        ) : null}
      </View>

      {open ? (
        <Animated.View
          entering={dropdownMorphEnter}
          exiting={dropdownMorphExit}
          style={[
            styles.tokenDropdownMenu,
            {
              height: tokenDropdownMenuHeight,
              left: horizontalPadding,
              width: tokenDropdownMenuWidth,
            },
          ]}
        >
          <View style={[styles.tokenDropdownFixedContent, { width: tokenDropdownMenuWidth }]}>
            <FlashList<SendTokenOption>
              style={styles.tokenDropdownList}
              data={tokenOptions}
              renderItem={renderTokenOption}
              keyExtractor={tokenKeyExtractor}
              ItemSeparatorComponent={TokenDropdownOptionSeparator}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.tokenDropdownMenuContent}
              drawDistance={TOKEN_DROPDOWN_ROW_HEIGHT * 3}
            />
          </View>
        </Animated.View>
      ) : null}

      {routeOpen && routeDropdownVisible ? (
        <Animated.View
          entering={dropdownMorphEnter}
          exiting={dropdownMorphExit}
          style={[
            styles.routeDropdownMenu,
            {
              right: horizontalPadding,
              width: routeDropdownMenuWidth,
            },
          ]}
        >
          <View style={[styles.routeDropdownMenuContent, { width: routeDropdownMenuWidth }]}>
            {routeOptions.map((route) => {
              const selected = route.id === selectedRoute;
              const disabled = route.disabled === true;
              return (
                <Pressable
                  key={route.id}
                  style={({ pressed }) => [
                    styles.routeDropdownOption,
                    selected && styles.routeDropdownOptionSelected,
                    disabled && styles.routeDropdownOptionDisabled,
                    pressed && !disabled && styles.pressed,
                  ]}
                  onPress={() => onSelectRoute(route.id)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled }}
                  accessibilityLabel={`Use ${route.label} route`}
                >
                  <View style={styles.routeDropdownOptionText}>
                    <Text
                      variant="bodyBold"
                      color={disabled ? colors.text.tertiary : colors.text.primary}
                      numberOfLines={1}
                      style={styles.routeDropdownOptionTitle}
                    >
                      {route.label}
                    </Text>
                    <Text
                      variant="small"
                      color={disabled ? colors.text.tertiary : colors.text.secondary}
                      numberOfLines={1}
                      style={styles.routeDropdownOptionDescription}
                    >
                      {disabled ? (route.disabledReason ?? route.description) : route.description}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={disabled ? colors.text.tertiary : colors.text.primary}
                      style={styles.routeDropdownOptionCheck}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

export const SendAmountStep = memo(function SendAmountStep({
  token,
  tokenOptions,
  recipientAddress,
  recipientInput,
  amount,
  amountMetaLabel,
  helper,
  selfSend,
  routeOptions,
  selectedRoute,
  onSelectRoute,
  onSelectToken,
  onAmountChange,
  onMax,
  onEditRecipient,
  canContinue,
  onContinue,
  showContinue,
}: SendAmountStepProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [amountRowWidth, setAmountRowWidth] = useState(0);
  const [amountMotionDirection, setAmountMotionDirection] = useState<AmountMotionDirection>('up');
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const [routeDropdownOpen, setRouteDropdownOpen] = useState(false);
  const amountRef = useRef(amount);
  const amountMotionProgress = useSharedValue(1);
  const amountMotionDirectionValue = useSharedValue(1);
  const displayAmount = useMemo(() => formatDisplayAmount(amount), [amount]);
  const recipientLabel =
    recipientAddress != null ? shortenWalletAddress(recipientAddress) : recipientInput.trim();
  const tokenBalanceLabel = token != null ? formatTokenBalance(token.balance, 5) : '--';
  const canUsePresetAmounts = token != null && parseAmountNumber(token.balance) > 0;
  const routeVisible = routeOptions.length > 1 && selectedRoute != null;
  const crowded = routeVisible || selfSend || helper != null || windowHeight < 820;
  const viewportProfile = getViewportProfile({
    width: windowWidth,
    height: windowHeight,
    fontScale,
  });
  const compact = viewportProfile.compact;
  const dense = viewportProfile.dense;
  const ultraDense = viewportProfile.ultraDense;
  const stepGap = ultraDense
    ? spacing.xs
    : crowded || dense
      ? spacing.sm
      : compact
        ? spacing.md
        : spacing.lg;
  const fieldHorizontalPadding = ultraDense ? spacing.md : dense ? spacing.md : spacing.lg;
  const cardRadius = ultraDense ? radii.xl : radii['2xl'];
  const toRowMinHeight = ultraDense ? 44 : dense ? 46 : 48;
  const amountHeroMinHeight = ultraDense
    ? 76
    : crowded
      ? dense
        ? 78
        : 88
      : dense
        ? 104
        : compact
          ? 116
          : 128;
  const amountHeroGap = ultraDense || crowded ? spacing.xs : spacing.sm;
  const tokenDropdownMinHeight = routeVisible
    ? ultraDense
      ? 58
      : dense
        ? 62
        : 66
    : ultraDense
      ? 50
      : crowded || dense
        ? 52
        : compact
          ? 58
          : 62;
  const tokenDropdownHorizontalPadding =
    fieldHorizontalPadding + (ultraDense ? 0 : TOKEN_INPUT_EXTRA_HORIZONTAL_GAP);
  const tokenDropdownVerticalPadding = ultraDense ? spacing.xs : spacing.sm;
  const amountHeroBreathingRoom = ultraDense
    ? spacing.lg
    : dense
      ? spacing['4xl']
      : windowHeight < AMOUNT_BREATHING_ROOM_HEIGHT_THRESHOLD
        ? spacing['4xl'] + spacing['2xl']
        : spacing['4xl'] * 2 + spacing['3xl'];
  const amountBaseFontSize = ultraDense
    ? 44
    : crowded
      ? dense
        ? 48
        : 56
      : dense
        ? 54
        : compact
          ? 62
          : 68;
  const amountBaseLineHeight = ultraDense
    ? 52
    : crowded
      ? dense
        ? 56
        : 64
      : dense
        ? 63
        : compact
          ? 72
          : 78;
  const numpadKeyHeight = ultraDense
    ? 44
    : crowded
      ? dense
        ? 46
        : 48
      : dense
        ? 52
        : compact
          ? 58
          : 62;
  const numpadKeyFontSize = ultraDense ? 19 : crowded ? (dense ? 20 : 22) : dense ? 22 : 24;
  const amountTextStyle = useMemo(() => {
    return getScaledAmountTextStyle({
      value: displayAmount,
      rowWidth: amountRowWidth,
      baseFontSize: amountBaseFontSize,
      baseLineHeight: amountBaseLineHeight,
    });
  }, [amountBaseFontSize, amountBaseLineHeight, amountRowWidth, displayAmount]);
  const amountTickerHeight = amountTextStyle.lineHeight + (ultraDense ? 2 : 4);
  const fiatMetaParts = useMemo(
    () => parseFormattedFiatCurrency(amountMetaLabel),
    [amountMetaLabel],
  );
  const showAmountFeedbackError = helper != null && amount.trim().length > 0;
  const metaLabelKey = showAmountFeedbackError ? 'amount-feedback-error' : 'amount-meta';
  useEffect(() => {
    amountRef.current = amount;
  }, [amount]);
  useEffect(() => {
    if (reduceMotion) {
      amountMotionProgress.value = 1;
      return;
    }

    amountMotionDirectionValue.value = amountMotionDirection === 'down' ? -1 : 1;
    amountMotionProgress.value = 0;
    amountMotionProgress.value = withTiming(1, {
      duration: AMOUNT_SMOOTH_DURATION_MS,
      easing: AMOUNT_SMOOTH_EASING,
    });
  }, [
    amountMotionDirection,
    amountMotionDirectionValue,
    amountMotionProgress,
    displayAmount,
    reduceMotion,
  ]);
  const amountAnimatedStyle = useAnimatedStyle(() => {
    const progress = amountMotionProgress.value;
    const direction = amountMotionDirectionValue.value;
    return {
      opacity: 0.84 + progress * 0.16,
      transform: [
        {
          translateY: (1 - progress) * direction * AMOUNT_SMOOTH_DISTANCE,
        },
        {
          scale: 0.99 + progress * 0.01,
        },
      ],
    };
  });

  const handleNumpadPress = useCallback(
    (key: NumpadKeyValue): void => {
      const currentAmount = amountRef.current;
      const nextAmount = appendNumpadKey(currentAmount, key, token?.decimals ?? 6);
      if (nextAmount === currentAmount) return;
      amountRef.current = nextAmount;
      setTokenDropdownOpen(false);
      setRouteDropdownOpen(false);
      setAmountMotionDirection(
        key === 'backspace' ? 'down' : getAmountMotionDirection(currentAmount, nextAmount),
      );
      onAmountChange(nextAmount);
    },
    [onAmountChange, token?.decimals],
  );

  const handlePresetPress = useCallback(
    (preset: AmountPresetValue): void => {
      const currentAmount = amountRef.current;
      setTokenDropdownOpen(false);
      setRouteDropdownOpen(false);
      if (preset === 'max') {
        setAmountMotionDirection(
          token == null ? 'up' : getAmountMotionDirection(currentAmount, token.balance),
        );
        if (token != null) amountRef.current = token.balance;
        onMax();
        return;
      }

      if (token == null) return;

      const nextAmount = formatPresetAmount(token.balance, preset, token.decimals);
      if (nextAmount === currentAmount) return;
      amountRef.current = nextAmount;
      setAmountMotionDirection(getAmountMotionDirection(currentAmount, nextAmount));
      onAmountChange(nextAmount);
    },
    [onAmountChange, onMax, token],
  );

  const handleToggleTokenDropdown = useCallback((): void => {
    setRouteDropdownOpen(false);
    setTokenDropdownOpen((open) => !open);
  }, []);

  const handleToggleRouteDropdown = useCallback((): void => {
    setTokenDropdownOpen(false);
    setRouteDropdownOpen((open) => !open);
  }, []);

  const handleSelectDropdownToken = useCallback(
    (nextToken: SendTokenOption): void => {
      setTokenDropdownOpen(false);
      setRouteDropdownOpen(false);
      onSelectToken(nextToken);
    },
    [onSelectToken],
  );

  const handleSelectDropdownRoute = useCallback(
    (nextRoute: PrivatePaymentRoute): void => {
      setRouteDropdownOpen(false);
      onSelectRoute(nextRoute);
    },
    [onSelectRoute],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={[styles.step, { gap: stepGap }]}
    >
      <View
        style={[
          styles.toRow,
          {
            minHeight: toRowMinHeight,
            borderRadius: cardRadius,
            paddingHorizontal: fieldHorizontalPadding,
          },
        ]}
      >
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

      <View
        style={[
          styles.amountHero,
          {
            minHeight: amountHeroMinHeight + amountHeroBreathingRoom,
            paddingHorizontal: fieldHorizontalPadding,
            gap: amountHeroGap,
          },
        ]}
      >
        <View
          style={styles.amountInputRow}
          onLayout={(event) => {
            const nextWidth = Math.round(event.nativeEvent.layout.width);
            setAmountRowWidth((current) => (current === nextWidth ? current : nextWidth));
          }}
        >
          <Animated.View
            style={[styles.amountTickerClip, { height: amountTickerHeight }]}
            accessibilityRole="text"
            accessibilityLabel={`Amount ${displayAmount}`}
            accessibilityLiveRegion="polite"
          >
            <Animated.Text
              style={[
                styles.amountValue,
                styles.amountTickerValue,
                amountAnimatedStyle,
                {
                  color: colors.text.primary,
                  fontSize: amountTextStyle.fontSize,
                  lineHeight: amountTextStyle.lineHeight,
                },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={1}
            >
              {displayAmount}
            </Animated.Text>
          </Animated.View>
        </View>
        <Animated.View
          key={metaLabelKey}
          entering={reduceMotion ? undefined : feedbackEnter}
          exiting={reduceMotion ? undefined : feedbackExit}
          style={styles.metaLabel}
        >
          {showAmountFeedbackError ? (
            <Text
              variant="caption"
              color={colors.semantic.error}
              align="center"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1}
              style={styles.metaText}
            >
              {helper}
            </Text>
          ) : fiatMetaParts != null ? (
            <View style={styles.amountSubRow}>
              <FiatMoneyText
                value={amountMetaLabel}
                parts={fiatMetaParts}
                size="list"
                compact={compact}
                color={colors.text.secondary}
                style={styles.metaText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1}
              />
            </View>
          ) : (
            <View style={styles.amountSubRow}>
              <Text
                variant="caption"
                color={colors.text.secondary}
                align="center"
                style={styles.metaText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1}
              >
                {amountMetaLabel}
              </Text>
            </View>
          )}
        </Animated.View>
      </View>

      <View
        style={[
          styles.tokenDropdownFrame,
          {
            minHeight: tokenDropdownMinHeight,
            borderRadius: cardRadius,
          },
        ]}
      >
        <AmountTokenDropdown
          token={token}
          tokenOptions={tokenOptions}
          balanceLabel={tokenBalanceLabel}
          minHeight={tokenDropdownMinHeight}
          borderRadius={cardRadius}
          horizontalPadding={tokenDropdownHorizontalPadding}
          verticalPadding={tokenDropdownVerticalPadding}
          compact={compact}
          dense={dense || ultraDense}
          routeOptions={routeOptions}
          selectedRoute={selectedRoute}
          routeOpen={routeDropdownOpen}
          open={tokenDropdownOpen}
          onToggle={handleToggleTokenDropdown}
          onToggleRoute={handleToggleRouteDropdown}
          onSelectToken={handleSelectDropdownToken}
          onSelectRoute={handleSelectDropdownRoute}
        />
      </View>

      {selfSend ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(160)}
          layout={LinearTransition.duration(220)}
          style={styles.warningLine}
        >
          <Text
            variant="small"
            color={colors.text.secondary}
            align="center"
            numberOfLines={2}
            maxFontSizeMultiplier={1}
            style={styles.warningText}
          >
            This is your current address. Sending will incur fees with no balance change.
          </Text>
        </Animated.View>
      ) : null}

      {helper != null && !showAmountFeedbackError ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}>
          <Text variant="small" color={colors.semantic.warning} style={styles.helper}>
            {helper}
          </Text>
        </Animated.View>
      ) : null}

      <View style={styles.keypadActionStack}>
        <View
          style={[
            styles.numpad,
            {
              borderRadius: cardRadius,
              padding: ultraDense ? spacing.xs : spacing.sm,
              gap: ultraDense ? spacing.xs : spacing.sm,
            },
          ]}
          accessibilityLabel="Amount keypad"
        >
          <View
            style={[
              styles.presetRow,
              {
                gap: ultraDense ? spacing.xs : spacing.sm,
              },
            ]}
          >
            {AMOUNT_PRESET_OPTIONS.map((preset) => (
              <AmountPresetKey
                key={preset.label}
                label={preset.label}
                disabled={!canUsePresetAmounts}
                onPress={() => handlePresetPress(preset.value)}
              />
            ))}
          </View>
          {NUMPAD_ROWS.map((row, rowIndex) => (
            <View
              key={`numpad-row-${rowIndex}`}
              style={[
                styles.numpadRow,
                {
                  height: numpadKeyHeight,
                  gap: ultraDense ? spacing.xs : spacing.sm,
                },
              ]}
            >
              {row.map((keyValue) => (
                <AmountNumpadKey
                  key={keyValue}
                  value={keyValue}
                  keyFontSize={numpadKeyFontSize}
                  onPress={handleNumpadPress}
                />
              ))}
            </View>
          ))}
        </View>

        {showContinue ? (
          <Pressable
            style={({ pressed }) => [
              styles.continueButton,
              dense && styles.continueButtonCompact,
              !canContinue && styles.continueButtonDisabled,
              pressed && canContinue && styles.continueButtonPressed,
            ]}
            onPress={onContinue}
            disabled={!canContinue}
            accessibilityRole="button"
            accessibilityLabel="Next"
          >
            <Text
              variant="button"
              color={canContinue ? colors.text.onAccent : colors.text.tertiary}
              maxFontSizeMultiplier={1}
              style={styles.continueButtonLabel}
            >
              Next
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
});

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
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountInputRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountTickerClip: {
    width: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountValue: {
    width: '100%',
    fontFamily: fontFamily.moneyBold,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0,
  },
  amountTickerValue: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  metaLabel: {
    alignSelf: 'center',
    minHeight: 20,
    justifyContent: 'center',
  },
  metaText: {
    alignSelf: 'center',
  },
  amountSubRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  availableBalance: {
    flexShrink: 1,
    fontFamily: fontFamily.ui,
    includeFontPadding: false,
    lineHeight: 18,
    textAlign: 'right',
  },
  tokenDropdownMetaColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  tokenDropdownFrame: {
    width: '100%',
    zIndex: 20,
  },
  tokenDropdownHost: {
    width: '100%',
    position: 'relative',
    zIndex: 20,
  },
  tokenDropdownCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.solidCardElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
  },
  tokenDropdownMenu: {
    position: 'absolute',
    top: '100%',
    marginTop: spacing.xs,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.solidCardElevated,
    boxShadow: '0 18px 34px rgba(0, 0, 0, 0.42)',
    overflow: 'hidden',
    zIndex: 30,
  },
  tokenDropdownMenuContent: {
    padding: spacing.xs,
  },
  tokenDropdownFixedContent: {
    flex: 1,
  },
  tokenDropdownList: {
    flex: 1,
  },
  tokenDropdownOptionSeparator: {
    height: spacing.xs,
  },
  tokenDropdownOption: {
    minHeight: 48,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tokenDropdownOptionSelected: {
    backgroundColor: colors.surface.solidControl,
  },
  tokenDropdownOptionText: {
    flex: 1,
    minWidth: 0,
  },
  tokenDropdownOptionCheck: {
    marginLeft: spacing.xs,
  },
  tokenDropdownButton: {
    minHeight: 52,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.solidControl,
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  tokenDropdownLeft: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tokenDropdownNameStack: {
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  tokenDropdownSymbol: {
    fontFamily: fontFamily.uiSemiBold,
    includeFontPadding: false,
    lineHeight: 20,
  },
  tokenDropdownBalance: {
    fontFamily: fontFamily.ui,
    includeFontPadding: false,
    lineHeight: 15,
  },
  routeDropdownButton: {
    minHeight: 44,
    maxWidth: '100%',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.solidControl,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  routeDropdownButtonText: {
    includeFontPadding: false,
    lineHeight: 20,
  },
  routeDropdownMenu: {
    position: 'absolute',
    top: '100%',
    marginTop: spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.solidCardElevated,
    boxShadow: '0 18px 34px rgba(0, 0, 0, 0.42)',
    overflow: 'hidden',
    zIndex: 28,
  },
  routeDropdownMenuContent: {
    padding: spacing.sm,
    gap: spacing.xs,
  },
  routeDropdownOption: {
    minHeight: 46,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  routeDropdownOptionSelected: {
    backgroundColor: colors.surface.solidControl,
  },
  routeDropdownOptionDisabled: {
    opacity: 0.62,
  },
  routeDropdownOptionText: {
    flex: 1,
    minWidth: 0,
  },
  routeDropdownOptionTitle: {
    includeFontPadding: false,
    lineHeight: 18,
  },
  routeDropdownOptionDescription: {
    includeFontPadding: false,
    lineHeight: 15,
  },
  routeDropdownOptionCheck: {
    marginLeft: spacing.xs,
  },
  warningLine: {
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningText: {
    lineHeight: 16,
    includeFontPadding: false,
  },
  helper: {
    lineHeight: 18,
  },
  keypadActionStack: {
    width: '100%',
    gap: spacing.xs,
  },
  numpad: {
    width: '100%',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.solidCard,
  },
  numpadRow: {
    width: '100%',
    flexDirection: 'row',
  },
  presetRow: {
    width: '100%',
    minHeight: 36,
    flexDirection: 'row',
  },
  presetKey: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.solidControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetKeyDisabled: {
    backgroundColor: colors.surface.disabled,
  },
  presetKeyLabel: {
    includeFontPadding: false,
    lineHeight: 18,
  },
  numpadKey: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    overflow: 'hidden',
  },
  numpadPressFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: radii.lg,
    backgroundColor: KEYPAD_PRESS_FILL,
  },
  numpadKeyLabel: {
    fontFamily: fontFamily.ui,
    includeFontPadding: false,
  },
  keyPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
  },
  pressed: {
    opacity: 0.78,
  },
  continueButton: {
    width: '100%',
    height: 58,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.glossAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonCompact: {
    height: 52,
  },
  continueButtonDisabled: {
    backgroundColor: colors.surface.solidControl,
  },
  continueButtonPressed: {
    backgroundColor: colors.surface.glossPressed,
  },
  continueButtonLabel: {
    includeFontPadding: false,
    lineHeight: 22,
  },
});
