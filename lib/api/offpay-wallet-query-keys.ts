import type { OffpayNetwork } from '@/types/offpay-api';

export const WALLET_TRANSACTIONS_PAGE_SIZE = 20;
export const WALLET_DEEP_HISTORY_PAGE_SIZE = 100;

export type WalletTransactionsCacheMode = 'cached' | 'network' | 'server-cache';

export const offpayWalletDashboardBaseQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'walletDashboard', network, walletAddress] as const;

export const offpayWalletDashboardQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  limit: number = WALLET_TRANSACTIONS_PAGE_SIZE,
  includeTransactions: boolean = true,
) =>
  [
    ...offpayWalletDashboardBaseQueryKey(walletAddress, network),
    { limit, includeTransactions },
  ] as const;

export const offpayWalletBalanceQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'walletBalance', network, walletAddress] as const;

export const offpayWalletTransactionsBaseQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'walletTransactions', network, walletAddress] as const;

export const offpayWalletTransactionsQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  limit: number,
  cacheMode: WalletTransactionsCacheMode = 'cached',
) =>
  [...offpayWalletTransactionsBaseQueryKey(walletAddress, network), { limit, cacheMode }] as const;

export const offpayWalletTokenTransactionsBaseQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'walletTokenTransactions', network, walletAddress] as const;

export const offpayWalletTokenTransactionsQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  mint: string | null,
  limit: number,
  cacheMode: WalletTransactionsCacheMode = 'cached',
) =>
  [
    ...offpayWalletTokenTransactionsBaseQueryKey(walletAddress, network),
    mint,
    { limit, cacheMode },
  ] as const;

export const pendingBackupQueueStatsQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'pendingBackupQueueStats', network, walletAddress] as const;
