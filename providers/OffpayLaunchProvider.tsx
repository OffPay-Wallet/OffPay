import React, { useEffect, useMemo } from 'react';

import { useLaunchOrchestrator } from '@/hooks/useLaunchOrchestrator';
import { useFirstPaintReady } from '@/hooks/useFirstPaintReady';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOfflineBleReceiver } from '@/hooks/useOfflineBleReceiver';
import { useOfflinePaymentSlotsAutoSync } from '@/hooks/useOfflinePaymentSlots';
import { useOffpayWalletActivityStream } from '@/hooks/useOffpayWalletActivityStream';
import { useOffpayWalletTransactions } from '@/hooks/useOffpayWalletTransactions';
import { useOffpayWalletWarmStart } from '@/hooks/useOffpayWalletWarmStart';
import { useSettlementEngine } from '@/hooks/useSettlementEngine';
import { useAppToast } from '@/components/ui/AppToast';
import {
  prewarmIncomingTransferPermission,
  presentIncomingTransferNotification,
} from '@/lib/notifications/local-notifications';
import { setOffpayNetworkAccessAllowed } from '@/lib/api/offpay-api-client';
import {
  isDisplayableWalletPaymentTransaction,
  mapWalletActivityEventForRecentActivity,
  mapWalletTransactionForRecentActivity,
} from '@/lib/api/offpay-wallet-data';
import { getOfflineNonceReadiness } from '@/lib/offline/offline-payments';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayLaunchAdapters } from '@/lib/api/offpay-launch-orchestrator';

interface OffpayLaunchProviderProps {
  children: React.ReactNode;
  adapters?: OffpayLaunchAdapters;
}

function OffpayWalletLiveUpdates(): null {
  const { canUseNetwork, isNetworkSwitching } = useOffpayNetworkAccess();
  // Defer WebSocket handshake + accountSubscribe fanout until after
  // first paint AND past any in-flight network switch. The HTTP
  // enrichment effect below catches any events missed during the
  // deferral window, so this is purely a freshness optimization.
  // Net effect: the bundling + cold-start crypto window stops
  // competing with WS connect work, and a network switch's
  // `isNetworkSwitching` lockout window stops competing with the
  // WS reconnect handshake the switch itself triggered.
  const firstPaintReady = useFirstPaintReady();
  const walletActivityStream = useOffpayWalletActivityStream({
    enabled: canUseNetwork && firstPaintReady && !isNetworkSwitching,
  });
  const { network } = useOffpayNetwork();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const transactionsQuery = useOffpayWalletTransactions({
    walletAddress,
    // Reuse the default page size so this consumer shares the same
    // React Query cache key as the History tab. Otherwise both
    // queries refetch on every WS-driven invalidation, doubling RPC
    // fan-out for the same data. The toast loop only inspects the
    // top 5 entries below.
    deferUntilAfterInteractions: true,
    refetchOnMount: false,
  });
  const { showToast } = useAppToast();
  const notifiedSignaturesRef = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (!__DEV__) return;
    console.log('[wallet-live-updates] stream status', {
      status: walletActivityStream.status,
      isLive: walletActivityStream.isLive,
      isFallback: walletActivityStream.isFallback,
      failureCount: walletActivityStream.failureCount,
      network: walletActivityStream.network,
      walletAddress: walletActivityStream.walletAddress,
    });
  }, [
    walletActivityStream.failureCount,
    walletActivityStream.isFallback,
    walletActivityStream.isLive,
    walletActivityStream.network,
    walletActivityStream.status,
    walletActivityStream.walletAddress,
  ]);

  React.useEffect(() => {
    notifiedSignaturesRef.current.clear();
  }, [network, walletAddress]);

  // The WS layer fires for every on-chain event that touches the
  // wallet (logsSubscribe with `mentions`) plus a per-account diff
  // for SOL/SPL balance changes. We surface a toast on direction-aware
  // events (`receive`/`send`) and skip the bare `on_chain_transaction`
  // entries because the HTTP enrichment effect below converts those
  // into a richer toast with amounts.
  React.useEffect(() => {
    const activity = walletActivityStream.lastActivity;
    const network = walletActivityStream.network;
    if (activity == null || network == null) return;
    if (notifiedSignaturesRef.current.has(activity.signature)) return;

    const direction = activity.direction;
    if (direction !== 'receive' && direction !== 'send') {
      // Bare on-chain notification (e.g. logsSubscribe ping that
      // didn't carry amount data). The transactions effect below
      // will pick this up after enrichment lands.
      if (__DEV__) {
        console.log('[wallet-live-updates] WS event without direction; deferring to HTTP', {
          type: activity.type,
          signature: activity.signature,
        });
      }
      return;
    }

    notifiedSignaturesRef.current.add(activity.signature);
    const view = mapWalletActivityEventForRecentActivity(activity);
    const amount = view.amountLabel ?? view.secondaryAmountLabel;
    const message = amount != null ? `${amount} ${view.subtitle}` : view.subtitle;
    if (__DEV__) {
      console.log('[wallet-live-updates] WS toast', {
        type: activity.type,
        direction,
        signature: activity.signature,
      });
    }
    showToast({
      title: view.title,
      message,
      variant: view.amountTone === 'negative' ? 'info' : 'success',
      notificationId: `wallet-incoming-${network}-${view.id}`,
    });
    void presentIncomingTransferNotification({
      identifier: `wallet-incoming-${network}-${view.id}`,
      title: view.title,
      body: message,
    });
  }, [showToast, walletActivityStream.lastActivity, walletActivityStream.network]);

  React.useEffect(() => {
    if (network == null || walletAddress == null) return;

    const recentWindowStartMs = Date.now() - 5 * 60 * 1000;
    for (const transaction of [...transactionsQuery.transactions.slice(0, 5)].reverse()) {
      if (notifiedSignaturesRef.current.has(transaction.signature)) continue;
      notifiedSignaturesRef.current.add(transaction.signature);

      const transactionTimeMs = transaction.timestamp * 1000;
      if (!Number.isFinite(transactionTimeMs) || transactionTimeMs < recentWindowStartMs) {
        continue;
      }

      // Surface a toast for any newly confirmed transaction that
      // touches the wallet, not just narrow "incoming P2P" matches.
      // This covers self-sends, swaps, and fee-only transactions —
      // i.e., anything a block explorer would list — which is what
      // users mean by "I should be told about new on-chain activity".
      if (!isDisplayableWalletPaymentTransaction(transaction)) continue;

      const view = mapWalletTransactionForRecentActivity(transaction);
      const amount = view.amountLabel ?? view.secondaryAmountLabel;
      const message = amount != null ? `${amount} ${view.subtitle}` : view.subtitle;
      if (__DEV__) {
        console.log('[wallet-live-updates] HTTP toast', {
          signature: transaction.signature,
          type: transaction.type,
          direction: transaction.direction,
        });
      }
      showToast({
        title: view.title,
        message,
        variant: view.amountTone === 'negative' ? 'info' : 'success',
        notificationId: `wallet-incoming-${network}-${transaction.signature}`,
      });
      void presentIncomingTransferNotification({
        identifier: `wallet-incoming-${network}-${transaction.signature}`,
        title: view.title,
        body: message,
      });
    }
  }, [network, showToast, transactionsQuery.transactions, walletAddress]);

  return null;
}

