import {
  ProviderError,
  arrayBufferToBase64,
  contentTypeForAudioCodec,
  fetchWithTimeout,
  isStrictPrivacy,
  lockedVoiceProvider,
  providerErrorFromResponse,
  providerTimeoutMs,
} from '../http';
import { assertSafeVoiceText } from '../privacy/firewall';
import type { AiProxyEnv, AudioUpload, VoiceProvider, VoiceSpeechRequest } from '../types';

export async function transcribeWithProvider(
  provider: VoiceProvider,
  upload: AudioUpload,
  env: AiProxyEnv,
): Promise<Record<string, unknown>> {
  if (provider === 'sarvam') {
    return transcribeWithSarvam(upload, env);
  }

  return transcribeWithElevenLabs(upload, env);
}

export async function speakWithProvider(
  provider: VoiceProvider,
  body: VoiceSpeechRequest,
  env: AiProxyEnv,
): Promise<Record<string, unknown>> {
  assertSafeVoiceText(body.text);

  if (provider === 'sarvam') {
    return speakWithSarvam(body, env);
  }

  return speakWithElevenLabs(body, env);
}

export function shouldFallbackVoice(
  error: unknown,
  env: AiProxyEnv,
  fallbackProvider: VoiceProvider,
): boolean {
  // A provider lock disables every cross-provider fallback that is not the
  // locked provider. This is the single source of truth for "ElevenLabs is
  // dormant" — it holds even when ELEVENLABS_API_KEY is set.
  const locked = lockedVoiceProvider(env);
  if (locked != null && fallbackProvider !== locked) return false;

  if (fallbackProvider === 'sarvam' && !env.SARVAM_API_KEY) return false;
  if (fallbackProvider === 'elevenlabs' && !env.ELEVENLABS_API_KEY) return false;

  if (
    isStrictPrivacy(env) &&
    fallbackProvider === 'elevenlabs' &&
    env.AI_PROXY_ALLOW_VOICE_FALLBACK_WITH_RETENTION !== 'true' &&
    env.ELEVENLABS_ENABLE_LOGGING !== 'false'
  ) {
    return false;
  }

  if (!(error instanceof ProviderError)) {
    return true;
  }

  return error.status === 403 || error.status === 429 || error.status >= 500;
}

/**
 * Resolves the provider attempt order for speech. Honors the deployment
 * voice lock first, then an explicit per-request preference, then the
 * default Sarvam-first order.
 */
export function orderedSpeechProviders(
  env: AiProxyEnv,
  preferredProvider?: VoiceProvider,
): VoiceProvider[] {
  const locked = lockedVoiceProvider(env);
  if (locked != null) return [locked];
  if (preferredProvider === 'elevenlabs') return ['elevenlabs', 'sarvam'];
  return ['sarvam', 'elevenlabs'];
}

/**
 * The provider that transcription should attempt first, honoring the lock.
 */
export function primaryTranscribeProvider(env: AiProxyEnv): VoiceProvider {
  return lockedVoiceProvider(env) ?? 'sarvam';
}

async function transcribeWithSarvam(
  upload: AudioUpload,
  env: AiProxyEnv,
): Promise<Record<string, unknown>> {
  if (!env.SARVAM_API_KEY) {
    throw new ProviderError('sarvam', 503, 'Sarvam API key is not configured.');
  }

  const form = new FormData();
  form.append('file', upload.blob, upload.filename);
  form.append('model', env.SARVAM_STT_MODEL?.trim() || 'saaras:v3');
  form.append('mode', env.SARVAM_STT_MODE?.trim() || 'transcribe');
  form.append('language_code', upload.languageHint?.trim() || 'unknown');

  const response = await fetchWithTimeout(
    'https://api.sarvam.ai/speech-to-text',
    {
      method: 'POST',
      headers: {
        'api-subscription-key': env.SARVAM_API_KEY,
      },
      body: form,
    },
    providerTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('sarvam', response);
  }

  const payload = (await response.json()) as {
    transcript?: string;
    language_code?: string | null;
    language_probability?: number | null;
  };

  return {
    kind: 'voice_transcript',
    transcript: payload.transcript ?? '',
    language: payload.language_code ?? undefined,
    languageProbability: payload.language_probability ?? undefined,
    provider: 'sarvam',
  };
}

