/**
 * AuthGateStep — fingerprint or passcode authentication gate.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PillButton } from '@/components/ui/PillButton';
import { Text } from '@/components/ui/Text';
import { PuffyRefreshIcon } from '@/components/ui/icons/PuffyRefreshIcon';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

interface AuthGateStepProps {
  description?: string;
  buttonLabel: string;
  fingerprintEnabled: boolean;
  hasPasscode: boolean;
  gatePasscode: string;
  onChangeGatePasscode: (value: string) => void;
  onContinue: () => void;
  helperText?: string;
  compact?: boolean;
}

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['clear', '0', 'delete'],
] as const;

export function AuthGateStep({
  description,
  buttonLabel,
  fingerprintEnabled,
  hasPasscode,
  gatePasscode,
  onChangeGatePasscode,
  onContinue,
  helperText,
  compact = false,
}: AuthGateStepProps): React.JSX.Element {
  const showDescription = description != null && description.trim().length > 0;
  const canUsePasscode = hasPasscode && gatePasscode.length === 6;
  const hasPartialPasscode = hasPasscode && gatePasscode.length > 0 && gatePasscode.length < 6;
  const canContinue = canUsePasscode || (fingerprintEnabled && !hasPartialPasscode);
  const hasAnyInput = gatePasscode.length > 0;
  const continueLabel = canUsePasscode
    ? 'Continue'
    : hasPartialPasscode
      ? 'Enter 6 digits'
      : buttonLabel;
  const keySize = compact ? 38 : 40;
  const keypadGap = spacing.sm;

  const handleDigit = (digit: string): void => {
    onChangeGatePasscode(`${gatePasscode}${digit}`.slice(0, 6));
  };

  const handleDelete = (): void => {
    onChangeGatePasscode(gatePasscode.slice(0, -1));
  };

  const handleReset = (): void => {
    onChangeGatePasscode('');
  };

  const renderKey = (key: string): React.JSX.Element => {
    const isAction = key === 'clear' || key === 'delete';
    const disabled = key === 'clear' ? gatePasscode.length === 0 : false;
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
            handleReset();
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
        hitSlop={3}
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

  return (
    <View style={[styles.block, compact ? styles.blockCompact : undefined]}>
      {showDescription ? (
        <Text variant="small" color={colors.text.secondary} style={styles.description}>
          {description}
        </Text>
      ) : null}

      {hasPasscode ? (
        <View style={styles.passcodeArea}>
          <View style={styles.inputLabelRow}>
            <Text variant="small" color={colors.text.secondary} style={styles.inputLabel}>
              Passcode
            </Text>
            <Text variant="small" color={colors.brand.azureCyan} style={styles.activeHint}>
              {gatePasscode.length === 6 ? 'Ready' : 'Enter 6 digits'}
            </Text>
          </View>

          <View
            style={[styles.dotInput, gatePasscode.length > 0 ? styles.dotInputActive : undefined]}
            accessibilityLabel={`Passcode, ${gatePasscode.length} of 6 digits`}
          >
            <View style={styles.dotRow}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    index < gatePasscode.length ? styles.dotFilled : styles.dotEmpty,
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={[styles.keypad, { gap: keypadGap }]}>
            {KEYPAD_ROWS.map((row, index) => (
              <View key={index} style={[styles.keyRow, { gap: keypadGap }]}>
                {row.map(renderKey)}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        {hasAnyInput ? (
          <Pressable
            style={({ pressed }) => [styles.resetButton, pressed ? styles.keyPressed : undefined]}
            onPress={handleReset}
            accessibilityRole="button"
            accessibilityLabel="Reset passcode entry"
            hitSlop={4}
          >
            <PuffyRefreshIcon size={compact ? 15 : 16} color={colors.text.secondary} />
          </Pressable>
        ) : null}
        <View style={styles.continueButtonSlot}>
          <PillButton
            label={continueLabel}
            variant="primary"
            onPress={onContinue}
            disabled={!canContinue}
          />
        </View>
      </View>

      {helperText != null ? (
        <Text variant="small" color={colors.text.tertiary} style={styles.helperText}>
          {helperText}
        </Text>
      ) : null}
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
      '0 14px 26px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.72), inset 0 -10px 18px rgba(91, 200, 232, 0.08)',
  },
  blockCompact: {
    gap: spacing.xs,
    padding: spacing.sm,
  },
  description: {
    lineHeight: 18,
  },
  passcodeArea: {
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
      '0 8px 14px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.84), inset 0 -8px 14px rgba(91, 200, 232, 0.12)',
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
  continueButtonSlot: {
    flex: 1,
    minWidth: 0,
  },
  helperText: {
    lineHeight: 18,
  },
});
