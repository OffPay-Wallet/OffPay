import type { AiProxyEnv, AudioUpload } from './types';

export const DEFAULT_GEMINI_MODEL = 'gemma-4-26b-a4b-it';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_CHAT_BYTES = 64 * 1024;
export const DEFAULT_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_TTS_CHARS = 900;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export class ProviderError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly provider: string;

  constructor(provider: string, status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function jsonResponse(body: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...cors,
    },
  });
}

export async function readJson<T>(request: Request, maxBytes: number): Promise<T> {
  assertContentLength(request, maxBytes);
  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ProviderError('proxy', 413, 'Request body is too large.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError('proxy', 400, 'Request body must be valid JSON.');
  }
}

export async function readAudioUpload(request: Request, maxBytes: number): Promise<AudioUpload> {
  assertContentLength(request, maxBytes);
  const url = new URL(request.url);
  const languageHint =
    request.headers.get('x-offpay-language-hint') ?? url.searchParams.get('language') ?? undefined;
  const contentType = request.headers.get('content-type') ?? 'application/octet-stream';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const entry = form.get('file') ?? form.get('audio');

    if (!(entry instanceof Blob)) {
      throw new ProviderError('proxy', 400, 'Multipart audio upload requires file or audio.');
    }

    if (entry.size > maxBytes) {
      throw new ProviderError('proxy', 413, 'Audio upload is too large.');
    }

    return {
      blob: entry,
      filename:
        'name' in entry && typeof entry.name === 'string' ? entry.name : 'offpay-audio.webm',
      contentType: entry.type || 'application/octet-stream',
      languageHint: readStringFormValue(form, 'languageHint') ?? languageHint,
    };
  }

  const blob = await request.blob();

  if (blob.size > maxBytes) {
    throw new ProviderError('proxy', 413, 'Audio upload is too large.');
  }

  return {
    blob,
    filename: filenameForContentType(contentType),
    contentType,
    languageHint,
  };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('provider timeout'), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderError('provider', 504, 'Provider request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function providerErrorFromResponse(
  provider: string,
  response: Response,
  context?: Record<string, string | number | boolean | undefined>,
): Promise<ProviderError> {
  const retryAfterMs = retryAfterHeaderToMs(response.headers.get('retry-after'));
  const bodyText = await response.text().catch(() => '');
  const detail = bodyText.trim().slice(0, 1600);

  if (detail.length > 0) {
    console.warn(
      'aiProxy.providerError',
      safeJson(
        {
          provider,
          status: response.status,
          ...context,
          body: detail,
        },
        2400,
      ),
    );
  }

  return new ProviderError(
    provider,
    response.status,
    `${provider} request failed with HTTP ${response.status}.`,
    retryAfterMs,
  );
}

export function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof ProviderError) {
    // For misconfiguration-style 503s the provider's own message is more
    // useful than the generic "temporarily unavailable" copy. Pass the
    // raw message through when the worker authored it (provider field
    // is `proxy` or `gemini`) so misconfigured deploys don't look like a
    // transient outage.
    const useRawMessage =
      error.status === 503 && (error.provider === 'proxy' || error.provider === 'gemini');
    return {
      kind: 'error',
      code: codeForStatus(error.status),
      message: useRawMessage ? error.message : publicMessageForProviderError(error),
      retryAfterMs: error.retryAfterMs,
    };
  }

  return {
    kind: 'error',
    code: 'INTERNAL_ERROR',
    message: 'AI proxy request failed.',
  };
}

export function errorStatus(error: unknown): number {
  if (error instanceof ProviderError) return error.status;
  return 500;
}

