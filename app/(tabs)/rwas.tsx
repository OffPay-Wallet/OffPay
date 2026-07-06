import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  RwaSwapReviewScreen,
  type RwaSwapReviewScreenDetailRow,
  type RwaSwapReviewScreenPhase,
  type RwaSwapReviewScreenSide,
  type RwaSwapReviewScreenTokenLeg,
} from '@/components/features/rwa/RwaSwapReviewScreen';
import { RwaTradeAmountSheet } from '@/components/features/rwa/RwaTradeAmountSheet';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useActiveWalletSigningCapability } from '@/hooks/useActiveWalletSigningCapability';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardBaseQueryKey,
  offpayWalletTokenTransactionsBaseQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import { formatTokenBalance } from '@/lib/api/offpay-wallet-data';
import { createRwaQuote, executeRwaQuote, getRwaAssets } from '@/lib/api/offpay-api-client';
import {
  signSerializedTransactionForWallet,
  signSerializedTransactionsForWallet,
} from '@/lib/crypto/solana-transaction-signing';
import { presentWalletTransactionNotification } from '@/lib/notifications/local-notifications';
import { getRwaDevnetSandboxFundingRequirement } from '@/lib/rwa/devnet-sandbox-funding';
import { TAB_ROUTE_HREFS, useTabHistoryStore } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  OffpayNetwork,
  RwaAsset,
  RwaExecuteResponse,
  RwaQuoteResponse,
} from '@/types/offpay-api';

const RWA_ASSETS_STALE_TIME_MS = 20 * 1000;
const RWA_ASSETS_REFETCH_INTERVAL_MS = 30 * 1000;
const RWA_ASSETS_GC_TIME_MS = 15 * 60 * 1000;
const RWA_CONTENT_MAX_WIDTH = 560;
const RWA_CASH_AMOUNT_MAX_LENGTH = 48;
const RWA_CASH_AMOUNT_DECIMALS = 12;
const RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL = 'RWAUSDC';
const XSTOCKS_LOGO_BASE_URL = 'https://xstocks-metadata.backed.fi/logos/tokens';
const RWA_ACTION_PRESS_SPRING = {
  damping: 18,
  mass: 0.55,
  stiffness: 360,
} as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type RwaTradeSide = 'buy' | 'sell';

const RWA_ACTION_BUTTON_TONES: Record<
  RwaTradeSide,
  {
    background: string;
    backgroundPressed: string;
    border: string;
    borderPressed: string;
  }
> = {
  buy: {
    background: colors.semantic.receiveSoftFill,
    backgroundPressed: colors.semantic.receiveSoftFillPressed,
    border: colors.semantic.receiveSoftBorder,
    borderPressed: colors.semantic.receive,
  },
  sell: {
    background: colors.semantic.errorSoftFill,
    backgroundPressed: colors.semantic.errorSoftFillPressed,
    border: colors.semantic.errorSoftBorder,
    borderPressed: colors.semantic.error,
  },
};

const RWA_CATEGORY_LABELS: Record<RwaAsset['category'], string> = {
  equity: 'Equity',
  etf: 'ETF',
  treasury: 'Treasury',
  commodity: 'Commodity',
  unknown: 'RWA',
};

function formatUsd(value: number | null): string {
  if (value == null) return 'Price unavailable';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 2 : 4,
  }).format(value);
}

function formatRwaAssetDisplayName(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'name' | 'symbol'>,
): string {
  if (!asset.devnetSandbox) return asset.name;
  const cleaned = asset.name
    .replace(/\s+Sandbox(?:\s+RWA)?$/i, '')
    .replace(/\s+RWA$/i, '')
    .trim();
  return cleaned.length > 0 ? cleaned : asset.symbol;
}

function getRwaSettlementDisplaySymbol(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'settlementSymbol'>,
): string {
  return asset.devnetSandbox ? RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL : asset.settlementSymbol;
}

function normalizeXStocksLogoBaseSymbol(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .replace(/[^A-Za-z0-9.]/g, '')
    .toUpperCase();
  return normalized != null && normalized.length > 0 ? normalized : null;
}

function getXStocksLogoUri(baseSymbol: string | null | undefined): string | null {
  const normalized = normalizeXStocksLogoBaseSymbol(baseSymbol);
  return normalized == null ? null : `${XSTOCKS_LOGO_BASE_URL}/${normalized}x.png`;
}

function getRwaAssetLogoUri(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'logo' | 'symbol' | 'underlyingSymbol'>,
): string | null {
  const explicitLogo = asset.logo?.trim();
  if (explicitLogo != null && explicitLogo.length > 0) return explicitLogo;

  if (asset.underlyingSymbol != null) return getXStocksLogoUri(asset.underlyingSymbol);
  if (!asset.devnetSandbox && /x$/i.test(asset.symbol)) {
    return getXStocksLogoUri(asset.symbol.replace(/x$/i, ''));
  }
  return null;
}

