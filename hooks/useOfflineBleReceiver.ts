import { useEffect, useRef } from 'react';

import { useAppToast } from '@/components/ui/AppToast';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { presentIncomingTransferNotification } from '@/lib/notifications/local-notifications';
import { startOfflineBleReceiver } from '@/lib/offline/offline-ble-transport';
import { enqueueReceivedOfflineSignedPayment } from '@/lib/offline/offline-payments';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useNotificationStore } from '@/store/notificationStore';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { useSettlementEngineStore } from '@/store/settlementEngineStore';
import { useAppStore } from '@/store/app';
import { useWalletStore } from '@/store/walletStore';

import type { OfflineBleReceiverSession } from '@/lib/offline/offline-ble-transport';

export function useOfflineBleReceiver(options?: { enabled?: boolean }): void {
  const enabled = options?.enabled ?? true;
  const { showToast } = useAppToast();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const username = useAppStore((state) => state.username);
  const { network } = useOffpayNetwork();
  const sessionRef = useRef<OfflineBleReceiverSession | null>(null);
  const handledTxIdsRef = useRef(new Set<string>());

  useEffect(() => {
    handledTxIdsRef.current.clear();
  }, [network, walletAddress]);

  useEffect(() => {
    let cancelled = false;
    sessionRef.current?.stop();
    sessionRef.current = null;

    if (!enabled || walletAddress == null || walletId == null || network == null) {
      return undefined;
    }

    void startOfflineBleReceiver({
      walletAddress,
      displayName: username,
      onPayment: async ({ payload }) => {
        if (cancelled || payload.recipient !== walletAddress || payload.network !== network) return;
        if (handledTxIdsRef.current.has(payload.txId)) return;
        handledTxIdsRef.current.add(payload.txId);

        try {
          if (payload.recipientTokenAccount == null || payload.recipientTokenAccount.trim().length === 0) {
            throw new Error('Received offline payment is missing the recipient token account.');
          }

          const verification = await enqueueReceivedOfflineSignedPayment({
            walletAddress,
            walletId,
            network,
            txId: payload.txId,
            signedTransaction: payload.signedBlob,
            expectedRecipient: payload.recipientTokenAccount,
            expectedAmount: payload.rawAmount,
            token: payload.tokenMint,
            sender: payload.sender,
          });

          const createdAt = Date.now();
          useOfflinePaymentStore.getState().addReceipt({
            id: `offline-receive-${network}-${verification.txId}`,
            direction: 'receive',
            status: 'received',
            title: 'Payment received',
            subtitle: `From ${shortenWalletAddress(payload.sender)}`,
            amountLabel: `+${payload.amount} ${payload.tokenSymbol}`,
            rawAmount: payload.rawAmount,
            tokenMint: payload.tokenMint,
            tokenSymbol: payload.tokenSymbol,
            tokenName: payload.tokenSymbol,
            tokenDecimals: payload.tokenDecimals,
            network,
            createdAt,
            updatedAt: createdAt,
            txId: verification.txId,
            sender: payload.sender,
            recipient: walletAddress,
          });

          useNotificationStore.getState().addNotification({
            id: `offline-received-${network}-${verification.txId}`,
            title: 'Payment received',
            message: `${payload.amount} ${payload.tokenSymbol} received offline.`,
            variant: 'success',
          });

          showToast({
            title: 'Payment received',
            message: `${payload.amount} ${payload.tokenSymbol} received offline.`,
            variant: 'success',
            notificationId: `offline-received-${network}-${verification.txId}`,
          });
          void presentIncomingTransferNotification({
            identifier: `offline-received-${network}-${verification.txId}`,
            title: 'Payment received',
            body: `${payload.amount} ${payload.tokenSymbol} received offline.`,
          });
          useSettlementEngineStore.getState().requestRun();
        } catch (error) {
          handledTxIdsRef.current.delete(payload.txId);
          throw error;
        }
      },
      onError: (error) => {
        if (cancelled) return;
        showToast({
          title: 'Offline receive failed',
          message: error.message,
          variant: 'warning',
        });
      },
    })
      .then((session) => {
        if (cancelled) {
          session.stop();
          return;
        }
        sessionRef.current = session;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        showToast({
          title: 'Bluetooth unavailable',
          message: error instanceof Error ? error.message : 'Offline receive is not available.',
          variant: 'warning',
        });
      });

    return () => {
      cancelled = true;
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, [enabled, network, showToast, username, walletAddress, walletId]);
}