export function corsHeaders(request: Request, env: AiProxyEnv): HeadersInit {
  const origin = request.headers.get('origin');
  const allowedOrigins = parseAllowedOrigins(env);
  const allowOrigin =
    origin != null && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))
      ? origin
      : allowedOrigins.includes('*')
        ? '*'
        : 'null';

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers':
      'content-type,accept,x-offpay-language-hint,x-offpay-request-id,x-offpay-ai-session,x-offpay-ai-turn-id',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function isOriginAllowed(request: Request, env: AiProxyEnv): boolean {
  const origin = request.headers.get('origin');
  const allowedOrigins = parseAllowedOrigins(env);
  return origin == null || allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

export function maxChatBytes(env: AiProxyEnv): number {
  return positiveInt(env.AI_PROXY_MAX_CHAT_BYTES, DEFAULT_MAX_CHAT_BYTES);
}

export function maxAudioBytes(env: AiProxyEnv): number {
  return positiveInt(env.AI_PROXY_MAX_AUDIO_BYTES, DEFAULT_MAX_AUDIO_BYTES);
}

export function maxTtsChars(env: AiProxyEnv): number {
  return positiveInt(env.AI_PROXY_MAX_TTS_CHARS, DEFAULT_MAX_TTS_CHARS);
}

export function providerTimeoutMs(env: AiProxyEnv): number {
  return positiveInt(env.AI_PROXY_PROVIDER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function primaryProviderTimeoutMs(env: AiProxyEnv): number {
  return positiveInt(
    env.AI_PROXY_PRIMARY_PROVIDER_TIMEOUT_MS,
    Math.min(8_000, providerTimeoutMs(env)),
  );
}

export function openRouterProviderTimeoutMs(env: AiProxyEnv): number {
  return positiveInt(env.OPENROUTER_PROVIDER_TIMEOUT_MS, Math.min(16_000, providerTimeoutMs(env)));
}

export function isTtsEnabled(env: AiProxyEnv): boolean {
  return env.AI_PROXY_TTS_ENABLED !== 'false';
}

export function isStrictPrivacy(env: AiProxyEnv): boolean {
  return env.AI_PROXY_PRIVACY_MODE !== 'relaxed';
}

/**
 * Returns the provider the deployment is pinned to, or null when voice is
 * free to fall back across providers. Only `sarvam` is recognized today;
 * any other value is treated as "no lock" so a typo cannot silently route
 * to an unintended provider.
 */
export function lockedVoiceProvider(env: AiProxyEnv): 'sarvam' | null {
  return env.AI_PROXY_VOICE_PROVIDER_LOCK?.trim().toLowerCase() === 'sarvam' ? 'sarvam' : null;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x2000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

export function contentTypeForAudioCodec(codec: string): string {
  if (codec === 'mp3') return 'audio/mpeg';
  if (codec === 'wav') return 'audio/wav';
  if (codec === 'opus') return 'audio/opus';
  if (codec === 'aac') return 'audio/aac';
  if (codec === 'flac') return 'audio/flac';
  return 'audio/wav';
}

export function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function safeJson(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value);
  return json.length > maxChars ? `${json.slice(0, maxChars)}...` : json;
}

function readStringFormValue(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function filenameForContentType(contentType: string): string {
  if (contentType.includes('wav')) return 'offpay-audio.wav';
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'offpay-audio.mp3';
  if (contentType.includes('mp4') || contentType.includes('m4a')) return 'offpay-audio.m4a';
  if (contentType.includes('ogg')) return 'offpay-audio.ogg';
  return 'offpay-audio.webm';
}

function assertContentLength(request: Request, maxBytes: number): void {
  const length = Number(request.headers.get('content-length') ?? 0);

  if (Number.isFinite(length) && length > maxBytes) {
    throw new ProviderError('proxy', 413, 'Request body is too large.');
  }
}

function retryAfterHeaderToMs(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}

function parseAllowedOrigins(env: AiProxyEnv): string[] {
  const raw = env.AI_PROXY_ALLOWED_ORIGINS?.trim();
  if (raw == null || raw.length === 0) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function codeForStatus(status: number): string {
  if (status === 400 || status === 422) return 'INVALID_REQUEST';
  if (status === 401 || status === 403) return 'PROVIDER_AUTH';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 504) return 'UPSTREAM_TIMEOUT';
  return 'UPSTREAM_UNAVAILABLE';
}

function publicMessageForStatus(status: number): string {
  if (status === 400 || status === 422) return 'The AI proxy request is invalid.';
  if (status === 401 || status === 403) return 'The configured AI provider rejected the request.';
  if (status === 413) return 'The AI proxy request is too large.';
  if (status === 429) return 'The AI provider is rate limited. Try again shortly.';
  if (status === 504) return 'The AI provider timed out. Try again.';
  return 'The AI provider is temporarily unavailable.';
}

function publicMessageForProviderError(error: ProviderError): string {
  if (error.provider === 'gemini' && (error.status === 400 || error.status === 422)) {
    return 'The configured AI model rejected the request.';
  }
  return publicMessageForStatus(error.status);
}
