import { QueryClient } from '@tanstack/react-query';

import {
  hydrateOffpayWalletDashboard,
  offpayCapabilitiesCacheKey,
  offpayStreamCapabilitiesCacheKey,
} from '@/lib/api/offpay-dashboard-cache';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardQueryKey,
  offpayWalletTransactionsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';

import type { InfiniteData } from '@tanstack/react-query';
import type { WalletDashboardResponse, WalletTransactionsResponse } from '@/types/offpay-api';

const WALLET = '6B6QzKbe3KkECQpPs1sTwAf7RnzoxsX7qk3FeeMTpgGZ';

function capability(available: boolean) {
  return {
    available,
    reason: available ? 'available' : 'temporarily_unavailable',
    message: available ? 'Available.' : 'Temporarily unavailable.',
  } as const;
}

function createDashboard(): WalletDashboardResponse {
  return {
    network: 'devnet',
    address: WALLET,
    capabilities: {
      network: 'devnet',
      capabilities: {
        wallet: {
          balance: capability(true),
          transactions: capability(true),
        },
        stream: {
          walletActivity: capability(true),
        },
        swap: {
          tokens: capability(true),
          price: capability(true),
          normalSwap: capability(true),
          privacySwap: capability(false),
          triggerOrders: capability(false),
          recurringSwap: capability(false),
        },
        payment: {
          privateInitMint: capability(true),
          privateBalance: capability(true),
          privateSend: capability(true),
          settle: capability(true),
          rpcBroadcast: capability(true),
        },
      },
    },
    streamCapabilities: {
      network: 'devnet',
      capabilities: {
        walletActivity: true,
      },
    },
    balance: {
      address: WALLET,
      network: 'devnet',
      solBalance: 1,
      tokens: [],
      fetchedAt: 1_000,
    },
    transactions: {
      address: WALLET,
      network: 'devnet',
      transactions: [],
      cursor: null,
      fetchedAt: 1_100,
    },
    fetchedAt: 1_200,
  };
}

describe('hydrateOffpayWalletDashboard', () => {
  it('hydrates existing wallet query keys from one dashboard response', () => {
    const queryClient = new QueryClient();
    const dashboard = createDashboard();

    hydrateOffpayWalletDashboard({ queryClient, dashboard, limit: 20 });

    expect(queryClient.getQueryData(offpayWalletDashboardQueryKey(WALLET, 'devnet', 20))).toBe(
      dashboard,
    );
    expect(queryClient.getQueryData(offpayCapabilitiesCacheKey('devnet'))).toBe(
      dashboard.capabilities,
    );
    expect(queryClient.getQueryData(offpayStreamCapabilitiesCacheKey('devnet'))).toBe(
      dashboard.streamCapabilities,
    );
    expect(queryClient.getQueryData(offpayWalletBalanceQueryKey(WALLET, 'devnet'))).toBe(
      dashboard.balance,
    );
    expect(
      queryClient.getQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
        offpayWalletTransactionsQueryKey(WALLET, 'devnet', 20),
      ),
    ).toEqual({
      pages: [dashboard.transactions],
      pageParams: [undefined],
    });
  });
});
