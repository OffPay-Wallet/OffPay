import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  RwaAssetCatalog,
  type RwaAssetCatalogContentState,
} from '@/components/features/rwa/RwaAssetCatalog';
import { RwaScreenHeader } from '@/components/features/rwa/RwaScreenHeader';
import {
  RwaSwapReviewScreen,
  type RwaSwapReviewScreenPhase,
  type RwaSwapReviewScreenSide,
} from '@/components/features/rwa/RwaSwapReviewScreen';
import { RwaTradeAmountSheet } from '@/components/features/rwa/RwaTradeAmountSheet';
import {
  buildRwaProcessResult,
  buildRwaReviewDetailRows,
  buildRwaReviewTokenLegs,
  findWalletTokenBalance,
  findWalletTokenHolding,
  formatRwaAssetDisplayName,
  formatUsd,
  getRwaAssetLogoUri,
  getRwaErrorMessage,
  getRwaSettlementDisplaySymbol,
  isRwaQuoteStale,
  parseRwaTradeAmount,
  RWA_CATEGORY_LABELS,
  sanitizeTradeAmountInput,
  type RwaProcessResultState,
  type RwaQuoteReviewState,
  type RwaTradeDraftState,
  type RwaTradeSide,
} from '@/components/features/rwa/rwa-trade-utils';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { useActiveWalletSigningCapability } from '@/hooks/useActiveWalletSigningCapability';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useRwaAssets } from '@/hooks/useRwaAssets';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletDashboardBaseQueryKey,
  offpayWalletTokenTransactionsBaseQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import {
  getOffpayFeatureCapability,
} from '@/lib/api/offpay-capabilities';
import { formatTokenBalance } from '@/lib/api/offpay-wallet-data';
import { createRwaQuote } from '@/lib/api/offpay-api-client';
import { presentWalletTransactionNotification } from '@/lib/notifications/local-notifications';
import { buildRwaExecutionSignatureLinks } from '@/lib/rwa/rwa-execution-signatures';
import { buildRwaHistoryReceipt } from '@/lib/rwa/rwa-history-receipt';
import { executeRwaTradeReview } from '@/lib/rwa/rwa-trade-execution';
import { useAdvancedSwapStore } from '@/store/advancedSwapStore';
import { TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  OffpayNetwork,
  RwaAsset,
  RwaExecuteResponse,
} from '@/types/offpay-api';

const RWA_CONTENT_MAX_WIDTH = 560;
const RWA_SWAP_IN_PROGRESS_MESSAGE = 'Another RWA swap is in progress.';
const RWA_REVIEW_CURRENT_QUOTE_MESSAGE = 'Review the current RWA quote first.';

function getRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function getRouteTradeSide(value: string | string[] | undefined): RwaTradeSide | null {
  const normalized = getRouteParam(value)?.toLowerCase();
  return normalized === 'buy' || normalized === 'sell' ? normalized : null;
}

