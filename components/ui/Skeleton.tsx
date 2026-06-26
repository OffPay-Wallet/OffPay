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

/** Opacity "breathing" cycle applied to the base block. */
const SKELETON_PULSE_MS = 1100;
/** Duration of a single light-sweep pass across a block. */
const SKELETON_SWEEP_MS = 1300;
/** Width of the moving highlight band, in px. */
const SKELETON_SWEEP_BAND = 150;

/**
 * Soft, centered white core that fades to transparent at both edges so the
 * sweep reads as a smooth light pass instead of a hard bar.
 */
const SWEEP_COLORS = [
  'rgba(255, 255, 255, 0)',
  'rgba(255, 255, 255, 0.08)',
  'rgba(255, 255, 255, 0.5)',
  'rgba(255, 255, 255, 0.08)',
  'rgba(255, 255, 255, 0)',
] as const;
const SWEEP_LOCATIONS = [0, 0.35, 0.5, 0.65, 1] as const;
/** Top-left -> bottom-right gradient gives the highlight its diagonal tilt. */
const SWEEP_START = { x: 0, y: 0 };
const SWEEP_END = { x: 1, y: 1 };

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
        ? 0
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

  const sweep = useDerivedValue(
    () =>
      reduceMotion
        ? 0
        : withRepeat(
            withTiming(1, {
              duration: SKELETON_SWEEP_MS,
              easing: Easing.inOut(Easing.quad),
            }),
            -1,
            false,
          ),
    [reduceMotion],
  );

  const blockStyle = useAnimatedStyle(() => ({
    opacity: 0.7 + pulse.value * 0.08,
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          sweep.value,
          [0, 1],
          [-SKELETON_SWEEP_BAND, blockWidth.value + SKELETON_SWEEP_BAND],
        ),
      },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        blockWidth.value = event.nativeEvent.layout.width;
      }}
      style={[styles.block, { width, height, borderRadius: radius }, blockStyle, style]}
    >
      {!reduceMotion ? (
        <AnimatedLinearGradient
          colors={SWEEP_COLORS}
          locations={SWEEP_LOCATIONS}
          start={SWEEP_START}
          end={SWEEP_END}
          style={[styles.sweep, sweepStyle]}
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
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SKELETON_SWEEP_BAND,
  },
});
