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
const SKELETON_SWEEP_MS = 1050;
/** Wide shimmer track mirrors the skeleton loaders used by apps like X and Reddit. */
const SKELETON_SWEEP_TRACK_WIDTH = '240%' as const;
const SKELETON_SWEEP_START_OFFSET = -1.5;
const SKELETON_SWEEP_END_OFFSET = 0.15;

/**
 * Strong centered core with soft shoulders. The outer stops are transparent
 * so the base skeleton remains visible between passes.
 */
const SWEEP_COLORS = [
  'rgba(255, 255, 255, 0)',
  'rgba(247, 247, 242, 0.18)',
  'rgba(247, 247, 242, 0.92)',
  'rgba(247, 247, 242, 0.18)',
  'rgba(255, 255, 255, 0)',
] as const;
const SWEEP_LOCATIONS = [0, 0.42, 0.5, 0.58, 1] as const;
/** Slight diagonal gives the moving highlight a visible sweep instead of a flat flash. */
const SWEEP_START = { x: 0, y: 0.36 };
const SWEEP_END = { x: 1, y: 0.64 };

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
              easing: Easing.linear,
            }),
            -1,
            false,
          ),
    [reduceMotion],
  );

  const blockStyle = useAnimatedStyle(() => ({
    opacity: 0.94 + pulse.value * 0.06,
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          sweep.value,
          [0, 1],
          [
            blockWidth.value * SKELETON_SWEEP_START_OFFSET,
            blockWidth.value * SKELETON_SWEEP_END_OFFSET,
          ],
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
        <Animated.View style={[styles.sweep, sweepStyle]}>
          <LinearGradient
            colors={SWEEP_COLORS}
            locations={SWEEP_LOCATIONS}
            start={SWEEP_START}
            end={SWEEP_END}
            style={styles.sweepGradient}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
  },
  sweep: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: SKELETON_SWEEP_TRACK_WIDTH,
  },
  sweepGradient: {
    flex: 1,
  },
});
