import {
  canUseCloudTtsForText,
  sanitizeTextForCloudTts,
} from '@/lib/agentic-payments/voice-privacy';

describe('voice privacy', () => {
  it('strips wallet references and exact values before cloud TTS', () => {
    const text = sanitizeTextForCloudTts(
      'Sent 2.923910063 SOL to 8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
    );

    expect(text).toBe('Sent [exact amount] SOL to [wallet reference]');
  });

  it('allows cloud TTS only after sanitization removes sensitive facts', () => {
    expect(
      canUseCloudTtsForText('Sent 2.923910063 SOL to 8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz'),
    ).toBe(true);
  });
});
