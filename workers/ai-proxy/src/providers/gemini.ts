import { OFFPAY_AGENT_TURN_PROMPT, OFFPAY_CHAT_INTENT_PROMPT } from '../prompts/index';
import {
  DEFAULT_GEMINI_MODEL,
  ProviderError,
  cloudflareAiProviderTimeoutMs,
  fetchWithTimeout,
  groqProviderTimeoutMs,
  providerErrorFromResponse,
  providerTimeoutMs,
  primaryProviderTimeoutMs,
  safeJson,
} from '../http';
import { parseIntentResult, sanitizeProviderText } from '../privacy/response';
import { runAiProxyUpstashPipeline, sha256Hex } from '../upstash';
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
const DEFAULT_CLOUDFLARE_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';
const GEMINI_NATIVE_TOOLS_REJECTION_TTL_MS = 30 * 60 * 1000;
const CLOUDFLARE_AI_FAILURE_CIRCUIT_TTL_MS = 2 * 60 * 1000;

const geminiNativeToolRejectionCache = new Map<string, number>();
const cloudflareAiFailureCircuitCache = new Map<string, number>();

interface GenerateAgentTurnOptions {
  streamGroqFallback?: boolean;
  sessionAffinity?: string;
}

interface GenerateIntentOptions {
  sessionAffinity?: string;
}

export function resetGeminiProviderCachesForTests(): void {
  geminiNativeToolRejectionCache.clear();
  cloudflareAiFailureCircuitCache.clear();
}

export async function generateGeminiIntent(
  body: AgentChatRequest,
  env: AiProxyEnv,
  options: GenerateIntentOptions = {},
): Promise<AgentIntentResult> {
  if (shouldUseCloudflareAi(env) && shouldAttemptCloudflareAi(env)) {
    try {
      const payload = await fetchCloudflareAiIntentJson(body, env, options);
      return parseIntentResult(geminiText(payload));
    } catch (error) {
      if (!shouldFallbackFromCloudflareAi(error, env)) throw error;
      rememberCloudflareAiFailure(error, env);
      logProviderFallback('intent', 'cloudflare-ai', error);
    }
  }

  if (!hasGeminiProvider(env)) {
    if (shouldUseGroqFallback(env)) {
      const payload = await fetchGroqIntentJson(body, env);
      return parseIntentResult(geminiText(payload));
    }
    throw new ProviderError(
      'cloudflare-ai',
      503,
      'Cloudflare Workers AI binding is not configured.',
    );
  }

  const geminiRequest = buildGeminiIntentRequest(body);
  const payload = await fetchProviderJson(
    geminiRequest,
    env,
    'intent',
    () => fetchGeminiJson(geminiRequest, env, 'intent'),
    () => fetchGroqIntentJson(body, env),
  );
  const text = geminiText(payload);
  return parseIntentResult(text);
}

/**
 * Tool-calling agent loop turn. Gemini supports function declarations,
 * but some provider-side deploys can reject native tool
 * payloads. In that case, fall back to a JSON tool protocol carried as text
 * so the client can still run the same local tools.
 */