async function transcribeWithElevenLabs(
  upload: AudioUpload,
  env: AiProxyEnv,
): Promise<Record<string, unknown>> {
  if (!env.ELEVENLABS_API_KEY) {
    throw new ProviderError('elevenlabs', 503, 'ElevenLabs API key is not configured.');
  }

  const form = new FormData();
  form.append('file', upload.blob, upload.filename);
  form.append('model_id', env.ELEVENLABS_STT_MODEL?.trim() || 'scribe_v2');

  const query = env.ELEVENLABS_ENABLE_LOGGING === 'false' ? '?enable_logging=false' : '';
  const response = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/speech-to-text${query}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
      },
      body: form,
    },
    providerTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('elevenlabs', response);
  }

  const payload = (await response.json()) as {
    text?: string;
    language_code?: string;
    language_probability?: number;
  };

  return {
    kind: 'voice_transcript',
    transcript: payload.text ?? '',
    language: payload.language_code,
    languageProbability: payload.language_probability,
    provider: 'elevenlabs',
  };
}

async function speakWithSarvam(
  body: VoiceSpeechRequest,
  env: AiProxyEnv,
): Promise<Record<string, unknown>> {
  if (!env.SARVAM_API_KEY) {
    throw new ProviderError('sarvam', 503, 'Sarvam API key is not configured.');
  }

  const codec = env.SARVAM_TTS_CODEC?.trim() || 'mp3';
  const response = await fetchWithTimeout(
    'https://api.sarvam.ai/text-to-speech',
    {
      method: 'POST',
      headers: {
        'api-subscription-key': env.SARVAM_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: body.text,
        target_language_code:
          body.languageHint?.trim() || env.SARVAM_TTS_LANGUAGE?.trim() || 'en-IN',
        model: env.SARVAM_TTS_MODEL?.trim() || 'bulbul:v3',
        speaker: env.SARVAM_TTS_SPEAKER?.trim() || 'shubh',
        output_audio_codec: codec,
        speech_sample_rate: 24000,
      }),
    },
    providerTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('sarvam', response);
  }

  const payload = (await response.json()) as { audios?: string[] };
  const audioBase64 = payload.audios?.[0];

  if (audioBase64 == null || audioBase64.length === 0) {
    throw new ProviderError('sarvam', 502, 'Sarvam returned no audio.');
  }

  return {
    kind: 'voice_audio',
    audioBase64,
    contentType: contentTypeForAudioCodec(codec),
    provider: 'sarvam',
  };
}

async function speakWithElevenLabs(
  body: VoiceSpeechRequest,
  env: AiProxyEnv,
): Promise<Record<string, unknown>> {
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
    throw new ProviderError('elevenlabs', 503, 'ElevenLabs API key or voice id is not configured.');
  }

  if (isStrictPrivacy(env) && env.ELEVENLABS_ENABLE_LOGGING !== 'false') {
    throw new ProviderError('elevenlabs', 503, 'ElevenLabs zero-retention mode is not configured.');
  }

  const outputFormat = env.ELEVENLABS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128';
  const voiceId = encodeURIComponent(env.ELEVENLABS_VOICE_ID.trim());
  const enableLogging = env.ELEVENLABS_ENABLE_LOGGING === 'false' ? '&enable_logging=false' : '';
  const response = await fetchWithTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(
      outputFormat,
    )}${enableLogging}`,
    {
      method: 'POST',
      headers: {
        accept: 'audio/mpeg',
        'content-type': 'application/json',
        'xi-api-key': env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: body.text,
        model_id: env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_flash_v2_5',
      }),
    },
    providerTimeoutMs(env),
  );

  if (!response.ok) {
    throw await providerErrorFromResponse('elevenlabs', response);
  }

  return {
    kind: 'voice_audio',
    audioBase64: arrayBufferToBase64(await response.arrayBuffer()),
    contentType: 'audio/mpeg',
    provider: 'elevenlabs',
  };
}
