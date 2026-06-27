import {
  getAvailableAgenticChatCtaIds,
  getAvailableAgenticModelToolSchemas,
} from '@/lib/agentic-payments/agent-tools';

import type { AgentTurnRequest } from '@/lib/agentic-payments/types';
import type { CapabilitiesResponse, CapabilityStatus } from '@/types/offpay-api';

const available: CapabilityStatus = {
  available: true,
  reason: 'available',
  message: 'Available',
};

const unsupportedNetwork: CapabilityStatus = {
  available: false,
  reason: 'unsupported_network',
  message: 'Unsupported on this network',
};
const workerMaxChatBytes = 65_536;

function buildCapabilities(
  network: CapabilitiesResponse['network'],
): CapabilitiesResponse['capabilities'] {
  const swapExecution = network === 'mainnet' ? available : unsupportedNetwork;
  return {
    wallet: { balance: available, transactions: available },
    stream: { walletActivity: available },
    swap: {
      tokens: available,
      price: available,
      normalSwap: swapExecution,
      privacySwap: swapExecution,
      triggerOrders: swapExecution,
      recurringSwap: swapExecution,
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
}

describe('agentic tool availability', () => {
  const walletAddress = '11111111111111111111111111111111';
  const walletId = 'wallet-1';

  it('keeps devnet chat cards limited to devnet-capable actions', () => {
    const ctaIds = getAvailableAgenticChatCtaIds({
      network: 'devnet',
      walletAddress,
      walletId,
      walletMode: 'online',
      canUseNetwork: true,
      canUseUmbraWallet: true,
      capabilities: buildCapabilities('devnet'),
    });

    expect(ctaIds).toEqual([
      'balance',
      'activity',
      'send',
      'private-send',
      'payroll',
      'private-balance',
      'umbra-vault',
      'umbra-claims',
    ]);
  });

  it('keeps mainnet chat cards aligned with mainnet tools', () => {
    const ctaIds = getAvailableAgenticChatCtaIds({
      network: 'mainnet',
      walletAddress,
      walletId,
      walletMode: 'online',
      canUseNetwork: true,
      canUseUmbraWallet: true,
      capabilities: buildCapabilities('mainnet'),
    });

    expect(ctaIds).toEqual([
      'balance',
      'activity',
      'send',
      'private-send',
      'swap',
      'payroll',
      'private-balance',
      'umbra-vault',
      'umbra-claims',
      'flash',
    ]);
  });

  it('removes devnet swap and Flash schemas from model tool calls', () => {
    const toolNames = getAvailableAgenticModelToolSchemas({
      network: 'devnet',
      walletAddress,
      walletId,
      walletMode: 'online',
      canUseNetwork: true,
      canUseUmbraWallet: true,
      capabilities: buildCapabilities('devnet'),
    }).map((schema) => schema.name);

    expect(toolNames).toContain('get_wallet_balance');
    expect(toolNames).toContain('get_wallet_history');
    expect(toolNames).toContain('draft_normal_send');
    expect(toolNames).toContain('draft_private_send');
    expect(toolNames).toContain('stage_payroll');
    expect(toolNames).toContain('get_umbra_balances');
    expect(toolNames).toContain('scan_umbra_claims');
    expect(toolNames).not.toContain('prepare_swap_quote');
    expect(toolNames).not.toContain('flash_get_positions');
    expect(toolNames).not.toContain('flash_open_position');
  });

  it.each(['devnet', 'mainnet'] as const)(
    'keeps %s agent-turn body inside the AI proxy request limit',
    (network) => {
      const toolSchemas = getAvailableAgenticModelToolSchemas({
        network,
        walletAddress,
        walletId,
        walletMode: 'online',
        canUseNetwork: true,
        canUseUmbraWallet: true,
        capabilities: buildCapabilities(network),
      });
      const request: AgentTurnRequest = {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Show my Umbra vault balance' }],
        toolSchemas,
        context: {
          network,
          walletMode: 'online',
          capabilities: {
            networkAvailable: true,
            walletBalance: true,
            normalSend: true,
            privateSend: true,
            swap: network === 'mainnet',
            umbra: true,
            umbraVaultBalance: true,
            privateBalance: true,
            magicblockPrivateBalance: true,
            flashTrade: network === 'mainnet',
          },
          tokenSymbols: ['SOL', 'USDC'],
        },
        stream: false,
      };

      const bodyBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;

      expect(toolSchemas.length).toBeLessThanOrEqual(40);
      expect(bodyBytes).toBeLessThanOrEqual(workerMaxChatBytes);
    },
  );
});
