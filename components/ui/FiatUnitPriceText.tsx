import { useMemo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { parseFiatUnitPriceLabel } from '@/lib/currency-rates';
import { resolveFiatMoneyMetrics } from '@/lib/fiat-money-layout';

import type { FiatMoneyTextSize } from '@/lib/fiat-money-layout';
import type { StyleProp, TextProps, TextStyle, ViewStyle } from 'react-native';

const NARROW_NO_BREAK_SPACE = '\u202F';

type FiatUnitPriceTextProps = Omit<TextProps, 'children' | 'style'> & {
  value: string;
  color?: string;
  compact?: boolean;
  size?: FiatMoneyTextSize;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<ViewStyle>;
  amountStyle?: StyleProp<TextStyle>;
};

/** Renders `$ 1.23/USDC`-style unit prices with Cirka on the fiat segment. */
export function FiatUnitPriceText({
  value,
  color = colors.text.secondary,
  compact = false,
  size = 'caption',
  align = 'right',
  style,
  amountStyle,
  ...rest
}: FiatUnitPriceTextProps): React.JSX.Element {
  const parsed = useMemo(() => parseFiatUnitPriceLabel(value), [value]);
  const metrics = resolveFiatMoneyMetrics(size, compact);
  const frameAlign = align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center';

  if (parsed == null) {
    return (
      <RNText
        style={[
          styles.fallback,
          {
            color,
            fontSize: metrics.fontSize,
            lineHeight: metrics.lineHeight,
            textAlign: align,
          },
          amountStyle,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.62}
        maxFontSizeMultiplier={1}
        {...rest}
      >
        {value}
      </RNText>
    );
  }

  const fiatLabel = `${parsed.parts.symbol}${NARROW_NO_BREAK_SPACE}${parsed.parts.amount}`;

  return (
    <View style={[styles.frame, { alignItems: frameAlign }, style]}>
      <View
        style={[
          styles.row,
          frameAlign === 'flex-end'
            ? styles.rowEnd
            : frameAlign === 'flex-start'
              ? styles.rowStart
              : styles.rowCenter,
        ]}
      >
        <RNText
          style={[
            styles.fiatSegment,
            {
              color,
              fontSize: metrics.fontSize,
              lineHeight: metrics.lineHeight,
            },
            amountStyle,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.62}
          maxFontSizeMultiplier={1}
          {...rest}
        >
          {fiatLabel}
        </RNText>
        <RNText
          style={[
            styles.suffixSegment,
            {
              color,
              fontSize: metrics.fontSize,
              lineHeight: metrics.lineHeight,
            },
          ]}
          numberOfLines={1}
        >
          {parsed.suffix}
        </RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    minWidth: 0,
    maxWidth: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    maxWidth: '100%',
    minWidth: 0,
    gap: 0,
  },
  rowEnd: {
    justifyContent: 'flex-end',
  },
  rowStart: {
    justifyContent: 'flex-start',
  },
  rowCenter: {
    justifyContent: 'center',
  },
  fiatSegment: {
    fontFamily: fontFamily.moneyBold,
    includeFontPadding: false,
    flexShrink: 1,
    minWidth: 0,
  },
  suffixSegment: {
    fontFamily: fontFamily.moneyLight,
    includeFontPadding: false,
    flexShrink: 0,
  },
  fallback: {
    fontFamily: fontFamily.moneyLight,
    includeFontPadding: false,
  },
});
