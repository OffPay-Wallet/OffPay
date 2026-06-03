/**
 * PasscodeStep — set or change a 6-digit passcode.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { WaterKeypadButton } from '@/components/ui/WaterKeypadButton';
import { PillButton } from '@/components/ui/PillButton';
import { Text } from '@/components/ui/Text';
import { PuffyRefreshIcon } from '@/components/ui/icons/PuffyRefreshIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface PasscodeStepProps {
  hasPasscode: boolean;
  passcodeA: string;
  passcodeB: string;
  onChangePasscodeA: (value: string) => void;
  onChangePasscodeB: (value: string) => void;
  onSetPasscode: () => void;
  onChangePasscodeFlow: () => void;
  compact?: boolean;
}

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'delete'],
] as const;

export function PasscodeStep({
  hasPasscode,
  passcodeA,
  passcodeB,
  onChangePasscodeA,
  onChangePasscodeB,
  onSetPasscode,
  onChangePasscodeFlow,
  compact = false,
}: PasscodeStepProps): React.JSX.Element {
  const activeField = passcodeA.length < 6 ? 'new' : 'confirm';
  const activeValue = activeField === 'new' ? passcodeA : passcodeB;
  const confirmComplete = passcodeB.length === 6;
  const confirmationMismatch = confirmComplete && passcodeA !== passcodeB;
  const hasAnyInput = passcodeA.length > 0 || passcodeB.length > 0;
  const canSave = passcodeA.length === 6 && passcodeB.length === 6 && passcodeA === passcodeB;
  const keypadGap = spacing.sm;
  const keySize = compact ? 38 : 40;

  const handleDigit = (digit: string): void => {
    if (activeField === 'new') {
      onChangePasscodeA(`${passcodeA}${digit}`.slice(0, 6));
      return;
    }
    onChangePasscodeB(`${confirmationMismatch ? '' : passcodeB}${digit}`.slice(0, 6));
  };

  const handleDelete = (): void => {
    if (activeField === 'confirm' && passcodeB.length > 0) {
      onChangePasscodeB(passcodeB.slice(0, -1));
      return;
    }
    if (passcodeA.length > 0) {
      onChangePasscodeA(passcodeA.slice(0, -1));
    }
  };

  const handleClear = (): void => {
    if (activeField === 'confirm' && passcodeB.length > 0) {
      onChangePasscodeB('');
      return;
    }
    onChangePasscodeA('');
  };

  const handleReset = (): void => {
    onChangePasscodeA('');
    onChangePasscodeB('');
  };

  const renderDots = (
    value: string,
    label: string,
    state: 'idle' | 'active' | 'error',
  ): React.JSX.Element => (
    <View
      style={[
        styles.dotInput,
        state === 'active' ? styles.dotInputActive : undefined,
        state === 'error' ? styles.dotInputError : undefined,
      ]}
      accessibilityLabel={`${label}, ${value.length} of 6 digits`}
    >
      <View style={styles.dotRow}>
        {Array.from({ length: 6 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              index < value.length ? styles.dotFilled : styles.dotEmpty,
              state === 'error' && index < value.length ? styles.dotError : undefined,
            ]}
          />
        ))}
      </View>
    </View>
  );

  const renderKey = (key: string): React.JSX.Element => {
    const isAction = key === 'clear' || key === 'delete';
    const disabled = key === 'clear' ? activeValue.length === 0 : false;
    const label = key === 'delete' ? '<' : key === 'clear' ? 'x' : key;
    const keyFrameStyle = { width: keySize, height: keySize, borderRadius: keySize / 2 };

    return (
      <WaterKeypadButton
        key={key}
        frameStyle={keyFrameStyle}
        onPress={() => {
          if (key === 'delete') {
            handleDelete();
            return;
          }
          if (key === 'clear') {
            handleClear();
            return;
          }
          handleDigit(key);
        }}
        disabled={disabled}
        muted={disabled}
        accessibilityRole="keyboardkey"
        accessibilityLabel={
          key === 'delete'
            ? 'Delete last digit'
            : key === 'clear'
              ? 'Clear passcode'
              : `Digit ${key}`
        }
      >
        <Text
          variant={isAction ? 'body' : 'h2'}
          color={colors.text.primary}
          align="center"
          style={styles.keyLabel}
          allowFontScaling={false}
        >
          {label}
        </Text>
      </WaterKeypadButton>
    );
  };

  if (hasPasscode) {
    return (
      <SettingsSectionCard>
        <View style={[styles.section, styles.summarySection, compact && styles.sectionCompact]}>
          <PillButton label="Change passcode" variant="primary" onPress={onChangePasscodeFlow} />
        </View>
      </SettingsSectionCard>
    );
  }

  return (
    <SettingsSectionCard>
      <View style={[styles.section, compact && styles.sectionCompact]}>
      <View style={styles.passcodeFields}>
        <View style={styles.inputGroup}>
          <View style={styles.inputLabelRow}>
            <Text
              variant="small"
              color={activeField === 'new' ? colors.text.secondary : colors.text.tertiary}
              style={styles.inputLabel}
            >
              New
            </Text>
            {activeField === 'new' ? (
              <Text variant="small" color={colors.brand.glossAccent} style={styles.activeHint}>
                Enter 6 digits
              </Text>
            ) : null}
          </View>
          {renderDots(passcodeA, 'New passcode', activeField === 'new' ? 'active' : 'idle')}
        </View>
        <View style={styles.inputGroup}>
          <View style={styles.inputLabelRow}>
            <Text
              variant="small"
              color={
                confirmationMismatch
                  ? colors.semantic.error
                  : activeField === 'confirm'
                    ? colors.text.secondary
                    : colors.text.tertiary
              }
              style={styles.inputLabel}
            >
              Confirm
            </Text>
            {activeField === 'confirm' ? (
              <Text
                variant="small"
                color={confirmationMismatch ? colors.semantic.error : colors.brand.glossAccent}
                style={styles.activeHint}
              >
                {confirmationMismatch ? 'Does not match' : 'Confirm now'}
              </Text>
            ) : null}
          </View>
          {renderDots(
            passcodeB,
            'Confirm passcode',
            confirmationMismatch ? 'error' : activeField === 'confirm' ? 'active' : 'idle',
          )}
        </View>
      </View>

      <View style={[styles.keypad, { gap: keypadGap }]}>
        {KEYPAD_ROWS.map((row, index) => (
          <View key={index} style={[styles.keyRow, { gap: keypadGap }]}>
            {row.map(renderKey)}
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        {hasAnyInput ? (
          <Pressable
            style={({ pressed }) => [styles.resetButton, pressed ? { opacity: 0.76 } : undefined]}
            onPress={handleReset}
            accessibilityRole="button"
            accessibilityLabel="Reset passcode entry"
            hitSlop={4}
          >
            <PuffyRefreshIcon
              size={compact ? 15 : 16}
              color={confirmationMismatch ? colors.semantic.error : colors.text.secondary}
            />
          </Pressable>
        ) : null}
        <View style={styles.saveButtonSlot}>
          <PillButton
            label="Save passcode"
            variant="primary"
            disabled={!canSave}
            onPress={onSetPasscode}
          />
        </View>
      </View>
      </View>
    </SettingsSectionCard>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minWidth: 0,
  },
  sectionCompact: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  summarySection: {
    justifyContent: 'center',
  },
  passcodeFields: {
    gap: spacing.xs,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  inputLabelRow: {
    minHeight: 17,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  inputLabel: {
    lineHeight: 14,
  },
  activeHint: {
    lineHeight: 14,
    textAlign: 'right',
    flexShrink: 1,
  },
  dotInput: {
    minHeight: 34,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  dotInputActive: {
    borderColor: colors.glass.accentVeil,
    backgroundColor: colors.surface.pressed,
  },
  dotInputError: {
    borderColor: 'rgba(255, 90, 110, 0.48)',
    backgroundColor: 'rgba(255, 77, 90, 0.12)',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dotFilled: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.glossAccent,
  },
  dotError: {
    backgroundColor: colors.semantic.error,
    borderColor: colors.semantic.error,
    boxShadow: '0 6px 14px rgba(0, 0, 0, 0.3)',
  },
  dotEmpty: {
    backgroundColor: colors.surface.cardElevated,
    borderColor: colors.glass.rimSubtle,
  },
  keypad: {
    alignSelf: 'center',
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  keyLabel: {
    fontFamily: fontFamily.uiSemiBold,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resetButton: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: colors.surface.backgroundTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  saveButtonSlot: {
    flex: 1,
    minWidth: 0,
  },
});
