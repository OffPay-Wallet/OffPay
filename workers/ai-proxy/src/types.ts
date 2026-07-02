export type VoiceProvider = 'sarvam' | 'elevenlabs';

export type AgentMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentToolSchema = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  xOffpay?: AgentToolSchemaMetadata;
};

export type AgentToolSchemaMetadata = {
  category?: string;
  networkScope?: string;
  pendingLabel?: string;
  modelInstructions?: string[];
};

export type AgentToolResult = {
  toolCallId: string;
  name: string;
  result?: unknown;
  /** Structured error code only. The model phrases the user-facing reply. */
  error?: {
    code: string;
  };
};

/**
 * One side of an agent turn. Either the model produced visible text (final
 * answer) or it requested one or more tools. The client runs the tools and
 * sends the results back as another `agent_turn` request.
 */
export type AgentTurn =
  | {
      kind: 'agent_text';
      text: string;
    }
  | {
      kind: 'agent_tool_calls';
      toolCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
      }>;
    };

export type AgentToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type AiIntentContext = {
  privacyMode?: 'strict';
  network?: 'mainnet' | 'devnet';
  walletMode?: 'online' | 'offline';
  locale?: string;
  contactsAvailable?: boolean;
  contactCount?: number;
  capabilities?: {
    networkAvailable?: boolean;
    walletBalance?: boolean;
    normalSend?: boolean;
    privateSend?: boolean;
    swap?: boolean;
    umbra?: boolean;
    umbraVaultBalance?: boolean;
    privateBalance?: boolean;
    flashTrade?: boolean;
  };
  tokenSymbols?: string[];
  supportedActions?: string[];
};

export type AgentChatRequest = {
  kind?: 'chat';
  responseMode?: 'intent_json' | 'agent_turn';
  messages: AgentMessage[];
  toolSchemas?: AgentToolSchema[];
  toolResults?: AgentToolResult[];
  context?: AiIntentContext;
  /**
   * Assistant tool-call announcements from a previous turn. The client
   * replays these alongside `toolResults` so the model has a complete
   * trace of the conversation when it produces the next turn.
   */
  assistantToolCalls?: AgentToolCall[];
  stream?: boolean;
};

export type AgentIntentName =
  | 'smalltalk'
  | 'draft_payment'
  | 'wallet_query'
  | 'wallet_advice'
  | 'clarification'
  | 'unsupported'
  | 'intent_parse_error';

export type AgentIntentRoute = 'normal' | 'private' | 'magicblock' | 'unknown';

export type AgentIntentResult = {
  kind: 'intent_result';
  intent: AgentIntentName;
  route?: AgentIntentRoute;
  token?: string;
  amount?: string;
  recipientRef?: string;
  clarification?: string;
  message?: string;
  confidence?: number;
};

export type VoiceSpeechRequest = {
  kind?: 'voice_speech';
  text: string;
  languageHint?: string;
  preferredProvider?: VoiceProvider;
};

export type AiProxyEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_CHAT_MODEL?: string;
  AI_PROXY_PRIMARY_PROVIDER_TIMEOUT_MS?: string;
  AI_PROXY_PRIVACY_MODE?: string;
  AI_PROXY_GEMINI_PRIVACY_CONFIRMED?: string;
  AI_PROXY_ALLOW_GEMINI_UNPAID?: string;
  AI_PROXY_ALLOW_VOICE_FALLBACK_WITH_RETENTION?: string;
  /**
   * Pins voice STT/TTS to a single provider. When set to `sarvam`, both
   * transcription and speech use only Sarvam: ElevenLabs is never tried as
   * a fallback and an explicit `preferredProvider: 'elevenlabs'` is
   * rejected, even when `ELEVENLABS_API_KEY` is configured. Leave unset to
   * keep the legacy Sarvam-first-with-ElevenLabs-fallback behavior.
   */
  AI_PROXY_VOICE_PROVIDER_LOCK?: string;
  SARVAM_API_KEY?: string;
  SARVAM_STT_MODEL?: string;
  SARVAM_STT_MODE?: string;
  SARVAM_TTS_MODEL?: string;
  SARVAM_TTS_SPEAKER?: string;
  SARVAM_TTS_LANGUAGE?: string;
  SARVAM_TTS_CODEC?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_STT_MODEL?: string;
  ELEVENLABS_TTS_MODEL?: string;
  ELEVENLABS_OUTPUT_FORMAT?: string;
  ELEVENLABS_ENABLE_LOGGING?: string;
  AI_PROXY_ALLOWED_ORIGINS?: string;
  AI_PROXY_MAX_CHAT_BYTES?: string;
  AI_PROXY_MAX_AUDIO_BYTES?: string;
  AI_PROXY_MAX_TTS_CHARS?: string;
  AI_PROXY_PROVIDER_TIMEOUT_MS?: string;
  AI_PROXY_TTS_ENABLED?: string;
  AI_PROXY_RATE_LIMIT_WINDOW_MS?: string;
  AI_PROXY_RATE_LIMIT_MAX?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  /** Deprecated alias. Prefer UPSTASH_REDIS_REST_URL. */
  KV_REST_API_URL?: string;
  /** Deprecated alias. Prefer UPSTASH_REDIS_REST_TOKEN. */
  KV_REST_API_TOKEN?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_CHAT_MODEL?: string;
  OPENROUTER_FALLBACK_MODELS?: string;
  OPENROUTER_PROVIDER_TIMEOUT_MS?: string;
  OPENROUTER_HTTP_REFERER?: string;
  OPENROUTER_APP_TITLE?: string;
  OFFPAY_API_AI_CREDITS?: {
    getStatus(payload: unknown): Promise<unknown>;
    consume(payload: unknown): Promise<unknown>;
    release?(payload: unknown, reason: string): Promise<unknown>;
  };
  /**
   * Shared secret used to verify the OffPay AI session token. Issued by
   * the OffPay backend (or pre-shared via Wrangler) and held by the
   * client through `EXPO_PUBLIC_OFFPAY_AI_SESSION_SECRET`.
   */
  AI_PROXY_SESSION_SECRET?: string;
  /**
   * `'true'` to refuse requests that are missing or carry an invalid
   * session token. Defaults to soft mode while the token rollout is
   * staged: the Worker logs the reason and continues so older app
   * builds keep working until the secret is distributed everywhere.
   */
  AI_PROXY_REQUIRE_SESSION_TOKEN?: string;
};

export type AudioUpload = {
  blob: Blob;
  filename: string;
  contentType: string;
  languageHint?: string;
};

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  functionCall?: {
    name?: string;
    args?: unknown;
  };
};

export type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};
