/**
 * WaterKeypadButton — glossy dorayaki-shaped keypad key with a
 * water-like spring press animation.
 *
 * Idle state ("dorayaki" / dora-cake look):
 *   - No outer elevation or drop shadows.
 *   - Convex highlight buffed from the center using layered inset
 *     shadows: a bright top-center highlight fading into darker
 *     edges, making each key look puffy and rounded like a dorayaki.
 *
 * Pressed state ("water press"):
 *   - Short timing-driven scale animation. Keypad taps are latency-sensitive,
 *     so the feedback stays glossy without a spring overshoot pass.
 *   - The inner glow intensifies on press, as if the surface tension
 *     of the gloss deforms under the finger.
 *   - Uses `react-native-reanimated` timing on the UI thread for tactile
 *     feedback without adding JS work to digit entry.
 */
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/* ─── Press tuning ─────────────────────────────────────────────── */

const WATER_PRESS_IN = {
  duration: 72,
  easing: Easing.out(Easing.quad),
} as const;
const WATER_PRESS_OUT = {
  duration: 96,
  easing: Easing.out(Easing.cubic),
} as const;

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
  const scale = useSharedValue(1);
  const glowIntensity = useSharedValue(0);

  const handlePressIn = useCallback((): void => {
    scale.value = withTiming(0.94, WATER_PRESS_IN);
    glowIntensity.value = withTiming(1, WATER_PRESS_IN);
  }, [glowIntensity, scale]);

  const handlePressOut = useCallback((): void => {
    scale.value = withTiming(1, WATER_PRESS_OUT);
    glowIntensity.value = withTiming(0, WATER_PRESS_OUT);
  }, [glowIntensity, scale]);

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const animatedGlowStyle = useAnimatedStyle(() => ({
    opacity: glowIntensity.value,
  }));

  return (
    <Animated.View style={[styles.outerFrame, frameStyle, animatedContainerStyle]}>
      <Pressable
        style={[
          styles.key,
          { borderRadius: (frameStyle as { borderRadius?: number }).borderRadius },
          muted ? styles.keyMuted : undefined,
        ]}
        onPress={disabled ? undefined : onPress}
        onPressIn={disabled ? undefined : handlePressIn}
        onPressOut={disabled ? undefined : handlePressOut}
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
      >
        {/* Water glow overlay — intensifies on press */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.waterGlow,
            { borderRadius: (frameStyle as { borderRadius?: number }).borderRadius },
            animatedGlowStyle,
          ]}
        />
        {/* Key content (label) */}
        <View style={styles.contentLayer}>{children}</View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  outerFrame: {
    // No outer elevation or drop shadow — clean dorayaki silhouette.
  },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
    // Dorayaki base: subtle semi-transparent fill.
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    // Convex gloss with minimal layers; this component renders 12 times on
    // passcode screens, so avoid stacking expensive inset shadows per key.
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.22)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.35)',
    ].join(', '),
    // Thin subtle border for glass definition.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  keyMuted: {
    opacity: 0.5,
  },
  waterGlow: {
    // Absolutely fills the key — fades in on press for the
    // "water refraction" flash at the center.
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    boxShadow: 'inset 0 1px 4px rgba(255, 255, 255, 0.42)',
  },
  contentLayer: {
    zIndex: 1,
  },
});