function hasPositiveDecimalAmount(value: string | null | undefined): boolean {
  if (value == null || value.trim().length === 0) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function findWalletTokenBalance(
  balance: ReturnType<typeof useOffpayWalletBalance>['data'],
  mint: string | null | undefined,
): string | null {
  if (balance == null || mint == null || mint.trim().length === 0) return null;
  const token = balance.tokens.find((entry) => !entry.spam && entry.mint === mint);
  return hasPositiveDecimalAmount(token?.balance) ? token!.balance : null;
}

function findWalletTokenHolding(
  balance: ReturnType<typeof useOffpayWalletBalance>['data'],
  mint: string | null | undefined,
): string | null {
  if (balance == null || mint == null || mint.trim().length === 0) return null;
  const token = balance.tokens.find((entry) => !entry.spam && entry.mint === mint);
  return token?.balance ?? '0';
}

function rwaAssetsQueryKey(network: string | null) {
  return ['offpay', 'rwa', 'assets', network] as const;
}

interface ParsedRwaCashAmount {
  amount: string | null;
  message: string | null;
}

interface RwaQuoteMutationInput {
  asset: RwaAsset;
  side: RwaTradeSide;
  inputAmount: string;
  network: OffpayNetwork;
  walletAddress: string;
  walletId: string | null;
}

interface RwaQuoteReviewState {
  asset: RwaAsset;
  side: RwaTradeSide;
  inputAmount: string;
  quote: RwaQuoteResponse;
  network: OffpayNetwork;
  walletAddress: string;
  walletId: string | null;
}

interface RwaTradeDraftState {
  assetId: string;
  side: RwaTradeSide;
  amountInput: string;
}

interface RwaExecuteMutationInput {
  review: RwaQuoteReviewState;
}

interface RwaBuyExecutionResult {
  review: RwaQuoteReviewState;
  execution: RwaExecuteResponse;
}

interface RwaProcessResultState {
  variant: Extract<RwaSwapReviewScreenPhase, 'success' | 'error'>;
  tokenLegs: RwaSwapReviewScreenTokenLeg[];
  detailRows: RwaSwapReviewScreenDetailRow[];
}

function sanitizeTradeAmountInput(value: string): string {
  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [whole = '', ...fractionParts] = normalized.split('.');
  const fraction = fractionParts.join('').slice(0, RWA_CASH_AMOUNT_DECIMALS);
  const candidate = fractionParts.length > 0 ? `${whole}.${fraction}` : whole;
  return candidate.slice(0, RWA_CASH_AMOUNT_MAX_LENGTH);
}

function parseRwaTradeAmount(input: string, label: string): ParsedRwaCashAmount {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { amount: null, message: null };
  if (trimmed.length > RWA_CASH_AMOUNT_MAX_LENGTH) {
    return { amount: null, message: 'Amount is too long.' };
  }
  if (!/^\d+(?:\.\d{1,12})?$/.test(trimmed)) {
    return { amount: null, message: `Enter a positive ${label}.` };
  }

  const [whole, fraction] = trimmed.split('.');
  const nonZeroWhole = whole.replace(/^0+/, '');
  const hasNonZeroFraction = fraction != null && /[1-9]/.test(fraction);
  if (nonZeroWhole.length === 0 && !hasNonZeroFraction) {
    return { amount: null, message: `Enter a positive ${label}.` };
  }

  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  return {
    amount: fraction == null ? normalizedWhole : `${normalizedWhole}.${fraction}`,
    message: null,
  };
}

function getRwaErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    if (/transaction simulation failed/i.test(error.message)) {
      return 'RWA settlement simulation failed. Refresh the quote and make sure this Devnet wallet has RWAUSDC for buys or the selected sandbox asset for sells.';
    }

    return error.message;
  }
  return 'RWA swap failed.';
}

