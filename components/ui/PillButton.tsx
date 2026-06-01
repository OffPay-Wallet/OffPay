/**
 * PillButton — reusable solid glossy pill button.
 * Used across Security and other settings modals.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'neutral' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}

export function PillButton({
  label,
  onPress,
  variant = 'neutral',
  disabled = false,
  loading = false,
}: PillButtonProps): React.JSX.Element {
  const surfaceStyle =
    variant === 'primary' ? styles.primary : variant === 'danger' ? styles.danger : styles.neutral;

  const textColor =
    variant === 'primary'
      ? colors.text.onAccent
      : variant === 'danger'
        ? colors.text.inverse
        : colors.text.primary;

  return (
    <Pressable
      style={[styles.shell, disabled ? styles.disabled : undefined]}
      onPress={disabled || loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      <View style={[styles.surface, surfaceStyle]}>
        <Text variant="button" color={textColor} allowFontScaling={false}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.full,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 10px 20px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
  },
  disabled: { opacity: 0.4 },
  surface: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.brand.glossAccent,
  },
  neutral: {
    backgroundColor: colors.surface.cardElevated,
  },
  danger: {
    backgroundColor: colors.semantic.error,
  },
});
