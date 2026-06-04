import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AccountActionDialog,
  type AccountActionDialogState,
} from '@/components/features/settings/AccountActionDialog';
import { AccountListCard } from '@/components/features/settings/AccountListCard';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { useWalletStore } from '@/store/walletStore';

import type { WalletAccount } from '@/store/walletStore';

const WALLET_REORDER_TRANSITION = LinearTransition.duration(460).easing(
  Easing.bezier(0.16, 1, 0.3, 1),
);
const SCREEN_MAX_WIDTH = 640;
const ADD_WALLET_CARD_MAX_WIDTH = 520;
const CONTROL_SURFACE = colors.surface.cardElevated;
const CONTROL_BORDER = colors.glass.rim;
const HEADER_BUTTON_SHADOW = [
  'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
  'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
  '0 3px 8px rgba(0, 0, 0, 0.18)',
].join(', ');
const MODAL_CARD_SHADOW = [
  '0 12px 28px rgba(0, 0, 0, 0.44)',
  'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
  'inset 0 0 14px rgba(255, 255, 255, 0.03)',
  'inset 0 -1px 3px rgba(0, 0, 0, 0.3)',
].join(', ');

export function AccountsScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const wallets = useWalletStore((s) => s.wallets);
  const activeWalletId = useWalletStore((s) => s.activeWalletId);
  const setPrimaryWallet = useWalletStore((s) => s.setPrimaryWallet);
  const removeWallet = useWalletStore((s) => s.removeWallet);
  const [optimisticPrimaryWalletId, setOptimisticPrimaryWalletId] = useState<string | null>(null);
  const [isAddWalletCardOpen, setIsAddWalletCardOpen] = useState(false);
  const [openActionWalletId, setOpenActionWalletId] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<AccountActionDialogState | null>(null);
  const [removingWallet, setRemovingWallet] = useState(false);

  const compact = width < 390 || height < 760 || fontScale > 1.08;
  const dense = width < 340 || height < 700 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const headerButtonSize = dense ? 42 : layout.buttonHeightMd;
  const headerIconSize = dense ? 22 : layout.iconSizeNav;
  const modalCardWidth = Math.min(
    Math.max(width - horizontalPadding * 2, 0),
    ADD_WALLET_CARD_MAX_WIDTH,
  );
  const effectivePrimaryWalletId = optimisticPrimaryWalletId ?? activeWalletId;
  const displayedWallets = useMemo(() => {
    if (effectivePrimaryWalletId == null) return wallets;
    const primaryWallet = wallets.find((wallet) => wallet.id === effectivePrimaryWalletId);
    if (primaryWallet == null) return wallets;
    return [primaryWallet, ...wallets.filter((wallet) => wallet.id !== effectivePrimaryWalletId)];
  }, [effectivePrimaryWalletId, wallets]);

  useEffect(() => {
    if (optimisticPrimaryWalletId != null && activeWalletId === optimisticPrimaryWalletId) {
      setOptimisticPrimaryWalletId(null);
    }
  }, [activeWalletId, optimisticPrimaryWalletId]);

  const navigateWithTransition = useCallback(
    (pathname: '/create-wallet' | '/restore-wallet'): void => {
      setIsAddWalletCardOpen(false);
      router.push({ pathname, params: { source: 'accounts' } });
    },
    [router],
  );

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const closeActionDialog = useCallback((): void => {
    if (removingWallet) return;
    setActionDialog(null);
  }, [removingWallet]);

  const handleRequestExportKeys = useCallback(
    (wallet: WalletAccount): void => {
      setOpenActionWalletId(null);

      if (wallet.id !== activeWalletId) {
        setActionDialog({ type: 'set-primary-required', wallet });
        return;
      }

      router.push({ pathname: '/security', params: { action: 'exportKeys' } });
    },
    [activeWalletId, router],
  );

  const handleSetPrimaryWallet = useCallback(
    (wallet: WalletAccount): void => {
      if (wallet.id === effectivePrimaryWalletId) return;

      setOpenActionWalletId(null);
      setOptimisticPrimaryWalletId(wallet.id);

      void setPrimaryWallet(wallet.id).catch((error: unknown) => {
        setOptimisticPrimaryWalletId(null);
        const message = error instanceof Error ? error.message : 'Failed to set primary wallet';
        Alert.alert('Unable to update wallet', message);
      });
    },
    [effectivePrimaryWalletId, setPrimaryWallet],
  );

  const handleRequestRemoveWallet = useCallback(
    (wallet: WalletAccount): void => {
      setOpenActionWalletId(null);
      setActionDialog({
        type: wallets.length <= 1 ? 'only-wallet' : 'remove-wallet',
        wallet,
      });
    },
    [wallets.length],
  );

  const handleConfirmRemoveWallet = useCallback((): void => {
    if (actionDialog?.type !== 'remove-wallet' || removingWallet) return;

    const { wallet } = actionDialog;
    setRemovingWallet(true);

    void removeWallet(wallet.id)
      .then(() => {
        setActionDialog(null);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to remove wallet';
        setActionDialog({ type: 'remove-error', wallet, message });
      })
      .finally(() => {
        setRemovingWallet(false);
      });
  }, [actionDialog, removeWallet, removingWallet]);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.frame,
          {
            paddingTop: insets.top + (dense ? spacing.md : spacing.xl),
            paddingHorizontal: horizontalPadding,
          },
        ]}
      >
        <View style={[styles.header, dense && styles.headerDense]}>
          <Pressable
            style={({ pressed }) => [
              styles.iconBtn,
              { width: headerButtonSize, height: headerButtonSize },
              pressed && styles.iconBtnPressed,
            ]}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={6}
          >
            <Ionicons name="chevron-back" size={headerIconSize} color={colors.text.primary} />
          </Pressable>
          <Text
            variant={dense ? 'h3' : 'h2'}
            color={colors.text.primary}
            style={styles.title}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            Accounts
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.iconBtn,
              styles.iconBtnAccent,
              { width: headerButtonSize, height: headerButtonSize },
              pressed && styles.iconBtnPressed,
            ]}
            onPress={() => setIsAddWalletCardOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add wallet"
            hitSlop={6}
          >
            <Ionicons name="add" size={headerIconSize} color={colors.text.primary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing['2xl'] },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeader}>
            <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
              Wallets
            </Text>
            <View style={styles.walletCountPill}>
              <Text variant="small" color={colors.text.primary}>
                {wallets.length}
              </Text>
            </View>
          </View>

          {wallets.length > 0 ? (
            displayedWallets.map((wallet, index) => {
              const actionsOpen = openActionWalletId === wallet.id;

              return (
                <Animated.View
                  key={wallet.id}
                  entering={FadeIn.duration(180).easing(Easing.out(Easing.cubic))}
                  layout={WALLET_REORDER_TRANSITION}
                  style={[
                    styles.walletCardLayer,
                    {
                      zIndex: actionsOpen ? 40 : wallets.length - index,
                    },
                  ]}
                >
                  <AccountListCard
                    wallet={wallet}
                    isPrimary={wallet.id === effectivePrimaryWalletId}
                    isOnlyWallet={displayedWallets.length === 1}
                    compact={compact}
                    dense={dense}
                    actionsMenuOpen={actionsOpen}
                    onActionsMenuOpenChange={(open) =>
                      setOpenActionWalletId(open ? wallet.id : null)
                    }
                    onRequestExportKeys={handleRequestExportKeys}
                    onRequestRemoveWallet={handleRequestRemoveWallet}
                    onRequestSetPrimary={handleSetPrimaryWallet}
                  />
                </Animated.View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <Ionicons
                name="wallet-outline"
                size={layout.iconSizeTab}
                color={colors.text.secondary}
              />
              <Text variant="bodyBold" color={colors.text.primary}>
                No wallets yet
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.emptyAddButton,
                  pressed && styles.emptyAddButtonPressed,
                ]}
                onPress={() => setIsAddWalletCardOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Add wallet"
              >
                <Ionicons name="add" size={layout.iconSizeInline} color={colors.text.onAccent} />
                <Text variant="buttonSmall" color={colors.text.onAccent}>
                  Add wallet
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>

      {isAddWalletCardOpen ? (
        <Animated.View
          entering={FadeIn.duration(160).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(120).easing(Easing.out(Easing.cubic))}
          style={[
            styles.addWalletOverlay,
            {
              paddingTop: insets.top + spacing.lg,
              paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg,
              paddingHorizontal: horizontalPadding,
            },
          ]}
        >
          <Pressable
            style={styles.addWalletBackdrop}
            onPress={() => setIsAddWalletCardOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close add wallet options"
          />
          <Animated.View
            entering={FadeIn.duration(220).easing(Easing.out(Easing.cubic))}
            exiting={FadeOut.duration(120).easing(Easing.out(Easing.cubic))}
            style={{ width: modalCardWidth }}
          >
            <View style={styles.addWalletCard}>
              <View style={styles.addWalletHeader}>
                <Text variant="h3" color={colors.text.primary} numberOfLines={1}>
                  Add Wallet
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.addWalletClose, pressed && styles.iconBtnPressed]}
                  onPress={() => setIsAddWalletCardOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                >
                  <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
                </Pressable>
              </View>

              <View style={styles.addWalletChoices}>
                <Pressable
                  style={({ pressed }) => [
                    styles.addWalletChoice,
                    pressed && styles.addWalletChoicePressed,
                  ]}
                  onPress={() => navigateWithTransition('/restore-wallet')}
                  accessibilityRole="button"
                  accessibilityLabel="Import existing wallet"
                >
                  <View style={styles.choiceIcon}>
                    <Ionicons
                      name="download-outline"
                      size={layout.iconSizeInline}
                      color={colors.text.onAccent}
                    />
                  </View>
                  <Text
                    variant="bodyBold"
                    color={colors.text.primary}
                    style={styles.choiceLabel}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    Import existing wallet
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={layout.iconSizeInline}
                    color={colors.text.secondary}
                  />
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.addWalletChoice,
                    pressed && styles.addWalletChoicePressed,
                  ]}
                  onPress={() => navigateWithTransition('/create-wallet')}
                  accessibilityRole="button"
                  accessibilityLabel="Create new wallet"
                >
                  <View style={styles.choiceIcon}>
                    <Ionicons
                      name="add"
                      size={layout.iconSizeInline + 2}
                      color={colors.text.onAccent}
                    />
                  </View>
                  <Text
                    variant="bodyBold"
                    color={colors.text.primary}
                    style={styles.choiceLabel}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    Create new wallet
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={layout.iconSizeInline}
                    color={colors.text.secondary}
                  />
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      ) : null}

      <AccountActionDialog
        dialog={actionDialog}
        removing={removingWallet}
        onClose={closeActionDialog}
        onConfirmRemove={handleConfirmRemoveWallet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: SCREEN_MAX_WIDTH,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headerDense: {
    marginBottom: spacing.sm,
  },
  iconBtn: {
    borderRadius: radii.full,
    backgroundColor: CONTROL_SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: CONTROL_BORDER,
    boxShadow: HEADER_BUTTON_SHADOW,
    flexShrink: 0,
  },
  iconBtnAccent: {
    backgroundColor: CONTROL_SURFACE,
  },
  iconBtnPressed: {
    opacity: 0.72,
  },
  title: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  walletCardLayer: {
    position: 'relative',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  walletCountPill: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: CONTROL_SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: CONTROL_BORDER,
    boxShadow: HEADER_BUTTON_SHADOW,
  },
  emptyState: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: MODAL_CARD_SHADOW,
  },
  emptyAddButton: {
    minHeight: layout.buttonHeightSm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.brand.glossAccent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emptyAddButtonPressed: {
    opacity: 0.76,
  },
  addWalletOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addWalletBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  addWalletCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    padding: spacing.lg,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: MODAL_CARD_SHADOW,
  },
  addWalletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  addWalletClose: {
    width: layout.buttonHeightSm,
    height: layout.buttonHeightSm,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    flexShrink: 0,
  },
  addWalletChoices: {
    gap: spacing.sm,
  },
  addWalletChoice: {
    minHeight: layout.buttonHeightLg,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.glass.textBacking,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  addWalletChoicePressed: {
    opacity: 0.76,
  },
  choiceIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    flexShrink: 0,
  },
  choiceLabel: {
    flex: 1,
    minWidth: 0,
  },
});
