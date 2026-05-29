import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppToast } from '@/components/ui/AppToast';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import {
  useSwapInputState,
  type SwapExecutionResult,
  type SwapProcessResultState,
} from '@/hooks/useSwapInputState';
import { useSwapQuoteController } from '@/hooks/useSwapQuoteController';
import { GradientBackground } from '@/components/ui/GradientBackground';
import {
  ProcessResultScreen,
  type ProcessResultDetailRow,
  type ProcessResultVariant,
} from '@/components/ui/ProcessResultScreen';
import { Text } from '@/components/ui/Text';
import { PuffySettingsIcon } from '@/components/ui/icons/PuffySettingsIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { SwapCard } from '@/components/features/swap/SwapCard';
import { SwapDetailsCard } from '@/components/features/swap/SwapDetailsCard';
import { SwapConfirmationButton } from '@/components/features/swap/SwapConfirmationButton';
import { SwapExecutionStatusCard } from '@/components/features/swap/SwapExecutionStatusCard';
import {
  SwapReviewFlowScreen,
  type SwapReviewDetailRow,
  type SwapReviewTokenLeg,
} from '@/components/features/swap/SwapReviewFlowScreen';
import { TokenSelectorModal } from '@/components/features/swap/TokenSelectorModal';
import type { SwapTokenOption } from '@/components/features/swap/types';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import {
  offpaySwapTokensQueryKey,
  TOKEN_LOGO_CACHE_GC_MS,
  TOKEN_LOGO_CACHE_STALE_MS,
} from '@/hooks/useOffpayTokenLogoMap';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { getOffpayFeatureCapability, isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import {
  createSwapQuote,
  executeSwapQuote,
  getSwapPrice,
  getSwapTokens,
} from '@/lib/api/offpay-api-client';
import { mark, measure } from '@/lib/perf/perf-marks';
import {
  FALLBACK_SWAP_TOKENS,
  OFFLINE_SWAP_CAPABILITY,
  PRIVATE_SWAP_PROVIDER_LABEL,
  QUOTE_DEBOUNCE_MS,
  SLIPPAGE_BPS,
  SLIPPAGE_TOLERANCE_LABEL,
  SWAP_CONTENT_MAX_WIDTH,
  buildSwapTokenOption,
  capabilityWithLaunchError,
  findPreferredToken,
  findRouteToken,
  formatPriceImpactLabel,
  formatQuoteSlippageLabel,
  formatRateLabel,
  getConciseSwapErrorLabel,
  getExactSwapErrorMessage,
  getLocalPrivateSwapFundingBlocker,
  getLocalSwapFundingBlocker,
  getSearchParam,
  getSwapQuoteRetryDelay,
  getSwapToastVariant,
  getTokenAtomicBalance,
  isRefreshableSwapActionError,
  isRetryableSwapQuoteError,
  parseAtomicAmount,
  shouldRefreshSwapExecution,
  type SwapButtonFeedback,
} from '@/lib/swap/swap-helpers';
import { executePrivacyEnvelopeSwap, type PrivacyEnvelopeSwapResult } from '@/lib/swap/advanced-swap';
import { observeOfflineTokenMetadataFromSwapTokens } from '@/lib/offline/offline-token-metadata';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import {
  formatTokenBalance,
  shortenWalletAddress,
} from '@/lib/api/offpay-wallet-data';
import { signSerializedTransactionForWallet } from '@/lib/crypto/solana-transaction-signing';
import {
  decimalInputToAtomicAmount,
  formatAtomicAmount,
  sanitizeDecimalInput,
} from '@/lib/policy/token-amounts';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  SwapQuoteResponse,
} from '@/types/offpay-api';

interface SwapReviewState {
  quote: SwapQuoteResponse;
  payLeg: {
    label: string;
    amount: string;
    symbol: string;
    name: string;
    logo: string | null;
  };
  receiveLeg: {
    label: string;
    amount: string;
    symbol: string;
    name: string;
    logo: string | null;
  };
  routeLabel: string;
  slippageLabel: string;
  priceImpactLabel: string;
  feeLabel: string;
}

interface PrivateSwapReviewState {
  amountAtomic: string;
  inputMint: string;
  outputMint: string;
  receiveDecimals: number | null;
  payLeg: SwapReviewTokenLeg;
  receiveLeg: SwapReviewTokenLeg;
  detailRows: SwapReviewDetailRow[];
}

function HeaderIconButton({
  children,
  onPress,
  accessibilityLabel,
  active = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.headerIconPressable,
        pressed ? styles.headerIconPressed : null,
      ]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active ? { selected: true } : undefined}
    >
      <LinearGradient
        colors={[
          colors.glass.strongFill,
          active ? colors.glass.cyanWash : colors.glass.frostFill,
          colors.glass.clearFill,
        ]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerIconSurface}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

