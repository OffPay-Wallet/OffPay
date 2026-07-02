export interface AiProxyTimingContext {
  requestId: string;
  startedAt: number;
  timings: Array<{ name: string; durationMs: number }>;
}

const MAX_SERVER_TIMING_METRICS = 16;

export function createAiProxyTimingContext(request: Request): AiProxyTimingContext {
  const requestId = request.headers.get('x-offpay-request-id')?.trim() || crypto.randomUUID();
  return {
    requestId,
    startedAt: performance.now(),
    timings: [],
  };
}

export async function timeAiProxyStage<T>(
  timing: AiProxyTimingContext,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    recordAiProxyTiming(timing, name, performance.now() - startedAt);
  }
}

export function recordAiProxyTiming(
  timing: AiProxyTimingContext,
  name: string,
  durationMs: number,
): void {
  timing.timings.push({ name, durationMs });
}

export function applyAiProxyTimingHeaders(
  response: Response,
  timing: AiProxyTimingContext,
): Response {
  recordAiProxyTiming(timing, 'total', performance.now() - timing.startedAt);
  response.headers.set('X-Request-Id', timing.requestId);
  response.headers.set(
    'Server-Timing',
    timing.timings.slice(0, MAX_SERVER_TIMING_METRICS).map(formatServerTimingMetric).join(', '),
  );
  return response;
}

function formatServerTimingMetric(metric: { name: string; durationMs: number }): string {
  const name = metric.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'metric';
  const duration = Number.isFinite(metric.durationMs) ? metric.durationMs.toFixed(1) : '0.0';
  return `${name};dur=${duration}`;
}
