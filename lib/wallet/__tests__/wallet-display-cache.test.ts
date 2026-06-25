import { QueryClient } from '@tanstack/react-query';

import {
  applyCachedOfflineCredit,
  applyCachedOfflineDebit,
  hydrateWalletDisplayCacheIntoQueryClient,
  mergeWalletTransactionsWithDisplayCache,
  upsertWalletTransactionIntoCache,
  writeWalletDisplayCacheSlice,
} from '@/lib/wallet/wallet-display-cache';
import {
  offpayWalletBalanceQueryKey,
  pendingBackupQueueStatsQueryKey,
  offpayWalletTransactionsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';

import type { InfiniteData } from '@tanstack/react-query';
import type { WalletBalanceResponse, WalletTransactionsResponse } from '@/types/offpay-api';

const WALLET = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';
const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6C8d9h7T9JbV7cPr';

function makeBalance(tokenCount: number): WalletBalanceResponse {
  return {
    address: WALLET,
    network: 'mainnet',
    solBalance: 1,
    tokens: Array.from({ length: tokenCount }, (_, index) => ({
      mint: MINT,
      name: `Token ${index}`,
      symbol: `T${index}`,
      logo: null,
      balance: String(index),
      decimals: 6,
      verified: true,
      spam: false,
    })),
    fetchedAt: 123,
  };
}

function makeTransactions(count: number): WalletTransactionsResponse {
  return {
    address: WALLET,
    network: 'mainnet',
    transactions: Array.from({ length: count }, (_, index) => ({
      signature: `signature-${index}`,
      timestamp: 123 + index,
      type: 'TRANSFER',
      description: `Transfer ${index}`,
      fee: 5000,
      status: 'success',
      counterparties: [],
    })),
    cursor: null,
    fetchedAt: 456,
  };
}

describe('wallet-display-cache', () => {
  it('hydrates cached wallet display data into React Query without unbounded payloads', async () => {
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      balance: makeBalance(30),
      transactions: makeTransactions(25),
    });

    const queryClient = new QueryClient();
    try {
      await hydrateWalletDisplayCacheIntoQueryClient({
        queryClient,
        walletAddress: WALLET,
        network: 'mainnet',
      });

      const balance = queryClient.getQueryData<WalletBalanceResponse>(
        offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
      );
      const transactions = queryClient.getQueryData<InfiniteData<WalletTransactionsResponse>>(
        offpayWalletTransactionsQueryKey(WALLET, 'mainnet', 20),
      );

      expect(balance?.tokens).toHaveLength(24);
      expect(transactions?.pages[0]?.transactions).toHaveLength(20);
    } finally {
      queryClient.clear();
    }
  });

  it('can hydrate cached history without hydrating cached wallet balance', async () => {
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      balance: makeBalance(2),
      transactions: makeTransactions(3),
    });

    const queryClient = new QueryClient();
    try {
      await hydrateWalletDisplayCacheIntoQueryClient({
        queryClient,
        walletAddress: WALLET,
        network: 'mainnet',
        options: {
          includeBalance: false,
        },
      });

      expect(
        queryClient.getQueryData<WalletBalanceResponse>(
          offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
        ),
      ).toBeUndefined();
      expect(
        queryClient.getQueryData<InfiniteData<WalletTransactionsResponse>>(
          offpayWalletTransactionsQueryKey(WALLET, 'mainnet', 20),
        )?.pages[0]?.transactions,
      ).toHaveLength(3);
    } finally {
      queryClient.clear();
    }
  });

  it('hydrates cached transactions before balance and pending stats', async () => {
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      balance: makeBalance(2),
      transactions: makeTransactions(3),
      pendingBackupStats: {
        total: 1,
        pending: 1,
        uploadPending: 0,
        recovered: 0,
        confirmedAwaitingDelete: 0,
        failed: 0,
      },
    });

    const queryClient = new QueryClient();
    const transactionStatuses: string[] = [];
    try {
      await hydrateWalletDisplayCacheIntoQueryClient({
        queryClient,
        walletAddress: WALLET,
        network: 'mainnet',
        options: {
          measurePrefix: 'test.walletDisplayHydrate',
          onTransactionsHydrated: (status) => {
            transactionStatuses.push(status);
            expect(
              queryClient.getQueryData<InfiniteData<WalletTransactionsResponse>>(
                offpayWalletTransactionsQueryKey(WALLET, 'mainnet', 20),
              )?.pages[0]?.transactions,
            ).toHaveLength(3);
            expect(
              queryClient.getQueryData<WalletBalanceResponse>(
                offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
              ),
            ).toBeUndefined();
            expect(
              queryClient.getQueryData(pendingBackupQueueStatsQueryKey(WALLET, 'mainnet')),
            ).toBeUndefined();
          },
        },
      });

      expect(transactionStatuses).toEqual(['hit']);
      expect(
        queryClient.getQueryData<WalletBalanceResponse>(
          offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
        ),
      ).toBeTruthy();
      expect(queryClient.getQueryData(pendingBackupQueueStatsQueryKey(WALLET, 'mainnet'))).toEqual({
        total: 1,
        pending: 1,
        uploadPending: 0,
        recovered: 0,
        confirmedAwaitingDelete: 0,
        failed: 0,
      });
    } finally {
      queryClient.clear();
    }
  });

  it('merges concurrent cache slice writes for the same wallet and network', async () => {
    await Promise.all([
      writeWalletDisplayCacheSlice({
        walletAddress: WALLET,
        network: 'mainnet',
        balance: makeBalance(1),
      }),
      writeWalletDisplayCacheSlice({
        walletAddress: WALLET,
        network: 'mainnet',
        transactions: makeTransactions(1),
      }),
    ]);

    const queryClient = new QueryClient();
    try {
      await hydrateWalletDisplayCacheIntoQueryClient({
        queryClient,
        walletAddress: WALLET,
        network: 'mainnet',
      });

      expect(
        queryClient.getQueryData<WalletBalanceResponse>(
          offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
        ),
      ).toBeTruthy();
      expect(
        queryClient.getQueryData<InfiniteData<WalletTransactionsResponse>>(
          offpayWalletTransactionsQueryKey(WALLET, 'mainnet', 20),
        )?.pages[0],
      ).toBeTruthy();
    } finally {
      queryClient.clear();
    }
  });

  it('applies an offline token debit to cached wallet balance without a network fetch', async () => {
    const balance: WalletBalanceResponse = {
      ...makeBalance(0),
      tokens: [
        {
          mint: MINT,
          name: 'USD Coin',
          symbol: 'USDC',
          logo: null,
          balance: '3.5',
          decimals: 6,
          verified: true,
          spam: false,
        },
      ],
    };
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      balance,
    });

    const queryClient = new QueryClient();
    try {
      await expect(
        applyCachedOfflineDebit({
          queryClient,
          walletAddress: WALLET,
          network: 'mainnet',
          tokenMint: MINT,
          rawAmount: '1500000',
        }),
      ).resolves.toBe(true);

      expect(
        queryClient.getQueryData<WalletBalanceResponse>(
          offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
        )?.tokens[0]?.balance,
      ).toBe('2');
    } finally {
      queryClient.clear();
    }
  });

  it('applies an offline token credit to cached wallet balance without waiting for refetch', async () => {
    const balance: WalletBalanceResponse = {
      ...makeBalance(0),
      tokens: [
        {
          mint: MINT,
          name: 'USD Coin',
          symbol: 'USDC',
          logo: null,
          balance: '1.25',
          decimals: 6,
          verified: true,
          spam: false,
        },
      ],
    };
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      balance,
    });

    const queryClient = new QueryClient();
    try {
      await expect(
        applyCachedOfflineCredit({
          queryClient,
          walletAddress: WALLET,
          network: 'mainnet',
          tokenMint: MINT,
          rawAmount: '750000',
          tokenSymbol: 'USDC',
          tokenName: 'USD Coin',
          tokenDecimals: 6,
        }),
      ).resolves.toBe(true);

      expect(
        queryClient.getQueryData<WalletBalanceResponse>(
          offpayWalletBalanceQueryKey(WALLET, 'mainnet'),
        )?.tokens[0]?.balance,
      ).toBe('2');
    } finally {
      queryClient.clear();
    }
  });

  it('creates a visible wallet transaction page when a live or optimistic transaction arrives first', async () => {
    const queryClient = new QueryClient();
    try {
      await upsertWalletTransactionIntoCache({
        queryClient,
        walletAddress: WALLET,
        network: 'mainnet',
        transaction: {
          signature: 'sol-send-signature',
          timestamp: 1_713_996_000,
          type: 'TRANSFER',
          description: 'Sent 0.1 SOL to CBbA...okMk',
          tokenMint: 'native-sol',
          tokenSymbol: 'SOL',
          tokenName: 'Solana',
          tokenLogo: 'https://example.com/sol.png',
          fee: 0,
          status: 'success',
          counterparties: [],
        },
      });

      const transactions = queryClient.getQueryData<InfiniteData<WalletTransactionsResponse>>(
        offpayWalletTransactionsQueryKey(WALLET, 'mainnet', 20),
      );

      expect(transactions?.pages[0]?.transactions[0]).toMatchObject({
        signature: 'sol-send-signature',
        tokenSymbol: 'SOL',
        tokenLogo: 'https://example.com/sol.png',
      });
    } finally {
      queryClient.clear();
    }
  });

  it('keeps live p2p token metadata when indexing briefly lags behind', async () => {
    const liveTransaction: WalletTransactionsResponse['transactions'][number] = {
      signature: 'live-p2p-signature',
      timestamp: 1_713_996_100,
      type: 'TRANSFER',
      description: 'Received 0.2 USDC from CBbA...okMk',
      tokenMint: MINT,
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenLogo: 'https://example.com/usdc.png',
      fee: 0,
      status: 'success',
      counterparties: [
        {
          address: 'CBbAfDh79oEhNn2ZouMi97Ek3y1vQYKuH5VbZqx3okMk',
          role: 'sender',
        },
      ],
    };

    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [liveTransaction],
        cursor: null,
        fetchedAt: 1,
      },
    });

    const merged = await mergeWalletTransactionsWithDisplayCache({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            ...liveTransaction,
            timestamp: 1_713_996_101,
            description: null,
            tokenMint: null,
            tokenSymbol: null,
            tokenName: null,
            tokenLogo: null,
            counterparties: [],
          },
          {
            ...makeTransactions(1).transactions[0]!,
            timestamp: 1_713_996_000,
          },
        ],
        cursor: null,
        fetchedAt: 2,
      },
    });

    expect(merged.transactions[0]).toMatchObject({
      signature: 'live-p2p-signature',
      timestamp: 1_713_996_101,
      description: 'Received 0.2 USDC from CBbA...okMk',
      tokenMint: MINT,
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
      counterparties: [],
    });
    expect(merged.transactions.map((transaction) => transaction.signature)).toEqual([
      'live-p2p-signature',
      'signature-0',
    ]);
  });

  it('replaces cached Tx placeholders when fresh history has token metadata', async () => {
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            signature: 'stale-placeholder-signature',
            timestamp: 1_713_996_100,
            type: 'TRANSFER',
            description: 'Tx 5rBS...zbP5',
            fee: 0,
            status: 'success',
            counterparties: [],
          },
        ],
        cursor: null,
        fetchedAt: 1,
      },
    });

    const merged = await mergeWalletTransactionsWithDisplayCache({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            signature: 'stale-placeholder-signature',
            timestamp: 1_713_996_101,
            type: 'TRANSFER',
            description: null,
            amount: '0.004844',
            rawAmount: '4844000',
            tokenMint: 'So11111111111111111111111111111111111111112',
            tokenSymbol: 'SOL',
            tokenName: 'Solana',
            tokenLogo: 'https://example.com/sol.png',
            tokenDecimals: 9,
            direction: 'send',
            fee: 5000,
            status: 'success',
            counterparties: [],
          },
        ],
        cursor: null,
        fetchedAt: 2,
      },
    });

    expect(merged.transactions[0]).toMatchObject({
      signature: 'stale-placeholder-signature',
      description: null,
      amount: '0.004844',
      rawAmount: '4844000',
      tokenSymbol: 'SOL',
      tokenLogo: 'https://example.com/sol.png',
      tokenDecimals: 9,
      direction: 'send',
    });
  });

  it('keeps cached token metadata when an aborted refresh returns an unknown row', async () => {
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            signature: 'known-signature',
            timestamp: 1_713_996_100,
            type: 'TRANSFER',
            description: null,
            amount: '1',
            rawAmount: '1000000',
            tokenMint: MINT,
            tokenSymbol: 'USDC',
            tokenName: 'USD Coin',
            tokenLogo: 'https://example.com/usdc.png',
            tokenDecimals: 6,
            direction: 'receive',
            fee: 0,
            status: 'success',
            counterparties: [],
          },
        ],
        cursor: null,
        fetchedAt: 1,
      },
    });

    const merged = await mergeWalletTransactionsWithDisplayCache({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            signature: 'known-signature',
            timestamp: 1_713_996_101,
            type: 'unknown',
            description: null,
            fee: 0,
            status: 'success',
            counterparties: [],
          },
        ],
        cursor: null,
        fetchedAt: 2,
      },
    });

    expect(merged.transactions[0]).toMatchObject({
      signature: 'known-signature',
      type: 'TRANSFER',
      amount: '1',
      rawAmount: '1000000',
      tokenSymbol: 'USDC',
      tokenLogo: 'https://example.com/usdc.png',
      direction: 'receive',
    });
  });

  it('does not carry cached-only transaction rows into fresh indexed history', async () => {
    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            signature: 'stale-local-signature',
            timestamp: 1_713_996_050,
            type: 'TRANSFER',
            description: 'Sent 1 USDC to cached wallet',
            tokenMint: MINT,
            tokenSymbol: 'USDC',
            tokenName: 'USD Coin',
            tokenLogo: 'https://example.com/usdc.png',
            fee: 0,
            status: 'success',
            counterparties: [],
          },
        ],
        cursor: null,
        fetchedAt: 1,
      },
    });

    const merged = await mergeWalletTransactionsWithDisplayCache({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: makeTransactions(1),
    });

    expect(merged.transactions.map((transaction) => transaction.signature)).toEqual([
      'signature-0',
    ]);
  });

  it('keeps optimistic swap metadata when the indexer reports the output transfer first', async () => {
    const swapTransaction: WalletTransactionsResponse['transactions'][number] = {
      signature: 'swap-signature',
      timestamp: 1_713_996_200,
      type: 'SWAP',
      description: 'Swapped 0.002688 SOL to 0.238527 USDC via JupiterZ',
      tokenMint: MINT,
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      tokenLogo: 'https://example.com/usdc.png',
      fee: 0,
      status: 'success',
      counterparties: [{ address: 'JupiterZ', role: 'route' }],
    };

    await writeWalletDisplayCacheSlice({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [swapTransaction],
        cursor: null,
        fetchedAt: 1,
      },
    });

    const merged = await mergeWalletTransactionsWithDisplayCache({
      walletAddress: WALLET,
      network: 'mainnet',
      transactions: {
        address: WALLET,
        network: 'mainnet',
        transactions: [
          {
            ...swapTransaction,
            type: 'TRANSFER',
            description: 'Received 0.238527 USDC from Bukt...7Ug5',
            counterparties: [{ address: 'Bukt7Ug5', role: 'sender' }],
          },
        ],
        cursor: null,
        fetchedAt: 2,
      },
    });

    expect(merged.transactions[0]).toMatchObject({
      signature: 'swap-signature',
      type: 'SWAP',
      description: 'Swapped 0.002688 SOL to 0.238527 USDC via JupiterZ',
    });
  });
});
