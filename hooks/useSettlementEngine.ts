import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { offlineNonceStateQueryKey } from '@/hooks/useOfflineNonceState';
import {
  offlinePaymentSlotsQueryKey,
  setOfflinePaymentSlotsQueryData,
} from '@/hooks/useOfflinePaymentSlots';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import {
  offpayWalletDashboardBaseQueryKey,
  offpayWalletBalanceQueryKey,
  offpayWalletTokenTransactionsBaseQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  pendingBackupQueueStatsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import {
  markOfflineNonceSettledForTx,
  markOfflineNonceSettlementFailedForTx,
  markOfflineNonceSettlingForTx,
} from '@/lib/offline/offline-payments';
import { loadOfflinePaymentSlotSnapshot } from '@/lib/offline/offline-payment-slots';
import {
  cleanupConfirmedPendingBackups,
  getPendingBackupQueueStats,
  listLocalPendingBackups,
  settleQueuedPendingPayments,
  syncPendingBackupUploads,
} from '@/lib/payments/pending-backup-queue';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  applyCachedOfflineCredit,
  upsertWalletTransactionIntoCache,
} from '@/lib/wallet/wallet-display-cache';
import { useNotificationStore } from '@/store/notificationStore';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import {
  useSettlementEngineStore,
  type SettlementEngineTrigger,
} from '@/store/settlementEngineStore';
import { useWalletStore } from '@/store/walletStore';

import type { QueryClient } from '@tanstack/react-query';
import type { OfflinePaymentReceipt } from '@/store/offlinePaymentStore';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
const FOREGROUND_SETTLEMENT_DELAY_MS = 2_000;

function canBypassSettlementBackoff(trigger: SettlementEngineTrigger): boolean {
  return trigger === 'manual' || trigger === 'retry';
}

function getActiveSettlementBackoffDelayMs(trigger: SettlementEngineTrigger): number {
  if (canBypassSettlementBackoff(trigger)) return 0;

  const { status, nextRetryAt } = useSettlementEngineStore.getState();
  if (status !== 'backoff' || nextRetryAt == null) return 0;

  return Math.max(nextRetryAt - Date.now(), 0);
}

interface SettlementEngineContext {
  walletAddress: string | null;
  walletId: string | null;
  network: ReturnType<typeof useOffpayNetwork>['network'];
  enabled: boolean;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Settlement engine failed.';
}

function notifyOfflineSettlement(params: {
  id: string;
  title: string;
  message: string;
  variant: 'success' | 'error' | 'warning' | 'info';
}): void {
  useNotificationStore.getState().addNotification(params);
}

function stripSignedAmountLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[+-]/, '');
}

function buildReceiptCounterpartySubtitle(receipt: OfflinePaymentReceipt): string | null {
  const direction = receipt.direction === 'receive' ? 'receive' : 'send';
  const address = direction === 'receive' ? receipt.sender : receipt.recipient;
  const trimmed = address?.trim();
  if (!trimmed) return null;

  return `${direction === 'receive' ? 'From' : 'To'} ${shortenWalletAddress(trimmed)}`;
}

function buildOfflineReceiptTransaction(params: {
  receipt: OfflinePaymentReceipt;
  signature: string;
}) {
  const amountLabel = stripSignedAmountLabel(params.receipt.amountLabel);
  const direction = params.receipt.direction === 'receive' ? 'receive' : 'send';
  const counterparty = direction === 'receive' ? params.receipt.sender : params.receipt.recipient;

  return {
    signature: params.signature,
    timestamp: Math.floor(params.receipt.createdAt / 1000),
    type: 'TRANSFER',
    description:
      amountLabel == null
        ? direction === 'receive'
          ? 'Received offline payment'
          : 'Sent offline payment'
        : `${direction === 'receive' ? 'Received' : 'Sent'} ${amountLabel}`,
    tokenMint: params.receipt.tokenMint ?? null,
    tokenSymbol: params.receipt.tokenSymbol ?? null,
    tokenName: params.receipt.tokenName ?? params.receipt.tokenSymbol ?? null,
    tokenLogo: params.receipt.tokenLogo ?? null,
    fee: 0,
    status: 'success' as const,
    counterparties:
      counterparty == null
        ? []
        : [
            {
              address: counterparty,
              role: direction === 'receive' ? 'sender' : 'recipient',
            },
          ],
  };
}