function formatRwaDevnetSandboxBalanceError(
  side: RwaTradeSide,
  requirement: NonNullable<ReturnType<typeof getRwaDevnetSandboxFundingRequirement>>,
): string {
  if (side === 'buy' && requirement.symbol === RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL) {
    return `This Devnet buy needs ${requirement.amount} ${RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL}; wallet has ${requirement.balanceAmount}. Tap the gift faucet on Home to add ${RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL}, then retry.`;
  }

  return `This Devnet sell needs ${requirement.amount} ${requirement.symbol}; wallet has ${requirement.balanceAmount}. Buy ${requirement.symbol} first or reduce the sell amount.`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
    minimumFractionDigits: 0,
  })}%`;
}

function formatQuoteExpiry(expiresAt: number | null): string {
  if (expiresAt == null) return 'Provider managed';
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isRwaQuoteStale(quote: RwaQuoteResponse): boolean {
  return quote.expiresAt != null && quote.expiresAt <= Date.now() + 2500;
}

function buildRwaReviewTokenLegs(review: RwaQuoteReviewState): {
  payLeg: RwaSwapReviewScreenTokenLeg;
  receiveLeg: RwaSwapReviewScreenTokenLeg;
} {
  const payAmount =
    review.side === 'buy'
      ? (review.quote.cashAmount ?? review.inputAmount)
      : (review.quote.quantity ?? review.inputAmount);
  const paySymbol =
    review.side === 'buy' ? getRwaSettlementDisplaySymbol(review.asset) : review.asset.symbol;
  const receiveAmount =
    review.side === 'buy' ? (review.quote.quantity ?? '—') : (review.quote.cashAmount ?? '—');
  const receiveSymbol =
    review.side === 'buy' ? review.asset.symbol : getRwaSettlementDisplaySymbol(review.asset);
  const assetName = formatRwaAssetDisplayName(review.asset);
  const assetLogo = getRwaAssetLogoUri(review.asset);

  return {
    payLeg: {
      label: 'You pay',
      amount: payAmount,
      symbol: paySymbol,
      name: review.side === 'buy' ? paySymbol : assetName,
      logo: review.side === 'buy' ? null : assetLogo,
    },
    receiveLeg: {
      label: 'You receive',
      amount: receiveAmount,
      symbol: receiveSymbol,
      name: review.side === 'buy' ? assetName : receiveSymbol,
      logo: review.side === 'buy' ? assetLogo : null,
    },
  };
}

function buildRwaReviewDetailRows(review: RwaQuoteReviewState): RwaSwapReviewScreenDetailRow[] {
  return [
    { label: 'Route', value: review.quote.routeSummary },
    { label: 'Impact', value: formatPercent(review.quote.priceImpactPct) },
    {
      label: 'Expires',
      value: formatQuoteExpiry(review.quote.expiresAt),
      expiresAt: review.quote.expiresAt,
    },
  ];
}

function buildRwaProcessResult({
  review,
  variant,
  extraRows = [],
}: {
  review: RwaQuoteReviewState;
  variant: Extract<RwaSwapReviewScreenPhase, 'success' | 'error'>;
  extraRows?: RwaSwapReviewScreenDetailRow[];
}): RwaProcessResultState {
  const legs = buildRwaReviewTokenLegs(review);
  const paidLabel = variant === 'success' ? 'Paid' : 'You pay';
  const receivedLabel = variant === 'success' ? 'Received' : 'You receive';

  return {
    variant,
    tokenLegs: [
      { ...legs.payLeg, label: paidLabel },
      { ...legs.receiveLeg, label: receivedLabel },
    ],
    detailRows: [
      { label: 'Route', value: review.quote.routeSummary },
      { label: 'Impact', value: formatPercent(review.quote.priceImpactPct) },
      ...extraRows,
    ],
  };
}

function RwaTradeActionButton({
  side,
  active,
  disabled,
  pending,
  label,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: {
  side: RwaTradeSide;
  active: boolean;
  disabled: boolean;
  pending: boolean;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
}): React.JSX.Element {
  const pressProgress = useSharedValue(0);
  const tone = RWA_ACTION_BUTTON_TONES[side];

  const releasePress = useCallback((): void => {
    pressProgress.value = withSpring(0, RWA_ACTION_PRESS_SPRING);
  }, [pressProgress]);

  const handlePressIn = useCallback((): void => {
    if (!disabled && active) {
      pressProgress.value = withSpring(1, RWA_ACTION_PRESS_SPRING);
    }
  }, [active, disabled, pressProgress]);

  const handlePressOut = useCallback((): void => {
    releasePress();
  }, [releasePress]);

  const handleResponderTerminate = useCallback((): void => {
    releasePress();
  }, [releasePress]);

  useEffect(() => {
    if (disabled || !active) releasePress();
  }, [active, disabled, releasePress]);

  const animatedButtonStyle = useAnimatedStyle(() => {
    const progress = active ? pressProgress.value : 0;

    return {
      backgroundColor: interpolateColor(
        progress,
        [0, 1],
        [tone.background, tone.backgroundPressed],
      ),
      borderColor: interpolateColor(progress, [0, 1], [tone.border, tone.borderPressed]),
      transform: [{ translateY: progress }, { scale: 1 - progress * 0.012 }],
    };
  }, [active, tone.background, tone.backgroundPressed, tone.border, tone.borderPressed]);

  const foregroundColor = active ? colors.text.primary : colors.text.tertiary;

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onResponderTerminate={handleResponderTerminate}
      onResponderTerminationRequest={() => true}
      unstable_pressDelay={0}
      style={[styles.actionButton, active ? animatedButtonStyle : styles.actionButtonDisabled]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {pending ? <ActivityIndicator size="small" color={foregroundColor} /> : null}
      <Text variant="caption" color={foregroundColor} style={styles.actionLabel}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

function RwaAssetRow({
  asset,
  dense,
  buyDisabledReason,
  sellDisabledReason,
  isBuyPending,
  isSellPending,
  onBuy,
  onSell,
}: {
  asset: RwaAsset;
  dense: boolean;
  buyDisabledReason: string | null;
  sellDisabledReason: string | null;
  isBuyPending: boolean;
  isSellPending: boolean;
  onBuy: (asset: RwaAsset) => void;
  onSell: (asset: RwaAsset) => void;
}): React.JSX.Element {
  const canBuy = buyDisabledReason == null && !isBuyPending;
  const canSell = sellDisabledReason == null && !isSellPending;
  const showActiveBuyButton = canBuy || isBuyPending;
  const showActiveSellButton = canSell || isSellPending;

  return (
    <View style={[styles.assetCard, dense && styles.assetCardDense]}>
      <View style={styles.assetHeader}>
        <View style={styles.assetIdentity}>
          <View style={styles.assetLogoFrame}>
            <TokenIcon
              symbol={asset.underlyingSymbol ?? asset.symbol}
              name={asset.name}
              logoUri={getRwaAssetLogoUri(asset)}
              size={dense ? 42 : 48}
              recyclingKey={asset.mint}
            />
          </View>
          <View style={styles.assetNameBlock}>
            <Text
              variant="body"
              color={colors.text.primary}
              style={styles.assetName}
              numberOfLines={1}
            >
              {formatRwaAssetDisplayName(asset)}
            </Text>
            <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
              {RWA_CATEGORY_LABELS[asset.category]} · {asset.underlyingSymbol ?? asset.symbol}
            </Text>
          </View>
        </View>
        <View style={styles.priceBlock}>
          <Text variant="body" color={colors.text.primary} style={styles.priceText}>
            {formatUsd(asset.priceUsd)}
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <RwaTradeActionButton
          side="buy"
          active={showActiveBuyButton}
          disabled={!canBuy}
          pending={isBuyPending}
          label={isBuyPending ? 'Quoting' : 'Buy'}
          accessibilityLabel={`Buy ${asset.symbol}`}
          accessibilityHint={buyDisabledReason ?? undefined}
          onPress={() => onBuy(asset)}
        />
        <RwaTradeActionButton
          side="sell"
          active={showActiveSellButton}
          disabled={!canSell}
          pending={isSellPending}
          label={isSellPending ? 'Quoting' : 'Sell'}
          accessibilityLabel={`Sell ${asset.symbol}`}
          accessibilityHint={sellDisabledReason ?? undefined}
          onPress={() => onSell(asset)}
        />
      </View>
    </View>
  );
}

export default function RwasScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useAppToast();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.xl;
  const { network } = useOffpayNetwork();
  const previousRoute = useTabHistoryStore((state) => state.previousRoute);
  const { canUseNetwork, isNetworkSwitching } = useOffpayNetworkAccess();
  const activeWalletId = useWalletStore((state) => state.activeWalletId);
  const { walletAddress, canSignWithApp, signingBlocker } = useActiveWalletSigningCapability();
  const [assetSearchInput, setAssetSearchInput] = useState('');
  const [tradeDraft, setTradeDraft] = useState<RwaTradeDraftState | null>(null);
  const [reviewQuote, setReviewQuote] = useState<RwaQuoteReviewState | null>(null);
  const [processResult, setProcessResult] = useState<RwaProcessResultState | null>(null);
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const capabilities = capabilitiesQuery.capabilities;
  const assetsCapability = getOffpayFeatureCapability(capabilities, 'rwa.assets');
  const quoteCapability = getOffpayFeatureCapability(capabilities, 'rwa.quote');
  const executeCapability = getOffpayFeatureCapability(capabilities, 'rwa.execute');
  const canLoadAssets =
    network != null && canUseNetwork && isOffpayFeatureAvailable(capabilities, 'rwa.assets');
  const draftTradeAmountLabel = tradeDraft?.side === 'sell' ? 'quantity' : 'USDC amount';
  const draftAmountState = useMemo(
    () => parseRwaTradeAmount(tradeDraft?.amountInput ?? '', draftTradeAmountLabel),
    [draftTradeAmountLabel, tradeDraft?.amountInput],
  );
  const walletBalanceQuery = useOffpayWalletBalance(walletAddress, {
    eagerWithoutCapabilities: true,
    enabled: walletAddress != null && network === 'devnet' && canUseNetwork,
    requestOwner: 'rwa.wallet.balance',
    waitForDashboard: false,
  });
  const walletBalanceData = walletBalanceQuery.data;
  const refetchWalletBalance = walletBalanceQuery.refetch;

  const handleBack = useCallback((): void => {
    const target =
      previousRoute !== 'rwas' && previousRoute !== 'scanner'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  }, [previousRoute, router]);

  const invalidateWalletData = useCallback(
    async (address: string, invalidationNetwork: OffpayNetwork): Promise<void> => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: offpayWalletDashboardBaseQueryKey(address, invalidationNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletBalanceQueryKey(address, invalidationNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTransactionsBaseQueryKey(address, invalidationNetwork),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTokenTransactionsBaseQueryKey(address, invalidationNetwork),
        }),
      ]);
    },
    [queryClient],
  );

  const assertDevnetSandboxFunding = useCallback(
    async (review: RwaQuoteReviewState): Promise<void> => {
      const getRequirement = (walletBalance = walletBalanceData ?? null) =>
        getRwaDevnetSandboxFundingRequirement({
          asset: review.asset,
          inputAmount: review.inputAmount,
          network: review.network,
          quote: review.quote,
          side: review.side,
          walletBalance,
        });

      let requirement = getRequirement();
      if (requirement == null || requirement.hasEnough) return;

      const refreshedBalance = await refetchWalletBalance();
      requirement = getRequirement(refreshedBalance.data ?? walletBalanceData ?? null);
      if (requirement == null || requirement.hasEnough) return;

      throw new Error(formatRwaDevnetSandboxBalanceError(review.side, requirement));
    },
    [refetchWalletBalance, walletBalanceData],
  );

  const assetsQuery = useQuery({
    queryKey: rwaAssetsQueryKey(network),
    queryFn: ({ signal }) => {
      if (network == null) {
        throw new Error('RWA assets require a supported OffPay network.');
      }

      return getRwaAssets(network, {
        signal,
        requestOwner: 'rwa.assets',
      });
    },
    enabled: canLoadAssets,
    staleTime: RWA_ASSETS_STALE_TIME_MS,
    gcTime: RWA_ASSETS_GC_TIME_MS,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: canLoadAssets ? RWA_ASSETS_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const refetchRwaAssets = assetsQuery.refetch;

  useFocusEffect(
    useCallback(() => {
      if (!canLoadAssets) return;
      void refetchRwaAssets();
    }, [canLoadAssets, refetchRwaAssets]),
  );

  const rwaQuoteMutation = useMutation<RwaQuoteReviewState, unknown, RwaQuoteMutationInput>({
    mutationFn: async ({
      asset,
      side,
      inputAmount,
      network: quoteNetwork,
      walletAddress,
      walletId,
    }) => {
      const quote = await createRwaQuote({
        assetMint: asset.mint,
        cashAmount: side === 'buy' ? inputAmount : undefined,
        quantity: side === 'sell' ? inputAmount : undefined,
        side,
        network: quoteNetwork,
      });
      if (quote.unsignedTransaction.trim().length === 0) {
        throw new Error('RWA quote expired before signing.');
      }

      return {
        asset,
        side,
        inputAmount,
        quote,
        network: quoteNetwork,
        walletAddress,
        walletId,
      };
    },
    onSuccess: (review) => {
      setReviewQuote(review);
    },
    onError: (error) => {
      const message = getRwaErrorMessage(error);
      showToast({
        title: 'RWA quote failed',
        message,
        variant: 'error',
      });
    },
  });

  const rwaExecuteMutation = useMutation<RwaBuyExecutionResult, unknown, RwaExecuteMutationInput>({
    mutationFn: async ({ review }) => {
      await assertDevnetSandboxFunding(review);
      const unsignedTransactions = review.quote.unsignedTransactions;
      if (
        review.network === 'devnet' &&
        unsignedTransactions != null &&
        unsignedTransactions.length > 0
      ) {
        const signedTransactions = await signSerializedTransactionsForWallet({
          unsignedTransactions: unsignedTransactions.map((step) => step.unsignedTransaction),
          walletAddress: review.walletAddress,
          walletId: review.walletId,
        });
        if (signedTransactions.length !== unsignedTransactions.length) {
          throw new Error(
            'RWA wallet signing returned an incomplete MagicBlock transaction sequence.',
          );
        }

        const execution = await executeRwaQuote({
          quoteId: review.quote.quoteId,
          signedTransaction: signedTransactions[0] ?? '',
          signedTransactions: unsignedTransactions.map((step, index) => {
            const signedTransaction = signedTransactions[index];
            if (signedTransaction == null) {
              throw new Error(
                'RWA wallet signing returned an incomplete MagicBlock transaction sequence.',
              );
            }
            return {
              id: step.id,
              target: step.target,
              signedTransaction,
            };
          }),
          network: review.network,
        });

        return {
          review,
          execution,
        };
      }

      const signedTransaction = await signSerializedTransactionForWallet({
        unsignedTransaction: review.quote.unsignedTransaction,
        walletAddress: review.walletAddress,
        walletId: review.walletId,
      });
      const execution = await executeRwaQuote({
        quoteId: review.quote.quoteId,
        signedTransaction,
        network: review.network,
      });

      return {
        review,
        execution,
      };
    },
    onSuccess: async ({ review, execution }) => {
      const { asset, side, inputAmount, quote } = review;
      const summaryAmount =
        side === 'buy' ? (quote.cashAmount ?? inputAmount) : (quote.quantity ?? inputAmount);
      const summarySymbol = side === 'buy' ? getRwaSettlementDisplaySymbol(asset) : asset.symbol;
      setReviewQuote(null);
      setTradeDraft(null);
      setProcessResult(
        buildRwaProcessResult({
          review,
          variant: 'success',
        }),
      );
      showToast({
        title: 'RWA swap submitted',
        message: `${asset.symbol} ${side} submitted for ${summaryAmount} ${summarySymbol}.`,
        variant: 'success',
      });
      void presentWalletTransactionNotification({
        identifier: `rwa-${side}-${review.network}-${execution.signature}`,
        title: `${side === 'buy' ? 'Bought' : 'Sold'} ${asset.symbol}`,
        body: `${summaryAmount} ${summarySymbol}`,
        type: 'swap',
        signature: execution.signature,
      });

      await invalidateWalletData(review.walletAddress, review.network);
    },
    onError: (error, variables) => {
      const message = getRwaErrorMessage(error);
      setReviewQuote(null);
      setProcessResult(
        buildRwaProcessResult({
          review: variables.review,
          variant: 'error',
          extraRows: [{ label: 'Reason', value: message, selectable: true }],
        }),
      );
      showToast({
        title: 'RWA swap failed',
        message,
        variant: 'error',
      });
    },
  });

  const assets = useMemo(() => assetsQuery.data?.assets ?? [], [assetsQuery.data?.assets]);
  const filteredAssets = useMemo(() => {
    const query = assetSearchInput.trim().toLowerCase();
    if (query.length === 0) return assets;

    return assets.filter((asset) => {
      const haystack = [
        asset.symbol,
        asset.name,
        asset.underlyingSymbol,
        asset.mint,
        asset.providerLabel,
      ]
        .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [assetSearchInput, assets]);

  const resolveMaxTradeAmount = useCallback(
    (draft: RwaTradeDraftState | null): { amount: string; symbol: string } | null => {
      const balance = walletBalanceData;
      if (balance == null || draft == null) return null;

      const asset = assets.find((entry) => entry.id === draft.assetId);
      if (asset == null) return null;

      if (draft.side === 'buy') {
        const amount = findWalletTokenBalance(balance, asset.settlementMint);
        if (amount == null) return null;
        return {
          amount,
          symbol: getRwaSettlementDisplaySymbol(asset),
        };
      }

      const amount = findWalletTokenBalance(balance, asset.mint);
      return amount == null
        ? null
        : {
            amount,
            symbol: asset.symbol,
          };
    },
    [assets, walletBalanceData],
  );

  const handleUseMaxAmount = useCallback((): void => {
    const max = resolveMaxTradeAmount(tradeDraft);
    if (max == null) {
      showToast({
        title: 'No balance',
        message:
          tradeDraft?.side === 'buy'
            ? 'No settlement token balance is available for this trade.'
            : 'No visible RWA token balance is available to sell.',
        variant: 'warning',
        persistToNotificationCenter: false,
      });
      return;
    }

    setTradeDraft((current) =>
      current == null ? current : { ...current, amountInput: sanitizeTradeAmountInput(max.amount) },
    );
    showToast({
      title: 'Max selected',
      message: `${max.amount} ${max.symbol}`,
      variant: 'info',
      persistToNotificationCenter: false,
    });
  }, [resolveMaxTradeAmount, showToast, tradeDraft]);

  const getDraftHoldingLabel = useCallback(
    (asset: RwaAsset, side: RwaTradeSide): string | null => {
      const symbol = side === 'buy' ? getRwaSettlementDisplaySymbol(asset) : asset.symbol;
      const mint = side === 'buy' ? asset.settlementMint : asset.mint;
      const holding = findWalletTokenHolding(walletBalanceData, mint);
      return holding == null ? null : `${formatTokenBalance(holding, 6)} ${symbol}`;
    },
    [walletBalanceData],
  );

  const getStartTradeDisabledReason = useCallback(
    (asset: RwaAsset, side: RwaTradeSide): string | null => {
      if (rwaQuoteMutation.isPending || rwaExecuteMutation.isPending) {
        return 'Another RWA swap is in progress.';
      }
      if (reviewQuote != null) return 'Review the current RWA quote first.';
      if (network == null) return 'Select a supported Solana network.';
      if (!canUseNetwork) return 'Network unavailable.';
      if (isNetworkSwitching) return 'Wait for the network switch to finish.';
      if (!quoteCapability.available) return quoteCapability.message;
      if (!executeCapability.available) return executeCapability.message;
      if (walletAddress == null) return 'Unlock wallet.';
      if (!canSignWithApp) return signingBlocker ?? 'Wallet signing unavailable.';
      if (!asset.tradable) return 'This asset is read only from the provider.';
      if (asset.execution[side] !== 'jupiter_swap' && asset.execution[side] !== 'devnet_sandbox') {
        return `RWA ${side} is unavailable for this asset.`;
      }
      return null;
    },
    [
      canSignWithApp,
      canUseNetwork,
      executeCapability.available,
      executeCapability.message,
      isNetworkSwitching,
      network,
      quoteCapability.available,
      quoteCapability.message,
      reviewQuote,
      rwaExecuteMutation.isPending,
      rwaQuoteMutation.isPending,
      signingBlocker,
      walletAddress,
    ],
  );

  const getReviewTradeDisabledReason = useCallback(
    (asset: RwaAsset, side: RwaTradeSide): string | null => {
      const disabledReason = getStartTradeDisabledReason(asset, side);
      if (disabledReason != null) return disabledReason;
      if (tradeDraft == null || tradeDraft.assetId !== asset.id || tradeDraft.side !== side) {
        return side === 'buy' ? 'Enter amount.' : 'Enter quantity.';
      }
      if (draftAmountState.message != null) return draftAmountState.message;
      if (draftAmountState.amount == null) {
        return side === 'buy'
          ? `Enter ${getRwaSettlementDisplaySymbol(asset)} amount.`
          : 'Enter quantity.';
      }
      return null;
    },
    [draftAmountState.amount, draftAmountState.message, getStartTradeDisabledReason, tradeDraft],
  );

  const handleBeginTradeAsset = useCallback(
    (asset: RwaAsset, side: RwaTradeSide) => {
      const disabledReason = getStartTradeDisabledReason(asset, side);
      if (disabledReason != null) {
        showToast({
          title: `${side === 'buy' ? 'Buy' : 'Sell'} unavailable`,
          message: disabledReason,
          variant: 'error',
        });
        return;
      }

      setTradeDraft((current) => ({
        assetId: asset.id,
        side,
        amountInput: current?.assetId === asset.id ? current.amountInput : '',
      }));
    },
    [getStartTradeDisabledReason, showToast],
  );

  const handleReviewTradeAsset = useCallback(
    (asset: RwaAsset, side: RwaTradeSide) => {
      const disabledReason = getReviewTradeDisabledReason(asset, side);
      if (disabledReason != null) {
        showToast({
          title: `${side === 'buy' ? 'Buy' : 'Sell'} unavailable`,
          message: disabledReason,
          variant: 'error',
        });
        return;
      }
      if (network == null || walletAddress == null || draftAmountState.amount == null) return;

      Keyboard.dismiss();
      rwaQuoteMutation.mutate({
        asset,
        side,
        inputAmount: draftAmountState.amount,
        network,
        walletAddress,
        walletId: activeWalletId,
      });
    },
    [
      activeWalletId,
      draftAmountState.amount,
      getReviewTradeDisabledReason,
      network,
      rwaQuoteMutation,
      showToast,
      walletAddress,
    ],
  );

  const handleBuyAsset = useCallback(
    (asset: RwaAsset) => handleBeginTradeAsset(asset, 'buy'),
    [handleBeginTradeAsset],
  );

  const handleSellAsset = useCallback(
    (asset: RwaAsset) => handleBeginTradeAsset(asset, 'sell'),
    [handleBeginTradeAsset],
  );

  const handleDraftAmountChange = useCallback((value: string): void => {
    const sanitized = sanitizeTradeAmountInput(value);
    setTradeDraft((current) =>
      current == null ? current : { ...current, amountInput: sanitized },
    );
  }, []);

  const handleCancelDraft = useCallback((): void => {
    if (rwaQuoteMutation.isPending || rwaExecuteMutation.isPending) return;
    setTradeDraft(null);
  }, [rwaExecuteMutation.isPending, rwaQuoteMutation.isPending]);

  const handleReviewDraft = useCallback((): void => {
    if (tradeDraft == null) return;
    const asset = assets.find((entry) => entry.id === tradeDraft.assetId);
    if (asset == null) return;
    handleReviewTradeAsset(asset, tradeDraft.side);
  }, [assets, handleReviewTradeAsset, tradeDraft]);

  const handleCloseProcessResult = useCallback((): void => {
    setProcessResult(null);
  }, []);

  const reviewLegs = useMemo(
    () => (reviewQuote == null ? null : buildRwaReviewTokenLegs(reviewQuote)),
    [reviewQuote],
  );
  const reviewDetailRows = useMemo(
    () => (reviewQuote == null ? [] : buildRwaReviewDetailRows(reviewQuote)),
    [reviewQuote],
  );
  const rwaSwapReviewPhase = useMemo<RwaSwapReviewScreenPhase | null>(() => {
    if (rwaExecuteMutation.isPending) return 'processing';
    if (processResult != null) return processResult.variant;
    if (reviewQuote != null) return 'review';
    return null;
  }, [processResult, reviewQuote, rwaExecuteMutation.isPending]);
  const rwaSwapReviewTokenLegs = useMemo(() => {
    if (processResult != null) {
      return {
        payLeg: processResult.tokenLegs[0] ?? null,
        receiveLeg: processResult.tokenLegs[1] ?? null,
      };
    }

    return {
      payLeg: reviewLegs?.payLeg ?? null,
      receiveLeg: reviewLegs?.receiveLeg ?? null,
    };
  }, [processResult, reviewLegs]);
  const rwaSwapReviewDetailRows = processResult?.detailRows ?? reviewDetailRows;
  const rwaSwapReviewSide: RwaSwapReviewScreenSide | null =
    reviewQuote?.side ?? rwaExecuteMutation.variables?.review.side ?? null;

  const tradeDraftAsset = useMemo(
    () =>
      tradeDraft == null
        ? null
        : (assets.find((entry) => entry.id === tradeDraft.assetId) ?? null),
    [assets, tradeDraft],
  );
  const tradeAmountSheetVisible =
    tradeDraft != null && tradeDraftAsset != null && rwaSwapReviewPhase == null;
  const tradeDraftPending =
    tradeDraft != null &&
    rwaQuoteMutation.isPending &&
    rwaQuoteMutation.variables?.asset.id === tradeDraft.assetId &&
    rwaQuoteMutation.variables?.side === tradeDraft.side;

  const handleCancelReview = useCallback(() => {
    if (rwaExecuteMutation.isPending) return;
    setReviewQuote(null);
  }, [rwaExecuteMutation.isPending]);

  const handleConfirmReview = useCallback(() => {
    if (reviewQuote == null || rwaExecuteMutation.isPending) return;
    if (isRwaQuoteStale(reviewQuote.quote)) {
      showToast({
        title: 'Quote expired',
        message: 'Request a fresh RWA quote before signing.',
        variant: 'error',
      });
      setReviewQuote(null);
      return;
    }
    showToast({
      title: 'Signing RWA swap',
      message: 'Approve the wallet request to submit the order.',
      variant: 'info',
      persistToNotificationCenter: false,
    });
    rwaExecuteMutation.mutate({ review: reviewQuote });
  }, [reviewQuote, rwaExecuteMutation, showToast]);

  const contentState = useMemo(() => {
    if (capabilitiesQuery.isCapabilitiesPending || assetsQuery.isPending) return 'loading';
    if (assetsQuery.isError) return 'error';
    if (!assetsCapability.available) return 'unavailable';
    if (assets.length === 0) return 'empty';
    return 'ready';
  }, [
    assets.length,
    assetsCapability.available,
    assetsQuery.isError,
    assetsQuery.isPending,
    capabilitiesQuery.isCapabilitiesPending,
  ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: horizontalPadding,
            paddingBottom: bottomPadding,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.screenHeader}>
          <Pressable
            onPress={handleBack}
            hitSlop={6}
            style={({ pressed }) => [
              styles.headerBackButton,
              pressed ? styles.headerBackButtonPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={layout.iconSizeNav} color={colors.text.primary} />
          </Pressable>
          <Text
            variant="h3"
            color={colors.text.primary}
            style={[styles.screenTitle, compact && styles.screenTitleCompact]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1.05}
          >
            RWAs
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {contentState === 'loading' ? (
          <View style={styles.statePanel}>
            <ActivityIndicator color={colors.text.primary} />
            <Text variant="caption" color={colors.text.secondary}>
              Loading RWA assets
            </Text>
          </View>
        ) : null}

        {contentState === 'error' ? (
          <View style={styles.statePanel}>
            <Ionicons name="warning-outline" size={22} color={colors.semantic.error} />
            <Text variant="body" color={colors.text.primary} align="center">
              RWA assets are unavailable
            </Text>
            <Text variant="caption" color={colors.text.secondary} align="center">
              {assetsQuery.error instanceof Error
                ? assetsQuery.error.message
                : 'Try again once the network is available.'}
            </Text>
          </View>
        ) : null}

        {contentState === 'unavailable' ? (
          <View style={styles.statePanel}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.text.secondary} />
            <Text variant="body" color={colors.text.primary} align="center">
              {assetsCapability.message}
            </Text>
          </View>
        ) : null}

        {contentState === 'empty' ? (
          <View style={styles.statePanel}>
            <Ionicons name="albums-outline" size={22} color={colors.text.secondary} />
            <Text variant="body" color={colors.text.primary} align="center">
              No RWA assets on this network
            </Text>
          </View>
        ) : null}

        {contentState === 'ready' ? (
          <View style={styles.assetPickerPanel}>
            <View style={styles.assetSearchShell}>
              <Ionicons name="search-outline" size={18} color={colors.text.tertiary} />
              <TextInput
                value={assetSearchInput}
                onChangeText={setAssetSearchInput}
                placeholder="Search RWAs"
                placeholderTextColor={colors.text.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.assetSearchInput}
                selectionColor={colors.brand.glossAccent}
              />
              {assetSearchInput.trim().length > 0 ? (
                <Pressable
                  onPress={() => setAssetSearchInput('')}
                  style={({ pressed }) => [
                    styles.assetSearchClearButton,
                    pressed ? styles.actionButtonPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Clear RWA asset search"
                >
                  <Ionicons name="close" size={16} color={colors.text.secondary} />
                </Pressable>
              ) : null}
            </View>

            {filteredAssets.length === 0 ? (
              <View style={styles.emptyFilterPanel}>
                <Text variant="caption" color={colors.text.secondary} align="center">
                  No matching RWA assets
                </Text>
              </View>
            ) : (
              <View style={styles.assetList}>
                {filteredAssets.map((asset) => (
                  <RwaAssetRow
                    key={asset.id}
                    asset={asset}
                    dense={dense}
                    buyDisabledReason={getStartTradeDisabledReason(asset, 'buy')}
                    sellDisabledReason={getStartTradeDisabledReason(asset, 'sell')}
                    isBuyPending={
                      (rwaQuoteMutation.isPending &&
                        rwaQuoteMutation.variables?.asset.id === asset.id &&
                        rwaQuoteMutation.variables?.side === 'buy') ||
                      (rwaExecuteMutation.isPending &&
                        rwaExecuteMutation.variables?.review.asset.id === asset.id &&
                        rwaExecuteMutation.variables?.review.side === 'buy')
                    }
                    isSellPending={
                      (rwaQuoteMutation.isPending &&
                        rwaQuoteMutation.variables?.asset.id === asset.id &&
                        rwaQuoteMutation.variables?.side === 'sell') ||
                      (rwaExecuteMutation.isPending &&
                        rwaExecuteMutation.variables?.review.asset.id === asset.id &&
                        rwaExecuteMutation.variables?.review.side === 'sell')
                    }
                    onBuy={handleBuyAsset}
                    onSell={handleSellAsset}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      {tradeDraftAsset != null && tradeDraft != null ? (
        <RwaTradeAmountSheet
          visible={tradeAmountSheetVisible}
          side={tradeDraft.side}
          assetName={formatRwaAssetDisplayName(tradeDraftAsset)}
          assetCategoryLabel={RWA_CATEGORY_LABELS[tradeDraftAsset.category]}
          assetSymbol={tradeDraftAsset.underlyingSymbol ?? tradeDraftAsset.symbol}
          assetLogo={getRwaAssetLogoUri(tradeDraftAsset)}
          assetPriceLabel={formatUsd(tradeDraftAsset.priceUsd)}
          settlementSymbol={getRwaSettlementDisplaySymbol(tradeDraftAsset)}
          amountInput={tradeDraft.amountInput}
          holdingLabel={getDraftHoldingLabel(tradeDraftAsset, tradeDraft.side)}
          message={draftAmountState.message}
          reviewDisabledReason={getReviewTradeDisabledReason(tradeDraftAsset, tradeDraft.side)}
          pending={tradeDraftPending}
          onAmountChange={handleDraftAmountChange}
          onMax={handleUseMaxAmount}
          onCancel={handleCancelDraft}
          onReview={handleReviewDraft}
        />
      ) : null}

      <RwaSwapReviewScreen
        visible={rwaSwapReviewPhase != null}
        phase={rwaSwapReviewPhase ?? 'review'}
        payLeg={rwaSwapReviewTokenLegs.payLeg}
        receiveLeg={rwaSwapReviewTokenLegs.receiveLeg}
        detailRows={rwaSwapReviewDetailRows}
        side={rwaSwapReviewSide}
        canSubmit={reviewQuote != null && !rwaExecuteMutation.isPending}
        onCancel={handleCancelReview}
        onConfirm={handleConfirmReview}
        onDone={handleCloseProcessResult}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: RWA_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  screenHeader: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerBackButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.minTouchTarget / 2,
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 8px 18px rgba(0, 0, 0, 0.36)',
  },
  headerBackButtonPressed: {
    backgroundColor: colors.surface.solidControlPressed,
  },
  screenTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  screenTitleCompact: {
    fontSize: 19,
    lineHeight: 25,
  },
  headerSpacer: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
  },
  statePanel: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetPickerPanel: {
    gap: spacing.md,
  },
  assetSearchShell: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetSearchInput: {
    minWidth: 0,
    flex: 1,
    color: colors.text.primary,
    fontFamily: fontFamily.ui,
    fontSize: 16,
    paddingVertical: 0,
  },
  assetSearchClearButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.glass.smokeWash,
  },
  emptyFilterPanel: {
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetList: {
    gap: spacing.md,
  },
  assetCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  assetCardDense: {
    padding: spacing.md,
  },
  assetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  assetIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  assetLogoFrame: {
    width: 58,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetNameBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  assetName: {
    fontFamily: fontFamily.medium,
  },
  priceBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  priceText: {
    fontFamily: fontFamily.medium,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    minHeight: layout.buttonHeightSm,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionButtonPressed: {
    backgroundColor: colors.surface.glossPressed,
  },
  actionButtonDisabled: {
    backgroundColor: colors.surface.disabled,
    borderColor: colors.glass.rimSubtle,
  },
  actionLabel: {
    fontFamily: fontFamily.medium,
  },
});
