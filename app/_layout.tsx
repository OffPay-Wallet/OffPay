// Crypto polyfills — MUST be the very first import in the app
import '@/lib/crypto/polyfills';
import { installNetworkAccessPolicy } from '@/lib/api/network-access-policy';
import { installQueryCachePersistence } from '@/lib/cache/query-persistence';

/**
 * Root layout - handles font loading, theme, and onboarding routing.
 * Shows onboarding screen on first launch, then main wallet tabs.
 * Persists onboarding completion state via app store (MMKV).
 *
 * Uses Expo Router's native stack so app-wide push/pop transitions
 * run on the platform navigation layer instead of the JS thread.
 *
 * Spec: Section 3.3 (legal disclosure at first launch)
 */
import { DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { isRunningInExpoGo } from 'expo';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppLockState } from '@/hooks/useAppLockState';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { colors } from '@/constants/colors';
import {
  advancedSwapScreenOptions,
  createWalletScreenOptions,
  globalScreenOptions,
  holdingsScreenOptions,
  privatePaymentScreenOptions,
} from '@/constants/navigation';
import { formatOffpayUsername } from '@/lib/api/offpay-username';
import {
  pruneManagedProfileImages,
  resolveStoredProfileImageUri,
} from '@/lib/profile/profile-image';
import { AppProviders } from '@/providers';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { waitForMmkvEncryption } from '@/lib/cache/mmkv-storage';

import type { Theme } from 'expo-router/react-navigation';

installNetworkAccessPolicy();

// Restore the persisted React Query cache as early as possible. The
// hydration is async; the in-memory cache stays valid while the file
// read settles, so the splash hide is never gated on disk IO.
void installQueryCachePersistence();

// Kick wallet hydration as soon as the module evaluates so the
// SecureStore round-trip overlaps with React Native's first render
// pass. The wallet store guards against repeat calls — calling
// `hydrate` again from the root effect below is a no-op once the
// promise has resolved.
void useWalletStore.getState().hydrate();

// Prime the biometric hardware probe in the background. The result is
// cached for the session; by the time the lock gate prompts, the
// availability flag is ready and the system prompt opens instantly on
// Android.
void import('@/lib/wallet/biometric-auth').then((module) => {
  void module.getBiometricAvailability();
});

// Prevent splash screen from auto-hiding
void SplashScreen.preventAutoHideAsync();
if (!isRunningInExpoGo()) {
  SplashScreen.setOptions({
    duration: 0,
    fade: false,
  });
}

const ROOT_REVEAL_TIMING = {
  duration: 240,
  easing: Easing.out(Easing.cubic),
} as const;

/** OffPay glossy dark theme - neutral glass surfaces with high-contrast ink. */
const OffPayTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.brand.glossAccent,
    background: colors.backgroundGradient.base,
    card: colors.surface.card,
    text: colors.text.primary,
    border: colors.border.default,
    notification: colors.semantic.error,
  },
  fonts: DefaultTheme.fonts,
};

const BOOT_TIMER_LABEL = 'boot';
let bootTimerEnded = false;

function isGeneratedAccountName(name: string): boolean {
  return /^Account \d+$/.test(name);
}

if (__DEV__) {
  console.time(BOOT_TIMER_LABEL);
}

