import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { WalletAccountDetails } from '@/components/features/settings/WalletAccountDetails';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useWalletStore } from '@/store/walletStore';

interface WalletCardProps {
  compact?: boolean;
  dense?: boolean;
}

const CARD_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const CARD_SHADOW =
  '0 2px 8px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)';

export function WalletCard({ compact = false, dense = false }: WalletCardProps): React.JSX.Element {
  const accountName = useWalletStore((s) => s.accountName);
  const publicKey = useWalletStore((s) => s.publicKey);
  const router = useRouter();
  const avatarSize = dense ? 38 : compact ? 42 : 48;
  const actionButtonSize = dense ? 38 : compact ? 40 : layout.minTouchTarget;
  const actionIconSize = dense ? 18 : layout.iconSizeInline;

  const handleOpenAccounts = (): void => {
    router.push('/accounts');
  };

  return (
    <View style={styles.shell}>
      <LinearGradient
        colors={[...CARD_GLASS_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, compact && styles.cardCompact, dense && styles.cardDense]}
      >
        <WalletAvatar size={avatarSize} solidFill />
        <WalletAccountDetails
          name={accountName}
          address={publicKey ?? '—'}
          compact={compact}
          dense={dense}
        />
        <Pressable
          style={({ pressed }) => [
            styles.moreButton,
            { width: actionButtonSize, height: actionButtonSize },
            pressed && styles.moreButtonPressed,
          ]}
          onPress={handleOpenAccounts}
          accessibilityRole="button"
          accessibilityLabel="Manage accounts"
          hitSlop={6}
        >
          <Ionicons name="add" size={actionIconSize + 2} color={colors.text.onAccent} />
        </Pressable>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: CARD_SHADOW,
  },
  card: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.glass.strongFill,
  },
  cardCompact: {
    minHeight: 78,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  cardDense: {
    minHeight: 72,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  moreButton: {
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.azureCyan,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    flexShrink: 0,
    boxShadow: '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  moreButtonPressed: {
    opacity: 0.72,
  },
});
