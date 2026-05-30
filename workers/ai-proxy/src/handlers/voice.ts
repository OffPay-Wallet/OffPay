import {
  ProviderError,
  isTtsEnabled,
  jsonResponse,
  maxAudioBytes,
  maxChatBytes,
  readAudioUpload,
  readJson,
} from '../http';
import {
  orderedSpeechProviders,
  primaryTranscribeProvider,
  shouldFallbackVoice,
  speakWithProvider,
  transcribeWithProvider,
} from '../providers/voice';
import { assertSafeVoiceText, sanitizeTextForProvider } from '../privacy/firewall';
import { validateVoiceSpeechRequest } from '../schemas/requests';
import type { AiProxyEnv, VoiceProvider, VoiceSpeechRequest } from '../types';

export async function handleVoiceTranscribe(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
): Promise<Response> {
  const upload = await readAudioUpload(request, maxAudioBytes(env));
  const firstProvider = primaryTranscribeProvider(env);
  const fallbackProvider: VoiceProvider = firstProvider === 'sarvam' ? 'elevenlabs' : 'sarvam';

  try {
    const result = await transcribeWithProvider(firstProvider, upload, env);
    return jsonResponse(result, 200, cors);
  } catch (error) {
    if (!shouldFallbackVoice(error, env, fallbackProvider)) {
      throw error;
    }

    const result = await transcribeWithProvider(fallbackProvider, upload, env);
    return jsonResponse(result, 200, cors);
  }
}

export async function handleVoiceSpeech(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
): Promise<Response> {
  if (!isTtsEnabled(env)) {
    return jsonResponse(
      { kind: 'error', code: 'TTS_DISABLED', message: 'Voice speech is disabled.' },
      503,
      cors,
    );
  }

  const body = await readJson<VoiceSpeechRequest>(request, maxChatBytes(env));
  const sanitizedText = sanitizeTextForProvider(body.text);
  // Defense in depth: even after sanitization, refuse to forward voice text
  // that still contains a wallet address, precise amount, or hard-blocked
  // secret. The TTS providers are external, so a single regex miss in
  // sanitizeTextForProvider would otherwise leak.
  assertSafeVoiceText(sanitizedText);
  const safeBody: VoiceSpeechRequest = {
    ...body,
    text: sanitizedText,
  };
  validateVoiceSpeechRequest(safeBody, env);

  const providers = orderedSpeechProviders(env, safeBody.preferredProvider);
  let lastError: unknown;

  for (const provider of providers) {
    try {
      const result = await speakWithProvider(provider, safeBody, env);
      return jsonResponse(result, 200, cors);
    } catch (error) {
      lastError = error;
      if (!shouldFallbackVoice(error, env, provider === 'sarvam' ? 'elevenlabs' : 'sarvam')) {
        throw error;
      }
    }
  }

  throw lastError ?? new ProviderError('voice', 503, 'Voice speech failed.');
}
