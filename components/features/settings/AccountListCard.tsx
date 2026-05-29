import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';
import { useWalletStore } from '@/store/walletStore';

import type { WalletAccount } from '@/store/walletStore';

interface AccountListCardProps {
  wallet: WalletAccount;
  isPrimary: boolean;
  isOnlyWallet: boolean;
  compact?: boolean;
  dense?: boolean;
  actionsMenuOpen?: boolean;
  onActionsMenuOpenChange?: (open: boolean) => void;
  onRequestExportKeys?: (wallet: WalletAccount) => void;
  onRequestRemoveWallet?: (wallet: WalletAccount) => void;
}

const MENU_OPEN_HEIGHT = layout.buttonHeightMd * 2;
const ACCOUNT_CARD_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const ACCOUNT_CARD_SHADOW =
  '0 16px 30px rgba(14, 42, 53, 0.14), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.12)';

export function AccountListCard({
  wallet,
  isPrimary,
  compact = false,
  dense = false,
  actionsMenuOpen,
  onActionsMenuOpenChange,
  onRequestExportKeys,
  onRequestRemoveWallet,
}: AccountListCardProps): React.JSX.Element {
  const setPrimaryWallet = useWalletStore((s) => s.setPrimaryWallet);
  const balanceQuery = useOffpayWalletBalance(wallet.publicKey);

  const [localActionsMenuOpen, setLocalActionsMenuOpen] = useState(false);
  const menuAnim = useSharedValue(0);
  const avatarSize = dense ? 44 : compact ? 50 : layout.avatarLg;
  const actionButtonSize = dense ? 38 : compact ? 40 : 42;
  const actionIconSize = dense ? 18 : layout.iconSizeInline;
  const isMenuOpen = actionsMenuOpen ?? localActionsMenuOpen;
  const setActionsMenuOpen = (open: boolean): void => {
    if (actionsMenuOpen == null) {
      setLocalActionsMenuOpen(open);
    }
    onActionsMenuOpenChange?.(open);
  };

  useEffect(() => {
    menuAnim.value = withTiming(isMenuOpen ? 1 : 0, { duration: 200 });
  }, [isMenuOpen, menuAnim]);

  const menuStyle = useAnimatedStyle(() => ({
    height: interpolate(menuAnim.value, [0, 1], [0, MENU_OPEN_HEIGHT]),
    opacity: interpolate(menuAnim.value, [0, 0.08, 1], [0, 1, 1]),
  }));

  const handleSetPrimary = (): void => {
    if (isPrimary) return;

    void setPrimaryWallet(wallet.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to set primary wallet';
      Alert.alert('Unable to update wallet', message);
    });
  };

  const handleExportKeys = (): void => {
    setActionsMenuOpen(false);
    onRequestExportKeys?.(wallet);
  };

  const handleRemoveWallet = (): void => {
    setActionsMenuOpen(false);
    onRequestRemoveWallet?.(wallet);
  };

  const liveBalanceLabel =
    balanceQuery.data != null
      ? `${formatLamportsAsSol(balanceQuery.data.solBalance)} SOL`
      : balanceQuery.isCapabilityEnabled
        ? balanceQuery.isLoading
          ? 'Loading live balance'
          : balanceQuery.isError
            ? 'Live balance unavailable'
            : '0.00 SOL'
        : balanceQuery.isCapabilitiesPending
          ? 'Loading live balance'
          : balanceQuery.capability.message;

  return (
    <View style={[styles.shell, isMenuOpen && styles.shellMenuOpen]}>
      <LinearGradient
        colors={[...ACCOUNT_CARD_COLORS]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientBg}
      />

      {isMenuOpen ? (
        <Pressable style={styles.overlay} onPress={() => setActionsMenuOpen(false)} />
      ) : null}

      <View style={styles.topSection}>
        <WalletAvatar size={avatarSize} solidFill />
        <View style={styles.topRight}>
          <CopyableAddress
            address={wallet.publicKey}
            color={colors.text.secondary}
            iconSize={dense ? 16 : layout.iconSizeInline}
          />
        </View>
      </View>

      <View style={styles.bottomSection}>
        <View style={styles.bottomLeft}>
          <View style={styles.nameRow}>
            <Text
              variant="h3"
              color={colors.text.primary}
              style={styles.accountName}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {wallet.name}
            </Text>
            {isPrimary ? (
              <View style={styles.primaryBadge}>
                <Text variant="small" color={colors.text.onAccent} style={styles.primaryBadgeText}>
                  Primary
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            variant="body"
            color={colors.text.secondary}
            style={styles.balance}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {liveBalanceLabel}
          </Text>
        </View>

        <View style={styles.bottomRight}>
          <Pressable
            style={[
              styles.actionRoundButton,
              { width: actionButtonSize, height: actionButtonSize },
              isPrimary ? styles.actionRoundButtonActive : null,
            ]}
            onPress={handleSetPrimary}
            accessibilityRole="button"
            accessibilityLabel={isPrimary ? 'Primary wallet' : 'Set as primary wallet'}
            hitSlop={6}
          >
            <Ionicons
              name="color-wand-outline"
              size={actionIconSize}
              color={isPrimary ? colors.text.onAccent : colors.text.primary}
            />
          </Pressable>

          <View style={styles.menuAnchor}>
            <Pressable
              style={[
                styles.actionRoundButton,
                { width: actionButtonSize, height: actionButtonSize },
              ]}
              onPress={() => setActionsMenuOpen(!isMenuOpen)}
              accessibilityRole="button"
              accessibilityLabel={isMenuOpen ? 'Close wallet actions' : 'Open wallet actions'}
              hitSlop={6}
            >
              <Ionicons
                name={isMenuOpen ? 'close' : 'ellipsis-horizontal'}
                size={actionIconSize}
                color={colors.text.primary}
              />
            </Pressable>

            <Animated.View
              pointerEvents={isMenuOpen ? 'auto' : 'none'}
              style={[styles.dropdownMenu, { top: actionButtonSize + spacing.sm }, menuStyle]}
            >
              <View style={styles.dropdownContent}>
                <Pressable style={styles.dropdownItem} onPress={handleExportKeys}>
                  <Ionicons
                    name="key-outline"
                    size={layout.iconSizeInline}
                    color={colors.text.primary}
                  />
                  <Text variant="body" color={colors.text.primary}>
                    Export Keys
                  </Text>
                </Pressable>
                <Pressable style={styles.dropdownItem} onPress={handleRemoveWallet}>
                  <Ionicons
                    name="trash-outline"
                    size={layout.iconSizeInline}
                    color={colors.semantic.error}
                  />
                  <Text variant="body" color={colors.semantic.error}>
                    Remove
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.lg,
    marginVertical: spacing.sm,
    overflow: 'visible',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: ACCOUNT_CARD_SHADOW,
    zIndex: 1,
  },
  shellMenuOpen: {
    zIndex: 40,
  },
  gradientBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii['2xl'],
  },
  overlay: {
    position: 'absolute',
    top: -1000,
    bottom: -1000,
    left: -1000,
    right: -1000,
    zIndex: 10,
  },
  topSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
    gap: spacing.md,
    minWidth: 0,
  },
  topRight: {
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  bottomSection: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    zIndex: 11,
    gap: spacing.md,
    minWidth: 0,
  },
  bottomLeft: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  bottomRight: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 0,
  },
  actionRoundButton: {
    borderRadius: radii.full,
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: '0 8px 16px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.72)',
  },
  accountName: {
    fontWeight: 'bold',
    minWidth: 0,
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    minWidth: 0,
  },
  primaryBadge: {
    backgroundColor: colors.brand.azureCyan,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    flexShrink: 0,
  },
  primaryBadgeText: {
    fontWeight: 'bold',
    fontSize: 10,
  },
  actionRoundButtonActive: {
    backgroundColor: colors.brand.azureCyan,
  },
  balance: {
    opacity: 0.8,
    minWidth: 0,
  },
  menuAnchor: {
    position: 'relative',
    zIndex: 20,
  },
  dropdownMenu: {
    position: 'absolute',
    top: layout.buttonHeightSm + spacing.sm,
    right: 0,
    minWidth: layout.avatarLg + spacing['4xl'],
    backgroundColor: colors.brand.whiteStream,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  dropdownContent: {
    padding: spacing.xs,
    width: '100%',
    backgroundColor: colors.brand.whiteStream,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.brand.whiteStream,
  },
});
