import { useEffect, useState } from 'react';
import { Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';

import type { SharedValue, WithTimingConfig } from 'react-native-reanimated';

const DEFAULT_MODAL_TIMING: WithTimingConfig = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
};

interface ReanimatedModalProgressOptions {
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

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, timing);
      return;
    }

    progress.value = withTiming(0, timing, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [progress, timing, visible]);

  return { mounted, progress };
}
