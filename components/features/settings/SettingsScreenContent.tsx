import React, { useCallback, useRef, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';

import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router/react-navigation';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SettingsRow } from '@/components/features/settings/SettingsRow';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { ContactsModal } from '@/components/features/contacts/ContactsModal';
import { PreferencesModal } from '@/components/features/settings/PreferencesModal';
import { ProfileSettingsModal } from '@/components/features/settings/ProfileSettingsModal';
import { SecuritySettingsModal } from '@/components/features/settings/SecuritySettingsModal';
import { useAppToast } from '@/components/ui/AppToast';
import { NativeSettingsResetActions } from '@/components/ui/NativeSettingsResetActions';
import { Text } from '@/components/ui/Text';
import {
  SETTINGS_BACKDROP_ENTERING,
  SETTINGS_SURFACE_ENTERING,
} from '@/components/ui/settings-motion';
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
const SETTINGS_SHEET_OVERLAY_ID = 'settings-sheet';

interface SettingsScreenContentProps {
  bottomPadding: number;
}

type SettingsSheet = 'contacts' | 'preferences' | 'profile' | 'security';

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
  const dialogTitleFontSize = dense ? 18 : compact ? 20 : 22;
  const dialogTitleLineHeight = dialogTitleFontSize + 6;
  const dialogBodyFontSize = dense ? 13 : compact ? 14 : 15;
  const dialogBodyLineHeight = dialogBodyFontSize + 6;
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const destroyingRef = useRef(false);
  // Preferences & Security open as inline bottom sheets layered over
  // the settings screen — not as separate routes — so tapping a card
  // slides the sheet up over the dimmed settings list instead of
  // pushing a new screen (which flashed the navigator backdrop).
  const [activeSheet, setActiveSheet] = useState<SettingsSheet | null>(null);
  const showOverlay = useOverlayVisibilityStore((s) => s.showOverlay);
  const hideOverlay = useOverlayVisibilityStore((s) => s.hideOverlay);

  const handleOpenConfirm = useCallback((): void => {
    if (destroyingRef.current) return;
    setConfirmVisible(true);
  }, []);

  const handleOpenAccounts = useCallback((): void => {
    if (!isFocused) return;
    router.push('/accounts');
  }, [isFocused, router]);

  const handleCancelConfirm = useCallback((): void => {
    if (destroyingRef.current) return;
    setConfirmVisible(false);
  }, []);

  const handleConfirmDestroy = useCallback((): void => {
    if (destroyingRef.current) return;
    destroyingRef.current = true;
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
        destroyingRef.current = false;
        setDestroying(false);
      }
    })();
  }, [queryClient, router, showToast]);

  const openSettingsSheet = useCallback(
    (sheet: SettingsSheet): void => {
      showOverlay(SETTINGS_SHEET_OVERLAY_ID);
      setActiveSheet(sheet);
    },
    [showOverlay],
  );

  const closeSettingsSheet = useCallback((): void => {
    setActiveSheet(null);
    hideOverlay(SETTINGS_SHEET_OVERLAY_ID);
  }, [hideOverlay]);

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
            <View>
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
                    onPress={() => openSettingsSheet('profile')}
                  />
                  <SettingsRow
                    iconNode={
                      <Ionicons name="options" size={rowIconSize} color={colors.text.primary} />
                    }
                    label="Preferences"
                    compact={compact}
                    dense={dense}
                    onPress={() => openSettingsSheet('preferences')}
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
                    onPress={() => openSettingsSheet('contacts')}
                  />
                </SettingsSectionCard>
              </View>
            </View>

            <View>
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
                    onPress={() => openSettingsSheet('security')}
                  />
                </SettingsSectionCard>
              </View>
            </View>

            <View>
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
            </View>

            <View>
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
                    destructive
                    disabled={destroying}
                    compact={compact}
                    dense={dense}
                    onPress={handleOpenConfirm}
                  />
                </SettingsSectionCard>
              </View>
            </View>

            <View>
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
            </View>
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
          <Animated.View entering={SETTINGS_BACKDROP_ENTERING} style={styles.confirmScrim}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={handleCancelConfirm}
              disabled={destroying}
              accessibilityRole="button"
              accessibilityLabel="Cancel reset"
            />
          </Animated.View>
          <Animated.View
            entering={SETTINGS_SURFACE_ENTERING}
            style={[styles.confirmCard, { maxWidth: dialogMaxWidth }]}
          >
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
              <NativeSettingsResetActions
                busy={destroying}
                cancelBackgroundColor={colors.surface.cardElevated}
                cancelBorderColor={colors.glass.rim}
                cancelTextColor={colors.text.primary}
                confirmBackgroundColor={colors.semantic.error}
                confirmTextColor={colors.brand.whiteStream}
                onCancel={handleCancelConfirm}
                onConfirm={handleConfirmDestroy}
              />
            </View>
          </Animated.View>
        </View>
      </Modal>

      {activeSheet === 'preferences' ? (
        <PreferencesModal visible onClose={closeSettingsSheet} />
      ) : null}

      {activeSheet === 'profile' ? (
        <ProfileSettingsModal visible onClose={closeSettingsSheet} />
      ) : null}

      {activeSheet === 'contacts' ? <ContactsModal visible onClose={closeSettingsSheet} /> : null}

      {activeSheet === 'security' ? (
        <SecuritySettingsModal visible onClose={closeSettingsSheet} />
      ) : null}
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
});
