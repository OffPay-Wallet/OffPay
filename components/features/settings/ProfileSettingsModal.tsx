import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { useAppToast } from '@/components/ui/AppToast';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useLocalProfileImageManager } from '@/hooks/useLocalProfileImageManager';
import {
  formatOffpayUsername,
  getOffpayUsernameError,
  OFFPAY_USERNAME_MAX_LENGTH,
  sanitizeOffpayUsernameInput,
} from '@/lib/api/offpay-username';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

interface ProfileSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const SHEET_SHADOW = [
  '0 18px 36px rgba(0, 0, 0, 0.5)',
  'inset 0 1px 2px rgba(255, 255, 255, 0.18)',
  'inset 0 0 16px rgba(255, 255, 255, 0.03)',
  'inset 0 -1px 3px rgba(0, 0, 0, 0.35)',
].join(', ');
const SHEET_CHROME_PADDING = spacing.md;
const HEADER_FALLBACK_HEIGHT = layout.minTouchTarget + spacing.lg + spacing.sm;
const FOOTER_FALLBACK_HEIGHT = layout.buttonHeightMd + spacing.sm + spacing.lg;
const SHEET_MIN_HEIGHT = layout.buttonHeightLg * 2 + spacing['3xl'];
const SHEET_OPEN_TIMING = { duration: 320, easing: Easing.out(Easing.poly(4)) } as const;
const SHEET_CLOSE_TIMING = { duration: 220, easing: Easing.in(Easing.ease) } as const;
const SHEET_SIZE_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) } as const;
const FADE_TIMING = { duration: 220 } as const;

