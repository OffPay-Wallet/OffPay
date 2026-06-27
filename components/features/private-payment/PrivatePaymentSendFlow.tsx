import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';

import { SendAmountStep } from '@/components/features/private-payment/send-flow/SendAmountStep';
import { SendRecipientStep } from '@/components/features/private-payment/send-flow/SendRecipientStep';
import {
  SendSummarySheet,
  type SendSheetPhase,
} from '@/components/features/private-payment/send-flow/SendSummarySheet';
import { SendTokenSelectStep } from '@/components/features/private-payment/send-flow/SendTokenSelectStep';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import {
  type ProcessResultDetailRow,
  type ProcessResultTokenLeg,
  type ProcessResultVariant,
} from '@/components/ui/ProcessResultScreen';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useMagicBlockPrivatePaymentFeeEstimate } from '@/hooks/useMagicBlockPrivatePaymentFeeEstimate';
import { useNormalTransferFeeEstimate } from '@/hooks/useNormalTransferFeeEstimate';
import { useUmbraPrivateP2PFeeEstimate } from '@/hooks/useUmbraPrivateP2PFeeEstimate';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useOffpayPortfolioValuation } from '@/hooks/useOffpayPortfolioValuation';
import { useActiveWalletSigningCapability } from '@/hooks/useActiveWalletSigningCapability';
import { useUmbraVaultFeeAccountReadiness } from '@/hooks/useUmbraVaultFeeAccountReadiness';
import {
  offlinePaymentSlotsQueryKey,
  setOfflinePaymentSlotsQueryData,
  useOfflinePaymentSlots,
} from '@/hooks/useOfflinePaymentSlots';
import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  buildStablecoinMetadataLookup,
  buildVisibleTokenHoldings,
  formatLamportsAsSol,
  shortenWalletAddress,
} from '@/lib/api/offpay-wallet-data';
import {
  offpayWalletDashboardBaseQueryKey,
  offpayWalletBalanceQueryKey,
  offpayWalletTokenTransactionsBaseQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  pendingBackupQueueStatsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { presentWalletTransactionEventNotification } from '@/lib/notifications/local-notifications';
import { loadOfflinePaymentSlotSnapshot } from '@/lib/offline/offline-payment-slots';
import { parseRecipientInput, type RecipientCandidate } from '@/lib/identity/recipient-parser';
import { resolveSnsName } from '@/lib/identity/sns';
import { submitPrivatePayment } from '@/lib/magicblock/private-payment';
import { getResponsiveFooterBottomPadding, getViewportProfile } from '@/lib/ui/responsive-layout';
import {
  isRnZkProverNativeModuleAvailable,
  RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE,
} from '@/lib/umbra/umbra-rn-zk-prover';
import { applyCachedOfflineDebit } from '@/lib/wallet/wallet-display-cache';
import { formatFiatCurrency, normalizeCurrency } from '@/lib/currency-rates';
import { resolveXHandle, XHandleNotRegisteredError } from '@/lib/identity/x-handle';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  PrivatePaymentRoute,
  PrivatePaymentRouteOption,
  RecentRecipientOption,
} from './send-flow/types';
import {
  buildExplorerUrl,
  classifySendFailure,
  getMutationErrorMessage,
  getRecipientStepDisabledReason,
  getStablecoinOptions,
  isAmountWithinBalance,
  isMagicBlockPrivateToken,
  isPositiveRawAmount,
  isUmbraPrivateP2PToken,
  NATIVE_SOL_MINT,
  NATIVE_SOL_SEND_MINT,
  normalizeTokenSymbol,
  routeMintMatchesToken,
  withSendTimeout,
  type StablecoinOption,
} from './send-flow/helpers';

type SendStep = 'token' | 'recipient' | 'amount' | 'summary' | 'success';
type SendStepTransitionDirection = 'forward' | 'backward';
const MAX_AMOUNT_INPUT_CHARACTERS = 48;
const SEND_CONTENT_MAX_WIDTH = 430;
const UMBRA_PRIVATE_P2P_SEND_TIMEOUT_MS = 300_000;
const FEE_ESTIMATE_INPUT_DEBOUNCE_MS = 220;
const SEND_HEADER_SHADOW =
  '0 14px 30px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
const SEND_STEP_TRANSITION_DURATION_MS = 260;
const SEND_STEP_ORDER: Record<SendStep, number> = {
  token: 0,
  recipient: 1,
  amount: 2,
  summary: 3,
  success: 4,
};

function getSendStepTransitionDirection(
  currentStep: SendStep,
  nextStep: SendStep,
): SendStepTransitionDirection {
  return SEND_STEP_ORDER[nextStep] >= SEND_STEP_ORDER[currentStep] ? 'forward' : 'backward';
}

function getSendStepEnteringAnimation(direction: SendStepTransitionDirection) {
  const animation = direction === 'backward' ? SlideInLeft : SlideInRight;
  return animation.duration(SEND_STEP_TRANSITION_DURATION_MS).easing(Easing.out(Easing.cubic));
}

function getSendStepExitingAnimation(direction: SendStepTransitionDirection) {
  const animation = direction === 'backward' ? SlideOutRight : SlideOutLeft;
  return animation.duration(SEND_STEP_TRANSITION_DURATION_MS).easing(Easing.out(Easing.cubic));
}

interface SendResultView {
  status: 'submitted' | 'queued';
  id: string;
  amount: string;
  symbol: string;
  recipient: string;
  network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;
}

type PrivateSendSubmissionResult =
  | {
      status: 'submitted';
      signature: string;
      txId?: null;
      initSignature: string | null;
      message: string;
    }
  | {
      status: 'queued';
      signature?: null;
      txId: string;
      initSignature: string | null;
      message: string;
    };

interface SendProcessResultState {
  variant: ProcessResultVariant;
  title: string;
  message: string;
  statusLabel: string;
  tokenLegs: ProcessResultTokenLeg[];
  detailRows: ProcessResultDetailRow[];
  primaryActionLabel: string;
  primaryAction: 'close' | 'review';
  secondaryActionLabel?: string;
  secondaryAction?: 'explorer' | 'copy-reference';
}

interface ResolvedRecipientView {
  /** Raw user input (trimmed) that produced this resolution. */
  input: string;
  /** Resolved Solana address (base58). */
  address: string;
  /** Identity that we resolved against. */
  identity:
    | { kind: 'sns'; domain: string }
    | { kind: 'x-handle'; handle: string; source: 'sns-twitter' };
}

function runAfterLoadingPaint(task: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(task, 0);
  });
}

function HeaderIconButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.headerIconPressable,
        pressed ? styles.headerControlPressed : null,
      ]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.headerIconSurface]}>
        {children}
      </View>
    </Pressable>
  );
}

