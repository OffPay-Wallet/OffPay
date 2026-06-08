/**
 * WaterKeypadButton — ultra-lightweight keypad key with instant feedback.
 * Optimized for zero-latency digit entry with minimal GPU overhead.
 *
 * Idle: subtle semi-transparent fill with thin glass border.
 * Pressed: opacity dims instantly via Pressable's built-in style callback.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

/* ─── Component ─────────────────────────────────────────────────── */

interface WaterKeypadButtonProps {
  /** Content to render inside the key (usually a <Text>). */
  children: React.ReactNode;
  /** Size-specific frame style: width, height, borderRadius. */
  frameStyle: ViewStyle;
  /** Called when the key is tapped (after press-out). */
  onPress: () => void;
  /** Whether the key is disabled. */
  disabled?: boolean;
  /** Whether the key should appear visually muted. */
  muted?: boolean;
  accessibilityRole?: 'button' | 'keyboardkey';
  accessibilityLabel?: string;
}

export const WaterKeypadButton = memo(function WaterKeypadButton({
  children,
  frameStyle,
  onPress,
  disabled = false,
  muted = false,
  accessibilityRole = 'button',
  accessibilityLabel,
}: WaterKeypadButtonProps): React.JSX.Element {
  return (
    <View style={[styles.outerFrame, frameStyle]}>
      <Pressable
        style={({ pressed }) => [
          styles.key,
          { borderRadius: (frameStyle as { borderRadius?: number }).borderRadius },
          muted && styles.keyMuted,
          pressed && !disabled && styles.keyPressed,
        ]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
      >
        {/* Key content (label) */}
        <View style={styles.contentLayer}>{children}</View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  outerFrame: {
    // No outer elevation or drop shadow — clean silhouette.
  },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
    // Subtle semi-transparent fill.
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    // Thin subtle border for glass definition — no inset boxShadow.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  keyPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    // Removed shadow effects for GPU optimization
  },
  keyMuted: {
    opacity: 0.5,
  },
  contentLayer: {
    zIndex: 1,
  },
});
