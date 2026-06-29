/**
 * Voice input for the Yuga chat dock. Records mic audio (expo-audio),
 * uploads it to the Worker's Sarvam-backed transcribe endpoint, and surfaces
 * the transcript for review before it is sent.
 *
 * State machine:
 *   idle → recording → transcribing → review → (accept → idle | discard → idle)
 *
 * The `review` step is what the voice card shows: the recognized transcript
 * with stop (discard) and send (accept) controls, so the user confirms before
 * anything reaches the agent. Recording/transcription are cancellable, and the
 * recorded file is deleted after upload so audio never lingers on disk.
 *
 * `metering` (0..1) is surfaced for the live waveform while recording.
 *
 * App-lock suppression: recording suppresses the app-lock route so the
 * permission dialog or any brief app-backgrounding doesn't trigger the
 * lock screen / password prompt during a voice session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';

import { transcribeAgentVoice } from '@/lib/agentic-payments/ai-proxy-client';
import { isAbortError } from '@/lib/perf/abort';
import { beginAppLockSuppression } from '@/lib/wallet/app-lock-suppression';

import { normalizeVoiceTranscript } from './voiceTranscript';

export type AgenticVoiceState = 'idle' | 'recording' | 'transcribing' | 'review';

export interface UseAgenticVoiceParams {
  /** Called with the confirmed transcript and detected language when the user taps send (accept). */
  onTranscript: (transcript: string, detectedLanguage?: string) => void;
  /** Called with a user-facing message when recording/transcription fails. */
  onError?: (message: string) => void;
  languageHint?: string;
}

export interface UseAgenticVoiceResult {
  state: AgenticVoiceState;
  /** Transcript awaiting review (only meaningful in the `review` state). */
  transcript: string;
  /** Normalized 0..1 input level for the waveform (only while recording). */
  level: number;
  /** Toggles recording: starts when idle, stops + transcribes when recording. */
  toggle: () => void;
  /** Sends the reviewed transcript to the agent (review state only). */
  accept: () => void;
  /** Discards the current recording/transcript and returns to idle. */
  cancel: () => void;
}

const TRANSCRIBE_TIMEOUT_MS = 15_000;
// expo-audio reports metering in dBFS (roughly -60 silent .. 0 loud).
const METERING_FLOOR_DB = -60;
const MIN_RECORDING_BYTES = 512;

function contentTypeForUri(uri: string): string {
  const path = uri.split('?')[0].toLowerCase();
  if (path.endsWith('.m4a') || path.endsWith('.mp4')) return 'audio/mp4';
  if (path.endsWith('.3gp')) return 'audio/3gpp';
  if (path.endsWith('.webm')) return 'audio/webm';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/mp4';
}

function isUsableRecordingFile(uri: string): boolean {
  try {
    const file = new File(uri);
    return file.exists && file.size >= MIN_RECORDING_BYTES;
  } catch {
    return false;
  }
}

function normalizeMetering(metering: number | undefined): number {
  if (metering == null || Number.isNaN(metering)) return 0;
  const clamped = Math.max(METERING_FLOOR_DB, Math.min(0, metering));
  return (clamped - METERING_FLOOR_DB) / -METERING_FLOOR_DB;
}

async function restorePlaybackAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({ allowsRecording: false });
  } catch {
    // Best-effort; failing to restore should not trap the UI.
  }
}

function deleteRecordingFile(uri: string | null | undefined): void {
  if (uri == null) return;
  try {
    new File(uri).delete();
  } catch {
    // Best-effort cleanup.
  }
}

