import { useQuery } from '@tanstack/react-query';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { getPrivatePaymentBalance } from '@/lib/api/offpay-api-client';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayNetwork, PrivateBalanceResponse } from '@/types/offpay-api';

const PRIVATE_PAYMENT_BALANCE_STALE_TIME_MS = 1000 * 30;

export const privatePaymentBalanceQueryKey = (
  walletAddress: string | null,
  network: OffpayNetwork | null,
  mint?: string | null,
) => ['offpay', 'privatePaymentBalance', network, walletAddress, mint ?? 'default'] as const;

interface UsePrivatePaymentBalanceOptions {
  mint?: string | null;
  enabled?: boolean;
}

export function usePrivatePaymentBalance(options?: UsePrivatePaymentBalanceOptions) {
  const walletAddress = useWalletStore((state) => state.publicKey);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const capabilitiesQuery = useOffpayCapabilities();
  const mint = options?.mint?.trim() ?? '';
  const hasValidMint = mint.length === 0 || isValidSolanaAddress(mint);
  const isCapabilityEnabled = isOffpayFeatureAvailable(
    capabilitiesQuery.capabilities,
    'payment.privateBalance',
  );
  const enabled =
    (options?.enabled ?? true) &&
    walletAddress != null &&
    network != null &&
    canUseNetwork &&
    hasValidMint &&
    isCapabilityEnabled;

  const query = useQuery<PrivateBalanceResponse>({
    queryKey: privatePaymentBalanceQueryKey(walletAddress, network, mint || null),
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Private balance requires an active wallet and supported network.');
      }

      return getPrivatePaymentBalance(walletAddress, network, mint.length > 0 ? mint : undefined);
    },
    enabled,
    staleTime: PRIVATE_PAYMENT_BALANCE_STALE_TIME_MS,
    refetchOnMount: true,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === network &&
        previousKey?.[3] === walletAddress &&
        previousKey?.[4] === (mint || 'default')
        ? previousData
        : undefined;
    },
    retry: false,
  });

  return {
    ...query,
    walletAddress,
    network,
    isCapabilityEnabled,
    isCapabilitiesPending: capabilitiesQuery.isCapabilitiesPending,
    capability: getOffpayFeatureCapability(
      capabilitiesQuery.capabilities,
      'payment.privateBalance',
    ),
    hasValidMint,
  };
}
