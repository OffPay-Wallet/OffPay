import {
  assertSafeVoiceText,
  sanitizeTextForProvider,
} from '../privacy/firewall';

describe('AI Worker privacy firewall', () => {
  it('redacts non-Solana sensitive identifiers before provider calls', () => {
    const text = sanitizeTextForProvider(
      'pay 0x742d35Cc6634C0532925a3b844Bc454e4438f44e phone +1 415-555-1212 card 4242 4242 4242 4242',
    );

    expect(text).toContain('[ADDRESS]');
    expect(text).toContain('[PHONE]');
    expect(text).toContain('[PAYMENT_CARD]');
    expect(text).not.toContain('0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
  });

  it('blocks bare BIP39 phrases and hex private keys', () => {
    expect(() =>
      sanitizeTextForProvider(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    ).toThrow('sensitive wallet material');

    expect(() =>
      sanitizeTextForProvider(
        'private key 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toThrow('sensitive wallet material');
  });

  it('keeps voice TTS fail-closed after sanitization', () => {
    const sanitized = sanitizeTextForProvider(
      '2.123456789 SOL to 8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
    );

    expect(sanitized).toBe('[AMOUNT] SOL to [ADDRESS]');
    expect(() => assertSafeVoiceText(sanitized)).not.toThrow();
  });
});