export function useAgenticVoice(params: UseAgenticVoiceParams): UseAgenticVoiceResult {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 80);
  const [state, setState] = useState<AgenticVoiceState>('idle');
  const [transcript, setTranscript] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const stateRef = useRef<AgenticVoiceState>('idle');
  const lastRecordingUriRef = useRef<string | null>(null);
  /** Language code returned by the STT provider (e.g. 'hi-IN', 'en'). */
  const detectedLanguageRef = useRef<string | null>(null);
  stateRef.current = state;

  // Ref to avoid stale closures for params in async callbacks.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // App-lock suppression — released when recording stops or the hook unmounts.
  const releaseAppLockRef = useRef<(() => void) | null>(null);

  const releaseAppLock = useCallback(() => {
    releaseAppLockRef.current?.();
    releaseAppLockRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      releaseAppLock();
      abortRef.current?.abort();
      void (async () => {
        let uri = lastRecordingUriRef.current;
        if (stateRef.current === 'recording') {
          try {
            await recorder.stop();
            uri = recorder.uri ?? uri;
          } catch {
            // Ignore stop failures during unmount.
          }
        }
        deleteRecordingFile(uri);
        lastRecordingUriRef.current = null;
        await restorePlaybackAudioMode();
      })();
    };
    // recorder identity is stable for the hook's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fail = useCallback(
    (message: string) => {
      setState('idle');
      setTranscript('');
      releaseAppLock();
      params.onError?.(message);
    },
    [params, releaseAppLock],
  );

  const startRecording = useCallback(async () => {
    cancelledRef.current = false;
    setTranscript('');

    try {
      // Suppress the app lock BEFORE requesting permissions so the
      // permission dialog doesn't trigger the lock screen.
      releaseAppLockRef.current = beginAppLockSuppression();

      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        fail('Microphone access is needed for voice. Enable it in Settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      const controller = new AbortController();
      abortRef.current = controller;

      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
    } catch {
      void restorePlaybackAudioMode();
      fail('Could not start recording. Try again.');
    }
  }, [fail, recorder]);

  const stopAndTranscribe = useCallback(async () => {
    setState('transcribing');

    let uri: string | null = null;
    try {
      await recorder.stop();
      const stoppedStatus = recorder.getStatus();
      uri = recorder.uri ?? stoppedStatus.url ?? recorderState.url;
      lastRecordingUriRef.current = uri;

      // Release the app lock now — we have the file and no longer need the mic.
      releaseAppLock();

      if (cancelledRef.current) {
        setState('idle');
        return;
      }

      if (uri == null || !isUsableRecordingFile(uri)) {
        fail('No audio was captured. Hold the mic and speak, then tap again.');
        return;
      }

      if (__DEV__) {
        console.log('[Voice] transcribing file:', uri);
      }

      const result = await transcribeAgentVoice(
        { uri, contentType: contentTypeForUri(uri) },
        {
          languageHint: paramsRef.current.languageHint,
          signal: abortRef.current?.signal,
          timeoutMs: TRANSCRIBE_TIMEOUT_MS,
        },
      );

      if (cancelledRef.current) {
        setState('idle');
        return;
      }

      const recognized = normalizeVoiceTranscript(result.transcript?.trim() ?? '');
      if (__DEV__) {
        console.log('[Voice] transcript result:', recognized.slice(0, 80));
      }

      if (recognized.length === 0) {
        fail("Didn't catch that. Try speaking again.");
        return;
      }

      // Hold the transcript for review instead of auto-submitting.
      setTranscript(recognized);
      detectedLanguageRef.current = result.language ?? null;
      setState('review');
    } catch (error) {
      if (isAbortError(error)) {
        setState('idle');
        return;
      }

      console.warn('[Voice] transcription failed:', error);
      fail('Could not transcribe the audio. Try again.');
    } finally {
      abortRef.current = null;
      // Delete the recorded file so audio never lingers on disk.
      deleteRecordingFile(uri);
      lastRecordingUriRef.current = null;
      void restorePlaybackAudioMode();
    }
  }, [fail, recorder, recorderState.url, releaseAppLock]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') {
      void startRecording();
    } else if (stateRef.current === 'recording') {
      void stopAndTranscribe();
    }
    // Ignore taps while transcribing or in review (those use accept/cancel).
  }, [startRecording, stopAndTranscribe]);

  const accept = useCallback(() => {
    if (stateRef.current !== 'review') return;
    const confirmed = transcript.trim();
    const language = detectedLanguageRef.current ?? undefined;
    setState('idle');
    setTranscript('');
    detectedLanguageRef.current = null;
    if (confirmed.length > 0) params.onTranscript(confirmed, language);
  }, [params, transcript]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    releaseAppLock();
    abortRef.current?.abort();
    if (stateRef.current === 'recording') {
      void (async () => {
        let uri = lastRecordingUriRef.current;
        try {
          await recorder.stop();
          uri = recorder.uri ?? uri;
        } catch {
          // Ignore stop failures during cancel.
        }
        deleteRecordingFile(uri);
        lastRecordingUriRef.current = null;
        await restorePlaybackAudioMode();
      })();
    } else {
      void restorePlaybackAudioMode();
    }
    setState('idle');
    setTranscript('');
  }, [recorder, releaseAppLock]);

  const level = state === 'recording' ? normalizeMetering(recorderState.metering) : 0;

  return { state, transcript, level, toggle, accept, cancel };
}