interface RwaQuoteMutationInput {
  asset: RwaAsset;
  side: RwaTradeSide;
  inputAmount: string;
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

export function RwaScreenContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useLocalSearchParams<{
    assetId?: string | string[];
    assetMint?: string | string[];
    intentId?: string | string[];
    side?: string | string[];
  }>();
  const { showToast } = useAppToast();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const bottomPadding = Math.max(insets.bottom, spacing.lg) + spacing.xl;
  const { network } = useOffpayNetwork();
  const { canUseNetwork, isNetworkSwitching } = useOffpayNetworkAccess();
  const activeWalletId = useWalletStore((state) => state.activeWalletId);
  const { walletAddress, canSignWithApp, signingBlocker } = useActiveWalletSigningCapability();
  const [assetSearchInput, setAssetSearchInput] = useState('');
  const [tradeDraft, setTradeDraft] = useState<RwaTradeDraftState | null>(null);
  const [reviewQuote, setReviewQuote] = useState<RwaQuoteReviewState | null>(null);
  const [processResult, setProcessResult] = useState<RwaProcessResultState | null>(null);
  const appliedRouteIntentRef = useRef<string | null>(null);
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const capabilities = capabilitiesQuery.capabilities;
  const assetsCapability = getOffpayFeatureCapability(capabilities, 'rwa.assets');
  const quoteCapability = getOffpayFeatureCapability(capabilities, 'rwa.quote');
  const executeCapability = getOffpayFeatureCapability(capabilities, 'rwa.execute');
  const rwaAssets = useRwaAssets({
    network,
    canUseNetwork,
    capabilities,
    requestOwner: 'rwa.assets',
  });
  const assetsQuery = rwaAssets.query;
  const canLoadAssets = rwaAssets.canLoadAssets;
  const draftTradeAmountLabel = tradeDraft?.side === 'sell' ? 'quantity' : 'USDC amount';
  const draftAmountState = useMemo(
    () => parseRwaTradeAmount(tradeDraft?.amountInput ?? '', draftTradeAmountLabel),
    [draftTradeAmountLabel, tradeDraft?.amountInput],
  );
  const walletBalanceQuery = useOffpayWalletBalance(walletAddress, {
    eagerWithoutCapabilities: true,
    enabled: walletAddress != null && canUseNetwork,
    requestOwner: 'rwa.wallet.balance',
    waitForDashboard: false,
  });
  const walletBalanceData = walletBalanceQuery.data;
  const refetchWalletBalance = walletBalanceQuery.refetch;

