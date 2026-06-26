import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { LightweightKeypadButton } from '@/components/ui/LightweightKeypadButton';
import { PuffyFingerprintIcon } from '@/components/ui/icons/PuffyFingerprintIcon';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { authenticateWithBiometrics } from '@/lib/wallet/biometric-auth';
import { getPasscodeResponsiveLayout } from '@/lib/ui/passcode-responsive-layout';
import {
  getCachedSecuritySettings,
  getSecuritySettings,
  preloadPasscodeMaterial,
  setWalletLocked,
  verifyPasscode,
} from '@/lib/wallet/security-settings';
import { getStoredWalletInfo } from '@/lib/wallet/secure-wallet-store';
import { useWalletStore } from '@/store/walletStore';

const PASSCODE_AUTO_BIOMETRIC_PROMPT_DELAY_MS = 750;

const SimpleDot = memo(function SimpleDot({
  filled,
  size,
}: {
  filled: boolean;
  size: number;
}): React.JSX.Element {
  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        filled ? styles.dotFilled : styles.dotEmpty,
      ]}
    />
  );
});

interface PasscodeScreenProps {
  fingerprintEnabled?: boolean;
  onUnlock?: () => void;
}

export const PasscodeScreen = memo(function PasscodeScreen({
  fingerprintEnabled: initialFingerprintEnabled,
  onUnlock,
}: PasscodeScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width, height, fontScale } = useWindowDimensions();
  const passcodeLayout = useMemo(
    () =>
      getPasscodeResponsiveLayout({
        width,
        height,
        fontScale,
        topInset: insets.top,
        bottomInset: insets.bottom,
      }),
    [fontScale, height, insets.bottom, insets.top, width],
  );
  const keypadGap = passcodeLayout.keypadGap;

  const [passcodeLength, setPasscodeLength] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [showingReset, setShowingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(() => {
    if (initialFingerprintEnabled != null) return initialFingerprintEnabled;
    return getCachedSecuritySettings()?.fingerprintEnabled === true;
  });

  const unlockingRef = useRef(false);
  const inputDisabledRef = useRef(false);
  const passcodeRef = useRef('');
  const unlockFrameRef = useRef<number | null>(null);
  const unlockAttemptIdRef = useRef(0);
  const autoBiometricPromptedRef = useRef(false);
  const shakeOffset = useSharedValue(0);

  const dotRowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeOffset.value }],
  }));

  useEffect(() => {
    unlockingRef.current = unlocking;
  }, [unlocking]);

  useEffect(() => {
    void preloadPasscodeMaterial();
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (initialFingerprintEnabled != null) {
      setFingerprintEnabled(initialFingerprintEnabled);
      return () => {
        cancelled = true;
      };
    }

    void getSecuritySettings()
      .then((settings) => {
        if (!cancelled) setFingerprintEnabled(settings.fingerprintEnabled);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [initialFingerprintEnabled]);

  useEffect(() => {
    if (toast == null) return;
    const timeout = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timeout);
  }, [toast]);

  const keyFrameStyle = useMemo(() => {
    return {
      width: passcodeLayout.keySize,
      height: passcodeLayout.keySize,
      borderRadius: passcodeLayout.keySize / 2,
    };
  }, [passcodeLayout.keySize]);
  const keyLabelStyle = useMemo(
    () => [styles.keyLabel, { fontSize: passcodeLayout.keyFontSize }],
    [passcodeLayout.keyFontSize],
  );

  const setPasscodeValue = useCallback((nextPasscode: string): void => {
    passcodeRef.current = nextPasscode;
    setPasscodeLength(nextPasscode.length);
  }, []);

  const triggerShake = useCallback((): void => {
    shakeOffset.value = 0;
    shakeOffset.value = withSequence(
      withTiming(-8, { duration: 55 }),
      withTiming(8, { duration: 80 }),
      withTiming(-5, { duration: 70 }),
      withTiming(0, { duration: 65 }),
    );
  }, [shakeOffset]);

  const cancelScheduledUnlock = useCallback((): void => {
    if (unlockFrameRef.current == null) return;
    cancelAnimationFrame(unlockFrameRef.current);
    unlockFrameRef.current = null;
  }, []);

  const unlockWallet = useCallback(async (): Promise<void> => {
    const walletStoreState = useWalletStore.getState();
    const activeWalletId = walletStoreState.activeWalletId;
    const cachedActiveWallet =
      activeWalletId != null
        ? walletStoreState.wallets.find((w) => w.id === activeWalletId)
        : walletStoreState.wallets[0];
    let nextPublicKey = cachedActiveWallet?.publicKey ?? null;

    if (nextPublicKey == null) {
      const info = await getStoredWalletInfo();
      nextPublicKey = info?.publicKey ?? null;
    }

    await setWalletLocked(false);

    useWalletStore.setState({ publicKey: nextPublicKey });
    setPasscodeValue('');
    setToast(null);

    if (onUnlock != null) {
      onUnlock();
    } else {
      router.replace('/');
    }
  }, [onUnlock, router, setPasscodeValue]);

  const handleBiometricUnlock = useCallback(async (): Promise<void> => {
    if (unlockingRef.current || !fingerprintEnabled) return;

    unlockingRef.current = true;
    inputDisabledRef.current = true;
    setUnlocking(true);
    try {
      const result = await authenticateWithBiometrics({
        promptMessage: 'Unlock OffPay',
        promptSubtitle: 'Use fingerprint to access your wallet.',
        promptDescription: 'Use your local password if fingerprint unlock is unavailable.',
      });

      if (result.success) {
        await unlockWallet();
      } else {
        setToast(result.message ?? 'Fingerprint unlock failed.');
      }
    } catch {
      setToast('Could not unlock with fingerprint.');
    } finally {
      unlockingRef.current = false;
      inputDisabledRef.current = resetting || showingReset;
      setUnlocking(false);
    }
  }, [fingerprintEnabled, resetting, showingReset, unlockWallet]);

  useEffect(() => {
    if (
      !fingerprintEnabled ||
      unlocking ||
      AppState.currentState !== 'active' ||
      autoBiometricPromptedRef.current
    ) {
      return;
    }

    autoBiometricPromptedRef.current = true;
    const timeout = setTimeout(() => {
      if (passcodeRef.current.length > 0 || unlockingRef.current) return;
      void handleBiometricUnlock();
    }, PASSCODE_AUTO_BIOMETRIC_PROMPT_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [fingerprintEnabled, handleBiometricUnlock, unlocking]);

  const handlePasscodeUnlock = useCallback(
    async (candidate: string): Promise<void> => {
      if (unlockingRef.current || inputDisabledRef.current) return;
      if (candidate.length !== 6) {
        setToast('Enter your 6-digit wallet password.');
        return;
      }

      const attemptId = unlockAttemptIdRef.current + 1;
      unlockAttemptIdRef.current = attemptId;
      unlockingRef.current = true;
      inputDisabledRef.current = true;
      setUnlocking(true);
      try {
        const ok = await verifyPasscode(candidate);
        if (attemptId !== unlockAttemptIdRef.current || passcodeRef.current !== candidate) {
          return;
        }

        if (ok) {
          await unlockWallet();
        } else {
          setToast('Incorrect wallet password.');
          triggerShake();
          setPasscodeValue('');
        }
      } catch {
        setToast('Could not unlock wallet.');
        triggerShake();
        setPasscodeValue('');
      } finally {
        if (attemptId === unlockAttemptIdRef.current) {
          unlockingRef.current = false;
          inputDisabledRef.current = resetting || showingReset;
          setUnlocking(false);
        }
      }
    },
    [resetting, setPasscodeValue, showingReset, triggerShake, unlockWallet],
  );

  const schedulePasscodeUnlock = useCallback(
    (candidate: string): void => {
      cancelScheduledUnlock();
      unlockFrameRef.current = requestAnimationFrame(() => {
        unlockFrameRef.current = null;
        if (passcodeRef.current !== candidate) return;
        void handlePasscodeUnlock(candidate);
      });
    },
    [cancelScheduledUnlock, handlePasscodeUnlock],
  );

  const handleDigit = useCallback(
    (digit: string): void => {
      if (inputDisabledRef.current) return;
      if (passcodeRef.current.length >= 6) return;
      autoBiometricPromptedRef.current = true;
      const next = `${passcodeRef.current}${digit}`.slice(0, 6);
      setPasscodeValue(next);
      if (next.length === 6) {
        schedulePasscodeUnlock(next);
      }
    },
    [schedulePasscodeUnlock, setPasscodeValue],
  );

  const handleDelete = useCallback((): void => {
    if (inputDisabledRef.current) return;
    unlockAttemptIdRef.current += 1;
    cancelScheduledUnlock();
    setPasscodeValue(passcodeRef.current.slice(0, -1));
  }, [cancelScheduledUnlock, setPasscodeValue]);

  const handleClear = useCallback((): void => {
    if (inputDisabledRef.current) return;
    unlockAttemptIdRef.current += 1;
    cancelScheduledUnlock();
    setPasscodeValue('');
  }, [cancelScheduledUnlock, setPasscodeValue]);

  useEffect(() => {
    inputDisabledRef.current = unlocking || resetting || showingReset;
  }, [resetting, showingReset, unlocking]);

  useEffect(() => {
    return () => cancelScheduledUnlock();
  }, [cancelScheduledUnlock]);

  const handleForgotPasswordReset = useCallback(async (): Promise<void> => {
    if (resetting) return;

    setResetting(true);
    setToast(null);
    unlockAttemptIdRef.current += 1;
    cancelScheduledUnlock();
    setPasscodeValue('');

    try {
      const { resetForgottenWallet } = await import('@/lib/wallet/wallet-reset');
      await resetForgottenWallet({ queryClient });
      setUnlocking(false);
      setShowingReset(false);
      router.replace('/invite-code');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reset this wallet.';
      setToast(message);
      setShowingReset(false);
    } finally {
      setResetting(false);
    }
  }, [cancelScheduledUnlock, queryClient, resetting, router, setPasscodeValue]);

  const handleForgotPasswordPress = useCallback((): void => {
    if (unlocking || resetting) return;
    unlockAttemptIdRef.current += 1;
    cancelScheduledUnlock();
    setShowingReset(true);
  }, [cancelScheduledUnlock, resetting, unlocking]);

  const keypadRows = useMemo(
    () =>
      fingerprintEnabled
        ? [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['fingerprint', '0', 'delete'],
          ]
        : [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['clear', '0', 'delete'],
          ],
    [fingerprintEnabled],
  );

  const digitHandlers = useMemo(
    () => ({
      '0': () => handleDigit('0'),
      '1': () => handleDigit('1'),
      '2': () => handleDigit('2'),
      '3': () => handleDigit('3'),
      '4': () => handleDigit('4'),
      '5': () => handleDigit('5'),
      '6': () => handleDigit('6'),
      '7': () => handleDigit('7'),
      '8': () => handleDigit('8'),
      '9': () => handleDigit('9'),
    }),
    [handleDigit],
  );

  const fingerprintPress = useCallback(() => {
    void handleBiometricUnlock();
  }, [handleBiometricUnlock]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + passcodeLayout.verticalPadding,
            paddingBottom: insets.bottom + passcodeLayout.verticalPadding,
            paddingHorizontal: passcodeLayout.horizontalPadding,
          },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.content,
            {
              maxWidth: passcodeLayout.contentMaxWidth,
              gap: passcodeLayout.contentGap,
            },
          ]}
        >
          <View
            style={[styles.copyBlock, { gap: Math.max(spacing.xs, passcodeLayout.contentGap / 3) }]}
          >
            <RNText
              style={[
                styles.title,
                {
                  fontSize: passcodeLayout.titleFontSize,
                  lineHeight: passcodeLayout.titleLineHeight,
                },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              Unlock wallet
            </RNText>
            <RNText style={[styles.subtitle, { fontSize: passcodeLayout.subtitleFontSize }]}>
              {`Enter your passcode${fingerprintEnabled ? ' or use fingerprint' : ''}.`}
            </RNText>
          </View>

          <Animated.View style={[styles.dotRow, { gap: passcodeLayout.dotGap }, dotRowStyle]}>
            <SimpleDot filled={passcodeLength > 0} size={passcodeLayout.dotSize} />
            <SimpleDot filled={passcodeLength > 1} size={passcodeLayout.dotSize} />
            <SimpleDot filled={passcodeLength > 2} size={passcodeLayout.dotSize} />
            <SimpleDot filled={passcodeLength > 3} size={passcodeLayout.dotSize} />
            <SimpleDot filled={passcodeLength > 4} size={passcodeLayout.dotSize} />
            <SimpleDot filled={passcodeLength > 5} size={passcodeLayout.dotSize} />
          </Animated.View>

          <View style={[styles.keypad, { gap: keypadGap }]}>
            {keypadRows.map((row, rowIndex) => (
              <View key={rowIndex} style={[styles.keyRow, { gap: keypadGap }]}>
                {row.map((key) => {
                  if (key === 'fingerprint') {
                    return (
                      <LightweightKeypadButton
                        key={key}
                        frameStyle={keyFrameStyle}
                        onPress={fingerprintPress}
                        disabled={resetting}
                        activateOnPressIn
                        accessibilityRole="button"
                        accessibilityLabel="Unlock with fingerprint"
                      >
                        <PuffyFingerprintIcon
                          size={layout.iconSizeInline}
                          color={colors.text.primary}
                          focused
                        />
                      </LightweightKeypadButton>
                    );
                  }

                  if (key === 'clear') {
                    return (
                      <LightweightKeypadButton
                        key={key}
                        frameStyle={keyFrameStyle}
                        onPress={handleClear}
                        disabled={passcodeLength === 0 || resetting}
                        muted={passcodeLength === 0}
                        activateOnPressIn
                        accessibilityRole="button"
                        accessibilityLabel="Clear passcode"
                      >
                        <RNText style={keyLabelStyle}>x</RNText>
                      </LightweightKeypadButton>
                    );
                  }

                  if (key === 'delete') {
                    return (
                      <LightweightKeypadButton
                        key={key}
                        frameStyle={keyFrameStyle}
                        onPress={handleDelete}
                        disabled={passcodeLength === 0 || resetting}
                        muted={passcodeLength === 0}
                        activateOnPressIn
                        accessibilityRole="button"
                        accessibilityLabel="Delete last digit"
                      >
                        <RNText style={keyLabelStyle}>{'<'}</RNText>
                      </LightweightKeypadButton>
                    );
                  }

                  return (
                    <LightweightKeypadButton
                      key={key}
                      frameStyle={keyFrameStyle}
                      onPress={digitHandlers[key as keyof typeof digitHandlers]}
                      disabled={resetting}
                      activateOnPressIn
                      accessibilityRole="keyboardkey"
                      accessibilityLabel={`Digit ${key}`}
                    >
                      <RNText style={keyLabelStyle}>{key}</RNText>
                    </LightweightKeypadButton>
                  );
                })}
              </View>
            ))}
          </View>

          <Pressable
            style={[styles.forgotButton, (unlocking || resetting) && styles.buttonDisabled]}
            onPress={handleForgotPasswordPress}
            disabled={unlocking || resetting}
          >
            <RNText style={styles.forgotButtonText}>
              {resetting ? 'Resetting wallet...' : 'Forgot password?'}
            </RNText>
          </Pressable>

          {toast != null ? (
            <View style={styles.toast}>
              <RNText style={styles.toastText}>{toast}</RNText>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {showingReset ? (
        <View style={styles.resetOverlay}>
          <Pressable style={styles.resetScrim} onPress={() => setShowingReset(false)} />
          <View style={styles.resetCard}>
            <RNText style={styles.resetTitle}>Reset wallet?</RNText>
            <RNText style={styles.resetBody}>
              Erases this device. Restore later with your recovery phrase or private key.
            </RNText>
            <View style={styles.resetActions}>
              <Pressable style={styles.resetCancelButton} onPress={() => setShowingReset(false)}>
                <RNText style={styles.resetCancelText}>Cancel</RNText>
              </Pressable>
              <Pressable
                style={styles.resetConfirmButton}
                onPress={() => void handleForgotPasswordReset()}
              >
                {resetting ? (
                  <LazyLoadingSpinner size={18} color={colors.brand.whiteStream} />
                ) : (
                  <RNText style={styles.resetConfirmText}>Reset</RNText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {},
  dotFilled: {
    backgroundColor: colors.brand.glossAccent,
  },
  dotEmpty: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  keypad: {
    gap: spacing.lg,
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  keyLabel: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text.primary,
  },
  fingerprintIcon: {
    fontSize: 24,
  },
  forgotButton: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  forgotButtonText: {
    fontSize: 14,
    color: colors.text.primary,
  },
  toast: {
    backgroundColor: colors.surface.cardElevated,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
  toastText: {
    fontSize: 14,
    color: colors.text.primary,
  },
  resetOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['3xl'],
    zIndex: 1,
  },
  resetScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  resetCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.brand.graphiteDepth,
    borderRadius: 16,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  resetTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
  },
  resetBody: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    maxWidth: 300,
    alignSelf: 'center',
  },
  resetActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  resetCancelButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.brand.glassTint,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
  },
  resetConfirmButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.semantic.error,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.brand.whiteStream,
  },
});
