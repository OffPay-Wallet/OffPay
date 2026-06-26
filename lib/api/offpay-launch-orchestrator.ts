import { QueryClient } from '@tanstack/react-query';

import {
  offpayCapabilitiesQueryKey,
  offpayCapabilitiesQueryOptions,
} from '@/lib/api/offpay-capabilities-query';
import { prefetchOffpayWalletDashboard } from '@/lib/api/offpay-dashboard-cache';
import { buildUnavailableCapabilities } from '@/lib/api/offpay-capability-fallback';
import { persistWalletDisplayCacheFromQueryClient } from '@/lib/wallet/wallet-display-cache';

import type { OffpayLaunchStep } from '@/store/offpayLaunchStore';
import type { CapabilitiesResponse, OffpayNetwork } from '@/types/offpay-api';

export type OffpayLaunchResult =
  | {
      status: 'ready';
      capabilities: CapabilitiesResponse;
      pendingBackupCount: number;
      recoveredBackupCount: number;
      portfolioPreloaded: boolean;
    }
  | {
      status: 'blocked';
      step: OffpayLaunchStep;
      intervention: 'create_or_import_wallet' | 'complete_nonce_setup' | null;
      message: string;
    };

export interface OffpayNonceReadiness {
  status: 'ready' | 'setup_required';
  message?: string;
}

export interface OffpayLaunchAdapters {
  checkNonceReadiness?: (params: {
    walletAddress: string;
    walletId: string;
    network: OffpayNetwork;
  }) => Promise<OffpayNonceReadiness>;
}

export interface RunOffpayLaunchParams {
  queryClient: QueryClient;
  walletId: string | null;
  walletAddress: string | null;
  network: OffpayNetwork | null;
  unsupportedNetworkReason?: string | null;
  adapters?: OffpayLaunchAdapters;
  onStep?: (
    step: OffpayLaunchStep,
    status: 'running' | 'complete' | 'skipped',
    message?: string,
  ) => void;
}

export async function runOffpayLaunchSequence(
  params: RunOffpayLaunchParams,
): Promise<OffpayLaunchResult> {
  const onStep = params.onStep ?? (() => undefined);

  onStep('wallet', 'running', 'Checking wallet state.');
  if (params.walletId == null || params.walletAddress == null) {
    return {
      status: 'blocked',
      step: 'wallet',
      intervention: 'create_or_import_wallet',
      message: 'Create or import a wallet to continue.',
    };
  }
  onStep('wallet', 'complete', 'Wallet is available.');

  if (params.network == null) {
    return {
      status: 'blocked',
      step: 'bootstrap',
      intervention: null,
      message: params.unsupportedNetworkReason ?? 'This network is not supported by OffPay API.',
    };
  }

  const walletId = params.walletId;
  const walletAddress = params.walletAddress;
  const network = params.network;

  onStep(
    'bootstrap',
    'skipped',
    'Protected OffPay API bootstrap is deferred until a protected route needs it.',
  );

  onStep('capabilities', 'running', 'Loading OffPay capability matrix.');

  // Launch must NOT block on the wallet dashboard, which is a multi-second
  // cold call. Fire the dashboard prefetch in the background: it hydrates
  // balance/transactions/capabilities/stream into the query cache and persists
  // the display cache for the next cold start when it resolves. The home
  // snapshot coordinator uses the same query key, so this does not double-fetch
  // the dashboard.
  void prefetchOffpayWalletDashboard({
    queryClient: params.queryClient,
    walletAddress,
    network,
    useCache: false,
    requestOwner: 'launch.dashboard',
  })
    .then((dashboard) => {
      if (dashboard == null) return;
      void persistWalletDisplayCacheFromQueryClient({
        queryClient: params.queryClient,
        walletAddress,
        network,
        options: {
          includeBalance: true,
          includeTransactions: false,
          includePendingBackupStats: false,
        },
      }).catch(() => undefined);
    })
    .catch(() => undefined);

  // Capabilities resolve from their own fast, separately-cached query (a cheap
  // endpoint with a short timeout) or memory cache — never gated on the
  // dashboard. This is what unblocks the launch sequence quickly. The
  // background dashboard prefetch writes the same capability cache key, so it
  // refreshes this value when it lands.
  const capabilitiesKey = offpayCapabilitiesQueryKey(network);
  const cachedCapabilities = params.queryClient.getQueryData<CapabilitiesResponse>(capabilitiesKey);
  const capabilities = await params.queryClient
    .fetchQuery(
      offpayCapabilitiesQueryOptions({
        network,
        requestOwner: 'launch.capabilities',
      }),
    )
    .catch(() =>
      cachedCapabilities?.network === network
        ? cachedCapabilities
        : buildUnavailableCapabilities(
            network,
            'OffPay API capabilities were unavailable during launch.',
          ),
    );
  onStep(
    'capabilities',
    'complete',
    cachedCapabilities?.network === network
      ? 'Capabilities loaded from memory cache.'
      : 'Capabilities loaded.',
  );

  onStep('pendingBackups', 'skipped', 'Blob backup recovery is no longer on the startup path.');

  onStep('nonce', 'running', 'Checking nonce readiness.');
  const nonceReadiness = (await params.adapters?.checkNonceReadiness?.({
    walletAddress,
    walletId,
    network,
  })) ?? { status: 'ready', message: 'Nonce readiness adapter was not provided.' };

  if (nonceReadiness.status === 'setup_required') {
    return {
      status: 'blocked',
      step: 'nonce',
      intervention: 'complete_nonce_setup',
      message: nonceReadiness.message ?? 'Complete one-time nonce setup to continue.',
    };
  }
  onStep('nonce', 'complete', nonceReadiness.message ?? 'Nonce is ready.');

  onStep('settlement', 'skipped', 'Settlement runs independently after the UI is ready.');

  onStep('portfolio', 'running', 'Preparing wallet overview.');
  const canFetchBalance = capabilities.capabilities.wallet.balance.available;
  const canFetchTransactions = capabilities.capabilities.wallet.transactions.available;
  const canPreloadPortfolio = canFetchBalance || canFetchTransactions;

  if (canPreloadPortfolio) {
    // The background dashboard prefetch (above) is already warming balance +
    // transactions and persisting the display cache when it lands; the home
    // snapshot coordinator renders from that shared cache. No extra fetch here.
    onStep('portfolio', 'complete', 'Wallet overview is warming in the background.');
  } else {
    onStep(
      'portfolio',
      'skipped',
      capabilities.capabilities.wallet.balance.message ??
        capabilities.capabilities.wallet.transactions.message ??
        'Wallet overview is not available on this backend.',
    );
  }

  return {
    status: 'ready',
    capabilities,
    pendingBackupCount: 0,
    recoveredBackupCount: 0,
    portfolioPreloaded: canPreloadPortfolio,
  };
}
