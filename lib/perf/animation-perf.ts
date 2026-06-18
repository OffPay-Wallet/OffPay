import { mark, measure } from '@/lib/perf/perf-marks';

type AnimationPerfPayload = Record<string, string | number | boolean | null>;

export function markAnimationPerf(): number {
  return mark();
}

export function finishAnimationPerf(
  name: string,
  startedAt: number,
  finished: boolean | undefined,
  payload?: AnimationPerfPayload,
): void {
  measure(`animation.${name}`, startedAt, {
    ...(payload ?? {}),
    finished: finished === true,
  });
}
