/**
 * Welcome / Onboarding screen — first-launch experience.
 *
 * Layout:
 *   Top    — plain dark glossy breathing space.
 *   Bottom — rounded dark glossy action card that hosts the wallet
 *            setup CTAs, social auth row, and legal footer.
 *
 * The CTA pills mirror the geometry of the Settings → Reset button so
 * the action language stays consistent across the app.
 *
 * App-wide gradient background is provided by the root layout.
 * Spec: Section 3.3 (legal disclosure at first launch)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  OnboardingActionPanel,
  type OnboardingAuthFeedback,
} from '@/components/features/wallet-setup/OnboardingActionPanel';
import { AnimatedOffPayLogo } from '@/components/ui/AnimatedOffPayLogo';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { usePrivyOnboardingActions } from '@/lib/privy';

const TERMS_URL = 'https://offpay.app/terms';
const PRIVACY_URL = 'https://offpay.app/privacy';
const APP_ICON_SOURCE = require('../assets/AppIcons/playstore.png') as number;

const AUTH_RESULT_EXIT_DELAY_MS = 220;
const AUTH_RESULT_FALLBACK_MS = 3200;

/**
 * Density tiers — keep these aligned with the rest of the wallet-setup
 * stack (see `PasscodeSetupScreen`). Heights below match the most
 * common Android devices we have to support today:
 *  - Pixel 9                    → 1080×2424 logical
 *  - Galaxy A14 / A15           → 720×1600 logical (small)
 *  - Galaxy S23                 → 1080×2340 logical
 *  - Older 6" devices           → 720×1480 (very small)
 *
 * On a Pixel 9 the device renders at ~412×915dp. The previous layout
 * was tuned for that and looked oversized on smaller phones because
 * everything below `2xl` spacing is hard-coded.
 */
const DENSITY_VERY_COMPACT_HEIGHT = 700;
const DENSITY_COMPACT_HEIGHT = 820;
const VERY_NARROW_WIDTH = 340;
const NARROW_WIDTH = 390;

type AuthFeedbackState = {
  variant: OnboardingAuthFeedback['variant'];
  title: string;
  message: string;
};

function buildAuthFeedback(params: {
  outcome: 'success' | 'cancelled' | 'failed' | 'unavailable';
}): AuthFeedbackState {
  if (params.outcome === 'success') {
    return {
      variant: 'success',
      title: 'Success',
      message: 'Continue setup',
    };
  }

  return {
    variant: 'error',
    title: 'Failed',
    message: 'Try again from the options below',
  };
}

