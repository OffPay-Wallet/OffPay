/**
 * Welcome / Onboarding screen — first-launch experience.
 *
 * Layout:
 *   Top    — paged feature carousel highlighting OffPay's utility
 *            (privacy, offline payments, self-custody, swap) using
 *            the puffy icons in `assets/onboarding_icons/`. Sits
 *            directly on the gradient background.
 *   Bottom — a distinct rounded "sheet" card that hosts the wallet
 *            setup CTAs, the preview social auth row, and the legal
 *            footer. The card has rounded top corners and rests
 *            flush against the bottom edge so it visually separates
 *            action from content.
 *
 * The CTA pills mirror the geometry of the Settings → Reset button so
 * the action language stays consistent across the app.
 *
 * App-wide gradient background is provided by the root layout.
 * Spec: Section 3.3 (legal disclosure at first launch)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingActionPanel } from '@/components/features/wallet-setup/OnboardingActionPanel';
import { OnboardingFeatureCarousel } from '@/components/features/wallet-setup/OnboardingFeatureCarousel';
import {
  ProcessResultScreen,
  type ProcessResultVariant,
} from '@/components/ui/ProcessResultScreen';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { usePrivyOnboardingActions } from '@/lib/privy';

const TERMS_URL = 'https://offpay.app/terms';
const PRIVACY_URL = 'https://offpay.app/privacy';

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
  variant: ProcessResultVariant;
  title: string;
};

function buildAuthFeedback(params: {
  outcome: 'success' | 'cancelled' | 'failed' | 'unavailable';
}): AuthFeedbackState {
  if (params.outcome === 'success') {
    return {
      variant: 'success',
      title: 'Success',
    };
  }

  return {
    variant: 'error',
    title: 'Failed',
  };
}

export default function WelcomeScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const privy = usePrivyOnboardingActions();
  const [authFeedback, setAuthFeedback] = useState<AuthFeedbackState | null>(null);
  const authFeedbackDoneRef = useRef(false);
  const authFeedbackExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Carousel hosts a paging FlatList — it must always span the full
  // viewport width so each slide snaps cleanly. Internal padding keeps
  // the content centered inside that frame.
  const carouselWidth = width;
  // Keep hero art below the old Pixel-tuned size. A bundled APK can
  // land on narrower logical widths than the emulator, and oversize
  // art is the first thing that makes the whole screen feel scaled up.
  const iconFloor = isVeryCompact ? 112 : isCompact ? 128 : 148;
  const iconCeiling = isVeryCompact ? 160 : isCompact ? 184 : 208;
  const iconBudget = Math.min(
    Math.max(width * (isVeryCompact ? 0.34 : isCompact ? 0.38 : 0.42), iconFloor),
    usableHeight * (isVeryCompact ? 0.17 : isCompact ? 0.19 : 0.22),
    iconCeiling,
  );
  const iconSize = Math.round(iconBudget);
  const authFeedbackLottieSize = Math.round(Math.min(Math.max(width * 0.54, 210), 280));

  const sheetGap = isVeryCompact ? spacing.sm : isCompact ? spacing.md : spacing.lg;
  const sheetTopPadding = isVeryCompact ? spacing.lg : isCompact ? spacing.xl : spacing['2xl'];
  const heroBottomPadding = isVeryCompact ? spacing.sm : isCompact ? spacing.md : spacing.lg;

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
      <Animated.View
        entering={FadeInUp.duration(500).delay(120)}
        style={[styles.heroSection, { paddingBottom: heroBottomPadding }]}
      >
        <OnboardingFeatureCarousel width={carouselWidth} iconSize={iconSize} density={density} />
      </Animated.View>

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
          density={density}
        />
      </Animated.View>

      <ProcessResultScreen
        visible={authFeedback != null}
        variant={authFeedback?.variant ?? 'success'}
        title={authFeedback?.title ?? ''}
        animationSize={authFeedbackLottieSize}
        onAnimationFinish={completeAuthFeedback}
        minimal
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.brand.glassTint,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 0,
  },
  sheet: {
    backgroundColor: colors.brand.whiteStream,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    borderCurve: 'continuous',
  },
});
