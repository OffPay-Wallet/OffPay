import {
  assertSafeVoiceText,
  sanitizeChatRequestForProvider,
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

  it('sanitizes tool result replay before provider calls', () => {
    const request = sanitizeChatRequestForProvider({
      responseMode: 'agent_turn',
      messages: [{ role: 'user', content: 'open SOL long' }],
      assistantToolCalls: [
        {
          id: 'call-1',
          name: 'flash_open_position',
          args: {
            marketSymbol: 'SOL',
            owner: '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
          },
        },
      ],
      toolResults: [
        {
          toolCallId: 'call-1',
          name: 'flash_open_position',
          result: {
            status: 'drafted',
            marketSymbol: 'SOL',
            walletAddress: '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
            transactionBase64: 'AQIDBAUG',
            signature: '4GdHZyr7wXQjDHFx3jGg7f9E2SbfcMrkMWCHnKyvh5kx',
          },
        },
      ],
    });

    expect(JSON.stringify(request)).toContain('drafted');
    expect(JSON.stringify(request)).toContain('SOL');
    expect(JSON.stringify(request)).not.toContain('8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz');
    expect(JSON.stringify(request)).not.toContain('AQIDBAUG');
    expect(JSON.stringify(request)).not.toContain('4GdHZyr7wXQjDHFx3jGg7f9E2SbfcMrkMWCHnKyvh5kx');
  });
});
