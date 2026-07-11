/**
 * SecuritySettingsModal — bottom-sheet modal for security settings.
 *
 * Orchestrator that composes:
 * - SecurityRootStep — fingerprint, passcode, wallet keys
 * - PasscodeStep — set/change passcode
 * - AuthGateStep — fingerprint/passcode gate
 * - WalletKeysStep — reveal mnemonic + private key
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import Animated from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import {
  SETTINGS_BACKDROP_ENTERING,
  SETTINGS_BACKDROP_EXITING,
  SETTINGS_BACK_ENTERING,
  SETTINGS_BACK_EXITING,
  SETTINGS_FORWARD_ENTERING,
  SETTINGS_FORWARD_EXITING,
  SETTINGS_SURFACE_ENTERING,
  SETTINGS_SURFACE_EXITING,
} from '@/components/ui/settings-motion';
import { PreferenceStepLayout } from '@/components/features/preferences/PreferenceStepLayout';
import { AuthGateStep } from '@/components/features/security/AuthGateStep';
import { PasscodeStep } from '@/components/features/security/PasscodeStep';
import { SecurityRootStep } from '@/components/features/security/SecurityRootStep';
import { WalletKeysStep } from '@/components/features/security/WalletKeysStep';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { authenticateWithBiometrics, getBiometricAvailability } from '@/lib/wallet/biometric-auth';
import {
  getSecuritySettings,
  setFingerprintEnabled,
  setPasscode,
  verifyPasscode,
} from '@/lib/wallet/security-settings';
import {
  getStoredWalletExportMaterial,
  getStoredWalletExportMaterialWithAuth,
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

const HEADER_TITLES: Record<Step, string> = {
  root: 'Security',
  passcode: 'App Passcode',
  walletKeys: 'Wallet Keys',
  revealGate: 'Wallet Keys',
};

const SHEET_SHADOW = '0 18px 36px rgba(0, 0, 0, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.14)';

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
  if (!visible) return null;

  return <SecuritySettingsSheet onClose={onClose} initialAction={initialAction} />;
}

type SecuritySettingsSheetProps = Omit<SecuritySettingsModalProps, 'visible'>;

function SecuritySettingsSheet({
  onClose,
  initialAction,
}: SecuritySettingsSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [step, setStep] = useState<Step>('root');
  const [stepDirection, setStepDirection] = useState<'forward' | 'back'>('forward');
  const [settingsBusy, setSettingsBusy] = useState(true);
  const [fingerprintEnabled, setFingerprintEnabledState] = useState(false);
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);
  const [editingPasscode, setEditingPasscode] = useState(false);
  const [passcodeBusy, setPasscodeBusy] = useState(false);
  const [revealBusy, setRevealBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [passcodeA, setPasscodeA] = useState('');
  const [passcodeB, setPasscodeB] = useState('');
  const [gatePasscode, setGatePasscode] = useState('');
  const [revealMnemonic, setRevealMnemonic] = useState<string | null>(null);
  const [revealPrivateKey, setRevealPrivateKey] = useState<string | null>(null);
  const [walletImportMethod, setWalletImportMethod] = useState<WalletImportMethod>('generated');
  const [visibleSecret, setVisibleSecret] = useState<VisibleSecret>(null);

  const compactViewport = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compactViewport ? spacing.lg : spacing['2xl'];
  const sheetMaxWidth = 430;
  const rowIconSize = dense ? 18 : 20;

  const activeRef = useRef(true);
  const fingerprintLockRef = useRef(false);
  const passcodeLockRef = useRef(false);
  const revealLockRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback((): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback((message: string): void => {
    if (!activeRef.current) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      if (activeRef.current) setToast(null);
    }, 2200);
  }, []);

  const navigateToStep = useCallback(
    (nextStep: Step, options: { clearToast?: boolean } = {}): void => {
      setStepDirection(nextStep === 'root' ? 'back' : 'forward');
      setStep(nextStep);
      if (nextStep === 'root') {
        setEditingPasscode(false);
        setPasscodeA('');
        setPasscodeB('');
      }
      if (options.clearToast ?? true) {
        clearToast();
      }
    },
    [clearToast],
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
        showToast('Set a passcode or enable fingerprint first');
      }
    },
    [navigateToStep, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    void (async () => {
      try {
        const snap = await getSecuritySettings();
        if (cancelled) return;
        setFingerprintEnabledState(snap.fingerprintEnabled);
        setHasPasscode(snap.hasPasscode);
        if (initialAction === 'exportKeys') {
          const authEnabled = snap.fingerprintEnabled || snap.hasPasscode;
          goWalletKeys(authEnabled);
        }
      } catch {
        // non-fatal for UI
      } finally {
        if (!cancelled) setSettingsBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      activeRef.current = false;
      fingerprintLockRef.current = false;
      passcodeLockRef.current = false;
      revealLockRef.current = false;
      clearTimers();
      void Clipboard.setStringAsync('');
    };
  }, [clearTimers, goWalletKeys, initialAction]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleClose = useCallback((): void => {
    onClose();
  }, [onClose]);

  const canReveal = !settingsBusy && (fingerprintEnabled || hasPasscode);

  const toggleFingerprint = useCallback(async (): Promise<void> => {
    if (settingsBusy || fingerprintLockRef.current) return;
    const next = !fingerprintEnabled;

    if (next && !hasPasscode) {
      showToast('Set an app passcode before enabling fingerprint');
      navigateToStep('passcode', { clearToast: false });
      return;
    }

    fingerprintLockRef.current = true;
    setFingerprintBusy(true);
    try {
      if (next) {
        const availability = await getBiometricAvailability();
        if (!availability.isAvailable) {
          showToast(availability.unavailableReason ?? 'Fingerprint unlock is not available');
          return;
        }

        const result = await authenticateWithBiometrics({
          promptMessage: 'Enable OffPay fingerprint unlock',
          promptSubtitle: 'Authenticate once to confirm this fingerprint.',
          promptDescription: 'OffPay keeps your passcode as backup.',
        });
        if (!result.success) {
          showToast(result.message ?? 'Fingerprint unlock failed');
          return;
        }
      }

      await setFingerprintEnabled(next);
      if (activeRef.current) setFingerprintEnabledState(next);
    } catch (error: unknown) {
      console.error('[SecuritySettings] fingerprint update failed:', error);
      showToast('Failed to update fingerprint setting');
    } finally {
      fingerprintLockRef.current = false;
      if (activeRef.current) setFingerprintBusy(false);
    }
  }, [fingerprintEnabled, hasPasscode, navigateToStep, settingsBusy, showToast]);

  const handleCopy = useCallback(
    async (value: string): Promise<void> => {
      try {
        await Clipboard.setStringAsync(value);
        if (!activeRef.current) return;

        showToast('Copied to clipboard');
        if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
        clipboardTimerRef.current = setTimeout(() => {
          clipboardTimerRef.current = null;
          if (activeRef.current) void Clipboard.setStringAsync('');
        }, CLIPBOARD_CLEAR_MS);
      } catch {
        showToast('Could not copy to clipboard');
      }
    },
    [showToast],
  );

  const handleExportSecrets = useCallback(
    async (payload: WalletSecretsExportPayload): Promise<void> => {
      const recoveryPhrase = payload.recoveryPhrase.trim();
      const privateKey = payload.privateKey.trim();

      if (recoveryPhrase.length === 0 || privateKey.length === 0) {
        showToast('Wallet secrets are not ready to export');
        return;
      }

      const fileName = createWalletSecretsFileName();
      const contents = formatWalletSecretsExport({ recoveryPhrase, privateKey });

      try {
        if (Platform.OS === 'web' && downloadTextFileOnWeb(fileName, contents)) {
          showToast('Export downloaded');
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
        showToast('Export file ready');
      } catch {
        showToast('Could not export wallet secrets');
      }
    },
    [showToast],
  );

  const revealWalletMaterial = useCallback(async (requireDeviceAuth: boolean): Promise<boolean> => {
    const material = requireDeviceAuth
      ? await getStoredWalletExportMaterialWithAuth()
      : await getStoredWalletExportMaterial();
    if (material == null) return false;

    const formattedMnemonic =
      material.mnemonic != null ? formatMnemonicWords(material.mnemonic) : '';
    const mnemonic = formattedMnemonic.length > 0 ? formattedMnemonic : null;
    const privateKey = material.privateKey?.trim() || null;
    const derived =
      mnemonic != null && privateKey == null
        ? await deriveSecretKeyBase58FromMnemonic(mnemonic)
        : null;

    if (!activeRef.current) return false;
    setWalletImportMethod(material.importMethod);
    setRevealMnemonic(mnemonic);
    setRevealPrivateKey(privateKey ?? derived);
    return true;
  }, []);

  const handleGateContinue = useCallback(async (): Promise<void> => {
    if (revealLockRef.current) return;
    if (hasPasscode && gatePasscode.length > 0) {
      if (!isValidPasscode(gatePasscode)) {
        showToast('Enter your 6-digit passcode');
        return;
      }
    }

    revealLockRef.current = true;
    setRevealBusy(true);
    try {
      if (hasPasscode && gatePasscode.length > 0) {
        const verified = await verifyPasscode(gatePasscode);
        if (!verified) {
          showToast('Incorrect passcode');
          if (activeRef.current) setGatePasscode('');
          return;
        }

        const revealed = await revealWalletMaterial(false);
        if (!revealed) {
          showToast('Wallet secrets are unavailable');
          return;
        }
        if (activeRef.current) navigateToStep('walletKeys');
        return;
      }

      if (fingerprintEnabled) {
        const revealed = await revealWalletMaterial(true);
        if (!revealed) {
          showToast('Authentication cancelled or failed');
          return;
        }
        if (activeRef.current) navigateToStep('walletKeys');
      }
    } catch (error: unknown) {
      console.error('[SecuritySettings] wallet reveal failed:', error);
      showToast('Could not reveal wallet secrets');
    } finally {
      revealLockRef.current = false;
      if (activeRef.current) setRevealBusy(false);
    }
  }, [
    fingerprintEnabled,
    gatePasscode,
    hasPasscode,
    navigateToStep,
    revealWalletMaterial,
    showToast,
  ]);

  const handleSetPasscode = useCallback(async (): Promise<void> => {
    if (passcodeLockRef.current) return;
    if (!isValidPasscode(passcodeA) || !isValidPasscode(passcodeB)) {
      showToast('Passcode must be 6 digits');
      return;
    }
    if (passcodeA !== passcodeB) {
      showToast('Passcodes do not match');
      return;
    }

    passcodeLockRef.current = true;
    setPasscodeBusy(true);
    try {
      await setPasscode(passcodeA);
      if (!activeRef.current) return;
      setHasPasscode(true);
      setPasscodeA('');
      setPasscodeB('');
      setEditingPasscode(false);
      showToast('Passcode set');
      navigateToStep('root', { clearToast: false });
    } catch (error: unknown) {
      console.error('[SecuritySettings] passcode save failed:', error);
      showToast('Failed to set passcode');
    } finally {
      passcodeLockRef.current = false;
      if (activeRef.current) setPasscodeBusy(false);
    }
  }, [navigateToStep, passcodeA, passcodeB, showToast]);

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;
  const compact = compactViewport;
  const maxSheetHeight = Math.max(
    240,
    windowHeight - insets.top - overlayPaddingBottom - spacing.lg,
  );
  const stepEntering =
    stepDirection === 'back' ? SETTINGS_BACK_ENTERING : SETTINGS_FORWARD_ENTERING;
  const stepExiting = stepDirection === 'back' ? SETTINGS_BACK_EXITING : SETTINGS_FORWARD_EXITING;
  const stepActionBusy = fingerprintBusy || passcodeBusy || revealBusy;

  const stepBody = (
    <>
      {step === 'root' ? (
        <View style={styles.rootMenu}>
          <SecurityRootStep
            fingerprintEnabled={fingerprintEnabled}
            fingerprintBusy={fingerprintBusy}
            loading={settingsBusy}
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
            busy={passcodeBusy}
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
            busy={revealBusy}
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
            onCopy={(value) => void handleCopy(value)}
            onExportSecrets={(payload) => void handleExportSecrets(payload)}
            onToast={showToast}
            compact={compact}
          />
        </PreferenceStepLayout>
      ) : null}
    </>
  );

  return (
    <View collapsable={false} style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
      {/* Backdrop */}
      <Animated.View
        entering={SETTINGS_BACKDROP_ENTERING}
        exiting={SETTINGS_BACKDROP_EXITING}
        style={StyleSheet.absoluteFill}
      >
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
          entering={SETTINGS_SURFACE_ENTERING}
          exiting={SETTINGS_SURFACE_EXITING}
          style={[
            styles.sheet,
            { width: '100%', maxWidth: sheetMaxWidth, maxHeight: maxSheetHeight },
          ]}
        >
          {/* Header */}
          <View style={[styles.headerRow, compact ? styles.headerRowCompact : undefined]}>
            <View style={styles.headerLeft}>
              {step !== 'root' ? (
                <Pressable
                  style={[
                    styles.headerIconBtn,
                    stepActionBusy ? styles.headerIconBtnDisabled : undefined,
                  ]}
                  onPress={() => {
                    navigateToStep('root');
                  }}
                  disabled={stepActionBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  accessibilityState={{ disabled: stepActionBusy, busy: stepActionBusy }}
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

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View
              key={step}
              entering={stepEntering}
              exiting={stepExiting}
              style={styles.stepContent}
            >
              {stepBody}
            </Animated.View>
          </ScrollView>

          {toast != null ? (
            <View style={styles.toastOverlay} pointerEvents="box-none">
              <Animated.View
                entering={SETTINGS_BACKDROP_ENTERING}
                exiting={SETTINGS_BACKDROP_EXITING}
                style={styles.toast}
              >
                <Text variant="small" color={colors.text.primary}>
                  {toast}
                </Text>
              </Animated.View>
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
  headerIconBtnDisabled: { opacity: 0.4 },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
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