function PrivateSwapToggle({
  enabled,
  available,
  setupLabel,
  policyLabel,
  onToggle,
}: {
  enabled: boolean;
  available: boolean;
  setupLabel: string;
  policyLabel: string;
  onToggle: () => void;
}): React.JSX.Element {
  const knobProgress = useSharedValue(enabled ? 1 : 0);
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobProgress.value * 20 }],
  }));

  useEffect(() => {
    knobProgress.value = withTiming(enabled ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [enabled, knobProgress]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.privateTogglePressable,
        enabled ? styles.privateTogglePressableActive : null,
        pressed ? styles.headerIconPressed : null,
      ]}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      accessibilityLabel="Private swap mode"
      hitSlop={6}
    >
      <LinearGradient
        colors={[
          colors.glass.strongFill,
          enabled ? colors.glass.cyanWash : colors.glass.frostFill,
          colors.glass.clearFill,
        ]}
        start={{ x: 0.04, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.privateToggleSurface}
      >
        <View style={styles.privateToggleCopy}>
          <Text
            variant="captionBold"
            color={colors.text.primary}
            style={styles.privateToggleTitle}
            numberOfLines={1}
            maxFontSizeMultiplier={1}
          >
            Private swap
          </Text>
          <Text
            variant="small"
            color={available ? colors.text.secondary : colors.semantic.warning}
            style={styles.privateToggleMeta}
            numberOfLines={2}
            maxFontSizeMultiplier={1}
          >
            {available ? `${policyLabel} · ${setupLabel}` : 'Unavailable on this network'}
          </Text>
        </View>
        <View style={[styles.privateSwitchTrack, enabled ? styles.privateSwitchTrackActive : null]}>
          <Animated.View
            style={[
              styles.privateSwitchKnob,
              enabled ? styles.privateSwitchKnobActive : null,
              knobStyle,
            ]}
          />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export function SwapScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);
  const params = useLocalSearchParams<{
    inputMint?: string;
    inputSymbol?: string;
    outputMint?: string;
    outputSymbol?: string;
    mint?: string;
    token?: string;
  }>();
  const queryClient = useQueryClient();
  const getScreenSignal = useScreenAbortSignal();
  const { showToast } = useAppToast();
  const mountedRef = useRef(true);
  const appliedRouteParamsRef = useRef('');
  const activeWalletId = useWalletStore((state) => state.activeWalletId);
  const walletAddress = useWalletStore((state) => state.publicKey);
  const { network } = useOffpayNetwork();
  const { isNetworkSwitching } = useOffpayNetworkAccess();
  const { effectiveWalletMode } = useWalletModeState();
  const isOfflineMode = effectiveWalletMode === 'offline';
  const [tabDataReady, setTabDataReady] = useState(false);
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: true });
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: true,
    eagerWithoutCapabilities: true,
    enabled: tabDataReady,
  });

  const capabilities = capabilitiesQuery.capabilities;
  const tokensCapability = capabilityWithLaunchError(
    isOfflineMode
      ? OFFLINE_SWAP_CAPABILITY
      : getOffpayFeatureCapability(capabilities, 'swap.tokens'),
    capabilitiesQuery.hasCapabilityError,
    capabilitiesQuery.errorMessage,
  );
  const priceCapability = capabilityWithLaunchError(
    isOfflineMode
      ? OFFLINE_SWAP_CAPABILITY
      : getOffpayFeatureCapability(capabilities, 'swap.price'),
    capabilitiesQuery.hasCapabilityError,
    capabilitiesQuery.errorMessage,
  );
  const normalSwapCapability = capabilityWithLaunchError(
    isOfflineMode
      ? OFFLINE_SWAP_CAPABILITY
      : getOffpayFeatureCapability(capabilities, 'swap.normalSwap'),
    capabilitiesQuery.hasCapabilityError,
    capabilitiesQuery.errorMessage,
  );
  const canLoadTokens = !isOfflineMode && isOffpayFeatureAvailable(capabilities, 'swap.tokens');
  const canLoadPrices = !isOfflineMode && isOffpayFeatureAvailable(capabilities, 'swap.price');
  const canQuoteSwap = !isOfflineMode && isOffpayFeatureAvailable(capabilities, 'swap.normalSwap');
  const privateSwapAvailable =
    !isOfflineMode && isOffpayFeatureAvailable(capabilities, 'swap.privacySwap');
  const privateSwapSetupLabel = 'Any amount · network fees apply';

  const [selectingFor, setSelectingFor] = useState<'pay' | 'receive' | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [
    {
      payTokenMint,
      receiveTokenMint,
      payAmount,
      lastSwapResult,
      swapActionErrorLabel,
      swapActionRefreshable,
      processResult,
    },
    swapInputActions,
  ] = useSwapInputState();
  const [debouncedPayAmount, setDebouncedPayAmount] = useState('');
  const [quoteClock, setQuoteClock] = useState(Date.now());
  const [sliderResetNonce, setSliderResetNonce] = useState(0);
  const [reviewSwap, setReviewSwap] = useState<SwapReviewState | null>(null);
  const [privateSwapMode, setPrivateSwapMode] = useState(false);
  const [privateReviewSwap, setPrivateReviewSwap] = useState<PrivateSwapReviewState | null>(null);

  const resetReviewSlider = useCallback(() => {
    setReviewSwap(null);
    setPrivateReviewSwap(null);
    setSliderResetNonce((value) => value + 1);
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    setTabDataReady(false);
    const scheduled = scheduleUiWorkAfterFirstPaint(() => setTabDataReady(true), {
      timeoutMs: 2500,
      fallbackDelayMs: 350,
    });

    return () => {
      scheduled.cancel();
    };
  }, [network, walletAddress]);

  useEffect(() => {
    if (rootNavigationState?.key == null) return;
    router.prefetch('/advanced-swap' as never);
  }, [rootNavigationState?.key, router]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedPayAmount(payAmount), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [payAmount]);

  // Review/private-review state is interaction state, not input
  // identity, so it lives outside `useSwapInputState`. Any change to
  // pay amount or either selected mint should still clear a stale
  // review screen — its quote is no longer valid for the current
  // input.
  useEffect(() => {
    setReviewSwap(null);
    setPrivateReviewSwap(null);
  }, [payAmount, payTokenMint, receiveTokenMint]);

  const swapTokensQuery = useQuery({
    queryKey: offpaySwapTokensQueryKey(network),
    queryFn: ({ signal }) => {
      if (network == null) {
        throw new Error('Swap tokens require a supported OffPay network.');
      }

      const startedAt = mark();
      return getSwapTokens(network, { signal }).finally(() => {
        measure('swap.getSwapTokens', startedAt, { network });
      });
    },
    enabled: tabDataReady && network != null && canLoadTokens,
    staleTime: TOKEN_LOGO_CACHE_STALE_MS,
    gcTime: TOKEN_LOGO_CACHE_GC_MS,
    refetchOnMount: false,
  });

  useEffect(() => {
    if (network == null || swapTokensQuery.data == null) {
      return;
    }

    void observeOfflineTokenMetadataFromSwapTokens(network, swapTokensQuery.data.tokens);
  }, [network, swapTokensQuery.data]);

  const availableTokens = useMemo(() => {
    if (swapTokensQuery.data == null || swapTokensQuery.data.tokens.length === 0) {
      return FALLBACK_SWAP_TOKENS;
    }

    return swapTokensQuery.data.tokens.map((apiToken) =>
      buildSwapTokenOption({
        apiToken,
        balance: balanceQuery.data,
      }),
    );
  }, [balanceQuery.data, swapTokensQuery.data]);

  const privateSwapMintSet = useMemo(() => {
    return new Set(
      capabilities?.offline?.supportedStablecoins
        ?.filter((token) => token.enabled && token.mint != null)
        .map((token) => token.mint) ?? [],
    );
  }, [capabilities?.offline?.supportedStablecoins]);
  const privateSwapTokens = useMemo(() => {
    const tokenMap = new Map<string, SwapTokenOption>();

    capabilities?.offline?.supportedStablecoins
      ?.filter((token) => token.enabled && token.mint != null)
      .forEach((supportedToken) => {
        const existingToken = availableTokens.find((token) => token.mint === supportedToken.mint);
        const walletToken =
          balanceQuery.data?.tokens.find(
            (token) => !token.spam && token.mint === supportedToken.mint,
          ) ?? null;

        tokenMap.set(
          supportedToken.mint,
          existingToken ?? {
            symbol: supportedToken.symbol,
            name: supportedToken.name ?? supportedToken.symbol,
            mint: supportedToken.mint,
            decimals: supportedToken.decimals,
            logo: walletToken?.logo ?? null,
            balanceValue: walletToken?.balance ?? '0',
            balanceDisplay: walletToken != null ? formatTokenBalance(walletToken.balance) : '0.00',
            verified: true,
          },
        );
      });

    return [...tokenMap.values()];
  }, [availableTokens, balanceQuery.data?.tokens, capabilities?.offline?.supportedStablecoins]);

  useEffect(() => {
    const inputMint = getSearchParam(params.inputMint) ?? getSearchParam(params.mint);
    const inputSymbol = getSearchParam(params.inputSymbol) ?? getSearchParam(params.token);
    const outputMint = getSearchParam(params.outputMint);
    const outputSymbol = getSearchParam(params.outputSymbol);
    const routeKey = [inputMint, inputSymbol, outputMint, outputSymbol].join('|');

    if (routeKey.replace(/\|/g, '').length === 0 || routeKey === appliedRouteParamsRef.current) {
      return;
    }

    const routeInputToken = findRouteToken(availableTokens, inputMint, inputSymbol);
    const routeOutputToken = findRouteToken(availableTokens, outputMint, outputSymbol);
    const hasInputRequest = inputMint != null || inputSymbol != null;
    const hasOutputRequest = outputMint != null || outputSymbol != null;

    if (
      ((hasInputRequest && routeInputToken == null) ||
        (hasOutputRequest && routeOutputToken == null)) &&
      canLoadTokens &&
      (swapTokensQuery.isLoading || swapTokensQuery.isFetching)
    ) {
      return;
    }

    if (routeInputToken != null) {
      swapInputActions.setPayToken(routeInputToken.mint);
      if (routeOutputToken == null || routeOutputToken.mint === routeInputToken.mint) {
        swapInputActions.setReceiveToken(null);
      }
    }

    if (routeOutputToken != null && routeOutputToken.mint !== routeInputToken?.mint) {
      swapInputActions.setReceiveToken(routeOutputToken.mint);
    }

    appliedRouteParamsRef.current = routeKey;
  }, [
    availableTokens,
    canLoadTokens,
    params.inputMint,
    params.inputSymbol,
    params.mint,
    params.outputMint,
    params.outputSymbol,
    params.token,
    swapInputActions,
    swapTokensQuery.isFetching,
    swapTokensQuery.isLoading,
  ]);

  // Build a mint→token map once per `availableTokens` identity. The
  // pay/receive resolvers below scan the same array on every render
  // looking for one entry by exact mint match. With ~30+ tokens
  // common on devnet/mainnet, switching to O(1) lookup avoids
  // per-render churn during input/network transitions where a few
  // upstream pieces of state change in close succession.
  const tokensByMint = useMemo(() => {
    const map = new Map<string, SwapTokenOption>();
    for (const token of availableTokens) {
      if (token.mint != null) {
        map.set(token.mint, token);
      }
    }
    return map;
  }, [availableTokens]);

  const payToken =
    (payTokenMint != null ? tokensByMint.get(payTokenMint) : undefined) ??
    findPreferredToken(availableTokens, ['SOL', 'WSOL']) ??
    availableTokens[0] ??
    FALLBACK_SWAP_TOKENS[0]!;
  const receiveToken =
    (receiveTokenMint != null && receiveTokenMint !== payToken?.mint
      ? tokensByMint.get(receiveTokenMint)
      : undefined) ??
    findPreferredToken(availableTokens, ['USDC'], payToken?.mint) ??
    availableTokens.find((token) => token.mint !== payToken?.mint) ??
    availableTokens[0] ??
    FALLBACK_SWAP_TOKENS[1]!;
  const privatePayTokenSupported = payToken.mint != null && privateSwapMintSet.has(payToken.mint);
  const privateReceiveTokenSupported =
    receiveToken.mint != null && privateSwapMintSet.has(receiveToken.mint);
  const privatePairSupported =
    privatePayTokenSupported &&
    privateReceiveTokenSupported &&
    payToken.mint != null &&
    receiveToken.mint != null &&
    payToken.mint !== receiveToken.mint;
  const tokenSelectorTokens = privateSwapMode ? privateSwapTokens : availableTokens;
  const privateSwapPolicyLabel =
    network == null ? 'USDC / USDT only' : `USDC / USDT only on ${network}`;
  const privateSwapPairLabel =
    privateSwapTokens.length > 0
      ? privateSwapTokens.map((token) => token.symbol).join(' / ')
      : 'USDC / USDT';

  useEffect(() => {
    if (!privateSwapMode || privateSwapTokens.length < 2) return;

    const currentPayMint = payToken.mint;
    const currentReceiveMint = receiveToken.mint;
    const nextPayToken = privatePayTokenSupported ? payToken : (privateSwapTokens[0] ?? null);
    const nextReceiveToken =
      privateReceiveTokenSupported &&
      currentReceiveMint != null &&
      currentReceiveMint !== nextPayToken?.mint
        ? receiveToken
        : (privateSwapTokens.find((token) => token.mint !== nextPayToken?.mint) ?? null);

    if (nextPayToken?.mint != null && nextPayToken.mint !== currentPayMint) {
      swapInputActions.setPayToken(nextPayToken.mint);
    }
    if (nextReceiveToken?.mint != null && nextReceiveToken.mint !== currentReceiveMint) {
      swapInputActions.setReceiveToken(nextReceiveToken.mint);
    }
  }, [
    privatePayTokenSupported,
    privateReceiveTokenSupported,
    privateSwapMode,
    privateSwapTokens,
    payToken,
    receiveToken,
    swapInputActions,
  ]);

  const payPriceQuery = useQuery({
    queryKey: ['offpay', 'swapPrice', network, payToken?.mint],
    queryFn: ({ signal }) => {
      if (network == null || payToken?.mint == null) {
        throw new Error('Swap pricing requires a supported OffPay network and token mint.');
      }

      const startedAt = mark();
      return getSwapPrice(payToken.mint, network, { signal }).finally(() => {
        measure('swap.getSwapPrice.pay', startedAt, { mint: payToken.mint, network });
      });
    },
    enabled: tabDataReady && network != null && payToken?.mint != null && canLoadPrices,
    staleTime: 1000 * 30,
  });

  const receivePriceQuery = useQuery({
    queryKey: ['offpay', 'swapPrice', network, receiveToken?.mint],
    queryFn: ({ signal }) => {
      if (network == null || receiveToken?.mint == null) {
        throw new Error('Swap pricing requires a supported OffPay network and token mint.');
      }

      const startedAt = mark();
      return getSwapPrice(receiveToken.mint, network, { signal }).finally(() => {
        measure('swap.getSwapPrice.receive', startedAt, {
          mint: receiveToken.mint,
          network,
        });
      });
    },
    enabled: tabDataReady && network != null && receiveToken?.mint != null && canLoadPrices,
    staleTime: 1000 * 30,
  });

  const sanitizedPayAmount = useMemo(() => {
    if (payToken?.decimals == null) return payAmount;
    return sanitizeDecimalInput(payAmount, payToken.decimals);
  }, [payAmount, payToken?.decimals]);

  useEffect(() => {
    if (sanitizedPayAmount !== payAmount) {
      swapInputActions.normalizeAmount(sanitizedPayAmount);
    }
  }, [payAmount, sanitizedPayAmount, swapInputActions]);

  const quoteInputAmount = useMemo(() => {
    if (payToken?.decimals == null) return null;
    return decimalInputToAtomicAmount(debouncedPayAmount, payToken.decimals);
  }, [debouncedPayAmount, payToken?.decimals]);
  const currentInputAmount = useMemo(() => {
    if (payToken?.decimals == null) return null;
    return decimalInputToAtomicAmount(payAmount, payToken.decimals);
  }, [payAmount, payToken?.decimals]);
  const currentFundingBlocker = useMemo(
    () =>
      getLocalSwapFundingBlocker({
        amountAtomic: currentInputAmount,
        payToken,
        receiveToken,
        balance: balanceQuery.data,
      }),
    [balanceQuery.data, currentInputAmount, payToken, receiveToken],
  );
  const quoteInputFundingBlocker = useMemo(
    () =>
      getLocalSwapFundingBlocker({
        amountAtomic: quoteInputAmount,
        payToken,
        receiveToken,
        balance: balanceQuery.data,
      }),
    [balanceQuery.data, payToken, quoteInputAmount, receiveToken],
  );
  const canRequestSwapQuote =
    !privateSwapMode &&
    walletAddress != null &&
    balanceQuery.data != null &&
    quoteInputFundingBlocker == null;

  const quoteQuery = useQuery({
    queryKey: [
      'offpay',
      'swapQuote',
      network,
      walletAddress,
      payToken?.mint,
      receiveToken?.mint,
      quoteInputAmount,
      SLIPPAGE_BPS,
    ],
    queryFn: ({ signal }) => {
      if (
        network == null ||
        walletAddress == null ||
        payToken?.mint == null ||
        receiveToken?.mint == null ||
        quoteInputAmount == null
      ) {
        throw new Error('Swap quote requires a supported network, tokens, and amount.');
      }

      const quoteStartedAt = mark();
      return createSwapQuote(
        {
          inputMint: payToken.mint,
          outputMint: receiveToken.mint,
          amount: quoteInputAmount,
          network,
        },
        { signal },
      ).finally(() => {
        measure('swap.createSwapQuote', quoteStartedAt, { network });
      });
    },
    enabled:
      !privateSwapMode &&
      network != null &&
      walletAddress != null &&
      payToken?.mint != null &&
      receiveToken?.mint != null &&
      payToken?.decimals != null &&
      receiveToken?.decimals != null &&
      payToken.mint !== receiveToken.mint &&
      quoteInputAmount != null &&
      quoteInputAmount !== '0' &&
      canRequestSwapQuote &&
      tabDataReady &&
      canQuoteSwap,
    retry: (failureCount, error) => failureCount < 2 && isRetryableSwapQuoteError(error),
    retryDelay: getSwapQuoteRetryDelay,
  });

  const clearSwapActionState = swapInputActions.clearActionState;

  const quoteController = useSwapQuoteController({
    quoteQuery,
    resetReviewSlider,
    clearActionState: clearSwapActionState,
  });

  const quoteMatchesCurrentInput =
    quoteQuery.data != null &&
    currentInputAmount != null &&
    quoteQuery.data.inAmount === currentInputAmount &&
    quoteQuery.data.inputMint === payToken?.mint &&
    quoteQuery.data.outputMint === receiveToken?.mint;
  const activeExecutableQuote = quoteMatchesCurrentInput ? quoteQuery.data : null;
  const hasLiveSwapAmount =
    payAmount.trim().length > 0 &&
    currentInputAmount != null &&
    currentInputAmount !== '0' &&
    payToken?.mint != null &&
    receiveToken?.mint != null &&
    payToken.mint !== receiveToken.mint;
  const quoteUpdatingForCurrentInput =
    !privateSwapMode &&
    hasLiveSwapAmount &&
    balanceQuery.data != null &&
    currentFundingBlocker == null &&
    (quoteQuery.isFetching ||
      debouncedPayAmount !== payAmount ||
      (quoteQuery.data != null && !quoteMatchesCurrentInput));
  const showLiveSwapDetails =
    !privateSwapMode &&
    hasLiveSwapAmount &&
    canQuoteSwap &&
    balanceQuery.data != null &&
    currentFundingBlocker == null &&
    (quoteUpdatingForCurrentInput || quoteQuery.data != null || activeExecutableQuote != null);

  const receiveAmount = useMemo(() => {
    if (privateSwapMode) return '';
    if (payAmount.trim().length === 0) return '';
    if (balanceQuery.data == null) return '';
    if (currentFundingBlocker != null) return '';
    if (quoteUpdatingForCurrentInput) return '...';
    if (quoteQuery.data == null || receiveToken?.decimals == null) return '';
    if (!quoteMatchesCurrentInput) return '';

    return formatAtomicAmount(quoteQuery.data.outAmount, receiveToken.decimals, 6);
  }, [
    balanceQuery.data,
    currentFundingBlocker,
    payAmount,
    privateSwapMode,
    quoteMatchesCurrentInput,
    quoteQuery.data,
    quoteUpdatingForCurrentInput,
    receiveToken?.decimals,
  ]);

  const activeQuoteId = quoteQuery.data?.quoteId ?? null;
  const activeQuoteExpiresAt = quoteQuery.data?.expiresAt ?? null;

  useEffect(() => {
    if (activeQuoteId == null || activeQuoteExpiresAt == null) return undefined;

    setQuoteClock(Date.now());
    const interval = setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeQuoteExpiresAt, activeQuoteId]);

  const quoteExpiresInMs = quoteQuery.data == null ? null : quoteQuery.data.expiresAt - quoteClock;
  const quoteExpired = quoteExpiresInMs != null && quoteExpiresInMs <= 0;
  const quoteExpiryLabel =
    quoteQuery.data == null
      ? 'No live quote'
      : quoteExpired
        ? 'Expired'
        : `${Math.ceil((quoteExpiresInMs ?? 0) / 1000)}s`;
  const reviewQuoteExpiresInMs =
    reviewSwap == null ? null : reviewSwap.quote.expiresAt - quoteClock;
  const reviewQuoteExpired = reviewQuoteExpiresInMs != null && reviewQuoteExpiresInMs <= 0;
  const reviewQuoteExpiryLabel =
    reviewSwap == null
      ? 'No live quote'
      : reviewQuoteExpired
        ? 'Expired'
        : `${Math.ceil((reviewQuoteExpiresInMs ?? 0) / 1000)}s`;

  const buildReviewDetailRows = useCallback(
    (extraRows: ProcessResultDetailRow[] = []): ProcessResultDetailRow[] => {
      if (reviewSwap == null) return extraRows;

      return [
        { label: 'Route', value: reviewSwap.routeLabel },
        { label: 'Price impact', value: reviewSwap.priceImpactLabel },
        { label: 'Quote fee', value: reviewSwap.feeLabel },
        {
          label: 'Slippage',
          value: `${reviewSwap.slippageLabel} · ${reviewQuoteExpiryLabel}`,
        },
        ...extraRows,
      ];
    },
    [reviewQuoteExpiryLabel, reviewSwap],
  );

  const buildSwapProcessResult = useCallback(
    (params: {
      variant: ProcessResultVariant;
      title: string;
      message: string;
      statusLabel: string;
      quote?: SwapQuoteResponse;
      extraRows?: ProcessResultDetailRow[];
    }): SwapProcessResultState | null => {
      const quote = params.quote ?? reviewSwap?.quote ?? null;
      const payLeg =
        reviewSwap?.payLeg ??
        (quote != null && payToken.decimals != null
          ? {
              label: 'You paid',
              amount: formatAtomicAmount(quote.inAmount, payToken.decimals, 6),
              symbol: payToken.symbol,
              name: payToken.name,
              logo: payToken.logo,
            }
          : null);
      const receiveLeg =
        reviewSwap?.receiveLeg ??
        (quote != null && receiveToken.decimals != null
          ? {
              label: 'You received',
              amount: formatAtomicAmount(quote.outAmount, receiveToken.decimals, 6),
              symbol: receiveToken.symbol,
              name: receiveToken.name,
              logo: receiveToken.logo,
            }
          : null);

      if (payLeg == null || receiveLeg == null) return null;

      return {
        variant: params.variant,
        title: params.title,
        message: params.message,
        statusLabel: params.statusLabel,
        tokenLegs: [
          { ...payLeg, label: params.variant === 'success' ? 'Paid' : payLeg.label },
          {
            ...receiveLeg,
            label: params.variant === 'success' ? 'Received' : receiveLeg.label,
          },
        ],
        detailRows: buildReviewDetailRows(params.extraRows),
      };
    },
    [buildReviewDetailRows, payToken, receiveToken, reviewSwap],
  );

  const buildPrivateSwapProcessResult = useCallback(
    (params: {
      review: PrivateSwapReviewState;
      variant: ProcessResultVariant;
      title: string;
      message: string;
      statusLabel: string;
      receiveAmount?: string;
      extraRows?: ProcessResultDetailRow[];
    }): SwapProcessResultState => {
      const paidLabel = params.variant === 'success' ? 'Paid' : params.review.payLeg.label;
      const receivedLabel =
        params.variant === 'success' ? 'Received' : params.review.receiveLeg.label;

      return {
        variant: params.variant,
        title: params.title,
        message: params.message,
        statusLabel: params.statusLabel,
        tokenLegs: [
          { ...params.review.payLeg, label: paidLabel },
          {
            ...params.review.receiveLeg,
            label: receivedLabel,
            amount: params.receiveAmount ?? params.review.receiveLeg.amount,
          },
        ],
        detailRows: [...params.review.detailRows, ...(params.extraRows ?? [])],
      };
    },
    [],
  );

  const signAndExecuteQuote = async (quote: SwapQuoteResponse): Promise<{ signature: string }> => {
    if (walletAddress == null) {
      throw new Error('Unlock an active wallet before executing a swap.');
    }
    if (network == null) {
      throw new Error('A supported network is required before executing a swap.');
    }

    const signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: quote.unsignedTransaction,
      walletAddress,
      walletId: activeWalletId,
    });

    return executeSwapQuote({
      quoteId: quote.quoteId,
      signedTransaction,
      network,
    });
  };

  const fetchFreshQuoteForExecution = async (
    quote: SwapQuoteResponse,
  ): Promise<SwapQuoteResponse> => {
    if (network == null) {
      throw new Error('Swap retry requires a supported network.');
    }

    const signal = getScreenSignal();
    const startedAt = mark();
    try {
      return await createSwapQuote(
        {
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          amount: quote.inAmount,
          network,
        },
        { signal },
      );
    } finally {
      measure('swap.createSwapQuote.refresh', startedAt, { network });
    }
  };

  const executeSwapMutation = useMutation<SwapExecutionResult, unknown, SwapQuoteResponse>({
    mutationFn: async (quote) => {
      if (network == null) {
        throw new Error('A live quote is required before executing a swap.');
      }

      try {
        const result = await signAndExecuteQuote(quote);
        return { ...result, refreshedQuote: false } satisfies SwapExecutionResult;
      } catch (error) {
        if (!shouldRefreshSwapExecution(error)) throw error;

        const freshQuote = await fetchFreshQuoteForExecution(quote);
        const result = await signAndExecuteQuote(freshQuote);
        return { ...result, refreshedQuote: true } satisfies SwapExecutionResult;
      }
    },
    onSuccess: async (result, quote) => {
      if (!mountedRef.current) return;
      swapInputActions.setLastSwapResult(result);
      swapInputActions.clearActionState();

      const sentAmount = formatAtomicAmount(quote.inAmount, payToken.decimals ?? 6, 6);
      const receivedAmount = formatAtomicAmount(quote.outAmount, receiveToken.decimals ?? 6, 6);
      const resultScreen = buildSwapProcessResult({
        variant: 'success',
        title: 'Swap complete',
        message: `${sentAmount} ${payToken.symbol} swapped to ${receivedAmount} ${receiveToken.symbol}.`,
        statusLabel: result.refreshedQuote ? 'Refreshed' : 'Done',
        quote,
        extraRows: [
          {
            label: 'Signature',
            value: shortenWalletAddress(result.signature, 5),
            selectable: true,
          },
        ],
      });
      if (resultScreen != null) {
        setReviewSwap(null);
        swapInputActions.setProcessResult(resultScreen);
      }

      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
        }),
        queryClient.invalidateQueries({
          queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
          refetchType: 'all',
        }),
      ]).catch(() => undefined);
    },
    onError: (error: unknown) => {
      if (!mountedRef.current) return;
      const refreshableActionError = isRefreshableSwapActionError(error);
      swapInputActions.setLastSwapResult(null);
      swapInputActions.setActionError({
        label: shouldRefreshSwapExecution(error) ? null : getConciseSwapErrorLabel(error),
        refreshable: refreshableActionError,
      });
      if (shouldRefreshSwapExecution(error)) {
        quoteController.refreshOnRecoverableError();
      }

      const message = getExactSwapErrorMessage(error);
      const resultScreen = buildSwapProcessResult({
        variant: 'error',
        title: 'Swap failed',
        message,
        statusLabel: 'Failed',
        extraRows: [{ label: 'Reason', value: message, selectable: true }],
      });
      if (resultScreen != null) {
        swapInputActions.setProcessResult(resultScreen);
      }

      showToast({
        title: 'Swap failed',
        message,
        variant: 'error',
      });
    },
    onSettled: () => {
      if (!mountedRef.current) return;
      setReviewSwap(null);
      setSliderResetNonce((value) => value + 1);
    },
  });

  const privateSwapMutation = useMutation<
    PrivacyEnvelopeSwapResult,
    unknown,
    PrivateSwapReviewState
  >({
    mutationFn: (review) => {
      if (walletAddress == null) {
        throw new Error('Unlock an active wallet before executing a private swap.');
      }
      if (network == null) {
        throw new Error('A supported network is required before executing a private swap.');
      }

      return executePrivacyEnvelopeSwap({
        walletAddress,
        walletId: activeWalletId,
        inputMint: review.inputMint,
        outputMint: review.outputMint,
        amount: review.amountAtomic,
        slippageBps: SLIPPAGE_BPS,
        network,
      });
    },
    onSuccess: async (result, review) => {
      if (!mountedRef.current) return;

      const receivedAmount =
        review.receiveDecimals != null
          ? formatAtomicAmount(result.settledAmount, review.receiveDecimals, 6)
          : result.settledAmount;
      const resultScreen = buildPrivateSwapProcessResult({
        review,
        variant: 'success',
        title: 'Private swap complete',
        message: `${review.payLeg.amount} ${review.payLeg.symbol} swapped to ${receivedAmount} ${review.receiveLeg.symbol}.`,
        statusLabel: 'Done',
        receiveAmount: receivedAmount,
        extraRows: [
          {
            label: 'Settlement',
            value: shortenWalletAddress(result.settlementSignature, 5),
            selectable: true,
          },
          {
            label: 'Executor',
            value: shortenWalletAddress(result.executorWallet, 5),
            selectable: true,
          },
        ],
      });

      setPrivateReviewSwap(null);
      swapInputActions.setProcessResult(resultScreen);

      if (walletAddress != null && network != null) {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
          }),
          queryClient.invalidateQueries({
            queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
            refetchType: 'all',
          }),
        ]).catch(() => undefined);
      }
    },
    onError: (error, review) => {
      if (!mountedRef.current) return;

      const message = getExactSwapErrorMessage(error);
      swapInputActions.setProcessResult(
        buildPrivateSwapProcessResult({
          review,
          variant: 'error',
          title: 'Private swap failed',
          message,
          statusLabel: 'Failed',
          extraRows: [{ label: 'Reason', value: message, selectable: true }],
        }),
      );
      showToast({
        title: 'Private swap failed',
        message,
        variant: 'error',
      });
    },
    onSettled: () => {
      if (!mountedRef.current) return;
      setPrivateReviewSwap(null);
      setSliderResetNonce((value) => value + 1);
    },
  });

  useEffect(() => {
    if (!reviewQuoteExpired || executeSwapMutation.isPending) return;
    resetReviewSlider();
  }, [executeSwapMutation.isPending, resetReviewSlider, reviewQuoteExpired]);

  const tokensErrorMessage =
    swapTokensQuery.error instanceof Error
      ? swapTokensQuery.error.message
      : 'Unable to load supported swap tokens.';
  const priceErrorMessage =
    payPriceQuery.error instanceof Error
      ? payPriceQuery.error.message
      : receivePriceQuery.error instanceof Error
        ? receivePriceQuery.error.message
        : 'Unable to load live pricing.';
  const rateLabel = useMemo(() => {
    if (!canLoadPrices) return priceCapability.message;
    if (payPriceQuery.error != null || receivePriceQuery.error != null) {
      return priceErrorMessage;
    }

    return formatRateLabel({
      payAmount,
      receiveAmount: receiveAmount === '...' ? '' : receiveAmount,
      payToken,
      receiveToken,
      payPrice: payPriceQuery.data?.price ?? null,
      receivePrice: receivePriceQuery.data?.price ?? null,
    });
  }, [
    canLoadPrices,
    payAmount,
    payPriceQuery.data?.price,
    payPriceQuery.error,
    payToken,
    priceCapability.message,
    priceErrorMessage,
    receiveAmount,
    receivePriceQuery.data?.price,
    receivePriceQuery.error,
    receiveToken,
  ]);

  const quoteErrorMessage =
    quoteQuery.error instanceof Error ? quoteQuery.error.message : 'Unable to fetch a live quote.';
  const routeLabel = quoteQuery.data?.routeSummary
    ? quoteExpired
      ? 'Quote expired. Refresh before signing.'
      : quoteQuery.data.routeSummary
    : !canLoadTokens
      ? tokensCapability.message
      : swapTokensQuery.error != null
        ? tokensErrorMessage
        : payAmount.trim().length === 0
          ? 'Enter an amount to fetch a quote'
          : quoteQuery.isFetching
            ? 'Loading quote…'
            : !canQuoteSwap
              ? normalSwapCapability.message
              : quoteErrorMessage;
  const priceImpactLabel =
    quoteQuery.data != null
      ? formatPriceImpactLabel(quoteQuery.data.priceImpactPct)
      : quoteQuery.isFetching
        ? 'Loading…'
        : '—';
  const quoteFeeLabel =
    quoteQuery.data?.fee != null && payToken?.decimals != null
      ? `${formatAtomicAmount(quoteQuery.data.fee, payToken.decimals, 6)} ${payToken.symbol}`
      : quoteQuery.isFetching
        ? 'Loading…'
        : '—';
  const liveDetailsRateLabel =
    quoteUpdatingForCurrentInput && quoteQuery.data == null ? 'Fetching live rate' : rateLabel;
  const liveDetailsPriceImpactLabel = quoteUpdatingForCurrentInput ? 'Updating…' : priceImpactLabel;
  const liveDetailsFeeLabel = quoteUpdatingForCurrentInput ? 'Updating…' : quoteFeeLabel;
  const liveDetailsRouteLabel = quoteUpdatingForCurrentInput ? 'Fetching live quote' : routeLabel;
  const currentSlippageLabel = formatQuoteSlippageLabel(quoteQuery.data ?? null);
  const liveDetailsSlippageLabel =
    quoteQuery.data != null && !quoteExpired
      ? `${currentSlippageLabel} · ${quoteExpiryLabel}`
      : currentSlippageLabel;
  const quoteRetryAvailable =
    hasLiveSwapAmount &&
    !quoteQuery.isFetching &&
    quoteQuery.error != null &&
    activeExecutableQuote == null &&
    canRequestSwapQuote &&
    canQuoteSwap;
  const swapActionRefreshAvailable =
    swapActionRefreshable &&
    hasLiveSwapAmount &&
    !quoteQuery.isFetching &&
    canRequestSwapQuote &&
    canQuoteSwap;
  const swapButtonFeedback = useMemo<SwapButtonFeedback | null>(() => {
    if (executeSwapMutation.isPending) return null;
    // A network switch is in flight. Surface a clear "Switching
    // network…" lockout label so the user understands why the swap
    // is briefly unavailable instead of seeing a silently disabled
    // button. The lockout self-clears via `finishNetworkSwitch` after
    // a fixed delay.
    if (isNetworkSwitching) {
      return { label: 'Switching network…', tone: 'default', disabled: true };
    }

    if (swapActionErrorLabel != null) {
      if (swapActionRefreshAvailable) {
        return { label: 'Slide to refresh quote', tone: 'default', disabled: false };
      }

      return { label: swapActionErrorLabel, tone: 'danger', disabled: true };
    }
    if (walletAddress == null) {
      return { label: 'Unlock wallet to swap', tone: 'default', disabled: true };
    }
    if (network == null) {
      return { label: 'Network unavailable', tone: 'danger', disabled: true };
    }
    if (isOfflineMode) {
      return { label: OFFLINE_SWAP_CAPABILITY.message, tone: 'danger', disabled: true };
    }
    if (capabilitiesQuery.isCapabilitiesPending) {
      return { label: 'Checking swap availability', tone: 'default', disabled: true };
    }
    if (!canLoadTokens) {
      return { label: tokensCapability.message, tone: 'danger', disabled: true };
    }
    if (!canQuoteSwap) {
      return { label: normalSwapCapability.message, tone: 'danger', disabled: true };
    }
    if (swapTokensQuery.error != null) {
      return { label: tokensErrorMessage, tone: 'danger', disabled: true };
    }
    if (payToken.mint == null || receiveToken.mint == null) {
      return { label: 'Token unavailable', tone: 'danger', disabled: true };
    }
    if (payToken.mint === receiveToken.mint) {
      return { label: 'Choose different tokens', tone: 'default', disabled: true };
    }
    if (payAmount.trim().length === 0 || currentInputAmount == null || currentInputAmount === '0') {
      return { label: 'Enter an amount', tone: 'default', disabled: true };
    }
    if (balanceQuery.error != null && balanceQuery.data == null) {
      return { label: 'Unable to verify balance', tone: 'danger', disabled: true };
    }
    if (balanceQuery.data == null) {
      return { label: 'Checking balance', tone: 'default', disabled: true };
    }
    if (currentFundingBlocker != null) {
      return currentFundingBlocker;
    }

    const inputAtomic = parseAtomicAmount(currentInputAmount);
    const payBalanceAtomic = getTokenAtomicBalance(payToken);
    if (inputAtomic == null || payBalanceAtomic == null) {
      return { label: 'Unable to verify amount', tone: 'danger', disabled: true };
    }

    const quoteFeeAtomic = parseAtomicAmount(quoteQuery.data?.fee);
    if (
      quoteFeeAtomic != null &&
      quoteFeeAtomic > BigInt(0) &&
      payBalanceAtomic < inputAtomic + quoteFeeAtomic
    ) {
      return {
        label: `Insufficient ${payToken.symbol} for quote fee`,
        tone: 'danger',
        disabled: true,
      };
    }

    if (quoteUpdatingForCurrentInput) {
      return { label: 'Fetching live quote', tone: 'default', disabled: true };
    }
    if (quoteExpired) {
      return { label: 'Quote expired. Slide to refresh', tone: 'default', disabled: false };
    }
    if (quoteQuery.error != null) {
      if (quoteRetryAvailable) {
        return { label: 'Retry quote', tone: 'default', disabled: false };
      }

      return {
        label: getConciseSwapErrorLabel(quoteQuery.error),
        tone: 'danger',
        disabled: true,
      };
    }
    if (activeExecutableQuote == null) {
      return { label: 'Waiting for live quote', tone: 'default', disabled: true };
    }

    return null;
  }, [
    activeExecutableQuote,
    balanceQuery.data,
    balanceQuery.error,
    canLoadTokens,
    canQuoteSwap,
    capabilitiesQuery.isCapabilitiesPending,
    currentInputAmount,
    currentFundingBlocker,
    executeSwapMutation.isPending,
    isOfflineMode,
    network,
    normalSwapCapability.message,
    payAmount,
    payToken,
    quoteExpired,
    quoteQuery.data?.fee,
    quoteQuery.error,
    quoteRetryAvailable,
    quoteUpdatingForCurrentInput,
    receiveToken.mint,
    swapActionErrorLabel,
    swapActionRefreshAvailable,
    swapTokensQuery.error,
    tokensCapability.message,
    tokensErrorMessage,
    walletAddress,
    isNetworkSwitching,
  ]);
  const privateFundingBlocker = useMemo(
    () =>
      getLocalPrivateSwapFundingBlocker({
        amountAtomic: currentInputAmount,
        payToken,
        balance: balanceQuery.data,
      }),
    [balanceQuery.data, currentInputAmount, payToken],
  );
  const privateSwapFeedback = useMemo<SwapButtonFeedback | null>(() => {
    if (!privateSwapMode || privateSwapMutation.isPending) return null;
    if (isNetworkSwitching) {
      return { label: 'Switching network…', tone: 'default', disabled: true };
    }

    if (walletAddress == null) {
      return { label: 'Unlock wallet to swap', tone: 'default', disabled: true };
    }
    if (network == null) {
      return { label: 'Network unavailable', tone: 'danger', disabled: true };
    }
    if (isOfflineMode) {
      return { label: OFFLINE_SWAP_CAPABILITY.message, tone: 'danger', disabled: true };
    }
    if (capabilitiesQuery.isCapabilitiesPending) {
      return { label: 'Checking private swaps', tone: 'default', disabled: true };
    }
    if (!privateSwapAvailable) {
      return { label: 'Private swaps unavailable', tone: 'danger', disabled: true };
    }
    if (privateSwapTokens.length < 2) {
      return { label: 'No MagicBlock pair available', tone: 'danger', disabled: true };
    }
    if (!privatePairSupported) {
      return { label: 'Choose a MagicBlock pair', tone: 'danger', disabled: true };
    }
    if (payAmount.trim().length === 0 || currentInputAmount == null || currentInputAmount === '0') {
      return { label: 'Enter an amount', tone: 'default', disabled: true };
    }
    if (balanceQuery.error != null && balanceQuery.data == null) {
      return { label: 'Unable to verify balance', tone: 'danger', disabled: true };
    }
    if (balanceQuery.data == null) {
      return { label: 'Checking balance', tone: 'default', disabled: true };
    }
    if (privateFundingBlocker != null) {
      return privateFundingBlocker;
    }

    return null;
  }, [
    balanceQuery.data,
    balanceQuery.error,
    capabilitiesQuery.isCapabilitiesPending,
    currentInputAmount,
    isOfflineMode,
    network,
    payAmount,
    privateFundingBlocker,
    privatePairSupported,
    privateSwapAvailable,
    privateSwapMode,
    privateSwapMutation.isPending,
    privateSwapTokens.length,
    walletAddress,
    isNetworkSwitching,
  ]);
  const activeSwapButtonFeedback = privateSwapMode ? privateSwapFeedback : swapButtonFeedback;
  const reviewStatusLabel =
    reviewSwap == null ? 'Review' : reviewQuoteExpired ? 'Expired' : reviewQuoteExpiryLabel;
  const reviewDetailRows = useMemo(() => buildReviewDetailRows(), [buildReviewDetailRows]);
  const privateSwapStatusMessage = privateSwapMutation.isPending
    ? 'Signing and submitting private swap...'
    : !privateSwapAvailable
      ? 'Private swaps are unavailable on this network.'
      : privateSwapTokens.length < 2
        ? 'No MagicBlock pair is available for this wallet network.'
        : privatePairSupported
          ? `${privateSwapPairLabel} only · ${PRIVATE_SWAP_PROVIDER_LABEL}`
          : `Choose ${privateSwapPairLabel} tokens for private swap.`;
  const swapStatusMessage = privateSwapMode
    ? privateSwapStatusMessage
    : executeSwapMutation.isPending
      ? 'Signing and submitting swap...'
      : lastSwapResult != null
        ? `Last swap submitted: ${lastSwapResult.signature.slice(0, 8)}...${lastSwapResult.signature.slice(-8)}`
        : !canLoadTokens
          ? tokensCapability.message
          : swapTokensQuery.error != null
            ? tokensErrorMessage
            : !canLoadPrices
              ? priceCapability.message
              : payPriceQuery.error != null || receivePriceQuery.error != null
                ? priceErrorMessage
                : !canQuoteSwap
                  ? normalSwapCapability.message
                  : quoteQuery.data != null
                    ? quoteExpired
                      ? 'Quote expired. Refresh or edit amount to fetch a new quote.'
                      : activeExecutableQuote == null
                        ? 'Updating quote for the current amount.'
                        : 'Live quote loaded. Review to sign and execute.'
                    : payAmount.trim().length > 0 && quoteQuery.error != null
                      ? quoteErrorMessage
                      : null;
  const visibleSwapStatusMessage =
    swapStatusMessage == null
      ? null
      : privateSwapMode ||
          privateSwapMutation.isPending ||
          executeSwapMutation.isPending ||
          lastSwapResult != null ||
          !showLiveSwapDetails
        ? swapStatusMessage
        : null;
  const reviewButtonDisabled = privateSwapMode
    ? privateSwapMutation.isPending || (privateSwapFeedback?.disabled ?? false)
    : executeSwapMutation.isPending ||
      (swapButtonFeedback?.disabled ?? activeExecutableQuote == null);
  const sliderResetSignal = [
    sliderResetNonce,
    privateSwapMode ? 'private' : 'normal',
    payToken?.mint ?? 'pay',
    receiveToken?.mint ?? 'receive',
    currentInputAmount ?? 'empty',
    activeQuoteId ?? 'noquote',
    quoteExpired ? 'expired' : 'live',
    swapActionRefreshAvailable ? 'refresh-error' : 'ready',
  ].join(':');

  const handleBack = () => {
    const target =
      previousRoute !== 'index' && previousRoute !== 'swap'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  };

  const handleTogglePrivateSwapMode = () => {
    setPrivateSwapMode((enabled) => !enabled);
    setReviewSwap(null);
    setPrivateReviewSwap(null);
    swapInputActions.clearActionState();
    swapInputActions.setLastSwapResult(null);
    setSliderResetNonce((value) => value + 1);
  };

  const handleFlip = () => {
    swapInputActions.flip({
      payMint: receiveToken.mint,
      receiveMint: payToken.mint,
      nextAmount: !privateSwapMode && receiveAmount !== '...' ? receiveAmount : undefined,
    });
  };

  const handleTokenSelect = (token: SwapTokenOption) => {
    if (selectingFor === 'pay') {
      if (token.mint != null && token.mint === receiveToken.mint) {
        handleFlip();
        return;
      }

      // Token change clears `lastSwapResult`, `swapActionErrorLabel`,
      // `swapActionRefreshable`, and `processResult` atomically via
      // the reducer; no manual clears needed here.
      swapInputActions.setPayToken(token.mint);
      return;
    }

    if (selectingFor === 'receive') {
      if (token.mint != null && token.mint === payToken.mint) {
        handleFlip();
        return;
      }

      swapInputActions.setReceiveToken(token.mint);
    }
  };

  const handleRefreshSwapQuote = () => {
    quoteController.refreshOnUserGesture('refresh');
  };

  const handleReviewPrivateSwap = () => {
    if (privateSwapFeedback?.disabled || privateSwapMutation.isPending) {
      showToast({
        title: privateSwapMutation.isPending
          ? 'Private swap in progress'
          : (privateSwapFeedback?.label ?? 'Private swap unavailable'),
        message: privateSwapMutation.isPending
          ? 'Wait for the current private swap to finish.'
          : 'Fix this before reviewing the private swap.',
        variant:
          privateSwapFeedback == null ? 'info' : getSwapToastVariant(privateSwapFeedback.tone),
      });
      resetReviewSlider();
      return;
    }

    if (
      currentInputAmount == null ||
      currentInputAmount === '0' ||
      payToken.mint == null ||
      receiveToken.mint == null ||
      payToken.decimals == null
    ) {
      showToast({
        title: 'Private swap unavailable',
        message: 'Choose supported tokens and enter an amount.',
        variant: 'warning',
      });
      resetReviewSlider();
      return;
    }

    const reviewPayAmount = formatAtomicAmount(currentInputAmount, payToken.decimals, 6);
    const reviewState: PrivateSwapReviewState = {
      amountAtomic: currentInputAmount,
      inputMint: payToken.mint,
      outputMint: receiveToken.mint,
      receiveDecimals: receiveToken.decimals,
      payLeg: {
        label: 'You pay',
        amount: reviewPayAmount,
        symbol: payToken.symbol,
        name: payToken.name,
        logo: payToken.logo,
      },
      receiveLeg: {
        label: 'You receive',
        amount: 'At settlement',
        symbol: receiveToken.symbol,
        name: receiveToken.name,
        logo: receiveToken.logo,
      },
      detailRows: [
        { label: 'Route', value: PRIVATE_SWAP_PROVIDER_LABEL },
        { label: 'Pair', value: `${payToken.symbol} → ${receiveToken.symbol}` },
        { label: 'Slippage', value: `${SLIPPAGE_TOLERANCE_LABEL} max` },
      ],
    };

    setPrivateReviewSwap(reviewState);
    showToast({
      title: 'Review private swap',
      message: `${reviewPayAmount} ${payToken.symbol} → ${receiveToken.symbol}`,
      variant: 'info',
    });
  };

  const handleReviewSwap = () => {
    if (privateSwapMode) {
      handleReviewPrivateSwap();
      return;
    }

    if (swapButtonFeedback?.disabled || executeSwapMutation.isPending) {
      showToast({
        title: executeSwapMutation.isPending
          ? 'Swap in progress'
          : (swapButtonFeedback?.label ?? 'Swap unavailable'),
        message: executeSwapMutation.isPending
          ? 'Wait for the current swap to finish.'
          : 'Fix this before reviewing the swap.',
        variant: swapButtonFeedback == null ? 'info' : getSwapToastVariant(swapButtonFeedback.tone),
      });
      resetReviewSlider();
      return;
    }
    if (swapActionRefreshAvailable) {
      handleRefreshSwapQuote();
      return;
    }
    if (quoteRetryAvailable) {
      quoteController.refreshOnUserGesture('retry');
      return;
    }
    if (quoteExpired) {
      quoteController.refreshOnExpiry();
      return;
    }
    const quoteForReview = activeExecutableQuote;
    if (quoteForReview == null) {
      showToast({
        title: 'Live quote unavailable',
        message: quoteQuery.isFetching
          ? 'Still fetching a quote.'
          : 'Enter an amount and wait for a live quote.',
        variant: 'warning',
      });
      resetReviewSlider();
      return;
    }
    if (payToken?.decimals == null || receiveToken?.decimals == null) {
      showToast({
        title: 'Token metadata missing',
        message: 'Choose supported tokens before reviewing.',
        variant: 'warning',
      });
      resetReviewSlider();
      return;
    }

    const reviewPayAmount = formatAtomicAmount(quoteForReview.inAmount, payToken.decimals, 6);
    const reviewReceiveAmount = formatAtomicAmount(
      quoteForReview.outAmount,
      receiveToken.decimals,
      6,
    );
    setReviewSwap({
      quote: quoteForReview,
      payLeg: {
        label: 'You pay',
        amount: reviewPayAmount,
        symbol: payToken.symbol,
        name: payToken.name,
        logo: payToken.logo,
      },
      receiveLeg: {
        label: 'You receive',
        amount: reviewReceiveAmount,
        symbol: receiveToken.symbol,
        name: receiveToken.name,
        logo: receiveToken.logo,
      },
      routeLabel: quoteForReview.routeSummary,
      slippageLabel: formatQuoteSlippageLabel(quoteForReview),
      priceImpactLabel,
      feeLabel: quoteFeeLabel,
    });
    showToast({
      title: 'Review swap',
      message: `${reviewPayAmount} ${payToken.symbol} → ${reviewReceiveAmount} ${receiveToken.symbol}`,
      variant: 'info',
    });
  };

  const handleConfirmReviewSwap = () => {
    if (privateReviewSwap != null) {
      if (privateSwapMutation.isPending) {
        showToast({
          title: 'Private swap in progress',
          message: 'Wait for signing and submission to finish.',
          variant: 'info',
        });
        return;
      }

      showToast({
        title: 'Signing private swap',
        message: 'Approve the wallet request to execute.',
        variant: 'info',
        durationMs: 1800,
      });
      privateSwapMutation.mutate(privateReviewSwap);
      return;
    }

    if (reviewSwap == null) {
      showToast({
        title: 'Review required',
        message: 'Review the live quote before signing.',
        variant: 'warning',
      });
      return;
    }
    if (executeSwapMutation.isPending) {
      showToast({
        title: 'Swap in progress',
        message: 'Wait for signing and submission to finish.',
        variant: 'info',
      });
      return;
    }
    if (reviewQuoteExpired) {
      quoteController.refreshOnExpiry();
      return;
    }

    showToast({
      title: 'Signing swap',
      message: 'Approve the wallet request to execute.',
      variant: 'info',
      durationMs: 1800,
    });
    executeSwapMutation.mutate(reviewSwap.quote);
  };

  const handleCancelReviewSwap = () => {
    if (privateReviewSwap != null) {
      const cancelledReview = privateReviewSwap;

      if (privateSwapMutation.isPending) {
        showToast({
          title: 'Private swap in progress',
          message: 'Wait for signing and submission to finish.',
          variant: 'info',
        });
        return;
      }

      resetReviewSlider();
      swapInputActions.setProcessResult(
        buildPrivateSwapProcessResult({
          review: cancelledReview,
          variant: 'cancelled',
          title: 'Private swap cancelled',
          message: 'No transaction was signed or submitted.',
          statusLabel: 'Cancelled',
          extraRows: [{ label: 'Status', value: 'User cancelled' }],
        }),
      );
      showToast({
        title: 'Private swap cancelled',
        message: 'No transaction was submitted.',
        variant: 'info',
      });
      return;
    }

    if (executeSwapMutation.isPending) {
      showToast({
        title: 'Swap in progress',
        message: 'Wait for signing and submission to finish.',
        variant: 'info',
      });
      return;
    }
    if (lastSwapResult != null || processResult?.variant === 'success') {
      setReviewSwap(null);
      return;
    }

    const resultScreen = buildSwapProcessResult({
      variant: 'cancelled',
      title: 'Swap cancelled',
      message: 'No transaction was signed or submitted.',
      statusLabel: 'Cancelled',
      extraRows: [{ label: 'Status', value: 'User cancelled' }],
    });
    resetReviewSlider();
    if (resultScreen != null) {
      swapInputActions.setProcessResult(resultScreen);
    }
    showToast({
      title: 'Swap cancelled',
      message: 'No transaction was submitted.',
      variant: 'info',
    });
  };

  const handleDismissProcessResult = () => {
    swapInputActions.setProcessResult(null);
  };

  const handleOpenAdvancedModes = () => {
    const params = new URLSearchParams();
    if (payToken?.mint != null) params.set('inputMint', payToken.mint);
    if (receiveToken?.mint != null) params.set('outputMint', receiveToken.mint);
    if (currentInputAmount != null) params.set('amount', currentInputAmount);
    const query = params.toString();
    router.push((query.length > 0 ? `/advanced-swap?${query}` : '/advanced-swap') as never);
  };

  const compactSwap = windowWidth < 390 || windowHeight < 820 || fontScale > 1.05;
  const denseSwap = windowWidth < 350 || windowHeight < 720 || fontScale > 1.18;
  const screenHorizontalPadding = denseSwap
    ? spacing.md
    : compactSwap
      ? spacing.lg
      : spacing['2xl'];
  const sectionGap = denseSwap ? spacing.sm : compactSwap ? 10 : spacing.md;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <GradientBackground />
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: denseSwap ? spacing.sm : compactSwap ? spacing.md : spacing.lg,
                paddingBottom:
                  Math.max(insets.bottom, spacing.sm) + (denseSwap ? spacing.sm : spacing.md),
                paddingHorizontal: screenHorizontalPadding,
                gap: sectionGap,
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
          >
            <Animated.View
              entering={FadeIn.duration(400).delay(100)}
              style={[styles.contentFrame, styles.header]}
            >
              <HeaderIconButton onPress={handleBack} accessibilityLabel="Go back">
                <Ionicons
                  name="chevron-back"
                  size={layout.iconSizeNav}
                  color={colors.brand.deepShadow}
                />
              </HeaderIconButton>
              <Text
                variant="h2"
                color={colors.text.inverse}
                style={styles.headerTitle}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                maxFontSizeMultiplier={1}
              >
                {privateSwapMode ? 'Private Swap' : 'Swap'}
              </Text>
              <HeaderIconButton
                onPress={handleOpenAdvancedModes}
                accessibilityLabel="Open advanced swap"
              >
                <PuffySettingsIcon
                  size={layout.iconSizeNav}
                  color={colors.brand.deepShadow}
                  focused
                />
              </HeaderIconButton>
            </Animated.View>

            <Animated.View entering={FadeIn.duration(400).delay(200)} style={styles.contentFrame}>
              <SwapCard
                payToken={payToken}
                receiveToken={receiveToken}
                payAmount={payAmount}
                receiveAmount={receiveAmount}
                onPayAmountChange={swapInputActions.setUserAmount}
                onFlip={handleFlip}
                onSelectToken={(type) => {
                  setSelectingFor(type);
                  setModalVisible(true);
                }}
              />
            </Animated.View>

            <Animated.View entering={FadeIn.duration(220).delay(240)} style={styles.contentFrame}>
              <PrivateSwapToggle
                enabled={privateSwapMode}
                available={privateSwapAvailable}
                setupLabel={privateSwapSetupLabel}
                policyLabel={privateSwapPolicyLabel}
                onToggle={handleTogglePrivateSwapMode}
              />
            </Animated.View>

            {showLiveSwapDetails ? (
              <Animated.View entering={FadeIn.duration(120)} style={styles.contentFrame}>
                <SwapDetailsCard
                  rateLabel={liveDetailsRateLabel}
                  priceImpactLabel={liveDetailsPriceImpactLabel}
                  feeLabel={liveDetailsFeeLabel}
                  routeLabel={liveDetailsRouteLabel}
                  slippageLabel={liveDetailsSlippageLabel}
                />
              </Animated.View>
            ) : null}

            {lastSwapResult != null && network != null ? (
              <Animated.View entering={FadeIn.duration(400).delay(325)} style={styles.contentFrame}>
                <SwapExecutionStatusCard
                  signature={lastSwapResult.signature}
                  network={network}
                  refreshedQuote={lastSwapResult.refreshedQuote}
                />
              </Animated.View>
            ) : null}

            {visibleSwapStatusMessage != null ? (
              <Animated.View
                entering={FadeIn.duration(400).delay(350)}
                style={[styles.contentFrame, styles.statusWrap]}
              >
                <Text variant="small" color={colors.text.tertiary} align="center">
                  {visibleSwapStatusMessage}
                </Text>
              </Animated.View>
            ) : null}

            <Animated.View entering={FadeIn.duration(400).delay(400)} style={styles.contentFrame}>
              <SwapConfirmationButton
                disabled={reviewButtonDisabled}
                feedbackLabel={activeSwapButtonFeedback?.label}
                feedbackTone={activeSwapButtonFeedback?.tone}
                holdOnComplete
                resetSignal={sliderResetSignal}
                label={
                  privateSwapMode
                    ? privateSwapMutation.isPending
                      ? 'Submitting Private Swap'
                      : 'Review Private Swap'
                    : executeSwapMutation.isPending
                      ? 'Submitting Swap'
                      : swapActionRefreshAvailable
                        ? 'Refresh Quote'
                        : quoteRetryAvailable
                          ? 'Retry Quote'
                          : quoteExpired
                            ? 'Refresh Quote'
                            : 'Review Swap'
                }
                onPress={handleReviewSwap}
              />
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

        <SwapReviewFlowScreen
          visible={reviewSwap != null || privateReviewSwap != null}
          title={privateReviewSwap != null ? 'Review private swap' : 'Review swap'}
          statusLabel={privateReviewSwap != null ? 'Private' : reviewStatusLabel}
          payLeg={privateReviewSwap?.payLeg ?? reviewSwap?.payLeg ?? null}
          receiveLeg={privateReviewSwap?.receiveLeg ?? reviewSwap?.receiveLeg ?? null}
          detailRows={privateReviewSwap?.detailRows ?? reviewDetailRows}
          confirmLabel="Sign & Execute"
          busyLabel="Signing & executing"
          busy={executeSwapMutation.isPending || privateSwapMutation.isPending}
          onCancel={handleCancelReviewSwap}
          onConfirm={handleConfirmReviewSwap}
        />

        <ProcessResultScreen
          visible={processResult != null}
          variant={processResult?.variant ?? 'success'}
          title={processResult?.title ?? ''}
          message={processResult?.message ?? ''}
          statusLabel={processResult?.statusLabel}
          tokenLegs={processResult?.tokenLegs ?? []}
          detailRows={processResult?.detailRows ?? []}
          primaryActionLabel="Back to Swap"
          onPrimaryAction={handleDismissProcessResult}
        />

        <TokenSelectorModal
          visible={modalVisible}
          tokens={tokenSelectorTokens}
          onClose={() => setModalVisible(false)}
          onSelect={handleTokenSelect}
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: SWAP_CONTENT_MAX_WIDTH,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerIconPressable: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: `0 16px 30px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.78), inset 0 -12px 24px rgba(91, 200, 232, 0.1)`,
  },
  headerIconPressed: {
    opacity: 0.72,
  },
  headerIconSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.display,
    textAlign: 'center',
  },
  statusWrap: {
    paddingHorizontal: spacing.md,
  },
  privateTogglePressable: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: `0 10px 22px rgba(14, 42, 53, 0.09), inset 0 1px 1px rgba(255, 255, 255, 0.72)`,
  },
  privateTogglePressableActive: {
    borderColor: colors.brand.azureCyan,
  },
  privateToggleSurface: {
    minHeight: 70,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  privateToggleCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  privateToggleTitle: {
    fontFamily: fontFamily.uiBold,
  },
  privateToggleMeta: {
    fontSize: 11,
    lineHeight: 15,
  },
  privateSwitchTrack: {
    width: 50,
    height: 30,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(14, 42, 53, 0.1)',
    borderWidth: 1.5,
    borderColor: colors.brand.azureCyan,
    padding: 3,
    justifyContent: 'center',
  },
  privateSwitchTrackActive: {
    backgroundColor: colors.brand.azureCyan,
    borderColor: colors.brand.azureBlue,
  },
  privateSwitchKnob: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    backgroundColor: colors.brand.azureCyan,
    borderWidth: 1,
    borderColor: colors.glass.rim,
  },
  privateSwitchKnobActive: {
    backgroundColor: colors.brand.whiteStream,
  },
});
