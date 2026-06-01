import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
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
  onRequestSetPrimary?: (wallet: WalletAccount) => void;
}

const ACCOUNT_CARD_SHADOW = [
  '0 12px 28px rgba(0, 0, 0, 0.4)',
  'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
  'inset 0 0 14px rgba(255, 255, 255, 0.03)',
  'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
].join(', ');
const MENU_ANIMATION_CONFIG = {
  duration: 120,
  easing: Easing.out(Easing.cubic),
} as const;
const ACTION_BUTTON_SURFACE = colors.surface.cardElevated;
const ACTION_BUTTON_BORDER = colors.glass.rim;

export function AccountListCard({
  wallet,
  isPrimary,
  compact = false,
  dense = false,
  actionsMenuOpen,
  onActionsMenuOpenChange,
  onRequestExportKeys,
  onRequestRemoveWallet,
  onRequestSetPrimary,
}: AccountListCardProps): React.JSX.Element {
  const balanceQuery = useOffpayWalletBalance(wallet.publicKey);

  const [localActionsMenuOpen, setLocalActionsMenuOpen] = useState(Boolean(actionsMenuOpen));
  const menuAnim = useSharedValue(actionsMenuOpen ? 1 : 0);
  const parentNotifyFrameRef = useRef<number | null>(null);
  const openedFromPressInRef = useRef(false);
  const avatarSize = dense ? 44 : compact ? 50 : layout.avatarLg;
  const actionButtonSize = dense ? 38 : compact ? 40 : 42;
  const actionIconSize = dense ? 18 : layout.iconSizeInline;
  const isMenuOpen = localActionsMenuOpen;

  const animateMenu = useCallback(
    (open: boolean): void => {
      menuAnim.value = withTiming(open ? 1 : 0, MENU_ANIMATION_CONFIG);
    },
    [menuAnim],
  );

  const setActionsMenuOpen = useCallback(
    (open: boolean): void => {
      setLocalActionsMenuOpen(open);
      animateMenu(open);

      if (parentNotifyFrameRef.current != null) {
        cancelAnimationFrame(parentNotifyFrameRef.current);
        parentNotifyFrameRef.current = null;
      }

      if (open) {
        parentNotifyFrameRef.current = requestAnimationFrame(() => {
          parentNotifyFrameRef.current = null;
          onActionsMenuOpenChange?.(true);
        });
        return;
      }

      onActionsMenuOpenChange?.(false);
    },
    [animateMenu, onActionsMenuOpenChange],
  );

  useEffect(() => {
    if (actionsMenuOpen == null) return;

    setLocalActionsMenuOpen(actionsMenuOpen);
    animateMenu(actionsMenuOpen);
  }, [actionsMenuOpen, animateMenu]);

  useEffect(
    () => () => {
      if (parentNotifyFrameRef.current != null) {
        cancelAnimationFrame(parentNotifyFrameRef.current);
      }
    },
    [],
  );

  const menuStyle = useAnimatedStyle(() => ({
    opacity: menuAnim.value,
    transform: [
      { translateY: interpolate(menuAnim.value, [0, 1], [-4, 0]) },
      { scale: interpolate(menuAnim.value, [0, 1], [0.98, 1]) },
    ],
  }));

  const handleSetPrimary = (): void => {
    if (isPrimary) return;
    onRequestSetPrimary?.(wallet);
  };

  const handleExportKeys = (): void => {
    setActionsMenuOpen(false);
    onRequestExportKeys?.(wallet);
  };

  const handleRemoveWallet = (): void => {
    setActionsMenuOpen(false);
    onRequestRemoveWallet?.(wallet);
  };

  const handleActionsPressIn = (): void => {
    if (isMenuOpen) return;
    openedFromPressInRef.current = true;
    setActionsMenuOpen(true);
  };

  const handleActionsPress = (): void => {
    if (openedFromPressInRef.current) {
      openedFromPressInRef.current = false;
      return;
    }

    setActionsMenuOpen(!isMenuOpen);
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
              onPressIn={handleActionsPressIn}
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
