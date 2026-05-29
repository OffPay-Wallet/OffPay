import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
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
const TRACK_PADDING = 4;
const THUMB_SIZE = TRACK_HEIGHT - TRACK_PADDING * 2;
const COMPLETE_THRESHOLD = 0.78;
const SLIDE_TIMING = { duration: 160, easing: Easing.out(Easing.cubic) };

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
      translateX.value = withTiming(0, SLIDE_TIMING);
    }
  }, [loading, resetSignal, translateX]);

  useEffect(() => {
    if (effectiveLoading) {
      translateX.value = withTiming(maxTravel, SLIDE_TIMING);
      return;
    }

    completedRef.current = false;
    dragXRef.current = 0;
    startXRef.current = 0;
    translateX.value = withTiming(0, SLIDE_TIMING);
  }, [effectiveLoading, maxTravel, translateX]);

  const complete = useCallback((): void => {
    if (completedRef.current) return;
    completedRef.current = true;
    dragXRef.current = maxTravel;
    setCompletionPending(true);
    translateX.value = withTiming(maxTravel, SLIDE_TIMING);
    onComplete();
  }, [maxTravel, onComplete, translateX]);

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
          const nextX = clamp(startXRef.current + gestureState.dx, 0, maxTravel);
          dragXRef.current = nextX;
          translateX.value = nextX;
        },
        onPanResponderRelease: () => {
          if (inactive) return;
          if (dragXRef.current >= maxTravel * COMPLETE_THRESHOLD) {
            complete();
            return;
          }

          dragXRef.current = 0;
          translateX.value = withTiming(0, SLIDE_TIMING);
        },
        onPanResponderTerminate: () => {
          if (completedRef.current) return;
          dragXRef.current = 0;
          translateX.value = withTiming(0, SLIDE_TIMING);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [complete, inactive, maxTravel, translateX],
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
      <LinearGradient
        colors={
          showDangerFeedback
            ? [
                'rgba(199, 58, 58, 0.16)',
                'rgba(252, 252, 255, 0.72)',
                'rgba(199, 58, 58, 0.08)',
              ]
            : [colors.glass.strongFill, colors.glass.frostFill, colors.glass.cyanWash]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {showDangerFeedback ? null : (
        <Animated.View pointerEvents="none" style={[styles.activeFill, fillStyle]}>
          <LinearGradient
            colors={[colors.brand.azureCyan, colors.glass.azureCyanHalf, colors.glass.cyanWash]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
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
        <LinearGradient
          colors={
            showDangerFeedback
              ? [
                  'rgba(252, 252, 255, 0.76)',
                  'rgba(199, 58, 58, 0.18)',
                  'rgba(199, 58, 58, 0.1)',
                ]
              : [colors.glass.rim, colors.brand.azureCyan, colors.glass.azureCyanHalf]
          }
          start={{ x: 0.08, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.thumbGradient}
        >
          {effectiveLoading ? (
            <LazyLoadingSpinner size={26} color={colors.brand.deepShadow} />
          ) : showDangerFeedback ? (
            <Ionicons name="alert-circle-outline" size={24} color={colors.semantic.error} />
          ) : (
            <Ionicons name="arrow-forward" size={24} color={colors.brand.deepShadow} />
          )}
        </LinearGradient>
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
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    overflow: 'hidden',
    justifyContent: 'center',
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
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
    backgroundColor: colors.glass.azureCyanHalf,
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
    left: TRACK_PADDING,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.azureCyan,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxShadow: `0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  thumbDanger: {
    borderColor: 'rgba(199, 58, 58, 0.28)',
    backgroundColor: 'rgba(199, 58, 58, 0.14)',
    boxShadow: `0 8px 16px rgba(199, 58, 58, 0.08), inset 0 1px 1px rgba(255, 255, 255, 0.76)`,
  },
  thumbGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
