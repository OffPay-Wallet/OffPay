import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv, RequestCacheStatus, RequestTimingMetric } from './types.js';

const MAX_SERVER_TIMING_METRICS = 16;
const CACHE_STATUS_HEADER = 'X-OffPay-Cache';
const REQUEST_ID_HEADER = 'X-Request-Id';
const PROTOCOL_HEADER = 'X-Protocol';
const SERVER_TIMING_HEADER = 'Server-Timing';

function formatDurationMs(durationMs: number): string {
  return Number.isFinite(durationMs) ? durationMs.toFixed(1) : '0.0';
}

function formatServerTimingMetric(metric: RequestTimingMetric): string {
  const name = metric.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'metric';
  return `${name};dur=${formatDurationMs(metric.durationMs)}`;
}

function getRequestProtocol(context: Context<AppEnv>): string {
  const cf = (context.req.raw as { cf?: { httpProtocol?: unknown } }).cf;
  return typeof cf?.httpProtocol === 'string' && cf.httpProtocol.length > 0
    ? cf.httpProtocol
    : 'unknown';
}

export const requestTimingMiddleware: MiddlewareHandler<AppEnv> = async (context, next) => {
  const startedAt = performance.now();
  context.set('requestTimings', []);
  context.set('requestCacheStatus', 'bypass');

  await next();

  recordRequestTiming(context, 'total', performance.now() - startedAt);

  const timings = context.get('requestTimings') ?? [];
  if (timings.length > 0) {
    context.res.headers.set(
      SERVER_TIMING_HEADER,
      timings.slice(0, MAX_SERVER_TIMING_METRICS).map(formatServerTimingMetric).join(', '),
    );
  }

  const requestId = context.get('requestId');
  if (requestId != null && requestId.length > 0) {
    context.res.headers.set(REQUEST_ID_HEADER, requestId);
  }

  context.res.headers.set(CACHE_STATUS_HEADER, context.get('requestCacheStatus') ?? 'bypass');
  context.res.headers.set(PROTOCOL_HEADER, getRequestProtocol(context));
};

export function recordRequestTiming(
  context: Context<AppEnv>,
  name: string,
  durationMs: number,
): void {
  const timings = context.get('requestTimings') ?? [];
  timings.push({ name, durationMs });
  context.set('requestTimings', timings);
}

export function setRequestCacheStatus(context: Context<AppEnv>, status: RequestCacheStatus): void {
  const current = context.get('requestCacheStatus');
  if (current === 'hit' && status === 'miss') return;
  context.set('requestCacheStatus', status);
}

export function waitUntil(context: Context<AppEnv>, task: Promise<unknown>): void {
  const guardedTask = task.catch(() => undefined);
  const executionContext = context.executionCtx;
  if (executionContext != null && typeof executionContext.waitUntil === 'function') {
    executionContext.waitUntil(guardedTask);
    return;
  }

  void guardedTask;
}
