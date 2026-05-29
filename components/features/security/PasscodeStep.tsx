/**
 * PasscodeStep — set or change a 6-digit passcode.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

    return (
      <Pressable
        key={key}
        style={({ pressed }) => [
          styles.key,
          isAction ? styles.keyAction : undefined,
          disabled ? styles.keyDisabled : undefined,
          pressed && !disabled ? styles.keyPressed : undefined,
          { width: keySize, height: keySize, borderRadius: keySize / 2 },
        ]}
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
          color={colors.brand.azureCyan}
          align="center"
          style={styles.keyLabel}
          allowFontScaling={false}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  if (hasPasscode) {
    return (
      <View style={[styles.block, styles.summaryBlock, compact ? styles.blockCompact : undefined]}>
        <PillButton label="Change passcode" variant="primary" onPress={onChangePasscodeFlow} />
      </View>
    );
  }

  return (
    <View style={[styles.block, compact ? styles.blockCompact : undefined]}>
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
              <Text variant="small" color={colors.brand.azureCyan} style={styles.activeHint}>
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
                color={confirmationMismatch ? colors.semantic.error : colors.brand.azureCyan}
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
            style={({ pressed }) => [styles.resetButton, pressed ? styles.keyPressed : undefined]}
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
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow:
      '0 2px 8px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  blockCompact: {
    gap: spacing.xs,
    padding: spacing.sm,
  },
  summaryBlock: {
    minHeight: 82,
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
    backgroundColor: 'rgba(252, 252, 255, 0.44)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(252, 252, 255, 0.62)',
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.82)',
  },
  dotInputActive: {
    borderColor: colors.glass.azureCyanHalf,
    backgroundColor: 'rgba(224, 252, 255, 0.52)',
  },
  dotInputError: {
    borderColor: 'rgba(255, 90, 110, 0.48)',
    backgroundColor: 'rgba(255, 232, 236, 0.54)',
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
  },
  dotFilled: {
    backgroundColor: colors.brand.azureCyan,
    boxShadow: '0 0 8px rgba(0, 223, 255, 0.28)',
  },
  dotError: {
    backgroundColor: colors.semantic.error,
    boxShadow: '0 0 8px rgba(255, 90, 110, 0.24)',
  },
  dotEmpty: {
    backgroundColor: 'rgba(10, 53, 65, 0.18)',
  },
  keypad: {
    alignSelf: 'center',
  },
  keyRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
    backgroundColor: 'rgba(252, 252, 255, 0.58)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(252, 252, 255, 0.74)',
    boxShadow:
      '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  keyAction: {
    backgroundColor: colors.glass.textBacking,
  },
  keyPressed: {
    opacity: 0.76,
  },
  keyDisabled: {
    opacity: 0.42,
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
    backgroundColor: colors.glass.textBacking,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  saveButtonSlot: {
    flex: 1,
    minWidth: 0,
  },
});
