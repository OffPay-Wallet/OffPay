import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router/react-navigation';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SettingsRow } from '@/components/features/settings/SettingsRow';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { ContactsModal } from '@/components/features/contacts/ContactsModal';
import { PreferencesModal } from '@/components/features/settings/PreferencesModal';
import { ProfileSettingsModal } from '@/components/features/settings/ProfileSettingsModal';
import { SecuritySettingsModal } from '@/components/features/settings/SecuritySettingsModal';
import { useAppToast } from '@/components/ui/AppToast';
import { Text } from '@/components/ui/Text';
import { PuffyAddContactIcon } from '@/components/ui/icons/PuffyAddContactIcon';
import { PuffyTwitterXIcon } from '@/components/ui/icons/PuffyTwitterXIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { resetForgottenWallet } from '@/lib/wallet/wallet-reset';
import { useAppStore } from '@/store/app';
import { useContactsStore } from '@/store/contactsStore';
import { useOverlayVisibilityStore } from '@/store/overlayVisibilityStore';

const SUPPORT_EMAIL = 'hello@offpay.app';
const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`;
const X_HANDLE = '@OffPaySolana';
const X_PROFILE_URL = 'https://x.com/OffPaySolana';
const RESET_CONFIRM_SCRIM_DURATION_MS = 360;
const RESET_CONFIRM_CARD_DURATION_MS = 560;
const RESET_CONFIRM_CONTENT_DURATION_MS = 460;
const RESET_CONFIRM_BLUR_DURATION_MS = 300;
const RESET_CONFIRM_CONTENT_DELAY_MS = 24;
const RESET_CONFIRM_IOS_EASING = Easing.bezier(0.2, 0.82, 0.2, 1);
const RESET_CONFIRM_CLOSE_DURATION_MS = 340;
const RESET_CONFIRM_CLOSE_EASING = Easing.bezier(0.36, 0, 0.66, 1);
const SETTINGS_CARD_ENTERING = FadeIn.duration(140)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({
    opacity: 0,
    transform: [{ translateY: 4 }],
  });
const SETTINGS_CARD_LAYOUT = LinearTransition.duration(180).easing(Easing.out(Easing.cubic));

interface SettingsScreenContentProps {
  bottomPadding: number;
}

export function SettingsScreenContent({
  bottomPadding,
}: SettingsScreenContentProps): React.JSX.Element {
  const router = useRouter();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const username = useAppStore((state) => state.username);
  const contactCount = useContactsStore((state) => state.contacts.length);
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
  const resetConfirmInitialTranslateY = Math.min(220, Math.max(128, windowHeight * 0.24));

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmClosing, setConfirmClosing] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const confirmClosingRef = useRef(false);
  // Preferences & Security open as inline bottom sheets layered over
  // the settings screen — not as separate routes — so tapping a card
  // slides the sheet up over the dimmed settings list instead of
  // pushing a new screen (which flashed the navigator backdrop).
  const [preferencesVisible, setPreferencesVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [contactsVisible, setContactsVisible] = useState(false);
  const [securityVisible, setSecurityVisible] = useState(false);
  const resetConfirmScrim = useSharedValue(0);
  const resetConfirmMotion = useSharedValue(0);
  const resetConfirmContent = useSharedValue(0);
  const resetConfirmBlur = useSharedValue(0);
  const showOverlay = useOverlayVisibilityStore((s) => s.showOverlay);
  const hideOverlay = useOverlayVisibilityStore((s) => s.hideOverlay);

  const resetConfirmScrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(resetConfirmScrim.value, [0, 1], [0, 1]),
  }));

  const resetConfirmCardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(resetConfirmContent.value, [0, 0.22, 1], [0, 1, 1]),
    transform: [
      {
        translateY: interpolate(
          resetConfirmMotion.value,
          [0, 1],
          [resetConfirmInitialTranslateY, 0],
        ),
      },
      { scale: interpolate(resetConfirmMotion.value, [0, 1], [0.9, 1]) },
    ],
  }));

  const resetConfirmBlurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(resetConfirmBlur.value, [0, 1], [1, 0]),
    filter: [{ blur: interpolate(resetConfirmBlur.value, [0, 1], [3.5, 0]) }],
  }));

  // Hide the floating tab bar while a settings sheet is open. Keyed by a
  // stable overlay id so overlapping opens/closes stay consistent, and
  // the cleanup always releases the flag if this screen unmounts while a
  // sheet is still open (no stuck-hidden tab bar).
  const anySettingsSheetOpen =
    preferencesVisible || profileVisible || contactsVisible || securityVisible;
  useEffect(() => {
    const overlayId = 'settings-sheet';
    if (anySettingsSheetOpen) {
      showOverlay(overlayId);
    } else {
      hideOverlay(overlayId);
    }
    return () => hideOverlay(overlayId);
  }, [anySettingsSheetOpen, showOverlay, hideOverlay]);

  useEffect(() => {
    if (!confirmVisible) {
      resetConfirmScrim.value = 0;
      resetConfirmMotion.value = 0;
      resetConfirmContent.value = 0;
      resetConfirmBlur.value = 0;
      return;
    }

    resetConfirmScrim.value = 0;
    resetConfirmMotion.value = 0;
    resetConfirmContent.value = 0;
    resetConfirmBlur.value = 0;
    confirmClosingRef.current = false;
    setConfirmClosing(false);

    resetConfirmScrim.value = withTiming(1, {
      duration: RESET_CONFIRM_SCRIM_DURATION_MS,
      easing: RESET_CONFIRM_IOS_EASING,
    });
    resetConfirmContent.value = withDelay(
      RESET_CONFIRM_CONTENT_DELAY_MS,
      withTiming(1, {
        duration: RESET_CONFIRM_CONTENT_DURATION_MS,
        easing: RESET_CONFIRM_IOS_EASING,
      }),
    );
    resetConfirmMotion.value = withDelay(
      RESET_CONFIRM_CONTENT_DELAY_MS,
      withTiming(1, {
        duration: RESET_CONFIRM_CARD_DURATION_MS,
        easing: RESET_CONFIRM_IOS_EASING,
      }),
    );
    resetConfirmBlur.value = withDelay(
      RESET_CONFIRM_CONTENT_DELAY_MS,
      withTiming(1, {
        duration: RESET_CONFIRM_BLUR_DURATION_MS,
        easing: RESET_CONFIRM_IOS_EASING,
      }),
    );
  }, [
    confirmVisible,
    resetConfirmBlur,
    resetConfirmContent,
    resetConfirmMotion,
    resetConfirmScrim,
  ]);

  const handleOpenConfirm = useCallback((): void => {
    if (destroying) return;
    confirmClosingRef.current = false;
    setConfirmClosing(false);
    setConfirmVisible(true);
  }, [destroying]);

  const handleOpenAccounts = useCallback((): void => {
    if (!isFocused) return;
    router.push('/accounts');
  }, [isFocused, router]);

  const finishConfirmClose = useCallback((): void => {
    confirmClosingRef.current = false;
    setConfirmClosing(false);
    setConfirmVisible(false);
  }, []);

  const handleCancelConfirm = useCallback((): void => {
    if (destroying || confirmClosingRef.current) return;

    confirmClosingRef.current = true;
    setConfirmClosing(true);
    resetConfirmScrim.value = withTiming(0, {
      duration: RESET_CONFIRM_CLOSE_DURATION_MS,
      easing: RESET_CONFIRM_CLOSE_EASING,
    });
    resetConfirmContent.value = withTiming(0, {
      duration: RESET_CONFIRM_CLOSE_DURATION_MS,
      easing: RESET_CONFIRM_CLOSE_EASING,
    });
    resetConfirmBlur.value = withTiming(0, {
      duration: RESET_CONFIRM_CLOSE_DURATION_MS,
      easing: RESET_CONFIRM_CLOSE_EASING,
    });
    resetConfirmMotion.value = withTiming(
      0,
      {
        duration: RESET_CONFIRM_CLOSE_DURATION_MS,
        easing: RESET_CONFIRM_CLOSE_EASING,
      },
      (finished) => {
        if (finished) runOnJS(finishConfirmClose)();
      },
    );
  }, [
    destroying,
    finishConfirmClose,
    resetConfirmBlur,
    resetConfirmContent,
    resetConfirmMotion,
    resetConfirmScrim,
  ]);

  const handleConfirmDestroy = useCallback((): void => {
    if (destroying) return;
    setDestroying(true);
    void (async () => {
      try {
        await resetForgottenWallet({ queryClient });
        // Reset succeeded — close the modal and route through the invite
        // gate as a fresh local install. `replace` removes the settings tab
        // from the back stack so the back gesture can't return to a
        // half-destroyed app.
        setConfirmVisible(false);
        router.replace('/invite-code');
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
            <Animated.View entering={SETTINGS_CARD_ENTERING} layout={SETTINGS_CARD_LAYOUT}>
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
                    onPress={handleOpenAccounts}
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
                  <SettingsRow
                    iconNode={
                      <PuffyAddContactIcon
                        size={rowIconSize}
                        color={colors.text.primary}
                        shadowColor={colors.brand.glossAccent}
                      />
                    }
                    label="Contacts"
                    badgeCount={contactCount > 0 ? contactCount : undefined}
                    compact={compact}
                    dense={dense}
                    onPress={() => setContactsVisible(true)}
                  />
                </SettingsSectionCard>
              </View>
            </Animated.View>

            <Animated.View entering={SETTINGS_CARD_ENTERING} layout={SETTINGS_CARD_LAYOUT}>
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
            </Animated.View>

            <Animated.View entering={SETTINGS_CARD_ENTERING} layout={SETTINGS_CARD_LAYOUT}>
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
            </Animated.View>

            <Animated.View entering={SETTINGS_CARD_ENTERING} layout={SETTINGS_CARD_LAYOUT}>
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
                        <LazyLoadingSpinner size={18} color={colors.semantic.error} />
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
            </Animated.View>

            <Animated.View entering={SETTINGS_CARD_ENTERING} layout={SETTINGS_CARD_LAYOUT}>
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
            </Animated.View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="none"
        onRequestClose={handleCancelConfirm}
        statusBarTranslucent
      >
        <View
          style={styles.confirmLayer}
          accessibilityViewIsModal
          accessibilityLabel="Reset wallet confirmation"
        >
          <Animated.View style={[styles.confirmScrim, resetConfirmScrimStyle]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={handleCancelConfirm}
              disabled={destroying || confirmClosing}
              accessibilityRole="button"
              accessibilityLabel="Cancel reset"
            />
          </Animated.View>
          <Animated.View
            style={[styles.confirmCard, { maxWidth: dialogMaxWidth }, resetConfirmCardStyle]}
          >
            <Animated.View
              pointerEvents="none"
              style={[styles.confirmCardBlurVeil, resetConfirmBlurStyle]}
            />
            <View pointerEvents="none" style={styles.confirmCardGloss} />
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
                disabled={destroying || confirmClosing}
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
                disabled={destroying || confirmClosing}
                accessibilityRole="button"
                accessibilityLabel="Confirm reset and erase this device"
                accessibilityState={{ busy: destroying, disabled: destroying || confirmClosing }}
              >
                {destroying ? (
                  <LazyLoadingSpinner size={18} color={colors.brand.whiteStream} />
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
          </Animated.View>
        </View>
      </Modal>

      <PreferencesModal visible={preferencesVisible} onClose={() => setPreferencesVisible(false)} />

      <ProfileSettingsModal visible={profileVisible} onClose={() => setProfileVisible(false)} />

      <ContactsModal visible={contactsVisible} onClose={() => setContactsVisible(false)} />

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
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  confirmCard: {
    width: '100%',
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.graphiteDepth,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xl,
    gap: spacing.md,
    overflow: 'hidden',
    boxShadow: [
      '0 24px 54px rgba(0, 0, 0, 0.56)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.42)',
    ].join(', '),
  },
  confirmCardGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '52%',
    backgroundColor: colors.glass.smokeWash,
    opacity: 0.86,
  },
  confirmCardBlurVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.brand.graphiteDepth,
    zIndex: 2,
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
    boxShadow: [
      '0 10px 22px rgba(0, 0, 0, 0.28)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.14)',
    ].join(', '),
  },
  confirmCancelButtonPressed: {
    opacity: 0.82,
  },
  confirmResetButton: {
    backgroundColor: colors.semantic.error,
    boxShadow: [
      '0 12px 28px rgba(255, 77, 90, 0.24)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.24)',
    ].join(', '),
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
