import { hydrateAssistantToolResultPlaceholders } from '@/lib/agentic-payments/assistant-tool-placeholders';

describe('hydrateAssistantToolResultPlaceholders', () => {
  it('restores high precision wallet history amounts with token context', () => {
    const hydrated = hydrateAssistantToolResultPlaceholders(
      [
        'Here is a summary of your recent activity:',
        '- Received 1 USDC',
        '- Sent [AMOUNT] SOL',
        '- Received 0.25 SOL',
      ].join('\n'),
      [
        {
          toolCallId: 'call-history',
          name: 'get_wallet_history',
          result: {
            transactions: [
              { direction: 'in', amount: '1', tokenSymbol: 'USDC' },
              { direction: 'out', amount: '0.000001234', tokenSymbol: 'SOL' },
              { direction: 'in', amount: '0.25', tokenSymbol: 'SOL' },
            ],
          },
        },
      ],
    );

    expect(hydrated).toContain('- Sent 0.000001234 SOL');
    expect(hydrated).not.toContain('[AMOUNT]');
  });

  it('restores long numeric balance placeholders for Umbra results', () => {
    const hydrated = hydrateAssistantToolResultPlaceholders(
      'Your Umbra vault balance includes [PHONE] in dUSDC.',
      [
        {
          toolCallId: 'call-umbra',
          name: 'get_umbra_balances',
          result: {
            balances: [{ symbol: 'dUSDC', displayBalance: '1000000000' }],
          },
        },
      ],
    );

    expect(hydrated).toContain('1000000000 in dUSDC');
    expect(hydrated).not.toContain('[PHONE]');
  });

  it('leaves placeholders untouched when there is no matching tool data', () => {
    expect(hydrateAssistantToolResultPlaceholders('Sent [AMOUNT] SOL', [])).toBe(
      'Sent [AMOUNT] SOL',
    );
  });

  it('does not replace phone placeholders outside wallet numeric context', () => {
    const hydrated = hydrateAssistantToolResultPlaceholders('I cannot call [PHONE].', [
      {
        toolCallId: 'call-umbra',
        name: 'get_umbra_balances',
        result: { balances: [{ symbol: 'dUSDC', displayBalance: '1234567890' }] },
      },
    ]);

    expect(hydrated).toBe('I cannot call [PHONE].');
  });
});
