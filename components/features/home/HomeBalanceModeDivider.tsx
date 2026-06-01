import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type WithTimingConfig,
} from 'react-native-reanimated';

import { SkeletonBlock } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

export type HomeBalanceMode = 'default' | 'shielded';

interface HomeBalanceModeDividerProps {
  selectedMode: HomeBalanceMode;
  onChangeMode: (mode: HomeBalanceMode) => void;
  loading?: boolean;
  /**
   * Fires the moment the user touches down on the Shielded segment,
   * before the press is committed. Used by `HomeScreen` to kick off
   * the lazy `import()` of the Umbra vault chunk so the toggle never
   * waits on a dynamic module fetch.
   */
  onShieldedPressIn?: () => void;
}

const MODES: { id: HomeBalanceMode; label: string; accessibilityLabel: string }[] = [
  { id: 'default', label: 'Portfolio', accessibilityLabel: 'Show portfolio wallet view' },
  { id: 'shielded', label: 'Shielded', accessibilityLabel: 'Show shielded wallet view' },
];
const TRACK_PADDING = 4;
const SEGMENT_GAP = 2;

// Timing-only thumb motion: smooth and predictable, with no spring settle.
const THUMB_TIMING: WithTimingConfig = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
};

function modeIndex(mode: HomeBalanceMode): number {
  for (let i = 0; i < MODES.length; i += 1) {
    if (MODES[i].id === mode) return i;
  }
  return 0;
}

export function HomeBalanceModeDivider({
  selectedMode,
  onChangeMode,
  loading = false,
  onShieldedPressIn,
}: HomeBalanceModeDividerProps): React.JSX.Element {
  const { width, height, fontScale } = useWindowDimensions();
  const dense = width < 340 || fontScale > 1.18;
  const compact = width < 390 || height < 760 || fontScale > 1.08;
  const trackHeight = dense ? 44 : compact ? 46 : 50;
  const segmentHeight = trackHeight - TRACK_PADDING * 2;
  const labelFontSize = compact ? 14 : 15;
  const labelLineHeight = compact ? 18 : 20;
  const trackWidth = useSharedValue(0);
  const selectedIndex = useSharedValue(modeIndex(selectedMode));

  // Reconcile the thumb with the prop for *external* mode changes only.
  // Taps already moved the thumb in the press handler, so when the prop
  // later catches up this resolves to the same target (a no-op).
  useEffect(() => {
    selectedIndex.value = withTiming(modeIndex(selectedMode), THUMB_TIMING);
  }, [selectedIndex, selectedMode]);

  // Slide the thumb immediately on tap, on the UI thread, decoupled
  // from the parent's (heavy) Portfolio/Shielded content swap.
  const handleSelect = useCallback(
    (mode: HomeBalanceMode) => {
      selectedIndex.value = withTiming(modeIndex(mode), THUMB_TIMING);
      onChangeMode(mode);
    },
    [onChangeMode, selectedIndex],
  );

  const segmentWidth = useDerivedValue(() => {
    if (trackWidth.value <= 0) return 0;
    return Math.max(
      0,
      (trackWidth.value - TRACK_PADDING * 2 - SEGMENT_GAP * (MODES.length - 1)) / MODES.length,
    );
  });

  const thumbStyle = useAnimatedStyle(() => {
    const w = segmentWidth.value;
    return {
      width: w,
      height: segmentHeight,
      borderRadius: segmentHeight / 2,
      opacity: w > 0 ? 1 : 0,
      transform: [{ translateX: selectedIndex.value * (w + SEGMENT_GAP) }],
    };
  });

  const handleTrackLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      const nextWidth = event.nativeEvent.layout.width;
      if (Math.abs(trackWidth.value - nextWidth) > 0.5) {
        trackWidth.value = nextWidth;
      }
    },
    [trackWidth],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(180).delay(60)}
      style={[styles.wrapper, compact && styles.wrapperCompact]}
    >
      <View style={[styles.track, { height: trackHeight }]} onLayout={handleTrackLayout}>
        {!loading ? (
          <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
        ) : null}
        <View
          style={styles.segmentRow}
          accessibilityElementsHidden={loading}
          importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
        >
          {loading
            ? MODES.map((mode) => (
                <View
                  key={`mode-skeleton-${mode.id}`}
                  style={[
                    styles.skeletonSegment,
                    {
                      minHeight: segmentHeight,
                      borderRadius: segmentHeight / 2,
                    },
                  ]}
                >
                  <SkeletonBlock width="100%" height={segmentHeight} radius={segmentHeight / 2} />
                </View>
              ))
            : MODES.map((mode) => {
                const selected = selectedMode === mode.id;
                const handlePressIn = mode.id === 'shielded' ? onShieldedPressIn : undefined;
                return (
                  <Pressable
                    key={mode.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={mode.accessibilityLabel}
                    onPressIn={handlePressIn}
                    onPress={() => {
                      if (!selected) handleSelect(mode.id);
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.segment,
                      {
                        minHeight: segmentHeight,
                        borderRadius: segmentHeight / 2,
                      },
                      pressed && !selected ? styles.segmentPressed : undefined,
                    ]}
                  >
                    <Text
                      variant="button"
                      color={selected ? colors.text.onAccent : colors.text.secondary}
                      style={[
                        styles.segmentText,
                        selected ? styles.segmentTextSelected : undefined,
                        {
                          fontSize: labelFontSize,
                          lineHeight: labelLineHeight,
                        },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.82}
                      maxFontSizeMultiplier={1.1}
                    >
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.xl,
  },
  wrapperCompact: {
    marginBottom: spacing.lg,
  },
  track: {
    width: '100%',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    padding: TRACK_PADDING,
    backgroundColor: colors.surface.pressed,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    backgroundColor: colors.glass.strongFill,
    borderWidth: 1,
    borderColor: colors.glass.rim,
  },
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
    gap: SEGMENT_GAP,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.minTouchTarget,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    zIndex: 1,
  },
  skeletonSegment: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    zIndex: 1,
  },
  segmentPressed: {
    backgroundColor: colors.surface.pressed,
  },
  segmentText: {
    fontFamily: fontFamily.uiSemiBold,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    letterSpacing: 0,
  },
  segmentTextSelected: {
    fontFamily: fontFamily.uiBold,
  },
});