export default function WelcomeScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ authResult?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const privy = usePrivyOnboardingActions();
  const [authFeedback, setAuthFeedback] = useState<AuthFeedbackState | null>(null);
  const authFeedbackDoneRef = useRef(false);
  const authFeedbackExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedAuthResultRef = useRef<string | null>(null);

  const usableHeight = height - insets.top - insets.bottom;

  // Density tiers. Real APK installs can report a smaller logical
  // viewport than the emulator when Android display size/font size is
  // raised, so the tier uses both safe-area height and width.
  const density = useMemo<'relaxed' | 'compact' | 'veryCompact'>(() => {
    if (
      usableHeight < DENSITY_VERY_COMPACT_HEIGHT ||
      width < VERY_NARROW_WIDTH ||
      fontScale > 1.12
    ) {
      return 'veryCompact';
    }
    if (usableHeight < DENSITY_COMPACT_HEIGHT || width < NARROW_WIDTH || fontScale > 1) {
      return 'compact';
    }
    return 'relaxed';
  }, [fontScale, usableHeight, width]);

  const isCompact = density !== 'relaxed';
  const isVeryCompact = density === 'veryCompact';

  const horizontalPadding =
    width < VERY_NARROW_WIDTH ? spacing.lg : isCompact ? spacing.xl : spacing['2xl'];

  const sheetGap = isVeryCompact ? spacing.sm : isCompact ? spacing.md : spacing.lg;
  const sheetTopPadding = isVeryCompact ? spacing.lg : isCompact ? spacing.xl : spacing['2xl'];
  const logoSize = isVeryCompact ? 116 : isCompact ? 146 : 172;
  const heroBottomPadding = isVeryCompact
    ? spacing['2xl']
    : isCompact
      ? spacing['4xl']
      : spacing['4xl'] + spacing.xl;

  const handleCreateWallet = useCallback((): void => {
    router.push({ pathname: '/security-setup/passcode', params: { intent: 'create-wallet' } });
  }, []);

  const handleImportWallet = useCallback((): void => {
    router.push({ pathname: '/security-setup/passcode', params: { intent: 'restore-wallet' } });
  }, []);

  const handleSocialPress = useCallback(
    async (provider: 'x' | 'google'): Promise<void> => {
      authFeedbackDoneRef.current = false;
      if (!privy.isAvailable) {
        setAuthFeedback(buildAuthFeedback({ outcome: 'unavailable' }));
        return;
      }

      const result =
        provider === 'google' ? await privy.loginWithGoogle() : await privy.loginWithX();

      if (result.outcome === 'success') {
        setAuthFeedback(buildAuthFeedback({ outcome: 'success' }));
        return;
      }

      if (result.outcome === 'cancelled') {
        setAuthFeedback(buildAuthFeedback({ outcome: 'cancelled' }));
        return;
      }

      setAuthFeedback(buildAuthFeedback({ outcome: 'failed' }));
    },
    [privy],
  );

  const handlePasskeyPress = useCallback(async (): Promise<void> => {
    authFeedbackDoneRef.current = false;
    if (!privy.isAvailable) {
      setAuthFeedback(buildAuthFeedback({ outcome: 'unavailable' }));
      return;
    }

    const result = await privy.loginOrSignupWithPasskey();

    if (result.outcome === 'success') {
      setAuthFeedback(buildAuthFeedback({ outcome: 'success' }));
      return;
    }

    if (result.outcome === 'cancelled') {
      setAuthFeedback(buildAuthFeedback({ outcome: 'cancelled' }));
      return;
    }

    setAuthFeedback(buildAuthFeedback({ outcome: 'failed' }));
  }, [privy]);

  const completeAuthFeedback = useCallback((): void => {
    if (authFeedbackDoneRef.current) return;
    authFeedbackDoneRef.current = true;

    const feedback = authFeedback;

    if (feedback?.variant !== 'success') {
      setAuthFeedback(null);
      return;
    }

    authFeedbackExitTimerRef.current = setTimeout(() => {
      router.replace({
        pathname: '/security-setup/passcode',
        params: { intent: 'privy-wallet' },
      });
    }, AUTH_RESULT_EXIT_DELAY_MS);
  }, [authFeedback]);

  useEffect(() => {
    const authResult = Array.isArray(params.authResult) ? params.authResult[0] : params.authResult;

    if (authResult !== 'success' && authResult !== 'failed') return;
    if (consumedAuthResultRef.current === authResult) return;

    consumedAuthResultRef.current = authResult;
    authFeedbackDoneRef.current = false;
    setAuthFeedback(
      buildAuthFeedback({ outcome: authResult === 'success' ? 'success' : 'failed' }),
    );
  }, [params.authResult]);

  useEffect(() => {
    if (authFeedback == null) return;

    authFeedbackDoneRef.current = false;
    const timeout = setTimeout(completeAuthFeedback, AUTH_RESULT_FALLBACK_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [authFeedback, completeAuthFeedback]);

  useEffect(() => {
    return () => {
      if (authFeedbackExitTimerRef.current != null) {
        clearTimeout(authFeedbackExitTimerRef.current);
      }
    };
  }, []);

  const openExternal = useCallback((url: string) => {
    void Linking.openURL(url);
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          minHeight: height,
          paddingTop: insets.top + (isCompact ? spacing.xs : spacing.sm),
        },
      ]}
      contentInsetAdjustmentBehavior="never"
      bounces={false}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View style={[styles.heroSection, { paddingBottom: heroBottomPadding }]}>
        <LinearGradient
          pointerEvents="none"
          colors={[
            'rgba(247, 247, 242, 0.3)',
            'rgba(247, 247, 242, 0.2)',
            'rgba(247, 247, 242, 0.05)',
            'rgba(247, 247, 242, 0.04)',
            'rgba(247, 247, 242, 0.02)',
          ]}
          locations={[0, 0.4, 0.68, 0.86, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.heroGradient}
        />
        <View style={styles.heroContent}>
          <View style={[styles.heroIconCluster, { width: logoSize, height: logoSize }]}>
            <AnimatedOffPayLogo
              size={logoSize}
              bodyColor={colors.brand.whiteStream}
              eyeColor={colors.brand.deepShadow}
            />
          </View>
          <View
            style={[styles.heroCopy, { maxWidth: Math.min(width - horizontalPadding * 2, 360) }]}
          >
            <Text
              variant="h2"
              color={colors.brand.whiteStream}
              align="center"
              style={styles.heroTitle}
            >
              Pay your way.{'\n'}Private. Offline-ready.
            </Text>
          </View>
        </View>
      </Animated.View>

      <View pointerEvents="none" style={styles.heroDividerStrip}>
        <View style={styles.heroBrandLockup}>
          <Image
            source={APP_ICON_SOURCE}
            style={styles.heroBrandIcon}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            tintColor={colors.brand.whiteStream}
            accessible={false}
          />
          <Text variant="captionBold" color={colors.brand.whiteStream} style={styles.heroBrandText}>
            OffPay
          </Text>
        </View>
      </View>

      <Animated.View
        entering={FadeInDown.duration(500).delay(220)}
        style={[
          styles.sheet,
          {
            paddingHorizontal: horizontalPadding,
            paddingTop: sheetTopPadding,
            paddingBottom: Math.max(
              insets.bottom + (isCompact ? spacing.md : spacing.lg),
              isCompact ? spacing.xl : spacing['2xl'],
            ),
            gap: sheetGap,
          },
        ]}
      >
        <OnboardingActionPanel
          onCreateWallet={handleCreateWallet}
          onImportWallet={handleImportWallet}
          onPasskeyPress={handlePasskeyPress}
          onSocialPress={handleSocialPress}
          onTermsPress={() => openExternal(TERMS_URL)}
          onPrivacyPress={() => openExternal(PRIVACY_URL)}
          authBusyProvider={privy.busyProvider}
          authFeedback={authFeedback}
          onAuthFeedbackAnimationFinish={completeAuthFeedback}
          density={density}
        />
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  heroSection: {
    flex: 1,
    minHeight: 220,
    backgroundColor: colors.brand.deepShadow,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    borderCurve: 'continuous',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 1,
    borderColor: colors.glass.rim,
    overflow: 'hidden',
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.95,
  },
  heroBrandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  heroBrandIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  heroBrandText: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: 0,
  },
  heroContent: {
    zIndex: 2,
    alignItems: 'center',
    gap: spacing.lg,
  },
  heroIconCluster: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  heroCopy: {
    alignItems: 'center',
  },
  heroTitle: {
    lineHeight: 34,
  },
  heroDividerStrip: {
    height: 64,
    backgroundColor: colors.brand.deepShadow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: colors.brand.graphiteDepth,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.glass.rim,
    overflow: 'hidden',
    boxShadow: [
      '0 -24px 54px rgba(0, 0, 0, 0.48)',
      'inset 0 1px 2px rgba(255, 255, 255, 0.16)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.42)',
    ].join(', '),
  },
});
