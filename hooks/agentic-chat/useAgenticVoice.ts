/**
 * Voice input for the Yuga chat dock. Records mic audio (expo-audio),
 * uploads it to the Worker's Sarvam-backed transcribe endpoint, and hands the
 * transcript back to the caller (which feeds it into the same agent submit
 * path as typed text).
 *
 * State machine: idle → recording → transcribing → idle. Recording and
 * transcription are both cancellable. The recorded file is deleted after
 * upload so audio never lingers on disk.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';

import { transcribeAgentVoice } from '@/lib/agentic-payments/ai-proxy-client';

export type AgenticVoiceState = 'idle' | 'recording' | 'transcribing';

export interface UseAgenticVoiceParams {
  /** Called with the recognized transcript once transcription succeeds. */
  onTranscript: (transcript: string) => void;
  /** Called with a user-facing message when recording/transcription fails. */
  onError?: (message: string) => void;
  languageHint?: string;
}

export interface UseAgenticVoiceResult {
  state: AgenticVoiceState;
  /** Toggles recording: starts when idle, stops + transcribes when recording. */
  toggle: () => void;
  cancel: () => void;
}

const TRANSCRIBE_TIMEOUT_MS = 30_000;

function fileNameForUri(uri: string): string {
  const base = uri.split('/').pop();
  return base != null && base.length > 0 ? base : 'recording.m4a';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<AgenticVoiceState>('idle');

  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const stateRef = useRef<AgenticVoiceState>('idle');
  const lastRecordingUriRef = useRef<string | null>(null);
  stateRef.current = state;

  useEffect(() => {
    return () => {
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
      params.onError?.(message);
    },
    [params],
  );

  const startRecording = useCallback(async () => {
    cancelledRef.current = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        fail('Microphone access is needed for voice. Enable it in Settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
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
      uri = recorder.uri;
      lastRecordingUriRef.current = uri;
      if (cancelledRef.current) {
        setState('idle');
        return;
      }
      if (uri == null) {
        fail('No audio was captured. Hold the mic and speak, then tap again.');
        return;
      }

      const form = new FormData();
      // React Native FormData accepts a file descriptor object.
      form.append('file', {
        uri,
        name: fileNameForUri(uri),
        type: 'audio/m4a',
      } as unknown as Blob);

      const controller = new AbortController();
      abortRef.current = controller;
      const result = await transcribeAgentVoice(form, {
        languageHint: params.languageHint,
        signal: controller.signal,
        timeoutMs: TRANSCRIBE_TIMEOUT_MS,
      });

      if (cancelledRef.current) {
        setState('idle');
        return;
      }

      const transcript = result.transcript?.trim() ?? '';
      if (transcript.length === 0) {
        fail("Didn't catch that. Try speaking again.");
        return;
      }
      setState('idle');
      params.onTranscript(transcript);
    } catch (error) {
      if (isAbortError(error)) {
        setState('idle');
        return;
      }
      fail('Could not transcribe the audio. Try again.');
    } finally {
      abortRef.current = null;
      // Delete the recorded file so audio never lingers on disk.
      deleteRecordingFile(uri);
      if (lastRecordingUriRef.current === uri) lastRecordingUriRef.current = null;
      void restorePlaybackAudioMode();
    }
  }, [fail, params, recorder]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'idle') {
      void startRecording();
    } else if (stateRef.current === 'recording') {
      void stopAndTranscribe();
    }
    // Ignore taps while transcribing.
  }, [startRecording, stopAndTranscribe]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
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
  }, [recorder]);

  return { state, toggle, cancel };
}
