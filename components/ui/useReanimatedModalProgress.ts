import { useEffect, useState } from 'react';
import { Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';

import { finishAnimationPerf, markAnimationPerf } from '@/lib/perf/animation-perf';

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
  progress: SharedValue<number>;
}

export function useReanimatedModalProgress(
  visible: boolean,
  options: ReanimatedModalProgressOptions = {},
): ReanimatedModalProgress {
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const timing = options.timing ?? DEFAULT_MODAL_TIMING;
  const name = options.name ?? 'modalProgress';

  useEffect(() => {
    const startedAt = markAnimationPerf();
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, timing, (finished) => {
        runOnJS(finishAnimationPerf)(name, startedAt, finished, { phase: 'open' });
      });
      return;
    }

    progress.value = withTiming(0, timing, (finished) => {
      runOnJS(finishAnimationPerf)(name, startedAt, finished, { phase: 'close' });
      if (finished) runOnJS(setMounted)(false);
    });
  }, [name, progress, timing, visible]);

  return { mounted, progress };
}
