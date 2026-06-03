import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Network } from './types.js';
import { sanitizeForLog } from './sanitise.js';

interface SafeRequestLog {
  requestId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  wallet?: string;
  network?: Network;
  errorCode?: string;
}

interface SafeOperationalLog {
  event: string;
  requestId?: string;
  network?: Network;
  details?: unknown;
}

function resolveRequestNetwork(url: string, headerValue?: string | null): Network | undefined {
  const candidateValues = [headerValue?.trim() ?? ''];

  try {
    candidateValues.push(new URL(url).searchParams.get('network')?.trim() ?? '');
  } catch {
    // Some tests and synthetic contexts provide path-only URLs; ignore query extraction there.
  }

  for (const candidate of candidateValues) {
    if (candidate === 'devnet' || candidate === 'mainnet') {
      return candidate;
    }
  }

  return undefined;
}

function writeSanitizedLog(level: 'info' | 'warn' | 'error', payload: unknown): void {
  const serialized = JSON.stringify(
    sanitizeForLog({
      level,
      timestamp: new Date().toISOString(),
      ...((payload && typeof payload === 'object') ? payload : { payload }),
    }),
  );

  if (level === 'error') {
    console.error(serialized);
    return;
  }

  if (level === 'warn') {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
}

function writeStructuredLog(level: 'info' | 'warn' | 'error', event: SafeRequestLog): void {
  writeSanitizedLog(level, event);
}

function writeOperationalLog(level: 'info' | 'warn' | 'error', event: SafeOperationalLog): void {
  writeSanitizedLog(level, event);
}

const requestContextMiddleware: MiddlewareHandler<AppEnv> = async (context, next) => {
  context.set('requestId', crypto.randomUUID());
  context.set('requestStartedAt', Date.now());
  const inferredNetwork = resolveRequestNetwork(context.req.url, context.req.header('X-Network'));
  if (inferredNetwork) {
    context.set('network', inferredNetwork);
  }

  await next();

  const requestId = context.get('requestId');
  if (requestId) {
    context.res.headers.set('X-Request-Id', requestId);
  }
};

const requestLoggingMiddleware: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();

  const requestStartedAt = context.get('requestStartedAt') ?? Date.now();
  const requestId = context.get('requestId') ?? 'unknown';
  const wallet = context.get('wallet');
  const network = context.get('network');
  const errorCode = context.res.headers.get('X-Error-Code') ?? undefined;

  const logEventBase = {
    requestId,
    method: context.req.method,
    path: context.req.path,
    status: context.res.status,
    latencyMs: Date.now() - requestStartedAt,
  };

  const logEvent: SafeRequestLog = {
    ...logEventBase,
    ...(wallet ? { wallet } : {}),
    ...(network ? { network } : {}),
    ...(errorCode ? { errorCode } : {}),
  };

  if (context.res.status >= 500) {
    writeStructuredLog('error', logEvent);
    return;
  }

  if (context.res.status >= 400) {
    writeStructuredLog('warn', logEvent);
    return;
  }

  writeStructuredLog('info', logEvent);
};

export { requestContextMiddleware, requestLoggingMiddleware, writeOperationalLog, writeStructuredLog };
