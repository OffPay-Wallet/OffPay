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
          claimExecution: 'confirmation_required',
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

  it('builds RWA catalog, holdings, and activity cards', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-rwa-assets',
        name: 'get_rwa_assets',
        result: {
          status: 'ok',
          assets: [
            {
              symbol: 'SPYd',
              name: 'SP500',
              priceUsd: 749.12,
              tradable: true,
            },
          ],
        },
      },
      {
        toolCallId: 'call-rwa-holdings',
        name: 'get_rwa_holdings',
        result: {
          status: 'ok',
          settlement: [{ symbol: 'RWAUSDC', balance: '100' }],
          holdings: [{ symbol: 'SPYd', name: 'SP500', balance: '0.01', valueUsd: 7.49 }],
        },
      },
      {
        toolCallId: 'call-rwa-history',
        name: 'get_rwa_history',
        result: {
          status: 'ok',
          source: 'network',
          transactions: [
            { type: 'swap', amount: '0.01', tokenSymbol: 'SPYd', status: 'confirmed' },
          ],
        },
      },
    ]);

    expect(cards[0]).toMatchObject({
      title: 'RWA assets',
      subtitle: '1 available',
      items: [expect.objectContaining({ title: 'SP500', detail: 'SPYd · $749.12' })],
    });
    expect(cards[1]).toMatchObject({
      title: 'RWA holdings',
      rows: [expect.objectContaining({ label: 'RWAUSDC', value: '100' })],
      items: [expect.objectContaining({ title: 'SP500', detail: '0.01 SPYd · $7.49' })],
    });
    expect(cards[2]).toMatchObject({
      title: 'RWA activity',
      items: [expect.objectContaining({ title: 'Swap SPYd', detail: '0.01 · Confirmed' })],
    });
    expect(cards[2]?.rows).toBeUndefined();
  });

  it('builds a single RWA stock preview card for specific asset results', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-rwa-asset',
        name: 'get_rwa_assets',
        result: {
          status: 'ok',
          mode: 'asset',
          asset: {
            symbol: 'SPCXd',
            underlyingSymbol: 'SPCX',
            name: 'SpaceX Sandbox RWA',
            category: 'equity',
            devnetSandbox: true,
            logo: null,
            priceUsd: 12.34,
            change24hPct: -0.23,
            tradable: true,
            settlementSymbol: 'RWAUSDC',
            holding: '0.1',
          },
          assets: [],
        },
      },
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: 'SpaceX',
      subtitle: 'SPCXd $12.34',
      rwaAsset: {
        kind: 'rwa_asset',
        symbol: 'SPCXd',
        displayName: 'SpaceX',
        categoryLabel: 'Equity',
        underlyingSymbol: 'SPCX',
        priceLabel: '$12.34',
        change24hPct: -0.23,
        settlementSymbol: 'RWAUSDC',
        holding: '0.1',
      },
    });
    expect(cards[0].items).toBeUndefined();
  });

  it('skips successful draft tools because confirmation cards cover them', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-draft',
        name: 'draft_private_send',
        result: { status: 'drafted', amount: '1', tokenSymbol: 'USDC' },
      },
      {
        toolCallId: 'call-rwa-draft',
        name: 'prepare_rwa_trade',
        result: { status: 'drafted', assetSymbol: 'SPYd' },
      },
    ]);

    expect(cards).toHaveLength(0);
  });

  it('keeps recipient resolution in the background', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-resolve',
        name: 'resolve_recipient',
        result: {
          status: 'resolved',
          source: 'known_wallet',
          selfRecipient: false,
          addressAvailableLocally: true,
        },
      },
      {
        toolCallId: 'call-resolve-error',
        name: 'resolve_recipient',
        error: { code: 'recipient_invalid' },
      },
    ]);

    expect(cards).toHaveLength(0);
  });

  it('keeps local contact listing in the background', () => {
    const cards = buildAgenticToolResultCards([
      {
        toolCallId: 'call-contacts',
        name: 'list_local_contacts',
        result: {
          status: 'ok',
          count: 1,
          contacts: [{ name: 'Karan' }],
          addressAvailableLocally: true,
        },
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
