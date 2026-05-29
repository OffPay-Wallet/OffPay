import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { colors } from '@/constants/colors';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const DOTS = [
  { cx: 12, cy: 3 },
  { cx: 16.5, cy: 4.21 },
  { cx: 19.79, cy: 7.5 },
  { cx: 21, cy: 12 },
  { cx: 19.79, cy: 16.5 },
  { cx: 16.5, cy: 19.79 },
  { cx: 12, cy: 21 },
  { cx: 7.5, cy: 19.79 },
  { cx: 4.21, cy: 16.5 },
  { cx: 3, cy: 12 },
  { cx: 4.21, cy: 7.5 },
  { cx: 7.5, cy: 4.21 },
] as const;

interface SpinnerDotProps {
  cx: number;
  cy: number;
  index: number;
  color: string;
  progress: SharedValue<number>;
}

function SpinnerDot({
  cx,
  cy,
  index,
  color,
  progress,
}: SpinnerDotProps): React.JSX.Element {
  const animatedProps = useAnimatedProps(() => {
    const phase = (progress.value * DOTS.length - index + DOTS.length) % DOTS.length;
    const distance = Math.min(phase, DOTS.length - phase);
    const pulse = Math.max(0, 1 - distance / 2);

    return {
      r: 1 + pulse,
      opacity: 0.42 + pulse * 0.58,
    };
  });

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={1}
      opacity={0.42}
      fill={color}
      animatedProps={animatedProps}
    />
  );
}

interface LazyLoadingSpinnerProps {
  size?: number;
  color?: string;
}

export function LazyLoadingSpinner({
  size = 32,
  color = colors.brand.deepShadow,
}: LazyLoadingSpinnerProps): React.JSX.Element {
  const rotation = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 6000, easing: Easing.linear }),
      -1,
      false,
    );
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress, rotation]);

  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.spinner, { width: size, height: size }, rotateStyle]}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <G>
          {DOTS.map((dot, index) => (
            <SpinnerDot
              key={`${dot.cx}-${dot.cy}`}
              cx={dot.cx}
              cy={dot.cy}
              index={index}
              color={color}
              progress={progress}
            />
          ))}
        </G>
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
