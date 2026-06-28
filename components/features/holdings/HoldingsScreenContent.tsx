import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';

import { TokenRow, TokenRowSkeleton } from '@/components/features/home/TokenHoldingsCard';
import { HoldingsHeader } from '@/components/features/holdings/HoldingsHeader';
import { HoldingsSearchBar } from '@/components/features/holdings/HoldingsSearchBar';
import { Text } from '@/components/ui/Text';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import { colors } from '@/constants/colors';
import { radii, spacing } from '@/constants/spacing';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayPortfolioValuation } from '@/hooks/useOffpayPortfolioValuation';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import {
  buildStablecoinMetadataLookup,
  buildVisibleTokenHoldings,
  countSpamTokens,
} from '@/lib/api/offpay-wallet-data';
import { buildTokenDetailsRouteParams } from '@/lib/navigation/token-details-params';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { hydrateWalletDisplayCacheIntoQueryClient } from '@/lib/wallet/wallet-display-cache';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useWalletStore } from '@/store/walletStore';

import type { TokenValuationView } from '@/hooks/useOffpayTokenValuations';
import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';
import type { ViewToken } from 'react-native';

interface HoldingsScreenContentProps {
  paddingTop: number;
}

interface RowItem {
  holding: TokenHolding;
  valuation?: TokenValuationView;
}

const SKELETON_ROW_COUNT = 4;
const HOLDINGS_CONTENT_MAX_WIDTH = 430;

function matchesQuery(holding: TokenHolding, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (query.length === 0) return true;
  return holding.symbol.toLowerCase().includes(query) || holding.name.toLowerCase().includes(query);
}

function getQueryErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Stable empty set so the initial visible-mints state keeps a constant identity. */
const EMPTY_VISIBLE_MINTS: ReadonlySet<string> = new Set<string>();

/** Only rows at least this visible trigger a price-history fetch. */
const HOLDINGS_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 10,
  minimumViewTime: 120,
} as const;

function areMintSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function HoldingsScreenContent({
  paddingTop,
}: HoldingsScreenContentProps): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [visibleMints, setVisibleMints] = useState<ReadonlySet<string>>(EMPTY_VISIBLE_MINTS);
  // react-native requires stable identities for these two FlashList props.
  const viewabilityConfig = useRef(HOLDINGS_VIEWABILITY_CONFIG).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[]; changed: ViewToken[] }): void => {
      const next = new Set<string>();
      for (const token of viewableItems) {
        const mint = (token.item as RowItem | null | undefined)?.holding?.mint;
        if (token.isViewable && mint != null) next.add(mint);
      }
      setVisibleMints((prev) => (areMintSetsEqual(prev, next) ? prev : next));
    },
  ).current;
  const hydratedKeyRef = useRef<string | null>(null);
  const scheduledHydrationRef = useRef<ReturnType<typeof scheduleUiWorkAfterFirstPaint> | null>(
    null,
  );
  const currency = usePreferencesStore((s) => s.currency);
  const publicKey = useWalletStore((s) => s.publicKey);
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkAccessSuspended } = useOffpayNetworkAccess();
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: false,
    eagerWithoutCapabilities: true,
  });
  const tokenLogoMap = useOffpayTokenLogoMap({
    deferCapabilitiesUntilAfterInteractions: false,
  });
  const capabilitiesQuery = useOffpayCapabilities({
    deferUntilAfterInteractions: false,
  });
  const tokenMetadata = useMemo(
    () =>
      buildStablecoinMetadataLookup(capabilitiesQuery.capabilities?.offline?.supportedStablecoins),
    [capabilitiesQuery.capabilities?.offline?.supportedStablecoins],
  );
  const holdings = useMemo(() => {
    return balanceQuery.data == null
      ? []
      : buildVisibleTokenHoldings(balanceQuery.data, tokenLogoMap, tokenMetadata);
  }, [balanceQuery.data, tokenLogoMap, tokenMetadata]);
  const portfolioValuationQuery = useOffpayPortfolioValuation({ holdings, currency });
  const hasPositiveHoldings = holdings.some((holding) => holding.balanceValue > 0);
  const portfolioValuationData = portfolioValuationQuery.data;
  const portfolioValuationComplete =
    portfolioValuationData != null &&
    portfolioValuationData.expectedCount > 0 &&
    portfolioValuationData.pricedCount >= portfolioValuationData.expectedCount;
  const portfolioValuationSettled =
    portfolioValuationQuery.isFetched || portfolioValuationQuery.isError || !hasPositiveHoldings;
  const portfolioValuationDisplayReady =
    !hasPositiveHoldings || portfolioValuationComplete || portfolioValuationSettled;
  const valuations = portfolioValuationDisplayReady
    ? portfolioValuationData?.tokenValues
    : undefined;

  const filtered = useMemo(() => {
    return holdings.filter((holding) => matchesQuery(holding, query));
  }, [holdings, query]);

  const rowItems = useMemo<RowItem[]>(
    () =>
      filtered.map((holding) => ({
        holding,
        valuation: valuations?.[holding.mint],
      })),
    [filtered, valuations],
  );

  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const screenHorizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  // FlashList recycles cells but does not auto-stretch row width; we
  // give every row + header an explicit numeric width so the inner
  // flex layout (icon + token info + value column) actually expands
  // instead of collapsing to the icon's intrinsic size.
  const rowFrameWidth = Math.max(
    0,
    Math.min(HOLDINGS_CONTENT_MAX_WIDTH, windowWidth - screenHorizontalPadding * 2),
  );

  const emptyTitle = balanceQuery.isCapabilityEnabled
    ? balanceQuery.isError
      ? 'Unable to load holdings'
      : 'No tokens found'
    : balanceQuery.isCapabilitiesPending
      ? 'No tokens found'
      : 'Holdings unavailable';
  const balanceErrorMessage = getQueryErrorMessage(
    balanceQuery.error,
    'Unable to load wallet balance.',
  );
  const emptySubtitle = balanceQuery.isCapabilityEnabled
    ? balanceQuery.isError
      ? balanceErrorMessage
      : undefined
    : balanceQuery.isCapabilitiesPending
      ? undefined
      : balanceQuery.capability.message;

  const handleTokenPress = useCallback(
    (holding: TokenHolding): void => {
      router.navigate({
        pathname: '/token-details',
        params: buildTokenDetailsRouteParams(holding),
      } as never);
    },
    [router],
  );

  const handleBackHome = useCallback((): void => {
    router.back();
  }, [router]);

  const hiddenSpamTokenCount = countSpamTokens(balanceQuery.data);
  const valuationValuesLoading =
    rowItems.length > 0 && hasPositiveHoldings && !portfolioValuationDisplayReady;
  const showLoadingPlaceholder = balanceQuery.isLoading && rowItems.length === 0;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RowItem>) => (
      <View style={[styles.rowCardShell, { width: rowFrameWidth }]}>
        <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.cardSurface]}>
          <TokenRow
            holding={item.holding}
            isLast
            compact={compact}
            dense={dense}
            onPress={handleTokenPress}
            privacyHidden={false}
            valuation={item.valuation}
            valuationLoading={valuationValuesLoading}
            currency={currency}
            visible={visibleMints.has(item.holding.mint)}
          />
        </View>
      </View>
    ),
    [
      compact,
      currency,
      dense,
      handleTokenPress,
      rowFrameWidth,
      valuationValuesLoading,
      visibleMints,
    ],
  );

  const keyExtractor = useCallback((item: RowItem) => item.holding.mint, []);

  const ListHeader = useMemo(
    () => (
      <View style={[styles.headerWrap, { width: rowFrameWidth }]}>
        <HoldingsSearchBar value={query} onChange={setQuery} />
        {hiddenSpamTokenCount > 0 ? (
          <Text variant="small" color={colors.text.tertiary} style={styles.spamNotice}>
            {hiddenSpamTokenCount} spam token{hiddenSpamTokenCount === 1 ? '' : 's'} hidden
          </Text>
        ) : null}
      </View>
    ),
    [hiddenSpamTokenCount, query, rowFrameWidth],
  );

  const ListEmpty = useMemo(() => {
    if (showLoadingPlaceholder) {
      return (
        <View style={{ width: rowFrameWidth, alignSelf: 'center' }}>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
            <View
              style={[styles.rowCardShell, { width: rowFrameWidth }]}
              key={`token-skeleton-${index}`}
            >
              <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.cardSurface]}>
                <TokenRowSkeleton compact={compact} dense={dense} isLast />
              </View>
            </View>
          ))}
        </View>
      );
    }

    return (
      <View style={[styles.rowCardShell, { width: rowFrameWidth }]}>
        <View
          style={[
            { backgroundColor: colors.surface.cardElevated },
            [styles.cardSurface, styles.emptyState],
          ]}
        >
          <Ionicons
            name="wallet-outline"
            size={dense ? 26 : compact ? 28 : 32}
            color={colors.text.tertiary}
          />
          <Text variant="caption" color={colors.text.secondary} style={styles.emptyText}>
            {emptyTitle}
          </Text>
          {emptySubtitle != null ? (
            <Text variant="small" color={colors.text.tertiary} style={styles.emptySubtext}>
              {emptySubtitle}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }, [compact, dense, emptySubtitle, emptyTitle, rowFrameWidth, showLoadingPlaceholder]);

  useEffect(() => {
    if (publicKey == null || network == null || isNetworkAccessSuspended) {
      return;
    }

    const hydrationKey = `${network}:${publicKey}`;
    if (hydratedKeyRef.current === hydrationKey) {
      return;
    }

    hydratedKeyRef.current = hydrationKey;
    scheduledHydrationRef.current?.cancel();
    scheduledHydrationRef.current = scheduleUiWorkAfterFirstPaint(
      () => {
        void hydrateWalletDisplayCacheIntoQueryClient({
          queryClient,
          walletAddress: publicKey,
          network,
          options: {
            includeBalance: !canUseNetwork,
          },
        }).catch(() => false);
      },
      {
        timeoutMs: 3500,
        fallbackDelayMs: 700,
      },
    );

    return () => {
      scheduledHydrationRef.current?.cancel();
      scheduledHydrationRef.current = null;
      if (hydratedKeyRef.current === hydrationKey) {
        hydratedKeyRef.current = null;
      }
    };
  }, [canUseNetwork, network, isNetworkAccessSuspended, publicKey, queryClient]);

  return (
    <View style={[styles.container, { paddingTop }]}>
      <View style={[styles.inner, { paddingHorizontal: screenHorizontalPadding }]}>
        <View style={[styles.headerFrame, { width: rowFrameWidth }]}>
          <HoldingsHeader onBack={handleBackHome} />
        </View>

        {/* `FlashList` recycles row views as the user scrolls, so the
            allocation cost is bounded by visible rows rather than the
            full holdings array. The list owns its own scroll surface
            and replaces the prior <ScrollView> + .map combo. */}
        <StaggerRevealItem index={0} style={styles.listReveal}>
          <FlashList<RowItem>
            data={rowItems}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            ListHeaderComponent={ListHeader}
            ListEmptyComponent={ListEmpty}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            drawDistance={400}
          />
        </StaggerRevealItem>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  headerFrame: {
    alignSelf: 'center',
    paddingBottom: spacing.sm,
  },
  headerWrap: {
    alignSelf: 'center',
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  listContent: {
    paddingBottom: spacing['4xl'],
  },
  listReveal: {
    flex: 1,
  },
  rowCardShell: {
    alignSelf: 'center',
    marginVertical: spacing.xs,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
  },
  cardSurface: {
    width: '100%',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing['2xl'],
  },
  emptyText: {
    textAlign: 'center',
  },
  emptySubtext: {
    textAlign: 'center',
  },
  spamNotice: {
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
});
