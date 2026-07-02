import { AppError } from './errors.js';
import type { Bindings } from './types.js';

function getRequiredBinding(bindings: Bindings, key: keyof Bindings): string {
  const rawValue = bindings[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return value;
}

function getRequiredUpstashBinding(bindings: Bindings, kind: 'url' | 'token'): string {
  const preferred =
    kind === 'url' ? bindings.UPSTASH_REDIS_REST_URL : bindings.UPSTASH_REDIS_REST_TOKEN;
  const legacy = kind === 'url' ? bindings.KV_REST_API_URL : bindings.KV_REST_API_TOKEN;
  const value = typeof preferred === 'string' && preferred.trim().length > 0 ? preferred : legacy;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return trimmed;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function sanitizeText(value: string | null | undefined, maxLength = 160): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

// Upstash is a network hop on the read hot path, and a slow Redis call blocks the
// resolver it is supposed to accelerate. Bound it tightly: on timeout the
// shared cache degrades to a miss (callers already treat a throw as
// unavailable) and the authoritative upstream read proceeds.
const KV_PIPELINE_TIMEOUT_MS = 1000;

async function runKvPipeline(
  bindings: Bindings,
  commands: ReadonlyArray<ReadonlyArray<string | number>>,
  unavailableMessage: string,
): Promise<unknown[]> {
  const endpoint = getRequiredUpstashBinding(bindings, 'url').replace(/\/$/, '');
  const token = getRequiredUpstashBinding(bindings, 'token');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Shared cache request timed out after ${KV_PIPELINE_TIMEOUT_MS}ms`));
  }, KV_PIPELINE_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(`${endpoint}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: unavailableMessage,
        retryable: true,
        cause: error,
      });
    }

    if (!response.ok) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: unavailableMessage,
        retryable: true,
      });
    }

    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const erroredEntry = payload.find((entry) => entry.error);
    if (erroredEntry?.error) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: unavailableMessage,
        retryable: true,
      });
    }

    return payload.map((entry) => entry.result ?? null);
  } finally {
    clearTimeout(timeoutId);
  }
}

export {
  getRequiredBinding,
  getRequiredUpstashBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
};
