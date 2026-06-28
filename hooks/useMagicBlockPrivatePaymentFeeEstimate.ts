import { useQuery } from '@tanstack/react-query';

import {
  preparePrivatePaymentPlan,
  type PreparedPrivatePaymentPlan,
} from '@/lib/magicblock/private-payment';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';

import type { OffpayNetwork } from '@/types/offpay-api';

interface UseMagicBlockPrivatePaymentFeeEstimateParams {
  walletAddress: string | null | undefined;
  recipient: string | null | undefined;
  mint: string | null | undefined;
  rawAmount: string | null | undefined;
  network: OffpayNetwork | null | undefined;
  enabled?: boolean;
}

export const MAGICBLOCK_FEE_REFRESH_MS = 25_000;

export function magicBlockPrivatePaymentFeeQueryKey(params: {
  network: OffpayNetwork | null | undefined;
  walletAddress: string | null | undefined;
  recipient: string | null | undefined;
  mint: string | null | undefined;
  rawAmount: string | null | undefined;
}) {
  return [
    'offpay',
    'magicBlockPrivatePaymentFee',
    params.network,
    params.walletAddress,
    params.recipient,
    params.mint,
    params.rawAmount,
  ] as const;
}

export function useMagicBlockPrivatePaymentFeeEstimate(
  params: UseMagicBlockPrivatePaymentFeeEstimateParams,
): {
  plan: PreparedPrivatePaymentPlan | null;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
} {
  const { canUseNetwork } = useOffpayNetworkAccess();
  const enabled =
    (params.enabled ?? true) &&
    canUseNetwork &&
    params.walletAddress != null &&
    params.recipient != null &&
    params.mint != null &&
    params.rawAmount != null &&
    params.rawAmount.length > 0 &&
    /^\d+$/.test(params.rawAmount) &&
    BigInt(params.rawAmount) > 0n &&
    params.network != null;

  const query = useQuery({
    queryKey: magicBlockPrivatePaymentFeeQueryKey(params),
    queryFn: () => {
      if (
        params.walletAddress == null ||
        params.recipient == null ||
        params.mint == null ||
        params.rawAmount == null ||
        params.network == null
      ) {
        throw new Error('MagicBlock fee estimation requires complete payment details.');
      }

      return preparePrivatePaymentPlan({
        walletAddress: params.walletAddress,
        recipient: params.recipient,
        mint: params.mint,
        amount: params.rawAmount,
        network: params.network,
      });
    },
    enabled,
    refetchInterval: MAGICBLOCK_FEE_REFRESH_MS,
    staleTime: MAGICBLOCK_FEE_REFRESH_MS,
    gcTime: 2 * 60_000,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === params.network &&
        previousKey?.[3] === params.walletAddress &&
        previousKey?.[4] === params.recipient &&
        previousKey?.[5] === params.mint &&
        previousKey?.[6] === params.rawAmount
        ? previousData
        : undefined;
    },
    retry: 1,
  });

  return {
    plan: query.data ?? null,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
