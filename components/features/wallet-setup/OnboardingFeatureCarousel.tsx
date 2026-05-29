/**
 * OnboardingFeatureCarousel — auto-rotating hero for the onboarding screen.
 *
 * Smooth-crossfade design (Apple-style):
 *   1. Every card stays mounted for the lifetime of the screen, in
 *      its own absolutely-positioned layer. There is no React state
 *      churn between transitions, so the carousel never re-renders
 *      while the fade is in flight.
 *   2. A single Reanimated `phase` shared value is driven by
 *      `withRepeat(withTiming(N, ...))` — the timing source lives in
 *      the worklet runtime, so cycles stay vsync-aligned even when
 *      the JS thread is busy. No `setInterval`, no `runOnJS`, no
 *      React state writes.
 *   3. Each card derives its opacity, scale, and y-translate from
 *      `phase` inside `useAnimatedStyle`. Crossfades happen during
 *      a small window at the boundary between cards so two layers
 *      always animate symmetrically — there is no transparent frame.
 *   4. Icons are rendered via `expo-image` with a memory-disk cache
 *      so the GPU bitmap is decoded once on mount and reused for
 *      every subsequent fade-in, avoiding the "first frame blank"
 *      flash that pure RN `Image` shows on Android.
 *   5. A subtle 0.98 → 1.0 scale on the icon and 4dp y-translate on
 *      the copy give the transitions an Apple-style layered feel.
 *
 * Total latency overhead vs the previous implementation: zero. The
 * worklet runs on the UI thread; only the parent's first paint goes
 * through JS. Re-renders during the fade: zero.
 */
import { useEffect } from 'react';
import { StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

interface OnboardingFeatureCarouselProps {
  width: number;
  iconSize: number;
  /**
   * Vertical density tier driven by the parent screen. Drives copy
   * stage min-height, gap between icon and copy, and description
   * line-height so the carousel collapses cleanly on shorter phones.
   */
  density?: 'relaxed' | 'compact' | 'veryCompact';
}

interface FeatureCard {
  id: string;
  title: string;
  description: string;
  icon: ImageSourcePropType;
}

const CARDS: readonly FeatureCard[] = [
  {
    id: 'privacy',
    title: 'Private by default',
    description: 'Stealth payments keep balances and recipients off-chain.',
    icon: require('../../../assets/onboarding_icons/privacy.png') as ImageSourcePropType,
  },
  {
    id: 'offline',
    title: 'Pay without internet',
    description: 'Send and receive over Bluetooth when the network is gone.',
    icon: require('../../../assets/onboarding_icons/no-internet.png') as ImageSourcePropType,
  },
  {
    id: 'money',
    title: 'Money you control',
    description: 'Self-custodied stablecoins, settled in seconds on Solana.',
    icon: require('../../../assets/onboarding_icons/money.png') as ImageSourcePropType,
  },
  {
    id: 'swap',
    title: 'Swap in one tap',
    description: 'Trade between stablecoins and SOL without leaving the app.',
    icon: require('../../../assets/onboarding_icons/swap.png') as ImageSourcePropType,
  },
];

const N = CARDS.length;

// Per-card hold + crossfade window (ms). One full revolution of the
// phase counter takes `CYCLE_MS * N`. The fade window is what carves
// out the visible crossfade between adjacent cards.
const HOLD_MS = 2800;
const FADE_MS = 720;
const CYCLE_MS = HOLD_MS + FADE_MS;
const FADE_FRACTION = FADE_MS / CYCLE_MS;
// Apple's standard easing curve. Symmetric inOut gives the
// crossfade a soft entry and exit; using `Easing.inOut(Easing.quad)`
// rather than `cubic` keeps both halves a touch shorter and prevents
// the "linger" that makes long fades feel sluggish.
const FADE_EASE = Easing.inOut(Easing.quad);

// Subtle lift the icon performs on enter / exit. Keep the deltas
// small — anything > 0.04 starts to look like a Lottie animation
// rather than a soft transition.
const ICON_SCALE_MIN = 0.97;
const ICON_TRANSLATE_Y = 4;

export function OnboardingFeatureCarousel({
  width,
  iconSize,
  density = 'relaxed',
}: OnboardingFeatureCarouselProps): React.JSX.Element {
  const isCompact = density !== 'relaxed';
  const isVeryCompact = density === 'veryCompact';

  const containerGap = isVeryCompact ? 0 : isCompact ? spacing.xs : spacing.sm;
  const copyStageMinHeight = isVeryCompact ? 64 : isCompact ? 76 : 88;
  const titleFontSize = isVeryCompact ? 17 : isCompact ? 19 : 21;
  const titleLineHeight = titleFontSize + 6;
  const descriptionFontSize = isVeryCompact ? 12 : isCompact ? 13 : 14;
  const descriptionLineHeight = descriptionFontSize + 6;

  // Phase counter: ranges over [0, N) and loops forever inside the
  // worklet runtime. The reset from N → 0 lands on a card boundary
  // where every card opacity is identical to the start of the next
  // cycle, so there is no visual seam at the wrap.
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = 0;
    phase.value = withRepeat(
      withTiming(N, { duration: CYCLE_MS * N, easing: Easing.linear }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(phase);
    };
  }, [phase]);

  return (
    <View style={[styles.container, { width, gap: containerGap }]}>
      <View pointerEvents="none" style={[styles.iconStage, { width: iconSize, height: iconSize }]}>
        {CARDS.map((card, index) => (
          <CardIconLayer
            key={card.id}
            card={card}
            index={index}
            iconSize={iconSize}
            phase={phase}
          />
        ))}
      </View>

      <View pointerEvents="none" style={[styles.copyStage, { minHeight: copyStageMinHeight }]}>
        {CARDS.map((card, index) => (
          <CardCopyLayer
            key={card.id}
            card={card}
            index={index}
            phase={phase}
            titleFontSize={titleFontSize}
            titleLineHeight={titleLineHeight}
            descriptionFontSize={descriptionFontSize}
            descriptionLineHeight={descriptionLineHeight}
            density={density}
          />
        ))}
      </View>
    </View>
  );
}

