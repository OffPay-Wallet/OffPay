import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { getSwapTokens } from '@/lib/api/offpay-api-client';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  getCachedOfflineTokenMetadataEntries,
  getOfflineTokenMetadataEntries,
  type OfflineTokenMetadata,
  observeOfflineTokenMetadataFromSwapTokens,
} from '@/lib/offline/offline-token-metadata';
import { getUmbraSupportedTokens, getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';

import type {
  CapabilitiesResponse,
  OffpayNetwork,
  SwapTokensResponse,
  WalletBalanceResponse,
} from '@/types/offpay-api';

interface TokenLogoMap {
  byMint: ReadonlyMap<string, string>;
  bySymbol: ReadonlyMap<string, string>;
}

export const offpaySwapTokensQueryKey = (network: string | null) =>
  ['offpay', 'swapTokens', network] as const;

export const TOKEN_LOGO_CACHE_STALE_MS = 30 * 60_000;
export const TOKEN_LOGO_CACHE_GC_MS = 60 * 60_000;

interface UseOffpayTokenLogoMapOptions {
  allowPendingCapabilities?: boolean;
  balanceData?: WalletBalanceResponse | null;
  capabilities?: CapabilitiesResponse['capabilities'] | null;
  deferCapabilitiesUntilAfterInteractions?: boolean;
  enabled?: boolean;
  fetchSwapTokenCatalog?: boolean;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function readMappedLogo(value: string | undefined): string | null {
  const logo = value?.trim();
  return logo != null && logo.length > 0 ? logo : null;
}

export function applyUmbraTokenLogoAliases(
  network: OffpayNetwork | null,
  byMint: Map<string, string>,
  bySymbol: Map<string, string>,
): void {
  if (network == null) return;

  for (const token of getUmbraSupportedTokens(network)) {
    const tokenSymbol = normalizeSymbol(token.symbol);
    if (
      readMappedLogo(byMint.get(token.mint)) != null &&
      readMappedLogo(bySymbol.get(tokenSymbol)) != null
    ) {
      continue;
    }

    const aliasLogo =
      token.aliases
        ?.map((alias) => readMappedLogo(bySymbol.get(normalizeSymbol(alias))))
        .find((logo): logo is string => logo != null) ?? null;

    if (aliasLogo == null) continue;

    if (readMappedLogo(byMint.get(token.mint)) == null) {
      byMint.set(token.mint, aliasLogo);
    }
    if (readMappedLogo(bySymbol.get(tokenSymbol)) == null) {
      bySymbol.set(tokenSymbol, aliasLogo);
    }
  }
}

function buildLogoMapFromMetadata(
  entries: readonly OfflineTokenMetadata[],
  network: OffpayNetwork | null,
): TokenLogoMap {
  const byMint = new Map<string, string>();
  const bySymbol = new Map<string, string>();

  for (const token of entries) {
    const logo = token.logo?.trim();
    if (!logo) continue;

    byMint.set(token.mint, logo);
    bySymbol.set(normalizeSymbol(token.symbol), logo);
  }

  applyUmbraTokenLogoAliases(network, byMint, bySymbol);

  return { byMint, bySymbol };
}

function hasMappedLogo(
  logoMap: TokenLogoMap,
  mint: string,
  symbols: readonly (string | null | undefined)[],
): boolean {
  if (logoMap.byMint.get(mint)?.trim()) return true;

  for (const symbol of symbols) {
    const normalized = symbol?.trim();
    if (normalized && logoMap.bySymbol.get(normalizeSymbol(normalized))?.trim()) {
      return true;
    }
  }

  return false;
}

export async function fetchOffpaySwapTokensForLogos(
  network: OffpayNetwork,
  signal?: AbortSignal,
): Promise<SwapTokensResponse> {
  const response = await getSwapTokens(network, { signal });
  void observeOfflineTokenMetadataFromSwapTokens(network, response.tokens);
  return response;
}

export function useOffpayTokenLogoMap(options?: UseOffpayTokenLogoMapOptions): TokenLogoMap {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const allowPendingCapabilities = options?.allowPendingCapabilities ?? false;
  const enabledByCaller = options?.enabled ?? true;
  const fetchSwapTokenCatalog = options?.fetchSwapTokenCatalog ?? true;
  const hasExternalBalanceData = options != null && 'balanceData' in options;
  const hasExternalCapabilities = options != null && 'capabilities' in options;
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: options?.deferCapabilitiesUntilAfterInteractions,
    enabled: enabledByCaller && !hasExternalBalanceData,
  });
  const capabilitiesQuery = useOffpayCapabilities({
    deferUntilAfterInteractions: options?.deferCapabilitiesUntilAfterInteractions,
    enabled: enabledByCaller && !hasExternalCapabilities,
    requestOwner: 'tokenLogos.capabilities',
  });
  const capabilities = hasExternalCapabilities
    ? (options?.capabilities ?? null)
    : capabilitiesQuery.capabilities;
  const balanceData = hasExternalBalanceData ? options?.balanceData : balanceQuery.data;
  const cachedPersistedLogoEntries = useMemo(
    () => (network == null ? [] : getCachedOfflineTokenMetadataEntries(network)),
    [network],
  );
  const cachedPersistedLogoMap = useMemo(
    () => buildLogoMapFromMetadata(cachedPersistedLogoEntries, network),
    [cachedPersistedLogoEntries, network],
  );
  const cachedLogosCoverBalanceTokens = useMemo(() => {
    if (network == null || balanceData == null || balanceData.tokens.length === 0) {
      return false;
    }

    return balanceData.tokens.every((token) => {
      if (token.logo?.trim()) return true;

      const umbraToken = getUmbraTokenByMint(network, token.mint);
      return hasMappedLogo(cachedPersistedLogoMap, token.mint, [
        token.symbol,
        umbraToken?.symbol,
        ...(umbraToken?.aliases ?? []),
      ]);
    });
  }, [balanceData, cachedPersistedLogoMap, network]);
  const cachedLogosCoverUmbraTokens = useMemo(() => {
    if (network == null || !allowPendingCapabilities) return false;
    const tokens = getUmbraSupportedTokens(network);
    if (tokens.length === 0) return false;

    return tokens.every((token) =>
      hasMappedLogo(cachedPersistedLogoMap, token.mint, [token.symbol, ...(token.aliases ?? [])]),
    );
  }, [allowPendingCapabilities, cachedPersistedLogoMap, network]);
  const hasBalanceLogoTargets = balanceData != null && balanceData.tokens.length > 0;
  const cachedLogosCoverRequestedTargets = allowPendingCapabilities
    ? cachedLogosCoverUmbraTokens && (!hasBalanceLogoTargets || cachedLogosCoverBalanceTokens)
    : cachedLogosCoverBalanceTokens;
  const capability = getOffpayFeatureCapability(capabilities, 'swap.tokens');
  const canFetchCatalogWithCapabilities =
    capabilities == null && allowPendingCapabilities
      ? true
      : isOffpayFeatureAvailable(capabilities, 'swap.tokens') && capability.available;
  const enabled =
    network != null &&
    enabledByCaller &&
    fetchSwapTokenCatalog &&
    !cachedLogosCoverRequestedTargets &&
    canUseNetwork &&
    canFetchCatalogWithCapabilities;

  const query = useQuery({
    queryKey: offpaySwapTokensQueryKey(network),
    queryFn: async ({ signal }) => {
      if (network == null) {
        throw new Error('Token logos require a supported OffPay network.');
      }

      return fetchOffpaySwapTokensForLogos(network, signal);
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
    placeholderData: () => cachedPersistedLogoEntries,
    staleTime: TOKEN_LOGO_CACHE_STALE_MS,
    gcTime: TOKEN_LOGO_CACHE_GC_MS,
    refetchOnMount: false,
  });

  return useMemo(() => {
    const byMint = new Map<string, string>();
    const bySymbol = new Map<string, string>();

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

    for (const token of balanceData?.tokens ?? []) {
      const logo = token.logo?.trim();
      if (!logo) continue;

      byMint.set(token.mint, logo);
      bySymbol.set(normalizeSymbol(token.symbol), logo);
    }

    applyUmbraTokenLogoAliases(network, byMint, bySymbol);

    return { byMint, bySymbol };
  }, [balanceData?.tokens, network, persistedLogoQuery.data, query.data]);
}
