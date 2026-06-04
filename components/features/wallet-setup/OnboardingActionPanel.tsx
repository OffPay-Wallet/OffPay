/**
 * OnboardingActionPanel — bottom action sheet for the onboarding screen.
 *
 * Visual recipe:
 *   - Primary CTA -> gloss cap on a graphite shelf. The shelf gives
 *     the button physical depth without resorting to gradients or
 *     drop shadows.
 *   - Every other action (secondary, passkey, X, Google) → white
 *     cap on a neutral shelf so the buttons stay readable on the
 *     white onboarding sheet without disappearing.
 *   - Press feedback is a Reanimated spring that drops the cap onto
 *     the shelf, then springs it back on release. ~120ms total.
 *
 * No gradients, no `boxShadow`, no rim glows. The shelf alone gives
 * the shape, and the spring gives the feel.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThreeDPressable } from '@/components/ui/ThreeDPressable';
import { PuffyTwitterXIcon } from '@/components/ui/icons/PuffyTwitterXIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

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

  // Density-driven token map. Heights stay above the 44pt minimum
  // touch target on every tier; only padding and inter-row gaps
  // collapse so the visual recipe is preserved.
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
  const shelfDepth = isVeryCompact ? 3 : 4;

  return (
    <View style={[styles.container, { gap: containerGap }]}>
      {/* Primary CTA - gloss cap on graphite shelf. */}
      <ThreeDPressable
        accessibilityLabel="Create a new wallet"
        accessibilityState={{ busy }}
        onPress={onCreateWallet}
        disabled={busy}
        depth={shelfDepth}
        surfaceColor={colors.brand.glossAccent}
        pressedSurfaceColor={colors.brand.whiteStream}
        shelfColor={colors.brand.graphiteDepth}
        capStyle={{
          minHeight: primaryHeight,
          paddingHorizontal: ctaPaddingX,
          paddingVertical: verticalPaddingY,
        }}
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
      </ThreeDPressable>

      {/* Secondary action - white cap on a neutral shelf. The shelf is
          what makes the button visible on the white sheet. */}
      <ThreeDPressable
        accessibilityLabel="I already have a wallet"
        onPress={onImportWallet}
        depth={shelfDepth}
        surfaceColor={colors.brand.whiteStream}
        pressedSurfaceColor={colors.brand.glassTint}
        shelfColor={colors.brand.glossAccent}
        borderColor={colors.glass.rim}
        borderWidth={StyleSheet.hairlineWidth}
        capStyle={{
          minHeight: secondaryHeight,
          paddingHorizontal: ctaPaddingX,
          paddingVertical: verticalPaddingY,
        }}
      >
        <Text
          variant="button"
          color={colors.brand.deepShadow}
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
      </ThreeDPressable>

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
      <ThreeDPressable
        accessibilityLabel="Continue with passkey"
        accessibilityState={{ busy: passkeyBusy }}
        onPress={onPasskeyPress}
        disabled={anyAuthBusy}
        depth={shelfDepth}
        surfaceColor={colors.brand.whiteStream}
        pressedSurfaceColor={colors.brand.glassTint}
        shelfColor={colors.brand.glossAccent}
        borderColor={colors.glass.rim}
        borderWidth={StyleSheet.hairlineWidth}
        capStyle={{
          minHeight: passkeyHeight,
          paddingHorizontal: passkeyPaddingX,
          paddingVertical: verticalPaddingY,
        }}
      >
        <View style={styles.passkeyContent}>
          {passkeyBusy ? (
            <ActivityIndicator size="small" color={colors.brand.deepShadow} />
          ) : (
            <Ionicons
              name="finger-print"
              size={layout.iconSizeInline}
              color={colors.brand.deepShadow}
            />
          )}
          <Text
            variant="button"
            color={colors.brand.deepShadow}
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
            {passkeyBusy ? 'Creating passkey…' : 'Continue with passkey'}
          </Text>
        </View>
      </ThreeDPressable>

      {/* Social row — X (Twitter) + Google sign-in. Each button shows
          a spinner while the OAuth flow is in progress and is
          disabled while any auth provider is running. */}
      <View style={styles.socialRow}>
        <ThreeDPressable
          accessibilityLabel="Continue with X"
          accessibilityState={{ busy: xBusy }}
          onPress={() => onSocialPress('x')}
          disabled={anyAuthBusy}
          depth={shelfDepth}
          surfaceColor={colors.brand.whiteStream}
          pressedSurfaceColor={colors.brand.glassTint}
          shelfColor={colors.brand.glossAccent}
          borderColor={colors.glass.rim}
          borderWidth={StyleSheet.hairlineWidth}
          capStyle={{ minHeight: socialHeight }}
          style={styles.socialFrame}
        >
          {xBusy ? (
            <ActivityIndicator size="small" color={colors.brand.deepShadow} />
          ) : (
            <PuffyTwitterXIcon size={20} color={colors.brand.deepShadow} focused />
          )}
        </ThreeDPressable>
        <ThreeDPressable
          accessibilityLabel="Continue with Google"
          accessibilityState={{ busy: googleBusy }}
          onPress={() => onSocialPress('google')}
          disabled={anyAuthBusy}
          depth={shelfDepth}
          surfaceColor={colors.brand.whiteStream}
          pressedSurfaceColor={colors.brand.glassTint}
          shelfColor={colors.brand.glossAccent}
          borderColor={colors.glass.rim}
          borderWidth={StyleSheet.hairlineWidth}
          capStyle={{ minHeight: socialHeight }}
          style={styles.socialFrame}
        >
          {googleBusy ? (
            <ActivityIndicator size="small" color={colors.brand.deepShadow} />
          ) : (
            <Ionicons name="logo-google" size={22} color={colors.brand.deepShadow} />
          )}
        </ThreeDPressable>
      </View>

      {/* Terms footer */}
      <Text
        variant="small"
        color={colors.text.secondary}
        align="center"
        style={[styles.footer, { marginTop: footerMarginTop }]}
      >
        By continuing you accept our{' '}
        <Text
          variant="small"
          color={colors.brand.actionFill}
          style={styles.footerLink}
          onPress={onTermsPress}
          accessibilityRole="link"
          accessibilityLabel="Terms of Use"
        >
          Terms of Use
        </Text>
        {' & '}
        <Text
          variant="small"
          color={colors.brand.actionFill}
          style={styles.footerLink}
          onPress={onPrivacyPress}
          accessibilityRole="link"
          accessibilityLabel="Privacy Policy"
        >
          Privacy Policy
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
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
    backgroundColor: colors.border.subtle,
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
  },
  // Footer.
  footer: {
    lineHeight: 18,
  },
  footerLink: {
    fontFamily: fontFamily.uiSemiBold,
    textDecorationLine: 'underline',
  },
});
