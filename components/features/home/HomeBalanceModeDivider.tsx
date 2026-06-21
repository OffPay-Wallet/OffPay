import React, { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedReaction,
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
import { getViewportProfile } from '@/lib/ui/responsive-layout';

export type HomeBalanceMode = 'default' | 'shielded';

interface HomeBalanceModeDividerProps {
  selectedMode: HomeBalanceMode;
  onChangeMode: (mode: HomeBalanceMode) => void;
  loading?: boolean;
  /**
   * Fires when the user touches down on the Shielded segment. The
   * parent uses it to schedule a lazy Umbra chunk warm-up outside the
   * touch frame, keeping the thumb transition responsive.
   */
  onShieldedPressIn?: () => void;
}

const MODES: { id: HomeBalanceMode; label: string; accessibilityLabel: string }[] = [
  { id: 'default', label: 'Portfolio', accessibilityLabel: 'Show portfolio wallet view' },
  { id: 'shielded', label: 'Shielded', accessibilityLabel: 'Show shielded wallet view' },
];
const TRACK_VERTICAL_PADDING = 5;
const TRACK_HORIZONTAL_PADDING = 5;
const SEGMENT_GAP = 2;
const HOME_CONTENT_MAX_WIDTH = 430;

// Timing-only thumb motion: smooth and predictable, with no spring settle.
const THUMB_TIMING: WithTimingConfig = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
};

const ModeSegment = memo(function ModeSegment({
  mode,
  selected,
  segmentHeight,
  labelFontSize,
  labelLineHeight,
  onSelect,
  onShieldedPressIn,
}: {
  mode: (typeof MODES)[number];
  selected: boolean;
  segmentHeight: number;
  labelFontSize: number;
  labelLineHeight: number;
  onSelect: (mode: HomeBalanceMode) => void;
  onShieldedPressIn?: () => void;
}): React.JSX.Element {
  const [pressed, setPressed] = useState(false);

  const resetPressed = useCallback((): void => {
    setPressed(false);
  }, []);

  const handlePressIn = useCallback((): void => {
    setPressed(true);
    if (mode.id === 'shielded') {
      onShieldedPressIn?.();
    }
  }, [mode.id, onShieldedPressIn]);

  const handlePress = useCallback((): void => {
    resetPressed();
    if (!selected) {
      onSelect(mode.id);
    }
  }, [mode.id, onSelect, resetPressed, selected]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={mode.accessibilityLabel}
      onPressIn={handlePressIn}
      onPressOut={resetPressed}
      onPress={handlePress}
      onResponderTerminate={resetPressed}
      onResponderTerminationRequest={() => true}
      hitSlop={6}
      style={[
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
        color={selected ? colors.text.primary : colors.text.tertiary}
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
});

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
  const viewportProfile = getViewportProfile({ width, height, fontScale });
  const dense = viewportProfile.dense;
  const compact = viewportProfile.compact;
  const trackHeight = dense ? 44 : compact ? 46 : 50;
  const segmentHeight = trackHeight - TRACK_VERTICAL_PADDING * 2;
  const labelFontSize = compact ? 14 : 15;
  const labelLineHeight = compact ? 18 : 20;
  const trackWidth = Math.max(
    0,
    Math.min(HOME_CONTENT_MAX_WIDTH, width - viewportProfile.horizontalPadding * 2),
  );
  const segmentWidthPx = Math.max(
    0,
    (trackWidth - TRACK_HORIZONTAL_PADDING * 2 - SEGMENT_GAP * (MODES.length - 1)) / MODES.length,
  );
  const selectedIndex = useSharedValue(modeIndex(selectedMode));
  const selectedModeIndex = modeIndex(selectedMode);
  const propSelectedIndex = useDerivedValue(() => selectedModeIndex, [selectedModeIndex]);

  // Reconcile the thumb with the prop for *external* mode changes only.
  // Taps already moved the thumb in the press handler, so when the prop
  // later catches up this resolves to the same target (a no-op).
  useAnimatedReaction(
    () => propSelectedIndex.value,
    (current) => {
      selectedIndex.value = withTiming(current, THUMB_TIMING);
    },
    [selectedIndex],
  );

  // Slide the thumb immediately on tap, on the UI thread, decoupled
  // from the parent's (heavy) Portfolio/Shielded content swap.
  const handleSelect = useCallback(
    (mode: HomeBalanceMode) => {
      selectedIndex.value = withTiming(modeIndex(mode), THUMB_TIMING);
      onChangeMode(mode);
    },
    [onChangeMode, selectedIndex],
  );

  const segmentWidth = useDerivedValue(() => segmentWidthPx, [segmentWidthPx]);

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

  return (
    <View style={[styles.wrapper, compact && styles.wrapperCompact]}>
      <View style={[styles.track, { width: trackWidth, height: trackHeight }]}>
        {!loading ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                top: TRACK_VERTICAL_PADDING,
                left: TRACK_HORIZONTAL_PADDING,
              },
              thumbStyle,
            ]}
          />
        ) : null}
        <View
          style={[
            styles.segmentRow,
            {
              paddingVertical: TRACK_VERTICAL_PADDING,
              paddingHorizontal: TRACK_HORIZONTAL_PADDING,
            },
          ]}
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
                return (
                  <ModeSegment
                    key={mode.id}
                    mode={mode}
                    selected={selected}
                    segmentHeight={segmentHeight}
                    labelFontSize={labelFontSize}
                    labelLineHeight={labelLineHeight}
                    onSelect={handleSelect}
                    onShieldedPressIn={onShieldedPressIn}
                  />
                );
              })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  wrapperCompact: {
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  track: {
    width: '100%',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    boxShadow: [
      'inset 0 2px 6px rgba(0, 0, 0, 0.5)',
      'inset 0 0 12px rgba(0, 0, 0, 0.25)',
      'inset 0 -1px 1px rgba(255, 255, 255, 0.08)',
      '0 1px 0 rgba(255, 255, 255, 0.05)',
    ].join(', '),
  },
  thumb: {
    position: 'absolute',
    zIndex: 0,
    backgroundColor: 'rgba(78, 78, 78, 0.96)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 3,
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.44)',
      'inset 0 0 10px rgba(255, 255, 255, 0.1)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.35)',
      '0 4px 12px rgba(0, 0, 0, 0.4)',
    ].join(', '),
  },
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
    gap: SEGMENT_GAP,
    zIndex: 1,
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
    backgroundColor: colors.glass.clearFill,
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
