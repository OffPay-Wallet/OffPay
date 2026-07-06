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

  it('normalizes RWA voice vocabulary and stock tickers', () => {
    expect(normalizeVoiceTranscript('buy 5 R W A U S D C of T S L A')).toBe(
      'buy 5 RWAUSDC of TSLA',
    );
    expect(normalizeVoiceTranscript('sell zero point zero two S P Y')).toBe(
      'sell zero point zero two SPY',
    );
    expect(normalizeVoiceTranscript('buy S and P five hundred')).toBe('buy SP500');
    expect(normalizeVoiceTranscript('show are double you a holdings')).toBe('show RWA holdings');
  });
});
