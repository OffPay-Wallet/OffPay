import { QueryClient } from '@tanstack/react-query';

import { offpayCapabilitiesQueryKey } from '@/hooks/useOffpayCapabilities';
import { getCapabilities } from '@/lib/api/offpay-api-client';
import {
  buildUnavailableCapabilities,
  CAPABILITIES_FAST_TIMEOUT_MS,
  CAPABILITIES_STALE_TIME_MS,
} from '@/lib/api/offpay-capability-fallback';
import { prefetchWalletDisplayData } from '@/lib/wallet/wallet-display-cache';

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
  const capabilitiesKey = offpayCapabilitiesQueryKey(network);
  const cachedCapabilities = params.queryClient.getQueryData<CapabilitiesResponse>(capabilitiesKey);
  const capabilities =
    cachedCapabilities?.network === network
      ? cachedCapabilities
      : await params.queryClient
          .fetchQuery({
            queryKey: capabilitiesKey,
            queryFn: ({ signal }) =>
              getCapabilities(network, {
                signal,
                timeoutMs: CAPABILITIES_FAST_TIMEOUT_MS,
              }),
            staleTime: CAPABILITIES_STALE_TIME_MS,
          })
          .catch(() =>
            buildUnavailableCapabilities(
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

  onStep(
    'pendingBackups',
    'skipped',
    'Blob backup recovery is no longer on the startup path.',
  );

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
    void prefetchWalletDisplayData({
      queryClient: params.queryClient,
      walletAddress,
      network,
      canFetchBalance,
      canFetchTransactions,
      forceRefresh: false,
    }).catch(() => undefined);
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
