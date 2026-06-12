import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { WalletAccountDetails } from '@/components/features/settings/WalletAccountDetails';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useWalletStore } from '@/store/walletStore';

interface WalletCardProps {
  compact?: boolean;
  dense?: boolean;
}

const CARD_SHADOW = '0 14px 28px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.14)';

export function WalletCard({ compact = false, dense = false }: WalletCardProps): React.JSX.Element {
  const accountName = useWalletStore((s) => s.accountName);
  const publicKey = useWalletStore((s) => s.publicKey);
  const router = useRouter();
  const isFocused = useIsFocused();
  const avatarSize = dense ? 38 : compact ? 42 : 48;
  const actionButtonSize = dense ? 38 : compact ? 40 : layout.minTouchTarget;
  const actionIconSize = dense ? 18 : layout.iconSizeInline;

  const handleOpenAccounts = (): void => {
    if (!isFocused) return;
    router.push('/accounts');
  };

  return (
    <View style={styles.shell}>
      <View style={[styles.card, compact && styles.cardCompact, dense && styles.cardDense]}>
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
      </View>
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
    backgroundColor: colors.surface.cardElevated,
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
    backgroundColor: colors.surface.cardElevated,
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
    backgroundColor: colors.brand.glossAccent,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    flexShrink: 0,
    boxShadow: '0 8px 16px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.88)',
  },
  moreButtonPressed: {
    opacity: 0.72,
  },
});
