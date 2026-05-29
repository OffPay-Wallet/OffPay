import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
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

const WALLET_REORDER_TRANSITION = LinearTransition.duration(320).easing(Easing.out(Easing.cubic));
const SCREEN_MAX_WIDTH = 640;
const ADD_WALLET_CARD_MAX_WIDTH = 520;
const GLASS_PANEL_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const HEADER_BUTTON_SHADOW =
  '0 10px 18px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78)';
const MODAL_CARD_SHADOW =
  '0 24px 52px rgba(4, 28, 36, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.82), inset 0 -14px 26px rgba(91, 200, 232, 0.12)';

export function AccountsScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const wallets = useWalletStore((s) => s.wallets);
  const activeWalletId = useWalletStore((s) => s.activeWalletId);
  const removeWallet = useWalletStore((s) => s.removeWallet);
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
            <Ionicons name="add" size={headerIconSize} color={colors.text.onAccent} />
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
            <Text variant="bodyBold" color={colors.text.secondary} numberOfLines={1}>
              Wallets
            </Text>
            <View style={styles.walletCountPill}>
              <Text variant="small" color={colors.text.secondary}>
                {wallets.length}
              </Text>
            </View>
          </View>

          {wallets.length > 0 ? (
            wallets.map((wallet, index) => {
              const actionsOpen = openActionWalletId === wallet.id;

              return (
                <Animated.View
                  key={wallet.id}
                  entering={FadeIn.duration(260)}
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
                    isPrimary={wallet.id === activeWalletId}
                    isOnlyWallet={wallets.length === 1}
                    compact={compact}
                    dense={dense}
                    actionsMenuOpen={actionsOpen}
                    onActionsMenuOpenChange={(open) =>
                      setOpenActionWalletId(open ? wallet.id : null)
                    }
                    onRequestExportKeys={handleRequestExportKeys}
                    onRequestRemoveWallet={handleRequestRemoveWallet}
                  />
                </Animated.View>
              );
            })
          ) : (
            <LinearGradient
              colors={[...GLASS_PANEL_COLORS]}
              start={{ x: 0.04, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.emptyState}
            >
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
            </LinearGradient>
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
            <LinearGradient
              colors={[...GLASS_PANEL_COLORS]}
              start={{ x: 0.02, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.addWalletCard}
            >
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
            </LinearGradient>
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
    backgroundColor: colors.surface.background,
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
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: HEADER_BUTTON_SHADOW,
    flexShrink: 0,
  },
  iconBtnAccent: {
    backgroundColor: colors.brand.azureCyan,
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
    backgroundColor: colors.glass.textBacking,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
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
    boxShadow: '0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78)',
  },
  emptyAddButton: {
    minHeight: layout.buttonHeightSm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.brand.azureCyan,
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
    backgroundColor: 'rgba(3, 28, 35, 0.48)',
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
    backgroundColor: colors.glass.strongFill,
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
    backgroundColor: colors.brand.azureCyan,
    flexShrink: 0,
  },
  choiceLabel: {
    flex: 1,
    minWidth: 0,
  },
});
