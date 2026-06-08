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
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { isRunningInExpoGo } from 'expo';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { AppLockGate } from '@/components/features/security/AppLockGate';
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
import { cirkaFontMap } from '@/assets/fonts/cirka';
import {
  pruneManagedProfileImages,
  resolveStoredProfileImageUri,
} from '@/lib/profile/profile-image';
import { AppProviders } from '@/providers';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

import type { Theme } from '@react-navigation/native';

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
    duration: 240,
    fade: true,
  });
}

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
  const accountName = useWalletStore((s) => s.accountName);
  const setActiveWalletName = useWalletStore((s) => s.setActiveWalletName);
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const [hasHiddenSplash, setHasHiddenSplash] = useState(false);
  const [rootLayoutReady, setRootLayoutReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setRootLayoutReady(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  // Hydrate wallet from SecureStore on app launch
  useEffect(() => {
    void hydrateWallet();
  }, [hydrateWallet]);

  // Geist/Quicksand ship via the expo-font config plugin on native builds.
  // Cirka is also listed there, but we load it at runtime so portfolio
  // money type renders correctly in Expo Go and before the next rebuild.
  const [cirkaFontsLoaded, cirkaFontError] = useFonts(cirkaFontMap);
  const appReady = cirkaFontsLoaded || cirkaFontError != null;
  const firstSegment = segments[0];
  const inInviteCode = firstSegment === 'invite-code';
  const inOnboarding = firstSegment === 'onboarding';
  const inUsernameSetup = firstSegment === 'username-setup';
  const inCreateWallet = firstSegment === 'create-wallet';
  const inRestoreWallet = firstSegment === 'restore-wallet';
  const inPrivyWallet = firstSegment === 'privy-wallet';
  const inOAuthCallback = firstSegment === 'oauth';
  const inSecuritySetup = firstSegment === 'security-setup';
  const inWalletFlow = inCreateWallet || inRestoreWallet || inPrivyWallet;
  const inAuthFlow = inInviteCode || inOnboarding || inOAuthCallback;
  // The wallet-setup flow (onboarding + security setup + create/
  // restore wallet + privy wallet) paints a flat neutral surface
  // inside `CreateWalletScreenLayout`. We opt those routes out of
  // the screen-wide gradient so the design stays one calm tint
  // across the full flow — no gradients, no shadows, no rims.
  const inFlatFlow = inInviteCode || inOnboarding || inSecuritySetup || inWalletFlow || inUsernameSetup;
  const showGradient = inAuthFlow && !inFlatFlow;
  const hasStoredWallet = walletHydrated && walletCount > 0;
  const effectiveHasOnboarded = hasOnboarded || hasStoredWallet;
  const routeReadyForDisplay = effectiveHasOnboarded
    ? segments.length > 0 && !inInviteCode && !inOnboarding
    : inviteAccessVerified
      ? inAuthFlow || inUsernameSetup || inWalletFlow || inSecuritySetup
      : inInviteCode;
  // If MMKV app-state is reset or unreadable during a storage migration,
  // SecureStore is still the source of truth for whether a wallet exists.
  // Repair the onboarding flag instead of routing an existing wallet back
  // through first-run onboarding.
  useEffect(() => {
    if (!hasOnboarded && hasStoredWallet) {
      setHasOnboarded(true);
    }
  }, [hasOnboarded, hasStoredWallet, setHasOnboarded]);

  // Backfill wallet metadata for users who already completed
  // username setup before wallet display names were persisted.
  useEffect(() => {
    if (username == null || !hasStoredWallet || !isGeneratedAccountName(accountName)) return;

    void setActiveWalletName(username).catch((error: unknown) => {
      console.warn('[RootLayout] Failed to backfill wallet display name:', error);
    });
  }, [accountName, hasStoredWallet, setActiveWalletName, username]);

  // If app-state loses the username during a cold-start storage
  // migration, recover it from the SecureStore-backed active wallet
  // display name. Generated account labels are not usernames.
  useEffect(() => {
    if (username != null || !hasStoredWallet || isGeneratedAccountName(accountName)) return;

    const restoredUsername = formatOffpayUsername(accountName);
    if (restoredUsername != null) {
      setUsername(restoredUsername);
    }
  }, [accountName, hasStoredWallet, setUsername, username]);

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
  useEffect(() => {
    if (!appReady) return;
    if (!rootLayoutReady) return;
    if (rootNavigationState.key.length === 0) return;

    if (!effectiveHasOnboarded && !inviteAccessVerified && !inInviteCode) {
      router.replace('/invite-code');
    } else if (!effectiveHasOnboarded && inviteAccessVerified && inInviteCode) {
      router.replace('/onboarding');
    } else if (
      !effectiveHasOnboarded &&
      inviteAccessVerified &&
      !inAuthFlow &&
      !inUsernameSetup &&
      !inWalletFlow &&
      !inSecuritySetup
    ) {
      router.replace('/onboarding');
    } else if (effectiveHasOnboarded && (inInviteCode || inOnboarding)) {
      router.replace('/(tabs)');
    }
  }, [
    appReady,
    effectiveHasOnboarded,
    inAuthFlow,
    inInviteCode,
    inOnboarding,
    inSecuritySetup,
    inUsernameSetup,
    inWalletFlow,
    inviteAccessVerified,
    rootLayoutReady,
    rootNavigationState.key,
    router,
  ]);

  // Fade out the native splash only once the correct first screen is mounted.
  useEffect(() => {
    if (!appReady || hasHiddenSplash) return;
    if (!rootLayoutReady) return;
    if (rootNavigationState.key.length === 0) return;
    if (!routeReadyForDisplay) return;
    if (effectiveHasOnboarded && !walletHydrated) return;

    void SplashScreen.hideAsync().then(() => {
      setHasHiddenSplash(true);
      endBootTimer();
    });
  }, [
    appReady,
    effectiveHasOnboarded,
    hasHiddenSplash,
    routeReadyForDisplay,
    rootLayoutReady,
    rootNavigationState.key,
    walletHydrated,
  ]);

  if (!appReady) return null;

  return (
    <AppProviders>
      <ThemeProvider value={OffPayTheme}>
        <View style={styles.appShell}>
          {showGradient ? <GradientBackground /> : null}
          <AppLockGate enabled={effectiveHasOnboarded && walletHydrated} />
          <Stack screenOptions={globalScreenOptions}>
            <Stack.Screen name="invite-code" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="oauth/callback" options={createWalletScreenOptions} />
            <Stack.Screen name="security-setup" options={createWalletScreenOptions} />
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
          <StatusBar
            style="light"
            backgroundColor={colors.backgroundGradient.base}
            translucent
          />
        </View>
      </ThemeProvider>
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: colors.backgroundGradient.base,
    overflow: 'hidden',
  },
});