function endBootTimer(): void {
  if (!__DEV__ || bootTimerEnded) return;
  bootTimerEnded = true;
  console.timeEnd(BOOT_TIMER_LABEL);
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout(): React.JSX.Element | null {
  const hasOnboarded = useAppStore((s) => s.hasOnboarded);
  const inviteAccessVerified = useAppStore((s) => s.inviteAccessVerified);
  const username = useAppStore((s) => s.username);
  const profileImageUri = useAppStore((s) => s.profileImageUri);
  const setHasOnboarded = useAppStore((s) => s.setHasOnboarded);
  const setUsername = useAppStore((s) => s.setUsername);
  const setProfileImageUri = useAppStore((s) => s.setProfileImageUri);
  const hydrateWallet = useWalletStore((s) => s.hydrate);
  const walletHydrated = useWalletStore((s) => s.isHydrated);
  const walletCount = useWalletStore((s) => s.wallets.length);
  const walletPublicKey = useWalletStore((s) => s.publicKey);
  const accountName = useWalletStore((s) => s.accountName);
  const setActiveWalletName = useWalletStore((s) => s.setActiveWalletName);
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const [hasHiddenSplash, setHasHiddenSplash] = useState(false);
  const [rootLayoutReady, setRootLayoutReady] = useState(false);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [mmkvReady, setMmkvReady] = useState(false);
  const rootReveal = useDerivedValue(
    () => withTiming(hasHiddenSplash ? 1 : 0, ROOT_REVEAL_TIMING),
    [hasHiddenSplash],
  );
  const rootRevealStyle = useAnimatedStyle(() => ({
    opacity: rootReveal.value,
  }));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRootLayoutReady(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  // Wait for MMKV encryption to be applied before reading persisted
  // preferences. `preferencesStore` uses manual hydration so the
  // default mainnet value never leaks into network hooks before the
  // previous session's persisted network is readable.
  // On physical devices, SecureStore → MMKV encryption key resolution
  // can take longer than on emulators. Without this gate, hasOnboarded
  // can read stale/unencrypted data and route the user incorrectly.
  useEffect(() => {
    let cancelled = false;
    const markPreferencesHydrated = () => {
      if (!cancelled) setPreferencesHydrated(true);
    };
    const unsubscribePreferencesHydration =
      usePreferencesStore.persist.onFinishHydration(markPreferencesHydrated);

    void waitForMmkvEncryption().then(async () => {
      if (cancelled) return;
      setMmkvReady(true);

      if (usePreferencesStore.persist.hasHydrated()) {
        markPreferencesHydrated();
        return;
      }

      try {
        await usePreferencesStore.persist.rehydrate();
      } finally {
        markPreferencesHydrated();
      }
    });

    return () => {
      cancelled = true;
      unsubscribePreferencesHydration();
    };
  }, []);

  // Hydrate wallet from SecureStore on app launch
  useEffect(() => {
    void hydrateWallet();
  }, [hydrateWallet]);

  const firstSegment = segments[0];
  const inInviteCode = firstSegment === 'invite-code';
  const inOnboarding = firstSegment === 'onboarding';
  const inUsernameSetup = firstSegment === 'username-setup';
  const inCreateWallet = firstSegment === 'create-wallet';
  const inRestoreWallet = firstSegment === 'restore-wallet';
  const inPrivyWallet = firstSegment === 'privy-wallet';
  const inOAuthCallback = firstSegment === 'oauth';
  const inSecuritySetup = firstSegment === 'security-setup';
  const inAppLock = firstSegment === 'app-lock';
  const inWalletFlow = inCreateWallet || inRestoreWallet || inPrivyWallet;
  const inAuthFlow = inInviteCode || inOnboarding || inOAuthCallback;
  const inFlatFlow =
    inInviteCode || inOnboarding || inSecuritySetup || inWalletFlow || inUsernameSetup;
  const showGradient = inAuthFlow && !inFlatFlow;

  const storedWalletCount = walletHydrated && walletCount > 0;
  const hasCompletedOnboarding = hasOnboarded || storedWalletCount;

  const shouldEnableLock = hasCompletedOnboarding && walletHydrated;
  const { locked, hasPasscode, checking } = useAppLockState(shouldEnableLock);
  const appLockChecking = shouldEnableLock && checking;
  const shouldShowAppLockRoute =
    shouldEnableLock && hasPasscode && locked && walletPublicKey == null;

  const routeReadyForDisplay = hasCompletedOnboarding
    ? segments.length > 0 && !inInviteCode && !inOnboarding
    : inviteAccessVerified
      ? inAuthFlow || inUsernameSetup || inWalletFlow || inSecuritySetup
      : inInviteCode;

  // Critical fix: Repair the onboarding flag BEFORE routing decisions.
  // If MMKV app-state is reset or unreadable during a storage migration,
  // SecureStore is still the source of truth for whether a wallet exists.
  // This repair must run after MMKV encryption is ready and wallet hydration
  // completes, but BEFORE any routing logic executes.
  const [hasRepairedOnboardingFlag, setHasRepairedOnboardingFlag] = useState(false);

  useEffect(() => {
    if (!mmkvReady || !walletHydrated || hasRepairedOnboardingFlag) return;

    if (!hasOnboarded && storedWalletCount) {
      setHasOnboarded(true);
    }

    setHasRepairedOnboardingFlag(true);
  }, [
    mmkvReady,
    walletHydrated,
    hasOnboarded,
    storedWalletCount,
    setHasOnboarded,
    hasRepairedOnboardingFlag,
  ]);

  // Backfill wallet metadata for users who already completed
  // username setup before wallet display names were persisted.
  useEffect(() => {
    if (username == null || !storedWalletCount || !isGeneratedAccountName(accountName)) return;

    void setActiveWalletName(username).catch((error: unknown) => {
      console.warn('[RootLayout] Failed to backfill wallet display name:', error);
    });
  }, [accountName, storedWalletCount, setActiveWalletName, username]);

  // If app-state loses the username during a cold-start storage
  // migration, recover it from the SecureStore-backed active wallet
  // display name. Generated account labels are not usernames.
  useEffect(() => {
    if (username != null || !storedWalletCount || isGeneratedAccountName(accountName)) return;

    const restoredUsername = formatOffpayUsername(accountName);
    if (restoredUsername != null) {
      setUsername(restoredUsername);
    }
  }, [accountName, storedWalletCount, setUsername, username]);

  // Keep the local profile image stable across restarts and app
  // container path changes. If MMKV loses the URI, recover the newest
  // managed image from disk. If the stored file disappeared, clear the
  // stale URI instead of showing a broken avatar.
  useEffect(() => {
    const resolvedProfileImageUri = resolveStoredProfileImageUri(profileImageUri);
    if (resolvedProfileImageUri !== profileImageUri) {
      setProfileImageUri(resolvedProfileImageUri);
    }
    if (resolvedProfileImageUri != null) {
      pruneManagedProfileImages(resolvedProfileImageUri);
    }
  }, [profileImageUri, setProfileImageUri]);

  // Resolve onboarding routing before the native splash fades away.
  // Wait for all stores to hydrate before making routing decisions to
  // prevent physical devices from incorrectly routing to onboarding.
  useEffect(() => {
    if (!rootLayoutReady) return;
    if (!mmkvReady) return;
    if (hasCompletedOnboarding && !preferencesHydrated) return;
    if (!hasRepairedOnboardingFlag) return;
    if (rootNavigationState.key.length === 0) return;

    if (!hasCompletedOnboarding && !inviteAccessVerified && !inInviteCode) {
      router.replace('/invite-code');
    } else if (!hasCompletedOnboarding && inviteAccessVerified && inInviteCode) {
      router.replace('/onboarding');
    } else if (
      !hasCompletedOnboarding &&
      inviteAccessVerified &&
      !inAuthFlow &&
      !inUsernameSetup &&
      !inWalletFlow &&
      !inSecuritySetup
    ) {
      router.replace('/onboarding');
    } else if (hasCompletedOnboarding && (inInviteCode || inOnboarding)) {
      router.replace('/');
    } else if (shouldShowAppLockRoute && !inAppLock) {
      router.replace('/app-lock/passcode');
    } else if (!appLockChecking && inAppLock && !shouldShowAppLockRoute) {
      router.replace('/');
    }
  }, [
    appLockChecking,
    hasCompletedOnboarding,
    hasRepairedOnboardingFlag,
    inAppLock,
    inAuthFlow,
    inInviteCode,
    inOnboarding,
    inSecuritySetup,
    inUsernameSetup,
    inWalletFlow,
    inviteAccessVerified,
    mmkvReady,
    preferencesHydrated,
    rootLayoutReady,
    rootNavigationState.key,
    router,
    shouldShowAppLockRoute,
  ]);

  // Hide the native splash only once the correct first screen is mounted.
  // The visible reveal is handled by the Reanimated app shell opacity.
  useEffect(() => {
    if (hasHiddenSplash) return;
    if (!rootLayoutReady) return;
    if (!mmkvReady) return;
    if (hasCompletedOnboarding && !preferencesHydrated) return;
    if (!hasRepairedOnboardingFlag) return;
    if (rootNavigationState.key.length === 0) return;
    if (!routeReadyForDisplay) return;
    if (hasCompletedOnboarding && !walletHydrated) return;
    if (appLockChecking) return;
    if (shouldShowAppLockRoute && !inAppLock) return;

    void SplashScreen.hideAsync().then(() => {
      setHasHiddenSplash(true);
      endBootTimer();
    });
  }, [
    appLockChecking,
    hasCompletedOnboarding,
    hasHiddenSplash,
    hasRepairedOnboardingFlag,
    preferencesHydrated,
    routeReadyForDisplay,
    rootLayoutReady,
    rootNavigationState.key,
    shouldShowAppLockRoute,
    inAppLock,
    mmkvReady,
    walletHydrated,
  ]);

  if (!preferencesHydrated && hasCompletedOnboarding) {
    return null;
  }

  if ((appLockChecking || shouldShowAppLockRoute) && !inAppLock) {
    return null;
  }

  const providerRuntime = inAppLock ? 'lock' : 'full';

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <AppProviders runtime={providerRuntime}>
        <ThemeProvider value={OffPayTheme}>
          <Animated.View style={[styles.appShell, rootRevealStyle]}>
            {showGradient ? <GradientBackground /> : null}
            <Stack screenOptions={globalScreenOptions}>
              <Stack.Screen name="invite-code" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="oauth/callback" options={createWalletScreenOptions} />
              <Stack.Screen name="security-setup" options={createWalletScreenOptions} />
              <Stack.Screen name="app-lock/passcode" />
              <Stack.Screen name="username-setup" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="private-payment" options={privatePaymentScreenOptions} />
              <Stack.Screen name="receive-payment" />
              <Stack.Screen name="umbra-pending-claims" />
              <Stack.Screen name="payroll-review" />
              <Stack.Screen name="nearby-wallet-scanner" />
              <Stack.Screen name="advanced-swap" options={advancedSwapScreenOptions} />
              <Stack.Screen name="umbra-privacy" />
              <Stack.Screen name="holdings" options={holdingsScreenOptions} />
              <Stack.Screen name="token-details" />
              <Stack.Screen name="accounts" />
              <Stack.Screen name="create-wallet" options={createWalletScreenOptions} />
              <Stack.Screen name="privy-wallet" options={createWalletScreenOptions} />
              <Stack.Screen name="restore-wallet" options={createWalletScreenOptions} />
            </Stack>
            <StatusBar style="light" />
          </Animated.View>
        </ThemeProvider>
      </AppProviders>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  appShell: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: colors.backgroundGradient.base,
    overflow: 'hidden',
  },
});
