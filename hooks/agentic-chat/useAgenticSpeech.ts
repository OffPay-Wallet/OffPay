/**
 * Outcome read-aloud for the Yuga assistant. Speaks short, sanitized status
 * lines after a send/batch-send resolves (e.g. "Batch send completed", "Payment
 * failed") via the Worker's Sarvam-locked TTS endpoint.
 *
 * Hard safety rules (enforced here, not left to callers):
 *  - Outcome-only: callers pass a status phrase, never row detail.
 *  - Never speak wallet addresses, signatures, or exact amounts. Every
 *    utterance is gated through `canUseCloudTtsForText`; batch-send outcomes use
 *    `payrollMode` so plain token/currency amounts are also blocked.
 *  - Silent-fail: a blocked or failed utterance never surfaces an error — the
 *    text status is already on screen. TTS is purely additive.
 *
 * Separate from `useAgenticVoice` (input/recording) so playback and capture
 * never contend for the audio session in the same hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { speakAgentText } from '@/lib/agentic-payments/ai-proxy-client';
import { canUseCloudTtsForText } from '@/lib/agentic-payments/voice-privacy';

export interface UseAgenticSpeechParams {
  /** Master switch — when false, `speak` is a no-op (user preference / muted). */
  enabled?: boolean;
}

export interface SpeakOutcomeOptions {
  /** Suppress plain token/currency amounts too (use for all payroll outcomes). */
  payrollMode?: boolean;
  languageHint?: string;
}

export interface UseAgenticSpeechResult {
  state: 'idle' | 'loading' | 'speaking';
  muted: boolean;
  /** Speaks a short outcome phrase. Resolves regardless of success. */
  speak: (text: string, options?: SpeakOutcomeOptions) => Promise<void>;
  stop: () => void;
  toggleMuted: () => void;
}

const SPEECH_TIMEOUT_MS = 15_000;
const SPEECH_ACTIVE_RESET_MS = 10_000;

function base64DataUri(audioBase64: string, contentType: string): string {
  return `data:${contentType};base64,${audioBase64}`;
}

export function useAgenticSpeech(params: UseAgenticSpeechParams = {}): UseAgenticSpeechResult {
  const externallyEnabled = params.enabled ?? true;
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<UseAgenticSpeechResult['state']>('idle');
  const abortRef = useRef<AbortController | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current == null) return;
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }, []);

  const teardownPlayer = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    if (player == null) return;
    try {
      player.remove();
    } catch {
      // Best-effort.
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearResetTimer();
      teardownPlayer();
    };
  }, [clearResetTimer, teardownPlayer]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearResetTimer();
    teardownPlayer();
    setState('idle');
  }, [clearResetTimer, teardownPlayer]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      if (next) stop();
      return next;
    });
  }, [stop]);

  const speak = useCallback(
    async (text: string, options: SpeakOutcomeOptions = {}): Promise<void> => {
      if (!externallyEnabled || muted) return;
      const phrase = text.trim();
      if (phrase.length === 0) return;

      // Privacy gate: refuse anything that still carries an address, exact
      // amount, or (in payroll mode) a plain token/currency amount. The text
      // status is already visible, so we simply stay silent.
      if (!canUseCloudTtsForText(phrase, { payrollMode: options.payrollMode })) {
        return;
      }

      // Cancel any in-flight or playing utterance before starting a new one.
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      setState('loading');
      if (__DEV__) {
        console.log('[TTS] speak requested:', phrase.slice(0, 60));
      }

      try {
        const result = await speakAgentText(
          { text: phrase, languageHint: options.languageHint },
          {
            signal: controller.signal,
            timeoutMs: SPEECH_TIMEOUT_MS,
            payrollMode: options.payrollMode,
          },
        );

        if (controller.signal.aborted) return;
        if (result?.audioBase64 == null || result.audioBase64.length === 0) return;

        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (controller.signal.aborted) return;

        const player = createAudioPlayer({
          uri: base64DataUri(result.audioBase64, result.contentType),
        });
        playerRef.current = player;
        player.play();
        setState('speaking');
        if (__DEV__) {
          console.log('[TTS] playing audio');
        }
        clearResetTimer();
        resetTimerRef.current = setTimeout(() => {
          teardownPlayer();
          setState('idle');
          resetTimerRef.current = null;
        }, SPEECH_ACTIVE_RESET_MS);
      } catch (error) {
        // Silent-fail: TTS is additive; never surface an error.
        console.warn('[TTS] speak failed:', error);
        setState('idle');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [clearResetTimer, externallyEnabled, muted, stop, teardownPlayer],
  );

  return { state, muted: muted || !externallyEnabled, speak, stop, toggleMuted };
}