  const handleBack = useCallback((): void => {
    router.navigate(TAB_ROUTE_HREFS.index);
  }, [router]);

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
      return executeRwaTradeReview({
        review,
        walletBalance: walletBalanceData,
        refreshWalletBalance: async () => {
          const refreshedBalance = await refetchWalletBalance();
          return refreshedBalance.data ?? walletBalanceData ?? null;
        },
      });
    },
    onSuccess: async ({ review, execution }) => {
      const { asset, side, inputAmount, quote } = review;
      const executionSignatureLinks = buildRwaExecutionSignatureLinks(execution);
      const historyLegs = buildRwaReviewTokenLegs(review);
      const summaryAmount =
        side === 'buy' ? (quote.cashAmount ?? inputAmount) : (quote.quantity ?? inputAmount);
      const summarySymbol = side === 'buy' ? getRwaSettlementDisplaySymbol(asset) : asset.symbol;
      setReviewQuote(null);
      setTradeDraft(null);
      setProcessResult(
        buildRwaProcessResult({
          review,
          variant: 'success',
          extraRows: executionSignatureLinks.map((item) => ({
            label: item.label,
            value: item.signature,
            signature: item.signature,
            network: item.network,
          })),
        }),
      );
      useAdvancedSwapStore.getState().addReceipt(
        buildRwaHistoryReceipt({
          asset,
          side,
          payAmount: historyLegs.payLeg.amount,
          paySymbol: historyLegs.payLeg.symbol,
          receiveAmount: historyLegs.receiveLeg.amount,
          receiveSymbol: historyLegs.receiveLeg.symbol,
          walletAddress: review.walletAddress,
          execution,
        }),
      );
      showToast({
        title: 'RWA swap succeeded',
        message: `${asset.symbol} ${side} completed for ${summaryAmount} ${summarySymbol}.`,
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
        notificationId: `rwa-swap-failed-${variables.review.network}-${variables.review.walletAddress}`,
      });
    },
  });

  const assets = useMemo(() => assetsQuery.data?.assets ?? [], [assetsQuery.data?.assets]);
  const routeAssetId = getRouteParam(params.assetId);
  const routeAssetMint = getRouteParam(params.assetMint);
  const routeIntentId = getRouteParam(params.intentId);
  const routeTradeSide = getRouteTradeSide(params.side);
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
        return RWA_SWAP_IN_PROGRESS_MESSAGE;
      }
      if (reviewQuote != null) return RWA_REVIEW_CURRENT_QUOTE_MESSAGE;
      if (network == null) return 'Select a supported Solana network.';
      if (!canUseNetwork) return 'Network unavailable.';
      if (isNetworkSwitching) return 'Wait for the network switch to finish.';
      if (!quoteCapability.available) return quoteCapability.message;
      if (!executeCapability.available) return executeCapability.message;
      if (walletAddress == null) return 'Unlock wallet.';
      if (!canSignWithApp) return signingBlocker ?? 'Wallet signing unavailable.';
      if (asset.tradingHalted) return 'Trading is currently halted by the asset issuer.';
      if (asset.multiplierTransitionActive) {
        return 'Trading is paused during the issuer’s Token-2022 multiplier update.';
      }
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
  const getCatalogTradeDisabledReason = useCallback(
    (asset: RwaAsset, side: RwaTradeSide): string | null => {
      const disabledReason = getStartTradeDisabledReason(asset, side);
      if (
        disabledReason === RWA_SWAP_IN_PROGRESS_MESSAGE ||
        disabledReason === RWA_REVIEW_CURRENT_QUOTE_MESSAGE
      ) {
        return null;
      }
      return disabledReason;
    },
    [getStartTradeDisabledReason],
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

  useEffect(() => {
    if (routeTradeSide == null || (routeAssetId == null && routeAssetMint == null)) return;

    const routeIntentKey = [
      routeIntentId ?? 'direct',
      routeAssetId ?? '',
      routeAssetMint ?? '',
      routeTradeSide,
    ].join(':');
    if (appliedRouteIntentRef.current === routeIntentKey) return;
    if (capabilitiesQuery.isCapabilitiesPending) return;
    if (canLoadAssets && assetsQuery.isPending && assetsQuery.data == null) return;

    const asset =
      assets.find(
        (entry) =>
          (routeAssetId != null && entry.id === routeAssetId) ||
          (routeAssetMint != null && entry.mint === routeAssetMint),
      ) ?? null;

    if (asset == null) {
      appliedRouteIntentRef.current = routeIntentKey;
      showToast({
        title: 'RWA unavailable',
        message: 'This RWA is no longer available in the current catalog.',
        variant: 'error',
      });
      return;
    }

    const disabledReason = getStartTradeDisabledReason(asset, routeTradeSide);
    if (disabledReason != null) {
      appliedRouteIntentRef.current = routeIntentKey;
      showToast({
        title: `${routeTradeSide === 'buy' ? 'Buy' : 'Sell'} unavailable`,
        message: disabledReason,
        variant: 'error',
      });
      return;
    }

    appliedRouteIntentRef.current = routeIntentKey;
    setAssetSearchInput('');
    setProcessResult(null);
    setReviewQuote(null);
    setTradeDraft({
      assetId: asset.id,
      side: routeTradeSide,
      amountInput: '',
    });
  }, [
    assets,
    assetsQuery.data,
    assetsQuery.isPending,
    canLoadAssets,
    capabilitiesQuery.isCapabilitiesPending,
    getStartTradeDisabledReason,
    routeAssetId,
    routeAssetMint,
    routeIntentId,
    routeTradeSide,
    showToast,
  ]);

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

  const handleTradeAgain = useCallback((): void => {
    if (processResult?.variant !== 'success') return;
    setTradeDraft(processResult.repeatTradeDraft);
    setProcessResult(null);
  }, [processResult]);

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
    processResult?.repeatTradeDraft.side ??
    reviewQuote?.side ??
    rwaExecuteMutation.variables?.review.side ??
    null;

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

  const contentState = useMemo<RwaAssetCatalogContentState>(() => {
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
  const rwaAssetsErrorMessage =
    assetsQuery.error instanceof Error
      ? assetsQuery.error.message
      : 'Try again once the network is available.';
  const handleClearAssetSearch = useCallback((): void => {
    setAssetSearchInput('');
  }, []);
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
        <RwaScreenHeader compact={compact} onBack={handleBack} />
        <RwaAssetCatalog
          assetSearchInput={assetSearchInput}
          assetsCapabilityMessage={assetsCapability.message}
          contentState={contentState}
          dense={dense}
          errorMessage={rwaAssetsErrorMessage}
          filteredAssets={filteredAssets}
          getStartTradeDisabledReason={getCatalogTradeDisabledReason}
          onAssetSearchInputChange={setAssetSearchInput}
          onBuyAsset={handleBuyAsset}
          onClearAssetSearch={handleClearAssetSearch}
          onSellAsset={handleSellAsset}
        />
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
        onTradeAgain={handleTradeAgain}
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
});
