import {
  agenticSendOutcomeSpeech,
  type AgenticSendSpeechOutcome,
} from '@/lib/agentic-payments/send-outcome-speech';
import { canUseCloudTtsForText } from '@/lib/agentic-payments/voice-privacy';

describe('agenticSendOutcomeSpeech', () => {
  it('distinguishes normal vs private submitted', () => {
    expect(agenticSendOutcomeSpeech('submitted', 'normal')).toBe('Payment submitted.');
    expect(agenticSendOutcomeSpeech('submitted', 'magicblock')).toBe('Private payment submitted.');
  });

  it('covers queued and failed', () => {
    expect(agenticSendOutcomeSpeech('queued', 'magicblock')).toMatch(/queued/i);
    expect(agenticSendOutcomeSpeech('failed', 'normal')).toMatch(/failed/i);
  });

  it('emits only phrases safe for cloud TTS', () => {
    const outcomes: AgenticSendSpeechOutcome[] = ['submitted', 'queued', 'failed'];
    for (const outcome of outcomes) {
      for (const route of ['normal', 'magicblock'] as const) {
        expect(canUseCloudTtsForText(agenticSendOutcomeSpeech(outcome, route))).toBe(true);
      }
    }
  });
});
