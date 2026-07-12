import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

const TRACK_PADDING = 4;
const SEGMENT_GAP = 4;
const SEGMENT_HEIGHT = 34;
const SLIDE_TIMING = {
  duration: 190,
  easing: Easing.out(Easing.cubic),
} as const;

export interface AnimatedSegmentedOption<T extends string> {
  value: T;
  label: string;
  accessibilityLabel: string;
}

interface AnimatedSegmentedControlProps<T extends string> {
  options: readonly AnimatedSegmentedOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  disabled?: boolean;
}

function optionIndex<T extends string>(
  options: readonly AnimatedSegmentedOption<T>[],
  value: T,
): number {
  return Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
}

export function AnimatedSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: AnimatedSegmentedControlProps<T>): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const trackWidth = useSharedValue(0);
  const selectedIndex = useSharedValue(optionIndex(options, value));
  const currentIndex = optionIndex(options, value);

  const moveThumb = useCallback(
    (index: number): void => {
      selectedIndex.value = reduceMotion ? index : withTiming(index, SLIDE_TIMING);
    },
    [reduceMotion, selectedIndex],
  );

  useEffect(() => {
    moveThumb(currentIndex);
  }, [currentIndex, moveThumb]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      trackWidth.value = event.nativeEvent.layout.width;
    },
    [trackWidth],
  );

  const thumbStyle = useAnimatedStyle(() => {
    const segmentWidth = Math.max(
      0,
      (trackWidth.value - TRACK_PADDING * 2 - SEGMENT_GAP * (options.length - 1)) /
        options.length,
    );

    return {
      width: segmentWidth,
      opacity: segmentWidth > 0 ? 1 : 0,
      transform: [{ translateX: selectedIndex.value * (segmentWidth + SEGMENT_GAP) }],
    };
  }, [options.length]);

  return (
    <View style={styles.track} onLayout={handleLayout}>
      <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
      <View style={styles.optionRow}>
        {options.map((option) => {
          const selected = option.value === value;
          const optionDisabled = disabled || selected || onChange == null;

          return (
            <Pressable
              key={option.value}
              onPress={() => onChange?.(option.value)}
              disabled={optionDisabled}
              style={({ pressed }) => [
                styles.option,
                pressed && !selected && styles.optionPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={option.accessibilityLabel}
              accessibilityState={{ selected, disabled: optionDisabled }}
            >
              <Text
                variant="small"
                color={selected ? colors.text.onAccent : colors.text.secondary}
                style={[styles.optionText, disabled && styles.disabledText]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.76}
                maxFontSizeMultiplier={1.1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    minHeight: SEGMENT_HEIGHT + TRACK_PADDING * 2,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    backgroundColor: colors.surface.solidControl,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    height: SEGMENT_HEIGHT,
    borderRadius: radii.full,
    backgroundColor: colors.brand.whiteStream,
  },
  optionRow: {
    flex: 1,
    flexDirection: 'row',
    gap: SEGMENT_GAP,
    padding: TRACK_PADDING,
  },
  option: {
    flex: 1,
    minWidth: 0,
    minHeight: SEGMENT_HEIGHT,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  optionPressed: {
    backgroundColor: colors.surface.pressed,
  },
  optionText: {
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  disabledText: {
    opacity: 0.64,
  },
});