type SharedPhase = ReturnType<typeof useSharedValue<number>>;

interface CardIconLayerProps {
  card: FeatureCard;
  index: number;
  iconSize: number;
  phase: SharedPhase;
}

function CardIconLayer({ card, index, iconSize, phase }: CardIconLayerProps): React.JSX.Element {
  const animatedStyle = useAnimatedStyle<ViewStyle>(() => {
    'worklet';
    const window = computeCardWindow(phase.value, index);
    const opacity = window.opacity;
    const scale = interpolate(opacity, [0, 1], [ICON_SCALE_MIN, 1], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.iconLayer, animatedStyle]}>
      <Image
        source={card.icon}
        style={{ width: iconSize, height: iconSize }}
        contentFit="contain"
        cachePolicy="memory-disk"
        priority="high"
        // The fade is what we want to animate — disable expo-image's
        // own placeholder fade so the two never compete.
        transition={0}
        accessible={false}
      />
    </Animated.View>
  );
}

interface CardCopyLayerProps {
  card: FeatureCard;
  index: number;
  phase: SharedPhase;
  titleFontSize: number;
  titleLineHeight: number;
  descriptionFontSize: number;
  descriptionLineHeight: number;
  density: 'relaxed' | 'compact' | 'veryCompact';
}

function CardCopyLayer({
  card,
  index,
  phase,
  titleFontSize,
  titleLineHeight,
  descriptionFontSize,
  descriptionLineHeight,
  density,
}: CardCopyLayerProps): React.JSX.Element {
  const animatedStyle = useAnimatedStyle<ViewStyle>(() => {
    'worklet';
    const window = computeCardWindow(phase.value, index);
    const opacity = window.opacity;
    // The copy lifts up subtly on enter and settles on exit — small
    // enough that you read it as breathing, not motion.
    const translateY = interpolate(opacity, [0, 1], [ICON_TRANSLATE_Y, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.copyLayer,
        density === 'veryCompact'
          ? styles.copyLayerVeryCompact
          : density === 'compact'
            ? styles.copyLayerCompact
            : null,
        animatedStyle,
      ]}
    >
      <Text
        variant="h2"
        color={colors.text.primary}
        align="center"
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.1}
        style={[styles.title, { fontSize: titleFontSize, lineHeight: titleLineHeight }]}
      >
        {card.title}
      </Text>
      <Text
        variant="body"
        color={colors.text.secondary}
        align="center"
        numberOfLines={3}
        maxFontSizeMultiplier={1.1}
        style={[
          styles.description,
          { fontSize: descriptionFontSize, lineHeight: descriptionLineHeight },
        ]}
      >
        {card.description}
      </Text>
    </Animated.View>
  );
}

/**
 * Computes a card's visibility window for a given phase value.
 *
 * The phase axis runs from 0 → N and loops. Each card "owns" the
 * interval [i, i + 1):
 *  - Hold:        p ∈ [0, 1 - FADE_FRACTION]  → opacity 1
 *  - Fade-out:    p ∈ [1 - FADE_FRACTION, 1]  → opacity 1 → 0
 *  - Off-stage:   p ∈ [1, N - FADE_FRACTION]  → opacity 0
 *  - Fade-in:     p ∈ [N - FADE_FRACTION, N]  → opacity 0 → 1
 *
 * `p` is the phase relative to this card, normalised into [0, N).
 *
 * Because card i's fade-out window starts at phase = i+1 - FADE_FRACTION
 * and card i+1's fade-in window ends at phase = i+1, the two cards
 * crossfade over exactly the same FADE_MS window. There is no frame
 * where both layers are at 0 opacity together — one is always on
 * its way up while the other is on its way down.
 */
function computeCardWindow(phaseValue: number, index: number): { opacity: number } {
  'worklet';
  let p = phaseValue - index;
  // Normalise into [0, N) without `%` so the worklet stays branch-free
  // for the common case where the phase has wrapped at most once.
  while (p < 0) p += N;
  while (p >= N) p -= N;

  if (p <= 1 - FADE_FRACTION) {
    return { opacity: 1 };
  }
  if (p <= 1) {
    const t = (p - (1 - FADE_FRACTION)) / FADE_FRACTION;
    return { opacity: 1 - FADE_EASE(t) };
  }
  if (p >= N - FADE_FRACTION) {
    const t = (p - (N - FADE_FRACTION)) / FADE_FRACTION;
    return { opacity: FADE_EASE(t) };
  }
  return { opacity: 0 };
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The icon stage is a fixed-size canvas so every card layer stacks
  // on top of each other without reflowing the rest of the carousel.
  iconStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The copy stage uses a density-driven minimum height (set inline)
  // so the absolute-positioned layers underneath can overlap cleanly.
  copyStage: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
  },
  copyLayer: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xs,
  },
  copyLayerCompact: {
    paddingHorizontal: spacing.xl,
  },
  copyLayerVeryCompact: {
    paddingHorizontal: spacing.lg,
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    maxWidth: 320,
  },
});
