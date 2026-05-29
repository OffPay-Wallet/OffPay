import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import {
  getSecuritySettings,
  setPasscode,
  setWalletLocked,
  verifyPasscode,
} from '@/lib/wallet/security-settings';

type SecuritySetupIntent = 'create-wallet' | 'restore-wallet' | 'privy-wallet';
type PasscodeMode = 'create' | 'confirm' | 'unlockExisting';

interface PasscodeSetupScreenProps {
  intent: SecuritySetupIntent;
}

function nextRoute(intent: SecuritySetupIntent): void {
  router.push({
    pathname: '/security-setup/biometric',
    params: { intent },
  });
}

export function PasscodeSetupScreen({ intent }: PasscodeSetupScreenProps): React.JSX.Element {
  const { height, width } = useWindowDimensions();
  const compact = height < 760;
  const veryCompact = height < 690;
  const horizontalPadding = width < 360 ? spacing.xl : spacing['3xl'];
  const keypadMaxWidth = Math.min(336, Math.max(220, width - horizontalPadding * 2));
  const keypadGap = veryCompact ? spacing.sm : compact ? spacing.md : spacing.lg;
  const maxKeySize = veryCompact ? 52 : compact ? 60 : 66;
  const keypadHeightBudget = Math.max(220, height - (veryCompact ? 330 : compact ? 370 : 430));
  const keySize = Math.max(
    layout.minTouchTarget,
    Math.min(
      maxKeySize,
      Math.floor((keypadMaxWidth - keypadGap * 2) / 3),
      Math.floor((keypadHeightBudget - keypadGap * 3) / 4),
    ),
  );
  const keyInnerInset = Math.max(5, Math.round(keySize * 0.08));
  const keyPuffSize = Math.round(keySize * 0.58);
  const bodyOffsetY = veryCompact ? 0 : compact ? spacing.sm : spacing['2xl'];
  const titleFontSize = width < 360 || veryCompact ? 26 : width < 390 || compact ? 28 : 32;

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

  const setModeValue = useCallback((nextMode: PasscodeMode): void => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const setEntryValue = useCallback((nextEntry: string): void => {
    entryRef.current = nextEntry;
    setEntry(nextEntry);
  }, []);

  const setFirstPasscodeValue = useCallback((nextPasscode: string): void => {
    firstPasscodeRef.current = nextPasscode;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSecuritySettings()
      .then((settings) => {
        if (cancelled) return;
        if (!setupTouchedRef.current) {
          setEntryValue('');
          setFirstPasscodeValue('');
          setModeValue(settings.hasPasscode ? 'unlockExisting' : 'create');
        }

        setSettingsReady(true);
      })
      .catch((error: unknown) => {
        console.error('[PasscodeSetup] settings load failed:', error);
        if (cancelled) return;
        if (!setupTouchedRef.current) {
          setEntryValue('');
          setFirstPasscodeValue('');
          setModeValue('create');
        }

        setSettingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setEntryValue, setFirstPasscodeValue, setModeValue]);

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
      setFirstPasscodeValue('');
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
  }, [intent, processingEntry, saving, setEntryValue, setFirstPasscodeValue, setModeValue]);

  useEffect(() => {
    if (mode !== 'confirm') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });

    return () => {
      subscription.remove();
    };
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
            if (!ok) {
              setToast('Incorrect wallet password.');
              setEntryValue('');
              return;
            }
            nextRoute(intent);
          } catch {
            setToast('Could not verify wallet password.');
            setEntryValue('');
          } finally {
            setSaving(false);
          }
          return;
        }

        if (activeMode === 'create') {
          setFirstPasscodeValue(nextEntry);
          setEntryValue('');
          setModeValue('confirm');
          setToast(null);
          return;
        }

        if (nextEntry !== firstPasscodeRef.current) {
          setToast('Passwords did not match. Try again.');
          setFirstPasscodeValue('');
          setEntryValue('');
          setModeValue('create');
          return;
        }

        setSaving(true);
        try {
          await setPasscode(nextEntry);
          await setWalletLocked(false);
          nextRoute(intent);
        } catch (error: unknown) {
          console.error('[PasscodeSetup] save failed:', error);
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
    [intent, setEntryValue, setFirstPasscodeValue, setModeValue, settingsReady],
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

  const keypadRows = useMemo(
    () => [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['clear', '0', 'delete'],
    ],
    [],
  );

  const inputDisabled = !settingsReady || saving || processingEntry;

  function renderKey(key: string): React.JSX.Element {
    const keyFrameStyle = { width: keySize, height: keySize, borderRadius: keySize / 2 };
    const keyInnerLineStyle = {
      top: keyInnerInset,
      right: keyInnerInset,
      bottom: keyInnerInset,
      left: keyInnerInset,
      borderRadius: (keySize - keyInnerInset * 2) / 2,
    };
    const keyPuffStyle = {
      width: keyPuffSize,
      height: keyPuffSize,
      borderRadius: keyPuffSize / 2,
    };
    const innerGlass = (
      <>
        <View pointerEvents="none" style={[styles.keyPuff, keyPuffStyle]} />
        <View pointerEvents="none" style={[styles.keyInnerLine, keyInnerLineStyle]} />
      </>
    );

    if (key === 'clear') {
      return (
        <Pressable
          key={key}
          style={[styles.key, keyFrameStyle, entry.length === 0 ? styles.keyMuted : undefined]}
          onPress={handleClear}
          disabled={entry.length === 0 || inputDisabled}
          accessibilityRole="button"
          accessibilityLabel="Clear passcode"
        >
          {innerGlass}
          <Text
            variant="h2"
            color={colors.brand.azureCyan}
            align="center"
            style={styles.keyLabel}
            allowFontScaling={false}
          >
            x
          </Text>
        </Pressable>
      );
    }

    if (key === 'delete') {
      return (
        <Pressable
          key={key}
          style={[styles.key, keyFrameStyle, entry.length === 0 ? styles.keyMuted : undefined]}
          onPress={handleDelete}
          disabled={entry.length === 0 || inputDisabled}
          accessibilityRole="button"
          accessibilityLabel="Delete last digit"
        >
          {innerGlass}
          <Text
            variant="h2"
            color={colors.brand.azureCyan}
            align="center"
            style={styles.keyLabel}
            allowFontScaling={false}
          >
            {'<'}
          </Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        key={key}
        style={[styles.key, keyFrameStyle, inputDisabled ? styles.keyMuted : undefined]}
        onPress={() => handleDigit(key)}
        disabled={inputDisabled || entry.length >= 6}
        accessibilityRole="keyboardkey"
        accessibilityLabel={`Digit ${key}`}
      >
        {innerGlass}
        <Text
          variant="h2"
          color={colors.brand.azureCyan}
          align="center"
          style={styles.keyLabel}
          allowFontScaling={false}
        >
          {key}
        </Text>
      </Pressable>
    );
  }

  return (
    <CreateWalletScreenLayout
      header={<View />}
      center={
        <View style={[styles.centerBlock, { transform: [{ translateY: bodyOffsetY }] }]}>
          <View style={styles.copyBlock}>
            <Text
              variant="h1"
              color={colors.text.primary}
              align="center"
              style={[
                styles.title,
                { fontSize: titleFontSize, lineHeight: titleFontSize + spacing.sm },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {content.title}
            </Text>
            <Text
              variant="caption"
              color={colors.text.secondary}
              align="center"
              style={styles.subtitle}
            >
              {content.subtitle}
            </Text>
          </View>

          <View style={styles.dotRow} accessibilityLabel={`${entry.length} of 6 digits entered`}>
            {Array.from({ length: 6 }).map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index < entry.length ? styles.dotFilled : styles.dotEmpty]}
              />
            ))}
          </View>

          <View style={[styles.keypad, { maxWidth: keypadMaxWidth, gap: keypadGap }]}>
            {keypadRows.map((row, rowIndex) => (
              <View key={rowIndex} style={[styles.keyRow, { gap: keypadGap }]}>
                {row.map(renderKey)}
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
                <Text variant="small" color={colors.text.primary} align="center">
                  {toast}
                </Text>
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
  title: {},
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
  },
  dotFilled: {
    backgroundColor: colors.brand.azureCyan,
  },
  dotEmpty: {
    backgroundColor: colors.brand.whiteStream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  keypad: {
    width: '100%',
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  key: {
    position: 'relative',
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.whiteStream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  keyPuff: {
    // Kept as a non-painted spacer so keypad rendering math
    // (`keyPuffSize`) does not need to change. The previous
    // decorative fill + glow conflicted with the new flat
    // background, so we render an empty View at the same size.
    position: 'absolute',
    top: '21%',
    left: '21%',
    backgroundColor: 'transparent',
  },
  keyInnerLine: {
    // No-op holder. Same layout dimensions, no decoration.
    position: 'absolute',
    borderWidth: 0,
  },
  keyMuted: {
    opacity: 0.62,
  },
  keyLabel: {
    zIndex: 1,
    fontVariant: ['tabular-nums'],
  },
  footer: {},
  toastSlot: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  toast: {
    borderRadius: radii.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.glass.textBacking,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
});
