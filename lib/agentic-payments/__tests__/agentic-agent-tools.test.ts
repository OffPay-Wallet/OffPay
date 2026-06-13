import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  AGENTIC_TOOL_SCHEMAS,
  runAgenticTools,
  type AgenticToolRunnerContext,
} from '@/lib/agentic-payments/agent-tools';
import * as offpayApiClient from '@/lib/api/offpay-api-client';

import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

jest.mock('@/lib/umbra/umbra-rn-zk-prover', () => ({
  isRnZkProverNativeModuleAvailable: jest.fn(() => true),
}));

function addressFromSeedByte(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const walletAddress = addressFromSeedByte(1);
const recipient = addressFromSeedByte(2);
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const umbraDusdcMint = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';

const available = { available: true, reason: 'available', message: 'Available' } as const;
const geminiToolDeclarationBudget = 40;
const flashToolNames = [
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
};

describe('runAgenticTools', () => {
  it('keeps every Flash Trade tool inside the model declaration budget', () => {
    const toolNames = AGENTIC_TOOL_SCHEMAS.map((schema) => schema.name);

    expect(AGENTIC_TOOL_SCHEMAS.length).toBeLessThanOrEqual(geminiToolDeclarationBudget);
    expect(toolNames).toEqual(expect.arrayContaining([...flashToolNames]));
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

  it('rejects generic private balance reads from the MagicBlock rail tool', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-private-balance', name: 'get_private_payment_balance', args: {} }],
      {
        ...baseContext,
        userText: 'what is my private balance',
      },
    );

    expect(run.results[0].error?.code).toBe('use_umbra_vault_balance');
  });

  it('returns an explicit MagicBlock private-payment balance summary without addresses or mints', async () => {
    jest.spyOn(offpayApiClient, 'getPrivatePaymentBalance').mockResolvedValueOnce({
      address: walletAddress,
      mint: usdcMint,
      baseBalance: '20000000',
      privateBalance: '0',
    });

    const run = await runAgenticTools(
      [{ id: 'call-private-balance', name: 'get_private_payment_balance', args: {} }],
      {
        ...baseContext,
        userText: 'what is my MagicBlock private-payment balance',
      },
    );

    expect(run.results[0].error).toBeUndefined();
    expect(run.results[0].result).toMatchObject({
      status: 'ok',
      route: 'magicblock',
      routeLabel: 'MagicBlock private-payment balance',
      network: 'devnet',
      symbol: 'USDC',
      publicBalance: '20',
      privateBalance: '0',
      privateBalanceIsZero: true,
    });
    expect(JSON.stringify(run.results[0].result)).not.toContain(walletAddress);
    expect(JSON.stringify(run.results[0].result)).not.toContain(usdcMint);
  });

  it('returns SOL balance as a human-readable amount only', async () => {
    const run = await runAgenticTools(
      [{ id: 'call-2', name: 'get_sol_balance', args: {} }],
      baseContext,
    );

    expect(run.results[0].result).toMatchObject({ status: 'ok', sol: '1.5' });
    expect(JSON.stringify(run.results[0].result)).not.toContain(walletAddress);
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
