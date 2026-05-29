/**
 * PillButton — reusable gradient pill button.
 * Used across Security and other settings modals.
 */
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

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
  const gradientColors: readonly [string, string] =
    variant === 'primary'
      ? [colors.brand.whiteStream, colors.brand.azureCyan]
      : variant === 'danger'
        ? [colors.semantic.error, '#A93131']
        : [colors.glass.strongFill, colors.glass.frostFill];

  const textColor = variant === 'danger' ? colors.text.inverse : colors.text.primary;

  return (
    <Pressable
      style={[styles.shell, disabled ? styles.disabled : undefined]}
      onPress={disabled || loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Text variant="button" color={textColor} allowFontScaling={false}>
          {label}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.full,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  disabled: { opacity: 0.4 },
  gradient: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
