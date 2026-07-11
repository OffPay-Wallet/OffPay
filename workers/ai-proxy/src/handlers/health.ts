import {
  DEFAULT_GEMINI_MODEL,
  isStrictPrivacy,
  isTtsEnabled,
  jsonResponse,
} from '../http';
import type { AiProxyEnv } from '../types';

export function handleHealth(env: AiProxyEnv, cors: HeadersInit): Response {
  const sessionAuthentication = (env.AI_PROXY_SESSION_SECRET?.trim().length ?? 0) >= 32;
  return jsonResponse(
    {
      ok: sessionAuthentication,
      sessionAuthentication,
      privacyMode: isStrictPrivacy(env) ? 'strict' : 'relaxed',
      chatProvider: 'gemini',
      chatModel: env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
      voiceProviders: {
        sarvam: Boolean(env.SARVAM_API_KEY),
        elevenlabs: Boolean(env.ELEVENLABS_API_KEY),
      },
      ttsEnabled: isTtsEnabled(env),
    },
    sessionAuthentication ? 200 : 503,
    cors,
  );
}
