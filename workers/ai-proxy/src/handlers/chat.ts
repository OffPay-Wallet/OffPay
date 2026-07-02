import {
  ProviderError,
  errorStatus,
  isStrictPrivacy,
  jsonResponse,
  maxChatBytes,
  normalizeError,
  readJson,
} from '../http';
import { generateGeminiAgentTurn, generateGeminiIntent } from '../providers/gemini';
import { sanitizeChatRequestForProvider } from '../privacy/firewall';
import { sanitizeProviderText } from '../privacy/response';
import {
  validateAgentTurnRequest,
  validateChatRequest,
  validateIntentChatRequest,
} from '../schemas/requests';
import { applyAiChatCreditHeaders } from '../chat-credits';
import { runAiProxyUpstashPipeline, sha256Hex } from '../upstash';
import type { AgentChatRequest, AgentIntentResult, AgentTurn, AiProxyEnv } from '../types';
import type { AiChatCreditStatus } from '../chat-credits';

type ChatHandlerContext = {
  credits?: AiChatCreditStatus;
  releaseCreditOnStreamError?: (error: unknown) => Promise<AiChatCreditStatus>;
};

const CHAT_RESPONSE_CACHE_TTL_SEC = 120;
const CHAT_RESPONSE_CACHE_TURN_ID_PATTERN = /^[A-Za-z0-9:_-]{1,96}$/;

export async function handleChat(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
  context: ChatHandlerContext = {},
): Promise<Response> {
  const body = await readJson<AgentChatRequest>(request, maxChatBytes(env));
  const mode = body.responseMode ?? 'agent_turn';

  if (mode === 'intent_json') {
    validateIntentChatRequest(body);
    const safeBody = sanitizeChatRequestForProvider(body);
    const cacheKey = await chatResponseCacheKey(request, env, mode, safeBody);
    const cached = await getCachedChatResponse(cacheKey, env, isIntentChatResponse);
    if (cached != null) {
      return chatJsonResponse(cached, 200, cors, context.credits);
    }
    const responseBody = { intent: await generateIntent(safeBody, env) };
    await setCachedChatResponse(cacheKey, env, responseBody);
    return chatJsonResponse(responseBody, 200, cors, context.credits);
  }

  if (mode === 'agent_turn') {
    validateAgentTurnRequest(body);
    const safeBody = sanitizeChatRequestForProvider(body);
    if (body.stream === true || request.headers.get('accept')?.includes('text/event-stream')) {
      return streamAgentTurnResponse(safeBody, env, cors, context);
    }
    const cacheKey = await chatResponseCacheKey(request, env, mode, safeBody);
    const cached = await getCachedChatResponse(cacheKey, env, isAgentTurnChatResponse);
    if (cached != null) {
      return chatJsonResponse(cached, 200, cors, context.credits);
    }
    const responseBody = { turn: await generateAgentTurn(safeBody, env) };
    await setCachedChatResponse(cacheKey, env, responseBody);
    return chatJsonResponse(responseBody, 200, cors, context.credits);
  }

  // Legacy free-text path. Kept for backward compatibility — intent → text.
  validateChatRequest(body);
  const safeBody = sanitizeChatRequestForProvider(body);
  const intent = await generateIntent(safeBody, env);
  const text = renderIntentAsFreeText(intent);
  return chatJsonResponse(
    {
      responses: [
        { kind: 'chat_delta', text: sanitizeProviderText(text) },
        { kind: 'chat_done', responseId: crypto.randomUUID() },
      ],
    },
    200,
    cors,
    context.credits,
  );
}

async function chatResponseCacheKey(
  request: Request,
  env: AiProxyEnv,
  mode: 'intent_json' | 'agent_turn',
  body: AgentChatRequest,
): Promise<string | null> {
  const turnId = request.headers.get('x-offpay-ai-turn-id')?.trim() ?? '';
  if (!CHAT_RESPONSE_CACHE_TURN_ID_PATTERN.test(turnId)) return null;

  const sessionToken = request.headers.get('x-offpay-ai-session')?.trim() ?? 'anonymous';
  const cacheInput = JSON.stringify({
    mode,
    turnId,
    sessionHash: await sha256Hex(sessionToken),
    model: env.GEMINI_CHAT_MODEL?.trim() ?? null,
    groqModel: env.GROQ_CHAT_MODEL?.trim() ?? null,
    body,
  });
  return `ai-proxy:chat-response:v1:${await sha256Hex(cacheInput)}`;
}

