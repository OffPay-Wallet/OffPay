import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { SWAP_GLASS_COLORS, SWAP_PANEL_SHADOW } from './swapGlass';

interface SwapDetailsCardProps {
  rateLabel: string;
  priceImpactLabel: string;
  feeLabel: string;
  routeLabel: string;
  slippageLabel: string;
}

function DetailRow({
  label,
  value,
  dense,
}: {
  label: string;
  value: string;
  dense: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.row, dense && styles.rowDense]}>
      <Text
        variant="small"
        color={colors.text.secondary}
        style={[styles.label, dense && styles.labelDense]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        maxFontSizeMultiplier={1}
      >
        {label}
      </Text>
      <Text
        variant="small"
        color={colors.text.primary}
        style={[styles.value, dense && styles.valueDense]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.62}
        maxFontSizeMultiplier={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function SwapDetailsCard({
  rateLabel,
  priceImpactLabel,
  feeLabel,
  routeLabel,
  slippageLabel,
}: SwapDetailsCardProps): React.JSX.Element {
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 820 || fontScale > 1.05;
  const dense = windowWidth < 350 || windowHeight < 720 || fontScale > 1.18;

  return (
    <LinearGradient
      colors={[...SWAP_GLASS_COLORS]}
      start={{ x: 0.04, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.container, compact && styles.containerCompact, dense && styles.containerDense]}
    >
      <DetailRow label="Exchange Rate" value={rateLabel} dense={dense} />
      <View style={styles.divider} />
      <DetailRow label="Price Impact" value={priceImpactLabel} dense={dense} />
      <View style={styles.divider} />
      <DetailRow label="Quote Fee" value={feeLabel} dense={dense} />
      <View style={styles.divider} />
      <DetailRow label="Route" value={routeLabel} dense={dense} />
      <View style={styles.divider} />
      <DetailRow label="Slippage" value={slippageLabel} dense={dense} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SWAP_PANEL_SHADOW,
  },
  containerCompact: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  containerDense: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 20,
    minWidth: 0,
  },
  rowDense: {
    minHeight: 18,
  },
  label: {
    width: 96,
    minWidth: 82,
    flexShrink: 0,
    fontFamily: fontFamily.uiMedium,
    fontSize: 11,
    lineHeight: 14,
  },
  labelDense: {
    width: 88,
    minWidth: 76,
    fontSize: 10,
    lineHeight: 13,
  },
  value: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  valueDense: {
    fontSize: 10,
    lineHeight: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
    width: '100%',
  },
});
