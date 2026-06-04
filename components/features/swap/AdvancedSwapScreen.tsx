import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeInDown, FadeInUp, FadeOut } from 'react-native-reanimated';

import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import {
  ProcessResultScreen,
  type ProcessResultDetailRow,
  type ProcessResultTokenLeg,
  type ProcessResultVariant,
} from '@/components/ui/ProcessResultScreen';
import { Text } from '@/components/ui/Text';
import { TokenIcon } from '@/components/ui/TokenIcon';
import {
  SwapReviewFlowScreen,
  type SwapReviewDetailRow,
  type SwapReviewTokenLeg,
} from '@/components/features/swap/SwapReviewFlowScreen';
import { TokenSelectorModal } from '@/components/features/swap/TokenSelectorModal';
import type { SwapTokenOption } from '@/components/features/swap/types';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { createAndExecuteRecurringSwap, createTriggerOrder } from '@/lib/swap/advanced-swap';
import {
  offpaySwapTokensQueryKey,
  TOKEN_LOGO_CACHE_GC_MS,
  TOKEN_LOGO_CACHE_STALE_MS,
} from '@/hooks/useOffpayTokenLogoMap';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { getSwapTokens } from '@/lib/api/offpay-api-client';
import { formatLamportsAsSol, formatTokenBalance } from '@/lib/api/offpay-wallet-data';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import {
  decimalInputToAtomicAmount,
  formatAtomicAmount,
  sanitizeDecimalInput,
} from '@/lib/policy/token-amounts';
import { useAdvancedSwapStore, type AdvancedSwapMode } from '@/store/advancedSwapStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  CapabilityStatus,
  SwapTriggerCondition,
  SwapTokensResponse,
  WalletBalanceResponse,
} from '@/types/offpay-api';

const DEFAULT_SLIPPAGE_PERCENT = '0.5';
const DEFAULT_EXPIRY_HOURS = '24';
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const ADVANCED_CONTENT_MAX_WIDTH = 430;
const screenHeaderEntering = FadeInDown.duration(220).easing(Easing.out(Easing.cubic));
const screenSectionEntering = FadeInUp.duration(220).easing(Easing.out(Easing.cubic));

type RecurringFrequency = 'daily:1' | 'weekly:1' | 'monthly:1';

interface SupportedTokenInput {
  symbol: string;
  mint: string;
  decimals: number;
  name?: string;
}

interface ResolvedTokenInput {
  symbol: string;
  mint: string;
  decimals: number | null;
  source: 'ticker' | 'contract';
}

type TokenSelectionTarget = 'input' | 'output';
type AdvancedFormMode = Exclude<AdvancedSwapMode, 'privacy'>;
type TriggerAdvancedResult = Awaited<ReturnType<typeof createTriggerOrder>>;
type RecurringAdvancedResult = Awaited<ReturnType<typeof createAndExecuteRecurringSwap>>;

interface AdvancedReviewState {
  mode: AdvancedFormMode;
  title: string;
  statusLabel: string;
  confirmLabel: string;
  busyLabel: string;
  payLeg: SwapReviewTokenLeg;
  receiveLeg: SwapReviewTokenLeg;
  detailRows: SwapReviewDetailRow[];
}

interface AdvancedProcessResultState {
  variant: ProcessResultVariant;
  title: string;
  message: string;
  statusLabel: string;
  tokenLegs: ProcessResultTokenLeg[];
  detailRows: ProcessResultDetailRow[];
}

type AdvancedMutationResult =
  | { mode: 'trigger'; result: TriggerAdvancedResult }
  | { mode: 'recurring'; result: RecurringAdvancedResult };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Advanced swap failed.';
}

function sanitizeRawAmount(value: string): string {
  return value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
}

