import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { SWAP_CONTROL_SHADOW, SWAP_PANEL_SHADOW } from './swapGlass';

import type { OffpayNetwork } from '@/types/offpay-api';

interface SwapExecutionStatusCardProps {
  signature: string;
  network: OffpayNetwork;
  refreshedQuote: boolean;
}

function buildExplorerUrl(signature: string, network: OffpayNetwork): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

function shortenSignature(signature: string): string {
  if (signature.length <= 18) return signature;
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

export function SwapExecutionStatusCard({
  signature,
  network,
  refreshedQuote,
}: SwapExecutionStatusCardProps): React.JSX.Element {
  const url = buildExplorerUrl(signature, network);

  return (
    <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.card]}>
      <View style={styles.iconWrap}>
        <Ionicons name="checkmark" size={layout.iconSizeInline} color={colors.semantic.success} />
      </View>
      <View style={styles.content}>
        <Text variant="bodyBold" color={colors.text.primary} style={styles.title}>
          Swap submitted
        </Text>
        <Text variant="small" color={colors.text.secondary} style={styles.description}>
          Signature {shortenSignature(signature)}
        </Text>
        {refreshedQuote ? (
          <Text variant="small" color={colors.text.tertiary} style={styles.description}>
            A fresh quote was signed automatically after the original quote expired.
          </Text>
        ) : null}
      </View>
      <Pressable
        style={styles.openButton}
        onPress={() => {
          void Linking.openURL(url);
        }}
        accessibilityRole="button"
        accessibilityLabel="Open swap in explorer"
      >
        <Ionicons
          name="open-outline"
          size={layout.iconSizeInline}
          color={colors.brand.glossAccent}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SWAP_PANEL_SHADOW,
  },
  iconWrap: {
    minWidth: layout.avatarMd,
    minHeight: layout.avatarMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.smokeWash,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: SWAP_CONTROL_SHADOW,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.displaySemiBold,
  },
  description: {
    lineHeight: 18,
  },
  openButton: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: SWAP_CONTROL_SHADOW,
  },
});
