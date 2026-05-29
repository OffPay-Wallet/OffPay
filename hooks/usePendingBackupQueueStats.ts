import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { pendingBackupQueueStatsQueryKey } from '@/lib/api/offpay-wallet-query-keys';
import { getPendingBackupQueueStats } from '@/lib/payments/pending-backup-queue';
import { writeWalletDisplayCacheSlice } from '@/lib/wallet/wallet-display-cache';
import { useOffpayNetworkTransitionStore } from '@/store/offpayNetworkTransitionStore';
import { useWalletStore } from '@/store/walletStore';

const PENDING_BACKUP_STATS_STALE_TIME_MS = 1000 * 60;

export function usePendingBackupQueueStats(options?: {
  walletAddress?: string | null;
  enabled?: boolean;
}) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = options?.walletAddress ?? activeWalletAddress;
  const { network } = useOffpayNetwork();
  const networkAccessSuspended = useOffpayNetworkTransitionStore((s) => s.networkAccessSuspended);
  const enabled =
    (options?.enabled ?? true) &&
    walletAddress != null &&
    network != null &&
    !networkAccessSuspended;

  const query = useQuery({
    queryKey: pendingBackupQueueStatsQueryKey(walletAddress, network),
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error(
          'Pending backup queue stats require an active wallet and supported network.',
        );
      }

      return getPendingBackupQueueStats({ walletAddress, network });
    },
    enabled,
    staleTime: PENDING_BACKUP_STATS_STALE_TIME_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (query.data == null || walletAddress == null || network == null) return;
    void writeWalletDisplayCacheSlice({
      walletAddress,
      network,
      pendingBackupStats: query.data,
    }).catch(() => undefined);
  }, [network, query.data, walletAddress]);

  return query;
}
