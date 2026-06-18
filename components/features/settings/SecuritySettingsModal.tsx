/**
 * SecuritySettingsModal — bottom-sheet modal for security settings.
 *
 * Orchestrator that composes:
 * - SecurityRootStep — fingerprint, passcode, wallet keys
 * - PasscodeStep — set/change passcode
 * - AuthGateStep — fingerprint/passcode gate
 * - WalletKeysStep — reveal mnemonic + private key
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
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
import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { PreferenceStepLayout } from '@/components/features/preferences/PreferenceStepLayout';
import { AuthGateStep } from '@/components/features/security/AuthGateStep';
import { PasscodeStep } from '@/components/features/security/PasscodeStep';
import { SecurityRootStep } from '@/components/features/security/SecurityRootStep';
import { WalletKeysStep } from '@/components/features/security/WalletKeysStep';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';
import { authenticateWithBiometrics, getBiometricAvailability } from '@/lib/wallet/biometric-auth';
import {
  getSecuritySettings,
  setFingerprintEnabled,
  setPasscode,
  verifyPasscode,
} from '@/lib/wallet/security-settings';
import {
  getStoredMnemonicWithAuth,
  getStoredMnemonic,
  getStoredPrivateKey,
  getStoredPrivateKeyWithAuth,
  getStoredWalletInfo,
} from '@/lib/wallet/secure-wallet-store';
import { deriveSecretKeyBase58FromMnemonic } from '@/lib/wallet/wallet';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';

type Step = 'root' | 'passcode' | 'walletKeys' | 'revealGate';
type VisibleSecret = 'mnemonic' | 'privateKey' | null;

interface SecuritySettingsModalProps {
  visible: boolean;
  onClose: () => void;
  initialAction?: 'exportKeys';
}

const CLIPBOARD_CLEAR_MS = 60_000;

const SHEET_CHROME_PADDING = spacing.md;
const HEADER_FALLBACK_HEIGHT = layout.minTouchTarget + spacing.lg + spacing.xs;
const SHEET_MIN_HEIGHT = layout.buttonHeightLg * 2 + spacing['3xl'];
const STEP_CONTENT_ESTIMATES: Record<Step, number> = {
  root: 240,
  passcode: 500,
  revealGate: 440,
  walletKeys: 420,
};

const HEADER_TITLES: Record<Step, string> = {
  root: 'Security',
  passcode: 'App Passcode',
  walletKeys: 'Wallet Keys',
  revealGate: 'Wallet Keys',
};

const SHEET_SHADOW = '0 18px 36px rgba(0, 0, 0, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const NAV_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) } as const;
const SHEET_SIZE_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) } as const;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function isValidPasscode(passcode: string): boolean {
  return /^\d{6}$/.test(passcode);
}

function formatMnemonicWords(mnemonic: string): string {
  return mnemonic
    .trim()
    .split(/\s+/g)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .join(' ');
}

interface WalletSecretsExportPayload {
  recoveryPhrase: string;
  privateKey: string;
}

type WebDownloadGlobals = {
  Blob?: new (parts: string[], options?: { type?: string }) => unknown;
  URL?: {
    createObjectURL: (blob: unknown) => string;
    revokeObjectURL: (url: string) => void;
  };
  document?: {
    createElement: (tagName: string) => {
      href: string;
      download: string;
      style: { display: string };
      click: () => void;
    };
    body?: {
      appendChild: (node: unknown) => void;
      removeChild: (node: unknown) => void;
    };
  };
};

function createWalletSecretsFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `offpay-wallet-secrets-${stamp}.txt`;
}

function formatWalletSecretsExport({
  recoveryPhrase,
  privateKey,
}: WalletSecretsExportPayload): string {
  return [
    'OffPay Wallet Secrets',
    `Exported: ${new Date().toISOString()}`,
    '',
    'WARNING: Anyone with these secrets can control this wallet.',
    'Store this file offline and delete it when finished.',
    '',
    'Recovery phrase:',
    recoveryPhrase,
    '',
    'Private key:',
    privateKey,
    '',
  ].join('\n');
}

function downloadTextFileOnWeb(fileName: string, contents: string): boolean {
  const web = globalThis as unknown as WebDownloadGlobals;
  if (web.Blob == null || web.URL == null || web.document == null) return false;

  const blob = new web.Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = web.URL.createObjectURL(blob);
  const link = web.document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  web.document.body?.appendChild(link);
  link.click();
  web.document.body?.removeChild(link);
  web.URL.revokeObjectURL(url);
  return true;
}

function writeWalletSecretsTextFile(fileName: string, contents: string): string {
  const exportDirectory = new Directory(Paths.document, 'offpay-exports');
  if (!exportDirectory.exists) {
    exportDirectory.create({ idempotent: true, intermediates: true });
  }

  const file = new File(exportDirectory, fileName);
  if (!file.exists) {
    file.create({ intermediates: true });
  }
  file.write(contents);
  return file.uri;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SecuritySettingsModal({
  visible,
  onClose,
  initialAction,
}: SecuritySettingsModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const [step, setStep] = useState<Step>('root');
  const [fingerprintEnabled, setFingerprintEnabledState] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);
  const [editingPasscode, setEditingPasscode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [passcodeA, setPasscodeA] = useState('');
  const [passcodeB, setPasscodeB] = useState('');
  const [gatePasscode, setGatePasscode] = useState('');
  const [revealMnemonic, setRevealMnemonic] = useState<string | null>(null);
  const [revealPrivateKey, setRevealPrivateKey] = useState<string | null>(null);
  const [walletImportMethod, setWalletImportMethod] = useState<WalletImportMethod>('generated');
  const [visibleSecret, setVisibleSecret] = useState<VisibleSecret>(null);
  const [headerHeight, setHeaderHeight] = useState(HEADER_FALLBACK_HEIGHT);
  const [contentHeight, setContentHeight] = useState(0);

  const compactViewport = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compactViewport ? spacing.lg : spacing['2xl'];
  const sheetMaxWidth = 430;
  const rowIconSize = dense ? 18 : 20;

  const translateY = useSharedValue(windowHeight);
  const opacity = useSharedValue(0);
  const animatedSheetHeight = useSharedValue(layout.buttonHeightLg * 4 + spacing['3xl']);
  const contentProgress = useSharedValue(1);
  const contentDirection = useSharedValue(1);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateToStep = useCallback(
    (nextStep: Step, options: { clearToast?: boolean } = {}): void => {
      contentDirection.value = nextStep === 'root' ? -1 : 1;
      contentProgress.value = 0;
      setContentHeight(0);
      setStep(nextStep);
      if (nextStep === 'root') {
        setEditingPasscode(false);
        setPasscodeA('');
        setPasscodeB('');
      }
      if (options.clearToast ?? true) {
        setToast(null);
      }
      requestAnimationFrame(() => {
        contentProgress.value = withTiming(1, NAV_TIMING);
      });
    },
    [contentDirection, contentProgress],
  );

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  const clearTimers = useCallback((): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
    toastTimerRef.current = null;
    clipboardTimerRef.current = null;
  }, []);

  const goWalletKeys = useCallback(
    (authEnabled: boolean): void => {
      setRevealMnemonic(null);
      setRevealPrivateKey(null);
      setGatePasscode('');
      setVisibleSecret(null);
      if (authEnabled) {
        navigateToStep('revealGate');
      } else {
        setToast('Set a passcode or enable fingerprint first');
      }
    },
    [navigateToStep],
  );

  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    void (async () => {
      try {
        const snap = await getSecuritySettings();
        setFingerprintEnabledState(snap.fingerprintEnabled);
        setHasPasscode(snap.hasPasscode);
        const info = await getStoredWalletInfo();
        if (!cancelled) {
          setWalletImportMethod(info?.importMethod ?? 'generated');
          if (initialAction === 'exportKeys') {
            const authEnabled = snap.fingerprintEnabled || snap.hasPasscode;
            goWalletKeys(authEnabled);
          }
        }
      } catch {
        // non-fatal for UI
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, initialAction, goWalletKeys]);

  useEffect(() => {
    return () => {
      clearTimers();
      void Clipboard.setStringAsync('');
    };
  }, [clearTimers]);

  // Animation
  useEffect(() => {
    const startedAt = markAnimationPerf();
    if (visible) {
      setContentHeight(0);
      setMounted(true);
      opacity.value = withTiming(1, { duration: 220 });
      translateY.value = withTiming(
        0,
        {
          duration: 320,
          easing: Easing.out(Easing.poly(4)),
        },
        (finished) => {
          runOnJS(finishAnimationPerf)('settings.securityModal', startedAt, finished, {
            phase: 'open',
          });
        },
      );
    } else {
      translateY.value = withTiming(
        windowHeight,
        {
          duration: 220,
          easing: Easing.in(Easing.ease),
        },
        (finished) => {
          runOnJS(finishAnimationPerf)('settings.securityModal', startedAt, finished, {
            phase: 'close',
          });
        },
      );
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      setStep('root');
      setToast(null);
      setPasscodeA('');
      setPasscodeB('');
      setEditingPasscode(false);
      setGatePasscode('');
      setRevealMnemonic(null);
      setRevealPrivateKey(null);
      setVisibleSecret(null);
    }
  }, [opacity, translateY, visible, windowHeight]);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast == null) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    };
  }, [toast]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    height: animatedSheetHeight.value,
    transform: [{ translateY: translateY.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 0.74 + contentProgress.value * 0.26,
    transform: [
      {
        translateX: (1 - contentProgress.value) * contentDirection.value * (dense ? 8 : 14),
      },
    ],
  }));

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleClose = useCallback((): void => {
    const startedAt = markAnimationPerf();
    translateY.value = withTiming(
      windowHeight,
      { duration: 220, easing: Easing.in(Easing.ease) },
      (finished) => {
        runOnJS(finishAnimationPerf)('settings.securityModal', startedAt, finished, {
          phase: 'manualClose',
        });
        runOnJS(onClose)();
      },
    );
    opacity.value = withTiming(0, { duration: 220 });
  }, [onClose, opacity, translateY, windowHeight]);

  const canReveal = useMemo(
    () => fingerprintEnabled || hasPasscode,
    [fingerprintEnabled, hasPasscode],
  );

  const toggleFingerprint = useCallback(async (): Promise<void> => {
    const next = !fingerprintEnabled;
    if (!next) {
      setFingerprintEnabledState(false);
      try {
        await setFingerprintEnabled(false);
      } catch (error: unknown) {
        console.error('[SecuritySettings] fingerprint disable failed:', error);
        setFingerprintEnabledState(true);
        setToast('Failed to update fingerprint setting');
      }
      return;
    }

    try {
      if (!hasPasscode) {
        setToast('Set an app passcode before enabling fingerprint');
        navigateToStep('passcode', { clearToast: false });
        return;
      }

      const availability = await getBiometricAvailability();
      if (!availability.isAvailable) {
        setToast(availability.unavailableReason ?? 'Fingerprint unlock is not available');
        return;
      }

      const result = await authenticateWithBiometrics({
        promptMessage: 'Enable OffPay fingerprint unlock',
        promptSubtitle: 'Authenticate once to confirm this fingerprint.',
        promptDescription: 'OffPay keeps your passcode as backup.',
      });
      if (!result.success) {
        setToast(result.message ?? 'Fingerprint unlock failed');
        return;
      }

      setFingerprintEnabledState(true);
      await setFingerprintEnabled(true);
    } catch (error: unknown) {
      console.error('[SecuritySettings] fingerprint enable failed:', error);
      setToast('Failed to update fingerprint setting');
    }
  }, [fingerprintEnabled, hasPasscode, navigateToStep]);

  const handleCopy = useCallback((value: string): void => {
    void Clipboard.setStringAsync(value);
    setToast('Copied to clipboard');
    if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => {
      void Clipboard.setStringAsync('');
    }, CLIPBOARD_CLEAR_MS);
  }, []);

  const handleExportSecrets = useCallback(
    async (payload: WalletSecretsExportPayload): Promise<void> => {
      const recoveryPhrase = payload.recoveryPhrase.trim();
      const privateKey = payload.privateKey.trim();

      if (recoveryPhrase.length === 0 || privateKey.length === 0) {
        setToast('Wallet secrets are not ready to export');
        return;
      }

      const fileName = createWalletSecretsFileName();
      const contents = formatWalletSecretsExport({ recoveryPhrase, privateKey });

      try {
        if (Platform.OS === 'web' && downloadTextFileOnWeb(fileName, contents)) {
          setToast('Export downloaded');
          return;
        }

        const fileUri = writeWalletSecretsTextFile(fileName, contents);
        await Share.share(
          {
            title: 'OffPay wallet secrets',
            url: fileUri,
            message: 'OffPay wallet secrets export',
          },
          { dialogTitle: 'Export wallet secrets' },
        );
        setToast('Export file ready');
      } catch {
        setToast('Could not export wallet secrets');
      }
    },
    [],
  );

  const revealWithDeviceAuth = useCallback(async (): Promise<boolean> => {
    try {
      const [mn, pk] = await Promise.all([
        getStoredMnemonicWithAuth(),
        getStoredPrivateKeyWithAuth(),
      ]);
      const mnemonic = mn != null ? formatMnemonicWords(mn) : null;
      const privateKey = pk != null ? pk.trim() : null;
      const derived =
        mnemonic != null && (privateKey == null || privateKey.length === 0)
          ? await deriveSecretKeyBase58FromMnemonic(mnemonic)
          : null;
      setRevealMnemonic(mnemonic);
      setRevealPrivateKey(privateKey ?? derived);
      return true;
    } catch {
      return false;
    }
  }, []);

  const revealWithPasscode = useCallback(async (): Promise<boolean> => {
    const ok = await verifyPasscode(gatePasscode);
    if (!ok) {
      setToast('Incorrect passcode');
      return false;
    }
    const [mn, pk] = await Promise.all([getStoredMnemonic(), getStoredPrivateKey()]);
    const mnemonic = mn != null ? formatMnemonicWords(mn) : null;
    const privateKey = pk != null ? pk.trim() : null;
    const derived =
      mnemonic != null && (privateKey == null || privateKey.length === 0)
        ? await deriveSecretKeyBase58FromMnemonic(mnemonic)
        : null;
    setRevealMnemonic(mnemonic);
    setRevealPrivateKey(privateKey ?? derived);
    return true;
  }, [gatePasscode]);

  const handleGateContinue = useCallback(async (): Promise<void> => {
    if (hasPasscode && gatePasscode.length > 0) {
      if (!isValidPasscode(gatePasscode)) {
        setToast('Enter your 6-digit passcode');
        return;
      }
      const ok = await revealWithPasscode();
      if (ok) {
        try {
          const info = await getStoredWalletInfo();
          if (info) setWalletImportMethod(info.importMethod);
        } catch {
          /* non-fatal */
        }
        navigateToStep('walletKeys');
      }
      if (!ok) {
        setGatePasscode('');
      }
      return;
    }

    if (fingerprintEnabled) {
      const ok = await revealWithDeviceAuth();
      if (!ok) {
        setToast('Authentication cancelled or failed');
        return;
      }
      try {
        const info = await getStoredWalletInfo();
        if (info) setWalletImportMethod(info.importMethod);
      } catch {
        /* non-fatal */
      }
      navigateToStep('walletKeys');
      return;
    }
    if (!hasPasscode) return;
  }, [
    fingerprintEnabled,
    gatePasscode,
    hasPasscode,
    navigateToStep,
    revealWithDeviceAuth,
    revealWithPasscode,
  ]);

  const handleSetPasscode = useCallback(async (): Promise<void> => {
    if (!isValidPasscode(passcodeA) || !isValidPasscode(passcodeB)) {
      setToast('Passcode must be 6 digits');
      return;
    }
    if (passcodeA !== passcodeB) {
      setToast('Passcodes do not match');
      return;
    }
    try {
      await setPasscode(passcodeA);
      setHasPasscode(true);
      setPasscodeA('');
      setPasscodeB('');
      setEditingPasscode(false);
      setToast('Passcode set');
      navigateToStep('root', { clearToast: false });
    } catch (error: unknown) {
      console.error('[SecuritySettings] passcode save failed:', error);
      setToast('Failed to set passcode');
    }
  }, [navigateToStep, passcodeA, passcodeB]);

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;
  const compact = compactViewport;
  const maxSheetHeight = windowHeight - insets.top - overlayPaddingBottom - spacing.lg;
  const resolvedHeaderHeight = headerHeight > 0 ? headerHeight : HEADER_FALLBACK_HEIGHT;
  const bodyMaxHeight = Math.max(120, maxSheetHeight - resolvedHeaderHeight - SHEET_CHROME_PADDING);
  const scrollOverflows = contentHeight > bodyMaxHeight;
  const sheetHeight = useMemo(() => {
    const chromeHeight = resolvedHeaderHeight + SHEET_CHROME_PADDING;

    if (contentHeight <= 0) {
      return Math.min(maxSheetHeight, chromeHeight + STEP_CONTENT_ESTIMATES[step]);
    }

    if (scrollOverflows) {
      return maxSheetHeight;
    }

    return Math.min(maxSheetHeight, Math.max(SHEET_MIN_HEIGHT, chromeHeight + contentHeight));
  }, [contentHeight, maxSheetHeight, resolvedHeaderHeight, scrollOverflows, step]);

  useEffect(() => {
    animatedSheetHeight.value = withTiming(sheetHeight, SHEET_SIZE_TIMING);
  }, [animatedSheetHeight, sheetHeight]);

  const handleHeaderLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const handleContentLayout = useCallback((event: LayoutChangeEvent): void => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setContentHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const stepBody = (
    <>
      {step === 'root' ? (
        <View style={styles.rootMenu}>
          <SecurityRootStep
            fingerprintEnabled={fingerprintEnabled}
            hasPasscode={hasPasscode}
            canReveal={canReveal}
            compact={compact}
            dense={dense}
            iconSize={rowIconSize}
            onToggleFingerprint={() => void toggleFingerprint()}
            onGoPasscode={() => navigateToStep('passcode')}
            onGoWalletKeys={() => goWalletKeys(canReveal)}
          />
        </View>
      ) : null}

      {step === 'passcode' ? (
        <PreferenceStepLayout>
          <PasscodeStep
            hasPasscode={hasPasscode && !editingPasscode}
            passcodeA={passcodeA}
            passcodeB={passcodeB}
            onChangePasscodeA={setPasscodeA}
            onChangePasscodeB={setPasscodeB}
            onSetPasscode={() => void handleSetPasscode()}
            onChangePasscodeFlow={() => {
              setPasscodeA('');
              setPasscodeB('');
              setEditingPasscode(true);
            }}
            compact={compact}
          />
        </PreferenceStepLayout>
      ) : null}

      {step === 'revealGate' ? (
        <PreferenceStepLayout>
          <AuthGateStep
            buttonLabel={fingerprintEnabled ? 'Continue with fingerprint' : 'Continue'}
            fingerprintEnabled={fingerprintEnabled}
            hasPasscode={hasPasscode}
            gatePasscode={gatePasscode}
            onChangeGatePasscode={setGatePasscode}
            onContinue={() => void handleGateContinue()}
            compact={compact}
          />
        </PreferenceStepLayout>
      ) : null}

      {step === 'walletKeys' ? (
        <PreferenceStepLayout>
          <WalletKeysStep
            walletImportMethod={walletImportMethod}
            revealMnemonic={revealMnemonic}
            revealPrivateKey={revealPrivateKey}
            visibleSecret={visibleSecret}
            onToggleVisibleSecret={setVisibleSecret}
            onCopy={handleCopy}
            onExportSecrets={(payload) => void handleExportSecrets(payload)}
            onToast={setToast}
            compact={compact}
          />
        </PreferenceStepLayout>
      ) : null}
    </>
  );

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim />
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      {/* Sheet */}
      <View
        style={[
          styles.overlay,
          { paddingBottom: overlayPaddingBottom, paddingHorizontal: horizontalPadding },
        ]}
      >
        <Animated.View
          style={[styles.sheet, { width: '100%', maxWidth: sheetMaxWidth }, sheetStyle]}
        >
          {/* Header */}
          <View
            style={[styles.headerRow, compact ? styles.headerRowCompact : undefined]}
            onLayout={handleHeaderLayout}
          >
            <View style={styles.headerLeft}>
              {step !== 'root' ? (
                <Pressable
                  style={styles.headerIconBtn}
                  onPress={() => {
                    navigateToStep('root');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  hitSlop={6}
                >
                  <Ionicons
                    name="chevron-back"
                    size={layout.iconSizeNav}
                    color={colors.text.primary}
                  />
                </Pressable>
              ) : (
                <View style={styles.headerIconPlaceholder} />
              )}
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
              {HEADER_TITLES[step]}
            </Text>
            <View style={styles.headerRight}>
              <Pressable
                style={styles.headerIconBtn}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={6}
              >
                <Ionicons
                  name="close"
                  size={layout.iconSizeInline}
                  color={colors.brand.glossAccent}
                />
              </Pressable>
            </View>
          </View>

          {scrollOverflows ? (
            <ScrollView
              style={[styles.bodyScroll, { maxHeight: bodyMaxHeight }]}
              contentContainerStyle={styles.bodyContent}
              contentInsetAdjustmentBehavior="automatic"
              showsVerticalScrollIndicator={false}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={(_width, height) => {
                const nextHeight = Math.ceil(height);
                setContentHeight((current) => (current === nextHeight ? current : nextHeight));
              }}
            >
              <Animated.View style={[styles.stepContent, contentStyle]}>{stepBody}</Animated.View>
            </ScrollView>
          ) : (
            <View style={styles.bodyStatic} onLayout={handleContentLayout}>
              <Animated.View style={[styles.stepContent, contentStyle]}>{stepBody}</Animated.View>
            </View>
          )}

          {toast != null ? (
            <View style={styles.toastOverlay} pointerEvents="box-none">
              <View style={styles.toast}>
                <Text variant="small" color={colors.text.primary}>
                  {toast}
                </Text>
              </View>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles (modal shell only — step styles live in sub-components)
// ---------------------------------------------------------------------------

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
    paddingBottom: spacing.xs,
  },
  headerRowCompact: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  headerLeft: { width: layout.minTouchTarget },
  headerRight: { width: layout.minTouchTarget, alignItems: 'flex-end' },
  headerTitle: { textAlign: 'center', flex: 1, minWidth: 0 },
  headerTitleCompact: {
    fontSize: 23,
    lineHeight: 30,
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
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
  },
  headerIconPlaceholder: { width: layout.minTouchTarget, height: layout.minTouchTarget },
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
  },
  stepContent: {
    minWidth: 0,
  },
  rootMenu: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  toastOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  toast: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.surface.cardElevated,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
});
