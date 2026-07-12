import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { EasingFunction, SharedValue } from 'react-native-reanimated';

interface UseLoopingProgressOptions {
  active?: boolean;
  durationMs: number;
  easing?: EasingFunction;
  reverse?: boolean;
}

export function shouldRunLoopingProgress(active: boolean, reduceMotion: boolean): boolean {
  return active && !reduceMotion;
}

/**
 * Starts and owns an imperative Reanimated loop on a mutable shared value.
 * `useDerivedValue` must not be used for standalone loops because it has no
 * changing input to re-run from and can remain at its initial frame.
 */
export function useLoopingProgress({
  active = true,
  durationMs,
  easing = Easing.linear,
  reverse = false,
}: UseLoopingProgressOptions): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;

    if (shouldRunLoopingProgress(active, reduceMotion)) {
      progress.value = withRepeat(
        withTiming(1, {
          duration: durationMs,
          easing,
        }),
        -1,
        reverse,
      );
    }

    return () => {
      cancelAnimation(progress);
    };
  }, [active, durationMs, easing, progress, reduceMotion, reverse]);

  return progress;
}
