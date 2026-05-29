import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { fetchUmbraEncryptedBalances } from '@/lib/umbra/umbra-execution';
import { getOffpayFeatureCapability, isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { useWalletStore } from '@/store/walletStore';

import type { UmbraExecutionResult } from '@/lib/umbra/umbra-execution';
import type { UmbraVaultTokenConfig } from '@/components/features/umbra-vault/types';

const UMBRA_BALANCE_STALE_TIME_MS = 0;
const UMBRA_BALANCE_GC_TIME_MS = 1000 * 60 * 30;

export function useUmbraEncryptedBalances(tokens: UmbraVaultTokenConfig[]) {
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const { capabilities, isCapabilitiesPending } = useOffpayCapabilities();
  const capability = getOffpayFeatureCapability(capabilities, 'umbra.execution');
  const tokenSymbols = useMemo(() => tokens.map((token) => token.symbol), [tokens]);
  const tokenScopeKey = tokenSymbols.join('|');
  const capabilityAvailable = isOffpayFeatureAvailable(capabilities, 'umbra.execution');
  const enabled =
    walletAddress != null &&
    network != null &&
    canUseNetwork &&
    isUmbraNetworkSupported(network) &&
    tokenSymbols.length > 0 &&
    capabilityAvailable;

  const query = useQuery<UmbraExecutionResult>({
    queryKey: ['offpay', 'umbraEncryptedBalances', network, walletAddress, tokenScopeKey] as const,
    queryFn: () => {
      if (walletAddress == null || network == null || tokenSymbols.length === 0) {
        throw new Error('Umbra balances require an active wallet and supported token set.');
      }

      return fetchUmbraEncryptedBalances({
        walletAddress,
        walletId,
        network,
        tokens: tokenSymbols,
      });
    },
    enabled,
    // Shielded balances are wallet-critical. Keep the last resolved value in
    // memory for smooth rendering, but mark it stale immediately so every
    // mount/manual refresh asks the chain-backed query path for current data.
    staleTime: UMBRA_BALANCE_STALE_TIME_MS,
    gcTime: UMBRA_BALANCE_GC_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === network &&
        previousKey?.[3] === walletAddress &&
        previousKey?.[4] === tokenScopeKey
        ? previousData
        : undefined;
    },
    retry: false,
    meta: {
      capabilityMessage: capability.message,
    },
  });

  return {
    ...query,
    walletAddress,
    network,
    capability,
    isCapabilitiesPending: canUseNetwork && isCapabilitiesPending,
    isCapabilityEnabled: capabilityAvailable || enabled,
  };
}
