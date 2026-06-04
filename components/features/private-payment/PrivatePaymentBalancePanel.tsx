import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface PrivatePaymentBalancePanelProps {
  walletAddress: string | null;
  mint: string | null;
  baseBalance: string | null;
  privateBalance: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  policyLabel: string;
  onRefresh: () => void;
}

function formatRawBalance(value: string | null): string {
  if (value == null || value.length === 0) return '0';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
    minimumFractionDigits: parsed === 0 ? 0 : undefined,
  }).format(parsed);
}

export function PrivatePaymentBalancePanel({
  walletAddress,
  mint,
  baseBalance,
  privateBalance,
  isLoading,
  errorMessage,
  policyLabel,
  onRefresh,
}: PrivatePaymentBalancePanelProps): React.JSX.Element {
  return (
    <View style={[{ backgroundColor: colors.holdingsCard.gradientTop }, styles.card]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text variant="captionBold" color={colors.text.secondary}>
            Private payment balance
          </Text>
          {mint != null && mint.length > 0 ? (
            <CopyableAddress address={mint} color={colors.text.tertiary} />
          ) : (
            <Text variant="small" color={colors.text.tertiary}>
              Backend default mint
            </Text>
          )}
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh private balance"
          accessibilityState={{ busy: isLoading }}
        >
          <Ionicons
            name="refresh"
            size={layout.iconSizeInline}
            color={isLoading ? colors.text.tertiary : colors.brand.glossAccent}
          />
        </Pressable>
      </View>

      <View style={styles.balanceGrid}>
        <View style={styles.balanceBlock}>
          <Text variant="small" color={colors.text.tertiary}>
            Private
          </Text>
          <Text
            variant="h2"
            color={colors.text.primary}
            style={styles.balanceValue}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatRawBalance(privateBalance)}
          </Text>
        </View>
        <View style={styles.balanceBlock}>
          <Text variant="small" color={colors.text.tertiary}>
            Public base
          </Text>
          <Text
            variant="h2"
            color={colors.text.primary}
            style={styles.balanceValue}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatRawBalance(baseBalance)}
          </Text>
        </View>
      </View>

      {walletAddress != null ? (
        <View style={styles.walletRow}>
          <Text variant="small" color={colors.text.tertiary}>
            Wallet
          </Text>
          <CopyableAddress address={walletAddress} color={colors.text.secondary} />
        </View>
      ) : null}

      <Text variant="small" color={colors.text.tertiary} style={styles.errorText}>
        {policyLabel}
      </Text>

      {errorMessage != null ? (
        <Text variant="small" color={colors.semantic.warning} style={styles.errorText}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii['2xl'],
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.xl,
    gap: spacing.lg,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  iconButton: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    backgroundColor: colors.holdingsCard.pressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  balanceBlock: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  balanceValue: {
    fontFamily: fontFamily.mono,
  },
  walletRow: {
    gap: spacing.xs,
  },
  errorText: {
    lineHeight: 18,
  },
});
