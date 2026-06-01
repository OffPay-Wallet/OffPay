/**
 * 3D pressable button — Apple-style tactile cap on a colored shelf.
 *
 * Visual recipe (matches the XP card reference):
 *   ┌──────────────────────┐  ← cap (solid `surfaceColor`)
 *   │      LABEL           │
 *   ╰──────────────────────╯
 *   ╰──────────────────────╯  ← shelf (solid `shelfColor`, peeks
 *                                below the cap by `depth`dp)
 *
 * Micro-interaction:
 *   - On press-in, the cap translates down by `depth`dp (spring),
 *     so it "clicks into" the shelf. The shelf stays put, the cap
 *     darkens via the optional `pressedSurfaceColor`.
 *   - On press-out, the cap springs back to its rest position with
 *     a small overshoot.
 *
 * The shelf is `position: absolute` underneath the cap — no extra
 * layout space is consumed beyond `depth`dp at the bottom, which
 * the wrapper view reserves explicitly so flex parents lay out
 * predictably.
 *
 * No `boxShadow`, no `LinearGradient`, no `<Image>` — pure flat
 * fills with a single transform on press. Renders identically on
 * iOS and Android.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';

import { radii } from '@/constants/spacing';

import type { ReactNode } from 'react';
import { useCallback, useRef } from 'react';
import type { GestureResponderEvent, ViewStyle, AccessibilityRole } from 'react-native';

export interface ThreeDPressableProps {
  /** Cap fill colour at rest. */
  surfaceColor: string;
  /** Shelf fill colour. Should be a darker shade of `surfaceColor`. */
  shelfColor: string;
  /** Optional cap fill while the press is held. Defaults to `surfaceColor`. */
  pressedSurfaceColor?: string;
  /** Pixels of shelf showing below the cap at rest. Default: 4. */
  depth?: number;
  /** Border radius of both cap and shelf. Default: full pill. */
  borderRadius?: number;
  /** Optional rim around the cap (e.g. for white-on-white parity). */
  borderColor?: string;
  borderWidth?: number;
  /** Optional boxShadow applied to the cap for glossy/glass effects. */
  capShadow?: string;
  /**
   * Override the press spring. Defaults to the onboarding curve
   * (`PRESS_SPRING`). Pass a snappier config for lower-latency
   * surfaces like the home quick actions. Runs as a worklet on the
   * UI thread either way, so the perf-first approach is preserved.
   */
  pressSpring?: WithSpringConfig;
  /** Children rendered inside the cap. */
  children: ReactNode;
  /**
   * Override the cap padding and minimum height. Most callers will
   * leave these alone and let children dictate the size.
   */
  capStyle?: ViewStyle;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityState?: {
    disabled?: boolean;
    busy?: boolean;
  };
  style?: ViewStyle;
}

const PRESS_SPRING: WithSpringConfig = {
  // Tuned so the cap snaps to the shelf in ~120ms with a barely-
  // perceptible overshoot on release. Apple's UIButton press
  // feedback uses a similar curve.
  damping: 18,
  stiffness: 320,
  mass: 0.6,
};

/**
 * Lower-latency press curve for high-frequency surfaces (home quick
 * actions). Higher stiffness + lighter mass make the cap react almost
 * instantly on touch while staying on the UI thread.
 */
export const SNAPPY_PRESS_SPRING: WithSpringConfig = {
  damping: 20,
  stiffness: 600,
  mass: 0.4,
};

export function ThreeDPressable({
  surfaceColor,
  shelfColor,
  pressedSurfaceColor,
  depth = 4,
  borderRadius = radii.full,
  borderColor,
  borderWidth,
  capShadow,
  pressSpring = PRESS_SPRING,
  children,
  capStyle,
  onPress,
  disabled = false,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  style,
}: ThreeDPressableProps): React.JSX.Element {
  const offset = useSharedValue(0);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  const animatedCapStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  const handlePressIn = (): void => {
    'worklet';
    offset.value = withSpring(depth, pressSpring);
  };

  const handlePressOut = (): void => {
    'worklet';
    offset.value = withSpring(0, pressSpring);
  };

  // Delay onPress so the press-down animation is visible before
  // navigation or other heavy side-effects unmount the component.
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      setTimeout(() => {
        onPressRef.current?.(event);
      }, 100);
    },
    [],
  );

  return (
    <View style={[styles.frame, { paddingBottom: depth }, style]}>
      {/* Shelf — sits behind the cap, picks up the press feedback
          colour automatically because the cap moves on top of it. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius,
            backgroundColor: shelfColor,
          },
        ]}
      />
      {/* Cap — Pressable wrapped inside an Animated.View. The
          Animated.View hosts the transform + visual fill; the
          Pressable always stretches to fill it so the entire cap is
          tappable (sizing/padding/centering from `capStyle` is
          applied to the Pressable, never the cap, so a centered
          content layout can't shrink the touch target). */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.cap,
          {
            borderRadius,
            backgroundColor: surfaceColor,
            borderColor,
            borderWidth,
            ...(capShadow != null ? { boxShadow: capShadow } : {}),
          },
          animatedCapStyle,
        ]}
      >
        <Pressable
          accessibilityRole={accessibilityRole}
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{
            disabled,
            ...accessibilityState,
          }}
          disabled={disabled}
          onPress={disabled ? undefined : handlePress}
          onPressIn={disabled ? undefined : handlePressIn}
          onPressOut={disabled ? undefined : handlePressOut}
          style={({ pressed }) => [
            styles.capInner,
            { borderRadius },
            capStyle,
            pressed && pressedSurfaceColor
              ? { backgroundColor: pressedSurfaceColor }
              : null,
          ]}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
  },
  cap: {
    overflow: 'hidden',
  },
  capInner: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