async function getCachedChatResponse<T extends Record<string, unknown>>(
  key: string | null,
  env: AiProxyEnv,
  isValid: (value: unknown) => value is T,
): Promise<T | null> {
  if (key == null) return null;
  const result = await runAiProxyUpstashPipeline(env, [['GET', key]]);
  const raw = result?.[0];
  if (typeof raw !== 'string' || raw.length === 0) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function setCachedChatResponse(
  key: string | null,
  env: AiProxyEnv,
  value: Record<string, unknown>,
): Promise<void> {
  if (key == null) return;
  await runAiProxyUpstashPipeline(env, [
    ['SET', key, JSON.stringify(value), 'EX', CHAT_RESPONSE_CACHE_TTL_SEC],
  ]);
}

function isIntentChatResponse(value: unknown): value is { intent: AgentIntentResult } {
  return (
    typeof value === 'object' &&
    value != null &&
    'intent' in value &&
    typeof (value as { intent?: unknown }).intent === 'object'
  );
}

function isAgentTurnChatResponse(value: unknown): value is { turn: AgentTurn } {
  return (
    typeof value === 'object' &&
    value != null &&
    'turn' in value &&
    typeof (value as { turn?: unknown }).turn === 'object'
  );
}

function streamAgentTurnResponse(
  body: AgentChatRequest,
  env: AiProxyEnv,
  cors: HeadersInit,
  context: ChatHandlerContext,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (chunk: string): Promise<void> => writer.write(encoder.encode(chunk));
  const writeEvent = (event: Record<string, unknown>): Promise<void> =>
    write(`data: ${JSON.stringify(event)}\n\n`);

  void (async () => {
    try {
      await write(': offpay-ai-stream\n\n');
      const turn = await generateAgentTurn(body, env, { streamGroqFallback: true });
      if (turn.kind === 'agent_text') {
        await writeEvent({ kind: 'chat_delta', text: turn.text });
      } else {
        for (const call of turn.toolCalls) {
          await writeEvent({
            kind: 'tool_request',
            toolCallId: call.id,
            name: call.name,
            input: call.args,
          });
        }
      }
      await writeEvent({ kind: 'chat_done', responseId: crypto.randomUUID() });
      await write('data: [DONE]\n\n');
    } catch (error) {
      let releasedCredits: AiChatCreditStatus | undefined;
      if (context.releaseCreditOnStreamError != null) {
        releasedCredits = await context.releaseCreditOnStreamError(error).catch(() => undefined);
      }
      await writeEvent({
        ...normalizeError(error),
        status: errorStatus(error),
        ...(releasedCredits == null ? {} : { credits: releasedCredits }),
      });
      await write('data: [DONE]\n\n');
    } finally {
      await writer.close().catch(() => undefined);
    }
  })();

  const response = new Response(readable, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      ...cors,
    },
  });
  applyAiChatCreditHeaders(response.headers, context.credits);
  return response;
}

function renderIntentAsFreeText(intent: AgentIntentResult): string {
  if (intent.intent === 'intent_parse_error') {
    return 'I could not parse a clear intent. Try rephrasing the request in one short sentence.';
  }
  return (
    intent.clarification ??
    intent.message ??
    (intent.intent === 'draft_payment'
      ? 'Yuga parsed a payment draft intent.'
      : 'Yuga parsed the request.')
  );
}

export async function handleKindDispatch(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
  dispatch: (request: Request, env: AiProxyEnv, cors: HeadersInit) => Promise<Response>,
  dispatchVoiceSpeech: (request: Request, env: AiProxyEnv, cors: HeadersInit) => Promise<Response>,
): Promise<Response> {
  const body = await readJson<{ kind?: string }>(request, maxChatBytes(env));

  if (body.kind === 'chat') {
    return dispatch(jsonRequestFromBody(request, body), env, cors);
  }

  if (body.kind === 'voice_speech') {
    return dispatchVoiceSpeech(jsonRequestFromBody(request, body), env, cors);
  }

  return jsonResponse(
    {
      kind: 'error',
      code: 'INVALID_REQUEST',
      message: 'Use /api/ai/voice/transcribe for audio uploads.',
    },
    400,
    cors,
  );
}

async function generateIntent(body: AgentChatRequest, env: AiProxyEnv): Promise<AgentIntentResult> {
  assertGeminiAllowed(env);
  return generateGeminiIntent(body, env);
}

async function generateAgentTurn(
  body: AgentChatRequest,
  env: AiProxyEnv,
  options: { streamGroqFallback?: boolean } = {},
): Promise<AgentTurn> {
  assertGeminiAllowed(env);
  return generateGeminiAgentTurn(body, env, options);
}

function assertGeminiAllowed(env: AiProxyEnv): void {
  if (!isStrictPrivacy(env)) return;

  if (env.AI_PROXY_ALLOW_GEMINI_UNPAID === 'true') {
    throw new ProviderError('gemini', 503, 'Gemini unpaid mode is not allowed in strict privacy.');
  }

  if (env.AI_PROXY_GEMINI_PRIVACY_CONFIRMED !== 'true') {
    throw new ProviderError('gemini', 503, 'Gemini strict privacy confirmation is missing.');
  }
}

function jsonRequestFromBody(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');

  return new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function chatJsonResponse(
  body: Record<string, unknown>,
  status: number,
  cors: HeadersInit,
  credits?: AiChatCreditStatus,
): Response {
  const response = jsonResponse(
    credits == null
      ? body
      : {
          ...body,
          credits,
        },
    status,
    cors,
  );
  applyAiChatCreditHeaders(response.headers, credits);
  return response;
}
