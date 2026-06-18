import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';

const TRACK_HEIGHT = layout.buttonHeightLg;
const TRACK_PADDING = 3;
const THUMB_SIZE = TRACK_HEIGHT - TRACK_PADDING * 2 - 4;
const COMPLETE_THRESHOLD = 0.68;
const FAST_SWIPE_THRESHOLD = 0.46;
const DRAG_GAIN = 1.08;
const SLIDE_TIMING = { duration: 120, easing: Easing.out(Easing.cubic) };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

interface GlassSliderButtonProps {
  label: string;
  loadingLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  feedbackTone?: 'default' | 'danger';
  holdOnComplete?: boolean;
  resetSignal?: string | number | boolean | null;
  style?: StyleProp<ViewStyle>;
  onComplete: () => void;
}

export function GlassSliderButton({
  label,
  loadingLabel = 'Processing',
  disabled = false,
  loading = false,
  feedbackTone = 'default',
  holdOnComplete = false,
  resetSignal = null,
  style,
  onComplete,
}: GlassSliderButtonProps): React.JSX.Element {
  const [trackWidth, setTrackWidth] = useState(0);
  const [completionPending, setCompletionPending] = useState(false);
  const translateX = useSharedValue(0);
  const startXRef = useRef(0);
  const dragXRef = useRef(0);
  const completedRef = useRef(false);
  const maxTravel = Math.max(0, trackWidth - THUMB_SIZE - TRACK_PADDING * 2);
  const effectiveLoading = loading || completionPending;
  const inactive = disabled || effectiveLoading || maxTravel <= 0;
  const showDangerFeedback = feedbackTone === 'danger' && disabled && !effectiveLoading;
  const animateThumb = useCallback(
    (toValue: number, phase: string): void => {
      const startedAt = markAnimationPerf();
      translateX.value = withTiming(toValue, SLIDE_TIMING, (finished) => {
        runOnJS(finishAnimationPerf)('ui.glassSlider.thumb', startedAt, finished, {
          phase,
          target: Math.round(toValue),
        });
      });
    },
    [translateX],
  );

  useEffect(() => {
    if (!completionPending || loading || holdOnComplete) return;

    const fallback = setTimeout(() => {
      setCompletionPending(false);
    }, 450);

    return () => {
      clearTimeout(fallback);
    };
  }, [completionPending, holdOnComplete, loading]);

  useEffect(() => {
    completedRef.current = false;
    setCompletionPending(false);
    dragXRef.current = 0;
    startXRef.current = 0;
    if (!loading) {
      animateThumb(0, 'reset');
    }
  }, [animateThumb, loading, resetSignal]);

  useEffect(() => {
    if (effectiveLoading) {
      animateThumb(maxTravel, 'loading');
      return;
    }

    completedRef.current = false;
    dragXRef.current = 0;
    startXRef.current = 0;
    animateThumb(0, 'idle');
  }, [animateThumb, effectiveLoading, maxTravel]);

  const complete = useCallback((): void => {
    if (completedRef.current) return;
    completedRef.current = true;
    dragXRef.current = maxTravel;
    setCompletionPending(true);
    animateThumb(maxTravel, 'complete');
    onComplete();
  }, [animateThumb, maxTravel, onComplete]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !inactive,
        onStartShouldSetPanResponderCapture: () => !inactive,
        onMoveShouldSetPanResponder: () => !inactive,
        onMoveShouldSetPanResponderCapture: () => !inactive,
        onPanResponderGrant: () => {
          startXRef.current = dragXRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          if (inactive) return;
          const nextX = clamp(startXRef.current + gestureState.dx * DRAG_GAIN, 0, maxTravel);
          dragXRef.current = nextX;
          translateX.value = nextX;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (inactive) return;
          const fastEnough =
            gestureState.vx > 0.85 && dragXRef.current >= maxTravel * FAST_SWIPE_THRESHOLD;
          if (fastEnough || dragXRef.current >= maxTravel * COMPLETE_THRESHOLD) {
            complete();
            return;
          }

          dragXRef.current = 0;
          animateThumb(0, 'releaseReset');
        },
        onPanResponderTerminate: () => {
          if (completedRef.current) return;
          dragXRef.current = 0;
          animateThumb(0, 'terminateReset');
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [animateThumb, complete, inactive, maxTravel, translateX],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: Math.min(trackWidth, TRACK_PADDING * 2 + THUMB_SIZE + translateX.value),
  }));

  return (
    <View
      style={[
        styles.track,
        showDangerFeedback && styles.trackDanger,
        style,
        disabled && !effectiveLoading && !showDangerFeedback && styles.trackDisabled,
      ]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled, busy: effectiveLoading }}
      accessibilityLabel={effectiveLoading ? loadingLabel : label}
      {...panResponder.panHandlers}
    >
      {showDangerFeedback ? null : (
        <Animated.View pointerEvents="none" style={[styles.activeFill, fillStyle]} />
      )}
      <Text
        variant="button"
        color={
          showDangerFeedback
            ? colors.semantic.error
            : disabled && !effectiveLoading
              ? colors.text.tertiary
              : colors.text.primary
        }
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={[styles.label, showDangerFeedback && styles.labelDanger]}
      >
        {effectiveLoading ? loadingLabel : label}
      </Text>
      <Animated.View style={[styles.thumb, showDangerFeedback && styles.thumbDanger, thumbStyle]}>
        <View style={styles.thumbSurface}>
          {effectiveLoading ? (
            <LazyLoadingSpinner size={26} color={colors.brand.deepShadow} />
          ) : showDangerFeedback ? (
            <Ionicons name="alert-circle-outline" size={24} color={colors.semantic.error} />
          ) : (
            <Ionicons name="arrow-forward" size={24} color={colors.brand.deepShadow} />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    minHeight: TRACK_HEIGHT,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.brand.actionFill,
    overflow: 'hidden',
    justifyContent: 'center',
    boxShadow: [
      '0 14px 28px rgba(0, 0, 0, 0.36)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.16)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.32)',
    ].join(', '),
  },
  trackDisabled: {
    opacity: 0.58,
  },
  trackDanger: {
    borderColor: 'rgba(199, 58, 58, 0.34)',
    backgroundColor: 'rgba(199, 58, 58, 0.1)',
  },
  activeFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.smokeWash,
  },
  label: {
    textAlign: 'center',
    paddingHorizontal: THUMB_SIZE + spacing.md,
    fontFamily: fontFamily.uiSemiBold,
  },
  labelDanger: {
    fontFamily: fontFamily.uiBold,
  },
  thumb: {
    position: 'absolute',
    left: TRACK_PADDING + 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.glossAccent,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxShadow: [
      '0 8px 18px rgba(0, 0, 0, 0.32)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.88)',
      'inset 0 -1px 1px rgba(0, 0, 0, 0.08)',
    ].join(', '),
  },
  thumbDanger: {
    borderColor: 'rgba(199, 58, 58, 0.28)',
    backgroundColor: 'rgba(199, 58, 58, 0.14)',
    boxShadow: `0 8px 16px rgba(199, 58, 58, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.76)`,
  },
  thumbSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
