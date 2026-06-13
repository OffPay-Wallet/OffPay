import type {
  AgentChatEvent,
  AgentChatRequest,
  AgentIntentRequest,
  AgentIntentResult,
  AgentProxyErrorEvent,
  AgentTurn,
  AgentTurnRequest,
  VoiceSpeechRequest,
  VoiceSpeechResult,
  VoiceTranscriptionResult,
} from '@/lib/agentic-payments/types';
import {
  buildOffpayAiSessionToken,
  isOffpayAiSessionTokenConfigured,
  OffpayAiSessionTokenUnavailableError,
} from '@/lib/agentic-payments/session-token';
import { sanitizeTextForCloudTts } from '@/lib/agentic-payments/voice-privacy';
import { File as ExpoFile, UploadType } from 'expo-file-system';

const DEFAULT_CHAT_TIMEOUT_MS = 25_000;
const DEFAULT_VOICE_TIMEOUT_MS = 35_000;

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isLocalDevelopmentOrigin(url: URL): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  );
}

function normalizeProxyOrigin(rawValue: string, envKey: string): string {
  const parsed = new URL(rawValue);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error(`${envKey} must be an origin only.`);
  }

  if (parsed.protocol !== 'https:' && !isLocalDevelopmentOrigin(parsed)) {
    throw new Error(`${envKey} must use HTTPS outside local development.`);
  }

  return parsed.origin;
}

function resolveAiProxyOrigin(): string {
  const rawOrigin = process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_URL?.trim();
  if (!rawOrigin) return '';

  const origin = normalizeProxyOrigin(rawOrigin, 'EXPO_PUBLIC_OFFPAY_AI_PROXY_URL');
  const allowedOrigins = splitCsv(process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS).map(
    (entry) => normalizeProxyOrigin(entry, 'EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS'),
  );
  const effectiveAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : [origin];

  if (!effectiveAllowedOrigins.includes(origin)) {
    throw new Error('EXPO_PUBLIC_OFFPAY_AI_PROXY_URL is not in EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS.');
  }

  return origin;
}

const AI_PROXY_ORIGIN = resolveAiProxyOrigin();

export class AgenticPaymentsProxyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(params: { code: string; message: string; status: number; retryAfterMs?: number }) {
    super(params.message);
    this.name = 'AgenticPaymentsProxyError';
    this.code = params.code;
    this.status = params.status;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export function isAgenticPaymentsProxyConfigured(): boolean {
  return AI_PROXY_ORIGIN.length > 0;
}

export async function sendAgentChat(
  request: AgentChatRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AgentChatEvent[]> {
  const response = await proxyFetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      stream: false,
    }),
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
  });

  const body = (await response.json()) as { responses?: AgentChatEvent[] };
  return Array.isArray(body.responses) ? body.responses : [];
}

export async function sendAgentIntent(
  request: AgentIntentRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AgentIntentResult> {
  const response = await proxyFetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      responseMode: 'intent_json',
      stream: false,
    }),
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
  });

  const body = (await response.json()) as { intent?: AgentIntentResult };
  if (body.intent?.kind === 'intent_result') return body.intent;

  throw new AgenticPaymentsProxyError({
    code: 'INVALID_INTENT_RESPONSE',
    message: 'Yuga returned an invalid intent response.',
    status: 502,
  });
}

export async function sendAgentTurn(
  request: AgentTurnRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AgentTurn> {
  const response = await proxyFetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      responseMode: 'agent_turn',
      stream: false,
    }),
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
  });

  const body = (await response.json()) as { turn?: AgentTurn };
  if (body.turn != null && (body.turn.kind === 'agent_text' || body.turn.kind === 'agent_tool_calls')) {
    return body.turn;
  }

  throw new AgenticPaymentsProxyError({
    code: 'INVALID_AGENT_TURN_RESPONSE',
    message: 'Yuga returned an invalid agent turn response.',
    status: 502,
  });
}