export function OffpayLaunchProvider({
  children,
  adapters,
}: OffpayLaunchProviderProps): React.JSX.Element {
  const walletMode = usePreferencesStore((state) => state.walletMode);
  const { canUseNetwork } = useOffpayNetworkAccess();
  // Single first-paint gate for everything that doesn't need to be
  // ready before the user can see the home screen. BLE receiver and
  // notification permission prewarm both subscribe to it so they
  // never compete with launch-orchestrator/wallet warm-start work.
  const firstPaintReady = useFirstPaintReady();
  const launchAdapters = useMemo<OffpayLaunchAdapters>(
    () => ({
      ...adapters,
      checkNonceReadiness:
        adapters?.checkNonceReadiness ??
        ((params) =>
          getOfflineNonceReadiness({
            walletAddress: params.walletAddress,
            network: params.network,
            walletMode,
          })),
    }),
    [adapters, walletMode],
  );

  useEffect(() => {
    setOffpayNetworkAccessAllowed(canUseNetwork);

    return () => {
      setOffpayNetworkAccessAllowed(true);
    };
  }, [canUseNetwork]);

  // Pre-warm the notification permission once per launch so the first
  // backgrounded incoming-transfer doesn't pay for the prompt inline.
  // Deferred behind first paint so the dynamic import of
  // `expo-notifications` doesn't compete with the launch sequence.
  useEffect(() => {
    if (!firstPaintReady) return;
    prewarmIncomingTransferPermission();
  }, [firstPaintReady]);

  useLaunchOrchestrator({ adapters: launchAdapters });
  useSettlementEngine();
  // BLE receiver dynamic-imports the peripheral module and runs a
  // permission round-trip on activation. Defer until after first
  // paint; missing the first ~hundred ms of inbound BLE frames is
  // safe because BLE pairing is multi-frame and retry-tolerant.
  useOfflineBleReceiver({ enabled: firstPaintReady });
  useOfflinePaymentSlotsAutoSync();
  useOffpayWalletWarmStart();

  return (
    <>
      <OffpayWalletLiveUpdates />
      {children}
    </>
  );
}