export function ProfileSettingsModal({
  visible,
  onClose,
}: ProfileSettingsModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const username = useAppStore((state) => state.username);
  const setUsername = useAppStore((state) => state.setUsername);
  const setActiveWalletName = useWalletStore((state) => state.setActiveWalletName);
  const { profileImageUri, pickingProfileImage, pickProfileImage, clearProfileImage } =
    useLocalProfileImageManager();
  const [mounted, setMounted] = useState(visible);
  const [draftUsername, setDraftUsername] = useState(() =>
    sanitizeOffpayUsernameInput(username ?? ''),
  );
  const [saving, setSaving] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(HEADER_FALLBACK_HEIGHT);
  const [footerHeight, setFooterHeight] = useState(FOOTER_FALLBACK_HEIGHT);
  const [formHeight, setFormHeight] = useState(0);

  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;
  const sheetMaxWidth = 430;
  const maxSheetHeight = windowHeight - insets.top - overlayPaddingBottom - spacing.lg;
  const resolvedHeaderHeight = headerHeight > 0 ? headerHeight : HEADER_FALLBACK_HEIGHT;
  const resolvedFooterHeight = footerHeight > 0 ? footerHeight : FOOTER_FALLBACK_HEIGHT;
  const bodyMaxHeight = Math.max(
    120,
    maxSheetHeight - resolvedHeaderHeight - resolvedFooterHeight - SHEET_CHROME_PADDING,
  );
  const scrollOverflows = formHeight > bodyMaxHeight;
  const sheetHeight = useMemo(() => {
    const chromeHeight = resolvedHeaderHeight + resolvedFooterHeight + SHEET_CHROME_PADDING;
    const contentBlockHeight = formHeight > 0 ? formHeight : 280;

    if (scrollOverflows) {
      return maxSheetHeight;
    }

    return Math.min(maxSheetHeight, Math.max(SHEET_MIN_HEIGHT, chromeHeight + contentBlockHeight));
  }, [formHeight, maxSheetHeight, resolvedFooterHeight, resolvedHeaderHeight, scrollOverflows]);
  const avatarSize = dense ? 56 : compact ? 62 : 68;
  const usernameError = draftUsername.length > 0 ? getOffpayUsernameError(draftUsername) : null;
  const normalizedUsername = useMemo(
    () => sanitizeOffpayUsernameInput(draftUsername),
    [draftUsername],
  );
  const formattedUsername = formatOffpayUsername(draftUsername);
  const canSave = formattedUsername != null && !saving;

  const translateY = useSharedValue(windowHeight);
  const opacity = useSharedValue(0);
  const animatedSheetHeight = useSharedValue(sheetHeight);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setFormHeight(0);
      setDraftUsername(sanitizeOffpayUsernameInput(username ?? ''));
      setSaving(false);
      opacity.value = withTiming(1, FADE_TIMING);
      translateY.value = withTiming(0, SHEET_OPEN_TIMING);
      return;
    }

    translateY.value = withTiming(windowHeight, SHEET_CLOSE_TIMING, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
    opacity.value = withTiming(0, FADE_TIMING);
  }, [opacity, translateY, username, visible, windowHeight]);

  useEffect(() => {
    animatedSheetHeight.value = withTiming(sheetHeight, SHEET_SIZE_TIMING);
  }, [animatedSheetHeight, sheetHeight]);

  const handleHeaderLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const handleFooterLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setFooterHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const handleFormLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setFormHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    height: animatedSheetHeight.value,
    transform: [{ translateY: translateY.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 0.78 + opacity.value * 0.22,
    transform: [{ translateY: (1 - opacity.value) * 8 }],
  }));

  const closeWithAnimation = useCallback(
    (afterClose?: () => void): void => {
      Keyboard.dismiss();

      const finishClose = (): void => {
        onClose();
        afterClose?.();
      };

      translateY.value = withTiming(windowHeight, SHEET_CLOSE_TIMING, (finished) => {
        if (finished) runOnJS(finishClose)();
      });
      opacity.value = withTiming(0, FADE_TIMING);
    },
    [onClose, opacity, translateY, windowHeight],
  );

  const handleClose = useCallback((): void => {
    if (saving) return;
    closeWithAnimation();
  }, [closeWithAnimation, saving]);

  const handleChangeUsername = useCallback((value: string): void => {
    setDraftUsername(sanitizeOffpayUsernameInput(value));
  }, []);

  const handleSave = useCallback((): void => {
    if (formattedUsername == null || saving) return;

    Keyboard.dismiss();
    setSaving(true);
    setUsername(formattedUsername);
    void (async () => {
      let walletNameSyncFailed = false;

      try {
        await setActiveWalletName(formattedUsername);
      } catch (error: unknown) {
        walletNameSyncFailed = true;
        const message =
          error instanceof Error
            ? error.message
            : 'Profile was saved, but wallet name sync failed.';
        showToast({
          title: 'Wallet name sync failed',
          message,
          variant: 'warning',
        });
      } finally {
        setSaving(false);
        if (!walletNameSyncFailed) {
          showToast({
            title: 'Profile updated',
            variant: 'success',
          });
        }
        closeWithAnimation();
      }
    })();
  }, [closeWithAnimation, formattedUsername, saving, setActiveWalletName, setUsername, showToast]);

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim />
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      <View
        style={[
          styles.overlay,
          { paddingBottom: overlayPaddingBottom, paddingHorizontal: horizontalPadding },
        ]}
        accessibilityViewIsModal
        accessibilityLabel="Profile settings"
      >
        <Animated.View
          style={[styles.sheet, { width: '100%', maxWidth: sheetMaxWidth }, sheetStyle]}
        >
          <View
            style={[styles.headerRow, compact ? styles.headerRowCompact : undefined]}
            onLayout={handleHeaderLayout}
          >
            <View style={styles.headerSide}>
              <View style={styles.headerIconPlaceholder} />
            </View>
            <Text
              variant="h2"
              color={colors.text.primary}
              style={[styles.headerTitle, compact && styles.headerTitleCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              maxFontSizeMultiplier={1.05}
            >
              Profile
            </Text>
            <View style={[styles.headerSide, styles.headerRight]}>
              <Pressable
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  pressed && !saving ? styles.headerIconBtnPressed : null,
                ]}
                onPress={handleClose}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={6}
              >
                <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
              </Pressable>
            </View>
          </View>

          {scrollOverflows ? (
            <ScrollView
              style={[styles.bodyScroll, { maxHeight: bodyMaxHeight }]}
              contentContainerStyle={[
                styles.bodyContent,
                compact ? styles.bodyContentCompact : undefined,
              ]}
              contentInsetAdjustmentBehavior="automatic"
              showsVerticalScrollIndicator={false}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={(_width, height) => {
                const nextHeight = Math.ceil(height);
                setFormHeight((current) => (current === nextHeight ? current : nextHeight));
              }}
            >
              <Animated.View style={[styles.form, contentStyle]}>
                <ProfileFormFields
                  avatarSize={avatarSize}
                  dense={dense}
                  pickingProfileImage={pickingProfileImage}
                  saving={saving}
                  profileImageUri={profileImageUri}
                  pickProfileImage={pickProfileImage}
                  clearProfileImage={clearProfileImage}
                  draftUsername={draftUsername}
                  handleChangeUsername={handleChangeUsername}
                  handleSave={handleSave}
                  usernameError={usernameError}
                  normalizedUsername={normalizedUsername}
                />
              </Animated.View>
            </ScrollView>
          ) : (
            <View
              style={[
                styles.bodyStatic,
                styles.bodyContent,
                compact ? styles.bodyContentCompact : undefined,
              ]}
              onLayout={handleFormLayout}
            >
              <Animated.View style={[styles.form, contentStyle]}>
                <ProfileFormFields
                  avatarSize={avatarSize}
                  dense={dense}
                  pickingProfileImage={pickingProfileImage}
                  saving={saving}
                  profileImageUri={profileImageUri}
                  pickProfileImage={pickProfileImage}
                  clearProfileImage={clearProfileImage}
                  draftUsername={draftUsername}
                  handleChangeUsername={handleChangeUsername}
                  handleSave={handleSave}
                  usernameError={usernameError}
                  normalizedUsername={normalizedUsername}
                />
              </Animated.View>
            </View>
          )}

          <View
            style={[styles.footer, compact && styles.footerCompact]}
            onLayout={handleFooterLayout}
          >
            <Pressable
              style={({ pressed }) => [
                styles.dialogButton,
                styles.cancelButton,
                pressed && !saving ? styles.cancelButtonPressed : null,
              ]}
              onPress={handleClose}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel profile changes"
            >
              <Text
                variant="buttonSmall"
                color={colors.text.primary}
                numberOfLines={1}
                style={styles.buttonLabel}
              >
                Cancel
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.dialogButton,
                styles.saveButton,
                pressed && canSave ? styles.saveButtonPressed : null,
                !canSave ? styles.buttonDisabled : null,
              ]}
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Save profile"
              accessibilityState={{ busy: saving, disabled: !canSave }}
            >
              {saving ? (
                <LazyLoadingSpinner size={18} color={colors.text.onAccent} />
              ) : (
                <Text
                  variant="buttonSmall"
                  color={colors.text.onAccent}
                  numberOfLines={1}
                  style={styles.buttonLabel}
                >
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function ProfileFormFields({
  avatarSize,
  dense,
  pickingProfileImage,
  saving,
  profileImageUri,
  pickProfileImage,
  clearProfileImage,
  draftUsername,
  handleChangeUsername,
  handleSave,
  usernameError,
  normalizedUsername,
}: {
  avatarSize: number;
  dense: boolean;
  pickingProfileImage: boolean;
  saving: boolean;
  profileImageUri: string | null;
  pickProfileImage: () => Promise<void>;
  clearProfileImage: () => Promise<void>;
  draftUsername: string;
  handleChangeUsername: (value: string) => void;
  handleSave: () => void;
  usernameError: string | null;
  normalizedUsername: string;
}): React.JSX.Element {
  return (
    <>
      <SettingsSectionCard>
        <View style={[styles.photoRow, dense && styles.photoRowDense]}>
          <Pressable
            style={styles.avatarButton}
            onPress={() => {
              void pickProfileImage();
            }}
            disabled={pickingProfileImage || saving}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <WalletAvatar size={avatarSize} solidFill />
            <View style={styles.avatarBadge}>
              {pickingProfileImage ? (
                <LazyLoadingSpinner size={18} color={colors.text.onAccent} />
              ) : (
                <Ionicons name="camera-outline" size={14} color={colors.text.onAccent} />
              )}
            </View>
          </Pressable>

          <View style={styles.photoCopy}>
            <Text
              variant="body"
              color={colors.text.primary}
              style={[styles.cardTitle, dense && styles.cardTitleDense]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.05}
            >
              Profile photo
            </Text>
            <Text
              variant="small"
              color={colors.text.secondary}
              style={styles.cardSubtitle}
              numberOfLines={2}
              maxFontSizeMultiplier={1}
            >
              Stored locally on this device.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.smallPillButton,
              pressed && !pickingProfileImage && !saving ? styles.smallPillButtonPressed : null,
            ]}
            onPress={() => {
              void pickProfileImage();
            }}
            disabled={pickingProfileImage || saving}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            {pickingProfileImage ? (
              <LazyLoadingSpinner size={18} color={colors.text.primary} />
            ) : (
              <Ionicons
                name="image-outline"
                size={layout.iconSizeInline}
                color={colors.text.primary}
              />
            )}
          </Pressable>
        </View>
      </SettingsSectionCard>

      {profileImageUri != null ? (
        <Pressable
          style={({ pressed }) => [
            styles.removePhotoRow,
            pressed && !saving ? styles.removePhotoRowPressed : null,
          ]}
          onPress={() => {
            void clearProfileImage();
          }}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Remove profile photo"
        >
          <Ionicons
            name="trash-outline"
            size={layout.iconSizeInline}
            color={colors.semantic.error}
          />
          <Text
            variant="buttonSmall"
            color={colors.semantic.error}
            numberOfLines={1}
            maxFontSizeMultiplier={1.05}
            style={styles.removePhotoLabel}
          >
            Remove photo
          </Text>
        </Pressable>
      ) : null}

      <SettingsSectionCard>
        <View style={[styles.usernameSection, dense && styles.usernameSectionDense]}>
          <Text
            variant="body"
            color={colors.text.primary}
            style={[styles.cardTitle, dense && styles.cardTitleDense]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.05}
          >
            Username
          </Text>
          <View style={[styles.inputShell, usernameError != null && styles.inputShellError]}>
            <Text variant="bodyBold" color={colors.text.tertiary} style={styles.atSign}>
              @
            </Text>
            <TextInput
              value={draftUsername}
              onChangeText={handleChangeUsername}
              placeholder="wallet01"
              placeholderTextColor={colors.text.placeholder}
              selectionColor={colors.brand.glossAccent}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              maxLength={OFFPAY_USERNAME_MAX_LENGTH}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>
          <Text
            variant="small"
            color={usernameError != null ? colors.semantic.warning : colors.text.secondary}
            style={styles.helper}
            numberOfLines={2}
            maxFontSizeMultiplier={1.05}
          >
            {usernameError ??
              `${normalizedUsername.length}/${OFFPAY_USERNAME_MAX_LENGTH} letters, numbers, or underscores`}
          </Text>
        </View>
      </SettingsSectionCard>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.surface.cardElevated,
    boxShadow: SHEET_SHADOW,
    paddingBottom: SHEET_CHROME_PADDING,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerRowCompact: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  headerSide: {
    width: layout.minTouchTarget,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerIconPlaceholder: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
  },
  headerIconBtnPressed: {
    backgroundColor: colors.surface.pressed,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  headerTitleCompact: {
    fontSize: 23,
    lineHeight: 30,
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyStatic: {
    flexGrow: 0,
    flexShrink: 0,
  },
  bodyContent: {
    flexGrow: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bodyContentCompact: {
    paddingHorizontal: spacing.md,
  },
  form: {
    gap: spacing.md,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minWidth: 0,
  },
  photoRowDense: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  usernameSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    minWidth: 0,
  },
  usernameSectionDense: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  avatarButton: {
    position: 'relative',
    flexShrink: 0,
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.glossAccent,
    borderWidth: 2,
    borderColor: colors.surface.cardElevated,
  },
  photoCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTitle: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  cardTitleDense: {
    fontSize: 15,
    lineHeight: 19,
  },
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  smallPillButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  smallPillButtonPressed: {
    backgroundColor: colors.surface.pressed,
  },
  removePhotoRow: {
    minHeight: 44,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 77, 90, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 77, 90, 0.28)',
  },
  removePhotoRowPressed: {
    backgroundColor: 'rgba(255, 77, 90, 0.18)',
  },
  removePhotoLabel: {
    flexShrink: 1,
    fontFamily: fontFamily.uiSemiBold,
  },
  inputShell: {
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inputShellError: {
    borderColor: colors.semantic.warning,
    borderWidth: 1,
  },
  atSign: {
    fontSize: 18,
    lineHeight: 22,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 18,
    lineHeight: 22,
    paddingVertical: 0,
  },
  helper: {
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  footerCompact: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  dialogButton: {
    flex: 1,
    minHeight: layout.buttonHeightMd,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  cancelButton: {
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  cancelButtonPressed: {
    backgroundColor: colors.surface.pressed,
  },
  saveButton: {
    backgroundColor: colors.brand.glossAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  saveButtonPressed: {
    backgroundColor: colors.semantic.warning,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
});
