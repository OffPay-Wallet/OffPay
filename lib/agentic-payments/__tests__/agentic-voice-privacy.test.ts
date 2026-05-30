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

  describe('payroll mode', () => {
    it('suppresses plain token amounts that the precise-decimal pattern misses', () => {
      const text = sanitizeTextForCloudTts('Paying 5000 USDC across 12 employees', {
        payrollMode: true,
      });

      expect(text).toBe('Paying [amount] across 12 employees');
    });

    it('suppresses comma-grouped and currency-prefixed totals', () => {
      expect(
        sanitizeTextForCloudTts('Total is 5,000.00 USDT or about $5000', { payrollMode: true }),
      ).toBe('Total is [amount] or about [amount]');
    });

    it('does not touch plain amounts when payroll mode is off', () => {
      expect(sanitizeTextForCloudTts('You have 5000 USDC')).toBe('You have 5000 USDC');
    });

    it('reports cloud TTS safe once the raw token amount is suppressed in payroll mode', () => {
      expect(canUseCloudTtsForText('Paying 5000 USDC', { payrollMode: true })).toBe(true);
    });
  });
});
