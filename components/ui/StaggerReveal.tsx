/**
 * Lightweight screen reveal.
 *
 * This used to stagger every child with a 65ms step and a 340ms lift,
 * which made tab and FAB navigations read as delayed. The public API is
 * kept so screens do not need to change, but the implementation now
 * reveals all children together with a short opacity/translateY tween.
 */
import { Children, isValidElement } from 'react';
import Animated, { Easing, FadeIn } from 'react-native-reanimated';

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

const REVEAL_DURATION_MS = 120;
const REVEAL_TRANSLATE_Y = 4;
const REVEAL_EASING = Easing.out(Easing.cubic);
const REVEAL_ENTERING = FadeIn.duration(REVEAL_DURATION_MS)
  .easing(REVEAL_EASING)
  .withInitialValues({
    opacity: 0,
    transform: [{ translateY: REVEAL_TRANSLATE_Y }],
  });

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
  void baseDelayMs;
  const revealKey = `${String(trigger ?? 'initial')}-${index}`;

  return (
    <Animated.View key={revealKey} entering={REVEAL_ENTERING} style={style}>
      {children}
    </Animated.View>
  );
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
