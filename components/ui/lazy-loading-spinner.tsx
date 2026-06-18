import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { colors } from '@/constants/colors';
import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';

/**
 * iOS-style activity indicator — the classic 12 tapered bars arranged
 * radially, with the bright "head" sweeping around the ring.
 *
 * Performance:
 *   - The bars are STATIC SVG <Line>s computed once at module scope
 *     (no per-render math, no per-bar animated worklets).
 *   - A SINGLE shared value drives ONE rotation transform on the UI
 *     thread, stepped in 12 increments via `Easing.steps` to match
 *     the characteristic iOS "tick". This is strictly lighter than a
 *     spinner that animates each dot's radius/opacity every frame.
 */

const BAR_COUNT = 12;
const VIEWBOX = 24;
const CENTER = VIEWBOX / 2;
const INNER_RADIUS = 5;
const OUTER_RADIUS = 9.5;
const BAR_STROKE_WIDTH = 2;
const SPIN_DURATION_MS = 900;

interface SpinnerBar {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
}

// Precompute the 12 bars once. Each bar points outward from the center
// at its clock angle; opacity tapers from the bright head (1.0) down
// to the faint tail so a continuous rotation reads as the iOS sweep.
const BARS: readonly SpinnerBar[] = Array.from({ length: BAR_COUNT }, (_, index) => {
  const angle = (index / BAR_COUNT) * Math.PI * 2;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return {
    x1: CENTER + INNER_RADIUS * sin,
    y1: CENTER - INNER_RADIUS * cos,
    x2: CENTER + OUTER_RADIUS * sin,
    y2: CENTER - OUTER_RADIUS * cos,
    opacity: Math.max(0.18, 1 - (index / BAR_COUNT) * 0.92),
  };
});

interface LazyLoadingSpinnerProps {
  size?: number;
  color?: string;
}

export function LazyLoadingSpinner({
  size = 32,
  color = colors.text.primary,
}: LazyLoadingSpinnerProps): React.JSX.Element {
  const rotation = useSharedValue(0);

  useEffect(() => {
    const startedAt = markAnimationPerf();
    rotation.value = withRepeat(
      // Stepped easing gives the authentic iOS per-bar "tick" while
      // still being a single tween on the UI thread.
      withTiming(BAR_COUNT, { duration: SPIN_DURATION_MS, easing: Easing.steps(BAR_COUNT, true) }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(rotation);
      finishAnimationPerf('loadingSpinner.loop', startedAt, false, { size });
    };
  }, [rotation, size]);

  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(rotation.value / BAR_COUNT) * 360}deg` }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.spinner, { width: size, height: size }, rotateStyle]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
        {BARS.map((bar, index) => (
          <Line
            key={index}
            x1={bar.x1}
            y1={bar.y1}
            x2={bar.x2}
            y2={bar.y2}
            stroke={color}
            strokeOpacity={bar.opacity}
            strokeWidth={BAR_STROKE_WIDTH}
            strokeLinecap="round"
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  spinner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
