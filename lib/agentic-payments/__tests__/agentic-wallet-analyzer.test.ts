import { analyzeAgenticWallet } from '@/lib/agentic-payments/wallet-analyzer';

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
};

const balance: WalletBalanceResponse = {
  address: 'wallet-address',
  network: 'devnet',
  solBalance: 5_000_000,
  fetchedAt: 1,
  tokens: [
    {
      mint: 'UnknownMint111111111111111111111111111111111',
      symbol: 'UnknownMint111111111111111111111111111111111',
      name: 'UnknownMint111111111111111111111111111111111',
      balance: '1',
      decimals: 6,
      logo: null,
      verified: false,
      spam: false,
    },
  ],
};

describe('analyzeAgenticWallet', () => {
  it('produces deterministic local wallet tips and safe labels', () => {
    const result = analyzeAgenticWallet({
      walletAddress: balance.address,
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result.aiSafeLabels).toEqual(
      expect.arrayContaining(['gas_low', 'private_send_ready', 'unknown_tokens_present']),
    );
    expect(result.summaryText).toContain('Low SOL for fees');
    expect(result.summaryText).toContain('Private send ready');
  });

  it('fails locally when no wallet is connected', () => {
    const result = analyzeAgenticWallet({
      walletAddress: null,
      walletMode: 'online',
      canUseNetwork: true,
      balance,
      capabilities,
    });

    expect(result.aiSafeLabels).toEqual(['wallet_not_connected']);
  });
});
