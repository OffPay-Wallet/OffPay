/**
 * Global staggered "components loading in" animation.
 *
 * Two ways to use it:
 *
 *   1. `<StaggerRevealItem index={n}>` — manual control. Give siblings
 *      an increasing `index` for the staggered cascade.
 *
 *   2. `<StaggerRevealGroup>` — wrap a screen's content; each direct
 *      child is revealed in order automatically (no manual indices).
 *      This is the preferred way to add the effect to a screen.
 *
 * Each item fades + lifts into place on the UI thread (opacity +
 * translateY only — cheap, no layout). Pass a `trigger` to replay the
 * reveal on an event (e.g. a tab/mode switch) without remounting the
 * children.
 */
import { Children, isValidElement, useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

const STAGGER_STEP_MS = 65;
const REVEAL_DURATION_MS = 340;
const REVEAL_TRANSLATE_Y = 14;
const REVEAL_EASING = Easing.out(Easing.cubic);

type TriggerValue = string | number | boolean;

export interface StaggerRevealItemProps {
  /** Zero-based position in the stagger sequence. */
  index: number;
  /**
   * Replays the reveal whenever this value changes (e.g. the active
   * tab key). Omit for a one-shot reveal on mount.
   */
  trigger?: TriggerValue;
  /** Per-item start delay offset in ms, added on top of the stagger. */
  baseDelayMs?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function StaggerRevealItem({
  index,
  trigger,
  baseDelayMs = 0,
  style,
  children,
}: StaggerRevealItemProps): React.JSX.Element {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      baseDelayMs + index * STAGGER_STEP_MS,
      withTiming(1, { duration: REVEAL_DURATION_MS, easing: REVEAL_EASING }),
    );
  }, [index, trigger, baseDelayMs, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * REVEAL_TRANSLATE_Y }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export interface StaggerRevealGroupProps {
  /**
   * Replays the reveal for every child whenever this value changes.
   * Omit for a one-shot reveal on mount.
   */
  trigger?: TriggerValue;
  /** Delay before the first child reveals, in ms. */
  baseDelayMs?: number;
  /** Style applied to the wrapping container. */
  style?: StyleProp<ViewStyle>;
  /**
   * Style applied to each per-child reveal wrapper. Use this to carry
   * layout that the children depend on (e.g. a `width: '100%'` content
   * frame), so wrapping them never collapses their width inside a
   * center-aligned parent.
   */
  itemStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Wraps a set of sibling sections and reveals each in sequence. Skips
 * `null`/`false` children when assigning indices so conditional
 * sections do not leave gaps in the cascade.
 */
export function StaggerRevealGroup({
  trigger,
  baseDelayMs = 0,
  style,
  itemStyle,
  children,
}: StaggerRevealGroupProps): React.JSX.Element {
  let visibleIndex = 0;
  const wrapped = Children.map(children, (child) => {
    if (child == null || child === false) return child;
    if (!isValidElement(child)) return child;
    const index = visibleIndex;
    visibleIndex += 1;
    return (
      <StaggerRevealItem
        index={index}
        trigger={trigger}
        baseDelayMs={baseDelayMs}
        style={itemStyle}
      >
        {child}
      </StaggerRevealItem>
    );
  });

  if (style != null) {
    return <Animated.View style={style}>{wrapped}</Animated.View>;
  }

  return <>{wrapped}</>;
}