export function PrivatePaymentSendFlow(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width, height, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const params = useLocalSearchParams<{
    recipient?: string;
    mint?: string;
    token?: string;
    amount?: string;
    bleName?: string;
    bleServiceUuid?: string;
    qrSession?: string;
    advance?: string;
    route?: string;
  }>();
  const mountedRef = useRef(true);
  const submitInFlightRef = useRef(false);
  const appliedRouteParamsRef = useRef('');
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { network, unsupportedReason } = useOffpayNetwork();
  const { effectiveWalletMode, canUseNetwork, isNetworkSwitching } = useOffpayNetworkAccess();
  const { canSignWithApp, signingBlocker } = useActiveWalletSigningCapability();
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: false,
    eagerWithoutCapabilities: true,
  });
  const offlinePaymentSlots = useOfflinePaymentSlots({
    deferCapabilitiesUntilAfterInteractions: false,
  });
  const tokenLogoMap = useOffpayTokenLogoMap({
    deferCapabilitiesUntilAfterInteractions: false,
  });
  const addOfflineReceipt = useOfflinePaymentStore((state) => state.addReceipt);
  const clearRecipientHistory = useOfflinePaymentStore((state) => state.clearRecipientHistory);
  const offlineReceipts = useOfflinePaymentStore((state) => state.receipts);
  const recipientHistoryClearedAt = useOfflinePaymentStore((state) =>
    walletAddress == null ? 0 : (state.recipientHistoryClearedAtByWallet[walletAddress] ?? 0),
  );
  const addPrivateReceipt = usePrivatePaymentStore((state) => state.addReceipt);

  const [step, setStep] = useState<SendStep>('token');
  const [stepTransitionDirection, setStepTransitionDirection] =
    useState<SendStepTransitionDirection>('forward');
  const [_resultTransitionDirection, setResultTransitionDirection] =
    useState<SendStepTransitionDirection>('forward');
  const stepRef = useRef<SendStep>('token');
  const [query, setQuery] = useState('');
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [resolvedRecipient, setResolvedRecipient] = useState<ResolvedRecipientView | null>(null);
  const [recipientResolutionError, setRecipientResolutionError] = useState<string | null>(null);
  const [recipientResolving, setRecipientResolving] = useState(false);
  const [amount, setAmount] = useState('');
  const [clipboardRecipient, setClipboardRecipient] = useState<string | null>(null);
  const [offlineSending, setOfflineSending] = useState(false);
  const [normalSending, setNormalSending] = useState(false);
  const [privateSending, setPrivateSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResultView | null>(null);
  const [_sendProcessResult, setSendProcessResult] = useState<SendProcessResultState | null>(null);
  const [selectedPrivateRoute, setSelectedPrivateRoute] = useState<PrivatePaymentRoute | null>(
    null,
  );

  const pendingStepFrameRef = useRef<number | null>(null);

  const transitionToStep = useCallback(
    (nextStep: SendStep, direction?: SendStepTransitionDirection): void => {
      const currentStep = stepRef.current;
      if (currentStep === nextStep) return;

      stepRef.current = nextStep;
      const resolvedDirection = direction ?? getSendStepTransitionDirection(currentStep, nextStep);
      setStepTransitionDirection(resolvedDirection);
      // Defer the step swap by one frame so the outgoing view first
      // re-renders with the updated `exiting` direction, then
      // unmounts. Without this split, React batches both state
      // updates into a single render, so the outgoing Animated.View
      // unmounts with the previously captured (stale) exiting
      // animation. That stale prop is what makes the iOS back
      // transition look like it slides "randomly" — both the
      // outgoing and incoming panes animate in the forward
      // direction even though the user is navigating backward.
      if (pendingStepFrameRef.current != null) {
        cancelAnimationFrame(pendingStepFrameRef.current);
      }
      pendingStepFrameRef.current = requestAnimationFrame(() => {
        pendingStepFrameRef.current = null;
        if (!mountedRef.current) return;
        setStep(nextStep);
      });
    },
    [],
  );

  const supportedStablecoins = capabilitiesQuery.capabilities?.offline?.supportedStablecoins;
  const stablecoins = useMemo(
    () =>
      getStablecoinOptions(
        balanceQuery.data,
        network,
        supportedStablecoins,
        tokenLogoMap,
        effectiveWalletMode !== 'offline',
      ),
    [balanceQuery.data, effectiveWalletMode, network, supportedStablecoins, tokenLogoMap],
  );
  const selectedToken = useMemo(
    () => stablecoins.find((token) => token.mint === selectedMint) ?? null,
    [selectedMint, stablecoins],
  );

  // Real-time fiat valuation for the entered amount. Reuses the
  // perf-tuned portfolio valuation infra (UI-thread yields, price
  // cache, capped concurrency) instead of fetching prices here. Only
  // enabled on the amount step so the price query doesn't run while the
  // user is still picking a token or recipient.
  const displayCurrency = usePreferencesStore((s) => s.currency);
  const valuationHoldings = useMemo(
    () =>
      balanceQuery.data == null
        ? []
        : buildVisibleTokenHoldings(
            balanceQuery.data,
            tokenLogoMap,
            buildStablecoinMetadataLookup(supportedStablecoins),
          ),
    [balanceQuery.data, supportedStablecoins, tokenLogoMap],
  );
  const amountValuationQuery = useOffpayPortfolioValuation({
    holdings: valuationHoldings,
    currency: displayCurrency,
    enabled: step === 'token' || step === 'amount' || step === 'summary',
  });
  // Resolve the selected token's unit USD price from the valuation
  // result. Native SOL is keyed in holdings by its wrapped mint, while
  // the send list uses the `native-sol` sentinel — map between them.
  const selectedTokenUnitUsdPrice = useMemo(() => {
    if (selectedToken == null) return null;
    const prices = amountValuationQuery.data?.unitUsdPrices;
    if (prices == null) return null;
    const priceMint =
      selectedToken.mint === NATIVE_SOL_SEND_MINT ? NATIVE_SOL_MINT : selectedToken.mint;
    const price = prices[priceMint];
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  }, [amountValuationQuery.data, selectedToken]);
  const filteredStablecoins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) return stablecoins;
    return stablecoins.filter((token) => {
      return (
        token.symbol.toLowerCase().includes(normalizedQuery) ||
        token.name.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [query, stablecoins]);

  const capabilities = capabilitiesQuery.capabilities;
  const magicBlockInitMintCapability = getOffpayFeatureCapability(
    capabilities,
    'payment.privateInitMint',
  );
  const magicBlockPrivateSendCapability = getOffpayFeatureCapability(
    capabilities,
    'payment.privateSend',
  );
  const magicBlockRpcBroadcastCapability = getOffpayFeatureCapability(
    capabilities,
    'payment.rpcBroadcast',
  );
  const magicBlockPrivatePaymentDisabledReason = signingBlocker
    ? signingBlocker
    : !magicBlockInitMintCapability.available
      ? magicBlockInitMintCapability.message
      : !magicBlockPrivateSendCapability.available
        ? magicBlockPrivateSendCapability.message
        : !magicBlockRpcBroadcastCapability.available
          ? magicBlockRpcBroadcastCapability.message
          : null;
  const canUseMagicBlockPrivatePayment = magicBlockPrivatePaymentDisabledReason == null;
  const canUseUmbraNativeProver = isRnZkProverNativeModuleAvailable();
  const umbraPrivateP2pCapability = getOffpayFeatureCapability(
    capabilities,
    'payment.umbraPrivateP2p',
  );
  const umbraExecutionCapability = getOffpayFeatureCapability(capabilities, 'umbra.execution');
  const rpcBroadcastCapability = getOffpayFeatureCapability(capabilities, 'payment.rpcBroadcast');
  const selectedTokenSupportsUmbraPrivateP2P =
    network != null && selectedToken != null && isUmbraPrivateP2PToken(network, selectedToken);
  const canUseUmbraPrivateP2PBase =
    canSignWithApp &&
    canUseUmbraNativeProver &&
    isOffpayFeatureAvailable(capabilities, 'payment.umbraPrivateP2p') &&
    isOffpayFeatureAvailable(capabilities, 'umbra.execution') &&
    isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast');
  const umbraVaultReadinessQuery = useUmbraVaultFeeAccountReadiness({
    action: 'privateP2pFromPublic',
    mint: selectedTokenSupportsUmbraPrivateP2P ? selectedToken?.mint : null,
    network,
    enabled: canUseUmbraPrivateP2PBase && selectedTokenSupportsUmbraPrivateP2P,
  });
  const umbraVaultDisabledReason =
    canUseUmbraPrivateP2PBase && selectedTokenSupportsUmbraPrivateP2P
      ? umbraVaultReadinessQuery.readiness?.available === false
        ? umbraVaultReadinessQuery.readiness.missingAccounts.some((account) =>
            account.validationError?.includes('layout'),
          )
          ? 'Token/network vault needs Umbra migration.'
          : 'Token/network vault is not enabled.'
        : umbraVaultReadinessQuery.isError
          ? 'Unable to verify Umbra vault readiness.'
          : umbraVaultReadinessQuery.readiness == null || umbraVaultReadinessQuery.isFetching
            ? 'Checking Umbra vault readiness.'
            : null
      : null;
  const canUseUmbraPrivateP2P =
    canUseUmbraPrivateP2PBase && umbraVaultReadinessQuery.readiness?.available === true;
  const umbraPrivateP2pDisabledReason = signingBlocker
    ? signingBlocker
    : !canUseUmbraNativeProver
      ? RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE
      : !umbraPrivateP2pCapability.available
        ? umbraPrivateP2pCapability.message
        : !umbraExecutionCapability.available
          ? umbraExecutionCapability.message
          : !rpcBroadcastCapability.available
            ? rpcBroadcastCapability.message
            : umbraVaultDisabledReason;
  const offlineReadySlots = offlinePaymentSlots.snapshot?.counts.ready ?? 0;

  const amountRaw = useMemo(
    () =>
      selectedToken == null ? null : decimalInputToAtomicAmount(amount, selectedToken.decimals),
    [amount, selectedToken],
  );
  const [feeEstimateAmountRaw, setFeeEstimateAmountRaw] = useState<string | null>(null);

  useEffect(() => {
    if (!isPositiveRawAmount(amountRaw)) {
      setFeeEstimateAmountRaw(null);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setFeeEstimateAmountRaw(amountRaw);
    }, FEE_ESTIMATE_INPUT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [amountRaw]);

  const balanceRaw = useMemo(
    () =>
      selectedToken == null
        ? null
        : decimalInputToAtomicAmount(selectedToken.balance, selectedToken.decimals),
    [selectedToken],
  );
  const normalizedRecipient = recipient.trim();
  const recipientCandidate = useMemo<RecipientCandidate>(
    () => parseRecipientInput(normalizedRecipient),
    [normalizedRecipient],
  );
  const recipientIsAddress = recipientCandidate.kind === 'address';
  const normalizedSnsDomain =
    recipientCandidate.kind === 'sns'
      ? recipientCandidate.domain
      : recipientCandidate.kind === 'ambiguous'
        ? recipientCandidate.sns
        : null;
  const normalizedXHandle =
    recipientCandidate.kind === 'x'
      ? recipientCandidate.handle
      : recipientCandidate.kind === 'ambiguous'
        ? recipientCandidate.x
        : null;
  const resolvedRecipientAddress =
    resolvedRecipient != null && resolvedRecipient.input === normalizedRecipient
      ? resolvedRecipient.address
      : null;
  const effectiveRecipientAddress = recipientIsAddress
    ? recipientCandidate.address
    : resolvedRecipientAddress;
  const routeRecipientBleName =
    typeof params.bleName === 'string' && params.bleName.trim().length > 0
      ? params.bleName.trim()
      : null;
  const offlineRecipientBleName = routeRecipientBleName;
  const recipientCanResolveOnline =
    (normalizedSnsDomain != null || normalizedXHandle != null) &&
    effectiveWalletMode !== 'offline' &&
    canUseNetwork;
  const amountValid = isAmountWithinBalance(amountRaw, balanceRaw);
  const selfSend = walletAddress != null && effectiveRecipientAddress === walletAddress;
  const paymentRouteOptions = useMemo<PrivatePaymentRouteOption[]>(() => {
    if (effectiveWalletMode === 'offline' || selectedToken == null) return [];

    const routes: PrivatePaymentRouteOption[] = [
      {
        id: 'normal',
        label: 'Normal',
        description: 'Public transfer',
      },
    ];

    if (isMagicBlockPrivateToken(network, selectedToken)) {
      routes.push({
        id: 'magicblock',
        label: 'MagicBlock',
        description:
          magicBlockPrivatePaymentDisabledReason == null
            ? 'Private route'
            : magicBlockPrivatePaymentDisabledReason,
        disabled: !canUseMagicBlockPrivatePayment,
        disabledReason: magicBlockPrivatePaymentDisabledReason ?? undefined,
      });
    }
    if (isUmbraPrivateP2PToken(network, selectedToken)) {
      routes.push({
        id: 'umbra',
        label: 'Umbra',
        description:
          umbraPrivateP2pDisabledReason == null ? 'Mixer route' : umbraPrivateP2pDisabledReason,
        disabled: !canUseUmbraPrivateP2P,
        disabledReason: umbraPrivateP2pDisabledReason ?? undefined,
      });
    }
    return routes;
  }, [
    canUseMagicBlockPrivatePayment,
    effectiveWalletMode,
    canUseUmbraPrivateP2P,
    magicBlockPrivatePaymentDisabledReason,
    network,
    selectedToken,
    umbraPrivateP2pDisabledReason,
  ]);
  const effectivePaymentRoute = useMemo<PrivatePaymentRoute | null>(() => {
    const enabledRoutes = paymentRouteOptions.filter((route) => route.disabled !== true);
    if (enabledRoutes.length === 0) return null;
    if (
      selectedPrivateRoute != null &&
      enabledRoutes.some((route) => route.id === selectedPrivateRoute)
    ) {
      return selectedPrivateRoute;
    }
    return enabledRoutes[0].id;
  }, [paymentRouteOptions, selectedPrivateRoute]);
  const paymentRouteModeLabel =
    effectiveWalletMode === 'offline'
      ? 'Offline P2P'
      : effectivePaymentRoute === 'magicblock'
        ? 'MagicBlock private payment'
        : effectivePaymentRoute === 'umbra'
          ? 'Umbra private P2P'
          : 'Normal transfer';

  // Live network-fee estimates use getFeeForMessage on the exact
  // transaction message for the selected route. Normal transfers
  // compile locally; MagicBlock private sends prepare an unsigned
  // transaction through the worker, verify it locally, then price
  // that message before the user slides.
  const normalFeeEstimateEnabled =
    effectiveWalletMode !== 'offline' && effectivePaymentRoute === 'normal';
  const normalFeeEstimate = useNormalTransferFeeEstimate({
    walletAddress,
    recipient: effectiveRecipientAddress,
    mint: selectedToken?.mint ?? null,
    rawAmount: amountRaw,
    decimals: selectedToken?.decimals ?? null,
    network,
    enabled: normalFeeEstimateEnabled,
  });
  const feeEstimateMatchesAmount =
    feeEstimateAmountRaw != null && feeEstimateAmountRaw === amountRaw;
  const magicBlockFeeEstimate = useMagicBlockPrivatePaymentFeeEstimate({
    walletAddress,
    recipient: effectiveRecipientAddress,
    mint: selectedToken?.mint ?? null,
    rawAmount: feeEstimateAmountRaw,
    network,
    enabled:
      effectiveWalletMode !== 'offline' &&
      effectivePaymentRoute === 'magicblock' &&
      selectedToken != null &&
      effectiveRecipientAddress != null &&
      feeEstimateAmountRaw != null &&
      walletAddress != null &&
      walletId != null &&
      network != null &&
      !offlineSending &&
      !normalSending &&
      !privateSending,
  });
  const umbraFeeEstimate = useUmbraPrivateP2PFeeEstimate({
    walletAddress,
    walletId,
    recipient: effectiveRecipientAddress,
    token: selectedToken?.mint ?? null,
    amount:
      selectedToken == null || feeEstimateAmountRaw == null
        ? null
        : sanitizeDecimalInput(amount, selectedToken.decimals),
    rawAmount: feeEstimateAmountRaw,
    network,
    enabled:
      step === 'summary' &&
      effectiveWalletMode !== 'offline' &&
      effectivePaymentRoute === 'umbra' &&
      selectedToken != null &&
      effectiveRecipientAddress != null &&
      feeEstimateAmountRaw != null &&
      feeEstimateMatchesAmount &&
      walletAddress != null &&
      walletId != null &&
      network != null &&
      !offlineSending &&
      !normalSending &&
      !privateSending,
  });
  const networkFeeLabel = useMemo(() => {
    if (effectiveWalletMode === 'offline') return 'Paid at settlement';
    if (effectivePaymentRoute === 'normal') {
      if (normalFeeEstimate.estimate?.lamports != null) {
        return `${formatLamportsAsSol(normalFeeEstimate.estimate.lamports, 9)} SOL`;
      }
      if (normalFeeEstimate.isFetching) return 'Estimating';
      if (normalFeeEstimate.isError) return 'Fee unavailable';
      return 'Fee unavailable';
    }
    if (effectivePaymentRoute === 'magicblock') {
      if (feeEstimateMatchesAmount && magicBlockFeeEstimate.plan != null) {
        const walletPaysSolFee =
          walletAddress != null &&
          (magicBlockFeeEstimate.plan.solFeePayer == null ||
            magicBlockFeeEstimate.plan.solFeePayer === walletAddress);
        if (walletPaysSolFee && magicBlockFeeEstimate.plan.feeLamports != null) {
          return `${formatLamportsAsSol(magicBlockFeeEstimate.plan.feeLamports, 9)} SOL`;
        }
      }
      if (!feeEstimateMatchesAmount || magicBlockFeeEstimate.isFetching) return 'Estimating';
      if (magicBlockFeeEstimate.isError) return 'Fee unavailable';
      return 'Fee unavailable';
    }
    if (effectivePaymentRoute === 'umbra') {
      if (feeEstimateMatchesAmount && umbraFeeEstimate.estimate?.lamports != null) {
        return `${formatLamportsAsSol(umbraFeeEstimate.estimate.lamports, 9)} SOL`;
      }
      if (!feeEstimateMatchesAmount || umbraFeeEstimate.isFetching) return 'Estimating';
      if (umbraFeeEstimate.isError) return 'Fee unavailable';
      return 'Fee unavailable';
    }
    return 'Fee unavailable';
  }, [
    effectivePaymentRoute,
    effectiveWalletMode,
    feeEstimateMatchesAmount,
    magicBlockFeeEstimate.isError,
    magicBlockFeeEstimate.isFetching,
    magicBlockFeeEstimate.plan,
    normalFeeEstimate.estimate,
    normalFeeEstimate.isError,
    normalFeeEstimate.isFetching,
    umbraFeeEstimate.estimate,
    umbraFeeEstimate.isError,
    umbraFeeEstimate.isFetching,
    walletAddress,
  ]);
  const viewportProfile = getViewportProfile({
    width,
    height,
    fontScale,
    topInset: insets.top,
    bottomInset: insets.bottom,
  });
  const compactSend = viewportProfile.compact;
  const denseSend = viewportProfile.dense;
  const screenHorizontalPadding = viewportProfile.horizontalPadding;
  const sectionGap = viewportProfile.sectionGap;
  const footerButtonHeight = viewportProfile.bottomActionHeight;
  const footerBottomPadding = getResponsiveFooterBottomPadding(insets.bottom, denseSend);
  const footerTopPadding = denseSend ? spacing.sm : spacing.md;
  const footerHorizontalPadding = Math.max(
    (width - SEND_CONTENT_MAX_WIDTH) / 2,
    screenHorizontalPadding,
  );
  const amountMetaLabel = useMemo(() => {
    const trimmed = amount.trim();
    if (selectedToken == null || trimmed.length === 0) {
      return formatFiatCurrency(0, normalizeCurrency(displayCurrency));
    }
    const enteredAmount = Number.parseFloat(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(enteredAmount) || enteredAmount <= 0) {
      return formatFiatCurrency(0, normalizeCurrency(displayCurrency));
    }
    const rate = amountValuationQuery.data?.rate;
    if (selectedTokenUnitUsdPrice == null || rate == null) {
      // Price not resolved yet — fall back to the token amount so the
      // label never shows a misleading $0 while pricing settles.
      return `~${trimmed} ${selectedToken.symbol}`;
    }
    const fiatValue = enteredAmount * selectedTokenUnitUsdPrice * rate;
    return formatFiatCurrency(fiatValue, amountValuationQuery.data?.currency ?? displayCurrency);
  }, [
    amount,
    amountValuationQuery.data,
    displayCurrency,
    selectedToken,
    selectedTokenUnitUsdPrice,
  ]);
  const recentRecipients = useMemo<RecentRecipientOption[]>(() => {
    const byAddress = new Map<string, RecentRecipientOption>();

    for (const receipt of offlineReceipts) {
      if (receipt.direction !== 'send' || receipt.recipient == null) continue;
      if (walletAddress != null && receipt.recipient === walletAddress) continue;
      const usedAt = receipt.createdAt;
      if (usedAt <= recipientHistoryClearedAt) continue;

      const current = byAddress.get(receipt.recipient);
      if (current == null || usedAt > current.usedAt) {
        byAddress.set(receipt.recipient, {
          address: receipt.recipient,
          usedAt,
        });
      }
    }

    return [...byAddress.values()].sort((left, right) => right.usedAt - left.usedAt).slice(0, 4);
  }, [offlineReceipts, recipientHistoryClearedAt, walletAddress]);
  const closeToHome = useCallback(() => {
    Keyboard.dismiss();
    // Prefer dismissing the pushed send route back to the tabs. If this
    // route is the stack root (deep link / fresh entry) `dismissTo`
    // can't pop, so fall back to a replace — never leave the user on a
    // frozen sheet.
    if (router.canGoBack()) {
      router.dismissTo('/');
      return;
    }
    router.replace('/');
  }, [router]);
  const handleClearRecentRecipients = useCallback(() => {
    if (walletAddress == null || recentRecipients.length === 0) return;

    clearRecipientHistory(walletAddress);
    showToast({
      title: 'Wallet history cleared',
      message: 'Recipients cleared',
      variant: 'success',
    });
  }, [clearRecipientHistory, recentRecipients.length, showToast, walletAddress]);
  const beginSubmit = useCallback(() => {
    if (submitInFlightRef.current) return false;
    submitInFlightRef.current = true;
    return true;
  }, []);
  const endSubmit = useCallback(() => {
    submitInFlightRef.current = false;
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (pendingStepFrameRef.current != null) {
        cancelAnimationFrame(pendingStepFrameRef.current);
        pendingStepFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    setSelectedPrivateRoute(null);
  }, [effectiveWalletMode, network, selectedMint]);

  useEffect(() => {
    if (step !== 'recipient') return;
    let cancelled = false;

    Clipboard.getStringAsync()
      .then((value) => {
        if (cancelled) return;
        const trimmed = value.trim();
        // Accept addresses, SNS names, and X handles. The unified
        // parser keeps this in lockstep with the input parser the
        // continue handler dispatches against.
        const candidate = trimmed.length > 0 ? parseRecipientInput(trimmed) : { kind: 'invalid' };
        setClipboardRecipient(candidate.kind === 'invalid' ? null : trimmed);
      })
      .catch(() => {
        if (!cancelled) setClipboardRecipient(null);
      });

    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    const requestedRecipient = typeof params.recipient === 'string' ? params.recipient.trim() : '';
    const requestedMint = typeof params.mint === 'string' ? params.mint.trim() : '';
    const requestedSymbol =
      typeof params.token === 'string' ? normalizeTokenSymbol(params.token) : '';
    const requestedAmount = typeof params.amount === 'string' ? params.amount.trim() : '';
    const requestedBleName = typeof params.bleName === 'string' ? params.bleName.trim() : '';
    const requestedQrSession = typeof params.qrSession === 'string' ? params.qrSession.trim() : '';
    const requestedAdvance = typeof params.advance === 'string' ? params.advance.trim() : '';
    const requestedRoute = typeof params.route === 'string' ? params.route.trim() : '';
    const routeKey = [
      requestedRecipient,
      requestedMint,
      requestedSymbol,
      requestedAmount,
      requestedBleName,
      requestedQrSession,
      requestedAdvance,
      requestedRoute,
    ].join('|');

    if (routeKey.replace(/\|/g, '').length === 0 || routeKey === appliedRouteParamsRef.current) {
      return;
    }

    const hasTokenRequest = requestedMint.length > 0 || requestedSymbol.length > 0;
    const routeToken = hasTokenRequest
      ? (stablecoins.find(
          (token) =>
            routeMintMatchesToken(requestedMint, token) ||
            (requestedSymbol.length > 0 && normalizeTokenSymbol(token.symbol) === requestedSymbol),
        ) ?? null)
      : stablecoins.length === 1
        ? stablecoins[0]
        : null;

    if (
      hasTokenRequest &&
      routeToken == null &&
      (balanceQuery.isLoading || capabilitiesQuery.isCapabilitiesPending)
    ) {
      return;
    }

    if (requestedRecipient.length > 0) {
      setRecipient(requestedRecipient);
      setResolvedRecipient(null);
      setRecipientResolutionError(null);
    }

    if (routeToken != null) {
      setSelectedMint(routeToken.mint);
    }

    if (requestedAmount.length > 0) {
      setAmount(
        sanitizeDecimalInput(requestedAmount, routeToken?.decimals ?? selectedToken?.decimals ?? 6),
      );
    }

    if (
      requestedRoute === 'normal' ||
      requestedRoute === 'magicblock' ||
      requestedRoute === 'umbra'
    ) {
      setSelectedPrivateRoute(requestedRoute);
    }

    if (requestedRecipient.length > 0) {
      transitionToStep(
        routeToken != null && (requestedAmount.length > 0 || requestedAdvance === 'amount')
          ? 'amount'
          : routeToken != null
            ? 'recipient'
            : 'token',
        'forward',
      );
    } else if (routeToken != null && requestedAdvance === 'recipient') {
      transitionToStep('recipient', 'forward');
    }

    appliedRouteParamsRef.current = routeKey;
  }, [
    balanceQuery.isLoading,
    capabilitiesQuery.isCapabilitiesPending,
    params.advance,
    params.amount,
    params.bleName,
    params.mint,
    params.qrSession,
    params.recipient,
    params.route,
    params.token,
    selectedToken?.decimals,
    stablecoins,
    transitionToStep,
  ]);

  useEffect(() => {
    if (selectedMint == null) return;
    if (stablecoins.some((token) => token.mint === selectedMint)) return;
    setSelectedMint(null);
    setAmount('');
    transitionToStep('token', 'backward');
  }, [selectedMint, stablecoins, transitionToStep]);

  const handleBack = useCallback(() => {
    Keyboard.dismiss();

    if (step === 'success') {
      closeToHome();
      return;
    }

    if (step === 'summary') {
      transitionToStep('amount', 'backward');
      return;
    }

    if (step === 'amount') {
      transitionToStep('recipient', 'backward');
      return;
    }

    if (step === 'recipient') {
      transitionToStep('token', 'backward');
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    closeToHome();
  }, [closeToHome, router, step, transitionToStep]);

  const handleScanRecipient = useCallback(() => {
    Keyboard.dismiss();

    const searchParams = new URLSearchParams();
    searchParams.set('returnTo', 'send');
    if (selectedToken != null) {
      searchParams.set('mint', selectedToken.mint);
    }

    router.navigate(`/(tabs)/scanner?${searchParams.toString()}` as never);
  }, [router, selectedToken]);

  const handleOpenNearbyWalletScanner = useCallback(() => {
    Keyboard.dismiss();

    const searchParams = new URLSearchParams();
    if (selectedToken != null) {
      searchParams.set('mint', selectedToken.mint);
      searchParams.set('token', selectedToken.symbol);
    }
    if (amount.trim().length > 0) {
      searchParams.set('amount', amount.trim());
    }

    router.navigate(`/nearby-wallet-scanner?${searchParams.toString()}` as never);
  }, [amount, router, selectedToken]);

  const handleRecipientChange = useCallback((value: string) => {
    setRecipient(value);
    setRecipientResolutionError(null);
    setResolvedRecipient((current) => {
      if (current == null || current.input === value.trim()) return current;
      return null;
    });
  }, []);

  const handleUseClipboardRecipient = useCallback(() => {
    // Always re-read the clipboard live on tap so the paste is
    // authoritative — the probed `clipboardRecipient` can be stale
    // (clipboard changed after the step mounted) or still null (probe
    // not resolved yet), which previously made the tap silently no-op.
    // Fall back to the cached suggestion only if the live read is empty
    // (e.g. the OS denied a second clipboard read on Android).
    void Clipboard.getStringAsync()
      .then((value) => {
        const normalized = value.trim();
        if (normalized.length > 0) {
          handleRecipientChange(normalized);
          return;
        }
        if (clipboardRecipient != null) {
          handleRecipientChange(clipboardRecipient);
        }
      })
      .catch(() => {
        if (clipboardRecipient != null) {
          handleRecipientChange(clipboardRecipient);
        }
      });
  }, [clipboardRecipient, handleRecipientChange]);

  const handleSelectRecentRecipient = useCallback(
    (address: string) => {
      handleRecipientChange(address);
    },
    [handleRecipientChange],
  );

  const handleSelectToken = useCallback(
    (token: StablecoinOption) => {
      Keyboard.dismiss();
      setSelectedMint(token.mint);
      setAmount('');
      transitionToStep('recipient', 'forward');
    },
    [transitionToStep],
  );

  const handleAmountChange = useCallback(
    (value: string) => {
      const nextAmount = sanitizeDecimalInput(value, selectedToken?.decimals ?? 6);
      setAmount(nextAmount.slice(0, MAX_AMOUNT_INPUT_CHARACTERS));
    },
    [selectedToken?.decimals],
  );

  const handleMaxAmount = useCallback(() => {
    if (selectedToken == null) return;
    setAmount(sanitizeDecimalInput(selectedToken.balance, selectedToken.decimals));
  }, [selectedToken]);

  const handleContinueRecipient = useCallback(async () => {
    Keyboard.dismiss();
    if (selectedToken == null) return;

    const trimmed = recipient.trim();
    const candidate = parseRecipientInput(trimmed);

    if (candidate.kind === 'address') {
      setResolvedRecipient(null);
      setRecipientResolutionError(null);
      transitionToStep('amount', 'forward');
      return;
    }

    if (candidate.kind === 'invalid') {
      setRecipientResolutionError('Enter a wallet address, .sol name, or @X handle.');
      return;
    }

    if (candidate.kind === 'ambiguous') {
      // The user typed a bare alphanumeric string that matches both
      // an SNS root and an X handle. Pin them down before we hit
      // any RPCs so resolution always targets the right namespace.
      setRecipientResolutionError(
        `"${trimmed}" could be a .sol name or an X handle. Add ".sol" or "@" to choose.`,
      );
      return;
    }

    if (effectiveWalletMode === 'offline' || !canUseNetwork) {
      setRecipientResolutionError(
        candidate.kind === 'sns' ? 'SNS names need online mode.' : 'X handles need online mode.',
      );
      return;
    }

    setRecipientResolving(true);
    setRecipientResolutionError(null);
    try {
      if (candidate.kind === 'sns') {
        const address = await resolveSnsName(candidate.domain);
        if (!mountedRef.current) return;
        setResolvedRecipient({
          input: trimmed,
          address,
          identity: { kind: 'sns', domain: candidate.domain },
        });
      } else {
        const resolved = await resolveXHandle(candidate.handle);
        if (!mountedRef.current) return;
        setResolvedRecipient({
          input: trimmed,
          address: resolved.address,
          identity: {
            kind: 'x-handle',
            handle: resolved.handle,
            source: resolved.source,
          },
        });
      }
      transitionToStep('amount', 'forward');
    } catch (error) {
      if (!mountedRef.current) return;
      const isXLookup = candidate.kind === 'x';
      const failureTitle = isXLookup ? 'X handle lookup failed' : 'SNS lookup failed';
      const fallbackMessage = isXLookup
        ? error instanceof XHandleNotRegisteredError
          ? error.message
          : 'Unable to resolve X handle.'
        : 'Unable to resolve SNS name.';
      const message = error instanceof Error ? error.message : fallbackMessage;
      setRecipientResolutionError(message);
      showToast({
        title: failureTitle,
        message,
        variant: 'error',
      });
    } finally {
      if (mountedRef.current) setRecipientResolving(false);
    }
  }, [canUseNetwork, effectiveWalletMode, recipient, selectedToken, showToast, transitionToStep]);

  const handleEditRecipient = useCallback(() => {
    Keyboard.dismiss();
    transitionToStep('recipient', 'backward');
  }, [transitionToStep]);

  const handleTransactionAction = useCallback(async () => {
    if (sendResult == null) return;
    if (sendResult.status === 'submitted') {
      await Linking.openURL(buildExplorerUrl(sendResult.id, sendResult.network));
      return;
    }

    await Clipboard.setStringAsync(sendResult.id);
    showToast({
      title: 'Copied',
      message: 'Reference copied',
      variant: 'success',
    });
  }, [sendResult, showToast]);

  const handleResend = useCallback(() => {
    Keyboard.dismiss();
    setSendResult(null);
    setSendProcessResult(null);
    setResultTransitionDirection('backward');
    transitionToStep('amount', 'backward');
  }, [transitionToStep]);

  const getCurrentModeLabel = useCallback(
    (token: StablecoinOption | null): string => {
      if (effectiveWalletMode === 'offline') return 'Offline P2P';
      return token == null ? 'Normal transfer' : paymentRouteModeLabel;
    },
    [effectiveWalletMode, paymentRouteModeLabel],
  );

  const buildSuccessProcessResult = useCallback(
    (params: {
      status: SendResultView['status'];
      id: string;
      amount: string;
      token: StablecoinOption;
      recipient: string;
      network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>;
    }): SendProcessResultState => {
      const queued = params.status === 'queued';
      const referenceLabel = queued ? 'Offline id' : 'Transaction';

      return {
        variant: 'success',
        title: queued ? 'Payment queued' : 'Sent!',
        message: `${params.amount} ${params.token.symbol} ${
          queued ? 'was queued for' : 'was sent to'
        } ${shortenWalletAddress(params.recipient)}.`,
        statusLabel: queued ? 'Queued' : 'Submitted',
        tokenLegs: [
          {
            label: queued ? 'Queued' : 'Sent',
            amount: params.amount,
            symbol: params.token.symbol,
            name: params.token.name,
            logo: params.token.logo,
          },
        ],
        // Minimal: just the recipient and the transaction/offline
        // reference. Network/mode/status are conveyed by the title +
        // status pill above, so we don't repeat them as rows.
        detailRows: [
          { label: 'To', value: shortenWalletAddress(params.recipient), selectable: true },
          { label: referenceLabel, value: params.id, selectable: true },
        ],
        primaryActionLabel: 'Close',
        primaryAction: 'close',
        secondaryActionLabel: queued ? 'Copy offline id' : 'View transaction',
        secondaryAction: queued ? 'copy-reference' : 'explorer',
      };
    },
    [],
  );

  const buildFailureProcessResult = useCallback(
    (error: unknown): SendProcessResultState => {
      const classification = classifySendFailure(error);
      const errorMessage = getMutationErrorMessage(error);
      const displayAmount =
        selectedToken != null
          ? sanitizeDecimalInput(amount, selectedToken.decimals)
          : amount.trim();
      const tokenLegs: ProcessResultTokenLeg[] =
        selectedToken != null && displayAmount.length > 0
          ? [
              {
                label: classification.variant === 'cancelled' ? 'Not submitted' : 'Not sent',
                amount: displayAmount,
                symbol: selectedToken.symbol,
                name: selectedToken.name,
                logo: selectedToken.logo,
              },
            ]
          : [];
      const detailRows: ProcessResultDetailRow[] = [];

      if (effectiveRecipientAddress != null) {
        detailRows.push({
          label: 'To',
          value: shortenWalletAddress(effectiveRecipientAddress),
          selectable: true,
        });
      }
      if (network != null) {
        detailRows.push({
          label: 'Network',
          value: network === 'devnet' ? 'Solana Devnet' : 'Solana',
        });
      }
      detailRows.push(
        { label: 'Mode', value: getCurrentModeLabel(selectedToken) },
        { label: 'Status', value: classification.statusLabel },
        { label: 'Reason', value: errorMessage, selectable: true },
      );

      return {
        variant: classification.variant,
        title: classification.title,
        message: classification.message,
        statusLabel: classification.statusLabel,
        tokenLegs,
        detailRows,
        primaryActionLabel: 'Back to Send',
        primaryAction: 'review',
      };
    },
    [amount, effectiveRecipientAddress, getCurrentModeLabel, network, selectedToken],
  );

  const baseDisabledReason = useMemo(() => {
    if (isNetworkSwitching) return 'Switching network…';
    if (walletAddress == null || walletId == null) return 'Unlock a wallet before sending.';
    if (network == null) return unsupportedReason ?? 'This network is not supported.';
    if (signingBlocker != null) return signingBlocker;
    if (effectiveWalletMode === 'offline') {
      if (offlineReadySlots <= 0) {
        return 'Offline payment slots are not ready on this device.';
      }
      return null;
    }
    if (!canUseNetwork) return 'Network connection is required to send in online mode.';
    if (stablecoins.length === 0 && !balanceQuery.isLoading) {
      return 'No transferable token balance is available.';
    }
    return null;
  }, [
    balanceQuery.isLoading,
    canUseNetwork,
    effectiveWalletMode,
    isNetworkSwitching,
    network,
    offlineReadySlots,
    signingBlocker,
    stablecoins.length,
    unsupportedReason,
    walletAddress,
    walletId,
  ]);

  const amountHelper = useMemo(() => {
    if (baseDisabledReason != null) return baseDisabledReason;
    if (selectedToken == null) return 'Choose a token first.';
    if (amount.trim().length === 0) return null;
    if (!isPositiveRawAmount(amountRaw)) return 'Enter an amount greater than zero.';
    // The available balance is already shown in the "Available To Send"
    // card above, so the over-balance hint stays concise instead of
    // repeating the figure.
    if (!amountValid) return 'Amount exceeds your balance.';
    return null;
  }, [amount, amountRaw, amountValid, baseDisabledReason, selectedToken]);

  const recipientStepDisabledReason = useMemo(
    () =>
      getRecipientStepDisabledReason({
        walletAddress,
        walletId,
        network,
        unsupportedReason,
        selectedToken,
      }),
    [network, selectedToken, unsupportedReason, walletAddress, walletId],
  );

  const recipientHelper = useMemo(() => {
    if (normalizedRecipient.length === 0) return null;
    if (recipientCandidate.kind === 'address') return null;
    if (recipientResolutionError != null) return recipientResolutionError;

    if (recipientCandidate.kind === 'invalid') {
      return 'Enter a wallet address, .sol name, or @X handle.';
    }
    if (recipientCandidate.kind === 'ambiguous') {
      return `"${normalizedRecipient}" could be .sol or @X. Add ".sol" or "@" to choose.`;
    }

    const targetLabel = recipientCandidate.kind === 'sns' ? 'SNS name' : 'X handle';

    if (effectiveWalletMode === 'offline') return `${targetLabel}s need online mode.`;
    if (!canUseNetwork) return `Connect to resolve this ${targetLabel}.`;
    if (recipientResolving) return `Resolving ${targetLabel}.`;
    if (resolvedRecipient != null && resolvedRecipient.input === normalizedRecipient) {
      const shortAddress = shortenWalletAddress(resolvedRecipient.address);
      if (resolvedRecipient.identity.kind === 'x-handle') {
        return `@${resolvedRecipient.identity.handle} resolves to ${shortAddress} via SNS.`;
      }
      return `Resolved to ${shortAddress}.`;
    }
    return `${targetLabel} resolves when you tap Next.`;
  }, [
    canUseNetwork,
    effectiveWalletMode,
    normalizedRecipient,
    recipientCandidate,
    recipientResolutionError,
    recipientResolving,
    resolvedRecipient,
  ]);

  const sendingPending = offlineSending || normalSending || privateSending;
  const canContinueRecipient =
    recipientStepDisabledReason == null &&
    (recipientIsAddress || recipientCanResolveOnline) &&
    !recipientResolving;
  const baseCanSubmit =
    baseDisabledReason == null &&
    selectedToken != null &&
    effectiveRecipientAddress != null &&
    amountValid &&
    amountRaw != null &&
    walletAddress != null &&
    walletId != null &&
    network != null &&
    !sendingPending;
  const magicBlockPlanBlockedReason =
    step === 'summary' &&
    effectiveWalletMode !== 'offline' &&
    effectivePaymentRoute === 'magicblock'
      ? feeEstimateMatchesAmount && magicBlockFeeEstimate.plan != null
        ? null
        : magicBlockFeeEstimate.isFetching
          ? 'Preparing private transfer.'
          : magicBlockFeeEstimate.isError
            ? 'Private transfer plan is unavailable.'
            : 'Preparing private transfer.'
      : null;
  const canSubmit = baseCanSubmit && magicBlockPlanBlockedReason == null;
  const handleContinueAmount = useCallback(() => {
    if (!baseCanSubmit) return;
    Keyboard.dismiss();
    transitionToStep('summary', 'forward');
  }, [baseCanSubmit, transitionToStep]);

  // Phase for the draggable summary sheet. The sheet owns the whole
  // review → sending → success lifecycle in one card, so there is no
  // separate result screen for the send flow.
  const sendSheetPhase: SendSheetPhase = sendingPending
    ? 'sending'
    : step === 'success' && sendResult != null
      ? 'success'
      : 'review';
  const sendSheetResult = useMemo(
    () =>
      sendResult == null
        ? null
        : {
            status: sendResult.status,
            id: sendResult.id,
            amount: sendResult.amount,
            symbol: sendResult.symbol,
            recipient: sendResult.recipient,
          },
    [sendResult],
  );

  const handleSubmit = useCallback(() => {
    if (
      !canSubmit ||
      selectedToken == null ||
      amountRaw == null ||
      effectiveRecipientAddress == null ||
      walletAddress == null ||
      walletId == null ||
      network == null
    ) {
      return;
    }

    const displayAmount = sanitizeDecimalInput(amount, selectedToken.decimals);
    const selectedRouteOption = paymentRouteOptions.find(
      (route) => route.id === effectivePaymentRoute,
    );
    const submitRoute =
      effectiveWalletMode === 'offline'
        ? null
        : selectedRouteOption != null && selectedRouteOption.disabled !== true
          ? effectivePaymentRoute
          : 'normal';
    if (submitRoute === 'umbra' && !canUseUmbraPrivateP2P) {
      showToast({
        title: 'Umbra unavailable',
        message: umbraPrivateP2pDisabledReason ?? 'Umbra private P2P is unavailable.',
        variant: 'warning',
      });
      return;
    }
    if (submitRoute === 'magicblock' && magicBlockFeeEstimate.plan == null) {
      showToast({
        title: 'Preparing private transfer',
        message: magicBlockPlanBlockedReason ?? 'Wait for the private transfer plan to finish.',
        variant: 'warning',
      });
      return;
    }
    if (!beginSubmit()) return;

    setSendResult(null);
    setSendProcessResult(null);

    if (effectiveWalletMode === 'offline') {
      setOfflineSending(true);
      runAfterLoadingPaint(() => {
        void (async () => {
          if (!mountedRef.current) return;
          const { buildAndEnqueueOfflineStablecoinPayment } =
            await import('@/lib/offline/offline-payments');
          const result = await buildAndEnqueueOfflineStablecoinPayment({
            walletAddress,
            walletId,
            recipient: effectiveRecipientAddress,
            amount: displayAmount,
            token: selectedToken.mint,
            network,
          });

          if (!mountedRef.current) return;
          if (effectiveRecipientAddress !== walletAddress) {
            await applyCachedOfflineDebit({
              queryClient,
              walletAddress,
              network,
              tokenMint: result.tokenMint,
              rawAmount: result.rawAmount,
            }).catch(() => false);
          }
          const slotSnapshot = await loadOfflinePaymentSlotSnapshot({
            walletAddress,
            network,
          }).catch(() => null);
          if (slotSnapshot != null) {
            setOfflinePaymentSlotsQueryData(
              queryClient,
              slotSnapshot,
              offlinePaymentSlots.targetSlotCount,
            );
          }
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: pendingBackupQueueStatsQueryKey(walletAddress, network),
            }),
            queryClient.invalidateQueries({
              queryKey: offlinePaymentSlotsQueryKey(walletAddress, network),
              refetchType: 'none',
            }),
          ]);
          const queuedAt = Date.now();
          addOfflineReceipt({
            id: `offline-send-${network}-${result.txId}`,
            direction: 'send',
            status: 'queued',
            title: 'Payment queued',
            subtitle: `To ${shortenWalletAddress(effectiveRecipientAddress)}`,
            amountLabel: `-${displayAmount} ${result.tokenSymbol}`,
            rawAmount: result.rawAmount,
            tokenMint: result.tokenMint,
            tokenSymbol: result.tokenSymbol,
            tokenName: selectedToken.name,
            tokenLogo: selectedToken.logo,
            tokenDecimals: selectedToken.decimals,
            network,
            createdAt: queuedAt,
            updatedAt: queuedAt,
            txId: result.txId,
            recipient: effectiveRecipientAddress,
          });
          if (effectiveRecipientAddress === walletAddress) {
            addOfflineReceipt({
              id: `offline-receive-${network}-${result.txId}`,
              direction: 'receive',
              status: 'received',
              title: 'Payment received',
              subtitle: 'From this wallet',
              amountLabel: `+${displayAmount} ${result.tokenSymbol}`,
              rawAmount: result.rawAmount,
              tokenMint: result.tokenMint,
              tokenSymbol: result.tokenSymbol,
              tokenName: selectedToken.name,
              tokenLogo: selectedToken.logo,
              tokenDecimals: selectedToken.decimals,
              network,
              createdAt: queuedAt,
              updatedAt: queuedAt,
              txId: result.txId,
              recipient: walletAddress,
            });
          }
          void presentWalletTransactionEventNotification({
            identifier: `wallet-transaction-${network}-${result.txId}`,
            type: 'send',
            amountLabel: `-${displayAmount} ${result.tokenSymbol}`,
            signature: result.txId,
          });
          if (effectiveRecipientAddress === walletAddress) {
            const nextResult: SendResultView = {
              status: 'queued',
              id: result.txId,
              amount: displayAmount,
              symbol: result.tokenSymbol,
              recipient: effectiveRecipientAddress,
              network,
            };
            setSendResult(nextResult);
            setResultTransitionDirection('forward');
            setSendProcessResult(
              buildSuccessProcessResult({
                ...nextResult,
                token: selectedToken,
              }),
            );
            transitionToStep('success', 'forward');
            return;
          }
          const { OFFPAY_BLE_PROTOCOL } = await import('@/lib/offline/offline-ble-protocol');
          const { sendOfflineBlePaymentPayload } =
            await import('@/lib/offline/offline-ble-transport');
          void sendOfflineBlePaymentPayload(
            {
              version: 1,
              protocol: OFFPAY_BLE_PROTOCOL,
              type: 'offline-payment',
              txId: result.txId,
              signedBlob: result.signedBlob,
              network,
              sender: walletAddress,
              recipient: effectiveRecipientAddress,
              recipientTokenAccount: result.recipientTokenAccount,
              amount: displayAmount,
              rawAmount: result.rawAmount,
              tokenMint: result.tokenMint,
              tokenSymbol: result.tokenSymbol,
              tokenDecimals: selectedToken.decimals,
              createdAt: queuedAt,
              sessionId:
                typeof params.qrSession === 'string' && params.qrSession.trim().length > 0
                  ? `${params.qrSession.trim()}-${result.txId}`
                  : `${network}-${result.txId}-${queuedAt}`,
            },
            {
              recipientBleName: offlineRecipientBleName,
            },
          ).catch((error: unknown) => {
            if (!mountedRef.current) return;
            showToast({
              title: 'Bluetooth delivery pending',
              message:
                error instanceof Error
                  ? error.message
                  : 'The payment is queued and will settle when online.',
              variant: 'warning',
            });
          });
          const nextResult: SendResultView = {
            status: 'queued',
            id: result.txId,
            amount: displayAmount,
            symbol: result.tokenSymbol,
            recipient: effectiveRecipientAddress,
            network,
          };
          setSendResult(nextResult);
          setResultTransitionDirection('forward');
          setSendProcessResult(
            buildSuccessProcessResult({
              ...nextResult,
              token: selectedToken,
            }),
          );
          transitionToStep('success', 'forward');
        })()
          .catch((error) => {
            if (!mountedRef.current) return;
            const failureResult = buildFailureProcessResult(error);
            setSendResult(null);
            setResultTransitionDirection('forward');
            setSendProcessResult(failureResult);
            transitionToStep('summary', 'backward');
            showToast({
              title: failureResult.title,
              message: failureResult.message,
              variant: failureResult.variant === 'cancelled' ? 'info' : 'error',
            });
          })
          .finally(() => {
            if (mountedRef.current) setOfflineSending(false);
            endSubmit();
          });
      });
      return;
    }

    if (submitRoute == null || submitRoute === 'normal') {
      setNormalSending(true);
      runAfterLoadingPaint(() => {
        void (async () => {
          if (!mountedRef.current) return;
          const { submitNormalTokenTransfer } =
            await import('@/lib/payments/normal-token-transfer');
          const result = await submitNormalTokenTransfer({
            walletAddress,
            walletId,
            recipient: effectiveRecipientAddress,
            mint: selectedToken.mint,
            rawAmount: amountRaw,
            decimals: selectedToken.decimals,
            network,
          });

          if (!mountedRef.current) return;
          void queryClient.invalidateQueries({
            queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
            refetchType: 'active',
          });
          void queryClient.invalidateQueries({
            queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
            refetchType: 'active',
          });
          void queryClient.invalidateQueries({
            queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
            refetchType: 'all',
          });
          void queryClient.invalidateQueries({
            queryKey: offpayWalletTokenTransactionsBaseQueryKey(walletAddress, network),
            refetchType: 'all',
          });
          const nextResult: SendResultView = {
            status: 'submitted',
            id: result.signature,
            amount: displayAmount,
            symbol: selectedToken.symbol,
            recipient: effectiveRecipientAddress,
            network,
          };
          void presentWalletTransactionEventNotification({
            identifier: `wallet-transaction-${network}-${result.signature}`,
            type: 'send',
            amountLabel: `-${displayAmount} ${selectedToken.symbol}`,
            signature: result.signature,
          });
          addPrivateReceipt({
            id: result.signature,
            status: 'submitted',
            route: 'normal',
            source: 'manual',
            walletAddress,
            recipient: effectiveRecipientAddress,
            mint: selectedToken.mint,
            amount: amountRaw,
            tokenSymbol: selectedToken.symbol,
            tokenName: selectedToken.name,
            tokenLogo: selectedToken.logo,
            tokenDecimals: selectedToken.decimals,
            network,
            createdAt: Date.now(),
            signature: result.signature,
            txId: null,
            initSignature: null,
            message: 'Normal transfer submitted',
          });
          setSendResult(nextResult);
          setResultTransitionDirection('forward');
          setSendProcessResult(
            buildSuccessProcessResult({
              ...nextResult,
              token: selectedToken,
            }),
          );
          transitionToStep('success', 'forward');
        })()
          .catch((error) => {
            if (!mountedRef.current) return;
            const failureResult = buildFailureProcessResult(error);
            setSendResult(null);
            setResultTransitionDirection('forward');
            setSendProcessResult(failureResult);
            transitionToStep('summary', 'backward');
            showToast({
              title: failureResult.title,
              message: failureResult.message,
              variant: failureResult.variant === 'cancelled' ? 'info' : 'error',
            });
          })
          .finally(() => {
            if (mountedRef.current) setNormalSending(false);
            endSubmit();
          });
      });
      return;
    }

    setPrivateSending(true);
    runAfterLoadingPaint(() => {
      void (async () => {
        if (!mountedRef.current) return;
        const result =
          submitRoute === 'umbra'
            ? await withSendTimeout<PrivateSendSubmissionResult>(
                (async () => {
                  const { sendUmbraPrivateP2PFromPublicBalance } =
                    await import('@/lib/umbra/umbra-execution');
                  const umbraResult = await sendUmbraPrivateP2PFromPublicBalance({
                    walletAddress,
                    walletId,
                    recipient: effectiveRecipientAddress,
                    amount,
                    token: selectedToken.symbol,
                    tokenMint: selectedToken.mint,
                    network,
                    autoSetupSender: true,
                  });
                  const signature = umbraResult.primarySignature ?? umbraResult.signatures[0];
                  if (signature == null) {
                    throw new Error('Umbra private P2P did not return a transaction signature.');
                  }

                  return {
                    status: 'submitted' as const,
                    signature,
                    txId: null,
                    initSignature: null,
                    message: 'Private P2P submitted',
                  };
                })(),
                UMBRA_PRIVATE_P2P_SEND_TIMEOUT_MS,
                'Private P2P timed out',
              )
            : await (async () => {
                const privateResult = await submitPrivatePayment({
                  walletAddress,
                  walletId,
                  recipient: effectiveRecipientAddress,
                  amount: amountRaw,
                  mint: selectedToken.mint,
                  network,
                  preparedPlan: submitRoute === 'magicblock' ? magicBlockFeeEstimate.plan : null,
                });

                return {
                  ...privateResult,
                  message:
                    privateResult.status === 'submitted'
                      ? 'Private payment submitted'
                      : 'Queued for settlement',
                };
              })();

        if (!mountedRef.current) return;
        const id = result.status === 'submitted' ? result.signature : result.txId;
        void presentWalletTransactionEventNotification({
          identifier: `wallet-transaction-${network}-${id}`,
          type: 'send',
          amountLabel: `-${displayAmount} ${selectedToken.symbol}`,
          signature: id,
        });
        addPrivateReceipt({
          id,
          status: result.status,
          route: submitRoute,
          walletAddress,
          recipient: effectiveRecipientAddress,
          mint: selectedToken.mint,
          amount: amountRaw,
          tokenSymbol: selectedToken.symbol,
          tokenName: selectedToken.name,
          tokenLogo: selectedToken.logo,
          tokenDecimals: selectedToken.decimals,
          network,
          createdAt: Date.now(),
          signature: result.status === 'submitted' ? result.signature : null,
          txId: result.status === 'queued' ? result.txId : null,
          initSignature: result.initSignature,
          message: result.message,
        });
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
            refetchType: 'active',
          }),
          queryClient.invalidateQueries({
            queryKey: [
              'offpay',
              'privatePaymentBalance',
              network,
              walletAddress,
              selectedToken.mint,
            ],
          }),
          queryClient.invalidateQueries({
            queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
            refetchType: 'active',
          }),
          queryClient.invalidateQueries({
            queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
            refetchType: 'active',
          }),
          queryClient.invalidateQueries({
            queryKey: offpayWalletTokenTransactionsBaseQueryKey(walletAddress, network),
            refetchType: 'active',
          }),
          queryClient.invalidateQueries({
            queryKey: pendingBackupQueueStatsQueryKey(walletAddress, network),
          }),
        ]);
        const nextResult: SendResultView = {
          status: result.status,
          id,
          amount: displayAmount,
          symbol: selectedToken.symbol,
          recipient: effectiveRecipientAddress,
          network,
        };
        setSendResult(nextResult);
        setResultTransitionDirection('forward');
        setSendProcessResult(
          buildSuccessProcessResult({
            ...nextResult,
            token: selectedToken,
          }),
        );
        transitionToStep('success', 'forward');
      })()
        .catch((error) => {
          if (!mountedRef.current) return;
          const failureResult = buildFailureProcessResult(error);
          setSendResult(null);
          setResultTransitionDirection('forward');
          setSendProcessResult(failureResult);
          transitionToStep('summary', 'backward');
          showToast({
            title: failureResult.title,
            message: failureResult.message,
            variant: failureResult.variant === 'cancelled' ? 'info' : 'error',
          });
        })
        .finally(() => {
          if (mountedRef.current) setPrivateSending(false);
          endSubmit();
        });
    });
  }, [
    amount,
    amountRaw,
    addOfflineReceipt,
    addPrivateReceipt,
    beginSubmit,
    buildFailureProcessResult,
    buildSuccessProcessResult,
    canSubmit,
    canUseUmbraPrivateP2P,
    effectivePaymentRoute,
    effectiveWalletMode,
    effectiveRecipientAddress,
    endSubmit,
    magicBlockFeeEstimate.plan,
    magicBlockPlanBlockedReason,
    network,
    offlineRecipientBleName,
    offlinePaymentSlots.targetSlotCount,
    params.qrSession,
    paymentRouteOptions,
    queryClient,
    selectedToken,
    showToast,
    transitionToStep,
    umbraPrivateP2pDisabledReason,
    walletAddress,
    walletId,
  ]);

  const renderTokenStep = (): React.JSX.Element => (
    <SendTokenSelectStep
      query={query}
      tokens={filteredStablecoins}
      tokenValuations={amountValuationQuery.data?.tokenValues}
      loading={balanceQuery.isLoading || capabilitiesQuery.isCapabilitiesPending}
      emptyMessage={baseDisabledReason ?? 'Only tokens with a positive balance can be sent.'}
      onQueryChange={setQuery}
      onSelectToken={handleSelectToken}
    />
  );

  const renderRecipientStep = (): React.JSX.Element => (
    <SendRecipientStep
      recipient={recipient}
      helper={recipientHelper}
      clipboardRecipient={clipboardRecipient}
      recentRecipients={recentRecipients}
      isOfflineMode={effectiveWalletMode === 'offline'}
      onRecipientChange={handleRecipientChange}
      onUseClipboard={handleUseClipboardRecipient}
      onSelectRecent={handleSelectRecentRecipient}
      onClearRecent={handleClearRecentRecipients}
      onScanQr={handleScanRecipient}
      onScanNearby={handleOpenNearbyWalletScanner}
    />
  );

  const renderAmountStep = (): React.JSX.Element => (
    <SendAmountStep
      token={selectedToken}
      recipientAddress={effectiveRecipientAddress}
      recipientInput={recipient}
      amount={amount}
      amountMetaLabel={amountMetaLabel}
      helper={amountHelper}
      selfSend={selfSend}
      routeOptions={effectiveWalletMode !== 'offline' ? paymentRouteOptions : []}
      selectedRoute={paymentRouteOptions.length > 0 ? effectivePaymentRoute : null}
      onSelectRoute={setSelectedPrivateRoute}
      onAmountChange={handleAmountChange}
      onMax={handleMaxAmount}
      onEditRecipient={handleEditRecipient}
    />
  );

  const stepContent =
    step === 'token'
      ? renderTokenStep()
      : step === 'recipient'
        ? renderRecipientStep()
        : // amount / summary / success all keep the amount screen mounted
          // underneath — summary and success are overlay sheet phases.
          renderAmountStep();

  const footerContent =
    step === 'recipient' ? (
      <PrimaryButton
        label="Next"
        onPress={() => void handleContinueRecipient()}
        disabled={!canContinueRecipient}
        loading={recipientResolving}
        compact={denseSend}
      />
    ) : step === 'amount' ? (
      <PrimaryButton
        label="Next"
        onPress={handleContinueAmount}
        disabled={!baseCanSubmit}
        compact={denseSend}
      />
    ) : (
      // Summary / success are handled entirely by the draggable sheet
      // (slider + Close), so no footer button is shown underneath it.
      <View
        style={[styles.footerPlaceholder, denseSend && styles.footerPlaceholderCompact]}
        pointerEvents="none"
      />
    );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <GradientBackground />
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        // iOS: `padding` lifts the body when the keyboard opens so
        // the input stays visible. Android: undefined; we rely on
        // the manifest's `windowSoftInputMode="adjustResize"`
        // (RN's default) to resize the window naturally.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: denseSend ? spacing.sm : compactSend ? spacing.md : spacing.lg,
              // Reserve room at the bottom for the absolutely-
              // positioned footer that sits below this scroll view.
              // Without this, scrollable content would render
              // underneath the footer button.
              paddingBottom:
                footerBottomPadding + footerButtonHeight + footerTopPadding + sectionGap,
              paddingHorizontal: screenHorizontalPadding,
            },
          ]}
        >
          <View style={[styles.content, { maxWidth: SEND_CONTENT_MAX_WIDTH }]}>
            <Animated.View
              key={`send-step-${step === 'summary' || step === 'success' ? 'amount' : step}`}
              entering={getSendStepEnteringAnimation(stepTransitionDirection)}
              exiting={getSendStepExitingAnimation(stepTransitionDirection)}
              style={[styles.stepScreen, { gap: sectionGap }]}
            >
              <View style={styles.header}>
                <HeaderIconButton onPress={handleBack} accessibilityLabel="Go back">
                  <Ionicons
                    name="chevron-back"
                    size={layout.iconSizeNav}
                    color={colors.text.primary}
                  />
                </HeaderIconButton>
                <Text
                  variant="h2"
                  color={colors.text.inverse}
                  style={[styles.headerTitle, compactSend && styles.headerTitleCompact]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  maxFontSizeMultiplier={1}
                >
                  {step === 'amount' || step === 'summary' || step === 'success'
                    ? 'Enter amount'
                    : step === 'recipient' && selectedToken != null
                      ? selectedToken.symbol
                      : step === 'token'
                        ? 'Send'
                        : selectedToken != null
                          ? `Send ${selectedToken.symbol}`
                          : 'Send'}
                </Text>
                <View style={styles.headerButtonPlaceholder} />
              </View>

              {stepContent}
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer is absolutely anchored to the bottom of the
            screen — OUTSIDE the KeyboardAvoidingView. This is the
            critical detail: KAV resizes with the keyboard, but the
            footer does not. Tapping anywhere on the screen,
            opening/closing the keyboard, or removing input text
            cannot move the footer because it is not part of the
            KAV's layout subtree. The ScrollView reserves
            `buttonHeightLg + insets.bottom + spacing` of bottom
            padding so scrollable content never renders under the
            footer button. */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: footerBottomPadding,
            paddingTop: footerTopPadding,
            paddingHorizontal: footerHorizontalPadding,
          },
        ]}
        pointerEvents="box-none"
      >
        <Animated.View
          key={`send-footer-${step}`}
          entering={getSendStepEnteringAnimation(stepTransitionDirection)}
          exiting={getSendStepExitingAnimation(stepTransitionDirection)}
          style={styles.footerActionFrame}
        >
          {footerContent}
        </Animated.View>
      </View>
      <SendSummarySheet
        visible={
          (step === 'summary' || step === 'success') &&
          selectedToken != null &&
          effectiveRecipientAddress != null
        }
        phase={sendSheetPhase}
        token={selectedToken}
        amount={
          selectedToken != null ? sanitizeDecimalInput(amount, selectedToken.decimals) : amount
        }
        amountMetaLabel={amountMetaLabel}
        recipientAddress={effectiveRecipientAddress ?? ''}
        network={network}
        modeLabel={paymentRouteModeLabel}
        networkFeeLabel={networkFeeLabel}
        selfSend={selfSend}
        canSubmit={canSubmit}
        result={sendSheetResult}
        onCancel={() => transitionToStep('amount', 'backward')}
        onConfirm={handleSubmit}
        onResultAction={sendResult != null ? () => void handleTransactionAction() : undefined}
        onResend={handleResend}
        onDone={closeToHome}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}): React.JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.footerButton,
        compact && styles.footerButtonCompact,
        styles.primaryButton,
        isDisabled && styles.disabledButton,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <LazyLoadingSpinner size={18} color={colors.text.onAccent} />
      ) : (
        <Text
          variant="button"
          color={colors.text.onAccent}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          maxFontSizeMultiplier={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    // Force content to start at the top of the ScrollView. Without
    // this, `flexGrow: 1` combined with shorter step bodies can let
    // the body float vertically — visible as the bottom button
    // appearing to shift between steps when you navigate back.
    justifyContent: 'flex-start',
  },
  content: {
    width: '100%',
    zIndex: 1,
  },
  stepScreen: {
    width: '100%',
  },
  header: {
    minHeight: layout.minTouchTarget + spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
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
    boxShadow: SEND_HEADER_SHADOW,
  },
  headerControlPressed: {
    opacity: 0.72,
  },
  headerIconSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonPlaceholder: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.display,
  },
  headerTitleCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  step: {
    gap: spacing.lg,
  },
  copyBlock: {
    gap: spacing.xs,
  },
  stepTitle: {
    fontFamily: fontFamily.semiBold,
  },
  stepSubtitle: {
    lineHeight: 20,
  },
  searchRow: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.backgroundAlt,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
  tokenList: {
    gap: spacing.md,
  },
  tokenRow: {
    minHeight: 72,
    borderRadius: radii.xl,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface.pressed,
  },
  tokenText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyState: {
    minHeight: 140,
    borderRadius: radii['2xl'],
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    lineHeight: 18,
  },
  selectedTokenHeader: {
    minHeight: 64,
    borderRadius: radii.xl,
    backgroundColor: colors.surface.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tokenHeaderPlaceholder: {
    height: 64,
  },
  tokenHero: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 104,
  },
  tokenHeroPlaceholder: {
    height: 104,
  },
  addressInputShell: {
    minHeight: 76,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.backgroundAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addressInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 0,
  },
  inlineCircleButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surface.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyPanel: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    padding: spacing.md,
    gap: spacing.md,
  },
  nearbyHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  nearbyTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nearbyDescription: {
    lineHeight: 18,
  },
  nearbyScanButton: {
    minHeight: 36,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.backgroundAlt,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  scanRecipientRow: {
    minHeight: 56,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  scanRecipientIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    backgroundColor: colors.surface.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanRecipientText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  scanRecipientDescription: {
    lineHeight: 18,
  },
  readonlyAddress: {
    minHeight: 78,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.strong,
    backgroundColor: colors.surface.backgroundAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  readonlyAddressText: {
    lineHeight: 24,
  },
  readonlyAddressTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  amountRow: {
    minHeight: 56,
    borderRadius: radii.md,
    backgroundColor: colors.surface.card,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  amountInput: {
    flex: 1,
    minWidth: 96,
    height: 48,
    color: colors.text.primary,
    fontFamily: fontFamily.mono,
    fontSize: 24,
    lineHeight: 30,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  amountTicker: {
    flexShrink: 0,
    fontFamily: fontFamily.medium,
    maxWidth: 72,
  },
  maxButton: {
    minHeight: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surface.cardElevated,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  availableText: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  warningBox: {
    borderRadius: radii.lg,
    backgroundColor: colors.semantic.warning,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  warningText: {
    flex: 1,
    minWidth: 0,
    lineHeight: 20,
  },
  helper: {
    lineHeight: 18,
  },
  successStep: {
    flexGrow: 1,
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIcon: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(0, 196, 140, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontFamily: fontFamily.regular,
  },
  successMessage: {
    maxWidth: 420,
    lineHeight: 24,
  },
  successHelper: {
    maxWidth: 340,
    lineHeight: 18,
  },
  footer: {
    // Absolutely anchored to the bottom of the screen, OUTSIDE the
    // KeyboardAvoidingView. The footer is unaffected by keyboard
    // open/close, focus changes, or tapping on the screen — its Y
    // position is locked to the screen edge.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    paddingTop: spacing.md,
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.md,
    zIndex: 2,
  },
  footerActionFrame: {
    width: '100%',
  },
  footerButton: {
    flex: 1,
    height: layout.buttonHeightLg,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonCompact: {
    height: layout.buttonHeightMd,
  },
  // Same dimensions as the footer button so token/summary steps
  // (which don't render a CTA in the footer) keep the footer
  // container at a constant height. This is what stops the body
  // from reflowing when the user navigates between steps.
  footerPlaceholder: {
    flex: 1,
    height: layout.buttonHeightLg,
  },
  footerPlaceholderCompact: {
    height: layout.buttonHeightMd,
  },
  footerSlider: {
    flex: 1,
  },
  primaryButton: {
    backgroundColor: colors.brand.glossAccent,
  },
  secondaryButton: {
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  disabledButton: {
    opacity: 0.55,
  },
  buttonPressed: {
    backgroundColor: colors.brand.actionFill,
  },
});
