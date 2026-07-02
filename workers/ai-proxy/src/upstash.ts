import type { AiProxyEnv } from './types';

const DEFAULT_UPSTASH_TIMEOUT_MS = 750;

type UpstashCommand = ReadonlyArray<string | number>;

function upstashRestUrl(env: AiProxyEnv): string {
  return (env.UPSTASH_REDIS_REST_URL?.trim() ?? env.KV_REST_API_URL?.trim() ?? '').replace(
    /\/$/,
    '',
  );
}

function upstashRestToken(env: AiProxyEnv): string {
  return env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? env.KV_REST_API_TOKEN?.trim() ?? '';
}

export function hasAiProxyUpstash(env: AiProxyEnv): boolean {
  return Boolean(upstashRestUrl(env) && upstashRestToken(env));
}

export async function runAiProxyUpstashPipeline(
  env: AiProxyEnv,
  commands: ReadonlyArray<UpstashCommand>,
  options: { timeoutMs?: number } = {},
): Promise<unknown[] | null> {
  const endpoint = upstashRestUrl(env);
  const token = upstashRestToken(env);
  if (endpoint.length === 0 || token.length === 0) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('AI proxy Upstash request timed out.'));
  }, options.timeoutMs ?? DEFAULT_UPSTASH_TIMEOUT_MS);

  try {
    const response = await fetch(`${endpoint}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(payload) || payload.some((entry) => entry.error != null)) return null;
    return payload.map((entry) => entry.result ?? null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
