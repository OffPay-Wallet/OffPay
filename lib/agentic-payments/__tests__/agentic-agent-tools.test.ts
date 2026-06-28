import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  AGENTIC_TOOL_SCHEMAS,
  formatAgenticToolProcessingLabel,
  getAgenticToolMetadata,
  getAvailableAgenticModelToolSchemas,
  runAgenticTools,
  type AgenticToolRunnerContext,
} from '@/lib/agentic-payments/agent-tools';

import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

jest.mock('@/lib/umbra/umbra-rn-zk-prover', () => ({
  isRnZkProverNativeModuleAvailable: jest.fn(() => true),
}));

function addressFromSeedByte(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const walletAddress = addressFromSeedByte(1);
const recipient = addressFromSeedByte(2);
const nativeSolMint = 'So11111111111111111111111111111111111111112';
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const umbraDusdcMint = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';

const available = { available: true, reason: 'available', message: 'Available' } as const;
const geminiToolDeclarationBudget = 40;
const modelVisibleFlashToolNames = [
  'flash_get_markets',
  'flash_get_positions',
  'flash_get_prices',
  'flash_get_orders',
  'flash_open_position',
  'flash_close_position',
  'flash_add_collateral',
  'flash_remove_collateral',
  'flash_place_trigger_order',
  'flash_edit_trigger_order',
  'flash_cancel_trigger_order',
  'flash_cancel_all_trigger_orders',
  'flash_reverse_position',
] as const;
const modelHiddenFlashToolNames = [
  'flash_get_pool_stats',
  'flash_get_funding_rates',
  'flash_get_open_interest',
  'flash_get_liquidation_clusters',
  'flash_get_market_metrics',
  'flash_get_portfolio_risk',
  'flash_get_absorption_analysis',
  'flash_get_optimal_entry',
  'flash_get_position_sizing',
  'flash_get_hedge_suggestions',
  'flash_get_data_pools',
  'flash_validate_data_access',
  'flash_get_rate_limits',
] as const;

const capabilities: CapabilitiesResponse['capabilities'] = {
  wallet: { balance: available, transactions: available },
  stream: { walletActivity: available },
  swap: {
    tokens: available,
    price: available,
    normalSwap: available,
    privacySwap: available,
    triggerOrders: available,
    recurringSwap: available,
  },
  payment: {
    privateInitMint: available,
    privateBalance: available,
    privateSend: available,
    umbraPrivateP2p: available,
    settle: available,
    rpcBroadcast: available,
  },
  umbra: { execution: available },
};

const balance: WalletBalanceResponse = {
  address: walletAddress,
  network: 'devnet',
  solBalance: 1_500_000_000,
  fetchedAt: 1,
  tokens: [
    {
      mint: usdcMint,
      name: 'USD Coin',
      symbol: 'USDC',
      logo: null,
      balance: '20',
      decimals: 6,
      verified: true,
      spam: false,
    },
    {
      mint: umbraDusdcMint,
      name: 'Devnet USDC (Umbra test)',
      symbol: 'dUSDC',
      logo: null,
      balance: '20',
      decimals: 6,
      verified: true,
      spam: false,
    },
  ],
};

const baseContext: AgenticToolRunnerContext = {
  scope: { walletAddress, network: 'devnet' },
  walletMode: 'online',
  canUseNetwork: true,
  balance,
  capabilities,
  knownWallets: [{ name: 'Account 1', address: walletAddress, active: true }],
  redactions: [],
  userText: 'irrelevant',
  walletImportMethod: 'generated',
};

describe('runAgenticTools', () => {
  it('keeps core Flash Trade tools inside the model declaration budget', () => {
    const toolNames = AGENTIC_TOOL_SCHEMAS.map((schema) => schema.name);

    expect(AGENTIC_TOOL_SCHEMAS.length).toBeLessThanOrEqual(geminiToolDeclarationBudget);
    expect(toolNames).toEqual(expect.arrayContaining([...modelVisibleFlashToolNames]));
    for (const hiddenToolName of modelHiddenFlashToolNames) {
      expect(toolNames).not.toContain(hiddenToolName);
    }
  });

  it('attaches model-facing metadata and refined instructions to tool schemas', () => {
    const balanceSchema = AGENTIC_TOOL_SCHEMAS.find(
      (schema) => schema.name === 'get_wallet_balance',
    );
    const swapSchema = AGENTIC_TOOL_SCHEMAS.find((schema) => schema.name === 'prepare_swap_quote');

    expect(balanceSchema?.xOffpay).toMatchObject({
      category: 'wallet_read',
      networkScope: 'devnet_and_mainnet',
      pendingLabel: 'Checking wallet balance',
    });
    expect(balanceSchema?.description).toContain('available on devnet and mainnet');
    expect(swapSchema?.xOffpay).toMatchObject({
      category: 'swap',
      networkScope: 'mainnet_only',
      pendingLabel: 'Quoting swap',
    });
    expect(swapSchema?.description).toContain('mainnet only');
  });

  it('scopes model-visible tools by active network while preserving both-network tools', () => {
    const devnetToolNames = getAvailableAgenticModelToolSchemas({
      network: 'devnet',
      walletAddress,
      walletId: 'wallet-1',
      walletMode: 'online',
      canUseNetwork: true,
      canUseUmbraWallet: true,
      capabilities,
    }).map((schema) => schema.name);
    const mainnetToolNames = getAvailableAgenticModelToolSchemas({
      network: 'mainnet',
      walletAddress,
      walletId: 'wallet-1',
      walletMode: 'online',
      canUseNetwork: true,
      canUseUmbraWallet: true,
      capabilities,
    }).map((schema) => schema.name);

    expect(devnetToolNames).toEqual(
      expect.arrayContaining([
        'get_wallet_balance',
        'get_wallet_history',
        'draft_normal_send',
        'draft_private_send',
        'check_private_send_ready',
      ]),
    );
    expect(devnetToolNames).not.toContain('prepare_swap_quote');
    expect(devnetToolNames).not.toContain('flash_open_position');
    expect(mainnetToolNames).toEqual(
      expect.arrayContaining([
        'get_wallet_balance',
        'prepare_swap_quote',
        'flash_get_markets',
        'flash_open_position',
      ]),
    );
  });

  it('formats tool-specific processing labels from metadata', () => {
    expect(getAgenticToolMetadata('draft_private_send')?.pendingLabel).toBe(
      'Preparing private transfer',
    );
    expect(formatAgenticToolProcessingLabel([{ name: 'prepare_swap_quote' }])).toBe('Quoting swap');
    expect(
      formatAgenticToolProcessingLabel([
        { name: 'get_wallet_balance' },
        { name: 'get_wallet_history' },
      ]),
    ).toBe('Checking wallet balance and checking recent activity');
  });

  it('returns a privacy-safe token list without addresses or mints', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-1', name: 'list_wallet_tokens', args: {} }],
      baseContext,
    );

    expect(run.drafts).toHaveLength(0);
    expect(run.results).toHaveLength(1);
    const result = run.results[0].result as {
      status: string;
      tokens: Array<Record<string, unknown>>;
    };
    expect(result.status).toBe('ok');
    expect(JSON.stringify(result)).not.toContain(usdcMint);
    expect(JSON.stringify(result)).not.toContain(walletAddress);
    expect(result.tokens.some((token) => token.symbol === 'USDC')).toBe(true);
  });

  it('returns a status code only when balances are still loading', async () => {
    const run = await runAgenticTools([{ id: 'call-1', name: 'list_wallet_tokens', args: {} }], {
      ...baseContext,
      balance: null,
    });

    // Tool result must NOT contain English copy — only structured codes.
    expect(run.results[0].result).toEqual({ status: 'loading' });
  });

  it('returns wallet balance with USD portfolio value before token units', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-wallet-balance', name: 'get_wallet_balance', args: {} }],
      {
        ...baseContext,
        balance: { ...balance, nativeSolUsdPrice: 100 },
        userText: 'what is my balance',
      },
    );

    expect(run.results[0].result).toMatchObject({
      status: 'ok',
      portfolioValueUsd: 190,
      portfolioValueUsdLabel: '$ 190.00',
      valuationCurrency: 'USD',
      valuationCoverage: 'complete',
      pricedAssetCount: 3,
      unpricedAssetCount: 0,
    });
    expect(JSON.stringify(run.results[0].result)).not.toContain(walletAddress);
    expect(JSON.stringify(run.results[0].result)).not.toContain(usdcMint);
  });

  it('uses portfolio valuation prices when raw balance rows omit native SOL price', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-wallet-balance', name: 'get_wallet_balance', args: {} }],
      {
        ...baseContext,
        balance,
        portfolioValuation: {
          currency: 'USD',
          totalUsd: 190,
          total: 190,
          pricedCount: 3,
          expectedCount: 3,
          fetchedAt: 2,
          unitUsdPrices: {
            [nativeSolMint]: 100,
            [usdcMint]: 1,
            [umbraDusdcMint]: 1,
          },
        },
        userText: 'show my wallet balance',
      },
    );
    const result = run.results[0].result as {
      portfolioValueUsd: number;
      portfolioValueUsdLabel: string;
      valuationCoverage: string;
      tokens: Array<{ symbol: string; usdPrice: number | null }>;
    };

    expect(result).toMatchObject({
      portfolioValueUsd: 190,
      portfolioValueUsdLabel: '$ 190.00',
      valuationCoverage: 'complete',
    });
    expect(result.tokens.find((token) => token.symbol === 'SOL')?.usdPrice).toBe(100);
  });

  it('returns SOL balance as a human-readable amount only', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-2', name: 'get_sol_balance', args: {} }],
      baseContext,
    );

    expect(run.results[0].result).toMatchObject({ status: 'ok', sol: '1.5' });
    expect(JSON.stringify(run.results[0].result)).not.toContain(walletAddress);
  });

  it('runs parallel-safe read tool batches together', async () => {
    const startedBatches: string[][] = [];
    const run = await runAgenticTools(
      [
        { id: 'call-balance', name: 'get_wallet_balance', args: {} },
        { id: 'call-sol', name: 'get_sol_balance', args: {} },
      ],
      {
        ...baseContext,
        balance: { ...balance, nativeSolUsdPrice: 100 },
      },
      {
        onToolStart: (toolCalls) => startedBatches.push(toolCalls.map((call) => call.name)),
      },
    );

    expect(startedBatches).toEqual([['get_wallet_balance', 'get_sol_balance']]);
    expect(run.results).toHaveLength(2);
  });

  it('emits insight ids only — the model writes the prose', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-3', name: 'analyze_wallet', args: {} }],
      baseContext,
    );

    const result = run.results[0].result as {
      status: string;
      details: Array<{ id: string; severity: string }>;
    };
    expect(result.status).toBe('ok');
    expect(result.details.length).toBeGreaterThan(0);
    for (const insight of result.details) {
      expect(typeof insight.id).toBe('string');
      expect(typeof insight.severity).toBe('string');
      // No prose fields like `title` or `detail` should appear in the
      // tool result. Those would constitute hardcoded copy in the model
      // payload.
      expect(insight).not.toHaveProperty('title');
      expect(insight).not.toHaveProperty('detail');
    }
  });

  it('builds a private-send draft when the model calls draft_private_send with a redacted recipient', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-4',
          name: 'draft_private_send',
          args: { amount: '5', token: 'USDC', recipient: '[ADDRESS_1]' },
        },
      ],
      {
        ...baseContext,
        redactions: [{ type: 'address', placeholder: '[ADDRESS_1]', value: recipient }],
        userText: `send 5 USDC to ${recipient} privately`,
      },
    );

    expect(run.drafts).toHaveLength(1);
    expect(run.drafts[0]).toMatchObject({
      kind: 'private_send',
      route: 'magicblock',
      draft: {
        recipient,
        rawAmount: '5000000',
        tokenMint: usdcMint,
      },
    });
    const visibleResult = run.results[0].result as Record<string, unknown>;
    expect(JSON.stringify(visibleResult)).not.toContain(recipient);
    expect(visibleResult).toMatchObject({
      status: 'drafted',
      route: 'magicblock',
      tokenSymbol: 'USDC',
    });
  });

  it('returns a structured rejection code when the validator refuses an unknown token', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-5',
          name: 'draft_normal_send',
          args: { amount: '5', token: 'BONK', recipient: '[ADDRESS_1]' },
        },
      ],
      {
        ...baseContext,
        redactions: [{ type: 'address', placeholder: '[ADDRESS_1]', value: recipient }],
        userText: `send 5 BONK to ${recipient}`,
      },
    );

    expect(run.drafts).toHaveLength(0);
    expect(run.results[0].error?.code).toBe('token_unknown');
  });

  it('infers Umbra route from recent user text when the model omits the route arg', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-umbra-1',
          name: 'draft_private_send',
          args: { amount: '2', token: 'dUSDC', recipient: '[ADDRESS_1]' },
        },
      ],
      {
        ...baseContext,
        redactions: [{ type: 'address', placeholder: '[ADDRESS_1]', value: recipient }],
        userText: `send 2 dUSDC to ${recipient} using umbra`,
      },
    );

    expect(run.results[0].error).toBeUndefined();
    expect(run.drafts[0]).toMatchObject({
      kind: 'private_send',
      route: 'umbra',
      draft: {
        recipient,
        rawAmount: '2000000',
        tokenMint: umbraDusdcMint,
        tokenSymbol: 'dUSDC',
      },
    });
  });

  it('maps USDC to the Umbra devnet token on Umbra follow-up drafts', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-umbra-2',
          name: 'draft_private_send',
          args: { amount: '2', token: 'USDC', recipient: '[ADDRESS_1]' },
        },
      ],
      {
        ...baseContext,
        redactions: [{ type: 'address', placeholder: '[ADDRESS_1]', value: recipient }],
        userText: [
          `Send 2 dUSDC to ${recipient} using umbra`,
          'What tokens are supported by the Umbra route?',
          'Yes send USDC',
        ].join('\n'),
      },
    );

    expect(run.results[0].error).toBeUndefined();
    expect(run.drafts[0]).toMatchObject({
      route: 'umbra',
      draft: {
        tokenMint: umbraDusdcMint,
        tokenSymbol: 'dUSDC',
      },
    });
  });

  it('recovers the previous amount and recipient for an Umbra token correction', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-umbra-3',
          name: 'draft_private_send',
          args: { token: 'USDC' },
        },
      ],
      {
        ...baseContext,
        userText: [
          `Send 2 dUSDC to ${recipient} using umbra`,
          'What tokens are supported by the Umbra route?',
          'Yes send USDC',
        ].join('\n'),
      },
    );

    expect(run.results[0].error).toBeUndefined();
    expect(run.drafts[0]).toMatchObject({
      route: 'umbra',
      draft: {
        recipient,
        rawAmount: '2000000',
        tokenMint: umbraDusdcMint,
        tokenSymbol: 'dUSDC',
      },
    });
  });

  it('does not recover stale draft fields for a supported-token question', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-umbra-info',
          name: 'draft_private_send',
          args: {},
        },
      ],
      {
        ...baseContext,
        userText: [
          `Send 2 dUSDC to ${recipient} using umbra`,
          'What tokens are supported by the Umbra route?',
        ].join('\n'),
      },
    );

    expect(run.drafts).toHaveLength(0);
    expect(run.results[0].error?.code).toBe('amount_missing');
  });

  it('accepts an Umbra token mint on Umbra drafts', async () => {
    const run = await runAgenticTools(
      [
        {
          id: 'call-umbra-4',
          name: 'draft_private_send',
          args: { amount: '1', token: umbraDusdcMint, recipient: '[ADDRESS_1]', route: 'umbra' },
        },
      ],
      {
        ...baseContext,
        redactions: [{ type: 'address', placeholder: '[ADDRESS_1]', value: recipient }],
        userText: `send 1 ${umbraDusdcMint} to ${recipient} using umbra`,
      },
    );

    expect(run.results[0].error).toBeUndefined();
    expect(run.drafts[0]).toMatchObject({
      route: 'umbra',
      draft: {
        tokenMint: umbraDusdcMint,
        tokenSymbol: 'dUSDC',
      },
    });
  });

  it('reports unknown_tool when the model calls a tool not in the catalog', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-6', name: 'rm_rf_wallet', args: {} }],
      baseContext,
    );

    expect(run.drafts).toHaveLength(0);
    expect(run.results[0].error?.code).toBe('unknown_tool');
  });

  it('emits a payroll intake intent without exposing payroll data', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-7', name: 'stage_payroll', args: { source: 'upload' } }],
      baseContext,
    );

    expect(run.payrollIntents).toEqual([{ toolCallId: 'call-7', source: 'upload' }]);
    expect(run.results[0].result).toMatchObject({
      status: 'opening_payroll_intake',
      source: 'upload',
    });
    expect(run.drafts).toHaveLength(0);
  });

  it('defaults the payroll intake source to paste', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-8', name: 'stage_payroll', args: {} }],
      baseContext,
    );

    expect(run.payrollIntents[0].source).toBe('paste');
  });
});
