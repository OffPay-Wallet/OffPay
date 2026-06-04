import React, { useEffect, useMemo } from 'react';

import { useLaunchOrchestrator } from '@/hooks/useLaunchOrchestrator';
import { useFirstPaintReady } from '@/hooks/useFirstPaintReady';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOfflineBleReceiver } from '@/hooks/useOfflineBleReceiver';
import { useOfflinePaymentSlotsAutoSync } from '@/hooks/useOfflinePaymentSlots';
import { useOffpayWalletActivityStream } from '@/hooks/useOffpayWalletActivityStream';
import { useOffpayWalletWarmStart } from '@/hooks/useOffpayWalletWarmStart';
import { useSettlementEngine } from '@/hooks/useSettlementEngine';
import { useAppToast } from '@/components/ui/AppToast';
import {
  prewarmWalletTransactionNotificationPermission,
  presentWalletTransactionEventNotification,
} from '@/lib/notifications/local-notifications';
import { setOffpayNetworkAccessAllowed } from '@/lib/api/offpay-api-client';
import {
  isDisplayableWalletActivityEvent,
  mapWalletActivityEventForRecentActivity,
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
  const { showToast } = useAppToast();
  const handledSignaturesRef = React.useRef(new Set<string>());

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
    handledSignaturesRef.current.clear();
  }, [network, walletAddress]);

  // The wallet activity stream already normalizes direction and
  // amount data before it lands here. Keep this provider narrow:
  // surface mobile transaction notifications from the stream and let
  // screen-level queries own full transaction history. Mounting a
  // history query globally just to enrich transient alerts adds
  // avoidable startup and invalidation work.
  React.useEffect(() => {
    const network = walletActivityStream.network;
    if (network == null) return;

    for (const activity of walletActivityStream.activityEvents) {
      if (!isDisplayableWalletActivityEvent(activity)) continue;
      if (handledSignaturesRef.current.has(activity.signature)) continue;

      handledSignaturesRef.current.add(activity.signature);
      const view = mapWalletActivityEventForRecentActivity(activity);

      void presentWalletTransactionEventNotification({
        identifier: `wallet-transaction-${network}-${view.id}`,
        type: view.type,
        amountLabel: view.amountLabel,
        secondaryAmountLabel: view.secondaryAmountLabel,
        signature: activity.signature,
      });

      if (view.type !== 'receive' && view.type !== 'send') {
        if (__DEV__) {
          console.log('[wallet-live-updates] mobile notification only', {
            type: activity.type,
            displayType: view.type,
            signature: activity.signature,
          });
        }
        continue;
      }

      const amount = view.amountLabel ?? view.secondaryAmountLabel;
      const message = amount != null ? `${amount} ${view.subtitle}` : view.subtitle;
      if (__DEV__) {
        console.log('[wallet-live-updates] WS toast', {
          type: activity.type,
          direction: view.type,
          signature: activity.signature,
        });
      }
      showToast({
        title: view.title,
        message,
        variant: view.amountTone === 'negative' ? 'info' : 'success',
        persistToNotificationCenter: false,
      });
    }
  }, [showToast, walletActivityStream.activityEvents, walletActivityStream.network]);

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
    prewarmWalletTransactionNotificationPermission();
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
