import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { LightweightKeypadButton } from '@/components/ui/LightweightKeypadButton';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import { getPasscodeResponsiveLayout } from '@/lib/ui/passcode-responsive-layout';
import {
  getCachedSecuritySettings,
  getSecuritySettings,
  setPasscode,
  setWalletLocked,
  verifyPasscode,
  preloadPasscodeMaterial,
} from '@/lib/wallet/security-settings';

type SecuritySetupIntent = 'create-wallet' | 'restore-wallet' | 'privy-wallet';
type PasscodeMode = 'create' | 'confirm' | 'unlockExisting';

interface PasscodeSetupScreenProps {
  intent: SecuritySetupIntent;
}

function SimpleDot({ filled, size }: { filled: boolean; size: number }): React.JSX.Element {
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
}

function nextRoute(intent: SecuritySetupIntent): void {
  router.push({
    pathname: '/security-setup/biometric',
    params: { intent },
  });
}

export function PasscodeSetupScreen({ intent }: PasscodeSetupScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const cachedSettings = getCachedSecuritySettings();
  const passcodeLayout = useMemo(
    () =>
      getPasscodeResponsiveLayout({
        width,
        height,
        fontScale,
        topInset: insets.top,
        bottomInset: insets.bottom,
        footerReserve: layout.minTouchTarget * 2 + spacing['4xl'],
      }),
    [fontScale, height, insets.bottom, insets.top, width],
  );
  const keypadGap = passcodeLayout.keypadGap;

  const [mode, setMode] = useState<PasscodeMode>(() =>
    cachedSettings?.hasPasscode === true ? 'unlockExisting' : 'create',
  );
  const [entry, setEntry] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Accept keypad input immediately. The security-settings read is async
  // and, on a cold cache (e.g. first-launch onboarding), resolves a few
  // hundred ms after mount — long enough that an eager first tap would be
  // dropped, making the entry appear to reset. We no longer gate input on
  // it; the authoritative mode is resolved when an entry completes (see
  // handleCompletedEntry).
  const [settingsReady, setSettingsReady] = useState(true);
  const [processingEntry, setProcessingEntry] = useState(false);

  const modeRef = useRef<PasscodeMode>(
    cachedSettings?.hasPasscode === true ? 'unlockExisting' : 'create',
  );
  const entryRef = useRef('');
  const firstPasscodeRef = useRef('');
  const setupTouchedRef = useRef(false);
  const completingEntryRef = useRef(false);
  const initialSettingsAppliedRef = useRef(cachedSettings != null);

  const keyFrameStyle = useMemo(
    () => ({
      width: passcodeLayout.keySize,
      height: passcodeLayout.keySize,
      borderRadius: passcodeLayout.keySize / 2,
    }),
    [passcodeLayout.keySize],
  );
  const keyLabelStyle = useMemo(
    () => [styles.keyLabel, { fontSize: passcodeLayout.keyFontSize }],
    [passcodeLayout.keyFontSize],
  );

  const setModeValue = useCallback((nextMode: PasscodeMode): void => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const setEntryValue = useCallback((nextEntry: string): void => {
    entryRef.current = nextEntry;
    setEntry(nextEntry);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSecuritySettings()
      .then((settings) => {
        if (cancelled) return;
        if (
          !initialSettingsAppliedRef.current &&
          !setupTouchedRef.current &&
          entryRef.current.length === 0 &&
          firstPasscodeRef.current.length === 0
        ) {
          setModeValue(settings.hasPasscode ? 'unlockExisting' : 'create');
        }
        initialSettingsAppliedRef.current = true;
        setSettingsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        if (
          !initialSettingsAppliedRef.current &&
          !setupTouchedRef.current &&
          entryRef.current.length === 0 &&
          firstPasscodeRef.current.length === 0
        ) {
          setModeValue('create');
        }
        initialSettingsAppliedRef.current = true;
        setSettingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setEntryValue, setModeValue]);

  useEffect(() => {
    if (!settingsReady || mode !== 'unlockExisting') return;
    void preloadPasscodeMaterial();
  }, [mode, settingsReady]);

  useEffect(() => {
    if (toast == null) return;
    const timeout = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timeout);
  }, [toast]);

  const handleBack = useCallback((): void => {
    if (saving || processingEntry || completingEntryRef.current) return;

    if (modeRef.current === 'confirm') {
      completingEntryRef.current = false;
      setProcessingEntry(false);
      setModeValue('create');
      setEntryValue('');
      firstPasscodeRef.current = '';
      setToast(null);
      return;
    }

    if (intent === 'privy-wallet') {
      router.replace('/onboarding');
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/onboarding');
  }, [intent, processingEntry, saving, setEntryValue, setModeValue]);

  useEffect(() => {
    if (mode !== 'confirm') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });

    return () => subscription.remove();
  }, [handleBack, mode]);

  const handleCompletedEntry = useCallback(
    async (nextEntry: string): Promise<void> => {
      if (completingEntryRef.current) return;

      completingEntryRef.current = true;
      setProcessingEntry(true);

      try {
        // On a cold cache the async settings read may not have resolved by
        // the time all six digits are entered. Resolve the authoritative
        // mode now so we never mistake an existing passcode for a fresh
        // setup (or vice versa). Skipped once a confirm step is in flight.
        if (!initialSettingsAppliedRef.current && firstPasscodeRef.current.length === 0) {
          try {
            const settings = await getSecuritySettings();
            setModeValue(settings.hasPasscode ? 'unlockExisting' : 'create');
          } catch {
            setModeValue('create');
          } finally {
            initialSettingsAppliedRef.current = true;
            setSettingsReady(true);
          }
        }

        const activeMode = modeRef.current;

        if (activeMode === 'unlockExisting') {
          setSaving(true);
          try {
            const ok = await verifyPasscode(nextEntry);
            if (ok) {
              nextRoute(intent);
            } else {
              setToast('Incorrect wallet password.');
              setEntryValue('');
            }
          } catch {
            setToast('Could not verify wallet password.');
            setEntryValue('');
          } finally {
            setSaving(false);
          }
          return;
        }

        if (activeMode === 'create') {
          firstPasscodeRef.current = nextEntry;
          setEntryValue('');
          setModeValue('confirm');
          setToast(null);
          return;
        }

        if (nextEntry !== firstPasscodeRef.current) {
          setToast('Passwords did not match. Try again.');
          setEntryValue('');
          return;
        }

        setSaving(true);
        try {
          await setPasscode(nextEntry);
          await setWalletLocked(false);
          nextRoute(intent);
        } catch {
          setToast('Could not save the wallet password.');
          setEntryValue('');
        } finally {
          setSaving(false);
        }
      } finally {
        completingEntryRef.current = false;
        setProcessingEntry(false);
      }
    },
    [intent, setEntryValue, setModeValue],
  );

  const handleDigit = useCallback(
    (digit: string): void => {
      if (saving || processingEntry || completingEntryRef.current) return;
      const currentEntry = entryRef.current;
      if (currentEntry.length >= 6) return;

      setupTouchedRef.current = true;
      const nextEntry = `${currentEntry}${digit}`;
      setEntryValue(nextEntry);
      if (nextEntry.length === 6) {
        void handleCompletedEntry(nextEntry);
      }
    },
    [handleCompletedEntry, processingEntry, saving, setEntryValue],
  );

  const handleDelete = useCallback((): void => {
    if (saving || processingEntry || completingEntryRef.current) return;
    setupTouchedRef.current = true;
    setEntryValue(entryRef.current.slice(0, -1));
  }, [processingEntry, saving, setEntryValue]);

  const handleClear = useCallback((): void => {
    if (saving || processingEntry || completingEntryRef.current) return;
    setupTouchedRef.current = true;
    setEntryValue('');
  }, [processingEntry, saving, setEntryValue]);

  const content = useMemo(() => {
    if (mode === 'unlockExisting') {
      return {
        title: 'Enter wallet password',
        subtitle: 'Enter your 6-digit password to continue.',
      };
    }

    if (mode === 'confirm') {
      return {
        title: 'Confirm wallet password',
        subtitle: 'Enter it once more to finish setup.',
      };
    }

    return {
      title: 'Set app passcode',
      subtitle: 'Enter a 6-digit passcode to secure your app.',
    };
  }, [mode]);

  const keypadRows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['clear', '0', 'delete'],
  ];

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

  return (
    <CreateWalletScreenLayout
      header={<View />}
      center={
        <View
          style={[
            styles.centerBlock,
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
              {content.title}
            </RNText>
            <RNText style={[styles.subtitle, { fontSize: passcodeLayout.subtitleFontSize }]}>
              {content.subtitle}
            </RNText>
          </View>

          <View style={[styles.dotRow, { gap: passcodeLayout.dotGap }]}>
            <SimpleDot filled={entry.length > 0} size={passcodeLayout.dotSize} />
            <SimpleDot filled={entry.length > 1} size={passcodeLayout.dotSize} />
            <SimpleDot filled={entry.length > 2} size={passcodeLayout.dotSize} />
            <SimpleDot filled={entry.length > 3} size={passcodeLayout.dotSize} />
            <SimpleDot filled={entry.length > 4} size={passcodeLayout.dotSize} />
            <SimpleDot filled={entry.length > 5} size={passcodeLayout.dotSize} />
          </View>

          <View style={[styles.keypad, { gap: keypadGap }]}>
            {keypadRows.map((row, rowIndex) => (
              <View key={rowIndex} style={[styles.keyRow, { gap: keypadGap }]}>
                {row.map((key) => {
                  if (key === 'clear') {
                    return (
                      <LightweightKeypadButton
                        key={key}
                        frameStyle={keyFrameStyle}
                        onPress={handleClear}
                        disabled={entry.length === 0 || !settingsReady}
                        muted={entry.length === 0}
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
                        disabled={entry.length === 0 || !settingsReady}
                        muted={entry.length === 0}
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
                      disabled={!settingsReady}
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
        </View>
      }
      footer={
        <View style={styles.footer}>
          <View style={styles.toastSlot}>
            {toast != null ? (
              <View style={styles.toast}>
                <RNText style={styles.toastText}>{toast}</RNText>
              </View>
            ) : null}
          </View>
          <GlassActionButton
            label="Back"
            onPress={handleBack}
            variant="secondary"
            size="compact"
            disabled={saving || processingEntry}
            accessibilityLabel={mode === 'confirm' ? 'Back to passcode setup' : 'Back'}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  centerBlock: {
    width: '100%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['2xl'],
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.md,
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
  footer: {
    gap: spacing.md,
  },
  toastSlot: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
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
});
