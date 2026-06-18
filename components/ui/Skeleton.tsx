import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/colors';
import { radii } from '@/constants/spacing';
import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';

import type { StyleProp, ViewStyle } from 'react-native';

const SKELETON_PULSE_MS = 900;

interface SkeletonBlockProps {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBlock({
  width,
  height,
  radius = radii.md,
  style,
}: SkeletonBlockProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return undefined;
    }

    const startedAt = markAnimationPerf();
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, {
        duration: SKELETON_PULSE_MS,
        easing: Easing.inOut(Easing.cubic),
      }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(pulse);
      finishAnimationPerf('skeleton.pulse', startedAt, false, {
        height,
        width: typeof width === 'number' ? width : width,
      });
    };
  }, [height, pulse, reduceMotion, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.58 : 0.42 + pulse.value * 0.28,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { width, height, borderRadius: radius }, animatedStyle, style]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.surface.cardElevated,
  },
});