export async function generateGeminiAgentTurn(
  body: AgentChatRequest,
  env: AiProxyEnv,
  options: GenerateAgentTurnOptions = {},
): Promise<AgentTurn> {
  if (shouldUseCloudflareAi(env) && shouldAttemptCloudflareAi(env)) {
    const requestKind = cloudflareAiAgentTurnRequestKind(body, env);
    try {
      return await fetchCloudflareAiAgentTurn(body, env, options);
    } catch (error) {
      if (!shouldFallbackFromCloudflareAi(error, env)) throw error;
      rememberCloudflareAiFailure(error, env);
      logProviderFallback(requestKind, 'cloudflare-ai', error);
    }
  }

  if (!hasGeminiProvider(env)) {
    if (shouldUseGroqFallback(env)) {
      return parseJsonAgentTurn(await fetchGroqAgentTurnJson(body, env, options), 'groq');
    }
    throw new ProviderError(
      'cloudflare-ai',
      503,
      'Cloudflare Workers AI binding is not configured.',
    );
  }

  const rejectionKey = await geminiNativeToolsRejectionKey(body, env);
  if (!hasReplayedToolTrace(body) && !(await isGeminiNativeToolsRejected(rejectionKey, env))) {
    try {
      const nativeRequest = buildGeminiAgentTurnRequest(body);
      const payload = await fetchGeminiJson(nativeRequest, env, 'agent_native');
      return parseGeminiAgentTurn(payload);
    } catch (error) {
      if (shouldFallbackToGroq(error, env)) {
        console.warn(
          'aiProxy.providerFallback.groq',
          safeJson(
            {
              requestKind: 'agent_native',
              primaryProvider: 'gemini',
              primaryStatus: error instanceof ProviderError ? error.status : undefined,
              primaryMessage: error instanceof Error ? error.message : String(error),
            },
            1200,
          ),
        );
        return parseJsonAgentTurn(await fetchGroqAgentTurnJson(body, env, options), 'groq');
      }
      if (!shouldRetryAgentTurnAsJson(error)) throw error;
      await rememberGeminiNativeToolsRejected(rejectionKey, env);
    }
  }

  const jsonRequest = buildJsonAgentTurnRequest(body);
  const fallbackPayload = await fetchProviderJson(
    jsonRequest,
    env,
    'agent_json_fallback',
    () => fetchGeminiJson(jsonRequest, env, 'agent_json_fallback'),
    () => fetchGroqAgentTurnJson(body, env, options),
  );
  return parseJsonAgentTurn(fallbackPayload);
}

function hasReplayedToolTrace(body: AgentChatRequest): boolean {
  return (body.assistantToolCalls?.length ?? 0) > 0 || (body.toolResults?.length ?? 0) > 0;
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
      maxOutputTokens: 512,
    },
  };

  if (tools.length > 0) {
    request.tools = [{ functionDeclarations: tools }];
  }

  return request;
}

export function buildJsonAgentTurnRequest(body: AgentChatRequest): Record<string, unknown> {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildJsonAgentTurnPrompt(body),
          },
        ],
      },
    ],
  };
}

