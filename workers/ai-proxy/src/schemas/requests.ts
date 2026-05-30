import { ProviderError, lockedVoiceProvider, maxTtsChars } from '../http';
import type { AgentChatRequest, AiProxyEnv, VoiceSpeechRequest } from '../types';

export function validateChatRequest(body: AgentChatRequest): void {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ProviderError('proxy', 400, 'Chat request requires messages.');
  }

  if (body.messages.length > 16) {
    throw new ProviderError('proxy', 400, 'Chat request has too many messages.');
  }

  for (const message of body.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new ProviderError('proxy', 400, 'Chat message role is invalid.');
    }

    if (typeof message.content !== 'string' || message.content.trim().length === 0) {
      throw new ProviderError('proxy', 400, 'Chat message content is required.');
    }
  }

  if ((body.toolSchemas?.length ?? 0) > 24) {
    throw new ProviderError('proxy', 400, 'Too many tool schemas.');
  }
}

export function validateIntentChatRequest(body: AgentChatRequest): void {
  validateChatRequest(body);

  if (body.stream === true) {
    throw new ProviderError('proxy', 400, 'Structured intent requests do not support streaming.');
  }
}

export function validateAgentTurnRequest(body: AgentChatRequest): void {
  validateChatRequest(body);

  if (body.stream === true) {
    throw new ProviderError('proxy', 400, 'Agent turn requests do not support streaming yet.');
  }

  if ((body.toolResults?.length ?? 0) > 8) {
    throw new ProviderError('proxy', 400, 'Too many tool results in a single turn.');
  }

  if ((body.assistantToolCalls?.length ?? 0) > 8) {
    throw new ProviderError('proxy', 400, 'Too many assistant tool calls replayed.');
  }
}

export function validateVoiceSpeechRequest(body: VoiceSpeechRequest, env: AiProxyEnv): void {
  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    throw new ProviderError('proxy', 400, 'Voice speech text is required.');
  }

  if (body.text.length > maxTtsChars(env)) {
    throw new ProviderError('proxy', 400, 'Voice speech text is too long.');
  }

  if (
    body.preferredProvider != null &&
    body.preferredProvider !== 'sarvam' &&
    body.preferredProvider !== 'elevenlabs'
  ) {
    throw new ProviderError('proxy', 400, 'Unsupported voice provider.');
  }

  const locked = lockedVoiceProvider(env);
  if (locked != null && body.preferredProvider != null && body.preferredProvider !== locked) {
    throw new ProviderError('proxy', 400, `Voice is locked to ${locked}.`);
  }
}
