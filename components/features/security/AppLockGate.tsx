import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { WaterKeypadButton } from '@/components/ui/WaterKeypadButton';
import { PuffyFingerprintIcon } from '@/components/ui/icons/PuffyFingerprintIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { authenticateWithBiometrics } from '@/lib/wallet/biometric-auth';
import {
  getSecuritySettings,
  preloadPasscodeMaterial,
  setWalletLocked,
  verifyPasscode,
} from '@/lib/wallet/security-settings';
import { mark, measure } from '@/lib/perf/perf-marks';
import { clearSigningSeedCache } from '@/lib/wallet/signing-seed-cache';
import { getStoredWalletInfo } from '@/lib/wallet/secure-wallet-store';
import { resetForgottenWallet } from '@/lib/wallet/wallet-reset';
import { getAppLockSuppressionRemainingMs } from '@/lib/wallet/app-lock-suppression';
import { useWalletStore } from '@/store/walletStore';

interface AppLockGateProps {
  enabled: boolean;
}

const BACKGROUND_LOCK_GRACE_AFTER_UNLOCK_MS = 900;

type KeyKind = 'digit' | 'fingerprint' | 'clear' | 'delete';

function requestAppAnimationFrame(callback: () => void): number {
  const frameGlobal = globalThis as typeof globalThis & {
    requestAnimationFrame?: typeof requestAnimationFrame;
  };
  if (typeof frameGlobal.requestAnimationFrame === 'function') {
    return frameGlobal.requestAnimationFrame(() => callback());
  }
  return setTimeout(callback, 0) as unknown as number;
}

