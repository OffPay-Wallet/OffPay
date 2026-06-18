import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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

const TRACK_HEIGHT = layout.buttonHeightLg;
const TRACK_PADDING = 3;
const THUMB_SIZE = TRACK_HEIGHT - TRACK_PADDING * 2 - 4;
const COMPLETE_THRESHOLD = 0.68;
const FAST_SWIPE_THRESHOLD = 0.46;
const DRAG_GAIN = 1.08;
const SLIDE_TIMING = { duration: 120, easing: Easing.out(Easing.cubic) };

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
  const startX = useSharedValue(0);
  const dragX = useSharedValue(0);
  const maxTravelValue = useSharedValue(0);
  const inactiveValue = useSharedValue(true);
  const completedValue = useSharedValue(false);
  const completedRef = useRef(false);
  const maxTravel = Math.max(0, trackWidth - THUMB_SIZE - TRACK_PADDING * 2);
  const effectiveLoading = loading || completionPending;
  const inactive = disabled || effectiveLoading || maxTravel <= 0;
  const showDangerFeedback = feedbackTone === 'danger' && disabled && !effectiveLoading;
  const animateThumb = useCallback(
    (toValue: number): void => {
      translateX.value = withTiming(toValue, SLIDE_TIMING);
    },
    [translateX],
  );

  useEffect(() => {
    maxTravelValue.value = maxTravel;
    inactiveValue.value = inactive;
  }, [inactive, inactiveValue, maxTravel, maxTravelValue]);

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
    completedValue.value = false;
    setCompletionPending(false);
    dragX.value = 0;
    startX.value = 0;
    if (!loading) {
      animateThumb(0);
    }
  }, [animateThumb, completedValue, dragX, loading, resetSignal, startX]);

  useEffect(() => {
    if (effectiveLoading) {
      dragX.value = maxTravel;
      animateThumb(maxTravel);
      return;
    }

    completedRef.current = false;
    completedValue.value = false;
    dragX.value = 0;
    startX.value = 0;
    animateThumb(0);
  }, [animateThumb, completedValue, dragX, effectiveLoading, maxTravel, startX]);

  const complete = useCallback((): void => {
    if (completedRef.current) return;
    completedRef.current = true;
    completedValue.value = true;
    dragX.value = maxTravel;
    setCompletionPending(true);
    animateThumb(maxTravel);
    onComplete();
  }, [animateThumb, completedValue, dragX, maxTravel, onComplete]);

  const panGesture = Gesture.Pan()
    .enabled(!inactive)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      if (inactiveValue.value) return;
      startX.value = dragX.value;
    })
    .onUpdate((event) => {
      if (inactiveValue.value || completedValue.value) return;
      const nextX = Math.max(
        0,
        Math.min(maxTravelValue.value, startX.value + event.translationX * DRAG_GAIN),
      );
      dragX.value = nextX;
      translateX.value = nextX;
    })
    .onEnd((event) => {
      if (inactiveValue.value || completedValue.value) return;
      const maxX = maxTravelValue.value;
      const fastEnough = event.velocityX > 850 && dragX.value >= maxX * FAST_SWIPE_THRESHOLD;
      if (fastEnough || dragX.value >= maxX * COMPLETE_THRESHOLD) {
        completedValue.value = true;
        dragX.value = maxX;
        translateX.value = withTiming(maxX, SLIDE_TIMING);
        runOnJS(complete)();
        return;
      }

      dragX.value = 0;
      translateX.value = withTiming(0, SLIDE_TIMING);
    })
    .onFinalize(() => {
      if (inactiveValue.value || completedValue.value) return;
      dragX.value = 0;
      translateX.value = withTiming(0, SLIDE_TIMING);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          (Math.min(trackWidth, TRACK_PADDING * 2 + THUMB_SIZE + translateX.value) - trackWidth) /
          2,
      },
      {
        scaleX:
          trackWidth > 0
            ? Math.min(trackWidth, TRACK_PADDING * 2 + THUMB_SIZE + translateX.value) / trackWidth
            : 0,
      },
    ],
  }));

  return (
    <GestureDetector gesture={panGesture}>
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
    </GestureDetector>
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
    width: '100%',
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
