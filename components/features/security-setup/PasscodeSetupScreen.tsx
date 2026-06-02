import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CreateWalletScreenLayout } from '@/components/features/wallet-setup/CreateWalletScreenLayout';
import { GlassActionButton } from '@/components/ui/GlassActionButton';
import { Text } from '@/components/ui/Text';
import { WaterKeypadButton } from '@/components/ui/WaterKeypadButton';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import {
  getSecuritySettings,
  preloadPasscodeMaterial,
  setPasscode,
  setWalletLocked,
  verifyPasscode,
} from '@/lib/wallet/security-settings';
import { mark, measure } from '@/lib/perf/perf-marks';

type SecuritySetupIntent = 'create-wallet' | 'restore-wallet' | 'privy-wallet';
type PasscodeMode = 'create' | 'confirm' | 'unlockExisting';
type SetupKeyKind = 'digit' | 'clear' | 'delete';

const PASSCODE_SHAKE_SEGMENT_MS = 60;
const PASSCODE_SHAKE_DURATION_MS = PASSCODE_SHAKE_SEGMENT_MS * 7;
const PASSCODE_SHAKE_OFFSET = 12;

interface PasscodeSetupScreenProps {
  intent: SecuritySetupIntent;
}

interface SetupKeyButtonProps {
  kind: SetupKeyKind;
  label: string;
  disabled: boolean;
  muted?: boolean;
  frameStyle: ViewStyle;
  onPress: () => void;
}

const SetupKeyButton = memo(function SetupKeyButton({
  kind,
  label,
  disabled,
  muted,
  frameStyle,
  onPress,
}: SetupKeyButtonProps): React.JSX.Element {
  return (
    <WaterKeypadButton
      frameStyle={frameStyle}
      onPress={onPress}
      disabled={disabled}
      muted={muted}
      accessibilityRole={kind === 'digit' ? 'keyboardkey' : 'button'}
      accessibilityLabel={
        kind === 'clear'
          ? 'Clear passcode'
          : kind === 'delete'
            ? 'Delete last digit'
            : `Digit ${label}`
      }
    >
      <Text
        variant="h2"
        color={colors.text.primary}
        align="center"
        style={styles.keyLabel}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </WaterKeypadButton>
  );
});

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
  const keypadLayout = useMemo(() => {
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
    const keyFrameStyle = {
      width: keySize,
      height: keySize,
      borderRadius: keySize / 2,
    } as const;
    return { keypadMaxWidth, keypadGap, keyFrameStyle };
  }, [compact, height, horizontalPadding, veryCompact, width]);
  const { keypadMaxWidth, keypadGap, keyFrameStyle } = keypadLayout;
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

  // Shake animation for wrong passcode
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));
  const triggerShake = useCallback((): void => {
    shakeX.value = withSequence(
      withTiming(-PASSCODE_SHAKE_OFFSET, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
      withTiming(PASSCODE_SHAKE_OFFSET, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
      withTiming(-PASSCODE_SHAKE_OFFSET, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
      withTiming(PASSCODE_SHAKE_OFFSET, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
      withTiming(-PASSCODE_SHAKE_OFFSET * 0.5, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
      withTiming(PASSCODE_SHAKE_OFFSET * 0.5, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
      withTiming(0, { duration: PASSCODE_SHAKE_SEGMENT_MS }),
    );
  }, [shakeX]);

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
    if (!settingsReady || mode !== 'unlockExisting') return;
    void preloadPasscodeMaterial().catch(() => undefined);
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
            const verifyStartedAt = mark();
            const ok = await verifyPasscode(nextEntry);
            measure('passcode.setup.verifyExisting', verifyStartedAt, {
              cachedMaterialExpected: true,
            });
            if (!ok) {
              setToast('Incorrect wallet password.');
              triggerShake();
              setEntryValue('');
              return;
            }
            nextRoute(intent);
          } catch {
            setToast('Could not verify wallet password.');
            triggerShake();
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
          triggerShake();
          await new Promise<void>((resolve) => setTimeout(resolve, PASSCODE_SHAKE_DURATION_MS));
          setEntryValue('');
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
          triggerShake();
          setEntryValue('');
        } finally {
          setSaving(false);
        }
      } finally {
        completingEntryRef.current = false;
        setProcessingEntry(false);
      }
    },
    [intent, setEntryValue, setFirstPasscodeValue, setModeValue, settingsReady, triggerShake],
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

  const digitHandlers = useMemo<Record<string, () => void>>(() => {
    const out: Record<string, () => void> = {};
    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      out[digit] = () => handleDigit(digit);
    }
    return out;
  }, [handleDigit]);

  const renderKey = useCallback(
    (key: string): React.JSX.Element => {
      if (key === 'clear') {
        return (
          <SetupKeyButton
            key={key}
            kind="clear"
            label="x"
            frameStyle={keyFrameStyle}
            onPress={handleClear}
            disabled={entry.length === 0 || inputDisabled}
            muted={entry.length === 0}
          />
        );
      }

      if (key === 'delete') {
        return (
          <SetupKeyButton
            key={key}
            kind="delete"
            label="<"
            frameStyle={keyFrameStyle}
            onPress={handleDelete}
            disabled={entry.length === 0 || inputDisabled}
            muted={entry.length === 0}
          />
        );
      }

      return (
        <SetupKeyButton
          key={key}
          kind="digit"
          label={key}
          frameStyle={keyFrameStyle}
          onPress={digitHandlers[key]!}
          disabled={inputDisabled}
          muted={inputDisabled}
        />
      );
    },
    [digitHandlers, entry.length, handleClear, handleDelete, inputDisabled, keyFrameStyle],
  );

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

          <Animated.View
            style={[styles.dotRow, shakeStyle]}
            accessibilityLabel={`${entry.length} of 6 digits entered`}
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <View
                key={index}
                style={[styles.dot, index < entry.length ? styles.dotFilled : styles.dotEmpty]}
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
  footer: {},
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
});