function cancelAppAnimationFrame(handle: number): void {
  const frameGlobal = globalThis as typeof globalThis & {
    cancelAnimationFrame?: typeof cancelAnimationFrame;
  };
  if (typeof frameGlobal.cancelAnimationFrame === 'function') {
    frameGlobal.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

interface KeyButtonProps {
  kind: KeyKind;
  label?: string;
  disabled: boolean;
  muted?: boolean;
  frameStyle: ViewStyle;
  onPress: () => void;
}

const KeyButton = memo(function KeyButton({
  kind,
  label,
  disabled,
  muted,
  frameStyle,
  onPress,
}: KeyButtonProps): React.JSX.Element {
  if (kind === 'fingerprint') {
    return (
      <WaterKeypadButton
        frameStyle={frameStyle}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Unlock with fingerprint"
      >
        <PuffyFingerprintIcon size={layout.iconSizeTab} color={colors.text.primary} focused />
      </WaterKeypadButton>
    );
  }

  const accessibilityLabel =
    kind === 'clear'
      ? 'Clear passcode'
      : kind === 'delete'
        ? 'Delete last digit'
        : `Digit ${label}`;
  const accessibilityRole = kind === 'digit' ? 'keyboardkey' : 'button';

  return (
    <WaterKeypadButton
      frameStyle={frameStyle}
      onPress={onPress}
      disabled={disabled}
      muted={muted}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <Text
        variant="h2"
        color={muted ? colors.text.tertiary : colors.text.primary}
        align="center"
        style={styles.keyLabel}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </WaterKeypadButton>
  );
});

export function AppLockGate({ enabled }: AppLockGateProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const compact = height < 760;
  const veryCompact = height < 690;
  const horizontalPadding = width < 360 ? spacing.xl : spacing['3xl'];
  // Memoise every layout-derived size so digit presses don't recompute
  // them or hand a fresh style object to each <Pressable> below.
  const keypadLayout = useMemo(() => {
    const keypadMaxWidth = Math.min(336, Math.max(220, width - horizontalPadding * 2));
    const keypadGap = veryCompact ? spacing.sm : compact ? spacing.md : spacing.lg;
    const contentGap = veryCompact ? spacing.lg : compact ? spacing.xl : spacing['2xl'];
    const maxKeySize = veryCompact ? 58 : compact ? 66 : 72;
    const keypadHeightBudget = Math.max(220, height - (veryCompact ? 330 : compact ? 370 : 430));
    const keySize = Math.max(
      layout.minTouchTarget,
      Math.min(
        maxKeySize,
        Math.floor((keypadMaxWidth - keypadGap * 2) / 3),
        Math.floor((keypadHeightBudget - keypadGap * 3) / 4),
      ),
    );
    const keyFrameStyle = {
      width: keySize,
      height: keySize,
      borderRadius: keySize / 2,
    } as const;
    return {
      keypadMaxWidth,
      keypadGap,
      contentGap,
      keyFrameStyle,
    };
  }, [compact, height, horizontalPadding, veryCompact, width]);
  const { keypadMaxWidth, keypadGap, contentGap, keyFrameStyle } = keypadLayout;
  const resetDialogMaxWidth = Math.min(360, Math.max(280, width - horizontalPadding * 2));

  const hasStoredWallet = useWalletStore((state) => state.wallets.length > 0);
  const walletPublicKey = useWalletStore((state) => state.publicKey);
  // After `walletStore.hydrate` resolves, `publicKey == null` paired
  // with a non-empty wallet list is exactly the "wallet should start
  // locked" signal that `shouldStartWalletLocked` produces. By seeding
  // initial state from that we paint the lock overlay synchronously
  // with the home screen instead of after a SecureStore round-trip,
  // which removes the brief home-screen flash on cold start.
  const expectedInitialLock = enabled && hasStoredWallet && walletPublicKey == null;

  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(expectedInitialLock);
  const [hasPasscode, setHasPasscode] = useState(expectedInitialLock);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [passcodeLength, setPasscodeLength] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const loadRequestIdRef = useRef(0);
  const lockMutationIdRef = useRef(0);
  const lockWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const passcodeRef = useRef('');
  const passcodeRenderFrameRef = useRef<number | null>(null);
  const passcodeUnlockFrameRef = useRef<number | null>(null);
  const lockedRef = useRef(expectedInitialLock);
  const unlockingRef = useRef(false);
  const hasUnlockedThisSessionRef = useRef(false);
  const autoBiometricPromptedRef = useRef(false);
  const ignoreBackgroundLockUntilRef = useRef(0);
  const backgroundLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shake animation for wrong passcode
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));
  const triggerShake = useCallback((): void => {
    const d = 60;
    const a = 12;
    shakeX.value = withSequence(
      withTiming(-a, { duration: d }),
      withTiming(a, { duration: d }),
      withTiming(-a, { duration: d }),
      withTiming(a, { duration: d }),
      withTiming(-a * 0.5, { duration: d }),
      withTiming(a * 0.5, { duration: d }),
      withTiming(0, { duration: d }),
    );
  }, [shakeX]);

  const setLockedState = useCallback((nextLocked: boolean): void => {
    lockedRef.current = nextLocked;
    setLocked(nextLocked);
  }, []);

  const setUnlockingState = useCallback((nextUnlocking: boolean): void => {
    unlockingRef.current = nextUnlocking;
    setUnlocking(nextUnlocking);
  }, []);

  const cancelPasscodeRenderFrame = useCallback((): void => {
    if (passcodeRenderFrameRef.current == null) return;
    cancelAppAnimationFrame(passcodeRenderFrameRef.current);
    passcodeRenderFrameRef.current = null;
  }, []);

  const flushPasscodeLength = useCallback((): void => {
    cancelPasscodeRenderFrame();
    setPasscodeLength(passcodeRef.current.length);
  }, [cancelPasscodeRenderFrame]);

  const schedulePasscodeLengthRender = useCallback((): void => {
    if (passcodeRenderFrameRef.current != null) return;
    passcodeRenderFrameRef.current = requestAppAnimationFrame(() => {
      passcodeRenderFrameRef.current = null;
      setPasscodeLength(passcodeRef.current.length);
    });
  }, []);

  const setPasscodeValue = useCallback(
    (next: string | ((current: string) => string), options?: { immediate?: boolean }): void => {
      const nextValue = typeof next === 'function' ? next(passcodeRef.current) : next;
      passcodeRef.current = nextValue;
      if (options?.immediate === true) {
        flushPasscodeLength();
        return;
      }
      schedulePasscodeLengthRender();
    },
    [flushPasscodeLength, schedulePasscodeLengthRender],
  );

  const cancelScheduledPasscodeUnlock = useCallback((): void => {
    if (passcodeUnlockFrameRef.current == null) return;
    cancelAppAnimationFrame(passcodeUnlockFrameRef.current);
    passcodeUnlockFrameRef.current = null;
  }, []);

  const inputDisabled = unlocking || resetting || resetConfirmVisible;

  const writeWalletLocked = useCallback(async (nextLocked: boolean): Promise<boolean> => {
    const mutationId = lockMutationIdRef.current + 1;
    lockMutationIdRef.current = mutationId;
    loadRequestIdRef.current += 1;

    const write = lockWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (mutationId !== lockMutationIdRef.current) return false;

        await setWalletLocked(nextLocked);

        return mutationId === lockMutationIdRef.current;
      });

    lockWriteQueueRef.current = write.then(
      () => undefined,
      () => undefined,
    );

    return write;
  }, []);

  const clearPendingBackgroundLock = useCallback((): void => {
    if (backgroundLockTimerRef.current == null) return;
    clearTimeout(backgroundLockTimerRef.current);
    backgroundLockTimerRef.current = null;
  }, []);

  const lockWalletForBackground = useCallback(async (): Promise<void> => {
    if (
      isAppActive() ||
      lockedRef.current ||
      unlockingRef.current ||
      Date.now() < ignoreBackgroundLockUntilRef.current ||
      getAppLockSuppressionRemainingMs() > 0
    ) {
      return;
    }

    // Flip the in-memory lock state synchronously so the next render
    // (which may be moments later when the user pulls the app back to
    // the foreground) paints the lock overlay immediately. SecureStore
    // persistence happens after, on the same path that previously
    // gated the visible flip behind an async round-trip.
    if (hasPasscode) {
      hasUnlockedThisSessionRef.current = false;
      useWalletStore.setState({ publicKey: null });
      clearSigningSeedCache('app-background');
      setLockedState(true);
      setChecking(false);
    }

    const mutationId = lockMutationIdRef.current;
    const settings = await getSecuritySettings();
    if (
      isAppActive() ||
      !settings.hasPasscode ||
      unlockingRef.current ||
      Date.now() < ignoreBackgroundLockUntilRef.current ||
      getAppLockSuppressionRemainingMs() > 0 ||
      mutationId !== lockMutationIdRef.current
    ) {
      return;
    }

    const committed = await writeWalletLocked(true);
    if (!committed || isAppActive()) return;

    setHasPasscode(true);
    setFingerprintEnabled(settings.fingerprintEnabled);
  }, [hasPasscode, setLockedState, writeWalletLocked]);

  const scheduleBackgroundLock = useCallback((): void => {
    const now = Date.now();
    const backgroundLockDelay = Math.max(
      ignoreBackgroundLockUntilRef.current - now,
      getAppLockSuppressionRemainingMs(now),
    );
    if (backgroundLockDelay > 0) {
      clearPendingBackgroundLock();
      backgroundLockTimerRef.current = setTimeout(() => {
        backgroundLockTimerRef.current = null;
        void lockWalletForBackground();
      }, backgroundLockDelay + 32);
      return;
    }

    void lockWalletForBackground();
  }, [clearPendingBackgroundLock, lockWalletForBackground]);

  const unlockWallet = useCallback(async (): Promise<void> => {
    // Resolve the active wallet's public key from the in-memory store
    // (already hydrated at boot) so the unlock path doesn't pay for an
    // extra SecureStore round-trip. Falls back to a SecureStore read
    // only if the store somehow lacks an active wallet.
    const walletStoreState = useWalletStore.getState();
    const activeWalletId = walletStoreState.activeWalletId;
    const cachedActiveWallet =
      activeWalletId != null
        ? walletStoreState.wallets.find((wallet) => wallet.id === activeWalletId)
        : walletStoreState.wallets[0];
    let nextPublicKey = cachedActiveWallet?.publicKey ?? null;

    if (nextPublicKey == null) {
      const info = await getStoredWalletInfo();
      nextPublicKey = info?.publicKey ?? null;
    }

    // Flip the in-memory unlock state synchronously so the overlay
    // hides on the next render — same pattern `lockWalletForBackground`
    // uses for instant lock. The SecureStore write is fired off
    // afterwards through the existing queue; if the platform refuses
    // it, the next `loadLockState` round will re-derive the lock state
    // from disk and the overlay will reappear.
    hasUnlockedThisSessionRef.current = true;
    ignoreBackgroundLockUntilRef.current = Date.now() + BACKGROUND_LOCK_GRACE_AFTER_UNLOCK_MS;
    useWalletStore.setState({ publicKey: nextPublicKey });
    setPasscodeValue('', { immediate: true });
    setToast(null);
    setLockedState(false);
    setChecking(false);

    void writeWalletLocked(false).catch(() => undefined);
  }, [setLockedState, setPasscodeValue, writeWalletLocked]);

  const loadLockState = useCallback(async (): Promise<void> => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const mutationId = lockMutationIdRef.current;

    if (!enabled) {
      if (requestId === loadRequestIdRef.current && mutationId === lockMutationIdRef.current) {
        setChecking(false);
        setLockedState(false);
        setHasPasscode(false);
        setFingerprintEnabled(false);
        hasUnlockedThisSessionRef.current = false;
      }
      return;
    }

    try {
      const settings = await getSecuritySettings();
      if (requestId !== loadRequestIdRef.current || mutationId !== lockMutationIdRef.current) {
        return;
      }

      setHasPasscode(settings.hasPasscode);
      setFingerprintEnabled(settings.fingerprintEnabled);
      const hasUnlockedWalletAddress = useWalletStore.getState().publicKey != null;
      const shouldLock =
        settings.hasPasscode &&
        (settings.walletLocked ||
          (!hasUnlockedThisSessionRef.current && !hasUnlockedWalletAddress));
      if (!shouldLock && settings.hasPasscode && hasUnlockedWalletAddress) {
        hasUnlockedThisSessionRef.current = true;
      }
      setLockedState(shouldLock);
      if (shouldLock) {
        if (!settings.walletLocked) {
          void setWalletLocked(true).catch(() => undefined);
        }
        useWalletStore.setState({ publicKey: null });
        clearSigningSeedCache('app-locked');
      }
    } finally {
      if (requestId === loadRequestIdRef.current && mutationId === lockMutationIdRef.current) {
        setChecking(false);
      }
    }
  }, [enabled, setLockedState]);

  useEffect(() => {
    void loadLockState();
  }, [loadLockState]);

  useEffect(() => {
    if (!enabled) return undefined;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        clearPendingBackgroundLock();
        void loadLockState();
        return;
      }

      if (lockedRef.current || unlockingRef.current) {
        return;
      }

      scheduleBackgroundLock();
    });

    return () => {
      subscription.remove();
      clearPendingBackgroundLock();
    };
  }, [clearPendingBackgroundLock, enabled, loadLockState, scheduleBackgroundLock]);

  const handleFingerprintUnlock = useCallback(async (): Promise<void> => {
    if (unlocking || resetting || resetConfirmVisible || !fingerprintEnabled) return;
    cancelScheduledPasscodeUnlock();
    setUnlockingState(true);
    try {
      const result = await authenticateWithBiometrics({
        promptMessage: 'Unlock OffPay',
        promptSubtitle: 'Use fingerprint to access your wallet.',
        promptDescription: 'Use your local password if fingerprint unlock is unavailable.',
      });
      if (!result.success) {
        setToast(result.message ?? 'Fingerprint unlock failed.');
        return;
      }
      await unlockWallet();
    } catch {
      setToast('Could not unlock with fingerprint.');
    } finally {
      setUnlockingState(false);
      if (AppState.currentState === 'background') {
        scheduleBackgroundLock();
      }
    }
  }, [
    fingerprintEnabled,
    cancelScheduledPasscodeUnlock,
    resetConfirmVisible,
    resetting,
    scheduleBackgroundLock,
    setUnlockingState,
    unlockWallet,
    unlocking,
  ]);

  useEffect(() => {
    if (!locked) {
      autoBiometricPromptedRef.current = false;
    }
  }, [locked]);

  useEffect(() => {
    if (
      !enabled ||
      checking ||
      !locked ||
      !hasPasscode ||
      !fingerprintEnabled ||
      unlocking ||
      resetting ||
      resetConfirmVisible
    ) {
      return undefined;
    }
    if (autoBiometricPromptedRef.current || AppState.currentState !== 'active') {
      return undefined;
    }

    autoBiometricPromptedRef.current = true;
    const timeout = setTimeout(() => {
      void handleFingerprintUnlock();
    }, 180);

    return () => {
      clearTimeout(timeout);
    };
  }, [
    checking,
    enabled,
    fingerprintEnabled,
    handleFingerprintUnlock,
    hasPasscode,
    locked,
    resetting,
    resetConfirmVisible,
    unlocking,
  ]);

  useEffect(() => {
    if (toast == null) return;
    const timeout = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!enabled || !locked || !hasPasscode) return;
    void preloadPasscodeMaterial().catch(() => undefined);
  }, [enabled, hasPasscode, locked]);

  const handlePasscodeUnlock = useCallback(
    async (candidate: string): Promise<void> => {
      if (unlocking) return;
      if (resetting) return;
      if (resetConfirmVisible) return;
      if (candidate.length !== 6) {
        setToast('Enter your 6-digit wallet password.');
        return;
      }

      setUnlockingState(true);
      try {
        const verifyStartedAt = mark();
        const ok = await verifyPasscode(candidate);
        measure('passcode.unlock.verify', verifyStartedAt, {
          cachedMaterialExpected: true,
        });
        if (!ok) {
          setToast('Incorrect wallet password.');
          triggerShake();
          setPasscodeValue('', { immediate: true });
          return;
        }
        await unlockWallet();
      } catch {
        setToast('Could not unlock wallet.');
        triggerShake();
        setPasscodeValue('', { immediate: true });
      } finally {
        setUnlockingState(false);
        if (AppState.currentState === 'background') {
          scheduleBackgroundLock();
        }
      }
    },
    [
      resetting,
      resetConfirmVisible,
      scheduleBackgroundLock,
      setPasscodeValue,
      setUnlockingState,
      triggerShake,
      unlockWallet,
      unlocking,
    ],
  );

  const schedulePasscodeUnlock = useCallback(
    (candidate: string): void => {
      cancelScheduledPasscodeUnlock();
      passcodeUnlockFrameRef.current = requestAppAnimationFrame(() => {
        passcodeUnlockFrameRef.current = requestAppAnimationFrame(() => {
          passcodeUnlockFrameRef.current = null;
          if (passcodeRef.current !== candidate || unlockingRef.current) return;
          void handlePasscodeUnlock(candidate);
        });
      });
    },
    [cancelScheduledPasscodeUnlock, handlePasscodeUnlock],
  );

  const handleDigit = useCallback(
    (digit: string): void => {
      if (inputDisabled) return;
      const currentPasscode = passcodeRef.current;
      if (currentPasscode.length >= 6) return;

      const nextPasscode = `${currentPasscode}${digit}`;
      setPasscodeValue(nextPasscode);
      if (nextPasscode.length === 6) {
        schedulePasscodeUnlock(nextPasscode);
      }
    },
    [inputDisabled, schedulePasscodeUnlock, setPasscodeValue],
  );

  const handleDelete = useCallback((): void => {
    if (unlocking || resetting || resetConfirmVisible) return;
    cancelScheduledPasscodeUnlock();
    setPasscodeValue((current) => current.slice(0, -1), { immediate: true });
  }, [cancelScheduledPasscodeUnlock, resetting, resetConfirmVisible, setPasscodeValue, unlocking]);

  const handleClear = useCallback((): void => {
    if (unlocking || resetting || resetConfirmVisible) return;
    cancelScheduledPasscodeUnlock();
    setPasscodeValue('', { immediate: true });
  }, [cancelScheduledPasscodeUnlock, resetting, resetConfirmVisible, setPasscodeValue, unlocking]);

  useEffect(() => {
    return () => {
      cancelPasscodeRenderFrame();
      cancelScheduledPasscodeUnlock();
    };
  }, [cancelPasscodeRenderFrame, cancelScheduledPasscodeUnlock]);

  const handleForgotPasswordReset = useCallback(async (): Promise<void> => {
    if (resetting) return;

    setResetConfirmVisible(false);
    setResetting(true);
    setToast(null);
    cancelScheduledPasscodeUnlock();
    setPasscodeValue('', { immediate: true });
    clearPendingBackgroundLock();
    lockMutationIdRef.current += 1;
    loadRequestIdRef.current += 1;

    try {
      await resetForgottenWallet({ queryClient });
      hasUnlockedThisSessionRef.current = false;
      autoBiometricPromptedRef.current = false;
      setUnlockingState(false);
      setLockedState(false);
      setHasPasscode(false);
      setFingerprintEnabled(false);
      setChecking(false);
      router.replace('/onboarding');
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Could not reset this wallet. Try again.';
      setToast(message);
    } finally {
      setResetting(false);
    }
  }, [
    clearPendingBackgroundLock,
    cancelScheduledPasscodeUnlock,
    queryClient,
    resetting,
    router,
    setLockedState,
    setPasscodeValue,
    setUnlockingState,
  ]);

  const handleForgotPasswordPress = useCallback((): void => {
    if (unlocking || resetting) return;

    cancelScheduledPasscodeUnlock();
    setToast(null);
    setResetConfirmVisible(true);
  }, [cancelScheduledPasscodeUnlock, resetting, unlocking]);

  const handleCancelResetConfirm = useCallback((): void => {
    if (resetting) return;

    setResetConfirmVisible(false);
  }, [resetting]);

  const keypadRows = useMemo(
    () => [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      [fingerprintEnabled ? 'fingerprint' : 'clear', '0', 'delete'],
    ],
    [fingerprintEnabled],
  );

  // Pre-build a stable digit press handler per digit so each
  // <KeyButton> can `React.memo` against a fixed `onPress` reference.
  const digitHandlers = useMemo<Record<string, () => void>>(() => {
    const out: Record<string, () => void> = {};
    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      out[digit] = () => handleDigit(digit);
    }
    return out;
  }, [handleDigit]);

  const fingerprintPress = useCallback(() => {
    void handleFingerprintUnlock();
  }, [handleFingerprintUnlock]);

  const renderKey = useCallback(
    (key: string): React.JSX.Element => {
      if (key === 'fingerprint') {
        return (
          <KeyButton
            key={key}
            kind="fingerprint"
            disabled={inputDisabled}
            frameStyle={keyFrameStyle}
            onPress={fingerprintPress}
          />
        );
      }
      if (key === 'clear') {
        return (
          <KeyButton
            key={key}
            kind="clear"
            label="x"
            disabled={passcodeLength === 0 || inputDisabled}
            muted={passcodeLength === 0}
            frameStyle={keyFrameStyle}
            onPress={handleClear}
          />
        );
      }
      if (key === 'delete') {
        return (
          <KeyButton
            key={key}
            kind="delete"
            label="<"
            disabled={passcodeLength === 0 || inputDisabled}
            muted={passcodeLength === 0}
            frameStyle={keyFrameStyle}
            onPress={handleDelete}
          />
        );
      }
      return (
        <KeyButton
          key={key}
          kind="digit"
          label={key}
          disabled={inputDisabled}
          frameStyle={keyFrameStyle}
          onPress={digitHandlers[key]!}
        />
      );
    },
    [
      digitHandlers,
      fingerprintPress,
      handleClear,
      handleDelete,
      inputDisabled,
      keyFrameStyle,
      passcodeLength,
    ],
  );

  const showUnlockControls = !checking && locked && hasPasscode;
  const shouldRenderGate = enabled && hasStoredWallet && (checking || showUnlockControls);

  if (!shouldRenderGate) {
    return null;
  }

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[styles.content, { gap: contentGap }]}>
        <View style={styles.copyBlock}>
          <Text variant="h1" color={colors.text.primary} align="center" style={styles.title}>
            Unlock wallet
          </Text>
          <Text
            variant="caption"
            color={colors.text.secondary}
            align="center"
            style={styles.subtitle}
          >
            {checking
              ? 'Checking wallet security.'
              : `Enter your passcode${fingerprintEnabled ? ' or use fingerprint' : ''}.`}
          </Text>
        </View>

        {showUnlockControls ? (
          <>
            <Animated.View
              style={[styles.dotRow, shakeStyle]}
              accessibilityLabel={`${passcodeLength} of 6 digits entered`}
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <View
                  key={index}
                  style={[styles.dot, index < passcodeLength ? styles.dotFilled : styles.dotEmpty]}
                />
              ))}
            </Animated.View>

            <View style={[styles.keypad, { maxWidth: keypadMaxWidth, gap: keypadGap }]}>
              {keypadRows.map((row, rowIndex) => (
                <View key={rowIndex} style={[styles.keyRow, { gap: keypadGap }]}>
                  {row.map(renderKey)}
                </View>
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.forgotPasswordButton,
                pressed && !inputDisabled ? styles.forgotPasswordButtonPressed : null,
                inputDisabled ? styles.forgotPasswordButtonDisabled : null,
              ]}
              onPress={handleForgotPasswordPress}
              disabled={inputDisabled}
              accessibilityRole="button"
              accessibilityLabel="Forgot wallet password"
              hitSlop={spacing.md}
            >
              <Text
                variant="buttonSmall"
                color={colors.text.primary}
                align="center"
                style={styles.forgotPasswordText}
              >
                {resetting ? 'Resetting wallet...' : 'Forgot password?'}
              </Text>
            </Pressable>
          </>
        ) : null}

        <View style={styles.toastSlot}>
          {toast != null ? (
            <View style={styles.toast}>
              <Text variant="small" color={colors.text.primary} align="center">
                {toast}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {resetConfirmVisible ? (
        <View
          style={styles.resetDialogLayer}
          accessibilityViewIsModal
          accessibilityLabel="Reset wallet confirmation"
        >
          <Pressable
            style={styles.resetDialogScrim}
            onPress={handleCancelResetConfirm}
            disabled={resetting}
            accessibilityRole="button"
            accessibilityLabel="Cancel wallet reset"
          />
          <View style={[styles.resetDialogCard, { maxWidth: resetDialogMaxWidth }]}>
            <View style={styles.resetDialogCopy}>
              <Text variant="h3" color={colors.text.primary} style={styles.resetDialogTitle}>
                Reset wallet?
              </Text>
              <Text variant="caption" color={colors.text.secondary} style={styles.resetDialogBody}>
                This removes all wallets, the app password, fingerprint unlock, and local payment
                history from this device. You will need your recovery phrase or private key to
                restore a wallet.
              </Text>
            </View>
            <View style={styles.resetDialogActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.resetDialogButton,
                  styles.resetDialogSecondaryButton,
                  pressed ? styles.resetDialogButtonPressed : null,
                ]}
                onPress={handleCancelResetConfirm}
                disabled={resetting}
                accessibilityRole="button"
                accessibilityLabel="Cancel wallet reset"
              >
                <Text variant="buttonSmall" color={colors.text.primary} align="center">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.resetDialogButton,
                  styles.resetDialogDangerButton,
                  pressed ? styles.resetDialogButtonPressed : null,
                ]}
                onPress={() => void handleForgotPasswordReset()}
                disabled={resetting}
                accessibilityRole="button"
                accessibilityLabel="Reset wallet and return to onboarding"
              >
                <Text variant="buttonSmall" color={colors.text.inverse} align="center">
                  Reset wallet
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
    backgroundColor: colors.surface.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['3xl'],
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    maxWidth: 320,
  },
  subtitle: {
    maxWidth: 280,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: {
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dotFilled: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.glossAccent,
    boxShadow: '0 6px 14px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.82)',
  },
  dotEmpty: {
    backgroundColor: colors.surface.cardElevated,
    borderColor: colors.glass.rim,
  },
  keypad: {
    width: '100%',
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  keyLabel: {
    zIndex: 1,
    fontVariant: ['tabular-nums'],
  },
  forgotPasswordButton: {
    minHeight: layout.minTouchTarget,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  forgotPasswordButtonPressed: {
    backgroundColor: colors.surface.pressed,
  },
  forgotPasswordButtonDisabled: {
    opacity: 0.64,
  },
  forgotPasswordText: {
    lineHeight: 18,
  },
  toastSlot: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  toast: {
    borderRadius: radii.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '0 10px 22px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
  },
  resetDialogLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['3xl'],
  },
  resetDialogScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  resetDialogCard: {
    width: '100%',
    borderCurve: 'continuous',
    borderRadius: radii['2xl'],
    padding: spacing.xl,
    gap: spacing.xl,
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: '0 24px 54px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
  },
  resetDialogCopy: {
    gap: spacing.sm,
  },
  resetDialogTitle: {
    maxWidth: 260,
  },
  resetDialogBody: {
    lineHeight: 21,
  },
  resetDialogActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resetDialogButton: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resetDialogSecondaryButton: {
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  resetDialogDangerButton: {
    backgroundColor: colors.semantic.error,
  },
  resetDialogButtonPressed: {
    opacity: 0.78,
  },
});
