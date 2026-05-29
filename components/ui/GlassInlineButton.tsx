import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';

import type { ReactNode } from 'react';

interface GlassInlineButtonProps {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function GlassInlineButton({
  label,
  onPress,
  icon,
  disabled = false,
  accessibilityLabel,
}: GlassInlineButtonProps): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.shell,
        pressed && !disabled ? styles.pressed : undefined,
        disabled ? styles.disabled : undefined,
      ]}
      onPress={disabled ? undefined : onPress}
      hitSlop={spacing.sm}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      <LinearGradient
        colors={['rgba(252, 252, 255, 0.74)', 'rgba(223, 247, 250, 0.56)']}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.surface}
      >
        <View style={styles.content}>
          {icon}
          <Text variant="captionBold" color={colors.text.primary} style={styles.label}>
            {label}
          </Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignSelf: 'center',
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.48,
  },
  surface: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    textShadowColor: 'rgba(252, 252, 255, 0.68)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
