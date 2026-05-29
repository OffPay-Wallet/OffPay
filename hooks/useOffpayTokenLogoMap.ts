import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { getSwapTokens } from '@/lib/api/offpay-api-client';
import { getOffpayFeatureCapability, isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import {
  getCachedOfflineTokenMetadataEntries,
  getOfflineTokenMetadataEntries,
  observeOfflineTokenMetadataFromSwapTokens,
} from '@/lib/offline/offline-token-metadata';

interface TokenLogoMap {
  byMint: ReadonlyMap<string, string>;
  bySymbol: ReadonlyMap<string, string>;
}

export const offpaySwapTokensQueryKey = (network: string | null) =>
  ['offpay', 'swapTokens', network] as const;

export const TOKEN_LOGO_CACHE_STALE_MS = 30 * 60_000;
export const TOKEN_LOGO_CACHE_GC_MS = 60 * 60_000;

interface UseOffpayTokenLogoMapOptions {
  deferCapabilitiesUntilAfterInteractions?: boolean;
  enabled?: boolean;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function useOffpayTokenLogoMap(options?: UseOffpayTokenLogoMapOptions): TokenLogoMap {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const enabledByCaller = options?.enabled ?? true;
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: options?.deferCapabilitiesUntilAfterInteractions,
    enabled: enabledByCaller,
  });
  const capabilitiesQuery = useOffpayCapabilities({
    deferUntilAfterInteractions: options?.deferCapabilitiesUntilAfterInteractions,
    enabled: enabledByCaller,
  });
  const { capabilities } = capabilitiesQuery;
  const capability = getOffpayFeatureCapability(capabilities, 'swap.tokens');
  const enabled =
    network != null &&
    enabledByCaller &&
    canUseNetwork &&
    isOffpayFeatureAvailable(capabilities, 'swap.tokens') &&
    capability.available;

  const query = useQuery({
    queryKey: offpaySwapTokensQueryKey(network),
    queryFn: async ({ signal }) => {
      if (network == null) {
        throw new Error('Token logos require a supported OffPay network.');
      }

      const response = await getSwapTokens(network, { signal });
      void observeOfflineTokenMetadataFromSwapTokens(network, response.tokens);
      return response;
    },
    enabled: enabled && !isNetworkAccessSuspended,
    staleTime: TOKEN_LOGO_CACHE_STALE_MS,
    gcTime: TOKEN_LOGO_CACHE_GC_MS,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === network ? previousData : undefined,
    refetchOnMount: false,
  });
  const persistedLogoQuery = useQuery({
    queryKey: ['offpay', 'tokenLogos', 'persisted', network],
    queryFn: async () => {
      if (network == null) {
        throw new Error('Token logo cache requires a supported OffPay network.');
      }

      return getOfflineTokenMetadataEntries(network);
    },
    enabled: enabledByCaller && network != null && !isNetworkAccessSuspended,
    placeholderData: () => (network == null ? [] : getCachedOfflineTokenMetadataEntries(network)),
    staleTime: TOKEN_LOGO_CACHE_STALE_MS,
    gcTime: TOKEN_LOGO_CACHE_GC_MS,
    refetchOnMount: false,
  });

  return useMemo(() => {
    const byMint = new Map<string, string>();
    const bySymbol = new Map<string, string>();

    // Seed the canonical native-SOL entry first so SOL transfers in
    // history have a real logo on the very first paint, before the
    // swap-token list query lands. Subsequent loops below can still
    // overwrite this if a custom logo is configured.
    const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
    const NATIVE_SOL_LOGO =
      'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';
    byMint.set(NATIVE_SOL_MINT, NATIVE_SOL_LOGO);
    bySymbol.set('SOL', NATIVE_SOL_LOGO);

    for (const token of persistedLogoQuery.data ?? []) {
      const logo = token.logo?.trim();
      if (!logo) continue;

      byMint.set(token.mint, logo);
      bySymbol.set(normalizeSymbol(token.symbol), logo);
    }

    for (const token of query.data?.tokens ?? []) {
      const logo = token.logo?.trim();
      if (!logo) continue;

      byMint.set(token.mint, logo);
      bySymbol.set(normalizeSymbol(token.symbol), logo);
    }

    for (const token of balanceQuery.data?.tokens ?? []) {
      const logo = token.logo?.trim();
      if (!logo) continue;

      byMint.set(token.mint, logo);
      bySymbol.set(normalizeSymbol(token.symbol), logo);
    }

    return { byMint, bySymbol };
  }, [balanceQuery.data?.tokens, persistedLogoQuery.data, query.data]);
}
