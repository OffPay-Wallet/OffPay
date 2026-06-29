import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/colors';

import type { StyleProp, TextStyle } from 'react-native';

interface ProcessingShimmerTextProps {
  text: string;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}

const SHIMMER_SWEEP_MS = 1150;
const SHIMMER_MIN_BAND_WIDTH = 42;
const SHIMMER_BAND_WIDTH_RATIO = 0.42;
const SHIMMER_END_OVERFLOW_RATIO = 0.18;
const SHIMMER_TEXT_COLORS = [
  colors.text.secondary,
  colors.text.primary,
  colors.brand.whiteStream,
  colors.text.primary,
  colors.text.secondary,
] as const;

export function ProcessingShimmerText({
  text,
  numberOfLines = 2,
  style,
}: ProcessingShimmerTextProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const labelWidth = useSharedValue(0);
  const sweep = useSharedValue(0);

  React.useEffect(() => {
    cancelAnimation(sweep);
    sweep.value = 0;
    if (!reduceMotion) {
      sweep.value = withRepeat(
        withTiming(1, {
          duration: SHIMMER_SWEEP_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
        -1,
        false,
      );
    }

    return () => {
      cancelAnimation(sweep);
    };
  }, [reduceMotion, sweep]);

  const shimmerBandStyle = useAnimatedStyle(() => {
    const width = labelWidth.value;
    const bandWidth = Math.min(
      Math.max(width * SHIMMER_BAND_WIDTH_RATIO, SHIMMER_MIN_BAND_WIDTH),
      Math.max(width, SHIMMER_MIN_BAND_WIDTH),
    );
    const translateX = interpolate(
      sweep.value,
      [0, 1],
      [-bandWidth, width + bandWidth * SHIMMER_END_OVERFLOW_RATIO],
    );

    return {
      width: bandWidth,
      opacity: width > 0 ? 1 : 0,
      transform: [{ translateX }],
    };
  });

  const baseTextStyle = useAnimatedStyle(() => {
    const pulse = reduceMotion ? 0 : sweep.value;
    return {
      color: interpolateColor(
        pulse,
        [0, 0.36, 0.5, 0.64, 1],
        SHIMMER_TEXT_COLORS,
      ),
      opacity: reduceMotion ? 1 : interpolate(pulse, [0, 0.5, 1], [0.82, 1, 0.88]),
    };
  });

  const shimmerTextStyle = useAnimatedStyle(() => {
    const width = labelWidth.value;
    const bandWidth = Math.min(
      Math.max(width * SHIMMER_BAND_WIDTH_RATIO, SHIMMER_MIN_BAND_WIDTH),
      Math.max(width, SHIMMER_MIN_BAND_WIDTH),
    );
    const translateX = interpolate(
      sweep.value,
      [0, 1],
      [-bandWidth, width + bandWidth * SHIMMER_END_OVERFLOW_RATIO],
    );

    return {
      width: Math.max(width, 1),
      transform: [{ translateX: -translateX }],
    };
  });

  return (
    <View
      style={styles.wrap}
      onLayout={(event) => {
        labelWidth.value = event.nativeEvent.layout.width;
      }}
    >
      <Animated.Text style={[style, baseTextStyle]} numberOfLines={numberOfLines}>
        {text}
      </Animated.Text>
      {!reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.shimmerBand, shimmerBandStyle]}
        >
          <Animated.Text
            style={[style, styles.shimmerText, shimmerTextStyle]}
            numberOfLines={numberOfLines}
          >
            {text}
          </Animated.Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    flexShrink: 1,
    overflow: 'hidden',
  },
  shimmerBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  shimmerText: {
    color: colors.brand.whiteStream,
    textShadowColor: 'rgba(247, 247, 242, 0.28)',
    textShadowRadius: 7,
  },
});
