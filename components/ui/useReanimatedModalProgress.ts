import { useEffect, useState } from 'react';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import type { SharedValue, WithTimingConfig } from 'react-native-reanimated';

const DEFAULT_MODAL_TIMING: WithTimingConfig = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
};

interface ReanimatedModalProgressOptions {
  name?: string;
  timing?: WithTimingConfig;
}

interface ReanimatedModalProgress {
  mounted: boolean;
  progress: Pick<SharedValue<number>, 'value'>;
}

export function useReanimatedModalProgress(
  visible: boolean,
  options: ReanimatedModalProgressOptions = {},
): ReanimatedModalProgress {
  const [mounted, setMounted] = useState(visible);
  const timing = options.timing ?? DEFAULT_MODAL_TIMING;
  const targetProgress = visible ? 1 : 0;
  const progress = useDerivedValue(
    () => withTiming(targetProgress, timing),
    [targetProgress, timing],
  );

  useEffect(() => {
    void options.name;
    if (visible) {
      setMounted(true);
    }
  }, [options.name, visible]);

  useAnimatedReaction(
    () => progress.value,
    (current) => {
      if (visible || !mounted || current > 0.001) {
        return;
      }
      runOnJS(setMounted)(false);
    },
    [mounted, visible],
  );

  return { mounted, progress };
}
