import type { OffpayNetwork } from '@/types/offpay-api';

export const WALLET_TRANSACTIONS_PAGE_SIZE = 20;

export const offpayWalletDashboardBaseQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'walletDashboard', network, walletAddress] as const;

export const offpayWalletDashboardQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  limit: number = WALLET_TRANSACTIONS_PAGE_SIZE,
) => [...offpayWalletDashboardBaseQueryKey(walletAddress, network), { limit }] as const;

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
) => [...offpayWalletTransactionsBaseQueryKey(walletAddress, network), { limit }] as const;

export const pendingBackupQueueStatsQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
) => ['offpay', 'pendingBackupQueueStats', network, walletAddress] as const;
