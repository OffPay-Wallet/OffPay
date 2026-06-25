import { ProviderError, isStrictPrivacy, jsonResponse, maxChatBytes, readJson } from '../http';
import { generateGeminiAgentTurn, generateGeminiIntent } from '../providers/gemini';
import { sanitizeChatRequestForProvider } from '../privacy/firewall';
import { sanitizeProviderText } from '../privacy/response';
import {
  validateAgentTurnRequest,
  validateChatRequest,
  validateIntentChatRequest,
} from '../schemas/requests';
import type { AgentChatRequest, AgentIntentResult, AgentTurn, AiProxyEnv } from '../types';

export async function handleChat(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
): Promise<Response> {
  const body = await readJson<AgentChatRequest>(request, maxChatBytes(env));
  const mode = body.responseMode ?? 'agent_turn';

  if (mode === 'intent_json') {
    validateIntentChatRequest(body);
    const safeBody = sanitizeChatRequestForProvider(body);
    return jsonResponse({ intent: await generateIntent(safeBody, env) }, 200, cors);
  }

  if (mode === 'agent_turn') {
    validateAgentTurnRequest(body);
    const safeBody = sanitizeChatRequestForProvider(body);
    return jsonResponse({ turn: await generateAgentTurn(safeBody, env) }, 200, cors);
  }

  // Legacy free-text path. Kept for backward compatibility — intent → text.
  validateChatRequest(body);
  const safeBody = sanitizeChatRequestForProvider(body);
  const intent = await generateIntent(safeBody, env);
  const text = renderIntentAsFreeText(intent);
  return jsonResponse(
    {
      responses: [
        { kind: 'chat_delta', text: sanitizeProviderText(text) },
        { kind: 'chat_done', responseId: crypto.randomUUID() },
      ],
    },
    200,
    cors,
  );
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

async function generateAgentTurn(body: AgentChatRequest, env: AiProxyEnv): Promise<AgentTurn> {
  assertGeminiAllowed(env);
  return generateGeminiAgentTurn(body, env);
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