async function applySettledOfflineReceiptCache(params: {
  queryClient: QueryClient;
  walletAddress: string;
  network: NonNullable<SettlementEngineContext['network']>;
  signature: string;
  sendReceipt?: OfflinePaymentReceipt;
  receiveReceipt?: OfflinePaymentReceipt;
}): Promise<void> {
  const primaryReceipt = params.sendReceipt ?? params.receiveReceipt;
  if (primaryReceipt == null) return;

  await upsertWalletTransactionIntoCache({
    queryClient: params.queryClient,
    walletAddress: params.walletAddress,
    network: params.network,
    transaction: buildOfflineReceiptTransaction({
      receipt: primaryReceipt,
      signature: params.signature,
    }),
  });

  if (
    params.receiveReceipt == null ||
    params.sendReceipt != null ||
    params.receiveReceipt.rawAmount == null ||
    params.receiveReceipt.tokenMint == null
  ) {
    return;
  }

  await applyCachedOfflineCredit({
    queryClient: params.queryClient,
    walletAddress: params.walletAddress,
    network: params.network,
    tokenMint: params.receiveReceipt.tokenMint,
    rawAmount: params.receiveReceipt.rawAmount,
    tokenSymbol: params.receiveReceipt.tokenSymbol,
    tokenName: params.receiveReceipt.tokenName,
    tokenLogo: params.receiveReceipt.tokenLogo,
    tokenDecimals: params.receiveReceipt.tokenDecimals,
  });
}

async function refreshOfflinePaymentSlotsCache(params: {
  queryClient: QueryClient;
  walletAddress: string;
  network: NonNullable<SettlementEngineContext['network']>;
}): Promise<void> {
  const snapshot = await loadOfflinePaymentSlotSnapshot({
    walletAddress: params.walletAddress,
    network: params.network,
  }).catch(() => null);
  if (snapshot == null) return;

  setOfflinePaymentSlotsQueryData(params.queryClient, snapshot);
}

function settleOfflineReceipts(params: {
  network: NonNullable<SettlementEngineContext['network']>;
  txId: string;
  signature: string;
}): { sendReceipt?: OfflinePaymentReceipt; receiveReceipt?: OfflinePaymentReceipt } {
  const receipts = useOfflinePaymentStore
    .getState()
    .receipts.filter((item) => item.txId === params.txId || item.id === params.txId);
  const receiptByDirection = {
    send: receipts.find((receipt) => receipt.direction !== 'receive'),
    receive: receipts.find((receipt) => receipt.direction === 'receive'),
  };

  useOfflinePaymentStore.getState().updateReceipts(params.txId, (receipt) => ({
    status: 'settled',
    title: receipt.direction === 'receive' ? 'Payment received' : 'Payment settled',
    subtitle:
      buildReceiptCounterpartySubtitle(receipt) ??
      `Tx ${shortenWalletAddress(params.signature, 4)}`,
    signature: params.signature,
    errorMessage: null,
  }));

  if (receiptByDirection.send != null) {
    notifyOfflineSettlement({
      id: `offline-settled-${params.network}-${params.txId}`,
      title: 'Payment settled',
      message:
        receiptByDirection.send.amountLabel != null
          ? `${receiptByDirection.send.amountLabel} settled on-chain.`
          : `On-chain signature ${shortenWalletAddress(params.signature, 4)}.`,
      variant: 'success',
    });
  }

  if (receiptByDirection.receive != null) {
    notifyOfflineSettlement({
      id: `offline-received-settled-${params.network}-${params.txId}`,
      title: 'Payment received',
      message:
        receiptByDirection.receive.amountLabel != null
          ? `${receiptByDirection.receive.amountLabel} settled on-chain.`
          : `On-chain signature ${shortenWalletAddress(params.signature, 4)}.`,
      variant: 'success',
    });
  }

  if (receiptByDirection.send == null && receiptByDirection.receive == null) {
    notifyOfflineSettlement({
      id: `offline-settled-${params.network}-${params.txId}`,
      title: 'Payment settled',
      message: `On-chain signature ${shortenWalletAddress(params.signature, 4)}.`,
      variant: 'success',
    });
  }

  return {
    sendReceipt: receiptByDirection.send,
    receiveReceipt: receiptByDirection.receive,
  };
}

