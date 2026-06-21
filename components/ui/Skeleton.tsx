import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/colors';
import { radii } from '@/constants/spacing';

import type { StyleProp, ViewStyle } from 'react-native';

const SKELETON_PULSE_MS = 1000;
const SKELETON_SHIMMER_MS = 1150;
const SKELETON_SHIMMER_WIDTH = 128;

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

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
  const blockWidth = useSharedValue(typeof width === 'number' ? width : 0);
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
  const shimmer = useDerivedValue(
    () =>
      reduceMotion
        ? 0
        : withRepeat(
            withTiming(1, {
              duration: SKELETON_SHIMMER_MS,
              easing: Easing.inOut(Easing.quad),
            }),
            -1,
            false,
          ),
    [reduceMotion],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.68 : 0.68 + pulse.value * 0.08,
  }));
  const shimmerStyle = useAnimatedStyle(() => {
    const travelWidth = Math.max(blockWidth.value, SKELETON_SHIMMER_WIDTH) + SKELETON_SHIMMER_WIDTH;
    return {
      transform: [
        {
          translateX: interpolate(shimmer.value, [0, 1], [-SKELETON_SHIMMER_WIDTH, travelWidth]),
        },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        blockWidth.value = event.nativeEvent.layout.width;
      }}
      style={[styles.block, { width, height, borderRadius: radius }, animatedStyle, style]}
    >
      {!reduceMotion ? (
        <AnimatedLinearGradient
          colors={[
            'rgba(255, 255, 255, 0)',
            'rgba(255, 255, 255, 0.16)',
            'rgba(255, 255, 255, 0.62)',
            'rgba(255, 255, 255, 0.16)',
            'rgba(255, 255, 255, 0)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.shimmer, shimmerStyle]}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
  },
  shimmer: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    opacity: 0.95,
    width: SKELETON_SHIMMER_WIDTH,
  },
});
