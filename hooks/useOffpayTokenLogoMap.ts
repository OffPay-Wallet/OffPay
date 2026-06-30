import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { getSwapTokens } from '@/lib/api/offpay-api-client';
import { mark, measure } from '@/lib/perf/perf-marks';
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
  fetchWhenBalanceLogosMissing?: boolean;
  fetchSwapTokenCatalog?: boolean;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function readMappedLogo(value: string | undefined): string | null {
  const logo = value?.trim();
  return logo != null && logo.length > 0 ? logo : null;
}

function isSvgLogoUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  const cleanPath = normalized.split(/[?#]/, 1)[0] ?? normalized;
  return cleanPath.endsWith('.svg') || normalized.includes('image/svg+xml');
}

export function choosePreferredTokenLogo(
  current: string | null | undefined,
  next: string | null | undefined,
): string | null {
  const currentLogo = current?.trim();
  const nextLogo = next?.trim();

  if (!currentLogo) return nextLogo && nextLogo.length > 0 ? nextLogo : null;
  if (!nextLogo) return currentLogo;

  const currentIsSvg = isSvgLogoUri(currentLogo);
  const nextIsSvg = isSvgLogoUri(nextLogo);

  if (currentIsSvg && !nextIsSvg) return nextLogo;
  if (!currentIsSvg && nextIsSvg) return currentLogo;

  return nextLogo;
}

function setPreferredTokenLogo(map: Map<string, string>, key: string, logo: string): void {
  const preferred = choosePreferredTokenLogo(map.get(key), logo);
  if (preferred != null) {
    map.set(key, preferred);
  }
}

function readPreferredMappedLogo(value: string | undefined): string | null {
  const logo = readMappedLogo(value);
  return logo != null && !isSvgLogoUri(logo) ? logo : null;
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
      readPreferredMappedLogo(byMint.get(token.mint)) != null &&
      readPreferredMappedLogo(bySymbol.get(tokenSymbol)) != null
    ) {
      continue;
    }

    const aliasLogo =
      token.aliases?.reduce<string | null>((preferredLogo, alias) => {
        const logo = readMappedLogo(bySymbol.get(normalizeSymbol(alias)));
        return choosePreferredTokenLogo(preferredLogo, logo);
      }, null) ?? null;

    if (aliasLogo == null) continue;

    setPreferredTokenLogo(byMint, token.mint, aliasLogo);
    setPreferredTokenLogo(bySymbol, tokenSymbol, aliasLogo);
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

    setPreferredTokenLogo(byMint, token.mint, logo);
    setPreferredTokenLogo(bySymbol, normalizeSymbol(token.symbol), logo);
  }

  applyUmbraTokenLogoAliases(network, byMint, bySymbol);

  return { byMint, bySymbol };
}

function hasPreferredMappedLogo(
  logoMap: TokenLogoMap,
  mint: string,
  symbols: readonly (string | null | undefined)[],
): boolean {
  if (readPreferredMappedLogo(logoMap.byMint.get(mint)) != null) return true;

  for (const symbol of symbols) {
    const normalized = symbol?.trim();
    if (
      normalized &&
      readPreferredMappedLogo(logoMap.bySymbol.get(normalizeSymbol(normalized))) != null
    ) {
      return true;
    }
  }

  return false;
}

export async function fetchOffpaySwapTokensForLogos(
  network: OffpayNetwork,
  signal?: AbortSignal,
  requestOwner = 'tokenLogos.catalog',
): Promise<SwapTokensResponse> {
  const startedAt = mark();
  const response = await getSwapTokens(network, { signal, requestOwner });
  measure('tokenLogo.catalogFetch', startedAt, {
    network,
    owner: requestOwner,
    tokens: response.tokens.length,
  });
  void observeOfflineTokenMetadataFromSwapTokens(network, response.tokens);
  return response;
}

export function useOffpayTokenLogoMap(options?: UseOffpayTokenLogoMapOptions): TokenLogoMap {
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const allowPendingCapabilities = options?.allowPendingCapabilities ?? false;
  const enabledByCaller = options?.enabled ?? true;
  const fetchWhenBalanceLogosMissing = options?.fetchWhenBalanceLogosMissing ?? false;
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
      const tokenLogo = token.logo?.trim();
      if (tokenLogo && !isSvgLogoUri(tokenLogo)) return true;

      const umbraToken = getUmbraTokenByMint(network, token.mint);
      return hasPreferredMappedLogo(cachedPersistedLogoMap, token.mint, [
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
      hasPreferredMappedLogo(cachedPersistedLogoMap, token.mint, [
        token.symbol,
        ...(token.aliases ?? []),
      ]),
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
  const shouldFetchSwapTokenCatalog =
    fetchSwapTokenCatalog ||
    (fetchWhenBalanceLogosMissing && hasBalanceLogoTargets && !cachedLogosCoverBalanceTokens);
  const enabled =
    network != null &&
    enabledByCaller &&
    shouldFetchSwapTokenCatalog &&
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

      setPreferredTokenLogo(byMint, token.mint, logo);
      setPreferredTokenLogo(bySymbol, normalizeSymbol(token.symbol), logo);
    }

    for (const token of query.data?.tokens ?? []) {
      const logo = token.logo?.trim();
      if (!logo) continue;

      setPreferredTokenLogo(byMint, token.mint, logo);
      setPreferredTokenLogo(bySymbol, normalizeSymbol(token.symbol), logo);
    }

    for (const token of balanceData?.tokens ?? []) {
      const logo = token.logo?.trim();
      if (!logo) continue;

      setPreferredTokenLogo(byMint, token.mint, logo);
      setPreferredTokenLogo(bySymbol, normalizeSymbol(token.symbol), logo);
    }

    applyUmbraTokenLogoAliases(network, byMint, bySymbol);

    return { byMint, bySymbol };
  }, [balanceData?.tokens, network, persistedLogoQuery.data, query.data]);
}
