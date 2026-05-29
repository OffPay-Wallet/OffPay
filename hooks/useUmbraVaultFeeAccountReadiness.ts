import { useQuery } from '@tanstack/react-query';

import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import {
  verifyOffpayUmbraVaultFeeAccountReadiness,
  type UmbraDirectVaultAction,
  type UmbraVaultFeeAccountReadiness,
} from '@/lib/umbra/umbra-offpay-providers';

import type { OffpayNetwork } from '@/types/offpay-api';

const UMBRA_VAULT_READINESS_STALE_TIME_MS = 5 * 60_000;

export function umbraVaultFeeAccountReadinessQueryKey(
  network: OffpayNetwork | null | undefined,
  mint: string | null | undefined,
  action: UmbraDirectVaultAction,
): readonly unknown[] {
  return [
    'offpay',
    'umbraVaultFeeAccountReadiness',
    network ?? null,
    mint ?? null,
    action,
  ] as const;
}

export function useUmbraVaultFeeAccountReadiness(params: {
  action: UmbraDirectVaultAction;
  mint: string | null | undefined;
  network: OffpayNetwork | null | undefined;
  enabled?: boolean;
}): {
  readiness: UmbraVaultFeeAccountReadiness | null;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
} {
  const { canUseNetwork } = useOffpayNetworkAccess();
  const enabled =
    (params.enabled ?? true) &&
    canUseNetwork &&
    params.mint != null &&
    params.network != null;

  const query = useQuery({
    queryKey: umbraVaultFeeAccountReadinessQueryKey(
      params.network,
      params.mint,
      params.action,
    ),
    queryFn: () => {
      if (params.mint == null || params.network == null) {
        throw new Error('Umbra vault readiness needs a token mint and network.');
      }

      return verifyOffpayUmbraVaultFeeAccountReadiness({
        action: params.action,
        mint: params.mint,
        network: params.network,
      });
    },
    enabled,
    staleTime: UMBRA_VAULT_READINESS_STALE_TIME_MS,
    gcTime: 10 * 60_000,
    retry: 1,
  });

  return {
    readiness: query.data ?? null,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
