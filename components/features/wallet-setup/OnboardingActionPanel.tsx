/**
 * OnboardingActionPanel — bottom action sheet for the onboarding screen.
 *
 * Visual recipe:
 *   - Filled glossy controls on a dark graphite sheet.
 *   - Primary CTA uses the app's light gloss fill.
 *   - Secondary and auth actions use solid dark fills with subtle rims.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import LottieView from 'lottie-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PuffyTwitterXIcon } from '@/components/ui/icons/PuffyTwitterXIcon';
import { whiteSuccessLottie } from '@/components/ui/success-lottie';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export interface OnboardingAuthFeedback {
  variant: 'success' | 'error';
  title: string;
  message?: string;
}

interface OnboardingActionPanelProps {
  onCreateWallet: () => void;
  onImportWallet: () => void;
  onPasskeyPress: () => void;
  onSocialPress: (provider: 'x' | 'google') => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
  busy?: boolean;
  /** Which auxiliary auth flow is currently running, if any. */
  authBusyProvider?: 'google' | 'x' | 'passkey' | null;
  authFeedback?: OnboardingAuthFeedback | null;
  onAuthFeedbackAnimationFinish?: () => void;
  /**
   * Vertical density tier driven by the parent screen. Drives button
   * heights, gap between rows, and divider/footer breathing room so
   * the panel collapses cleanly on shorter phones without changing
   * the visual recipe.
   */
  density?: 'relaxed' | 'compact' | 'veryCompact';
}

