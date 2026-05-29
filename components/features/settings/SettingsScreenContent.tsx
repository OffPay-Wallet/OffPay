import React, { useCallback, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';

import { SettingsRow } from '@/components/features/settings/SettingsRow';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { WalletCard } from '@/components/features/settings/WalletCard';
import { useAppToast } from '@/components/ui/AppToast';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { Text } from '@/components/ui/Text';
import { PuffyInfoCircleIcon } from '@/components/ui/icons/PuffyInfoCircleIcon';
import { PuffyShieldIcon } from '@/components/ui/icons/PuffyShieldIcon';
import { PuffySlidersIcon } from '@/components/ui/icons/PuffySlidersIcon';
import { PuffySupportIcon } from '@/components/ui/icons/PuffySupportIcon';
import { PuffyTwitterXIcon } from '@/components/ui/icons/PuffyTwitterXIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { resetForgottenWallet } from '@/lib/wallet/wallet-reset';

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
  const aboutSubtitle = [Constants.expoConfig?.name, Constants.expoConfig?.version]
    .filter((value): value is string => value != null && value.length > 0)
    .join(' ');
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const contentFrameWidth = Math.min(430, Math.max(0, windowWidth - horizontalPadding * 2));
  const sectionGap = dense ? spacing.xs : compact ? spacing.sm : spacing.md;
  const rowIconSize = dense ? 18 : compact ? 19 : layout.iconSizeInline;
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
          error instanceof Error
            ? error.message
            : 'Could not reset this device. Try again.';
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
          <StaggerRevealItem index={0}>
            <WalletCard compact={compact} dense={dense} />
          </StaggerRevealItem>

          <View style={[styles.sections, { gap: sectionGap }]}>
            <StaggerRevealItem index={1}>
              <SettingsSectionCard>
                <SettingsRow
                  iconNode={
                    <PuffySlidersIcon size={rowIconSize} color={colors.text.primary} focused />
                  }
                  label="Preferences"
                  subtitle="Wallet mode, offline payments, network"
                  compact={compact}
                  dense={dense}
                  onPress={() => router.push('/preferences')}
                />
              </SettingsSectionCard>
            </StaggerRevealItem>

            <StaggerRevealItem index={2}>
              <SettingsSectionCard>
                <SettingsRow
                  iconNode={
                    <PuffyShieldIcon size={rowIconSize} color={colors.text.primary} focused />
                  }
                  label="Security"
                  subtitle="Fingerprint, passcode, wallet keys"
                  compact={compact}
                  dense={dense}
                  onPress={() => router.push('/security')}
                />
              </SettingsSectionCard>
            </StaggerRevealItem>

            <StaggerRevealItem index={3}>
              <SettingsSectionCard>
                <SettingsRow
                  iconNode={
                    <PuffySupportIcon size={rowIconSize} color={colors.text.primary} focused />
                  }
                  label="Support"
                  subtitle={SUPPORT_EMAIL}
                  isExternal
                  compact={compact}
                  dense={dense}
                  onPress={() => {
                    void Linking.openURL(SUPPORT_EMAIL_URL);
                  }}
                />
              </SettingsSectionCard>
            </StaggerRevealItem>

            <StaggerRevealItem index={4}>
              <SettingsSectionCard>
                <SettingsRow
                  iconNode={
                    <PuffyTwitterXIcon size={rowIconSize} color={colors.text.primary} focused />
                  }
                  label="X (Twitter)"
                  subtitle={X_HANDLE}
                  isExternal
                  compact={compact}
                  dense={dense}
                  onPress={() => {
                    void Linking.openURL(X_PROFILE_URL);
                  }}
                />
              </SettingsSectionCard>
            </StaggerRevealItem>

            <StaggerRevealItem index={5}>
              <SettingsSectionCard>
                <SettingsRow
                  iconNode={
                    <PuffyInfoCircleIcon size={rowIconSize} color={colors.text.primary} focused />
                  }
                  label="About"
                  subtitle={aboutSubtitle}
                  compact={compact}
                  dense={dense}
                />
              </SettingsSectionCard>
            </StaggerRevealItem>

            {/* Danger zone — single centered Reset button. Tap opens
                the confirmation modal so a single press can never wipe
                the device by itself. */}
            <View style={styles.dangerZone}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset wallet — wipe wallets, keys, and history"
                accessibilityState={{ disabled: destroying, busy: destroying }}
                onPress={handleOpenConfirm}
                disabled={destroying}
                style={({ pressed }) => [
                  styles.resetButton,
                  pressed && !destroying ? styles.resetButtonPressed : null,
                  destroying ? styles.resetButtonDisabled : null,
                ]}
              >
                {destroying ? (
                  <ActivityIndicator size="small" color={colors.brand.whiteStream} />
                ) : (
                  <Text
                    variant="button"
                    color={colors.brand.whiteStream}
                    align="center"
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.05}
                    style={styles.resetButtonLabel}
                  >
                    Reset
                  </Text>
                )}
              </Pressable>
            </View>
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
                  color={colors.brand.deepShadow}
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
                    <Ionicons
                      name="trash"
                      size={dialogIconSize}
                      color={colors.brand.whiteStream}
                    />
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
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
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

  // Danger zone — single centered Reset pill. Distinct from the
  // regular settings card stack so the user has to mentally switch
  // contexts before tapping it.
  dangerZone: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  resetButton: {
    alignSelf: 'center',
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.semantic.error,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
    boxShadow: '0 12px 24px rgba(154, 36, 36, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.32)',
  },
  resetButtonPressed: {
    backgroundColor: colors.notificationIcon.errorInk,
  },
  resetButtonDisabled: {
    backgroundColor: colors.notificationIcon.errorInk,
  },
  resetButtonLabel: {
    fontFamily: fontFamily.uiSemiBold,
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
    backgroundColor: 'rgba(14, 42, 53, 0.46)',
  },
  confirmCard: {
    width: '100%',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.whiteStream,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xl,
    gap: spacing.md,
    boxShadow: `0 8px 24px rgba(14, 42, 53, 0.18)`,
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
    backgroundColor: colors.brand.iceBlue,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  confirmCancelButtonPressed: {
    backgroundColor: colors.glass.cyanWash,
  },
  confirmResetButton: {
    backgroundColor: colors.semantic.error,
    boxShadow: '0 12px 24px rgba(154, 36, 36, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.32)',
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
