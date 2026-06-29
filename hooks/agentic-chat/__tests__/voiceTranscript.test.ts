import { normalizeVoiceTranscript } from '@/hooks/agentic-chat/voiceTranscript';

describe('normalizeVoiceTranscript', () => {
  it('normalizes payment token abbreviations and common SOL mishearings', () => {
    expect(normalizeVoiceTranscript('send 2 soul to karan in U S D C')).toBe(
      'send 2 SOL to karan in USDC',
    );
    expect(normalizeVoiceTranscript('send D U S D C with dee you ess dee tee')).toBe(
      'send dUSDC with dUSDT',
    );
  });

  it('normalizes local tool vocabulary for contacts and Umbra routes', () => {
    expect(normalizeVoiceTranscript('show my context')).toBe('show my contacts');
    expect(normalizeVoiceTranscript('list contact')).toBe('list contacts');
    expect(normalizeVoiceTranscript('send using magic block')).toBe('send using MagicBlock');
    expect(normalizeVoiceTranscript('umbrella on shield from volt')).toBe(
      'Umbra unshield from vault',
    );
  });
});
