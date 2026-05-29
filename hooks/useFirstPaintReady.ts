import { useEffect, useState } from 'react';

import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';

/**
 * Returns `true` after the first paint cycle has completed plus any
 * idle window detected by `scheduleUiWorkAfterFirstPaint`. Returns
 * `false` synchronously on the first render so consumers can gate
 * non-critical startup work behind a stable signal.
 *
 * The launch provider already schedules its own work directly through
 * `scheduleUiWorkAfterFirstPaint`. This hook is for components that
 * want to expose a *gated* boolean to other state (e.g. an `enabled`
 * flag passed into a sub-hook) instead of a one-shot side effect.
 *
 * The scheduled task is cancelled on unmount, so a fast-mount/unmount
 * cycle (e.g. a parent that briefly mounts the launch provider) does
 * not flip the boolean true after the consumer is gone.
 *
 * Internally uses `scheduleUiWorkAfterFirstPaint` with a small
 * fallback delay so devices without `requestIdleCallback` don't sit
 * waiting past the first paint frame.
 */
export function useFirstPaintReady(options?: {
  fallbackDelayMs?: number;
  timeoutMs?: number;
}): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const scheduled = scheduleUiWorkAfterFirstPaint(
      () => {
        setReady(true);
      },
      {
        fallbackDelayMs: options?.fallbackDelayMs ?? 200,
        timeoutMs: options?.timeoutMs ?? 2500,
      },
    );

    return () => {
      scheduled.cancel();
    };
  }, [options?.fallbackDelayMs, options?.timeoutMs]);

  return ready;
}
