import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { PuffyRwaIcon } from '@/components/ui/icons/PuffyRwaIcon';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useActiveWalletSigningCapability } from '@/hooks/useActiveWalletSigningCapability';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
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
import { signSerializedTransactionForWallet } from '@/lib/crypto/solana-transaction-signing';
import { presentWalletTransactionNotification } from '@/lib/notifications/local-notifications';
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

function rwaAssetsQueryKey(network: string | null) {
  return ['offpay', 'rwa', 'assets', network] as const;
}

interface ParsedRwaCashAmount {
  amount: string | null;
  message: string | null;
}

interface RwaQuoteMutationInput {
  asset: RwaAsset;
  cashAmount: string;
  network: OffpayNetwork;
  walletAddress: string;
  walletId: string | null;
}

interface RwaQuoteReviewState {
  asset: RwaAsset;
  cashAmount: string;
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
  cashAmount: string;
  signature: string;
  submittedAt: number;
}

function sanitizeCashAmountInput(value: string): string {
  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [whole = '', ...fractionParts] = normalized.split('.');
  const fraction = fractionParts.join('').slice(0, RWA_CASH_AMOUNT_DECIMALS);
  const candidate = fractionParts.length > 0 ? `${whole}.${fraction}` : whole;
  return candidate.slice(0, RWA_CASH_AMOUNT_MAX_LENGTH);
}

