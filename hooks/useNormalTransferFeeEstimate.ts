import { useQuery } from '@tanstack/react-query';

import {
  estimateNormalTokenTransferFee,
  type NormalTransferFeeEstimate,
} from '@/lib/payments/normal-token-transfer-fee';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';

import type { OffpayNetwork } from '@/types/offpay-api';

interface UseNormalTransferFeeEstimateParams {
  walletAddress: string | null | undefined;
  recipient: string | null | undefined;
  mint: string | null | undefined;
  rawAmount: string | null | undefined;
  decimals: number | null | undefined;
  network: OffpayNetwork | null | undefined;
  /** Skip estimation entirely (e.g., wallet is offline). */
  enabled?: boolean;
}

const FEE_REFRESH_MS = 30_000;

/**
 * Live fee estimate for a normal-route transfer. Recomputes whenever
 * the inputs change so the summary screen always shows what the
 * cluster will actually charge — no hardcoding, no placeholders.
 */
export function useNormalTransferFeeEstimate(params: UseNormalTransferFeeEstimateParams): {
  estimate: NormalTransferFeeEstimate | null;
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
    typeof params.decimals === 'number' &&
    Number.isFinite(params.decimals) &&
    params.network != null;

  const query = useQuery({
    queryKey: [
      'offpay',
      'normalTransferFee',
      params.network,
      params.walletAddress,
      params.recipient,
      params.mint,
      params.rawAmount,
      params.decimals,
    ],
    queryFn: async ({ signal }) => {
      if (
        params.walletAddress == null ||
        params.recipient == null ||
        params.mint == null ||
        params.rawAmount == null ||
        params.decimals == null ||
        params.network == null
      ) {
        return { lamports: null };
      }
      return estimateNormalTokenTransferFee({
        walletAddress: params.walletAddress,
        recipient: params.recipient,
        mint: params.mint,
        rawAmount: params.rawAmount,
        decimals: params.decimals,
        network: params.network,
        signal,
      });
    },
    enabled,
    // The blockhash referenced by the compiled message expires after
    // ~150 slots (~60 s). Refetching every 30 s keeps the lamport
    // figure honest without hammering the RPC.
    refetchInterval: FEE_REFRESH_MS,
    staleTime: FEE_REFRESH_MS,
    gcTime: 5 * 60_000,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === params.network &&
        previousKey?.[3] === params.walletAddress &&
        previousKey?.[4] === params.recipient &&
        previousKey?.[5] === params.mint &&
        previousKey?.[6] === params.rawAmount &&
        previousKey?.[7] === params.decimals
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
