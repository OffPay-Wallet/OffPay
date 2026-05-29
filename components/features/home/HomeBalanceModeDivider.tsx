import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
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
const SEGMENT_GAP = 4;

// Snappy spring — the thumb slides with a tight, smooth motion and a
// barely-perceptible settle. Runs entirely on the UI thread.
const THUMB_SPRING: WithSpringConfig = {
  damping: 22,
  stiffness: 320,
  mass: 0.7,
};

export function HomeBalanceModeDivider({
  selectedMode,
  onChangeMode,
  loading = false,
  onShieldedPressIn,
}: HomeBalanceModeDividerProps): React.JSX.Element {
  const { width, height, fontScale } = useWindowDimensions();
  const [trackWidth, setTrackWidth] = useState(0);
  const dense = width < 340 || fontScale > 1.18;
  const compact = width < 390 || height < 760 || fontScale > 1.08;
  const trackHeight = dense ? 44 : compact ? 48 : 54;
  const segmentHeight = trackHeight - TRACK_PADDING * 2;
  const segmentWidth = Math.max(0, (trackWidth - TRACK_PADDING * 2 - SEGMENT_GAP) / MODES.length);
  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        MODES.findIndex((mode) => mode.id === selectedMode),
      ),
    [selectedMode],
  );
  const thumbOffset = useSharedValue(0);
  // Per-segment stride (width + gap) mirrored into a shared value so
  // the press handler can move the thumb on the UI thread without
  // reading React state inside a worklet.
  const segmentStride = useSharedValue(0);

  useEffect(() => {
    segmentStride.value = segmentWidth + SEGMENT_GAP;
  }, [segmentStride, segmentWidth]);

  // Reconcile the thumb with the prop for *external* mode changes only.
  // Taps already moved the thumb in the press handler, so when the prop
  // later catches up this resolves to the same target (a no-op).
  useEffect(() => {
    thumbOffset.value = withSpring(selectedIndex * (segmentWidth + SEGMENT_GAP), THUMB_SPRING);
  }, [selectedIndex, segmentWidth, thumbOffset]);

  // Slide the thumb immediately on tap, on the UI thread, decoupled
  // from the parent's (heavy) Portfolio/Shielded content swap.
  const handleSelect = useCallback(
    (mode: HomeBalanceMode, index: number) => {
      thumbOffset.value = withSpring(index * segmentStride.value, THUMB_SPRING);
      onChangeMode(mode);
    },
    [onChangeMode, segmentStride, thumbOffset],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbOffset.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(180).delay(60)}
      style={[styles.wrapper, compact && styles.wrapperCompact]}
    >
      <View
        style={[styles.track, { height: trackHeight }]}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        {!loading && segmentWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                width: segmentWidth,
                height: segmentHeight,
                borderRadius: segmentHeight / 2,
              },
              thumbStyle,
            ]}
          />
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
            : MODES.map((mode, index) => {
                const selected = selectedMode === mode.id;
                const handlePressIn =
                  mode.id === 'shielded' ? onShieldedPressIn : undefined;
                return (
                  <Pressable
                    key={mode.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={mode.accessibilityLabel}
                    onPressIn={handlePressIn}
                    onPress={() => {
                      if (!selected) handleSelect(mode.id, index);
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
                        {
                          fontSize: compact ? 15 : 16,
                          lineHeight: compact ? 18 : 20,
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
  // Container-less segmented control — no track background, border, or
  // shadow. The active segment is a soft translucent pill floating on
  // the bare gradient (reference behaviour); inactive is muted text.
  track: {
    width: '100%',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    padding: TRACK_PADDING,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    backgroundColor: colors.glass.strongFill,
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
    backgroundColor: colors.glass.frostFill,
  },
  segmentText: {
    fontFamily: fontFamily.uiSemiBold,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    letterSpacing: 0,
  },
});