function parseNumberInput(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPositiveNumberInput(value: string): boolean {
  const parsed = parseNumberInput(value);
  return parsed != null && parsed > 0;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSlippageBps(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.round(parsed * 100));
}

function buildExpiry(hours: string): number {
  return Date.now() + parsePositiveInteger(hours, 24) * 60 * 60 * 1000;
}

function capabilityMessage(capability: CapabilityStatus): string {
  return capability.available ? 'Available' : capability.message;
}

function shorten(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function getTokenKey(value: string): string {
  return value.trim().toUpperCase();
}

function buildSupportedTokenLookup(params: {
  swapTokens?: { symbol: string; mint: string; decimals: number; name?: string }[];
  stablecoins?: {
    symbol: string;
    mint: string;
    decimals: number;
    name?: string;
    enabled?: boolean;
  }[];
}): Map<string, SupportedTokenInput> {
  const lookup = new Map<string, SupportedTokenInput>();

  function addToken(token: SupportedTokenInput): void {
    lookup.set(getTokenKey(token.symbol), token);
    lookup.set(getTokenKey(token.mint), token);
  }

  addToken({
    symbol: 'SOL',
    mint: NATIVE_SOL_MINT,
    decimals: 9,
    name: 'Solana',
  });

  params.stablecoins?.forEach((token) => {
    if (token.enabled === false) return;
    addToken(token);
  });

  params.swapTokens?.forEach((token) => addToken(token));

  return lookup;
}

function buildAdvancedTokenOptions(params: {
  swapTokens?: SwapTokensResponse['tokens'];
  stablecoins?: {
    symbol: string;
    mint: string;
    decimals: number;
    name?: string;
    enabled?: boolean;
  }[];
  balance?: WalletBalanceResponse;
}): SwapTokenOption[] {
  const tokenMap = new Map<
    string,
    {
      symbol: string;
      mint: string;
      decimals: number;
      name: string;
      logo: string | null;
      verified: boolean;
    }
  >();

  const addToken = (token: {
    symbol: string;
    mint: string;
    decimals: number;
    name?: string;
    logo?: string | null;
    verified?: boolean;
    enabled?: boolean;
  }): void => {
    if (token.enabled === false) return;
    tokenMap.set(token.mint, {
      symbol: token.symbol,
      mint: token.mint,
      decimals: token.decimals,
      name: token.name ?? token.symbol,
      logo: token.logo ?? null,
      verified: token.verified ?? false,
    });
  };

  addToken({
    symbol: 'SOL',
    name: 'Solana',
    mint: NATIVE_SOL_MINT,
    decimals: 9,
    verified: true,
  });
  params.stablecoins?.forEach(addToken);
  params.swapTokens?.forEach((token) => addToken({ ...token, verified: token.verified }));

  return [...tokenMap.values()].map((token) => {
    const isNativeSol = token.mint === NATIVE_SOL_MINT || token.symbol.toUpperCase() === 'SOL';
    const walletToken =
      params.balance?.tokens.find((item) => !item.spam && item.mint === token.mint) ?? null;

    return {
      symbol: token.symbol,
      name: token.name,
      mint: token.mint,
      decimals: token.decimals,
      logo: token.logo ?? walletToken?.logo ?? null,
      balanceValue:
        isNativeSol && params.balance != null
          ? formatAtomicAmount(String(params.balance.solBalance), 9, 9)
          : (walletToken?.balance ?? '0'),
      balanceDisplay:
        isNativeSol && params.balance != null
          ? formatLamportsAsSol(params.balance.solBalance)
          : walletToken != null
            ? formatTokenBalance(walletToken.balance)
            : '0.00',
      verified: token.verified,
    };
  });
}

function resolveTokenInput(
  value: string,
  lookup: Map<string, SupportedTokenInput>,
): ResolvedTokenInput | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const knownToken = lookup.get(getTokenKey(trimmed));
  if (knownToken != null) {
    return {
      symbol: knownToken.symbol,
      mint: knownToken.mint,
      decimals: knownToken.decimals,
      source: isValidSolanaAddress(trimmed) ? 'contract' : 'ticker',
    };
  }

  if (isValidSolanaAddress(trimmed)) {
    return {
      symbol: 'Custom',
      mint: trimmed,
      decimals: null,
      source: 'contract',
    };
  }

  return null;
}

function frequencyHelper(frequency: RecurringFrequency): string {
  if (frequency === 'weekly:1') return 'Runs once every week until you cancel it.';
  if (frequency === 'monthly:1') return 'Runs once every month until you cancel it.';
  return 'Runs once every day until you cancel it.';
}

function modeReviewLabel(mode: AdvancedFormMode): string {
  if (mode === 'recurring') return 'Repeat';
  return 'Target';
}

function HeaderIconButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.headerIconPressable,
        pressed && onPress != null ? styles.headerIconPressed : null,
      ]}
      onPress={onPress}
      disabled={onPress == null}
      hitSlop={6}
      accessibilityRole={onPress == null ? undefined : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={onPress == null ? { disabled: true } : undefined}
    >
      <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.headerIconSurface]}>
        {children}
      </View>
    </Pressable>
  );
}

function CompactInputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'number-pad';
}): React.JSX.Element {
  return (
    <View style={styles.compactInputGroup}>
      <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.placeholder}
        style={styles.compactInput}
        selectionColor={colors.brand.glossAccent}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        numberOfLines={1}
        maxFontSizeMultiplier={1}
      />
    </View>
  );
}

