import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { LightweightKeypadButton } from '@/components/ui/LightweightKeypadButton';
import { colors } from '@/constants/colors';
import { layout, spacing } from '@/constants/spacing';
import {
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

function SimpleDot({ filled }: { filled: boolean }): React.JSX.Element {
  return <View style={[styles.dot, filled ? styles.dotFilled : styles.dotEmpty]} />;
}

function nextRoute(intent: SecuritySetupIntent): void {
  router.push({
    pathname: '/security-setup/biometric',
    params: { intent },
  });
}

export function PasscodeSetupScreen({ intent }: PasscodeSetupScreenProps): React.JSX.Element {
  const { width, height } = useWindowDimensions();

  const [mode, setMode] = useState<PasscodeMode>('create');
  const [entry, setEntry] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [processingEntry, setProcessingEntry] = useState(false);

  const modeRef = useRef<PasscodeMode>('create');
  const entryRef = useRef('');
  const firstPasscodeRef = useRef('');
  const setupTouchedRef = useRef(false);
  const completingEntryRef = useRef(false);

  const keySize = useMemo(() => {
    const maxWidth = Math.min(336, Math.max(220, width - spacing['3xl'] * 2));
    const gap = spacing.lg;
    const budget = Math.max(220, height - 430);
    return Math.max(
      layout.minTouchTarget,
      Math.min(66, Math.floor((maxWidth - gap * 2) / 3), Math.floor((budget - gap * 3) / 4)),
    );
  }, [width, height]);

  const keyFrameStyle = useMemo(
    () => ({
      width: keySize,
      height: keySize,
      borderRadius: keySize / 2,
    }),
    [keySize],
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
        if (!setupTouchedRef.current) {
          setEntryValue('');
          firstPasscodeRef.current = '';
          setModeValue(settings.hasPasscode ? 'unlockExisting' : 'create');
        }
        setSettingsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        if (!setupTouchedRef.current) {
          setEntryValue('');
          firstPasscodeRef.current = '';
          setModeValue('create');
        }
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
      if (!settingsReady || completingEntryRef.current) return;

      completingEntryRef.current = true;
      setProcessingEntry(true);

      try {
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
    [intent, setEntryValue, setModeValue, settingsReady],
  );

  const handleDigit = useCallback(
    (digit: string): void => {
      if (!settingsReady || saving || processingEntry || completingEntryRef.current) return;
      const currentEntry = entryRef.current;
      if (currentEntry.length >= 6) return;

      setupTouchedRef.current = true;
      const nextEntry = `${currentEntry}${digit}`;
      setEntryValue(nextEntry);
      if (nextEntry.length === 6) {
        void handleCompletedEntry(nextEntry);
      }
    },
    [handleCompletedEntry, processingEntry, saving, setEntryValue, settingsReady],
  );

  const handleDelete = useCallback((): void => {
    if (!settingsReady || saving || processingEntry || completingEntryRef.current) return;
    setupTouchedRef.current = true;
    setEntryValue(entryRef.current.slice(0, -1));
  }, [processingEntry, saving, setEntryValue, settingsReady]);

  const handleClear = useCallback((): void => {
    if (!settingsReady || saving || processingEntry || completingEntryRef.current) return;
    setupTouchedRef.current = true;
    setEntryValue('');
  }, [processingEntry, saving, setEntryValue, settingsReady]);

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
        <View style={styles.centerBlock}>
          <View style={styles.copyBlock}>
            <RNText
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {content.title}
            </RNText>
            <RNText style={styles.subtitle}>{content.subtitle}</RNText>
          </View>

          <View style={styles.dotRow}>
            <SimpleDot filled={entry.length > 0} />
            <SimpleDot filled={entry.length > 1} />
            <SimpleDot filled={entry.length > 2} />
            <SimpleDot filled={entry.length > 3} />
            <SimpleDot filled={entry.length > 4} />
            <SimpleDot filled={entry.length > 5} />
          </View>

          <View style={styles.keypad}>
            {keypadRows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.keyRow}>
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
                        <RNText style={styles.keyLabel}>x</RNText>
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
                        <RNText style={styles.keyLabel}>{'<'}</RNText>
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
                      <RNText style={styles.keyLabel}>{key}</RNText>
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['2xl'],
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    fontSize: 32,
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
    gap: spacing.md,
  },
  dot: {
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: spacing.xl / 2,
  },
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
