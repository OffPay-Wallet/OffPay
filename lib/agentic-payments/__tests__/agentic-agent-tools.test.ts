import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import { runAgenticTools, type AgenticToolRunnerContext } from '@/lib/agentic-payments/agent-tools';

import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

function addressFromSeedByte(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const walletAddress = addressFromSeedByte(1);
const recipient = addressFromSeedByte(2);
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const available = { available: true, reason: 'available', message: 'Available' } as const;

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
    settle: available,
    rpcBroadcast: available,
  },
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
  it('returns a privacy-safe token list without addresses or mints', () => {
    const run = runAgenticTools(
      [{ id: 'call-1', name: 'list_wallet_tokens', args: {} }],
      baseContext,
    );

    expect(run.drafts).toHaveLength(0);
    expect(run.results).toHaveLength(1);
    const result = run.results[0].result as { status: string; tokens: Array<Record<string, unknown>> };
    expect(result.status).toBe('ok');
    expect(JSON.stringify(result)).not.toContain(usdcMint);
    expect(JSON.stringify(result)).not.toContain(walletAddress);
    expect(result.tokens.some((token) => token.symbol === 'USDC')).toBe(true);
  });

  it('returns a status code only when balances are still loading', () => {
    const run = runAgenticTools(
      [{ id: 'call-1', name: 'list_wallet_tokens', args: {} }],
      { ...baseContext, balance: null },
    );

    // Tool result must NOT contain English copy — only structured codes.
    expect(run.results[0].result).toEqual({ status: 'loading' });
  });

  it('returns SOL balance as a human-readable amount only', () => {
    const run = runAgenticTools(
      [{ id: 'call-2', name: 'get_sol_balance', args: {} }],
      baseContext,
    );

    expect(run.results[0].result).toMatchObject({ status: 'ok', sol: '1.5' });
    expect(JSON.stringify(run.results[0].result)).not.toContain(walletAddress);
  });

  it('emits insight ids only — the model writes the prose', () => {
    const run = runAgenticTools(
      [{ id: 'call-3', name: 'analyze_wallet', args: {} }],
      baseContext,
    );

    const result = run.results[0].result as {
      status: string;
      insights: Array<{ id: string; severity: string }>;
    };
    expect(result.status).toBe('ok');
    expect(result.insights.length).toBeGreaterThan(0);
    for (const insight of result.insights) {
      expect(typeof insight.id).toBe('string');
      expect(typeof insight.severity).toBe('string');
      // No prose fields like `title` or `detail` should appear in the
      // tool result. Those would constitute hardcoded copy in the model
      // payload.
      expect(insight).not.toHaveProperty('title');
      expect(insight).not.toHaveProperty('detail');
    }
  });

  it('builds a private-send draft when the model calls draft_private_send with a redacted recipient', () => {
    const run = runAgenticTools(
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

  it('returns a structured rejection code when the validator refuses an unknown token', () => {
    const run = runAgenticTools(
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

  it('reports unknown_tool when the model calls a tool not in the catalog', () => {
    const run = runAgenticTools(
      [{ id: 'call-6', name: 'rm_rf_wallet', args: {} }],
      baseContext,
    );

    expect(run.drafts).toHaveLength(0);
    expect(run.results[0].error?.code).toBe('unknown_tool');
  });

  it('emits a payroll intake intent without exposing payroll data', () => {
    const run = runAgenticTools(
      [{ id: 'call-7', name: 'stage_payroll', args: { source: 'upload' } }],
      baseContext,
    );

    expect(run.payrollIntents).toEqual([{ toolCallId: 'call-7', source: 'upload' }]);
    expect(run.results[0].result).toMatchObject({ status: 'opening_payroll_intake', source: 'upload' });
    expect(run.drafts).toHaveLength(0);
  });

  it('defaults the payroll intake source to paste', () => {
    const run = runAgenticTools(
      [{ id: 'call-8', name: 'stage_payroll', args: {} }],
      baseContext,
    );

    expect(run.payrollIntents[0].source).toBe('paste');
  });
});