function buildJsonAgentTurnPrompt(body: AgentChatRequest): string {
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
        metadata: toolMetadataForPrompt(schema),
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

function toolMetadataForPrompt(schema: AgentToolSchema): Record<string, unknown> | undefined {
  if (schema.xOffpay == null) return undefined;
  return {
    category: schema.xOffpay.category,
    networkScope: schema.xOffpay.networkScope,
    modelInstructions: schema.xOffpay.modelInstructions,
  };
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

export function parseJsonAgentTurn(payload: GeminiResponse, provider = 'gemini'): AgentTurn {
  const rawText = geminiText(payload);
  const parsed = parseJsonObjectFromModelText(rawText, provider);
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null;

  if (kind === 'agent_text') {
    const text = sanitizeProviderText(typeof parsed.text === 'string' ? parsed.text.trim() : '');
    if (text.length === 0) {
      throw new ProviderError(provider, 502, 'Provider returned an empty agent response.');
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

  throw new ProviderError(provider, 502, 'Provider returned an invalid agent turn.');
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

function parseJsonObjectFromModelText(text: string, provider = 'gemini'): Record<string, unknown> {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ProviderError(provider, 502, 'Provider returned non-JSON agent text.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
  } catch {
    throw new ProviderError(provider, 502, 'Provider returned malformed agent JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new ProviderError(provider, 502, 'Provider returned non-object agent JSON.');
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

async function fetchCloudflareAiIntentJson(
  body: AgentChatRequest,
  env: AiProxyEnv,
  options: GenerateIntentOptions,
): Promise<GeminiResponse> {
  return fetchCloudflareAiJson(
    buildCloudflareAiIntentRequest(body, cloudflareAiModel(env)),
    env,
    'intent',
    options,
  );
}

async function fetchCloudflareAiAgentTurn(
  body: AgentChatRequest,
  env: AiProxyEnv,
  options: GenerateAgentTurnOptions,
): Promise<AgentTurn> {
  const model = cloudflareAiModel(env);
  const requestKind = cloudflareAiAgentTurnRequestKind(body, env);
  if (!hasReplayedToolTrace(body) && cloudflareAiUsesJsonAgentProtocol(model)) {
    return parseJsonAgentTurn(
      await fetchCloudflareAiJson(
        buildCloudflareAiJsonAgentTurnRequest(body),
        env,
        requestKind,
        options,
      ),
      'cloudflare-ai',
    );
  }

  const request = hasReplayedToolTrace(body)
    ? buildCloudflareAiToolResultRequest(body, model)
    : buildCloudflareAiAgentTurnRequest(body, model);
  const result = await runCloudflareAiWithTimeout(env, model, request, requestKind, {
    sessionAffinity: options.sessionAffinity,
  });
  return parseCloudflareAiAgentTurn(result);
}

function cloudflareAiAgentTurnRequestKind(body: AgentChatRequest, env: AiProxyEnv): string {
  if (hasReplayedToolTrace(body)) return 'agent_text_after_tools';
  return cloudflareAiUsesJsonAgentProtocol(cloudflareAiModel(env))
    ? 'agent_json_primary'
    : 'agent_native';
}

async function fetchCloudflareAiJson(
  request: Record<string, unknown>,
  env: AiProxyEnv,
  requestKind: string,
  options: GenerateIntentOptions,
): Promise<GeminiResponse> {
  if (!shouldUseCloudflareAi(env)) {
    throw new ProviderError(
      'cloudflare-ai',
      503,
      'Cloudflare Workers AI binding is not configured.',
    );
  }

  const model = cloudflareAiModel(env);
  const result = await runCloudflareAiWithTimeout(env, model, request, requestKind, options);
  const payload = cloudflareAiText(result);
  if (payload.length === 0) {
    throw new ProviderError(
      'cloudflare-ai',
      502,
      'Cloudflare Workers AI returned an empty response.',
    );
  }

  return {
    candidates: [
      {
        content: {
          parts: [{ text: payload }],
        },
      },
    ],
  };
}

async function runCloudflareAiWithTimeout(
  env: AiProxyEnv,
  model: string,
  request: Record<string, unknown>,
  requestKind: string,
  options: { sessionAffinity?: string },
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new ProviderError('cloudflare-ai', 504, 'Cloudflare Workers AI request timed out.'));
    }, cloudflareAiProviderTimeoutMs(env));
  });

  try {
    return await Promise.race([
      env.AI!.run(model, request, cloudflareAiRunOptions(options)),
      timeoutPromise,
    ]);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    console.warn(
      'aiProxy.providerError',
      safeJson(
        {
          provider: 'cloudflare-ai',
          status: 502,
          requestKind,
          model,
          message: error instanceof Error ? error.message : String(error),
        },
        1200,
      ),
    );
    throw new ProviderError('cloudflare-ai', 502, 'Cloudflare Workers AI request failed.');
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}

function buildCloudflareAiIntentRequest(
  body: AgentChatRequest,
  model: string,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    messages: [
      {
        role: 'system',
        content: `${OFFPAY_CHAT_INTENT_PROMPT}\n\nSafe intent context:\n${safeJson(
          body.context ?? {},
          4000,
        )}`,
      },
      ...body.messages.slice(-12).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content.slice(0, 4000),
      })),
    ],
    temperature: 0.1,
    max_tokens: 192,
    top_p: 0.95,
  };
  applyCloudflareAiResponseControls(request, model, 'json_object');
  return request;
}

function buildCloudflareAiAgentTurnRequest(
  body: AgentChatRequest,
  model: string,
): Record<string, unknown> {
  const tools = buildCloudflareAiTools(body.toolSchemas);
  const request: Record<string, unknown> = {
    messages: [
      {
        role: 'system',
        content: buildCloudflareAiAgentSystemPrompt(body),
      },
      ...buildCloudflareAiConversationMessages(body),
    ],
    temperature: 0.2,
    max_tokens: 192,
    top_p: 0.95,
  };
  applyCloudflareAiResponseControls(request, model, 'text');

  if (tools.length > 0) {
    request.tools = tools;
    request.tool_choice = 'auto';
    request.parallel_tool_calls = false;
  }

  return request;
}

function buildCloudflareAiJsonAgentTurnRequest(body: AgentChatRequest): Record<string, unknown> {
  return {
    messages: [
      {
        role: 'user',
        content: buildJsonAgentTurnPrompt(body),
      },
    ],
    temperature: 0.1,
    max_tokens: 256,
    top_p: 0.9,
  };
}

