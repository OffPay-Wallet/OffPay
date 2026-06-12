import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  getCachedSecuritySettings,
  getSecuritySettings,
  preloadPasscodeMaterial,
  setWalletLocked,
  warmSecuritySettings,
} from '@/lib/wallet/security-settings';
import { clearSigningSeedCache } from '@/lib/wallet/signing-seed-cache';
import { getAppLockSuppressionRemainingMs } from '@/lib/wallet/app-lock-suppression';
import { useWalletStore } from '@/store/walletStore';

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

export interface AppLockState {
  checking: boolean;
  locked: boolean;
  hasPasscode: boolean;
  fingerprintEnabled: boolean;
}

export function useAppLockState(enabled: boolean): AppLockState {
  const hasStoredWallet = useWalletStore((state) => state.wallets.length > 0);
  const walletPublicKey = useWalletStore((state) => state.publicKey);
  const cachedSettings = getCachedSecuritySettings();

  const expectedInitialLock = enabled && hasStoredWallet && walletPublicKey == null;

  const [checking, setChecking] = useState(() => {
    if (cachedSettings != null) return false;
    if (expectedInitialLock) return false;
    return true;
  });
  const [locked, setLocked] = useState(() => {
    if (expectedInitialLock) return true;
    return false;
  });
  const [hasPasscode, setHasPasscode] = useState(() => {
    if (expectedInitialLock) return true;
    return cachedSettings?.hasPasscode === true;
  });
  const [fingerprintEnabled, setFingerprintEnabled] = useState(
    () => cachedSettings?.fingerprintEnabled === true,
  );

  const lockedRef = useRef(expectedInitialLock);
  const hasUnlockedThisSessionRef = useRef(false);
  const hasPasscodeRef = useRef(expectedInitialLock);
  const loadRequestIdRef = useRef(0);
  const lockMutationIdRef = useRef(0);
  const lockWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const backgroundLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    hasPasscodeRef.current = hasPasscode;
  }, [hasPasscode]);

  const setLockedState = useCallback((nextLocked: boolean): void => {
    lockedRef.current = nextLocked;
    setLocked(nextLocked);
  }, []);

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
          void writeWalletLocked(true);
        }
        useWalletStore.setState({ publicKey: null });
        clearSigningSeedCache('app-locked');
      }
    } catch {
      setLockedState(expectedInitialLock);
      setHasPasscode(expectedInitialLock);
    } finally {
      if (requestId === loadRequestIdRef.current && mutationId === lockMutationIdRef.current) {
        setChecking(false);
      }
    }
  }, [enabled, expectedInitialLock, setLockedState, writeWalletLocked]);

  useEffect(() => {
    void warmSecuritySettings();
    void loadLockState();
  }, [loadLockState]);

  const clearBackgroundLockTimer = useCallback((): void => {
    if (backgroundLockTimerRef.current == null) return;
    clearTimeout(backgroundLockTimerRef.current);
    backgroundLockTimerRef.current = null;
  }, []);

  const lockWalletForBackground = useCallback(async (): Promise<void> => {
    if (isAppActive() || lockedRef.current || getAppLockSuppressionRemainingMs() > 0) {
      return;
    }

    if (hasPasscodeRef.current) {
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
      getAppLockSuppressionRemainingMs() > 0 ||
      mutationId !== lockMutationIdRef.current
    ) {
      return;
    }

    setHasPasscode(true);
    setFingerprintEnabled(settings.fingerprintEnabled);
    hasUnlockedThisSessionRef.current = false;
    useWalletStore.setState({ publicKey: null });
    clearSigningSeedCache('app-background');
    setLockedState(true);
    setChecking(false);
    void writeWalletLocked(true);
  }, [setLockedState, writeWalletLocked]);

  const scheduleBackgroundLock = useCallback((): void => {
    const now = Date.now();
    const backgroundLockDelay = getAppLockSuppressionRemainingMs(now);

    if (backgroundLockDelay > 0) {
      clearBackgroundLockTimer();
      backgroundLockTimerRef.current = setTimeout(() => {
        backgroundLockTimerRef.current = null;
        void lockWalletForBackground();
      }, backgroundLockDelay + 32);
      return;
    }

    void lockWalletForBackground();
  }, [clearBackgroundLockTimer, lockWalletForBackground]);

  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        clearBackgroundLockTimer();
        void loadLockState();
      } else if (!lockedRef.current) {
        scheduleBackgroundLock();
      }
    });

    return () => {
      subscription.remove();
      clearBackgroundLockTimer();
    };
  }, [clearBackgroundLockTimer, enabled, loadLockState, scheduleBackgroundLock]);

  useEffect(() => {
    if (!enabled || (!locked && !checking) || !hasPasscode) return;
    void preloadPasscodeMaterial();
  }, [hasPasscode, enabled, locked, checking]);

  return {
    checking,
    locked,
    hasPasscode,
    fingerprintEnabled,
  };
}