export function useSettlementEngine() {
  const queryClient = useQueryClient();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const requestedRunId = useSettlementEngineStore((state) => state.requestedRunId);
  const capabilitiesQuery = useOffpayCapabilities();
  const canSettle = isOffpayFeatureAvailable(capabilitiesQuery.capabilities, 'payment.settle');
  const contextRef = useRef<SettlementEngineContext>({
    walletAddress,
    walletId,
    network,
    enabled: canUseNetwork && canSettle,
  });
  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foregroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const backoffMsRef = useRef(INITIAL_BACKOFF_MS);

  useEffect(() => {
    contextRef.current = {
      walletAddress,
      walletId,
      network,
      enabled: canUseNetwork && canSettle,
    };
  }, [canSettle, canUseNetwork, network, walletAddress, walletId]);

  useEffect(() => {
    if (contextRef.current.enabled) return;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    useSettlementEngineStore.getState().setIdle();
  }, [canUseNetwork, canSettle]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (timerRef.current != null) clearTimeout(timerRef.current);
      if (foregroundTimerRef.current != null) clearTimeout(foregroundTimerRef.current);
    },
    [],
  );

  const invalidateSettlementQueries = useCallback(
    async (wallet: string, activeNetwork: NonNullable<SettlementEngineContext['network']>) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: pendingBackupQueueStatsQueryKey(wallet, activeNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletDashboardBaseQueryKey(wallet, activeNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletBalanceQueryKey(wallet, activeNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTransactionsBaseQueryKey(wallet, activeNetwork),
          refetchType: 'active',
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTokenTransactionsBaseQueryKey(wallet, activeNetwork),
          refetchType: 'active',
        }),
        queryClient.invalidateQueries({
          queryKey: offlineNonceStateQueryKey(wallet, activeNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offlinePaymentSlotsQueryKey(wallet, activeNetwork),
          refetchType: 'none',
        }),
      ]);
    },
    [queryClient],
  );

  const runSettlement = useCallback(
    async (trigger: SettlementEngineTrigger) => {
      const context = contextRef.current;
      if (
        !context.enabled ||
        context.walletAddress == null ||
        context.walletId == null ||
        context.network == null ||
        runningRef.current
      ) {
        return;
      }

      if (getActiveSettlementBackoffDelayMs(trigger) > 0) {
        return;
      }

      const walletAddress = context.walletAddress;
      const walletId = context.walletId;
      const network = context.network;

      runningRef.current = true;
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      try {
        const beforeStats = await getPendingBackupQueueStats({
          walletAddress,
          network,
        });

        if (beforeStats.total === 0) {
          useSettlementEngineStore.getState().setIdle({ queuedCount: beforeStats.total });
          backoffMsRef.current = INITIAL_BACKOFF_MS;
          return;
        }

        const queuedCount = beforeStats.pending + beforeStats.failed;
        useSettlementEngineStore.getState().setRunning(trigger, queuedCount);

        const uploadSync = await syncPendingBackupUploads({
          walletAddress,
          network,
        });
        const settlement = await settleQueuedPendingPayments({
          walletAddress,
          walletId,
          network,
          onOfflinePaymentSettling: async (txId) => {
            await markOfflineNonceSettlingForTx({
              walletAddress,
              network,
              txId,
            });
            await refreshOfflinePaymentSlotsCache({
              queryClient,
              walletAddress,
              network,
            });
            useOfflinePaymentStore.getState().updateReceipt(txId, {
              status: 'settling',
              title: 'Payment settling',
              subtitle: 'Finalizing on-chain',
            });
          },
          onOfflinePaymentConfirmed: async (txId, signature) => {
            await markOfflineNonceSettledForTx({
              walletAddress,
              network,
              txId,
            });
            await refreshOfflinePaymentSlotsCache({
              queryClient,
              walletAddress,
              network,
            });
            const settledReceipts = settleOfflineReceipts({ network, txId, signature });
            await applySettledOfflineReceiptCache({
              queryClient,
              walletAddress,
              network,
              signature,
              ...settledReceipts,
            });
          },
          onOfflinePaymentFailed: async (txId, errorMessage) => {
            await markOfflineNonceSettlementFailedForTx({
              walletAddress,
              network,
              txId,
              errorMessage,
            });
            await refreshOfflinePaymentSlotsCache({
              queryClient,
              walletAddress,
              network,
            });
            useOfflinePaymentStore.getState().updateReceipt(txId, {
              status: 'failed',
              title: 'Payment needs retry',
              subtitle: 'Settlement will retry',
              errorMessage,
            });
            notifyOfflineSettlement({
              id: `offline-settlement-failed-${network}-${txId}`,
              title: 'Settlement delayed',
              message: errorMessage,
              variant: 'warning',
            });
          },
        });
        const confirmedAwaitingCleanup = await listLocalPendingBackups({
          walletAddress,
          network,
        });
        for (const item of confirmedAwaitingCleanup) {
          if (item.settlementStatus !== 'confirmed' || item.settlementSignature == null) {
            continue;
          }

          settleOfflineReceipts({
            network,
            txId: item.txId,
            signature: item.settlementSignature,
          });
        }
        const cleanup = await cleanupConfirmedPendingBackups({
          walletAddress,
          network,
        });

        const stats = {
          queuedCount,
          uploadedCount: uploadSync.uploadedCount,
          uploadFailedCount: uploadSync.failedCount,
          submittedCount: settlement.submittedCount,
          confirmedCount: settlement.confirmedCount + cleanup.deletedCount,
          failedCount: settlement.failedCount,
          deleteFailedCount: settlement.deleteFailedCount + cleanup.failedCount,
        };

        useSettlementEngineStore.getState().setResult(stats);
        await invalidateSettlementQueries(walletAddress, network);

        if (
          uploadSync.failedCount > 0 ||
          settlement.failedCount > 0 ||
          settlement.deleteFailedCount > 0 ||
          cleanup.failedCount > 0
        ) {
          const retryMessage =
            settlement.failedCount > 0 || uploadSync.failedCount > 0
              ? 'Some queued payments need another settlement attempt.'
              : 'Settled payment cleanup will retry.';
          const nextRetryAt = Date.now() + backoffMsRef.current;
          useSettlementEngineStore.getState().setBackoff({
            trigger,
            error: retryMessage,
            nextRetryAt,
            stats,
          });
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            backoffMsRef.current = Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
            void runSettlement('retry');
          }, backoffMsRef.current);
        } else {
          backoffMsRef.current = INITIAL_BACKOFF_MS;
        }
      } catch (error) {
        const nextRetryAt = Date.now() + backoffMsRef.current;
        useSettlementEngineStore.getState().setBackoff({
          trigger,
          error: getErrorMessage(error),
          nextRetryAt,
        });
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          backoffMsRef.current = Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
          void runSettlement('retry');
        }, backoffMsRef.current);
      } finally {
        runningRef.current = false;
      }
    },
    [invalidateSettlementQueries],
  );

  useEffect(() => {
    if (!canUseNetwork || !canSettle) return;
    const scheduled = scheduleUiWorkAfterFirstPaint(
      () => {
        void runSettlement('launch');
      },
      {
        timeoutMs: 5000,
        fallbackDelayMs: 1200,
      },
    );

    return () => {
      scheduled.cancel();
    };
  }, [canSettle, canUseNetwork, runSettlement]);

  useEffect(() => {
    if (requestedRunId === 0) return;
    if (!canUseNetwork || !canSettle) return;
    void runSettlement('queue');
  }, [canSettle, canUseNetwork, requestedRunId, runSettlement]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (online) void runSettlement('network');
    });

    return unsubscribe;
  }, [runSettlement]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (foregroundTimerRef.current != null) clearTimeout(foregroundTimerRef.current);
        foregroundTimerRef.current = setTimeout(() => {
          foregroundTimerRef.current = null;
          void runSettlement('foreground');
        }, FOREGROUND_SETTLEMENT_DELAY_MS);
      } else if (foregroundTimerRef.current != null) {
        clearTimeout(foregroundTimerRef.current);
        foregroundTimerRef.current = null;
      }
    });

    return () => {
      subscription.remove();
      if (foregroundTimerRef.current != null) {
        clearTimeout(foregroundTimerRef.current);
        foregroundTimerRef.current = null;
      }
    };
  }, [runSettlement]);

  return {
    triggerSettlement: () => runSettlement('manual'),
    isMounted: mountedRef.current,
  };
}