function buildCloudflareAiToolResultRequest(
  body: AgentChatRequest,
  model: string,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    messages: [
      {
        role: 'system',
        content: [
          buildCloudflareAiAgentSystemPrompt(body),
          '',
          'The app already executed the requested local tool calls. Produce only the final user-facing answer.',
          'Do not request more tools. Keep it short and do not include private wallet data.',
        ].join('\n'),
      },
      ...buildCloudflareAiConversationMessages(body),
      {
        role: 'user',
        content: [
          'Local tool execution trace:',
          safeJson(
            {
              assistantToolCalls: body.assistantToolCalls ?? [],
              toolResults: body.toolResults ?? [],
            },
            8000,
          ),
          '',
          'Reply with the final short answer for the user.',
        ].join('\n'),
      },
    ],
    temperature: 0.2,
    max_tokens: 192,
    top_p: 0.95,
  };
  applyCloudflareAiResponseControls(request, model, 'text');
  return request;
}

function buildCloudflareAiAgentSystemPrompt(body: AgentChatRequest): string {
  return [
    OFFPAY_AGENT_TURN_PROMPT,
    '',
    'Safe agent context:',
    safeJson(body.context ?? {}, 3000),
    '',
    'Use a local tool when the user asks for wallet state, balances, payment drafts, swaps, private payments, Umbra actions, offline flows, or any app action. If no tool is needed, answer in one short message.',
  ].join('\n');
}

function buildCloudflareAiConversationMessages(
  body: AgentChatRequest,
): Array<Record<string, unknown>> {
  return body.messages
    .slice(-8)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content.slice(0, 3000),
    }));
}

function buildCloudflareAiTools(
  schemas: AgentChatRequest['toolSchemas'],
): Array<Record<string, unknown>> {
  if (schemas == null || schemas.length === 0) return [];
  return schemas.slice(0, MAX_FUNCTION_DECLARATIONS).map((schema) => {
    const parameters = normalizeCloudflareAiToolParameters(schema.parameters);
    return {
      type: 'function',
      function: {
        name: schema.name.slice(0, 64),
        description: compactToolDescription(schema),
        parameters: parameters ?? { type: 'object', properties: {} },
        strict: false,
      },
    };
  });
}

function cloudflareAiChatTemplateOptions(): Record<string, unknown> {
  return {
    enable_thinking: false,
    clear_thinking: true,
  };
}

function applyCloudflareAiResponseControls(
  request: Record<string, unknown>,
  model: string,
  responseType: 'text' | 'json_object',
): void {
  if (cloudflareAiSupportsResponseFormat(model)) {
    request.response_format = { type: responseType };
  }

  if (cloudflareAiSupportsThinkingControls(model)) {
    request.chat_template_kwargs = cloudflareAiChatTemplateOptions();
  }
}

