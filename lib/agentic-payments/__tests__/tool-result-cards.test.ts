import { buildAgenticToolResultCards } from '@/lib/agentic-payments/tool-result-cards';

describe('buildAgenticToolResultCards', () => {
  it('builds a portfolio card from wallet balance results', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-balance',
        name: 'get_wallet_balance',
        result: {
          status: 'ok',
          network: 'devnet',
          portfolioValueUsdLabel: '$ 129.50',
          valuationCoverage: 'complete',
          sol: '1.2',
          tokens: [
            { symbol: 'USDC', name: 'USD Coin', balance: '100', spam: false },
            { symbol: 'dUSDC', name: 'dUSDC', balance: '29.5', spam: false },
          ],
        },
      },
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: 'Portfolio',
      subtitle: '$ 129.50',
      rows: expect.arrayContaining([
        expect.objectContaining({ label: 'Network', value: 'devnet' }),
        expect.objectContaining({ label: 'SOL', value: '1.2' }),
      ]),
      items: [
        expect.objectContaining({ title: '100 USDC' }),
        expect.objectContaining({ title: '29.5 dUSDC' }),
      ],
    });
  });

  it('builds a recent activity card from history results', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-history',
        name: 'get_wallet_history',
        result: {
          status: 'ok',
          count: 2,
          source: 'cache',
          transactions: [
            { type: 'receive', amount: '1', tokenSymbol: 'USDC', status: 'confirmed' },
            { type: 'send', amount: '0.25', tokenSymbol: 'SOL', status: 'confirmed' },
          ],
        },
      },
    ]);

    expect(cards[0]).toMatchObject({
      title: 'Recent activity',
      subtitle: '2 recent items',
      items: [
        expect.objectContaining({ title: 'Receive 1 USDC' }),
        expect.objectContaining({ title: 'Send 0.25 SOL' }),
      ],
    });
  });

  it('builds Umbra vault and claim cards', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-umbra',
        name: 'get_umbra_balances',
        result: {
          status: 'ok',
          network: 'devnet',
          vaultRegistered: true,
          vaultCanShield: true,
          vaultState: 'exists',
          balances: [
            { symbol: 'dUSDC', displayBalance: '2.5', state: 'shared' },
            { symbol: 'dUSDT', displayBalance: '0', state: 'non_existent' },
          ],
        },
      },
      {
        toolCallId: 'call-claims',
        name: 'scan_umbra_claims',
        result: {
          status: 'ok',
          pendingClaimCount: 1,
          pendingClaimUtxoCount: 1,
          vaultRegistered: true,
          claimExecution: 'manual_only',
        },
      },
    ]);

    expect(cards[0]).toMatchObject({
      title: 'Umbra vault',
      subtitle: 'Vault ready',
      items: expect.arrayContaining([expect.objectContaining({ title: '2.5 dUSDC' })]),
    });
    expect(cards[1]).toMatchObject({
      title: 'Umbra claims',
      subtitle: '1 pending',
      tone: 'warning',
    });
  });

  it('skips successful draft tools because confirmation cards cover them', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-draft',
        name: 'draft_private_send',
        result: { status: 'drafted', amount: '1', tokenSymbol: 'USDC' },
      },
    ]);

    expect(cards).toHaveLength(0);
  });

  it('keeps error cards for failed tools', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-error',
        name: 'get_swap_price',
        error: { code: 'feature_unavailable' },
      },
    ]);

    expect(cards).toEqual([
      expect.objectContaining({
        title: 'Token price',
        subtitle: 'Could not complete',
        tone: 'danger',
        rows: [expect.objectContaining({ label: 'Code', value: 'feature_unavailable' })],
      }),
    ]);
  });
});
