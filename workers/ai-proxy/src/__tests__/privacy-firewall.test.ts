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

  it('preserves wallet tool amount and balance fields before provider calls', () => {
    const request = sanitizeChatRequestForProvider({
      responseMode: 'agent_turn',
      messages: [{ role: 'user', content: 'show my private balances and recent activity' }],
      toolResults: [
        {
          toolCallId: 'call-umbra-balance',
          name: 'get_umbra_balances',
          result: {
            route: 'umbra',
            balances: [
              {
                symbol: 'dUSDC',
                displayBalance: '100.000000000',
                mint: '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
              },
            ],
          },
        },
        {
          toolCallId: 'call-umbra-atomic-balance',
          name: 'get_umbra_balances',
          result: {
            route: 'umbra',
            symbol: 'dUSDC',
            displayBalance: '1000000000',
            rawAmount: '1234567890123456',
            walletAddress: '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz',
          },
        },
        {
          toolCallId: 'call-wallet-history',
          name: 'get_wallet_history',
          result: {
            status: 'ok',
            transactions: [
              {
                type: 'umbra_private_send',
                amount: '2.123456789',
                tokenSymbol: 'dUSDC',
                signature: '4GdHZyr7wXQjDHFx3jGg7f9E2SbfcMrkMWCHnKyvh5kx',
              },
              {
                type: 'magicblock_private_send',
                amount: '1000000000',
                tokenSymbol: 'USDC',
              },
            ],
          },
        },
      ],
    });

    const [umbra, umbraAtomic, history] = request.toolResults ?? [];
    const umbraResult = umbra?.result as { balances?: Array<{ displayBalance?: string }> };
    const umbraAtomicResult = umbraAtomic?.result as {
      displayBalance?: string;
      rawAmount?: string;
    };
    const historyResult = history?.result as { transactions?: Array<{ amount?: string }> };
    const serialized = JSON.stringify(request);

    expect(umbraResult.balances?.[0]?.displayBalance).toBe('100.000000000');
    expect(umbraAtomicResult.displayBalance).toBe('1000000000');
    expect(umbraAtomicResult.rawAmount).toBe('1234567890123456');
    expect(historyResult.transactions?.[0]?.amount).toBe('2.123456789');
    expect(historyResult.transactions?.[1]?.amount).toBe('1000000000');
    expect(serialized).not.toContain('[AMOUNT]');
    expect(serialized).not.toContain('[PHONE]');
    expect(serialized).not.toContain('8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz');
    expect(serialized).not.toContain('4GdHZyr7wXQjDHFx3jGg7f9E2SbfcMrkMWCHnKyvh5kx');
  });

  it('preserves contact availability hints without forwarding local contact data', () => {
    const request = sanitizeChatRequestForProvider({
      responseMode: 'agent_turn',
      messages: [{ role: 'user', content: 'list contacts' }],
      context: {
        contactsAvailable: true,
        contactCount: 3,
        supportedActions: ['list_local_contacts'],
        wallets: [{ name: 'Karan', address: '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz' }],
      } as never,
    });

    expect(request.context).toMatchObject({
      contactsAvailable: true,
      contactCount: 3,
      supportedActions: ['list_local_contacts'],
    });
    expect(JSON.stringify(request)).not.toContain('Karan');
    expect(JSON.stringify(request)).not.toContain('8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz');
  });
});