function compactToolDescription(schema: AgentToolSchema): string {
  const parts = [
    schema.description,
    ...(schema.xOffpay?.modelInstructions ?? []),
    schema.xOffpay?.networkScope == null ? '' : `Network scope: ${schema.xOffpay.networkScope}.`,
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.join(' ').slice(0, 420);
}

function normalizeCloudflareAiToolParameters(
  parameters: AgentToolSchema['parameters'],
): Record<string, unknown> | null {
  if (!isPlainObject(parameters)) return null;
  const normalized = normalizeJsonSchema(parameters);
  return isPlainObject(normalized) ? normalized : null;
}

function normalizeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (value == null) continue;

    if (key === 'type' && typeof value === 'string') {
      normalized[key] = value.toLowerCase();
      continue;
    }

    if (key === 'properties' && isPlainObject(value)) {
      normalized[key] = Object.fromEntries(
        Object.entries(value).map(([propertyName, propertySchema]) => [
          propertyName,
          isPlainObject(propertySchema) ? normalizeJsonSchema(propertySchema) : propertySchema,
        ]),
      );
      continue;
    }

    if (key === 'items' && isPlainObject(value)) {
      normalized[key] = normalizeJsonSchema(value);
      continue;
    }

    if ((key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') && Array.isArray(value)) {
      normalized[key] = value.map((entry) =>
        isPlainObject(entry) ? normalizeJsonSchema(entry) : entry,
      );
      continue;
    }

    if (key === 'additionalProperties' && isPlainObject(value)) {
      normalized[key] = normalizeJsonSchema(value);
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

async function fetchGeminiJson(
  geminiRequest: Record<string, unknown>,
  env: AiProxyEnv,
  requestKind: string,
): Promise<GeminiResponse> {
  const model = env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const encodedModel = encodeURIComponent(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`;
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
    shouldUseGroqFallback(env) ? primaryProviderTimeoutMs(env) : providerTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('gemini', response, { requestKind, model });
  }

  return (await response.json()) as GeminiResponse;
}

interface GroqChatCompletion {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

async function fetchProviderJson(
  geminiRequest: Record<string, unknown>,
  env: AiProxyEnv,
  requestKind: string,
  fetchPrimary: () => Promise<GeminiResponse>,
  fetchFallback: () => Promise<GeminiResponse>,
): Promise<GeminiResponse> {
  try {
    return await fetchPrimary();
  } catch (error) {
    if (!shouldFallbackToGroq(error, env)) throw error;
    console.warn(
      'aiProxy.providerFallback.groq',
      safeJson(
        {
          requestKind,
          primaryProvider: 'gemini',
          primaryStatus: error instanceof ProviderError ? error.status : undefined,
          primaryMessage: error instanceof Error ? error.message : String(error),
          promptBytes: JSON.stringify(geminiRequest).length,
        },
        1200,
      ),
    );
    return fetchFallback();
  }
}

async function fetchGroqIntentJson(
  body: AgentChatRequest,
  env: AiProxyEnv,
): Promise<GeminiResponse> {
  return fetchGroqJson(buildGroqIntentRequest(body, env), env, 'intent');
}

async function fetchGroqAgentTurnJson(
  body: AgentChatRequest,
  env: AiProxyEnv,
  options: GenerateAgentTurnOptions = {},
): Promise<GeminiResponse> {
  return fetchGroqJson(buildGroqAgentTurnRequest(body, env), env, 'agent_json_fallback', {
    stream: options.streamGroqFallback === true,
  });
}

async function fetchGroqJson(
  groqRequest: Record<string, unknown>,
  env: AiProxyEnv,
  requestKind: string,
  options: { stream?: boolean } = {},
): Promise<GeminiResponse> {
  if (!shouldUseGroqFallback(env)) {
    throw new ProviderError('groq', 503, 'Groq fallback is not configured.');
  }

  const request = options.stream === true ? { ...groqRequest, stream: true } : groqRequest;
  const payload =
    options.stream === true
      ? await fetchGroqStreamingText(request, env, requestKind)
      : await fetchGroqCompletionText(request, env, requestKind);

  if (payload.length === 0) {
    throw new ProviderError('groq', 502, 'Groq returned an empty response.');
  }

  return {
    candidates: [
      {
        content: {
          parts: [{ text: payload }],
        },
      },
    ],
  };
}

async function fetchGroqCompletionText(
  groqRequest: Record<string, unknown>,
  env: AiProxyEnv,
  requestKind: string,
): Promise<string> {
  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    groqFetchInit(groqRequest, env),
    groqProviderTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('groq', response, {
      requestKind,
      model: groqModel(env),
    });
  }

  const payload = (await response.json()) as GroqChatCompletion;
  const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
  return text;
}

async function fetchGroqStreamingText(
  groqRequest: Record<string, unknown>,
  env: AiProxyEnv,
  requestKind: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort('groq stream timeout'),
    groqProviderTimeoutMs(env),
  );

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      ...groqFetchInit(groqRequest, env),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await providerErrorFromResponse('groq', response, {
        requestKind,
        model: groqModel(env),
        stream: true,
      });
    }

    return (await readGroqSseText(response)).trim();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderError('groq', 504, 'Groq stream timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function groqFetchInit(groqRequest: Record<string, unknown>, env: AiProxyEnv): RequestInit {
  return {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GROQ_API_KEY?.trim() ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(groqRequest),
  };
}

async function readGroqSseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader == null) {
    throw new ProviderError('groq', 502, 'Groq stream body is not readable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finished = false;

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseGroqSseBuffer(buffer);
      buffer = parsed.buffer;
      text += parsed.text;
      finished = parsed.finished;
    }

    buffer += decoder.decode();
    if (!finished && buffer.trim().length > 0) {
      const parsed = parseGroqSseBuffer(`${buffer}\n`);
      text += parsed.text;
      finished = parsed.finished;
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}

function parseGroqSseBuffer(buffer: string): {
  buffer: string;
  text: string;
  finished: boolean;
} {
  let remaining = buffer;
  let text = '';
  let finished = false;

  while (true) {
    const lineEnd = remaining.indexOf('\n');
    if (lineEnd === -1) break;

    const line = remaining.slice(0, lineEnd).trim();
    remaining = remaining.slice(lineEnd + 1);
    if (line.length === 0 || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;

    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      finished = true;
      break;
    }

    const chunk = parseGroqStreamChunk(data);
    if (chunk.errorMessage != null) {
      throw new ProviderError('groq', chunk.errorStatus, chunk.errorMessage);
    }
    text += chunk.content;
  }

  return { buffer: remaining, text, finished };
}

function parseGroqStreamChunk(data: string): {
  content: string;
  errorMessage?: string;
  errorStatus: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return { content: '', errorStatus: 502 };
  }

  if (!isPlainObject(parsed)) return { content: '', errorStatus: 502 };
  const error = parsed.error;
  if (isPlainObject(error)) {
    const message =
      typeof error.message === 'string' && error.message.trim().length > 0
        ? error.message.trim()
        : 'Groq stream failed.';
    const status = typeof error.code === 'number' && Number.isFinite(error.code) ? error.code : 502;
    return { content: '', errorMessage: message, errorStatus: status };
  }

  const choices = parsed.choices;
  if (!Array.isArray(choices)) return { content: '', errorStatus: 502 };
  const firstChoice = choices[0];
  if (!isPlainObject(firstChoice)) return { content: '', errorStatus: 502 };
  const delta = firstChoice.delta;
  if (!isPlainObject(delta)) return { content: '', errorStatus: 502 };
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    errorStatus: 502,
  };
}

function buildGroqIntentRequest(body: AgentChatRequest, env: AiProxyEnv): Record<string, unknown> {
  return {
    messages: [
      {
        role: 'system',
        content: `${OFFPAY_CHAT_INTENT_PROMPT}\n\nSafe intent context:\n${safeJson(
          body.context ?? {},
          4000,
        )}`,
      },
      ...body.messages.slice(-12).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content.slice(0, 4000),
      })),
    ],
    model: groqModel(env),
    temperature: 0.1,
    max_completion_tokens: groqMaxCompletionTokens(env),
    top_p: 0.95,
    response_format: { type: 'json_object' },
    reasoning_effort: env.GROQ_REASONING_EFFORT?.trim() || 'default',
    stop: null,
  };
}

function buildGroqAgentTurnRequest(
  body: AgentChatRequest,
  env: AiProxyEnv,
): Record<string, unknown> {
  return {
    messages: [
      {
        role: 'user',
        content: buildJsonAgentTurnPrompt(body),
      },
    ],
    model: groqModel(env),
    temperature: 0.6,
    max_completion_tokens: groqMaxCompletionTokens(env),
    top_p: 0.95,
    response_format: { type: 'json_object' },
    reasoning_effort: env.GROQ_REASONING_EFFORT?.trim() || 'default',
    stop: null,
  };
}

function groqModel(env: AiProxyEnv): string {
  return env.GROQ_CHAT_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

function groqMaxCompletionTokens(env: AiProxyEnv): number {
  const parsed = Number(env.GROQ_MAX_COMPLETION_TOKENS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(4096, Math.floor(parsed)) : 4096;
}

function cloudflareAiModel(env: AiProxyEnv): string {
  return env.CLOUDFLARE_AI_CHAT_MODEL?.trim() || DEFAULT_CLOUDFLARE_AI_MODEL;
}

function normalizedCloudflareAiModel(model: string): string {
  return model.trim().toLowerCase();
}

function cloudflareAiUsesJsonAgentProtocol(model: string): boolean {
  return normalizedCloudflareAiModel(model) === '@cf/meta/llama-3.1-8b-instruct-fast';
}

function cloudflareAiSupportsResponseFormat(model: string): boolean {
  return !cloudflareAiUsesJsonAgentProtocol(model);
}

function cloudflareAiSupportsThinkingControls(model: string): boolean {
  const normalized = normalizedCloudflareAiModel(model);
  return normalized.includes('/zai-org/') || normalized.includes('glm-');
}

function parseCloudflareAiAgentTurn(payload: unknown): AgentTurn {
  const toolCalls = cloudflareAiToolCalls(payload);
  if (toolCalls.length > 0) {
    return { kind: 'agent_tool_calls', toolCalls };
  }

  const text = sanitizeProviderText(cloudflareAiText(payload));
  if (text.length === 0) {
    throw new ProviderError(
      'cloudflare-ai',
      502,
      'Cloudflare Workers AI returned an empty response.',
    );
  }
  return { kind: 'agent_text', text };
}

function cloudflareAiToolCalls(payload: unknown): AgentToolCall[] {
  if (!isPlainObject(payload)) return [];

  const directToolCalls = normalizeCloudflareAiToolCalls(payload.tool_calls);
  if (directToolCalls.length > 0) return directToolCalls;

  const response = payload.response;
  if (isPlainObject(response)) {
    const responseToolCalls = cloudflareAiToolCalls(response);
    if (responseToolCalls.length > 0) return responseToolCalls;
  }

  const result = payload.result;
  if (isPlainObject(result)) {
    const resultToolCalls = cloudflareAiToolCalls(result);
    if (resultToolCalls.length > 0) return resultToolCalls;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices)) return [];

  return choices
    .flatMap((choice) => {
      if (!isPlainObject(choice)) return [];
      const message = choice.message;
      if (isPlainObject(message)) return normalizeCloudflareAiToolCalls(message.tool_calls);
      const delta = choice.delta;
      if (isPlainObject(delta)) return normalizeCloudflareAiToolCalls(delta.tool_calls);
      return [];
    })
    .slice(0, 8);
}

function normalizeCloudflareAiToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((call) => normalizeCloudflareAiToolCall(call))
    .filter((call): call is AgentToolCall => call != null)
    .slice(0, 8);
}

function normalizeCloudflareAiToolCall(value: unknown): AgentToolCall | null {
  if (!isPlainObject(value)) return null;

  const functionCall = isPlainObject(value.function) ? value.function : null;
  const rawName =
    typeof value.name === 'string'
      ? value.name
      : typeof functionCall?.name === 'string'
        ? functionCall.name
        : '';
  const name = rawName.trim().slice(0, 64);
  if (name.length === 0) return null;

  const rawArgs = functionCall?.arguments ?? value.arguments ?? value.args;
  const args = parseCloudflareAiToolArguments(rawArgs);
  return {
    id: typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : crypto.randomUUID(),
    name,
    args,
  };
}

function parseCloudflareAiToolArguments(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cloudflareAiText(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim();
  if (!isPlainObject(payload)) return '';

  const response = payload.response;
  if (typeof response === 'string') return response.trim();
  if (isPlainObject(response)) {
    const nestedResponse = cloudflareAiText(response);
    if (nestedResponse.length > 0) return nestedResponse;
  }

  const result = payload.result;
  if (typeof result === 'string') return result.trim();
  if (isPlainObject(result)) {
    const nestedResult = cloudflareAiText(result);
    if (nestedResult.length > 0) return nestedResult;
  }

  const text = payload.text;
  if (typeof text === 'string') return text.trim();

  const choices = payload.choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!isPlainObject(choice)) return '';
        if (typeof choice.text === 'string') return choice.text;
        const message = choice.message;
        if (isPlainObject(message)) return textFromChatMessageContent(message.content);
        const delta = choice.delta;
        if (isPlainObject(delta)) return textFromChatMessageContent(delta.content);
        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

function cloudflareAiRunOptions(options: { sessionAffinity?: string }): Record<string, unknown> {
  const sessionAffinity = options.sessionAffinity?.trim();
  if (sessionAffinity == null || sessionAffinity.length === 0) return {};
  return {
    extraHeaders: {
      'x-session-affinity': sessionAffinity,
    },
  };
}

function textFromChatMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isPlainObject(part)) return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .join('');
}

function shouldUseCloudflareAi(env: AiProxyEnv): boolean {
  return env.AI != null;
}

function shouldAttemptCloudflareAi(env: AiProxyEnv): boolean {
  const key = cloudflareAiFailureCircuitKey(env);
  const expiry = cloudflareAiFailureCircuitCache.get(key);
  if (expiry == null) return true;

  const now = Date.now();
  if (expiry <= now) {
    cloudflareAiFailureCircuitCache.delete(key);
    return true;
  }

  if (!hasExternalChatFallback(env)) return true;
  console.warn(
    'aiProxy.providerFallback.cloudflareAiCircuitOpen',
    safeJson(
      {
        primaryProvider: 'cloudflare-ai',
        model: cloudflareAiModel(env),
        remainingMs: expiry - now,
      },
      800,
    ),
  );
  return false;
}

function cloudflareAiFailureCircuitKey(env: AiProxyEnv): string {
  return `cloudflare-ai:${normalizedCloudflareAiModel(cloudflareAiModel(env))}`;
}

function rememberCloudflareAiFailure(error: unknown, env: AiProxyEnv): void {
  if (!hasExternalChatFallback(env) || !shouldOpenCloudflareAiFailureCircuit(error)) return;
  cloudflareAiFailureCircuitCache.set(
    cloudflareAiFailureCircuitKey(env),
    Date.now() + CLOUDFLARE_AI_FAILURE_CIRCUIT_TTL_MS,
  );
}

function shouldOpenCloudflareAiFailureCircuit(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true;
  if (error.provider !== 'cloudflare-ai') return false;
  return error.status === 429 || error.status >= 500;
}

function hasGeminiProvider(env: AiProxyEnv): boolean {
  return (env.GEMINI_API_KEY?.trim() ?? '').length > 0;
}

function shouldUseGroqFallback(env: AiProxyEnv): boolean {
  return (env.GROQ_API_KEY?.trim() ?? '').length > 0;
}

function hasExternalChatFallback(env: AiProxyEnv): boolean {
  return hasGeminiProvider(env) || shouldUseGroqFallback(env);
}

function shouldFallbackFromCloudflareAi(error: unknown, env: AiProxyEnv): boolean {
  if (!hasGeminiProvider(env) && !shouldUseGroqFallback(env)) return false;
  if (!(error instanceof ProviderError)) return true;
  return (
    error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500
  );
}

function shouldFallbackToGroq(error: unknown, env: AiProxyEnv): boolean {
  if (!shouldUseGroqFallback(env)) return false;
  if (!(error instanceof ProviderError)) return false;
  if (error.provider !== 'gemini' && error.provider !== 'provider') return false;
  return (
    error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500
  );
}

function logProviderFallback(requestKind: string, primaryProvider: string, error: unknown): void {
  console.warn(
    'aiProxy.providerFallback.next',
    safeJson(
      {
        requestKind,
        primaryProvider,
        primaryStatus: error instanceof ProviderError ? error.status : undefined,
        primaryMessage: error instanceof Error ? error.message : String(error),
      },
      1200,
    ),
  );
}

async function geminiNativeToolsRejectionKey(
  body: AgentChatRequest,
  env: AiProxyEnv,
): Promise<string> {
  const model = env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const schemaFingerprint = JSON.stringify(
    (body.toolSchemas ?? []).slice(0, MAX_FUNCTION_DECLARATIONS).map((schema) => ({
      name: schema.name,
      description: schema.description,
      parameters: normalizeGeminiToolParameters(schema.parameters),
    })),
  );
  return `ai-proxy:gemini-native-tools-rejected:v1:${await sha256Hex(`${model}:${schemaFingerprint}`)}`;
}

async function isGeminiNativeToolsRejected(key: string, env: AiProxyEnv): Promise<boolean> {
  const now = Date.now();
  const localExpiry = geminiNativeToolRejectionCache.get(key);
  if (localExpiry != null) {
    if (localExpiry > now) return true;
    geminiNativeToolRejectionCache.delete(key);
  }

  const result = await runAiProxyUpstashPipeline(env, [['GET', key]]);
  if (result?.[0] === '1') {
    geminiNativeToolRejectionCache.set(key, now + GEMINI_NATIVE_TOOLS_REJECTION_TTL_MS);
    return true;
  }

  return false;
}

async function rememberGeminiNativeToolsRejected(key: string, env: AiProxyEnv): Promise<void> {
  const ttlMs = GEMINI_NATIVE_TOOLS_REJECTION_TTL_MS;
  geminiNativeToolRejectionCache.set(key, Date.now() + ttlMs);
  await runAiProxyUpstashPipeline(env, [['SET', key, '1', 'PX', ttlMs]]);
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
