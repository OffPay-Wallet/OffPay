/**
 * Fiat currency display with iOS-style typography:
 * smaller top-aligned Cirka Bold symbol, gap, full-size Cirka Bold amount.
 */
import { useMemo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { parseFormattedFiatCurrency } from '@/lib/currency-rates';

import type { StyleProp, TextProps, TextStyle, ViewStyle } from 'react-native';

/** Symbol size relative to the main amount cap height (reference: ~55%). */
const SYMBOL_SIZE_RATIO = 0.55;
/** Optical top inset so the symbol aligns with digit caps, not baseline. */
const SYMBOL_TOP_INSET_RATIO = 0.1;
const SYMBOL_GAP = 4;

export interface FiatMoneyTextProps extends Omit<TextProps, 'children' | 'style'> {
  value: string;
  color?: string;
  compact?: boolean;
  amountFontSize?: number;
  style?: StyleProp<ViewStyle>;
  amountStyle?: StyleProp<TextStyle>;
}

function resolveAmountMetrics(compact: boolean, amountFontSize?: number): {
  fontSize: number;
  lineHeight: number;
  symbolFontSize: number;
  symbolTopInset: number;
} {
  const fontSize = amountFontSize ?? (compact ? 34 : 42);
  const lineHeight = compact ? 40 : 48;
  const symbolFontSize = Math.round(fontSize * SYMBOL_SIZE_RATIO);
  const symbolTopInset = Math.round(fontSize * SYMBOL_TOP_INSET_RATIO);

  return { fontSize, lineHeight, symbolFontSize, symbolTopInset };
}

export function FiatMoneyText({
  value,
  color = colors.text.primary,
  compact = false,
  amountFontSize,
  style,
  amountStyle,
  ...rest
}: FiatMoneyTextProps): React.JSX.Element {
  const parsed = useMemo(() => parseFormattedFiatCurrency(value), [value]);
  const metrics = resolveAmountMetrics(compact, amountFontSize);

  const amountTextStyle: StyleProp<TextStyle> = [
    styles.amount,
    {
      color,
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
    },
    amountStyle,
  ];

  if (parsed == null) {
    return (
      <View style={[styles.row, style]}>
        <RNText style={amountTextStyle} {...rest}>
          {value}
        </RNText>
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      <RNText
        style={[
          styles.symbol,
          {
            color,
            fontSize: metrics.symbolFontSize,
            lineHeight: metrics.symbolFontSize,
            marginTop: metrics.symbolTopInset,
            marginRight: SYMBOL_GAP,
          },
        ]}
      >
        {parsed.symbol}
      </RNText>
      <RNText style={[amountTextStyle, styles.amountFlex]} {...rest}>
        {parsed.amount}
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  symbol: {
    fontFamily: fontFamily.moneyBold,
    includeFontPadding: false,
  },
  amount: {
    fontFamily: fontFamily.moneyBold,
    includeFontPadding: false,
    textAlign: 'left',
    flexShrink: 0,
  },
  amountFlex: {
    flexShrink: 1,
    minWidth: 0,
  },
});