export async function streamAgentChat(
  request: AgentChatRequest,
  handlers: {
    onEvent: (event: AgentChatEvent) => void;
    onError?: (event: AgentProxyErrorEvent) => void;
  },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  const response = await proxyFetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      stream: true,
    }),
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS,
  });

  if (response.body == null || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    for (const event of parseSseEvents(text)) {
      dispatchChatEvent(event, handlers);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      dispatchChatEvent(event, handlers);
    }
  }

  if (buffer.trim().length > 0) {
    for (const event of parseSseEvents(`${buffer}\n\n`)) {
      dispatchChatEvent(event, handlers);
    }
  }
}

export async function transcribeAgentVoice(
  audio: Blob | FormData | VoiceAudioFileUpload,
  options: {
    languageHint?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<VoiceTranscriptionResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (options.languageHint != null) {
    headers['x-offpay-language-hint'] = options.languageHint;
  }

  if (isVoiceAudioFileUpload(audio)) {
    const result = await proxyUploadFile('/api/ai/voice/transcribe', {
      uri: audio.uri,
      contentType: audio.contentType,
      headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS,
    });

    return parseVoiceTranscriptionUploadResult(result);
  }

  const response = await proxyFetch('/api/ai/voice/transcribe', {
    method: 'POST',
    headers,
    body: audio,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS,
  });

  return (await response.json()) as VoiceTranscriptionResult;
}

export interface VoiceAudioFileUpload {
  uri: string;
  contentType: string;
}

function isVoiceAudioFileUpload(value: unknown): value is VoiceAudioFileUpload {
  return (
    typeof value === 'object' &&
    value != null &&
    'uri' in value &&
    typeof (value as { uri?: unknown }).uri === 'string' &&
    'contentType' in value &&
    typeof (value as { contentType?: unknown }).contentType === 'string'
  );
}

async function parseVoiceTranscriptionUploadResult(params: {
  status: number;
  body: string;
  headers: Record<string, string>;
}): Promise<VoiceTranscriptionResult> {
  if (params.status < 200 || params.status >= 300) {
    throw errorFromUploadResult(params);
  }

  try {
    return JSON.parse(params.body) as VoiceTranscriptionResult;
  } catch {
    throw new AgenticPaymentsProxyError({
      code: 'INVALID_VOICE_TRANSCRIPTION_RESPONSE',
      message: 'Yuga returned an invalid voice transcription response.',
      status: 502,
    });
  }
}

export async function speakAgentText(
  request: VoiceSpeechRequest,
  options: { signal?: AbortSignal; timeoutMs?: number; payrollMode?: boolean } = {},
): Promise<VoiceSpeechResult> {
  const safeRequest: VoiceSpeechRequest = {
    ...request,
    text: sanitizeTextForCloudTts(request.text, { payrollMode: options.payrollMode }),
  };
  const response = await proxyFetch('/api/ai/voice/speech', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(safeRequest),
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS,
  });

  return (await response.json()) as VoiceSpeechResult;
}

