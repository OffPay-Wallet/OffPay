import {
  hydrateAgenticRedaction,
  runAgenticPrivacyFirewall,
  sanitizeAgentMessagesForAi,
} from '@/lib/agentic-payments/privacy-firewall';

describe('agentic privacy firewall', () => {
  it('redacts wallet addresses, SNS names, emails, IPs, and high precision amounts', () => {
    const result = runAgenticPrivacyFirewall(
      'send 1.123456789 USDC to 8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz and karan.sol from a@b.com at 127.0.0.1',
    );

    expect(result.blocked).toBe(false);
    expect(result.sanitizedText).toContain('[AMOUNT_');
    expect(result.sanitizedText).toContain('[ADDRESS_');
    expect(result.sanitizedText).toContain('[SNS_');
    expect(result.sanitizedText).toContain('[EMAIL_');
    expect(result.sanitizedText).toContain('[IP_');
    expect(result.sanitizedText).not.toContain('8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz');
  });

  it('redacts EVM addresses, phone numbers, and payment-card-shaped numbers', () => {
    const result = runAgenticPrivacyFirewall(
      'send to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e call +1 415-555-1212 card 4242 4242 4242 4242',
    );

    expect(result.blocked).toBe(false);
    expect(result.sanitizedText).toContain('[EVM_ADDRESS_');
    expect(result.sanitizedText).toContain('[PHONE_');
    expect(result.sanitizedText).toContain('[PAYMENT_CARD_');
    expect(result.sanitizedText).not.toContain('0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
  });

  it('blocks private keys and seed phrase prompts before provider calls', () => {
    const privateKeyResult = runAgenticPrivacyFirewall(
      'my private key is 4Nd1mFwdgh6QWRU1ZxSgoQdMh6BFXJtVFowrfeGpG3La6bmPbj9PMmyFxgpxET5xPDv3PygDZp47sQeQ1VFCEfvn',
    );
    expect(privateKeyResult.blocked).toBe(true);

    const seedResult = runAgenticPrivacyFirewall(
      'seed phrase apple banana orange wagon ladder window hover file summer butter photo dinner',
    );
    expect(seedResult.blocked).toBe(true);
  });

  it('blocks bare BIP39 phrases, hex private keys, and secret-bearing URLs', () => {
    const bareMnemonicResult = runAgenticPrivacyFirewall(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    expect(bareMnemonicResult.blocked).toBe(true);

    const hexPrivateKeyResult = runAgenticPrivacyFirewall(
      'secret key 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(hexPrivateKeyResult.blocked).toBe(true);

    const urlResult = runAgenticPrivacyFirewall(
      'https://example.test/callback?token=abcdefghijklmnopqrstuvwxyz123456',
    );
    expect(urlResult.blocked).toBe(true);
  });

  it('hydrates placeholders locally for execution only', () => {
    const result = runAgenticPrivacyFirewall(
      'send 5 USDC to 8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
    );
    const placeholder = result.redactions.find((item) => item.type === 'address')?.placeholder;

    expect(placeholder).toBeDefined();
    expect(hydrateAgenticRedaction(placeholder, result.redactions)).toBe(
      '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
    );
  });

  it('sanitizes message history and stops on blocked content', () => {
    const result = sanitizeAgentMessagesForAi([
      { role: 'user', content: 'hello 8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz' },
      { role: 'user', content: 'Bearer sk_test_123456789012345678901234567890' },
    ]);

    expect(result.blocked).toBe(true);
    expect(result.messages[0]?.content).toContain('[ADDRESS_');
  });
});
