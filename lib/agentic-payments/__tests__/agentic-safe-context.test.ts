import {
  buildAgentSafeContext,
  buildAgentWalletBalanceResponse,
} from '@/lib/agentic-payments/safe-context';

import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

const available = {
  available: true,
  reason: 'available',
  message: 'Available',
} as const;

const capabilities: CapabilitiesResponse['capabilities'] = {
  wallet: {
    balance: available,
    transactions: available,
  },
  stream: {
    walletActivity: available,
  },
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
  offline: {
    supportedStablecoins: [
      {
        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        enabled: true,
      },
    ],
  },
};

const baseBalance: WalletBalanceResponse = {
  address: 'wallet-address',
  network: 'devnet',
  solBalance: 2_923_910_063,
  nativeSolUsdPrice: 170.5,
  fetchedAt: 1_713_996_000_000,
  tokens: [
    {
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      name: 'Devnet USDC',
      symbol: 'USDC',
      logo: 'https://example.test/usdc.png',
      balance: '20',
      decimals: 6,
      usdPrice: 1,
      verified: true,
      spam: false,
    },
  ],
};

describe('buildAgentSafeContext (privacy-narrowed)', () => {
  it('emits only the allow-listed surface (network, walletMode, capabilities, supportedActions, tokenSymbols)', () => {
    const context = buildAgentSafeContext({
      walletAddress: baseBalance.address,
      accountName: 'Account 1',
      wallets: [],
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance: baseBalance,
      capabilities,
    });

    expect(Object.keys(context).sort()).toEqual(
      ['capabilities', 'network', 'supportedActions', 'tokenSymbols', 'walletMode'].sort(),
    );

    expect(context.network).toBe('devnet');
    expect(context.walletMode).toBe('online');
    expect(context.capabilities).toEqual({
      networkAvailable: true,
      walletBalance: true,
      normalSend: true,
      privateSend: true,
    });
    expect(context.supportedActions).toEqual(['draft_normal_send', 'draft_private_send', 'stage_payroll']);
    expect(context.tokenSymbols).toEqual(['SOL', 'USDC']);
  });

  it('never serializes wallet addresses, balances, mints, or wallet names into the AI context', () => {
    const context = buildAgentSafeContext({
      walletAddress: baseBalance.address,
      accountName: 'My Trading Wallet',
      wallets: [
        {
          name: 'Trading',
          publicKey: baseBalance.address,
          activeWalletId: null,
        } as unknown as Parameters<typeof buildAgentSafeContext>[0]['wallets'][number],
      ],
      network: 'devnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance: baseBalance,
      capabilities,
    });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(baseBalance.address);
    expect(serialized).not.toContain(baseBalance.tokens[0].mint);
    expect(serialized).not.toContain(baseBalance.tokens[0].balance);
    expect(serialized).not.toContain('My Trading Wallet');
    expect(context).not.toHaveProperty('walletAddress');
    expect(context).not.toHaveProperty('walletBalanceApiResponse');
    expect(context).not.toHaveProperty('balances');
    expect(context).not.toHaveProperty('wallets');
    expect(context).not.toHaveProperty('accountName');
  });

  it('caps tokenSymbols to a sane size and skips placeholder rows where symbol equals mint', () => {
    const tokens: WalletBalanceResponse['tokens'] = [];
    for (let index = 0; index < 40; index += 1) {
      const mint = `mint${index.toString().padStart(40, '0')}`;
      tokens.push({
        mint,
        // First two rows have a real ticker; the rest fall back to mint
        // and must be filtered out so the model never sees a placeholder
        // symbol that looks like a contract address.
        name: index < 2 ? `Token ${index}` : mint,
        symbol: index < 2 ? `TKN${index}` : mint,
        logo: null,
        balance: '1',
        decimals: 6,
        verified: true,
        spam: false,
      });
    }

    const context = buildAgentSafeContext({
      walletAddress: baseBalance.address,
      accountName: null,
      wallets: [],
      network: 'mainnet',
      walletMode: 'online',
      canUseNetwork: true,
      balance: { ...baseBalance, tokens },
      capabilities,
    });

    expect(context.tokenSymbols).toEqual(['SOL', 'TKN0', 'TKN1']);
  });
});

describe('buildAgentWalletBalanceResponse (local-only enrichment)', () => {
  it('rewrites placeholder rows with Umbra metadata for local validators', () => {
    const balance: WalletBalanceResponse = {
      ...baseBalance,
      tokens: [
        {
          mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          name: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          symbol: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          logo: null,
          balance: '499.970126',
          decimals: 6,
          verified: false,
          spam: false,
        },
      ],
    };

    const agentBalance = buildAgentWalletBalanceResponse(balance, capabilities);

    expect(agentBalance.tokens[0]).toMatchObject({
      symbol: 'dUSDC',
      name: 'Devnet USDC (Umbra test)',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
    });
  });
});
