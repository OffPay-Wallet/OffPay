import {
  DEFAULT_GEMINI_MODEL,
  isStrictPrivacy,
  isTtsEnabled,
  jsonResponse,
} from '../http';
import type { AiProxyEnv } from '../types';

export function handleHealth(env: AiProxyEnv, cors: HeadersInit): Response {
  return jsonResponse(
    {
      ok: true,
      privacyMode: isStrictPrivacy(env) ? 'strict' : 'relaxed',
      chatProvider: 'gemini',
      chatModel: env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
      voiceProviders: {
        sarvam: Boolean(env.SARVAM_API_KEY),
        elevenlabs: Boolean(env.ELEVENLABS_API_KEY),
      },
      ttsEnabled: isTtsEnabled(env),
    },
    200,
    cors,
  );
}