function parseRwaCashAmount(input: string): ParsedRwaCashAmount {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { amount: null, message: null };
  if (trimmed.length > RWA_CASH_AMOUNT_MAX_LENGTH) {
    return { amount: null, message: 'Amount is too long.' };
  }
  if (!/^\d+(?:\.\d{1,12})?$/.test(trimmed)) {
    return { amount: null, message: 'Enter a positive USDC amount.' };
  }

  const [whole, fraction] = trimmed.split('.');
  const nonZeroWhole = whole.replace(/^0+/, '');
  const hasNonZeroFraction = fraction != null && /[1-9]/.test(fraction);
  if (nonZeroWhole.length === 0 && !hasNonZeroFraction) {
    return { amount: null, message: 'Enter a positive USDC amount.' };
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
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'RWA order failed.';
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

function ReviewDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
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
  const payAmount = review.quote.cashAmount ?? review.cashAmount;
  const receiveAmount = review.quote.quantity ?? '—';

  return (
    <View style={styles.reviewPanel}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewTitleBlock}>
          <Text variant="body" color={colors.text.primary} style={styles.reviewTitle}>
            Review order
          </Text>
          <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
            {review.asset.symbol} · {review.network}
          </Text>
        </View>
        <View style={styles.reviewIcon}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.text.secondary} />
        </View>
      </View>

      <View style={styles.reviewDetailList}>
        <ReviewDetailRow label="Pay" value={`${payAmount} ${review.asset.settlementSymbol}`} />
        <ReviewDetailRow label="Receive" value={`${receiveAmount} ${review.asset.symbol}`} />
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
  isBuyPending,
  lastExecution,
  onBuy,
}: {
  asset: RwaAsset;
  dense: boolean;
  buyDisabledReason: string | null;
  isBuyPending: boolean;
  lastExecution: RwaLastExecution | null;
  onBuy: (asset: RwaAsset) => void;
}): React.JSX.Element {
  const positive = asset.change24hPct == null || asset.change24hPct >= 0;
  const tokenProgramLabel = asset.tokenProgramId?.includes('TokenzQd') ? 'Token-2022' : 'SPL';
  const canBuy = buyDisabledReason == null && !isBuyPending;
  const showActiveBuyButton = canBuy || isBuyPending;

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
              {RWA_CATEGORY_LABELS[asset.category]} · {asset.providerLabel}
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

      <View style={styles.assetMetaRow}>
        <View style={styles.metaPill}>
          <Ionicons name="server-outline" size={14} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            {asset.providerEnvironment}
          </Text>
        </View>
        <View style={styles.metaPill}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            {asset.tradable ? 'Jupiter' : 'Read only'}
          </Text>
        </View>
        {asset.tokenProgramId != null ? (
          <View style={styles.metaPill}>
            <Ionicons name="cube-outline" size={14} color={colors.text.secondary} />
            <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
              {tokenProgramLabel}
            </Text>
          </View>
        ) : null}
        <View style={styles.metaPill}>
          <Ionicons name="logo-usd" size={14} color={colors.text.secondary} />
          <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
            {asset.settlementSymbol}
          </Text>
        </View>
      </View>

      <Text
        variant="caption"
        color={colors.text.tertiary}
        style={styles.complianceText}
        numberOfLines={2}
      >
        {asset.complianceLabel}
      </Text>

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
            {isBuyPending ? 'Quoting' : 'Review'}
          </Text>
        </Pressable>
        <Pressable disabled style={[styles.actionButton, styles.actionButtonDisabled]}>
          <Ionicons name="flash-outline" size={16} color={colors.text.tertiary} />
          <Text variant="caption" color={colors.text.tertiary} style={styles.actionLabel}>
            MagicBlock
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function RwasScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + layout.tabBarHeight + spacing.xl;
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkSwitching } = useOffpayNetworkAccess();
  const activeWalletId = useWalletStore((state) => state.activeWalletId);
  const { walletAddress, canSignWithApp, signingBlocker } = useActiveWalletSigningCapability();
  const [cashAmountInput, setCashAmountInput] = useState('');
  const [lastExecution, setLastExecution] = useState<RwaLastExecution | null>(null);
  const [reviewQuote, setReviewQuote] = useState<RwaQuoteReviewState | null>(null);
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const capabilities = capabilitiesQuery.capabilities;
  const assetsCapability = getOffpayFeatureCapability(capabilities, 'rwa.assets');
  const quoteCapability = getOffpayFeatureCapability(capabilities, 'rwa.quote');
  const executeCapability = getOffpayFeatureCapability(capabilities, 'rwa.execute');
  const canLoadAssets =
    network != null && canUseNetwork && isOffpayFeatureAvailable(capabilities, 'rwa.assets');
  const cashAmountState = useMemo(() => parseRwaCashAmount(cashAmountInput), [cashAmountInput]);

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
    mutationFn: async ({ asset, cashAmount, network: quoteNetwork, walletAddress, walletId }) => {
      const quote = await createRwaQuote({
        assetMint: asset.mint,
        cashAmount,
        side: 'buy',
        network: quoteNetwork,
      });
      if (quote.unsignedTransaction.trim().length === 0) {
        throw new Error('RWA quote expired before signing.');
      }

      return {
        asset,
        cashAmount,
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
      const { asset, cashAmount, quote } = review;
      setLastExecution({
        assetId: asset.id,
        symbol: asset.symbol,
        cashAmount,
        signature: execution.signature,
        submittedAt: execution.submittedAt,
      });
      setReviewQuote(null);
      showToast({
        title: 'RWA order submitted',
        message: `${asset.symbol} buy submitted for ${quote.cashAmount ?? cashAmount} ${asset.settlementSymbol}.`,
        variant: 'success',
      });
      void presentWalletTransactionNotification({
        identifier: `rwa-buy-${review.network}-${execution.signature}`,
        title: `Bought ${asset.symbol}`,
        body: `${quote.cashAmount ?? cashAmount} ${asset.settlementSymbol}`,
        type: 'swap',
        signature: execution.signature,
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: offpayWalletDashboardBaseQueryKey(
            review.walletAddress,
            review.network,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletBalanceQueryKey(review.walletAddress, review.network),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTransactionsBaseQueryKey(
            review.walletAddress,
            review.network,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTokenTransactionsBaseQueryKey(
            review.walletAddress,
            review.network,
          ),
        }),
      ]);
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

  const assets = assetsQuery.data?.assets ?? [];
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
    if (cashAmountState.amount == null) return 'Enter USDC amount';
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
    walletAddress,
  ]);

  const getBuyDisabledReason = useCallback(
    (asset: RwaAsset): string | null => {
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
      if (cashAmountState.amount == null) return 'Enter USDC amount.';
      if (walletAddress == null) return 'Unlock wallet.';
      if (!canSignWithApp) return signingBlocker ?? 'Wallet signing unavailable.';
      if (!asset.tradable) return 'This asset is read only from the provider.';
      if (asset.execution.buy !== 'jupiter_swap') return 'Jupiter RWA buy is unavailable.';
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

  const handleBuyAsset = useCallback(
    (asset: RwaAsset) => {
      const disabledReason = getBuyDisabledReason(asset);
      if (disabledReason != null) {
        showToast({
          title: 'Buy unavailable',
          message: disabledReason,
          variant: 'error',
        });
        return;
      }
      if (network == null || walletAddress == null || cashAmountState.amount == null) return;

      rwaQuoteMutation.mutate({
        asset,
        cashAmount: cashAmountState.amount,
        network,
        walletAddress,
        walletId: activeWalletId,
      });
    },
    [
      activeWalletId,
      cashAmountState.amount,
      getBuyDisabledReason,
      network,
      rwaQuoteMutation,
      showToast,
      walletAddress,
    ],
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

  const statusLabel = useMemo(() => {
    if (isNetworkSwitching) return 'Switching';
    if (!canUseNetwork) return 'Offline';
    if (capabilitiesQuery.isCapabilitiesPending) return 'Loading';
    if (!assetsCapability.available) return assetsCapability.reason === 'unsupported_network'
      ? 'Mainnet only'
      : 'Unavailable';
    return assetsQuery.isPending ? 'Loading' : 'Jupiter stocks';
  }, [
    assetsCapability.available,
    assetsCapability.reason,
    assetsQuery.isPending,
    canUseNetwork,
    capabilitiesQuery.isCapabilitiesPending,
    isNetworkSwitching,
  ]);

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
        <View style={styles.header}>
          <View style={styles.iconShell}>
            <PuffyRwaIcon size={dense ? 34 : 42} color={colors.text.primary} focused />
          </View>
          <View style={styles.headerText}>
            <Text
              variant={compact ? 'h3' : 'h2'}
              color={colors.text.inverse}
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.84}
            >
              RWAs
            </Text>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                {statusLabel}
              </Text>
            </View>
          </View>
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
                RWA buy
              </Text>
              <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
                {tradeStatusMessage}
              </Text>
            </View>
            <View style={styles.amountSymbolPill}>
              <Text variant="caption" color={colors.text.secondary} style={styles.amountSymbol}>
                USDC
              </Text>
            </View>
          </View>
          <TextInput
            value={cashAmountInput}
            onChangeText={(value) => setCashAmountInput(sanitizeCashAmountInput(value))}
            placeholder="0.00"
            placeholderTextColor={colors.text.placeholder}
            keyboardType="decimal-pad"
            inputMode="decimal"
            returnKeyType="done"
            style={styles.amountInput}
            selectionColor={colors.brand.glossAccent}
          />
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
          <View style={styles.assetList}>
            {assets.map((asset) => (
              <RwaAssetRow
                key={asset.id}
                asset={asset}
                dense={dense}
                buyDisabledReason={getBuyDisabledReason(asset)}
                isBuyPending={
                  (rwaQuoteMutation.isPending &&
                    rwaQuoteMutation.variables?.asset.id === asset.id) ||
                  (rwaExecuteMutation.isPending &&
                    rwaExecuteMutation.variables?.review.asset.id === asset.id)
                }
                lastExecution={lastExecution?.assetId === asset.id ? lastExecution : null}
                onBuy={handleBuyAsset}
              />
            ))}
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
    paddingTop: spacing['2xl'],
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconShell: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 34,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamily.display,
  },
  statusPill: {
    alignSelf: 'flex-start',
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.glass.badgeFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.semantic.receive,
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
  amountInput: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.solidControl,
    color: colors.text.primary,
    fontFamily: fontFamily.display,
    fontSize: 28,
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
  assetMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaPill: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.glass.smokeWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
  },
  complianceText: {
    lineHeight: 17,
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
