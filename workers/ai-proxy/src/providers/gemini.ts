import { OFFPAY_AGENT_TURN_PROMPT, OFFPAY_CHAT_INTENT_PROMPT } from '../prompts/index';
import {
  DEFAULT_GEMINI_MODEL,
  ProviderError,
  fetchWithTimeout,
  providerErrorFromResponse,
  providerTimeoutMs,
  safeJson,
} from '../http';
import { parseIntentResult, sanitizeProviderText } from '../privacy/response';
import type {
  AgentChatRequest,
  AgentIntentResult,
  AgentToolCall,
  AgentToolSchema,
  AgentTurn,
  AiProxyEnv,
  GeminiResponse,
} from '../types';

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPartInput[];
}

type GeminiPartInput =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

export async function generateGeminiIntent(
  body: AgentChatRequest,
  env: AiProxyEnv,
): Promise<AgentIntentResult> {
  if (!env.GEMINI_API_KEY) {
    throw new ProviderError('gemini', 503, 'Gemini API key is not configured.');
  }

  const payload = await fetchGeminiJson(buildGeminiIntentRequest(body), env);
  const text = geminiText(payload);
  return parseIntentResult(text);
}

/**
 * Tool-calling agent loop turn. Gemma 4 26B (gemma-4-26b-a4b-it) is served
 * through the Gemini API and supports `systemInstruction`, `tools`,
 * function calling, and `thinkingConfig` per the official docs:
 * https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
 *
 * We disable Gemma's "thinking" so the model emits visible tokens
 * directly. With thinking on, the budget can be consumed by hidden
 * reasoning and the response comes back empty.
 */
export async function generateGeminiAgentTurn(
  body: AgentChatRequest,
  env: AiProxyEnv,
): Promise<AgentTurn> {
  if (!env.GEMINI_API_KEY) {
    throw new ProviderError('gemini', 503, 'Gemini API key is not configured.');
  }

  const payload = await fetchGeminiJson(buildGeminiAgentTurnRequest(body), env);
  return parseGeminiAgentTurn(payload);
}

function buildGeminiIntentRequest(body: AgentChatRequest): Record<string, unknown> {
  const contents = body.messages.slice(-12).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content.slice(0, 4000) }],
  }));

  return {
    systemInstruction: {
      parts: [
        {
          text: `${OFFPAY_CHAT_INTENT_PROMPT}\n\nSafe intent context:\n${safeJson(
            body.context ?? {},
            4000,
          )}`,
        },
      ],
    },
    contents,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };
}

function buildGeminiAgentTurnRequest(body: AgentChatRequest): Record<string, unknown> {
  const conversation = buildAgentConversation(body);
  const tools = buildToolDeclarations(body.toolSchemas);
  const request: Record<string, unknown> = {
    systemInstruction: {
      parts: [
        {
          text: `${OFFPAY_AGENT_TURN_PROMPT}\n\nSafe agent context:\n${safeJson(
            body.context ?? {},
            4000,
          )}`,
        },
      ],
    },
    contents: conversation,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };

  if (tools.length > 0) {
    request.tools = [{ functionDeclarations: tools }];
    request.toolConfig = {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    };
  }

  return request;
}

function buildAgentConversation(body: AgentChatRequest): GeminiContent[] {
  const messages = body.messages.slice(-12);
  const contents: GeminiContent[] = messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content.slice(0, 4000) }],
  }));

  // Replay assistant tool calls + tool results so the model has the
  // complete trace before producing the next turn.
  const toolCalls = body.assistantToolCalls ?? [];
  if (toolCalls.length > 0) {
    contents.push({
      role: 'model',
      parts: toolCalls.map((call) => ({
        functionCall: { name: call.name, args: call.args ?? {} },
      })),
    });
  }

  const toolResults = body.toolResults ?? [];
  if (toolResults.length > 0) {
    contents.push({
      role: 'user',
      parts: toolResults.map((result) => ({
        functionResponse: {
          name: result.name,
          response: {
            result: result.result ?? null,
            ...(result.error != null ? { error: result.error } : {}),
          },
        },
      })),
    });
  }

  return contents;
}

function buildToolDeclarations(
  schemas: AgentChatRequest['toolSchemas'],
): Array<Record<string, unknown>> {
  if (schemas == null || schemas.length === 0) return [];
  return schemas.slice(0, 12).map((schema: AgentToolSchema) => {
    const parameters = normalizeToolParameters(schema.parameters);
    const declaration: Record<string, unknown> = {
      name: schema.name.slice(0, 64),
      description: schema.description.slice(0, 1024),
    };
    // Gemini rejects function declarations whose parameters are an empty
    // object. Only attach `parameters` when the tool actually takes args.
    if (parameters != null) declaration.parameters = parameters;
    return declaration;
  });
}

function normalizeToolParameters(
  parameters: AgentToolSchema['parameters'],
): Record<string, unknown> | null {
  if (parameters == null || typeof parameters !== 'object') return null;
  const properties = (parameters as Record<string, unknown>).properties;
  if (
    properties == null ||
    typeof properties !== 'object' ||
    Object.keys(properties as Record<string, unknown>).length === 0
  ) {
    return null;
  }
  return parameters as Record<string, unknown>;
}

function parseGeminiAgentTurn(payload: GeminiResponse): AgentTurn {
  const parts = (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true);

  const toolCalls: AgentToolCall[] = [];
  const textChunks: string[] = [];
  for (const part of parts) {
    if (part.functionCall != null && typeof part.functionCall.name === 'string') {
      const args = isPlainObject(part.functionCall.args)
        ? (part.functionCall.args as Record<string, unknown>)
        : {};
      toolCalls.push({
        id: crypto.randomUUID(),
        name: part.functionCall.name,
        args,
      });
      continue;
    }
    if (typeof part.text === 'string' && part.text.length > 0) {
      textChunks.push(part.text);
    }
  }

  if (toolCalls.length > 0) {
    return { kind: 'agent_tool_calls', toolCalls };
  }

  const text = sanitizeProviderText(textChunks.join('\n').trim());
  if (text.length === 0) {
    // The model produced no visible parts. Surface a real, actionable
    // message instead of a misleading "I am here." placeholder.
    return {
      kind: 'agent_text',
      text: 'I did not catch a clear next step. Could you rephrase that?',
    };
  }
  return { kind: 'agent_text', text };
}

async function fetchGeminiJson(
  geminiRequest: Record<string, unknown>,
  env: AiProxyEnv,
): Promise<GeminiResponse> {
  const model = encodeURIComponent(env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY ?? '',
      },
      body: JSON.stringify(geminiRequest),
    },
    providerTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('gemini', response);
  }

  return (await response.json()) as GeminiResponse;
}

function geminiText(payload: GeminiResponse): string {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
