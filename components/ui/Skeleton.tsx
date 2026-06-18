import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/colors';
import { radii } from '@/constants/spacing';

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
  const pulse = useDerivedValue(
    () =>
      reduceMotion
        ? 1
        : withRepeat(
            withTiming(1, {
              duration: SKELETON_PULSE_MS,
              easing: Easing.inOut(Easing.cubic),
            }),
            -1,
            true,
          ),
    [reduceMotion],
  );

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
