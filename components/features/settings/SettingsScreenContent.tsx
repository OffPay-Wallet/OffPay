import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SettingsRow } from '@/components/features/settings/SettingsRow';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { PreferencesModal } from '@/components/features/settings/PreferencesModal';
import { ProfileSettingsModal } from '@/components/features/settings/ProfileSettingsModal';
import { SecuritySettingsModal } from '@/components/features/settings/SecuritySettingsModal';
import { useAppToast } from '@/components/ui/AppToast';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { Text } from '@/components/ui/Text';
import { PuffyTwitterXIcon } from '@/components/ui/icons/PuffyTwitterXIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { resetForgottenWallet } from '@/lib/wallet/wallet-reset';
import { useAppStore } from '@/store/app';
import { useOverlayVisibilityStore } from '@/store/overlayVisibilityStore';

const SUPPORT_EMAIL = 'hello@offpay.app';
const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;
const X_HANDLE = '@OffPaySolana';
const X_PROFILE_URL = 'https://x.com/OffPaySolana';

interface SettingsScreenContentProps {
  bottomPadding: number;
}

export function SettingsScreenContent({
  bottomPadding,
}: SettingsScreenContentProps): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const username = useAppStore((state) => state.username);
  const appVersion = Constants.expoConfig?.version?.trim();
  const versionLabel =
    appVersion != null && appVersion.length > 0 ? `Version ${appVersion}` : 'Version';
  const usernameLabel = username != null ? `@${username}` : 'Set';
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const contentFrameWidth = Math.min(430, Math.max(0, windowWidth - horizontalPadding * 2));
  const sectionGap = dense ? spacing.md : compact ? spacing.lg : spacing.xl;
  const rowIconSize = dense ? 18 : 20;
  const dialogMaxWidth = Math.min(360, Math.max(280, windowWidth - horizontalPadding * 2));
  // Density tokens for the reset confirmation modal. We size both
  // buttons identically (flex: 1 + matching height/padding) so the
  // modal reads as a balanced two-column layout regardless of the
  // device. The "compact" tier collapses padding so dialog height
  // does not exceed ~210dp on small phones (Galaxy A14 etc).
  const dialogButtonHeight = dense ? 44 : compact ? 46 : 48;
  const dialogButtonPaddingY = dense ? spacing.xs : spacing.sm;
  const dialogIconSize = dense ? 16 : 17;
  const dialogTitleFontSize = dense ? 18 : compact ? 20 : 22;
  const dialogTitleLineHeight = dialogTitleFontSize + 6;
  const dialogBodyFontSize = dense ? 13 : compact ? 14 : 15;
  const dialogBodyLineHeight = dialogBodyFontSize + 6;

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [destroying, setDestroying] = useState(false);
  // Preferences & Security open as inline bottom sheets layered over
  // the settings screen — not as separate routes — so tapping a card
  // slides the sheet up over the dimmed settings list instead of
  // pushing a new screen (which flashed the navigator backdrop).
  const [preferencesVisible, setPreferencesVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [securityVisible, setSecurityVisible] = useState(false);
  const showOverlay = useOverlayVisibilityStore((s) => s.showOverlay);
  const hideOverlay = useOverlayVisibilityStore((s) => s.hideOverlay);

  // Hide the floating tab bar while a settings sheet is open. Keyed by a
  // stable overlay id so overlapping opens/closes stay consistent, and
  // the cleanup always releases the flag if this screen unmounts while a
  // sheet is still open (no stuck-hidden tab bar).
  const anySettingsSheetOpen = preferencesVisible || profileVisible || securityVisible;
  useEffect(() => {
    const overlayId = 'settings-sheet';
    if (anySettingsSheetOpen) {
      showOverlay(overlayId);
    } else {
      hideOverlay(overlayId);
    }
    return () => hideOverlay(overlayId);
  }, [anySettingsSheetOpen, showOverlay, hideOverlay]);

  const handleOpenConfirm = useCallback((): void => {
    if (destroying) return;
    setConfirmVisible(true);
  }, [destroying]);

  const handleCancelConfirm = useCallback((): void => {
    if (destroying) return;
    setConfirmVisible(false);
  }, [destroying]);

  const handleConfirmDestroy = useCallback((): void => {
    if (destroying) return;
    setDestroying(true);
    void (async () => {
      try {
        await resetForgottenWallet({ queryClient });
        // Reset succeeded — close the modal and route to onboarding
        // as a fresh user. `replace` removes the settings tab from
        // the back stack so the back gesture can't return to a
        // half-destroyed app.
        setConfirmVisible(false);
        router.replace('/onboarding');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not reset this device. Try again.';
        showToast({
          title: 'Reset failed',
          message,
          variant: 'error',
        });
      } finally {
        setDestroying(false);
      }
    })();
  }, [destroying, queryClient, router, showToast]);

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: bottomPadding,
            paddingHorizontal: horizontalPadding,
            gap: sectionGap,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.contentFrame, { width: contentFrameWidth, gap: sectionGap }]}>
          <View style={[styles.sections, { gap: sectionGap }]}>
            <StaggerRevealItem index={0}>
              <View style={styles.sectionBlock}>
                <Text
                  variant="captionBold"
                  color={colors.text.secondary}
                  style={styles.sectionTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                >
                  General
                </Text>
                <SettingsSectionCard>
                  <SettingsRow
                    iconNode={
                      <Ionicons name="wallet" size={rowIconSize} color={colors.text.primary} />
                    }
                    label="Accounts"
                    compact={compact}
                    dense={dense}
                    onPress={() => router.push('/accounts')}
                  />
                  <SettingsRow
                    iconNode={
                      <Ionicons
                        name="person-circle"
                        size={rowIconSize}
                        color={colors.text.primary}
                      />
                    }
                    label="Username"
                    rightValue={usernameLabel}
                    compact={compact}
                    dense={dense}
                    onPress={() => setProfileVisible(true)}
                  />
                  <SettingsRow
                    iconNode={
                      <Ionicons name="options" size={rowIconSize} color={colors.text.primary} />
                    }
                    label="Preferences"
                    compact={compact}
                    dense={dense}
                    onPress={() => setPreferencesVisible(true)}
                  />
                </SettingsSectionCard>
              </View>
            </StaggerRevealItem>

            <StaggerRevealItem index={1}>
              <View style={styles.sectionBlock}>
                <Text
                  variant="captionBold"
                  color={colors.text.primary}
                  style={styles.sectionTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                >
                  Security
                </Text>
                <SettingsSectionCard>
                  <SettingsRow
                    iconNode={
                      <Ionicons
                        name="shield-checkmark"
                        size={rowIconSize}
                        color={colors.text.primary}
                      />
                    }
                    label="Security"
                    compact={compact}
                    dense={dense}
                    onPress={() => setSecurityVisible(true)}
                  />
                </SettingsSectionCard>
              </View>
            </StaggerRevealItem>

            <StaggerRevealItem index={2}>
              <View style={styles.sectionBlock}>
                <Text
                  variant="captionBold"
                  color={colors.text.primary}
                  style={styles.sectionTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                >
                  Help
                </Text>
                <SettingsSectionCard>
                  <SettingsRow
                    iconNode={
                      <Ionicons name="mail" size={rowIconSize} color={colors.text.primary} />
                    }
                    label="Support"
                    isExternal
                    compact={compact}
                    dense={dense}
                    onPress={() => {
                      void Linking.openURL(SUPPORT_EMAIL_URL);
                    }}
                  />
                  <SettingsRow
                    iconNode={
                      <PuffyTwitterXIcon size={rowIconSize} color={colors.text.primary} focused />
                    }
                    label="X (Twitter)"
                    rightValue={X_HANDLE}
                    isExternal
                    compact={compact}
                    dense={dense}
                    onPress={() => {
                      void Linking.openURL(X_PROFILE_URL);
                    }}
                  />
                </SettingsSectionCard>
              </View>
            </StaggerRevealItem>

            <StaggerRevealItem index={3}>
              <View style={styles.sectionBlock}>
                <Text
                  variant="captionBold"
                  color={colors.semantic.error}
                  style={styles.sectionTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                >
                  Danger Zone
                </Text>
                <SettingsSectionCard>
                  <SettingsRow
                    iconNode={
                      <Ionicons name="trash" size={rowIconSize} color={colors.semantic.error} />
                    }
                    label={destroying ? 'Resetting wallet' : 'Reset wallet'}
                    rightNode={
                      destroying ? (
                        <ActivityIndicator size="small" color={colors.semantic.error} />
                      ) : undefined
                    }
                    destructive
                    disabled={destroying}
                    compact={compact}
                    dense={dense}
                    onPress={handleOpenConfirm}
                  />
                </SettingsSectionCard>
              </View>
            </StaggerRevealItem>

            <StaggerRevealItem index={4}>
              <View style={styles.versionFooter}>
                <Text
                  variant="small"
                  color={colors.text.tertiary}
                  align="center"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                >
                  {versionLabel}
                </Text>
              </View>
            </StaggerRevealItem>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelConfirm}
        statusBarTranslucent
      >
        <View
          style={styles.confirmLayer}
          accessibilityViewIsModal
          accessibilityLabel="Reset wallet confirmation"
        >
          <Pressable
            style={styles.confirmScrim}
            onPress={handleCancelConfirm}
            disabled={destroying}
            accessibilityRole="button"
            accessibilityLabel="Cancel reset"
          />
          <View style={[styles.confirmCard, { maxWidth: dialogMaxWidth }]}>
            <Text
              variant="h3"
              color={colors.text.primary}
              align="center"
              style={[
                styles.confirmTitle,
                { fontSize: dialogTitleFontSize, lineHeight: dialogTitleLineHeight },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.05}
            >
              Reset wallet?
            </Text>
            <Text
              variant="body"
              color={colors.text.secondary}
              align="center"
              style={[
                styles.confirmBody,
                { fontSize: dialogBodyFontSize, lineHeight: dialogBodyLineHeight },
              ]}
              numberOfLines={3}
              maxFontSizeMultiplier={1.05}
            >
              Wipes wallets, keys, and history. This can&apos;t be undone.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmDialogButton,
                  styles.confirmCancelButton,
                  {
                    minHeight: dialogButtonHeight,
                    paddingVertical: dialogButtonPaddingY,
                  },
                  pressed ? styles.confirmCancelButtonPressed : null,
                ]}
                onPress={handleCancelConfirm}
                disabled={destroying}
                accessibilityRole="button"
                accessibilityLabel="Cancel reset"
              >
                <Text
                  variant="button"
                  color={colors.text.primary}
                  align="center"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.05}
                  style={styles.confirmButtonLabel}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmDialogButton,
                  styles.confirmResetButton,
                  {
                    minHeight: dialogButtonHeight,
                    paddingVertical: dialogButtonPaddingY,
                  },
                  pressed && !destroying ? styles.resetButtonPressed : null,
                  destroying ? styles.resetButtonDisabled : null,
                ]}
                onPress={handleConfirmDestroy}
                disabled={destroying}
                accessibilityRole="button"
                accessibilityLabel="Confirm reset and erase this device"
                accessibilityState={{ busy: destroying, disabled: destroying }}
              >
                {destroying ? (
                  <ActivityIndicator size="small" color={colors.brand.whiteStream} />
                ) : (
                  <View style={styles.confirmResetContent}>
                    <Ionicons name="trash" size={dialogIconSize} color={colors.brand.whiteStream} />
                    <Text
                      variant="button"
                      color={colors.brand.whiteStream}
                      align="center"
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.05}
                      style={styles.confirmButtonLabel}
                    >
                      Reset
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <PreferencesModal visible={preferencesVisible} onClose={() => setPreferencesVisible(false)} />

      <ProfileSettingsModal visible={profileVisible} onClose={() => setProfileVisible(false)} />

      <SecuritySettingsModal visible={securityVisible} onClose={() => setSecurityVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.xs,
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: 430,
    gap: spacing.md,
  },
  sections: {
    gap: spacing.md,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  sectionTitle: {
    paddingHorizontal: spacing.lg,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  versionFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    alignItems: 'center',
  },
  resetButtonPressed: {
    backgroundColor: colors.semantic.error,
  },
  resetButtonDisabled: {
    backgroundColor: colors.semantic.error,
  },

  // Confirm modal.
  confirmLayer: {
    flex: 1,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing['3xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  confirmCard: {
    width: '100%',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xl,
    gap: spacing.md,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 18px 36px rgba(0, 0, 0, 0.44)',
  },
  confirmTitle: {
    textAlign: 'center',
  },
  confirmBody: {
    textAlign: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  // Shared base — both dialog buttons stretch to equal width via
  // flex: 1 so the layout reads symmetric on every screen size.
  confirmDialogButton: {
    flex: 1,
    flexBasis: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelButton: {
    backgroundColor: colors.brand.glassTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  confirmCancelButtonPressed: {
    backgroundColor: colors.brand.glassTint,
  },
  confirmResetButton: {
    backgroundColor: colors.semantic.error,
  },
  confirmButtonLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  confirmResetContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
