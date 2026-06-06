import { clearOffpayBootstrapCredentials } from '@/lib/api/offpay-api-storage';
import {
  clearOffpaySigningSession,
  setOffpayAuthRecoveryHandler,
} from '@/lib/api/offpay-api-client';
import { clearOfflineNonceState } from '@/lib/offline/offline-payments';
import { clearOfflinePaymentSlotCache } from '@/lib/offline/offline-payment-slots';
import { clearPendingBackupQueue } from '@/lib/payments/pending-backup-queue';
import { deleteAllManagedProfileImages } from '@/lib/profile/profile-image';
import { clearSecuritySettings } from '@/lib/wallet/security-settings';
import { deleteStoredWallet } from '@/lib/wallet/secure-wallet-store';
import { deleteWalletDisplayCache } from '@/lib/wallet/wallet-display-cache';
import { useAppStore } from '@/store/app';
import { useNotificationStore } from '@/store/notificationStore';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { useOffpayAuthStore } from '@/store/offpayAuthStore';
import { useOffpayLaunchStore } from '@/store/offpayLaunchStore';
import { useOffpayNetworkTransitionStore } from '@/store/offpayNetworkTransitionStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useAdvancedSwapStore } from '@/store/advancedSwapStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useSettlementEngineStore } from '@/store/settlementEngineStore';
import { useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';
import { useWalletStore } from '@/store/walletStore';

import type { QueryClient } from '@tanstack/react-query';
import type { OffpayNetwork } from '@/types/offpay-api';

const OFFPAY_NETWORKS: readonly OffpayNetwork[] = ['mainnet', 'devnet'];

interface ResetForgottenWalletParams {
  queryClient: QueryClient;
}

function uniqueWalletAddresses(): string[] {
  return Array.from(
    new Set(
      useWalletStore
        .getState()
        .wallets.map((wallet) => wallet.publicKey.trim())
        .filter((address) => address.length > 0),
    ),
  );
}

function buildWalletCacheCleanupTasks(walletAddresses: readonly string[]): Array<Promise<void>> {
  return walletAddresses.flatMap((walletAddress) =>
    OFFPAY_NETWORKS.flatMap((network) => [
      clearOfflineNonceState({ walletAddress, network }),
      clearOfflinePaymentSlotCache({ walletAddress, network }),
      deleteWalletDisplayCache({ walletAddress, network }),
    ]),
  );
}

function resetWalletScopedStores(): void {
  useWalletStore.setState({
    wallets: [],
    activeWalletId: null,
    publicKey: null,
    isLoading: false,
    error: null,
    accountName: 'Account 1',
    balance: '$ 0.00',
    isHydrated: true,
    isPrimary: false,
  });
  useOffpayAuthStore.getState().reset();
  useOffpayLaunchStore.getState().reset();
  useSettlementEngineStore.getState().reset();
  useOffpayNetworkTransitionStore.getState().clearNetworkAccessSuspension();
  useOfflinePaymentStore.setState({
    lastParsedPayload: null,
    receipts: [],
    recipientHistoryClearedAtByWallet: {},
  });
  usePrivatePaymentStore.setState({ receipts: [] });
  useAdvancedSwapStore.setState({ receipts: [] });
  useUmbraPrivacyStore.setState({
    receipts: [],
    registeredVaultKeys: [],
    registeredMixerKeys: [],
    registeredMixerVerifiedAt: {},
  });
  useNotificationStore.getState().clearNotifications();
  usePreferencesStore.getState().setWalletMode('online');
  usePreferencesStore.getState().setOfflinePaymentsEnabled(false);
}

export async function resetForgottenWallet(params: ResetForgottenWalletParams): Promise<void> {
  const walletAddresses = uniqueWalletAddresses();
  setOffpayAuthRecoveryHandler(null);
  clearOffpaySigningSession();
  await params.queryClient.cancelQueries();
  await deleteStoredWallet();
  await clearSecuritySettings();

  await Promise.allSettled([
    clearOffpayBootstrapCredentials(),
    clearPendingBackupQueue(),
    ...buildWalletCacheCleanupTasks(walletAddresses),
  ]);

  params.queryClient.clear();
  resetWalletScopedStores();
  useAppStore.getState().setUsername(null);
  deleteAllManagedProfileImages();
  useAppStore.getState().setProfileImageUri(null);
  useAppStore.getState().setHasOnboarded(false);
}
