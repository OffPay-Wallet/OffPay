import { useQuery } from '@tanstack/react-query';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import {
  estimateUmbraPrivateP2PFromPublicBalanceFee,
  type UmbraPrivateP2PFeeEstimate,
} from '@/lib/umbra/umbra-execution';

import type { OffpayNetwork } from '@/types/offpay-api';

interface UseUmbraPrivateP2PFeeEstimateParams {
  walletAddress: string | null | undefined;
  walletId: string | null | undefined;
  recipient: string | null | undefined;
  token: string | null | undefined;
  amount: string | null | undefined;
  rawAmount: string | null | undefined;
  network: OffpayNetwork | null | undefined;
  enabled?: boolean;
}

const UMBRA_FEE_STALE_MS = 60_000;

export function umbraPrivateP2PFeeQueryKey(params: {
  network: OffpayNetwork | null | undefined;
  walletAddress: string | null | undefined;
  recipient: string | null | undefined;
  token: string | null | undefined;
  rawAmount: string | null | undefined;
}) {
  return [
    'offpay',
    'umbraPrivateP2PFee',
    params.network,
    params.walletAddress,
    params.recipient,
    params.token,
    params.rawAmount,
  ] as const;
}

export function useUmbraPrivateP2PFeeEstimate(params: UseUmbraPrivateP2PFeeEstimateParams): {
  estimate: UmbraPrivateP2PFeeEstimate | null;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
} {
  const { canUseNetwork } = useOffpayNetworkAccess();
  const enabled =
    (params.enabled ?? true) &&
    canUseNetwork &&
    params.walletAddress != null &&
    params.walletId != null &&
    params.recipient != null &&
    params.token != null &&
    params.amount != null &&
    params.amount.length > 0 &&
    params.rawAmount != null &&
    params.rawAmount.length > 0 &&
    /^\d+$/.test(params.rawAmount) &&
    BigInt(params.rawAmount) > 0n &&
    params.network != null;

  const query = useQuery({
    queryKey: umbraPrivateP2PFeeQueryKey(params),
    queryFn: ({ signal }) => {
      if (
        params.walletAddress == null ||
        params.walletId == null ||
        params.recipient == null ||
        params.token == null ||
        params.amount == null ||
        params.network == null
      ) {
        throw new Error('Umbra fee estimation requires complete payment details.');
      }

      return estimateUmbraPrivateP2PFromPublicBalanceFee({
        walletAddress: params.walletAddress,
        walletId: params.walletId,
        recipient: params.recipient,
        token: params.token,
        amount: params.amount,
        network: params.network,
        autoSetupSender: false,
        signal,
      });
    },
    enabled,
    staleTime: UMBRA_FEE_STALE_MS,
    gcTime: 2 * 60_000,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === params.network &&
        previousKey?.[3] === params.walletAddress &&
        previousKey?.[4] === params.recipient &&
        previousKey?.[5] === params.token &&
        previousKey?.[6] === params.rawAmount
        ? previousData
        : undefined;
    },
    retry: 1,
  });

  return {
    estimate: query.data ?? null,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
