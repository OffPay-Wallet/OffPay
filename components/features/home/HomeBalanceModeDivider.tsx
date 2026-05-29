import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
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
const TRACK_ANIMATION = { duration: 240, easing: Easing.out(Easing.cubic) };

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

  useEffect(() => {
    thumbOffset.value = withTiming(selectedIndex * (segmentWidth + SEGMENT_GAP), TRACK_ANIMATION);
  }, [selectedIndex, segmentWidth, thumbOffset]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbOffset.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(180).delay(60)}
      style={[styles.wrapper, compact && styles.wrapperCompact]}
    >
      <LinearGradient
        colors={[colors.glass.strongFill, colors.glass.frostFill, colors.glass.clearFill]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
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
            : MODES.map((mode) => {
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
                      if (!selected) onChangeMode(mode.id);
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
      </LinearGradient>
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
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.clearFill,
    padding: TRACK_PADDING,
    boxShadow: `0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.1)`,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    backgroundColor: colors.brand.azureCyan,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    boxShadow: `0 10px 20px rgba(14, 42, 53, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.76)`,
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
