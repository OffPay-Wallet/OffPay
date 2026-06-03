/**
 * Fiat currency display: Cirka Bold symbol and amount on one baseline row.
 */
import { useMemo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { parseFormattedFiatCurrency } from '@/lib/currency-rates';
import {
  resolveFiatMoneyMetrics,
  type FiatCurrencyParts,
  type FiatMoneyTextSize,
} from '@/lib/fiat-money-layout';

import type { StyleProp, TextProps, TextStyle, ViewStyle } from 'react-native';

const THIN_SPACE = '\u2009';

export interface FiatMoneyTextProps extends Omit<TextProps, 'children' | 'style'> {
  value: string;
  parts?: FiatCurrencyParts | null;
  color?: string;
  compact?: boolean;
  size?: FiatMoneyTextSize;
  amountFontSize?: number;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<ViewStyle>;
  amountStyle?: StyleProp<TextStyle>;
  symbolStyle?: StyleProp<TextStyle>;
}

export function FiatMoneyText({
  value,
  parts: partsOverride,
  color = colors.text.primary,
  compact = false,
  size = 'hero',
  amountFontSize,
  align = 'center',
  style,
  amountStyle,
  symbolStyle,
  ...rest
}: FiatMoneyTextProps): React.JSX.Element {
  const parsed = useMemo(
    () => partsOverride ?? parseFormattedFiatCurrency(value),
    [partsOverride, value],
  );
  const metrics = resolveFiatMoneyMetrics(size, compact, amountFontSize);
  const textAlign = align;
  const frameAlign =
    align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center';

  const rootTextStyle: StyleProp<TextStyle> = [
    styles.root,
    {
      color,
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      textAlign,
    },
    amountStyle,
  ];

  if (parsed == null) {
    return (
      <View style={[styles.frame, { alignItems: frameAlign }, style]}>
        <RNText style={rootTextStyle} {...rest}>
          {value}
        </RNText>
      </View>
    );
  }

  // Single `Text` node — nested children + `adjustsFontSizeToFit` clip amounts in narrow rows.
  const displayLabel = `${parsed.symbol}${THIN_SPACE}${parsed.amount}`;

  return (
    <View style={[styles.frame, { alignItems: frameAlign }, style]}>
      <RNText style={[rootTextStyle, symbolStyle]} {...rest}>
        {displayLabel}
      </RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    minWidth: 0,
  },
  root: {
    fontFamily: fontFamily.moneyBold,
    includeFontPadding: false,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
});