async function proxyFetch(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  if (!isAgenticPaymentsProxyConfigured()) {
    throw new AgenticPaymentsProxyError({
      code: 'PROXY_NOT_CONFIGURED',
      message: 'Yuga is not configured.',
      status: 0,
    });
  }

  const headers = await attachSessionTokenHeader(init.headers);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('ai proxy timeout'), init.timeoutMs);
  const abortListener = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const response = await fetch(buildProxyUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    return response;
  } catch (error) {
    if (controller.signal.aborted && init.signal?.aborted !== true) {
      throw new AgenticPaymentsProxyError({
        code: 'PROXY_TIMEOUT',
        message: 'Yuga timed out.',
        status: 0,
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortListener);
  }
}

async function proxyUploadFile(
  path: string,
  params: {
    uri: string;
    contentType: string;
    headers: HeadersInit;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  if (!isAgenticPaymentsProxyConfigured()) {
    throw new AgenticPaymentsProxyError({
      code: 'PROXY_NOT_CONFIGURED',
      message: 'Yuga is not configured.',
      status: 0,
    });
  }

  const headers = headersInitToRecord(await attachSessionTokenHeader(params.headers));
  headers['content-type'] = params.contentType;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('ai proxy timeout'), params.timeoutMs);
  const abortListener = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const file = new ExpoFile(params.uri);
    return await file.upload(buildProxyUrl(path), {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && params.signal?.aborted !== true) {
      throw new AgenticPaymentsProxyError({
        code: 'PROXY_TIMEOUT',
        message: 'Yuga timed out.',
        status: 0,
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', abortListener);
  }
}

/**
 * If the AI session secret is configured for this build, mint a short-lived
 * signed token and attach it on every proxy request. Build-time configs
 * that don't have the secret skip this; the Worker decides whether to
 * enforce it via `AI_PROXY_REQUIRE_SESSION_TOKEN`.
 */
async function attachSessionTokenHeader(
  headers: HeadersInit | undefined,
): Promise<HeadersInit | undefined> {
  if (!isOffpayAiSessionTokenConfigured()) return headers;

  try {
    const session = await buildOffpayAiSessionToken();
    if (session == null) return headers;
    const merged = new Headers(headers);
    merged.set('x-offpay-ai-session', session.token);
    return merged;
  } catch (error) {
    if (error instanceof OffpayAiSessionTokenUnavailableError) {
      throw new AgenticPaymentsProxyError({
        code: 'SESSION_TOKEN_UNAVAILABLE',
        message: error.message,
        status: 401,
      });
    }
    throw error;
  }
}

function headersInitToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const merged = new Headers(headers);
  const record: Record<string, string> = {};
  merged.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

async function errorFromResponse(response: Response): Promise<AgenticPaymentsProxyError> {
  const retryAfterMs = retryAfterHeaderToMs(response.headers.get('retry-after'));

  try {
    const body = (await response.json()) as Partial<AgentProxyErrorEvent>;
    return new AgenticPaymentsProxyError({
      code: typeof body.code === 'string' ? body.code : 'AI_PROXY_ERROR',
      message: typeof body.message === 'string' ? body.message : 'Yuga request failed.',
      status: response.status,
      retryAfterMs: body.retryAfterMs ?? retryAfterMs,
    });
  } catch {
    return new AgenticPaymentsProxyError({
      code: 'AI_PROXY_ERROR',
      message: 'Yuga request failed.',
      status: response.status,
      retryAfterMs,
    });
  }
}

function errorFromUploadResult(params: {
  status: number;
  body: string;
  headers: Record<string, string>;
}): AgenticPaymentsProxyError {
  const retryAfterMs = retryAfterHeaderToMs(
    params.headers['retry-after'] ?? params.headers['Retry-After'] ?? null,
  );

  try {
    const body = JSON.parse(params.body) as Partial<AgentProxyErrorEvent>;
    return new AgenticPaymentsProxyError({
      code: typeof body.code === 'string' ? body.code : 'AI_PROXY_ERROR',
      message: typeof body.message === 'string' ? body.message : 'Yuga request failed.',
      status: params.status,
      retryAfterMs: body.retryAfterMs ?? retryAfterMs,
    });
  } catch {
    return new AgenticPaymentsProxyError({
      code: 'AI_PROXY_ERROR',
      message: 'Yuga request failed.',
      status: params.status,
      retryAfterMs,
    });
  }
}

function buildProxyUrl(path: string): string {
  return `${AI_PROXY_ORIGIN.replace(/\/+$/, '')}${path}`;
}

function dispatchChatEvent(
  event: AgentChatEvent,
  handlers: {
    onEvent: (event: AgentChatEvent) => void;
    onError?: (event: AgentProxyErrorEvent) => void;
  },
): void {
  handlers.onEvent(event);

  if (event.kind === 'error') {
    handlers.onError?.(event);
  }
}

function consumeSseBuffer(buffer: string): { events: AgentChatEvent[]; remainder: string } {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() ?? '';
  return {
    events: parts.flatMap(parseSseEvents),
    remainder,
  };
}

export function parseSseEvents(text: string): AgentChatEvent[] {
  return text
    .split(/\n\n/)
    .map((part) =>
      part
        .split(/\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n'),
    )
    .filter((data) => data.length > 0 && data !== '[DONE]')
    .map((data) => JSON.parse(data) as AgentChatEvent);
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