export function OnboardingActionPanel({
  onCreateWallet,
  onImportWallet,
  onPasskeyPress,
  onSocialPress,
  onTermsPress,
  onPrivacyPress,
  busy = false,
  authBusyProvider = null,
  authFeedback = null,
  onAuthFeedbackAnimationFinish,
  density = 'relaxed',
}: OnboardingActionPanelProps): React.JSX.Element {
  // Disable every auxiliary auth button while one of them is in
  // flight. The wallet flow is left independent because it doesn't
  // hit the network and never blocks on Privy.
  const anyAuthBusy = authBusyProvider != null;
  const passkeyBusy = authBusyProvider === 'passkey';
  const xBusy = authBusyProvider === 'x';
  const googleBusy = authBusyProvider === 'google';

  const isCompact = density !== 'relaxed';
  const isVeryCompact = density === 'veryCompact';

  const containerGap = isVeryCompact ? spacing.xs : isCompact ? spacing.sm : spacing.md;
  const primaryHeight = isVeryCompact ? 46 : isCompact ? 48 : 52;
  const secondaryHeight = primaryHeight;
  const passkeyHeight = isVeryCompact ? 44 : isCompact ? 46 : 48;
  const socialHeight = isVeryCompact ? layout.minTouchTarget : isCompact ? 44 : 46;
  const verticalPaddingY = isVeryCompact ? 2 : spacing.xs;
  const ctaPaddingX = isVeryCompact ? spacing.xl : isCompact ? spacing['2xl'] : spacing['3xl'];
  const passkeyPaddingX = isVeryCompact ? spacing.lg : spacing.xl;
  const dividerMarginTop = isVeryCompact ? 0 : spacing.xs;
  const footerMarginTop = isVeryCompact ? 0 : spacing.xs;
  const feedbackVisible = authFeedback != null;
  const feedbackSuccess = authFeedback?.variant === 'success';
  const feedbackMarkSize = isVeryCompact ? 76 : isCompact ? 90 : 104;
  const feedbackErrorSize = isVeryCompact ? 58 : isCompact ? 68 : 78;
  const feedbackGap = isVeryCompact ? spacing.xs : isCompact ? spacing.sm : spacing.md;
  const feedbackPaddingY = isVeryCompact ? spacing.sm : isCompact ? spacing.md : spacing.lg;

  return (
    <View style={styles.stableFrame}>
      <View
        pointerEvents={feedbackVisible ? 'none' : 'auto'}
        accessibilityElementsHidden={feedbackVisible}
        importantForAccessibility={feedbackVisible ? 'no-hide-descendants' : 'auto'}
        style={[
          styles.container,
          { gap: containerGap },
          feedbackVisible ? styles.hiddenContent : null,
        ]}
      >
        <Pressable
          accessibilityLabel="Create a new wallet"
          accessibilityState={{ busy }}
          onPress={onCreateWallet}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionButton,
            styles.primaryButton,
            {
              minHeight: primaryHeight,
              paddingHorizontal: ctaPaddingX,
              paddingVertical: verticalPaddingY,
            },
            pressed && !busy ? styles.buttonPressed : null,
            busy ? styles.buttonDisabled : null,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.text.onAccent} />
          ) : (
            <Text
              variant="button"
              color={colors.text.onAccent}
              align="center"
              numberOfLines={1}
              maxFontSizeMultiplier={1.05}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={[
                styles.primaryLabel,
                isVeryCompact
                  ? styles.buttonLabelVeryCompact
                  : isCompact
                    ? styles.buttonLabelCompact
                    : null,
              ]}
            >
              Create a new wallet
            </Text>
          )}
        </Pressable>

        <Pressable
          accessibilityLabel="I already have a wallet"
          onPress={onImportWallet}
          style={({ pressed }) => [
            styles.actionButton,
            styles.secondaryButton,
            {
              minHeight: secondaryHeight,
              paddingHorizontal: ctaPaddingX,
              paddingVertical: verticalPaddingY,
            },
            pressed ? styles.buttonPressed : null,
          ]}
        >
          <Text
            variant="button"
            color={colors.text.primary}
            align="center"
            numberOfLines={1}
            maxFontSizeMultiplier={1.05}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            style={[
              styles.secondaryLabel,
              isVeryCompact
                ? styles.buttonLabelVeryCompact
                : isCompact
                  ? styles.buttonLabelCompact
                  : null,
            ]}
          >
            I already have a wallet
          </Text>
        </Pressable>

        {/* Divider — soft hairline with caption. */}
        <View style={[styles.dividerRow, { marginTop: dividerMarginTop }]} accessible={false}>
          <View style={styles.dividerLine} />
          <Text variant="small" color={colors.text.secondary} style={styles.dividerLabel}>
            or continue with
          </Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Passkey — full-width pill so it reads as a peer to the wallet
          actions, not a tertiary social option. */}
        <Pressable
          accessibilityLabel="Continue with passkey"
          accessibilityState={{ busy: passkeyBusy }}
          onPress={onPasskeyPress}
          disabled={anyAuthBusy}
          style={({ pressed }) => [
            styles.actionButton,
            styles.authButton,
            {
              minHeight: passkeyHeight,
              paddingHorizontal: passkeyPaddingX,
              paddingVertical: verticalPaddingY,
            },
            pressed && !anyAuthBusy ? styles.buttonPressed : null,
            anyAuthBusy ? styles.buttonDisabled : null,
          ]}
        >
          <View style={styles.passkeyContent}>
            {passkeyBusy ? (
              <ActivityIndicator size="small" color={colors.text.primary} />
            ) : (
              <Ionicons
                name="finger-print"
                size={layout.iconSizeInline}
                color={colors.text.primary}
              />
            )}
            <Text
              variant="button"
              color={colors.text.primary}
              align="center"
              numberOfLines={1}
              maxFontSizeMultiplier={1.05}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={[
                styles.passkeyLabel,
                isVeryCompact
                  ? styles.buttonLabelVeryCompact
                  : isCompact
                    ? styles.buttonLabelCompact
                    : null,
              ]}
            >
              {passkeyBusy ? 'Creating passkey...' : 'Continue with passkey'}
            </Text>
          </View>
        </Pressable>

        {/* Social row — X (Twitter) + Google sign-in. Each button shows
          a spinner while the OAuth flow is in progress and is
          disabled while any auth provider is running. */}
        <View style={styles.socialRow}>
          <Pressable
            accessibilityLabel="Continue with X"
            accessibilityState={{ busy: xBusy }}
            onPress={() => onSocialPress('x')}
            disabled={anyAuthBusy}
            style={({ pressed }) => [
              styles.socialFrame,
              styles.socialButton,
              { minHeight: socialHeight },
              pressed && !anyAuthBusy ? styles.buttonPressed : null,
              anyAuthBusy ? styles.buttonDisabled : null,
            ]}
          >
            {xBusy ? (
              <ActivityIndicator size="small" color={colors.text.primary} />
            ) : (
              <PuffyTwitterXIcon size={20} color={colors.text.primary} focused />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Continue with Google"
            accessibilityState={{ busy: googleBusy }}
            onPress={() => onSocialPress('google')}
            disabled={anyAuthBusy}
            style={({ pressed }) => [
              styles.socialFrame,
              styles.socialButton,
              { minHeight: socialHeight },
              pressed && !anyAuthBusy ? styles.buttonPressed : null,
              anyAuthBusy ? styles.buttonDisabled : null,
            ]}
          >
            {googleBusy ? (
              <ActivityIndicator size="small" color={colors.text.primary} />
            ) : (
              <Ionicons name="logo-google" size={22} color={colors.text.primary} />
            )}
          </Pressable>
        </View>

        <Text
          variant="small"
          color={colors.text.secondary}
          align="center"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1}
          ellipsizeMode="clip"
          style={[
            styles.footer,
            isVeryCompact ? styles.footerVeryCompact : isCompact ? styles.footerCompact : null,
            { marginTop: footerMarginTop },
          ]}
        >
          By continuing you accept our{' '}
          <Text
            variant="small"
            color={colors.text.primary}
            maxFontSizeMultiplier={1}
            style={[
              styles.footerLink,
              isVeryCompact ? styles.footerVeryCompact : isCompact ? styles.footerCompact : null,
            ]}
            onPress={onTermsPress}
            accessibilityRole="link"
            accessibilityLabel="Terms of Use"
          >
            Terms of Use
          </Text>
          {' & '}
          <Text
            variant="small"
            color={colors.text.primary}
            maxFontSizeMultiplier={1}
            style={[
              styles.footerLink,
              isVeryCompact ? styles.footerVeryCompact : isCompact ? styles.footerCompact : null,
            ]}
            onPress={onPrivacyPress}
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
          >
            Privacy Policy
          </Text>
        </Text>
      </View>

      {authFeedback != null ? (
        <Animated.View
          entering={FadeIn.duration(260)}
          exiting={FadeOut.duration(180)}
          accessibilityRole="alert"
          style={[
            styles.feedbackCard,
            {
              gap: feedbackGap,
              paddingVertical: feedbackPaddingY,
            },
          ]}
        >
          <View pointerEvents="none" style={styles.feedbackGloss} />
          <View
            style={[
              styles.feedbackMark,
              {
                width: feedbackMarkSize,
                height: feedbackMarkSize,
              },
            ]}
          >
            {feedbackSuccess ? (
              <>
                <LottieView
                  source={whiteSuccessLottie}
                  autoPlay
                  loop={false}
                  resizeMode="contain"
                  onAnimationFinish={onAuthFeedbackAnimationFinish}
                  style={{
                    width: feedbackMarkSize,
                    height: feedbackMarkSize,
                  }}
                />
                <Ionicons
                  name="checkmark"
                  size={Math.round(feedbackMarkSize * 0.35)}
                  color={colors.brand.deepShadow}
                  style={styles.feedbackCheckOverlay}
                />
              </>
            ) : (
              <View
                style={[
                  styles.feedbackErrorBadge,
                  {
                    width: feedbackErrorSize,
                    height: feedbackErrorSize,
                    borderRadius: feedbackErrorSize / 2,
                  },
                ]}
              >
                <Ionicons
                  name="close"
                  size={Math.round(feedbackErrorSize * 0.4)}
                  color={colors.semantic.error}
                />
              </View>
            )}
          </View>
          <View style={styles.feedbackCopy}>
            <Text
              variant="h2"
              color={colors.text.primary}
              align="center"
              maxFontSizeMultiplier={1.08}
              style={styles.feedbackTitle}
            >
              {authFeedback.title}
            </Text>
            {authFeedback.message != null ? (
              <Text
                variant="body"
                color={colors.text.secondary}
                align="center"
                maxFontSizeMultiplier={1.08}
                style={styles.feedbackMessage}
              >
                {authFeedback.message}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stableFrame: {
    alignSelf: 'stretch',
    position: 'relative',
  },
  container: {
    alignSelf: 'stretch',
  },
  hiddenContent: {
    opacity: 0,
  },
  feedbackCard: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.brand.glassTint,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    overflow: 'hidden',
    boxShadow: [
      '0 18px 40px rgba(0, 0, 0, 0.38)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.42)',
    ].join(', '),
  },
  feedbackGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    backgroundColor: colors.glass.smokeWash,
  },
  feedbackMark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackCheckOverlay: {
    position: 'absolute',
  },
  feedbackErrorBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.notificationIcon.errorFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.semantic.error,
  },
  feedbackCopy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  feedbackTitle: {
    fontFamily: fontFamily.displaySemiBold,
  },
  feedbackMessage: {
    fontFamily: fontFamily.uiMedium,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  primaryButton: {
    backgroundColor: colors.brand.whiteStream,
    boxShadow: [
      '0 18px 34px rgba(0, 0, 0, 0.42)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.72)',
      'inset 0 -2px 6px rgba(0, 0, 0, 0.2)',
    ].join(', '),
  },
  secondaryButton: {
    backgroundColor: colors.brand.glassTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: [
      '0 12px 26px rgba(0, 0, 0, 0.34)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.14)',
    ].join(', '),
  },
  authButton: {
    backgroundColor: colors.brand.glassTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: ['0 10px 22px rgba(0, 0, 0, 0.3)', 'inset 0 1px 1px rgba(255, 255, 255, 0.13)'].join(
      ', ',
    ),
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.988 }],
  },
  buttonDisabled: {
    opacity: 0.62,
  },
  primaryLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  secondaryLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  buttonLabelCompact: {
    fontSize: 15,
    lineHeight: 19,
  },
  buttonLabelVeryCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
  // Divider with caption.
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glass.rim,
  },
  dividerLabel: {
    fontFamily: fontFamily.uiMedium,
  },
  // Passkey pill content.
  passkeyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  passkeyLabel: {
    fontFamily: fontFamily.uiSemiBold,
  },
  // Social pill row.
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  socialFrame: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  socialButton: {
    backgroundColor: colors.brand.glassTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: ['0 10px 22px rgba(0, 0, 0, 0.3)', 'inset 0 1px 1px rgba(255, 255, 255, 0.13)'].join(
      ', ',
    ),
  },
  // Footer.
  footer: {
    width: '100%',
    flexShrink: 1,
    lineHeight: 18,
    includeFontPadding: false,
  },
  footerCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  footerVeryCompact: {
    fontSize: 10.4,
    lineHeight: 14,
  },
  footerLink: {
    fontFamily: fontFamily.uiSemiBold,
    textDecorationLine: 'underline',
  },
});
