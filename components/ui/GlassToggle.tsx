import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';

interface GlassToggleProps {
  value: boolean;
  onValueChange: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/** Glossy dark toggle — shared by offline slots and security fingerprint rows. */
export function GlassToggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel = 'Toggle',
}: GlassToggleProps): React.JSX.Element {
  return (
    <Pressable
      style={[styles.toggle, value ? styles.toggleActive : undefined, disabled ? styles.disabled : undefined]}
      onPress={onValueChange}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      hitSlop={6}
    >
      <View style={[styles.toggleDot, value ? styles.toggleDotActive : undefined]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 60,
    height: 34,
    borderRadius: radii.full,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    padding: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: colors.surface.backgroundTint,
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.08), inset 0 -1px 2px rgba(0, 0, 0, 0.32)',
  },
  toggleActive: {
    borderColor: colors.glass.rim,
    justifyContent: 'flex-end',
    backgroundColor: colors.brand.glossAccent,
  },
  toggleDot: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.text.tertiary,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.32)',
  },
  toggleDotActive: {
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.deepShadow,
  },
  disabled: {
    opacity: 0.45,
  },
});
