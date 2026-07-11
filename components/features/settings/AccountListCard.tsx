import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated from 'react-native-reanimated';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { Text } from '@/components/ui/Text';
import {
  SETTINGS_SURFACE_ENTERING,
  SETTINGS_SURFACE_EXITING,
} from '@/components/ui/settings-motion';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';

import type { WalletAccount } from '@/store/walletStore';

interface AccountListCardProps {
  wallet: WalletAccount;
  isPrimary: boolean;
  primaryChangePending?: boolean;
  compact?: boolean;
  dense?: boolean;
  actionsMenuOpen?: boolean;
  onActionsMenuOpenChange?: (walletId: string, open: boolean) => void;
  onRequestExportKeys?: (wallet: WalletAccount) => void;
  onRequestRemoveWallet?: (wallet: WalletAccount) => void;
  onRequestSetPrimary?: (wallet: WalletAccount) => void;
}

const ACCOUNT_CARD_SHADOW = [
  '0 12px 28px rgba(0, 0, 0, 0.4)',
  'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
  'inset 0 0 14px rgba(255, 255, 255, 0.03)',
  'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
].join(', ');
const ACTION_BUTTON_SURFACE = colors.surface.cardElevated;
const ACTION_BUTTON_BORDER = colors.glass.rim;

export const AccountListCard = React.memo(function AccountListCard({
  wallet,
  isPrimary,
  primaryChangePending = false,
  compact = false,
  dense = false,
  actionsMenuOpen = false,
  onActionsMenuOpenChange,
  onRequestExportKeys,
  onRequestRemoveWallet,
  onRequestSetPrimary,
}: AccountListCardProps): React.JSX.Element {
  const balanceQuery = useOffpayWalletBalance(wallet.publicKey, {
    requestOwner: `settings.accounts.balance.${wallet.id}`,
  });

  const avatarSize = dense ? 44 : compact ? 50 : layout.avatarLg;
  const actionButtonSize = dense ? 38 : compact ? 40 : 42;
  const actionIconSize = dense ? 18 : layout.iconSizeInline;
  const isMenuOpen = actionsMenuOpen;

  const setActionsMenuOpen = useCallback(
    (open: boolean): void => {
      onActionsMenuOpenChange?.(wallet.id, open);
    },
    [onActionsMenuOpenChange, wallet.id],
  );

  const handleSetPrimary = useCallback((): void => {
    if (isPrimary || primaryChangePending) return;
    onRequestSetPrimary?.(wallet);
  }, [isPrimary, onRequestSetPrimary, primaryChangePending, wallet]);

  const handleExportKeys = useCallback((): void => {
    setActionsMenuOpen(false);
    onRequestExportKeys?.(wallet);
  }, [onRequestExportKeys, setActionsMenuOpen, wallet]);

  const handleRemoveWallet = useCallback((): void => {
    setActionsMenuOpen(false);
    onRequestRemoveWallet?.(wallet);
  }, [onRequestRemoveWallet, setActionsMenuOpen, wallet]);

  const handleActionsPress = useCallback((): void => {
    setActionsMenuOpen(!isMenuOpen);
  }, [isMenuOpen, setActionsMenuOpen]);

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
            disabled={isPrimary || primaryChangePending}
            accessibilityRole="button"
            accessibilityLabel={isPrimary ? 'Primary wallet' : 'Set as primary wallet'}
            accessibilityState={{ disabled: isPrimary || primaryChangePending }}
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
              onPress={handleActionsPress}
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

            {isMenuOpen ? (
              <Animated.View
                entering={SETTINGS_SURFACE_ENTERING}
                exiting={SETTINGS_SURFACE_EXITING}
                style={[styles.dropdownMenu, { top: actionButtonSize + spacing.sm }]}
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
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
});

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
    backgroundColor: colors.surface.cardElevated,
    boxShadow: ACCOUNT_CARD_SHADOW,
    zIndex: 1,
  },
  shellMenuOpen: {
    zIndex: 40,
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
    backgroundColor: ACTION_BUTTON_SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: ACTION_BUTTON_BORDER,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
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
    backgroundColor: colors.brand.glossAccent,
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
    backgroundColor: colors.brand.glossAccent,
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
    right: -spacing.sm,
    minWidth: 168,
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  dropdownContent: {
    width: '100%',
    gap: spacing.xs,
    backgroundColor: 'transparent',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: layout.buttonHeightMd,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: [
      '0 6px 16px rgba(0, 0, 0, 0.35)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.14)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
    ].join(', '),
  },
});
