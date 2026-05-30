/**
 * Live recording waveform. Renders a row of bars whose heights react to the
 * mic input `level` (0..1) with a smooth spring, plus a gentle idle shimmer so
 * the line never looks frozen during silence. Reanimated drives the animation
 * off the UI thread so it stays smooth while JS handles transcription.
 */

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/colors';

interface VoiceWaveformProps {
  /** Normalized input level, 0..1. */
  level: number;
  /** Number of bars to render. */
  barCount?: number;
  /** Whether the waveform is actively reacting to input. */
  active?: boolean;
}

const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 22;

function WaveBar({
  index,
  level,
  active,
}: {
  index: number;
  level: number;
  active: boolean;
}): React.JSX.Element {
  const height = useSharedValue(MIN_BAR_HEIGHT);

  // A per-bar weight gives the row an organic, center-weighted shape rather
  // than a flat block. Deterministic so bars don't jump on re-render.
  const weight = useMemo(() => 0.55 + 0.45 * Math.abs(Math.sin(index * 1.7)), [index]);

  useEffect(() => {
    if (!active) {
      height.value = withTiming(MIN_BAR_HEIGHT, { duration: 180 });
      return;
    }
    const target =
      MIN_BAR_HEIGHT + (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * Math.min(1, level * weight * 1.3);
    // Spring-like settle toward the target, with a tiny shimmer so silence
    // still reads as "listening".
    height.value = withSequence(
      withTiming(target, { duration: 110 }),
      withRepeat(withTiming(Math.max(MIN_BAR_HEIGHT, target * 0.82), { duration: 320 }), 2, true),
    );
  }, [active, height, level, weight]);

  const style = useAnimatedStyle(() => ({ height: height.value }));

  return <Animated.View style={[styles.bar, style]} />;
}

export function VoiceWaveform({
  level,
  barCount = 28,
  active = true,
}: VoiceWaveformProps): React.JSX.Element {
  const bars = useMemo(() => Array.from({ length: barCount }, (_, index) => index), [barCount]);

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((index) => (
        <WaveBar key={index} index={index} level={level} active={active} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MAX_BAR_HEIGHT,
    gap: 3,
    flex: 1,
  },
  bar: {
    flex: 1,
    minWidth: 2,
    borderRadius: 2,
    backgroundColor: colors.brand.deepShadow,
  },
});
