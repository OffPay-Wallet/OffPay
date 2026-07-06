import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
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

const RWA_ASSETS_STALE_TIME_MS = 5 * 60 * 1000;
const RWA_ASSETS_GC_TIME_MS = 15 * 60 * 1000;
const RWA_CONTENT_MAX_WIDTH = 560;
const RWA_CASH_AMOUNT_MAX_LENGTH = 48;
const RWA_CASH_AMOUNT_DECIMALS = 12;
const RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL = 'RWAUSDC';

type RwaTradeSide = 'buy' | 'sell';

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

function formatChange(value: number | null): string {
  if (value == null) return 'Live provider quote';

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function getRwaSettlementDisplaySymbol(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'settlementSymbol'>,
): string {
  return asset.devnetSandbox ? RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL : asset.settlementSymbol;
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

interface RwaExecuteMutationInput {
  review: RwaQuoteReviewState;
}

interface RwaBuyExecutionResult {
  review: RwaQuoteReviewState;
  execution: RwaExecuteResponse;
}

interface RwaLastExecution {
  assetId: string;
  symbol: string;
  side: RwaTradeSide;
  amount: string;
  signature: string;
  submittedAt: number;
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

function shortenSignature(signature: string): string {
  if (signature.length <= 14) return signature;
  return `${signature.slice(0, 6)}...${signature.slice(-6)}`;
}

function getRwaErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    if (/transaction simulation failed/i.test(error.message)) {
      return 'RWA settlement simulation failed. Refresh the quote and make sure this Devnet wallet has RWAUSDC for buys or the selected sandbox asset for sells.';
    }

    return error.message;
  }
  return 'RWA order failed.';
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

function ReviewDetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.reviewDetailRow}>
      <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
        {label}
      </Text>
      <Text
        variant="caption"
        color={colors.text.secondary}
        style={styles.reviewDetailValue}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function RwaQuoteReviewPanel({
  review,
  busy,
  onCancel,
  onConfirm,
}: {
  review: RwaQuoteReviewState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
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

  return (
    <View style={styles.reviewPanel}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewTitleBlock}>
          <Text variant="body" color={colors.text.primary} style={styles.reviewTitle}>
            Review order
          </Text>
          <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
            {review.side === 'buy' ? 'Buy' : 'Sell'} {review.asset.symbol} · {review.network}
          </Text>
        </View>
        <View style={styles.reviewIcon}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.text.secondary} />
        </View>
      </View>

      <View style={styles.reviewDetailList}>
        <ReviewDetailRow label="Pay" value={`${payAmount} ${paySymbol}`} />
        <ReviewDetailRow label="Receive" value={`${receiveAmount} ${receiveSymbol}`} />
        <ReviewDetailRow label="Route" value={review.quote.routeSummary} />
        <ReviewDetailRow label="Impact" value={formatPercent(review.quote.priceImpactPct)} />
        <ReviewDetailRow label="Expires" value={formatQuoteExpiry(review.quote.expiresAt)} />
      </View>

      <View style={styles.reviewActionRow}>
        <Pressable
          disabled={busy}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.reviewButton,
            styles.reviewButtonSecondary,
            pressed && !busy ? styles.reviewButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Cancel RWA order"
        >
          <Text variant="caption" color={colors.text.secondary} style={styles.actionLabel}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.reviewButton,
            styles.reviewButtonPrimary,
            pressed && !busy ? styles.actionButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Sign ${review.asset.symbol} RWA order`}
        >
          {busy ? <ActivityIndicator size="small" color={colors.text.onAccent} /> : null}
          <Text variant="caption" color={colors.text.onAccent} style={styles.actionLabel}>
            {busy ? 'Signing' : 'Sign'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function RwaAssetRow({
  asset,
  dense,
  buyDisabledReason,
  sellDisabledReason,
  isBuyPending,
  isSellPending,
  lastExecution,
  onBuy,
  onSell,
}: {
  asset: RwaAsset;
  dense: boolean;
  buyDisabledReason: string | null;
  sellDisabledReason: string | null;
  isBuyPending: boolean;
  isSellPending: boolean;
  lastExecution: RwaLastExecution | null;
  onBuy: (asset: RwaAsset) => void;
  onSell: (asset: RwaAsset) => void;
}): React.JSX.Element {
  const positive = asset.change24hPct == null || asset.change24hPct >= 0;
  const routeLabel = asset.devnetSandbox
    ? 'Devnet vault'
    : asset.tradable
      ? 'Jupiter'
      : 'Read only';
  const canBuy = buyDisabledReason == null && !isBuyPending;
  const canSell = sellDisabledReason == null && !isSellPending;
  const showActiveBuyButton = canBuy || isBuyPending;
  const showActiveSellButton = canSell || isSellPending;

  return (
    <View style={[styles.assetCard, dense && styles.assetCardDense]}>
      <View style={styles.assetHeader}>
        <View style={styles.assetIdentity}>
          <View style={styles.symbolBadge}>
            <Text
              variant="caption"
              color={colors.text.onAccent}
              style={styles.symbolText}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {asset.symbol}
            </Text>
          </View>
          <View style={styles.assetNameBlock}>
            <Text
              variant="body"
              color={colors.text.primary}
              style={styles.assetName}
              numberOfLines={1}
            >
              {asset.name}
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
          <Text
            variant="caption"
            color={positive ? colors.semantic.receive : colors.semantic.error}
            style={styles.changeText}
          >
            {formatChange(asset.change24hPct)}
          </Text>
        </View>
      </View>

      <View style={styles.assetInfoRow}>
        <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
          {routeLabel}
        </Text>
        <Text variant="caption" color={colors.text.tertiary}>
          ·
        </Text>
        <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
          {getRwaSettlementDisplaySymbol(asset)}
        </Text>
      </View>

      {lastExecution != null ? (
        <View style={styles.executionPill}>
          <Ionicons name="checkmark-circle-outline" size={15} color={colors.semantic.receive} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            Submitted {shortenSignature(lastExecution.signature)}
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          disabled={!canBuy}
          onPress={() => onBuy(asset)}
          style={({ pressed }) => [
            styles.actionButton,
            showActiveBuyButton ? styles.actionButtonPrimary : styles.actionButtonDisabled,
            pressed && canBuy ? styles.actionButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Buy ${asset.symbol}`}
          accessibilityHint={buyDisabledReason ?? undefined}
        >
          {isBuyPending ? (
            <ActivityIndicator size="small" color={colors.text.onAccent} />
          ) : (
            <Ionicons
              name="swap-horizontal-outline"
              size={16}
              color={showActiveBuyButton ? colors.text.onAccent : colors.text.tertiary}
            />
          )}
          <Text
            variant="caption"
            color={showActiveBuyButton ? colors.text.onAccent : colors.text.tertiary}
            style={styles.actionLabel}
          >
            {isBuyPending ? 'Quoting' : 'Buy'}
          </Text>
        </Pressable>
        <Pressable
          disabled={!canSell}
          onPress={() => onSell(asset)}
          style={({ pressed }) => [
            styles.actionButton,
            showActiveSellButton ? styles.actionButtonSecondary : styles.actionButtonDisabled,
            pressed && canSell ? styles.actionButtonPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Sell ${asset.symbol}`}
          accessibilityHint={sellDisabledReason ?? undefined}
        >
          {isSellPending ? (
            <ActivityIndicator size="small" color={colors.text.secondary} />
          ) : (
            <Ionicons
              name="cash-outline"
              size={16}
              color={showActiveSellButton ? colors.text.secondary : colors.text.tertiary}
            />
          )}
          <Text
            variant="caption"
            color={showActiveSellButton ? colors.text.secondary : colors.text.tertiary}
            style={styles.actionLabel}
          >
            {isSellPending ? 'Quoting' : 'Sell'}
          </Text>
        </Pressable>
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
  const [cashAmountInput, setCashAmountInput] = useState('');
  const [assetSearchInput, setAssetSearchInput] = useState('');
  const [tradeSide, setTradeSide] = useState<RwaTradeSide>('buy');
  const [lastExecution, setLastExecution] = useState<RwaLastExecution | null>(null);
  const [reviewQuote, setReviewQuote] = useState<RwaQuoteReviewState | null>(null);
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const capabilities = capabilitiesQuery.capabilities;
  const assetsCapability = getOffpayFeatureCapability(capabilities, 'rwa.assets');
  const quoteCapability = getOffpayFeatureCapability(capabilities, 'rwa.quote');
  const executeCapability = getOffpayFeatureCapability(capabilities, 'rwa.execute');
  const canLoadAssets =
    network != null && canUseNetwork && isOffpayFeatureAvailable(capabilities, 'rwa.assets');
  const tradeAmountLabel = tradeSide === 'buy' ? 'USDC amount' : 'quantity';
  const cashAmountState = useMemo(
    () => parseRwaTradeAmount(cashAmountInput, tradeAmountLabel),
    [cashAmountInput, tradeAmountLabel],
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
    refetchOnMount: false,
  });

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
      setLastExecution({
        assetId: asset.id,
        symbol: asset.symbol,
        side,
        amount: summaryAmount,
        signature: execution.signature,
        submittedAt: execution.submittedAt,
      });
      setReviewQuote(null);
      showToast({
        title: 'RWA order submitted',
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
    onError: (error) => {
      const message = getRwaErrorMessage(error);
      showToast({
        title: 'RWA order failed',
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

  const resolveMaxTradeAmount = useCallback((): { amount: string; symbol: string } | null => {
    const balance = walletBalanceData;
    if (balance == null) return null;

    if (tradeSide === 'buy') {
      const settlementAsset = assets.find((asset) => asset.tradable) ?? assets[0];
      const amount = findWalletTokenBalance(balance, settlementAsset?.settlementMint);
      if (amount == null || settlementAsset == null) return null;
      return {
        amount,
        symbol: getRwaSettlementDisplaySymbol(settlementAsset),
      };
    }

    const assetWithBalance = filteredAssets.find((asset) =>
      hasPositiveDecimalAmount(findWalletTokenBalance(balance, asset.mint)),
    );
    if (assetWithBalance == null) return null;
    const amount = findWalletTokenBalance(balance, assetWithBalance.mint);
    return amount == null
      ? null
      : {
          amount,
          symbol: assetWithBalance.symbol,
        };
  }, [assets, filteredAssets, tradeSide, walletBalanceData]);

  const handleUseMaxAmount = useCallback((): void => {
    const max = resolveMaxTradeAmount();
    if (max == null) {
      showToast({
        title: 'No balance',
        message:
          tradeSide === 'buy'
            ? 'No settlement token balance is available for this trade.'
            : 'No visible RWA token balance is available to sell.',
        variant: 'warning',
        persistToNotificationCenter: false,
      });
      return;
    }

    setCashAmountInput(sanitizeTradeAmountInput(max.amount));
    showToast({
      title: 'Max selected',
      message: `${max.amount} ${max.symbol}`,
      variant: 'info',
      persistToNotificationCenter: false,
    });
  }, [resolveMaxTradeAmount, showToast, tradeSide]);

  const tradeStatusMessage = useMemo(() => {
    if (isNetworkSwitching) return 'Switching networks';
    if (!canUseNetwork) return 'Network unavailable';
    if (rwaExecuteMutation.isPending) return 'Signing order';
    if (rwaQuoteMutation.isPending) return 'Fetching quote';
    if (reviewQuote != null) return 'Review quote';
    if (capabilitiesQuery.isCapabilitiesPending) return 'Loading trading status';
    if (!quoteCapability.available) return quoteCapability.message;
    if (!executeCapability.available) return executeCapability.message;
    if (cashAmountState.message != null) return cashAmountState.message;
    if (cashAmountState.amount == null) {
      return tradeSide === 'buy' ? 'Enter USDC amount' : 'Enter quantity';
    }
    if (walletAddress == null) return 'Unlock wallet';
    if (!canSignWithApp) return signingBlocker ?? 'Wallet signing unavailable';
    return 'Ready';
  }, [
    canSignWithApp,
    canUseNetwork,
    capabilitiesQuery.isCapabilitiesPending,
    cashAmountState.amount,
    cashAmountState.message,
    executeCapability.available,
    executeCapability.message,
    isNetworkSwitching,
    quoteCapability.available,
    quoteCapability.message,
    reviewQuote,
    rwaExecuteMutation.isPending,
    rwaQuoteMutation.isPending,
    signingBlocker,
    tradeSide,
    walletAddress,
  ]);

  const getTradeDisabledReason = useCallback(
    (asset: RwaAsset, side: RwaTradeSide): string | null => {
      if (rwaQuoteMutation.isPending || rwaExecuteMutation.isPending) {
        return 'Another RWA order is in progress.';
      }
      if (reviewQuote != null) return 'Review the current RWA quote first.';
      if (network == null) return 'Select a supported Solana network.';
      if (!canUseNetwork) return 'Network unavailable.';
      if (isNetworkSwitching) return 'Wait for the network switch to finish.';
      if (!quoteCapability.available) return quoteCapability.message;
      if (!executeCapability.available) return executeCapability.message;
      if (cashAmountState.message != null) return cashAmountState.message;
      if (cashAmountState.amount == null) {
        return side === 'buy' ? 'Enter USDC amount.' : 'Enter quantity.';
      }
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
      cashAmountState.amount,
      cashAmountState.message,
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

  const handleTradeAsset = useCallback(
    (asset: RwaAsset, side: RwaTradeSide) => {
      const disabledReason = getTradeDisabledReason(asset, side);
      if (disabledReason != null) {
        showToast({
          title: `${side === 'buy' ? 'Buy' : 'Sell'} unavailable`,
          message: disabledReason,
          variant: 'error',
        });
        return;
      }
      if (network == null || walletAddress == null || cashAmountState.amount == null) return;

      rwaQuoteMutation.mutate({
        asset,
        side,
        inputAmount: cashAmountState.amount,
        network,
        walletAddress,
        walletId: activeWalletId,
      });
    },
    [
      activeWalletId,
      cashAmountState.amount,
      getTradeDisabledReason,
      network,
      rwaQuoteMutation,
      showToast,
      walletAddress,
    ],
  );

  const handleBuyAsset = useCallback(
    (asset: RwaAsset) => handleTradeAsset(asset, 'buy'),
    [handleTradeAsset],
  );

  const handleSellAsset = useCallback(
    (asset: RwaAsset) => handleTradeAsset(asset, 'sell'),
    [handleTradeAsset],
  );

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

        <View style={styles.tradePanel}>
          <View style={styles.tradePanelHeader}>
            <View style={styles.tradePanelTitleBlock}>
              <Text variant="body" color={colors.text.primary} style={styles.tradePanelTitle}>
                RWA trade
              </Text>
              {tradeStatusMessage !== 'Ready' ? (
                <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
                  {tradeStatusMessage}
                </Text>
              ) : null}
            </View>
            <View style={styles.amountSymbolPill}>
              <Text variant="caption" color={colors.text.secondary} style={styles.amountSymbol}>
                {tradeSide === 'buy'
                  ? assets.some((asset) => asset.devnetSandbox)
                    ? RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL
                    : 'USDC'
                  : 'RWA'}
              </Text>
            </View>
          </View>
          <View style={styles.sideControl}>
            {(['buy', 'sell'] as const).map((side) => {
              const selected = tradeSide === side;
              return (
                <Pressable
                  key={side}
                  onPress={() => setTradeSide(side)}
                  style={({ pressed }) => [
                    styles.sideButton,
                    selected ? styles.sideButtonSelected : styles.sideButtonIdle,
                    pressed ? styles.sideButtonPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${side === 'buy' ? 'Buy' : 'Sell'} RWA`}
                >
                  <Text
                    variant="caption"
                    color={selected ? colors.text.onAccent : colors.text.secondary}
                    style={styles.sideButtonLabel}
                  >
                    {side === 'buy' ? 'Buy' : 'Sell'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.amountInputShell}>
            <TextInput
              value={cashAmountInput}
              onChangeText={(value) => setCashAmountInput(sanitizeTradeAmountInput(value))}
              placeholder="0.00"
              placeholderTextColor={colors.text.placeholder}
              keyboardType="decimal-pad"
              inputMode="decimal"
              returnKeyType="done"
              style={styles.amountInput}
              selectionColor={colors.brand.glossAccent}
            />
            <Pressable
              onPress={handleUseMaxAmount}
              style={({ pressed }) => [styles.maxButton, pressed ? styles.maxButtonPressed : null]}
              accessibilityRole="button"
              accessibilityLabel="Use maximum available RWA trade amount"
            >
              <Text variant="caption" color={colors.text.primary} style={styles.maxButtonLabel}>
                MAX
              </Text>
            </Pressable>
          </View>
        </View>

        {reviewQuote != null ? (
          <RwaQuoteReviewPanel
            review={reviewQuote}
            busy={rwaExecuteMutation.isPending}
            onCancel={handleCancelReview}
            onConfirm={handleConfirmReview}
          />
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
                    buyDisabledReason={getTradeDisabledReason(asset, 'buy')}
                    sellDisabledReason={getTradeDisabledReason(asset, 'sell')}
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
                    lastExecution={lastExecution?.assetId === asset.id ? lastExecution : null}
                    onBuy={handleBuyAsset}
                    onSell={handleSellAsset}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
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
    opacity: 0.72,
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
  tradePanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.clearFill,
  },
  tradePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  tradePanelTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tradePanelTitle: {
    fontFamily: fontFamily.medium,
  },
  amountSymbolPill: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  amountSymbol: {
    fontFamily: fontFamily.mono,
  },
  sideControl: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: 4,
    borderRadius: radii.md,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  sideButton: {
    minHeight: 34,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sideButtonSelected: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.glossAccent,
  },
  sideButtonIdle: {
    backgroundColor: colors.surface.solidControl,
    borderColor: colors.glass.rimSubtle,
  },
  sideButtonPressed: {
    opacity: 0.86,
  },
  sideButtonLabel: {
    fontFamily: fontFamily.medium,
  },
  amountInputShell: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.solidControl,
  },
  amountInput: {
    minWidth: 0,
    flex: 1,
    color: colors.text.primary,
    fontFamily: fontFamily.display,
    fontSize: 28,
    paddingVertical: 0,
  },
  maxButton: {
    minWidth: 58,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  maxButtonPressed: {
    opacity: 0.76,
  },
  maxButtonLabel: {
    fontFamily: fontFamily.medium,
  },
  reviewPanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    backgroundColor: colors.glass.frostFill,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  reviewTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  reviewTitle: {
    fontFamily: fontFamily.medium,
  },
  reviewIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  reviewDetailList: {
    gap: spacing.sm,
  },
  reviewDetailRow: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  reviewDetailValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.medium,
  },
  reviewActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reviewButton: {
    minHeight: layout.buttonHeightSm,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reviewButtonPrimary: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.glossAccent,
  },
  reviewButtonSecondary: {
    backgroundColor: colors.surface.solidControl,
    borderColor: colors.glass.rimSubtle,
  },
  reviewButtonPressed: {
    backgroundColor: colors.surface.solidControlPressed,
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
  symbolBadge: {
    width: 58,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.brand.glossAccent,
  },
  symbolText: {
    fontFamily: fontFamily.mono,
    fontWeight: '800',
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
  changeText: {
    fontFamily: fontFamily.medium,
  },
  assetInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 20,
  },
  executionPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
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
  actionButtonPrimary: {
    backgroundColor: colors.brand.glossAccent,
    borderColor: colors.brand.glossAccent,
  },
  actionButtonSecondary: {
    backgroundColor: colors.glass.smokeWash,
    borderColor: colors.glass.rimSubtle,
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
