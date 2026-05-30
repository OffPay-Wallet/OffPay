import {
  orderedSpeechProviders,
  primaryTranscribeProvider,
  shouldFallbackVoice,
} from '../providers/voice';
import { validateVoiceSpeechRequest } from '../schemas/requests';
import { ProviderError } from '../http';
import type { AiProxyEnv } from '../types';

function baseEnv(overrides: Partial<AiProxyEnv> = {}): AiProxyEnv {
  return {
    SARVAM_API_KEY: 'sarvam-key',
    ELEVENLABS_API_KEY: 'eleven-key',
    ELEVENLABS_VOICE_ID: 'voice-id',
    ...overrides,
  };
}

describe('voice provider lock', () => {
  describe('when locked to sarvam', () => {
    const env = baseEnv({ AI_PROXY_VOICE_PROVIDER_LOCK: 'sarvam' });

    it('orders speech providers as sarvam-only', () => {
      expect(orderedSpeechProviders(env)).toEqual(['sarvam']);
      expect(orderedSpeechProviders(env, 'elevenlabs')).toEqual(['sarvam']);
    });

    it('keeps transcription on sarvam', () => {
      expect(primaryTranscribeProvider(env)).toBe('sarvam');
    });

    it('never falls back to elevenlabs even on a retryable error', () => {
      const retryable = new ProviderError('sarvam', 503, 'down');
      expect(shouldFallbackVoice(retryable, env, 'elevenlabs')).toBe(false);
    });

    it('rejects an explicit elevenlabs preference', () => {
      expect(() =>
        validateVoiceSpeechRequest({ text: 'hello', preferredProvider: 'elevenlabs' }, env),
      ).toThrow('locked to sarvam');
    });

    it('allows an explicit sarvam preference', () => {
      expect(() =>
        validateVoiceSpeechRequest({ text: 'hello', preferredProvider: 'sarvam' }, env),
      ).not.toThrow();
    });
  });

  describe('when unlocked', () => {
    const env = baseEnv({ AI_PROXY_PRIVACY_MODE: 'relaxed' });

    it('keeps the legacy sarvam-first order with elevenlabs fallback', () => {
      expect(orderedSpeechProviders(env)).toEqual(['sarvam', 'elevenlabs']);
      expect(orderedSpeechProviders(env, 'elevenlabs')).toEqual(['elevenlabs', 'sarvam']);
    });

    it('falls back to elevenlabs on a retryable sarvam error', () => {
      const retryable = new ProviderError('sarvam', 500, 'down');
      expect(shouldFallbackVoice(retryable, env, 'elevenlabs')).toBe(true);
    });
  });
});
