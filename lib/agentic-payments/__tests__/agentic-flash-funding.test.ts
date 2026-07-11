import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  AGENTIC_TOOL_DEFINITIONS,
  AGENTIC_TOOL_SCHEMAS,
  getAvailableAgenticModelToolSchemas,
  runAgenticTools,
} from '@/lib/agentic-payments/agent-tools';
import { flashFundAccountTool } from '@/lib/agentic-payments/tools/flash-trade/fund-account';
import type { AgenticToolRunnerContext } from '@/lib/agentic-payments/tools/types';

function addressFromSeed(byte: number): string {
  return bs58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));
}

const walletAddress = addressFromSeed(1);

function context(): AgenticToolRunnerContext {
  return {
    scope: { walletAddress, network: 'mainnet' },
    walletMode: 'online',
    canUseNetwork: true,
    balance: null,
    capabilities: null,
    knownWallets: [],
    redactions: [],
    userText: 'deposit 10 USDC into Flash',
    offeredToolNames: ['flash_fund_account'],
  };
}

describe('Flash funding lifecycle gate', () => {
  it('does not register, advertise, or offer the funding tool on mainnet', () => {
    expect(AGENTIC_TOOL_DEFINITIONS.map((definition) => definition.name)).not.toContain(
      'flash_fund_account',
    );
    expect(AGENTIC_TOOL_SCHEMAS.map((schema) => schema.name)).not.toContain('flash_fund_account');
    expect(
      getAvailableAgenticModelToolSchemas({
        network: 'mainnet',
        walletAddress,
        walletId: 'wallet-1',
        walletMode: 'online',
        canUseNetwork: true,
        capabilities: null,
      }).map((schema) => schema.name),
    ).not.toContain('flash_fund_account');
  });

  it('fails a stale proxy call closed without creating a draft', async () => {
    const run = await runAgenticTools(
      [{ id: 'stale-flash-fund', name: 'flash_fund_account', args: {} }],
      context(),
    );

    expect(run.results[0]?.error?.code).toBe('unknown_tool');
    expect(run.drafts).toHaveLength(0);
  });

  it('keeps the unregistered compatibility handler fail-closed', async () => {
    await expect(
      flashFundAccountTool.run(
        { id: 'compat-flash-fund', name: 'flash_fund_account', args: {} },
        context(),
      ),
    ).resolves.toEqual({
      error: { code: 'flash_funding_disabled_withdrawal_unavailable' },
    });
  });
});
