import type { OffpayNetwork } from '@/types/offpay-api';

export type AgentMessageRole = 'user' | 'assistant';

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
};

export type AgentToolSchema = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
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

export type AgentSafeContext = {
  network?: OffpayNetwork;
  walletMode?: 'online' | 'offline';
  locale?: string;
  capabilities?: {
    networkAvailable: boolean;
    walletBalance: boolean;
    normalSend: boolean;
    privateSend: boolean;
    swap?: boolean;
    umbra?: boolean;
    umbraVaultBalance?: boolean;
    magicblockPrivateBalance?: boolean;
    privateBalance?: boolean;
    flashTrade?: boolean;
  };
  supportedActions?: string[];
  tokenSymbols?: string[];
};

export type AgentToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type AgentChatRequest = {
  kind?: 'chat';
  /**
   * Response shape. `'agent_turn'` (default) drives the tool-calling agent
   * loop. `'intent_json'` is the legacy structured-intent mode kept for
   * backwards compatibility.
   */
  responseMode?: 'intent_json' | 'agent_turn';
  messages: AgentMessage[];
  toolSchemas?: AgentToolSchema[];
  toolResults?: AgentToolResult[];
  /**
   * The assistant's previously announced tool calls, replayed alongside
   * `toolResults` so the model has the complete trace of the conversation
   * when it produces the next turn.
   */
  assistantToolCalls?: AgentToolCall[];
  context?: AgentSafeContext;
  stream?: boolean;
};

export type AgentTurn =
  | { kind: 'agent_text'; text: string }
  | {
      kind: 'agent_tool_calls';
      toolCalls: AgentToolCall[];
    };

export type AgentTurnRequest = {
  kind?: 'chat';
  responseMode: 'agent_turn';
  messages: AgentMessage[];
  toolSchemas?: AgentToolSchema[];
  toolResults?: AgentToolResult[];
  assistantToolCalls?: AgentToolCall[];
  context?: AgentSafeContext;
  stream?: false;
};

export type AiIntentContext = {
  privacyMode: 'strict';
  network?: OffpayNetwork;
  walletMode?: 'online' | 'offline';
  locale?: string;
  capabilities?: {
    networkAvailable: boolean;
    normalSend: boolean;
    privateSend: boolean;
    swap?: boolean;
    umbra?: boolean;
    umbraVaultBalance?: boolean;
    magicblockPrivateBalance?: boolean;
    privateBalance?: boolean;
    flashTrade?: boolean;
  };
  tokenSymbols?: string[];
  supportedActions?: string[];
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

export type AgentIntentRequest = {
  kind?: 'chat';
  responseMode: 'intent_json';
  messages: AgentMessage[];
  context?: AiIntentContext;
  stream?: false;
};

export type AgentChatDeltaEvent = {
  kind: 'chat_delta';
  text: string;
};

export type AgentToolRequestEvent = {
  kind: 'tool_request';
  toolCallId: string;
  name: string;
  input: unknown;
};

export type AgentChatDoneEvent = {
  kind: 'chat_done';
  responseId: string;
};

export type AgentProxyErrorEvent = {
  kind: 'error';
  code: string;
  message: string;
  retryAfterMs?: number;
};

export type AgentChatEvent =
  | AgentChatDeltaEvent
  | AgentToolRequestEvent
  | AgentChatDoneEvent
  | AgentProxyErrorEvent;

export type VoiceProvider = 'sarvam' | 'elevenlabs';

export type VoiceTranscriptionResult = {
  kind: 'voice_transcript';
  transcript: string;
  language?: string;
  languageProbability?: number;
  provider: VoiceProvider;
};

export type VoiceSpeechRequest = {
  kind?: 'voice_speech';
  text: string;
  languageHint?: string;
  preferredProvider?: VoiceProvider;
};

export type VoiceSpeechResult = {
  kind: 'voice_audio';
  audioBase64: string;
  contentType: string;
  provider: VoiceProvider;
};