function CompactTokenButton({
  label,
  token,
  onPress,
}: {
  label: string;
  token: SwapTokenOption | null;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.compactTokenButton, pressed && styles.controlPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Choose ${label.toLowerCase()} token`}
    >
      <View style={styles.compactTokenLabelRow}>
        <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.text.secondary} />
      </View>
      <View style={styles.compactTokenValueRow}>
        {token != null ? (
          <>
            <TokenIcon symbol={token.symbol} name={token.name} logoUri={token.logo} size={28} />
            <Text
              variant="bodyBold"
              color={colors.text.primary}
              style={styles.compactTokenSymbol}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              maxFontSizeMultiplier={1}
            >
              {token.symbol}
            </Text>
            {token.verified ? (
              <Ionicons name="checkmark-circle" size={16} color={colors.brand.glossAccent} />
            ) : null}
          </>
        ) : (
          <Text variant="bodyBold" color={colors.text.primary} numberOfLines={1}>
            Choose
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function SegmentedButton<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <View style={styles.segmentRow}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          style={[styles.segmentButton, value === option.value && styles.segmentButtonActive]}
          onPress={() => onChange(option.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value }}
        >
          <Text
            variant="buttonSmall"
            color={value === option.value ? colors.text.onAccent : colors.text.secondary}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            maxFontSizeMultiplier={1}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AdvancedSwapScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    inputMint?: string;
    outputMint?: string;
    amount?: string;
  }>();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { network, unsupportedReason } = useOffpayNetwork();
  const { isNetworkSwitching } = useOffpayNetworkAccess();
  const capabilitiesQuery = useOffpayCapabilities();
  const addReceipt = useAdvancedSwapStore((state) => state.addReceipt);

  const [mode, setMode] = useState<AdvancedFormMode>('trigger');
  const [inputMint, setInputMint] = useState(params.inputMint ?? 'SOL');
  const [outputMint, setOutputMint] = useState(params.outputMint ?? 'USDC');
  const [amount, setAmount] = useState('');
  const [paramAmountHydrated, setParamAmountHydrated] = useState(false);
  const [triggerCondition, setTriggerCondition] = useState<SwapTriggerCondition>('above');
  const [triggerPriceUsd, setTriggerPriceUsd] = useState('');
  const [expiresHours, setExpiresHours] = useState(DEFAULT_EXPIRY_HOURS);
  const [frequency, setFrequency] = useState<RecurringFrequency>('daily:1');
  const [slippagePercent, setSlippagePercent] = useState(DEFAULT_SLIPPAGE_PERCENT);
  const [selectionTarget, setSelectionTarget] = useState<TokenSelectionTarget | null>(null);
  const [reviewState, setReviewState] = useState<AdvancedReviewState | null>(null);
  const [processResult, setProcessResult] = useState<AdvancedProcessResultState | null>(null);

  const capabilities = capabilitiesQuery.capabilities;
  const canLoadTokens = network != null && isOffpayFeatureAvailable(capabilities, 'swap.tokens');
  const swapTokensQuery = useQuery({
    queryKey: offpaySwapTokensQueryKey(network),
    queryFn: ({ signal }) => {
      if (network == null)
        throw new Error('Advanced swap token setup requires a supported network.');
      return getSwapTokens(network, { signal });
    },
    enabled: canLoadTokens,
    staleTime: TOKEN_LOGO_CACHE_STALE_MS,
    gcTime: TOKEN_LOGO_CACHE_GC_MS,
    refetchOnMount: false,
  });
  const balanceQuery = useOffpayWalletBalance(null, { eagerWithoutCapabilities: true });
  const triggerCapability = getOffpayFeatureCapability(capabilities, 'swap.triggerOrders');
  const recurringCapability = getOffpayFeatureCapability(capabilities, 'swap.recurringSwap');
  const currentCapability = mode === 'trigger' ? triggerCapability : recurringCapability;
  const currentAvailable =
    mode === 'trigger'
      ? isOffpayFeatureAvailable(capabilities, 'swap.triggerOrders')
      : isOffpayFeatureAvailable(capabilities, 'swap.recurringSwap');
  const supportedTokenLookup = useMemo(
    () =>
      buildSupportedTokenLookup({
        swapTokens: swapTokensQuery.data?.tokens,
        stablecoins: capabilities?.offline?.supportedStablecoins,
      }),
    [capabilities?.offline?.supportedStablecoins, swapTokensQuery.data?.tokens],
  );
  const availableTokens = useMemo(
    () =>
      buildAdvancedTokenOptions({
        swapTokens: swapTokensQuery.data?.tokens,
        stablecoins: capabilities?.offline?.supportedStablecoins,
        balance: balanceQuery.data,
      }),
    [balanceQuery.data, capabilities?.offline?.supportedStablecoins, swapTokensQuery.data?.tokens],
  );
  const inputToken = useMemo(
    () => resolveTokenInput(inputMint, supportedTokenLookup),
    [inputMint, supportedTokenLookup],
  );
  const outputToken = useMemo(
    () => resolveTokenInput(outputMint, supportedTokenLookup),
    [outputMint, supportedTokenLookup],
  );
  const inputTokenOption = useMemo(
    () =>
      inputToken == null
        ? null
        : (availableTokens.find(
            (token) =>
              token.mint === inputToken.mint ||
              token.symbol.trim().toUpperCase() === inputToken.symbol.trim().toUpperCase(),
          ) ?? null),
    [availableTokens, inputToken],
  );
  const outputTokenOption = useMemo(
    () =>
      outputToken == null
        ? null
        : (availableTokens.find(
            (token) =>
              token.mint === outputToken.mint ||
              token.symbol.trim().toUpperCase() === outputToken.symbol.trim().toUpperCase(),
          ) ?? null),
    [availableTokens, outputToken],
  );
  const rawAmount = useMemo(
    () =>
      inputToken?.decimals != null ? decimalInputToAtomicAmount(amount, inputToken.decimals) : null,
    [amount, inputToken?.decimals],
  );
  const slippageBps = parseSlippageBps(slippagePercent);
  const commonInputReady =
    walletAddress != null &&
    walletId != null &&
    network != null &&
    inputToken?.decimals != null &&
    outputToken?.decimals != null &&
    inputToken.mint !== outputToken.mint &&
    rawAmount != null &&
    BigInt(rawAmount || '0') > 0n;

  useEffect(() => {
    if (paramAmountHydrated || params.amount == null || inputToken?.decimals == null) return;
    setAmount(formatAtomicAmount(params.amount, inputToken.decimals, 6));
    setParamAmountHydrated(true);
  }, [inputToken?.decimals, paramAmountHydrated, params.amount]);
  const disabledReason = useMemo(() => {
    if (isNetworkSwitching) return 'Switching network…';
    if (walletAddress == null || walletId == null) return 'Unlock a wallet first.';
    if (network == null) return unsupportedReason ?? 'This network is unsupported.';
    if (!currentAvailable) return capabilityMessage(currentCapability);
    if (inputToken == null)
      return 'Choose a Pay token, such as SOL, or paste a supported token contract.';
    if (outputToken == null)
      return 'Choose a Receive token, such as USDC, or paste a supported token contract.';
    if (inputToken.decimals == null) return 'Use a supported Pay token ticker or contract.';
    if (outputToken.decimals == null) return 'Use a supported Receive token ticker or contract.';
    if (inputToken.mint === outputToken.mint) return 'Pay and Receive tokens must be different.';
    if (rawAmount == null || BigInt(rawAmount || '0') <= 0n) {
      return 'Enter an amount greater than zero.';
    }
    if (slippageBps == null) {
      return 'Enter a max slippage percentage greater than zero.';
    }
    if (mode === 'trigger') {
      if (!/^\d+$/.test(expiresHours) || parsePositiveInteger(expiresHours, 0) <= 0) {
        return 'Enter a positive expiry window in hours.';
      }
      if (!isPositiveNumberInput(triggerPriceUsd)) {
        return 'Enter a positive trigger price.';
      }
    }
    return null;
  }, [
    currentAvailable,
    currentCapability,
    expiresHours,
    inputToken,
    isNetworkSwitching,
    mode,
    network,
    outputToken,
    rawAmount,
    triggerPriceUsd,
    unsupportedReason,
    walletAddress,
    walletId,
    slippageBps,
  ]);

  const invalidateWalletData = async () => {
    if (walletAddress == null || network == null) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
      }),
      queryClient.invalidateQueries({
        queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
        refetchType: 'all',
      }),
    ]);
  };

  const triggerMutation = useMutation({
    mutationFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Trigger order requires a wallet and supported network.');
      }
      return createTriggerOrder({
        walletAddress,
        walletId,
        inputMint: inputToken?.mint ?? '',
        outputMint: outputToken?.mint ?? '',
        amount: rawAmount ?? '',
        orderType: 'single',
        triggerCondition,
        triggerPriceUsd: parseNumberInput(triggerPriceUsd),
        slippageBps: slippageBps ?? 50,
        expiresAt: buildExpiry(expiresHours),
        network,
      });
    },
    onSuccess: (result) => {
      if (network == null) return;
      addReceipt({
        id: result.triggerId,
        mode: 'trigger',
        title: 'Trigger order open',
        subtitle: `Order ${shorten(result.triggerId)} · deposit ${shorten(result.depositSignature)}`,
        signature: result.depositSignature,
        network,
        createdAt: Date.now(),
      });
      void invalidateWalletData().catch(() => undefined);
    },
    onError: (error) => {
      showToast({
        title: 'Trigger order failed',
        message: getErrorMessage(error),
        variant: 'error',
      });
    },
  });

  const recurringMutation = useMutation({
    mutationFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Recurring swap requires a wallet and supported network.');
      }
      return createAndExecuteRecurringSwap({
        walletAddress,
        walletId,
        inputMint: inputToken?.mint ?? '',
        outputMint: outputToken?.mint ?? '',
        amount: rawAmount ?? '',
        frequency,
        network,
      });
    },
    onSuccess: (result) => {
      if (network == null) return;
      addReceipt({
        id: result.recurringId,
        mode: 'recurring',
        title: `Recurring swap ${result.status}`,
        subtitle: `Plan ${shorten(result.recurringId)}`,
        signature: result.signature,
        network,
        createdAt: Date.now(),
      });
      void invalidateWalletData().catch(() => undefined);
    },
    onError: (error) => {
      showToast({
        title: 'Recurring swap failed',
        message: getErrorMessage(error),
        variant: 'error',
      });
    },
  });

  const isSubmitting = triggerMutation.isPending || recurringMutation.isPending;
  const compactScreen = windowWidth < 390 || windowHeight < 760 || fontScale > 1.08;
  const denseScreen = windowWidth < 340 || windowHeight < 700 || fontScale > 1.18;
  const screenHorizontalPadding = denseScreen
    ? spacing.md
    : compactScreen
      ? spacing.lg
      : spacing['2xl'];
  const screenTopPadding = denseScreen ? spacing.sm : compactScreen ? spacing.md : spacing.lg;
  const screenGap = denseScreen ? spacing.sm : compactScreen ? 10 : spacing.md;
  const panelSpacing = denseScreen ? spacing.sm : compactScreen ? 10 : spacing.md;

  const frequencyLabel =
    frequency === 'weekly:1' ? 'Weekly' : frequency === 'monthly:1' ? 'Monthly' : 'Daily';
  const triggerDirectionLabel = triggerCondition === 'above' ? 'Above' : 'Below';
  const slippageLabel =
    slippageBps == null
      ? `${slippagePercent || DEFAULT_SLIPPAGE_PERCENT}% max`
      : `${slippageBps / 100}% max`;

  useEffect(() => {
    setReviewState(null);
    setProcessResult(null);
  }, [
    amount,
    expiresHours,
    frequency,
    inputMint,
    mode,
    outputMint,
    slippagePercent,
    triggerCondition,
    triggerPriceUsd,
  ]);

  const buildReviewState = (): AdvancedReviewState | null => {
    if (
      inputToken == null ||
      outputToken == null ||
      inputTokenOption == null ||
      outputTokenOption == null ||
      disabledReason != null
    ) {
      return null;
    }

    const modeLabel = modeReviewLabel(mode);
    const receiveAmount = mode === 'recurring' ? 'Per schedule' : 'At target';
    const detailRows: SwapReviewDetailRow[] = [
      { label: 'Mode', value: modeLabel },
      { label: 'Slippage', value: slippageLabel },
    ];

    if (mode === 'recurring') {
      detailRows.unshift({ label: 'Schedule', value: frequencyLabel });
    } else {
      detailRows.unshift({
        label: 'Target',
        value: `${triggerDirectionLabel} $${triggerPriceUsd || '0'}`,
      });
      detailRows.push({ label: 'Good for', value: `${parsePositiveInteger(expiresHours, 24)}h` });
    }

    return {
      mode,
      title: `Review ${modeLabel.toLowerCase()} swap`,
      statusLabel: modeLabel,
      confirmLabel: 'Sign & Execute',
      busyLabel: 'Signing & executing',
      payLeg: {
        label: 'You pay',
        amount,
        symbol: inputToken.symbol,
        name: inputTokenOption.name,
        logo: inputTokenOption.logo,
      },
      receiveLeg: {
        label: 'You receive',
        amount: receiveAmount,
        symbol: outputToken.symbol,
        name: outputTokenOption.name,
        logo: outputTokenOption.logo,
      },
      detailRows,
    };
  };

  const buildProcessResult = (params: {
    review: AdvancedReviewState;
    variant: ProcessResultVariant;
    title: string;
    message: string;
    statusLabel: string;
    receiveAmount?: string;
    extraRows?: ProcessResultDetailRow[];
  }): AdvancedProcessResultState => {
    const paidLabel = params.variant === 'success' ? 'Paid' : 'You pay';
    const receivedLabel = params.variant === 'success' ? 'Received' : 'You receive';

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
  };

  const buildSuccessResult = (
    review: AdvancedReviewState,
    execution: AdvancedMutationResult,
  ): AdvancedProcessResultState => {
    if (execution.mode === 'recurring') {
      return buildProcessResult({
        review,
        variant: 'success',
        title: 'Repeat swap submitted',
        message: `${amount} ${inputToken?.symbol ?? ''} will run ${frequencyLabel.toLowerCase()}.`,
        statusLabel: execution.result.status,
        extraRows: [
          { label: 'Plan', value: shorten(execution.result.recurringId), selectable: true },
          { label: 'Signature', value: shorten(execution.result.signature), selectable: true },
        ],
      });
    }

    return buildProcessResult({
      review,
      variant: 'success',
      title: 'Target swap created',
      message: `${amount} ${inputToken?.symbol ?? ''} target order is open.`,
      statusLabel: 'Created',
      extraRows: [
        { label: 'Order', value: shorten(execution.result.triggerId), selectable: true },
        {
          label: 'Signature',
          value: shorten(execution.result.depositSignature),
          selectable: true,
        },
      ],
    });
  };

  const handleSubmit = () => {
    if (disabledReason != null || isSubmitting || !commonInputReady) return;

    const nextReviewState = buildReviewState();
    if (nextReviewState == null) return;
    Keyboard.dismiss();
    setReviewState(nextReviewState);
  };

  const handleConfirmReviewSwap = async () => {
    if (reviewState == null || isSubmitting) return;

    showToast({
      title: `Signing ${modeReviewLabel(reviewState.mode).toLowerCase()} swap`,
      message: 'Approve the wallet request to continue.',
      variant: 'info',
    });

    try {
      const execution =
        reviewState.mode === 'recurring'
          ? ({
              mode: 'recurring',
              result: await recurringMutation.mutateAsync(),
            } satisfies AdvancedMutationResult)
          : ({
              mode: 'trigger',
              result: await triggerMutation.mutateAsync(),
            } satisfies AdvancedMutationResult);

      setReviewState(null);
      setProcessResult(buildSuccessResult(reviewState, execution));
    } catch (error) {
      const message = getErrorMessage(error);
      setReviewState(null);
      setProcessResult(
        buildProcessResult({
          review: reviewState,
          variant: 'error',
          title: `${modeReviewLabel(reviewState.mode)} swap failed`,
          message,
          statusLabel: 'Failed',
          extraRows: [{ label: 'Reason', value: message, selectable: true }],
        }),
      );
    }
  };

  const handleCancelReviewSwap = () => {
    if (reviewState == null) return;
    if (isSubmitting) {
      showToast({
        title: 'Swap in progress',
        message: 'Wait for signing and submission to finish.',
        variant: 'info',
      });
      return;
    }

    setReviewState(null);
    setProcessResult(
      buildProcessResult({
        review: reviewState,
        variant: 'cancelled',
        title: `${modeReviewLabel(reviewState.mode)} swap cancelled`,
        message: 'No transaction was signed or submitted.',
        statusLabel: 'Cancelled',
        extraRows: [{ label: 'Status', value: 'User cancelled' }],
      }),
    );
    showToast({
      title: 'Swap cancelled',
      message: 'No transaction was submitted.',
      variant: 'info',
    });
  };

  const handleTokenSelect = (token: SwapTokenOption) => {
    if (selectionTarget == null) return;
    const selectedMint = token.mint ?? token.symbol;

    if (selectionTarget === 'input') {
      if (selectedMint === outputToken?.mint && inputToken?.mint != null) {
        setInputMint(outputToken.mint);
        setOutputMint(inputToken.mint);
      } else {
        setInputMint(selectedMint);
      }
    } else if (selectedMint === inputToken?.mint && outputToken?.mint != null) {
      setOutputMint(inputToken.mint);
      setInputMint(outputToken.mint);
    } else {
      setOutputMint(selectedMint);
    }

    setSelectionTarget(null);
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <GradientBackground />
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: insets.top + screenTopPadding,
                paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.md,
                paddingHorizontal: screenHorizontalPadding,
                gap: screenGap,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              entering={screenHeaderEntering}
              style={[styles.contentFrame, styles.header]}
            >
              <HeaderIconButton onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons
                  name="chevron-back"
                  size={layout.iconSizeNav}
                  color={colors.text.primary}
                />
              </HeaderIconButton>
              <Text
                variant="h2"
                color={colors.text.inverse}
                style={[styles.headerTitle, denseScreen && styles.headerTitleDense]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                maxFontSizeMultiplier={1}
              >
                Advanced Swap
              </Text>
              <View style={styles.headerSpacer} />
            </Animated.View>

            <Animated.View entering={screenSectionEntering.delay(60)} style={styles.contentFrame}>
              <SegmentedButton
                value={mode}
                options={[
                  { value: 'trigger', label: 'Target' },
                  { value: 'recurring', label: 'Repeat' },
                ]}
                onChange={setMode}
              />
            </Animated.View>

            <Animated.View
              key={mode}
              entering={screenSectionEntering.delay(110)}
              exiting={FadeOut.duration(100)}
              style={[
                styles.contentFrame,
                styles.card,
                denseScreen ? styles.cardDense : compactScreen ? styles.cardCompact : null,
                { gap: panelSpacing },
              ]}
            >
              <View style={styles.compactSectionHeader}>
                <Text
                  variant="bodyBold"
                  color={colors.text.primary}
                  style={styles.sectionTitle}
                  numberOfLines={1}
                >
                  Setup
                </Text>
                <Text
                  variant="captionBold"
                  color={colors.text.secondary}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={1}
                >
                  {mode === 'trigger' ? 'Target order' : 'Repeat order'}
                </Text>
              </View>

              <View style={styles.compactTokenRow}>
                <CompactTokenButton
                  label="Pay"
                  token={inputTokenOption}
                  onPress={() => setSelectionTarget('input')}
                />
                <View style={styles.compactArrow}>
                  <Ionicons
                    name="arrow-forward"
                    size={denseScreen ? 15 : 17}
                    color={colors.text.primary}
                  />
                </View>
                <CompactTokenButton
                  label="Receive"
                  token={outputTokenOption}
                  onPress={() => setSelectionTarget('output')}
                />
              </View>

              <CompactInputField
                label={`Amount${inputToken?.symbol != null ? ` (${inputToken.symbol})` : ''}`}
                value={amount}
                onChangeText={(value) =>
                  setAmount(sanitizeDecimalInput(value, inputToken?.decimals ?? 9))
                }
                placeholder="0.00"
                keyboardType="decimal-pad"
              />

              {mode === 'trigger' ? (
                <Animated.View
                  entering={FadeIn.duration(140)}
                  exiting={FadeOut.duration(90)}
                  style={styles.modeFields}
                >
                  <SegmentedButton
                    value={triggerCondition}
                    options={[
                      { value: 'above', label: 'Above' },
                      { value: 'below', label: 'Below' },
                    ]}
                    onChange={setTriggerCondition}
                  />
                  <View style={styles.fieldRow}>
                    <CompactInputField
                      label="Target USD"
                      value={triggerPriceUsd}
                      onChangeText={(value) => setTriggerPriceUsd(sanitizeDecimalInput(value, 8))}
                      placeholder="0"
                      keyboardType="decimal-pad"
                    />
                    <CompactInputField
                      label="Good for (h)"
                      value={expiresHours}
                      onChangeText={(value) => setExpiresHours(sanitizeRawAmount(value))}
                      placeholder="24"
                      keyboardType="number-pad"
                    />
                  </View>
                </Animated.View>
              ) : null}

              {mode === 'recurring' ? (
                <Animated.View
                  entering={FadeIn.duration(140)}
                  exiting={FadeOut.duration(90)}
                  style={styles.modeFields}
                >
                  <SegmentedButton
                    value={frequency}
                    options={[
                      { value: 'daily:1', label: 'Daily' },
                      { value: 'weekly:1', label: 'Weekly' },
                      { value: 'monthly:1', label: 'Monthly' },
                    ]}
                    onChange={setFrequency}
                  />
                  <Text
                    variant="small"
                    color={colors.text.secondary}
                    style={styles.helperText}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    maxFontSizeMultiplier={1}
                  >
                    {frequencyHelper(frequency)}
                  </Text>
                </Animated.View>
              ) : null}

              <CompactInputField
                label="Max slippage (%)"
                value={slippagePercent}
                onChangeText={(value) => setSlippagePercent(sanitizeDecimalInput(value, 2))}
                placeholder={DEFAULT_SLIPPAGE_PERCENT}
                keyboardType="decimal-pad"
              />

              <Text
                variant="small"
                color={disabledReason == null ? colors.text.tertiary : colors.semantic.warning}
                style={styles.helperText}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                maxFontSizeMultiplier={1}
              >
                {disabledReason ?? capabilityMessage(currentCapability)}
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  pressed && disabledReason == null && !isSubmitting ? styles.controlPressed : null,
                  (disabledReason != null || isSubmitting) && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={disabledReason != null || isSubmitting}
                accessibilityRole="button"
                accessibilityLabel={
                  mode === 'trigger' ? 'Review target swap' : 'Review repeat swap'
                }
                accessibilityState={{ disabled: disabledReason != null || isSubmitting }}
              >
                <View style={[{ backgroundColor: colors.brand.whiteStream }, styles.submitSurface]}>
                  <Text
                    variant="button"
                    color={colors.text.onAccent}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    maxFontSizeMultiplier={1}
                    style={styles.submitText}
                  >
                    {isSubmitting
                      ? 'Submitting'
                      : mode === 'trigger'
                        ? 'Review Target Swap'
                        : 'Review Repeat Swap'}
                  </Text>
                </View>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

        <SwapReviewFlowScreen
          visible={reviewState != null}
          title={reviewState?.title ?? 'Review swap'}
          statusLabel={reviewState?.statusLabel ?? ''}
          payLeg={reviewState?.payLeg ?? null}
          receiveLeg={reviewState?.receiveLeg ?? null}
          detailRows={reviewState?.detailRows ?? []}
          confirmLabel={reviewState?.confirmLabel ?? 'Sign & Submit'}
          busyLabel={reviewState?.busyLabel ?? 'Signing'}
          busy={isSubmitting}
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
          primaryActionLabel="Back to Advanced Swap"
          onPrimaryAction={() => setProcessResult(null)}
        />

        <TokenSelectorModal
          visible={selectionTarget != null}
          tokens={availableTokens}
          onClose={() => setSelectionTarget(null)}
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
    maxWidth: ADVANCED_CONTENT_MAX_WIDTH,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
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
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  headerIconPressed: {
    opacity: 0.72,
  },
  controlPressed: {
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
    fontFamily: fontFamily.semiBold,
    textAlign: 'center',
  },
  headerTitleDense: {
    fontSize: 25,
    lineHeight: 31,
  },
  headerSpacer: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xs,
    backgroundColor: colors.glass.strongFill,
    boxShadow: `0 2px 6px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  segmentButton: {
    flex: 1,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    paddingVertical: 7,
  },
  segmentButtonActive: {
    backgroundColor: colors.brand.glossAccent,
  },
  card: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    padding: spacing.lg,
    gap: spacing.md,
    boxShadow: `0 2px 8px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  cardCompact: {
    padding: spacing.md,
    borderRadius: radii.xl,
  },
  cardDense: {
    padding: spacing.sm,
    borderRadius: radii.xl,
  },
  sectionTitle: {
    fontFamily: fontFamily.displaySemiBold,
  },
  compactSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  compactTokenRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  compactTokenButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 3,
  },
  compactTokenLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  compactTokenValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  compactTokenSymbol: {
    flex: 1,
    minWidth: 0,
  },
  compactArrow: {
    width: 28,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: radii.full,
    backgroundColor: colors.glass.frostFill,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactInputGroup: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  compactInput: {
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  modeFields: {
    gap: spacing.sm,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  tokenSelectorGroup: {
    gap: spacing.xs,
  },
  tokenSelectorRow: {
    minHeight: 62,
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tokenSelectorText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tokenSelectorSymbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  tokenSelectorSymbol: {
    flexShrink: 1,
    minWidth: 0,
  },
  input: {
    color: colors.text.primary,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 16,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderWidth: 1,
    borderColor: colors.glass.rimSubtle,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputHelper: {
    lineHeight: 17,
  },
  helperText: {
    lineHeight: 18,
  },
  submitButton: {
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  submitButtonDisabled: {
    opacity: 0.62,
  },
  submitSurface: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  submitText: {
    textAlign: 'center',
  },
  receipts: {
    gap: spacing.md,
  },
  receiptCard: {
    flexDirection: 'row',
    gap: spacing.md,
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    padding: spacing.lg,
    boxShadow: `0 2px 8px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  receiptIcon: {
    minWidth: layout.avatarMd,
    minHeight: layout.avatarMd,
    borderRadius: radii.full,
    backgroundColor: colors.holdingsCard.pressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptContent: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  receiptText: {
    lineHeight: 18,
  },
});
