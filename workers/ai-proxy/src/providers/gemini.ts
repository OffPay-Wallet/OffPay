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

const MAX_FUNCTION_DECLARATIONS = 40;

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
 * Tool-calling agent loop turn. Gemma 4 26B supports Gemini function
 * declarations, but some provider-side deploys can reject native tool
 * payloads. In that case, fall back to a JSON tool protocol carried as text
 * so the client can still run the same local tools.
 */
export async function generateGeminiAgentTurn(
  body: AgentChatRequest,
  env: AiProxyEnv,
): Promise<AgentTurn> {
  if (!env.GEMINI_API_KEY) {
    throw new ProviderError('gemini', 503, 'Gemini API key is not configured.');
  }

  try {
    const payload = await fetchGeminiJson(buildGeminiAgentTurnRequest(body), env);
    return parseGeminiAgentTurn(payload);
  } catch (error) {
    if (!shouldRetryAgentTurnAsJson(error)) throw error;
    const fallbackPayload = await fetchGeminiJson(buildGemmaJsonAgentTurnRequest(body), env);
    return parseGemmaJsonAgentTurn(fallbackPayload);
  }
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

export function buildGeminiAgentTurnRequest(body: AgentChatRequest): Record<string, unknown> {
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
  }

  return request;
}

export function buildGemmaJsonAgentTurnRequest(body: AgentChatRequest): Record<string, unknown> {
  return {
    contents: [
      {
        parts: [
          {
            text: buildGemmaJsonAgentTurnPrompt(body),
          },
        ],
      },
    ],
  };
}

function buildGemmaJsonAgentTurnPrompt(body: AgentChatRequest): string {
  return [
    OFFPAY_AGENT_TURN_PROMPT,
    '',
    'Safe agent context:',
    safeJson(body.context ?? {}, 4000),
    '',
    'Available local tools:',
    safeJson(
      (body.toolSchemas ?? []).slice(0, MAX_FUNCTION_DECLARATIONS).map((schema) => ({
        name: schema.name,
        description: schema.description,
        parameters: normalizeGeminiToolParameters(schema.parameters) ?? { type: 'OBJECT' },
      })),
      18_000,
    ),
    '',
    'Conversation:',
    safeJson(buildJsonProtocolConversationTrace(body), 18_000),
    '',
    'Return exactly one JSON object and no markdown.',
    'For a final answer, return {"kind":"agent_text","text":"short answer"}.',
    'To call tools, return {"kind":"agent_tool_calls","toolCalls":[{"name":"tool_name","args":{}}]}.',
    'Use only tool names from Available local tools. Do not include private wallet data.',
  ].join('\n');
}

function buildJsonProtocolConversationTrace(body: AgentChatRequest): unknown[] {
  const trace: unknown[] = body.messages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 4000),
  }));

  if ((body.assistantToolCalls ?? []).length > 0) {
    trace.push({
      role: 'assistant_tool_calls',
      toolCalls: body.assistantToolCalls,
    });
  }

  if ((body.toolResults ?? []).length > 0) {
    trace.push({
      role: 'tool_results',
      toolResults: body.toolResults,
    });
  }

  return trace;
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
  return schemas.slice(0, MAX_FUNCTION_DECLARATIONS).map((schema: AgentToolSchema) => {
    const parameters = normalizeGeminiToolParameters(schema.parameters);
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

export function normalizeGeminiToolParameters(
  parameters: AgentToolSchema['parameters'],
): Record<string, unknown> | null {
  if (!isPlainObject(parameters)) return null;
  const properties = parameters.properties;
  if (!isPlainObject(properties) || Object.keys(properties).length === 0) {
    return null;
  }
  return normalizeGeminiSchema(parameters);
}

function normalizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (value == null) continue;

    if (key === 'type' && typeof value === 'string') {
      normalized[key] = value.toUpperCase();
      continue;
    }

    if (key === 'properties' && isPlainObject(value)) {
      normalized[key] = Object.fromEntries(
        Object.entries(value).map(([propertyName, propertySchema]) => [
          propertyName,
          isPlainObject(propertySchema) ? normalizeGeminiSchema(propertySchema) : propertySchema,
        ]),
      );
      continue;
    }

    if (key === 'items' && isPlainObject(value)) {
      normalized[key] = normalizeGeminiSchema(value);
      continue;
    }

    if ((key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') && Array.isArray(value)) {
      normalized[key] = value.map((entry) =>
        isPlainObject(entry) ? normalizeGeminiSchema(entry) : entry,
      );
      continue;
    }

    if (key === 'additionalProperties' && isPlainObject(value)) {
      normalized[key] = normalizeGeminiSchema(value);
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

export function parseGemmaJsonAgentTurn(payload: GeminiResponse): AgentTurn {
  const rawText = geminiText(payload);
  const parsed = parseJsonObjectFromModelText(rawText);
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null;

  if (kind === 'agent_text') {
    const text = sanitizeProviderText(typeof parsed.text === 'string' ? parsed.text.trim() : '');
    if (text.length === 0) {
      throw new ProviderError('gemini', 502, 'Gemma returned an empty agent response.');
    }
    return { kind: 'agent_text', text };
  }

  if (kind === 'agent_tool_calls' && Array.isArray(parsed.toolCalls)) {
    const toolCalls: AgentToolCall[] = parsed.toolCalls
      .map((call) => normalizeJsonProtocolToolCall(call))
      .filter((call): call is AgentToolCall => call != null)
      .slice(0, 8);

    if (toolCalls.length > 0) return { kind: 'agent_tool_calls', toolCalls };
  }

  throw new ProviderError('gemini', 502, 'Gemma returned an invalid agent turn.');
}

function normalizeJsonProtocolToolCall(value: unknown): AgentToolCall | null {
  if (!isPlainObject(value) || typeof value.name !== 'string' || value.name.trim().length === 0) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    name: value.name.trim().slice(0, 64),
    args: isPlainObject(value.args) ? value.args : {},
  };
}

function parseJsonObjectFromModelText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ProviderError('gemini', 502, 'Gemma returned non-JSON agent text.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  } catch {
    throw new ProviderError('gemini', 502, 'Gemma returned malformed agent JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new ProviderError('gemini', 502, 'Gemma returned non-object agent JSON.');
  }
  return parsed;
}

function shouldRetryAgentTurnAsJson(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    error.provider === 'gemini' &&
    (error.status === 400 || error.status === 422)
  );
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
    throw new ProviderError('gemini', 502, 'Gemini returned an empty agent response.');
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
