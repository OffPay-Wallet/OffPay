import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';

/**
 * Segmented Standard / Private toggle for the receive screen.
 *
 * Performance hygiene:
 *   - Track width is captured once via `onLayout` into a shared value
 *     that drives the thumb position on the UI thread. We never store
 *     it in React state, so `onChangeMode` does not trigger a layout
 *     pass on every selection.
 *   - The thumb slides the instant the user taps: the press handler
 *     writes `selectedIndex` directly (UI thread), so the slide is
 *     decoupled from the parent's (potentially heavy) re-render. The
 *     prop-driven effect only reconciles external mode changes (e.g.
 *     auto-switch to Private on a pending claim).
 *   - Each segment row is memoised so re-rendering the parent does
 *     not re-render the labels / badge / icons.
 */

export type ReceiveMode = 'standard' | 'private';

interface ReceiveModeSegmentedDividerProps {
  selectedMode: ReceiveMode;
  onChangeMode: (mode: ReceiveMode) => void;
  privateModeBadge?: number;
}

interface ModeDescriptor {
  id: ReceiveMode;
  label: string;
  accessibilityLabel: string;
}

const MODES: readonly ModeDescriptor[] = [
  { id: 'standard', label: 'Standard', accessibilityLabel: 'Show standard receive QR view' },
  { id: 'private', label: 'Private', accessibilityLabel: 'Show private Umbra receive view' },
];
const TRACK_PADDING = 4;
const SEGMENT_GAP = 0;
// Snappy spring — the thumb slides with a tight, smooth motion and a
// barely-perceptible settle. Runs entirely on the UI thread.
const THUMB_SPRING: WithSpringConfig = {
  damping: 22,
  stiffness: 320,
  mass: 0.7,
};

function modeIndex(mode: ReceiveMode): number {
  for (let i = 0; i < MODES.length; i += 1) {
    if (MODES[i].id === mode) return i;
  }
  return 0;
}

export const ReceiveModeSegmentedDivider = memo(function ReceiveModeSegmentedDivider({
  selectedMode,
  onChangeMode,
  privateModeBadge,
}: ReceiveModeSegmentedDividerProps): React.JSX.Element {
  const { width, height, fontScale } = useWindowDimensions();
  const dense = width < 340 || fontScale > 1.18;
  const compact = width < 390 || height < 760 || fontScale > 1.08;
  const trackHeight = dense ? 44 : compact ? 48 : 54;
  const segmentHeight = trackHeight - TRACK_PADDING * 2;
  const labelFontSize = compact ? 15 : 16;
  const labelLineHeight = compact ? 18 : 20;

  const trackWidth = useSharedValue(0);
  const selectedIndex = useSharedValue(modeIndex(selectedMode));

  // Reconcile the thumb with the prop for *external* mode changes only.
  // Taps already moved the thumb in the press handler, so when the prop
  // later catches up this resolves to the same target (a no-op).
  React.useEffect(() => {
    selectedIndex.value = withSpring(modeIndex(selectedMode), THUMB_SPRING);
  }, [selectedIndex, selectedMode]);

  // Slide the thumb immediately on tap, on the UI thread, without
  // waiting for the parent's state commit. The parent still updates its
  // mode via `onChangeMode`; this just unblocks the visual.
  const handleSelect = useCallback(
    (mode: ReceiveMode) => {
      selectedIndex.value = withSpring(modeIndex(mode), THUMB_SPRING);
      onChangeMode(mode);
    },
    [onChangeMode, selectedIndex],
  );

  // Compute thumb width and position purely on the UI thread.
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
      transform: [{ translateX: selectedIndex.value * (w + SEGMENT_GAP) }],
      // Hide the thumb cleanly while the track has not yet measured.
      opacity: w > 0 ? 1 : 0,
    };
  });

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      const next = event.nativeEvent.layout.width;
      if (Math.abs(trackWidth.value - next) > 0.5) {
        trackWidth.value = next;
      }
    },
    [trackWidth],
  );

  return (
    <View style={[styles.wrapper, compact && styles.wrapperCompact]}>
      <View style={[styles.track, { height: trackHeight }]} onLayout={handleLayout}>
        <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
        <View style={styles.segmentRow}>
          {MODES.map((mode) => (
            <ReceiveModeSegment
              key={mode.id}
              mode={mode}
              selected={mode.id === selectedMode}
              segmentHeight={segmentHeight}
              labelFontSize={labelFontSize}
              labelLineHeight={labelLineHeight}
              badge={mode.id === 'private' ? privateModeBadge : undefined}
              onPress={handleSelect}
            />
          ))}
        </View>
      </View>
    </View>
  );
});

interface ReceiveModeSegmentProps {
  mode: ModeDescriptor;
  selected: boolean;
  segmentHeight: number;
  labelFontSize: number;
  labelLineHeight: number;
  badge?: number;
  onPress: (mode: ReceiveMode) => void;
}

const ReceiveModeSegment = memo(function ReceiveModeSegment({
  mode,
  selected,
  segmentHeight,
  labelFontSize,
  labelLineHeight,
  badge,
  onPress,
}: ReceiveModeSegmentProps): React.JSX.Element {
  const handlePress = useCallback(() => {
    if (!selected) onPress(mode.id);
  }, [mode.id, onPress, selected]);

  const showBadge = badge != null && badge > 0;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={mode.accessibilityLabel}
      onPress={handlePress}
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
      <View style={styles.segmentInner}>
        <Text
          variant="button"
          color={selected ? colors.text.primary : colors.text.tertiary}
          style={[
            styles.segmentText,
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
        {showBadge ? (
          <View
            style={[styles.badge, selected ? styles.badgeOnSelected : styles.badgeOnUnselected]}
            accessibilityLabel={`${badge} pending private payment${badge === 1 ? '' : 's'}`}
          >
            <Text
              variant="caption"
              color={colors.text.onAccent}
              style={styles.badgeText}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  wrapperCompact: {
    marginBottom: spacing.sm,
  },
  // Container-less segmented control — no track background, border, or
  // shadow (matches the home Portfolio/Shielded toggle). Only the
  // active segment carries a subtle frosted shade; inactive is muted
  // text.
  track: {
    width: '100%',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    padding: TRACK_PADDING,
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    boxShadow: [
      'inset 0 2px 6px rgba(0, 0, 0, 0.5)',
      'inset 0 0 12px rgba(0, 0, 0, 0.25)',
      'inset 0 -1px 1px rgba(255, 255, 255, 0.08)',
    ].join(', '),
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    backgroundColor: 'rgba(62, 62, 62, 0.95)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    boxShadow: [
      'inset 0 1px 2px rgba(255, 255, 255, 0.38)',
      'inset 0 0 10px rgba(255, 255, 255, 0.08)',
      'inset 0 -1px 3px rgba(0, 0, 0, 0.35)',
      '0 4px 10px rgba(0, 0, 0, 0.28)',
    ].join(', '),
  },
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
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
  segmentInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
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
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOnSelected: {
    backgroundColor: colors.brand.glossAccent,
  },
  badgeOnUnselected: {
    backgroundColor: colors.brand.glossAccent,
  },
  badgeText: {
    fontFamily: fontFamily.uiSemiBold,
    lineHeight: 14,
    fontSize: 12,
  },
});
