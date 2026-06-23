import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UmbraVaultActionPanel } from '@/components/features/umbra-vault/umbra-vault-action-panel';
import { UmbraVaultPortfolioCard } from '@/components/features/umbra-vault/umbra-vault-portfolio-card';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayTokenLogoMap } from '@/hooks/useOffpayTokenLogoMap';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useActiveWalletSigningCapability } from '@/hooks/useActiveWalletSigningCapability';
import { useFirstPaintReady } from '@/hooks/useFirstPaintReady';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import { useUmbraEncryptedBalances } from '@/hooks/useUmbraEncryptedBalances';
import { useUmbraExecution } from '@/hooks/useUmbraExecution';
import { useUmbraVaultRegistrationStatus } from '@/hooks/useUmbraVaultRegistrationStatus';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { getOffpayFeatureCapability } from '@/lib/api/offpay-capabilities';
import { formatLamportsAsExactSol } from '@/lib/crypto/solana-amounts';
import {
  buildUmbraTransactionNotificationIdentifier,
  presentUmbraTransactionNotification,
} from '@/lib/notifications/local-notifications';
import {
  decimalInputToAtomicAmount,
  formatAtomicAmount,
  sanitizeDecimalInput,
} from '@/lib/policy/token-amounts';
import { getUmbraFriendlyError } from '@/lib/umbra/umbra-error-messages';
import {
  getUmbraSupportedTokens,
  isUmbraNetworkSupported,
} from '@/lib/umbra/umbra-supported-tokens';
import { useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';
import { useWalletStore } from '@/store/walletStore';

import {
  getVaultBalanceForToken,
  getVaultTokenRowLabel,
  type UmbraVaultBalanceLoadState,
} from './umbra-vault-format';

import type { AppToastVariant } from '@/components/ui/AppToast';
import type { WalletBalanceResponse } from '@/types/offpay-api';
import type { StyleProp, ViewStyle } from 'react-native';
import type { UmbraVaultAction, UmbraVaultBalance, UmbraVaultToken } from './types';

type PublicVaultToken = WalletBalanceResponse['tokens'][number];
type VaultActionFeedbackTone = 'default' | 'danger';

interface VaultActionFeedback {
  label: string;
  tone: VaultActionFeedbackTone;
  disabled: boolean;
  toastTitle: string;
  toastMessage?: string;
  toastVariant: AppToastVariant;
}

interface UmbraTokenLogoMap {
  byMint: ReadonlyMap<string, string>;
  bySymbol: ReadonlyMap<string, string>;
}

const UMBRA_ACTION_MIN_SOL_LAMPORTS = 5_000;
const VAULT_SETUP_ACTION_LABEL = 'Set Up';
const EMPTY_VAULT_BALANCES: UmbraVaultBalance[] = [];

function decimalInputToPositiveAtomic(value: string, decimals: number): bigint | null {
  const atomic = decimalInputToAtomicAmount(value, decimals);
  if (atomic == null) return null;
  const amount = BigInt(atomic);
  return amount > 0n ? amount : null;
}

function decimalBalanceToAtomic(value: string, decimals: number): bigint | null {
  const atomic = decimalInputToAtomicAmount(value, decimals);
  return atomic == null ? null : BigInt(atomic);
}

function rawBalanceToAtomic(value: string | null | undefined): bigint | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function getUmbraSolFundingIssue(
  balance: WalletBalanceResponse | null | undefined,
): { title: string; message: string } | null {
  if (balance == null || !Number.isFinite(balance.solBalance)) {
    return {
      title: 'Refresh balance',
      message: 'SOL fee check unavailable.',
    };
  }

  const solLamports = Math.max(0, Math.trunc(balance.solBalance));
  if (solLamports >= UMBRA_ACTION_MIN_SOL_LAMPORTS) return null;

  return {
    title: `Need ${formatLamportsAsExactSol(UMBRA_ACTION_MIN_SOL_LAMPORTS)} SOL`,
    message: `Have ${formatLamportsAsExactSol(solLamports)} SOL.`,
  };
}

function selectPublicVaultToken(
  tokens: PublicVaultToken[] | undefined,
  symbol: UmbraVaultToken,
  mint: string | null | undefined,
): PublicVaultToken | null {
  const matches = (tokens ?? [])
    .filter(
      (item) =>
        !item.spam &&
        (item.mint === mint || item.symbol.trim().toUpperCase() === symbol.toUpperCase()),
    )
    .sort((left, right) => {
      const leftBalance = Number(left.balance);
      const rightBalance = Number(right.balance);
      const leftPositive = Number.isFinite(leftBalance) && leftBalance > 0 ? 1 : 0;
      const rightPositive = Number.isFinite(rightBalance) && rightBalance > 0 ? 1 : 0;
      if (leftPositive !== rightPositive) return rightPositive - leftPositive;
      if (left.verified !== right.verified) return left.verified ? -1 : 1;
      return rightBalance - leftBalance;
    });

  return matches[0] ?? null;
}

function getVaultDisabledMessage(params: {
  walletAddress: string | null;
  network: string | null;
  canUseNetwork: boolean;
  signingBlocker: string | null;
  capabilityAvailable: boolean;
  capabilityMessage: string;
  umbraNetworkSupported: boolean;
}): string | null {
  if (params.walletAddress == null || params.network == null) {
    return 'Unlock a wallet on a supported network first.';
  }
  if (!params.umbraNetworkSupported) {
    return `Umbra vault actions are not available on ${params.network} yet.`;
  }
  if (!params.canUseNetwork) {
    return 'Go online to use Umbra vault actions.';
  }
  if (params.signingBlocker != null) {
    return params.signingBlocker;
  }
  if (!params.capabilityAvailable) {
    return params.capabilityMessage;
  }
  return null;
}

function getDefaultVaultActionLabel(action: UmbraVaultAction): string {
  return action === 'withdraw' ? 'Withdraw' : 'Shield';
}

function buildDangerVaultFeedback(
  label: string,
  toastTitle = label,
  toastMessage?: string,
): VaultActionFeedback {
  return {
    label,
    tone: 'danger',
    disabled: true,
    toastTitle,
    toastMessage,
    toastVariant: 'warning',
  };
}

function buildVaultActionFeedback(params: {
  action: UmbraVaultAction;
  token: UmbraVaultToken;
  amount: string;
  amountAtomic: bigint | null;
  selectedTokenConfig: { decimals: number } | null;
  canUseVault: boolean;
  disabledMessage: string | null;
  isSubmitLocked: boolean;
  vaultRegistered: boolean;
  vaultSetupPendingLabel: string | null;
  walletBalanceLoading: boolean;
  walletBalanceError: unknown;
  activeWalletBalance: WalletBalanceResponse | null;
  selectedPublicToken: PublicVaultToken | null;
  publicBalanceAtomic: bigint | null;
  vaultBalanceRaw: string | null | undefined;
  vaultBalanceState: string | null | undefined;
  shieldedBalanceAtomic: bigint | null;
  encryptedBalanceLoading: boolean;
  encryptedBalanceError: unknown;
  activeBalanceLoaded: boolean;
  showBalanceIssues: boolean;
}): VaultActionFeedback {
  const defaultLabel = getDefaultVaultActionLabel(params.action);
  const defaultFeedback = (
    label: string,
    toastTitle = label,
    toastMessage?: string,
  ): VaultActionFeedback => ({
    label,
    tone: 'default',
    disabled: true,
    toastTitle,
    toastMessage,
    toastVariant: 'warning',
  });
  const validateFundsFeedback = (): VaultActionFeedback => ({
    label: 'Review',
    tone: 'default',
    disabled: false,
    toastTitle: 'Validate funds',
    toastMessage: 'Checking on-chain balances before submitting.',
    toastVariant: 'info',
  });
  const dangerFeedback = (
    label: string,
    toastTitle = label,
    toastMessage?: string,
  ): VaultActionFeedback => buildDangerVaultFeedback(label, toastTitle, toastMessage);

  if (!params.canUseVault) {
    return dangerFeedback(
      params.disabledMessage ?? 'Umbra unavailable',
      'Umbra unavailable',
      params.disabledMessage ?? undefined,
    );
  }

  if (params.isSubmitLocked) {
    return defaultFeedback('Wait', 'Transaction in progress');
  }

  if (params.selectedTokenConfig == null) {
    return dangerFeedback('Token unavailable', 'Token unavailable');
  }

  if (params.vaultSetupPendingLabel != null) {
    return defaultFeedback(params.vaultSetupPendingLabel, params.vaultSetupPendingLabel);
  }

  if (!params.vaultRegistered) {
    return dangerFeedback(VAULT_SETUP_ACTION_LABEL, 'Set up vault first');
  }

  if (params.amount.trim().length === 0 || params.amountAtomic == null) {
    return defaultFeedback('Amount', 'Amount required');
  }

  if (params.activeWalletBalance == null) {
    if (params.walletBalanceError != null) {
      return dangerFeedback('Refresh', 'Unable to verify balance');
    }

    if (params.walletBalanceLoading) {
      return defaultFeedback('Checking');
    }

    return defaultFeedback('Refresh');
  }

  if (params.action !== 'withdraw') {
    if (params.selectedPublicToken == null) {
      if (!params.showBalanceIssues) return validateFundsFeedback();
      return dangerFeedback(
        'Insufficient',
        `Insufficient ${params.token}`,
        `${params.token} is not available in this wallet.`,
      );
    }

    if (params.publicBalanceAtomic == null) {
      if (!params.showBalanceIssues) return validateFundsFeedback();
      return dangerFeedback('Refresh', 'Unable to verify amount');
    }

    if (params.amountAtomic > params.publicBalanceAtomic) {
      if (!params.showBalanceIssues) return validateFundsFeedback();
      return dangerFeedback(
        'Insufficient',
        `Insufficient ${params.token}`,
        `Available: ${params.selectedPublicToken.balance} ${params.token}.`,
      );
    }

    const fundingIssue = getUmbraSolFundingIssue(params.activeWalletBalance);
    if (fundingIssue != null) {
      if (!params.showBalanceIssues) return validateFundsFeedback();
      return dangerFeedback('Low SOL', fundingIssue.title, fundingIssue.message);
    }

    return {
      label: defaultLabel,
      tone: 'default',
      disabled: false,
      toastTitle: defaultLabel,
      toastVariant: 'info',
    };
  }

  if (!params.activeBalanceLoaded) {
    if (params.encryptedBalanceError != null) {
      return dangerFeedback('Refresh', 'Unable to verify vault balance');
    }

    if (params.encryptedBalanceLoading) {
      return defaultFeedback('Checking');
    }

    return defaultFeedback('Refresh');
  }

  if (params.vaultBalanceState !== 'shared' || params.vaultBalanceRaw == null) {
    return defaultFeedback(
      'Refresh',
      'Vault balance not ready',
      'Wait for shield to settle',
    );
  }

  if (params.shieldedBalanceAtomic == null) {
    if (!params.showBalanceIssues) return validateFundsFeedback();
    return dangerFeedback('Refresh', 'Unable to verify vault balance');
  }

  if (params.amountAtomic > params.shieldedBalanceAtomic) {
    if (!params.showBalanceIssues) return validateFundsFeedback();
    const displayBalance = formatAtomicAmount(
      params.vaultBalanceRaw,
      params.selectedTokenConfig.decimals,
      6,
    );
    return dangerFeedback(
      'Insufficient',
      `Insufficient shielded ${params.token}`,
      `Available: ${displayBalance} ${params.token}.`,
    );
  }

  const fundingIssue = getUmbraSolFundingIssue(params.activeWalletBalance);
  if (fundingIssue != null) {
    if (!params.showBalanceIssues) return validateFundsFeedback();
    return dangerFeedback('Low SOL', fundingIssue.title, fundingIssue.message);
  }

  return {
    label: defaultLabel,
    tone: 'default',
    disabled: false,
    toastTitle: defaultLabel,
    toastVariant: 'info',
  };
}

interface UmbraVaultContentProps {
  showHeader?: boolean;
  style?: StyleProp<ViewStyle>;
  tokenLogoMap?: UmbraTokenLogoMap;
}

interface UmbraVaultContentBodyProps {
  showHeader?: boolean;
  style?: StyleProp<ViewStyle>;
  tokenLogoMap: UmbraTokenLogoMap;
}

function UmbraVaultContentWithLogoQuery(
  props: Omit<UmbraVaultContentProps, 'tokenLogoMap'>,
): React.JSX.Element {
  const tokenLogoMap = useOffpayTokenLogoMap();
  return <UmbraVaultContentBody {...props} tokenLogoMap={tokenLogoMap} />;
}

export function UmbraVaultContent({
  tokenLogoMap,
  ...props
}: UmbraVaultContentProps): React.JSX.Element {
  if (tokenLogoMap != null) {
    return <UmbraVaultContentBody {...props} tokenLogoMap={tokenLogoMap} />;
  }

  return <UmbraVaultContentWithLogoQuery {...props} />;
}

function UmbraVaultContentBody({
  showHeader = true,
  style,
  tokenLogoMap,
}: UmbraVaultContentBodyProps): React.JSX.Element {
  const router = useRouter();
  const { width, height, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const { network } = useOffpayNetwork();
  const capabilitiesQuery = useOffpayCapabilities();
  const walletBalanceQuery = useOffpayWalletBalance();
  const { signingBlocker } = useActiveWalletSigningCapability();
  const umbraExecutionCapability = getOffpayFeatureCapability(
    capabilitiesQuery.capabilities,
    'umbra.execution',
  );
  const { canUseNetwork } = useWalletModeState();
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { registerMutation, repairKeyMutation, shieldMutation, unshieldMutation } =
    useUmbraExecution();
  const setupInFlightRef = useRef(false);
  const [setupInFlight, setSetupInFlight] = useState(false);
  const [setupConfirmationPending, setSetupConfirmationPending] = useState(false);
  const submitInFlightRef = useRef(false);
  // Cancel-on-blur signal for the user-driven refresh path. Mutations
  // (setup / repair / shield / unshield) are out of scope — the user
  // committed to those actions and any post-action invalidation work
  // should still run even if they navigate away mid-flight.
  const getScreenSignal = useScreenAbortSignal();
  const registeredVaultKeys = useUmbraPrivacyStore((state) => state.registeredVaultKeys);
  const setVaultRegistered = useUmbraPrivacyStore((state) => state.setVaultRegistered);
  const supportedTokens = useMemo(
    () => (network == null ? [] : getUmbraSupportedTokens(network)),
    [network],
  );
  const disabledMessage = getVaultDisabledMessage({
    walletAddress,
    network,
    canUseNetwork,
    signingBlocker,
    capabilityAvailable: umbraExecutionCapability.available,
    capabilityMessage: umbraExecutionCapability.message,
    umbraNetworkSupported: network != null && isUmbraNetworkSupported(network),
  });
  const canUseVault = disabledMessage == null;
  const umbraQueriesReady = useFirstPaintReady({ fallbackDelayMs: 700, timeoutMs: 3000 });
  const umbraQueriesEnabled = umbraQueriesReady && canUseVault;
  const encryptedBalancesQuery = useUmbraEncryptedBalances(supportedTokens, {
    enabled: umbraQueriesEnabled,
  });
  const vaultRegistrationQuery = useUmbraVaultRegistrationStatus({
    enabled: umbraQueriesEnabled && encryptedBalancesQuery.isError,
  });
  const [action, setAction] = useState<UmbraVaultAction>('shield');
  const [token, setToken] = useState<UmbraVaultToken>(() => supportedTokens[0]?.symbol ?? 'USDC');
  const [amount, setAmount] = useState('');
  const [fundsValidationPending, setFundsValidationPending] = useState(false);
  const [verifiedBalanceFeedback, setVerifiedBalanceFeedback] =
    useState<VaultActionFeedback | null>(null);
  const selectedTokenConfig =
    supportedTokens.find((item) => item.symbol === token) ?? supportedTokens[0] ?? null;
  const compact = width < 390 || height < 760 || fontScale > 1.05;
  const dense = width < 350 || fontScale > 1.18;

  const isActionSubmitting =
    shieldMutation.isPending || unshieldMutation.isPending || repairKeyMutation.isPending;
  const activeVaultKey =
    walletAddress != null && network != null ? `${network}:${walletAddress}` : null;
  const activeBalanceResult =
    encryptedBalancesQuery.data?.walletAddress === walletAddress &&
    encryptedBalancesQuery.data.network === network
      ? encryptedBalancesQuery.data
      : null;
  const balances = activeBalanceResult?.balances ?? EMPTY_VAULT_BALANCES;
  const hasUnreadableShieldedBalance = balances.some(
    (balance) =>
      balance.state === 'shared_unreadable' ||
      balance.state === 'shared_key_mismatch' ||
      (balance.state === 'shared' && balance.rawBalance == null),
  );
  const hasUmbraKeyMismatch = balances.some(
    (balance) =>
      balance.state === 'shared_key_mismatch' || balance.unreadableReason === 'key_mismatch',
  );
  const mismatchedVaultTokens = balances
    .filter(
      (balance) =>
        balance.state === 'shared_key_mismatch' || balance.unreadableReason === 'key_mismatch',
    )
    .map((balance) => balance.symbol);
  const encryptedBalanceFriendlyError = useMemo(
    () =>
      encryptedBalancesQuery.error == null
        ? null
        : getUmbraFriendlyError(encryptedBalancesQuery.error, 'balance'),
    [encryptedBalancesQuery.error],
  );
  const encryptedBalanceLoadState: UmbraVaultBalanceLoadState =
    activeBalanceResult != null
      ? 'ready'
      : encryptedBalancesQuery.error != null
        ? 'error'
        : encryptedBalancesQuery.isLoading ||
            encryptedBalancesQuery.isFetching ||
            encryptedBalancesQuery.isPending ||
            encryptedBalancesQuery.isCapabilitiesPending ||
            canUseVault
          ? 'loading'
          : 'idle';
  const encryptedBalanceStatusMessage =
    activeBalanceResult == null && encryptedBalanceFriendlyError != null
      ? encryptedBalanceFriendlyError.message
      : hasUmbraKeyMismatch
        ? 'Encrypted token account uses a different Umbra key than this wallet account.'
        : hasUnreadableShieldedBalance
          ? 'Encrypted vault account found, but this wallet could not decrypt the amount.'
          : null;
  const persistedVaultRegistered =
    activeVaultKey != null && registeredVaultKeys.includes(activeVaultKey);
  const activeVaultRegistrationStatus =
    vaultRegistrationQuery.walletAddress === walletAddress &&
    vaultRegistrationQuery.network === network
      ? (vaultRegistrationQuery.data ?? null)
      : null;
  const onChainVaultCanShield =
    activeVaultRegistrationStatus?.vaultCanShield === true ||
    activeBalanceResult?.vaultCanShield === true;
  // Sticky-true: prefer the network truth when we have it, otherwise
  // fall back to the persisted last-known-good. Once persisted is
  // `true` we keep showing the registered UI even while the network
  // probe is still pending — the previous `?? persisted` chain would
  // briefly flash the `Set Up` CTA whenever the encrypted-balance
  // probe was unresolved.
  const vaultRegistered = onChainVaultCanShield || persistedVaultRegistered;
  const vaultSetupChecking =
    canUseVault &&
    !vaultRegistered &&
    activeVaultRegistrationStatus == null &&
    activeBalanceResult == null &&
    (vaultRegistrationQuery.isLoading ||
      vaultRegistrationQuery.isFetching ||
      vaultRegistrationQuery.isPending ||
      vaultRegistrationQuery.isCapabilitiesPending ||
      encryptedBalancesQuery.isLoading ||
      encryptedBalancesQuery.isFetching ||
      encryptedBalancesQuery.isPending ||
      encryptedBalancesQuery.isCapabilitiesPending);
  const vaultSetupPendingLabel = setupConfirmationPending
    ? 'Confirming setup'
    : vaultSetupChecking
      ? 'Checking setup'
      : null;
  const isSubmitLocked =
    registerMutation.isPending ||
    setupInFlight ||
    setupConfirmationPending ||
    vaultSetupChecking ||
    isActionSubmitting ||
    fundsValidationPending ||
    submitInFlightRef.current;
  const activeWalletBalance =
    walletBalanceQuery.data?.address === walletAddress &&
    walletBalanceQuery.data.network === network
      ? walletBalanceQuery.data
      : null;
  const selectedPublicToken = useMemo(
    () => selectPublicVaultToken(activeWalletBalance?.tokens, token, selectedTokenConfig?.mint),
    [activeWalletBalance?.tokens, selectedTokenConfig?.mint, token],
  );
  const selectedVaultBalance = getVaultBalanceForToken(balances, token);
  const inputAmountAtomic =
    selectedTokenConfig == null
      ? null
      : decimalInputToPositiveAtomic(amount.trim(), selectedTokenConfig.decimals);
  const selectedPublicBalanceAtomic =
    selectedPublicToken == null || selectedTokenConfig == null
      ? null
      : decimalBalanceToAtomic(selectedPublicToken.balance, selectedTokenConfig.decimals);
  const selectedShieldedBalanceAtomic = rawBalanceToAtomic(selectedVaultBalance?.rawBalance);
  const maxAmountValue = useMemo(() => {
    if (selectedTokenConfig == null) return null;
    if (action === 'withdraw') {
      if (selectedVaultBalance?.state !== 'shared' || selectedVaultBalance.rawBalance == null) {
        return null;
      }
      const shieldedAtomic = rawBalanceToAtomic(selectedVaultBalance.rawBalance);
      if (shieldedAtomic == null || shieldedAtomic <= 0n) return null;
      return formatAtomicAmount(
        selectedVaultBalance.rawBalance,
        selectedTokenConfig.decimals,
        selectedTokenConfig.decimals,
      );
    }
    if (selectedPublicToken == null || selectedPublicBalanceAtomic == null) return null;
    if (selectedPublicBalanceAtomic <= 0n) return null;
    return sanitizeDecimalInput(selectedPublicToken.balance, selectedTokenConfig.decimals);
  }, [
    action,
    selectedPublicBalanceAtomic,
    selectedPublicToken,
    selectedTokenConfig,
    selectedVaultBalance,
  ]);
  const networkLabel = network === 'mainnet' ? 'Mainnet' : network === 'devnet' ? 'Devnet' : null;
  const vaultActionSubtitle = useMemo(() => {
    if (action === 'shield') {
      if (selectedPublicBalanceAtomic != null && selectedTokenConfig != null) {
        return `${formatAtomicAmount(selectedPublicBalanceAtomic.toString(), selectedTokenConfig.decimals)} ${token} available`;
      }
      return `0 ${token} available`;
    }
    return getVaultTokenRowLabel(balances, token, { loadState: encryptedBalanceLoadState });
  }, [
    action,
    balances,
    encryptedBalanceLoadState,
    selectedPublicBalanceAtomic,
    selectedTokenConfig,
    token,
  ]);
  const baseActionFeedback = buildVaultActionFeedback({
    action,
    token,
    amount,
    amountAtomic: inputAmountAtomic,
    selectedTokenConfig,
    canUseVault,
    disabledMessage,
    isSubmitLocked,
    vaultRegistered,
    vaultSetupPendingLabel,
    walletBalanceLoading:
      walletBalanceQuery.isLoading ||
      walletBalanceQuery.isFetching ||
      walletBalanceQuery.isCapabilitiesPending,
    walletBalanceError: walletBalanceQuery.error,
    activeWalletBalance,
    selectedPublicToken,
    publicBalanceAtomic: selectedPublicBalanceAtomic,
    vaultBalanceRaw: selectedVaultBalance?.rawBalance,
    vaultBalanceState: selectedVaultBalance?.state,
    shieldedBalanceAtomic: selectedShieldedBalanceAtomic,
    encryptedBalanceLoading: encryptedBalancesQuery.isLoading || encryptedBalancesQuery.isFetching,
    encryptedBalanceError: encryptedBalancesQuery.error,
    activeBalanceLoaded: activeBalanceResult != null,
    showBalanceIssues: false,
  });
  const actionFeedback =
    verifiedBalanceFeedback != null && !baseActionFeedback.disabled
      ? verifiedBalanceFeedback
      : baseActionFeedback;
  const actionSubmitDisabled = actionFeedback.disabled;

  useEffect(() => {
    if (supportedTokens.length === 0) return;
    const stillValid = supportedTokens.some((item) => item.symbol === token);
    if (stillValid) return;
    setToken(supportedTokens[0].symbol);
  }, [supportedTokens, token]);

  useEffect(() => {
    if (activeVaultKey == null) return;
    if (onChainVaultCanShield) {
      setVaultRegistered(activeVaultKey, true);
      setSetupConfirmationPending(false);
      return;
    }
    if (activeVaultRegistrationStatus != null && !vaultRegistrationQuery.isFetching) {
      setVaultRegistered(activeVaultKey, false);
      setSetupConfirmationPending(false);
    }
  }, [
    activeVaultKey,
    activeVaultRegistrationStatus,
    onChainVaultCanShield,
    setVaultRegistered,
    vaultRegistrationQuery.isFetching,
  ]);

  useEffect(() => {
    setVerifiedBalanceFeedback(null);
  }, [action, amount, network, token, vaultRegistered, walletAddress]);

  const refreshBalances = useCallback(
    (silent = false) => {
      if (walletAddress == null || network == null || !canUseVault || supportedTokens.length === 0)
        return;
      // The user-driven "Refresh" button (and the silent post-action
      // refresh) — short-circuit if the screen has already blurred so
      // the toast and side-effect chain doesn't fire on a discarded
      // surface. The query itself is still managed by React Query,
      // which will let go of the in-flight HTTP if the observer
      // unmounts.
      const signal = getScreenSignal();
      setVerifiedBalanceFeedback(null);
      void encryptedBalancesQuery.refetch().then((result) => {
        if (signal.aborted) return;
        if (result.error == null) {
          if (!silent && result.data != null) {
            showToast({
              title: 'Shielded balance refreshed',
              message: result.data.subtitle,
              variant: 'success',
            });
          }
          return;
        }
        if (silent) return;
        const friendlyError = getUmbraFriendlyError(result.error, 'balance');
        showToast({
          title: friendlyError.title,
          message: friendlyError.message,
          variant: 'error',
        });
      });
    },
    [
      canUseVault,
      encryptedBalancesQuery,
      getScreenSignal,
      network,
      showToast,
      supportedTokens,
      walletAddress,
    ],
  );

  const handleSetup = () => {
    void (async () => {
      if (setupInFlightRef.current) return;
      if (
        walletAddress == null ||
        network == null ||
        !canUseVault ||
        registerMutation.isPending ||
        vaultSetupChecking ||
        setupConfirmationPending
      ) {
        return;
      }

      setupInFlightRef.current = true;
      setSetupInFlight(true);
      try {
        setFundsValidationPending(true);
        setVerifiedBalanceFeedback(null);
        try {
          const refreshedBalance = await walletBalanceQuery.refetch();
          if (refreshedBalance.error != null || refreshedBalance.data == null) {
            showToast({
              title: 'Unable to verify balance',
              message: 'Refresh and retry',
              variant: 'warning',
            });
            return;
          }
          const freshBalance =
            refreshedBalance.data?.address === walletAddress &&
            refreshedBalance.data.network === network
              ? refreshedBalance.data
              : null;
          if (freshBalance == null) {
            showToast({
              title: 'Unable to verify balance',
              message: 'Account mismatch',
              variant: 'warning',
            });
            return;
          }
          const fundingIssue = getUmbraSolFundingIssue(freshBalance);
          if (fundingIssue != null) {
            showToast({
              title: fundingIssue.title,
              message: fundingIssue.message,
              variant: 'warning',
            });
            return;
          }
        } finally {
          setFundsValidationPending(false);
        }

        showToast({
          title: 'Setting up Umbra vault',
          message: 'Submitting vault registration.',
          variant: 'info',
        });
        const result = await registerMutation.mutateAsync({ walletAddress, walletId, network });
        const setupConfirmed = result.vaultCanShield === true;
        if (activeVaultKey != null) {
          setVaultRegistered(activeVaultKey, setupConfirmed);
        }
        setSetupConfirmationPending(!setupConfirmed);
        showToast({
          title: result.title,
          message: result.subtitle,
          variant: setupConfirmed ? 'success' : 'warning',
        });
        const setupSignature = result.primarySignature ?? result.signatures[0] ?? null;
        if (setupSignature != null) {
          void presentUmbraTransactionNotification({
            identifier: buildUmbraTransactionNotificationIdentifier({
              network,
              action: 'setup',
              signature: setupSignature,
            }),
            action: 'setup',
            setupStatus: setupConfirmed ? 'ready' : 'submitted',
            signature: setupSignature,
          });
        }
        void walletBalanceQuery.refetch();
        void vaultRegistrationQuery.refetch();
        refreshBalances(true);
      } catch (error) {
        const friendlyError = getUmbraFriendlyError(error, 'setup');
        const shouldWaitForConfirmation =
          friendlyError.title === 'Transaction not confirmed' ||
          friendlyError.title === 'Vault not ready';
        setSetupConfirmationPending(shouldWaitForConfirmation);
        showToast({
          title: friendlyError.title,
          message: friendlyError.message,
          variant: 'error',
        });
        void walletBalanceQuery.refetch();
        void vaultRegistrationQuery.refetch();
      } finally {
        setupInFlightRef.current = false;
        setSetupInFlight(false);
      }
    })();
  };

  const handleRepairVaultKey = () => {
    void (async () => {
      if (
        walletAddress == null ||
        network == null ||
        !canUseVault ||
        repairKeyMutation.isPending ||
        mismatchedVaultTokens.length === 0
      ) {
        return;
      }

      showToast({
        title: 'Repairing vault key',
        message: 'Submitting encrypted balance re-encryption.',
        variant: 'info',
      });
      try {
        const result = await repairKeyMutation.mutateAsync({
          walletAddress,
          walletId,
          network,
          tokens: mismatchedVaultTokens,
        });
        showToast({
          title: result.title,
          message: result.subtitle,
          variant: result.title === 'Vault key repaired' ? 'success' : 'info',
        });
        refreshBalances(true);
      } catch (error) {
        const friendlyError = getUmbraFriendlyError(error, 'setup');
        showToast({
          title: friendlyError.title,
          message: friendlyError.message,
          variant: 'error',
        });
        refreshBalances(true);
      }
    })();
  };

  const handleSubmitAction = () => {
    void (async () => {
      if (actionFeedback.disabled) {
        if (actionFeedback.label === VAULT_SETUP_ACTION_LABEL) {
          handleSetup();
          return;
        }

        showToast({
          title: actionFeedback.toastTitle,
          message: actionFeedback.toastMessage,
          variant: actionFeedback.toastVariant,
        });

        if (actionFeedback.label === 'Refresh balance') {
          void walletBalanceQuery.refetch();
        }
        if (actionFeedback.label === 'Refresh vault balance') {
          refreshBalances(true);
        }
        return;
      }

      if (submitInFlightRef.current) return;
      if (walletAddress == null || network == null || !canUseVault || isSubmitLocked) return;
      const submissionAction = action;
      submitInFlightRef.current = true;

      try {
        const cleanedAmount = amount.trim();
        if (cleanedAmount.length === 0) {
          showToast({
            title: 'Amount required',
            message: 'Enter an amount',
            variant: 'warning',
          });
          return;
        }
        if (!vaultRegistered) {
          showToast({
            title: 'Set up vault first',
            variant: 'warning',
          });
          return;
        }
        if (selectedTokenConfig == null) {
          showToast({
            title: 'Token unavailable',
            message: `Token not on ${networkLabel ?? network}`,
            variant: 'warning',
          });
          return;
        }
        const amountAtomic = decimalInputToPositiveAtomic(
          cleanedAmount,
          selectedTokenConfig.decimals,
        );
        if (amountAtomic == null) {
          showToast({
            title: 'Amount required',
            message: `Enter ${token} amount`,
            variant: 'warning',
          });
          return;
        }

        setFundsValidationPending(true);
        setVerifiedBalanceFeedback(null);
        let freshWalletBalance: WalletBalanceResponse | null = null;
        let freshSelectedPublicToken: PublicVaultToken | null = null;
        let freshSelectedVaultBalance = selectedVaultBalance;
        try {
          const refreshedWalletBalance = await walletBalanceQuery.refetch();
          if (refreshedWalletBalance.error != null || refreshedWalletBalance.data == null) {
            showToast({
              title: 'Unable to verify balance',
              message: 'Refresh and retry',
              variant: 'warning',
            });
            return;
          }

          freshWalletBalance =
            refreshedWalletBalance.data.address === walletAddress &&
            refreshedWalletBalance.data.network === network
              ? refreshedWalletBalance.data
              : null;
          if (freshWalletBalance == null) {
            showToast({
              title: 'Unable to verify balance',
              message: 'Account mismatch',
              variant: 'warning',
            });
            return;
          }

          freshSelectedPublicToken = selectPublicVaultToken(
            freshWalletBalance.tokens,
            token,
            selectedTokenConfig.mint,
          );

          if (submissionAction === 'withdraw') {
            const refreshedVaultBalance = await encryptedBalancesQuery.refetch();
            if (refreshedVaultBalance.error != null || refreshedVaultBalance.data == null) {
              showToast({
                title: 'Unable to verify vault',
                message: 'Refresh shielded balance',
                variant: 'warning',
              });
              return;
            }

            const freshVaultResult =
              refreshedVaultBalance.data.walletAddress === walletAddress &&
              refreshedVaultBalance.data.network === network
                ? refreshedVaultBalance.data
                : null;
            freshSelectedVaultBalance = getVaultBalanceForToken(
              freshVaultResult?.balances ?? [],
              token,
            );
          }
        } finally {
          setFundsValidationPending(false);
        }

        if (submissionAction !== 'withdraw') {
          if (freshSelectedPublicToken == null) {
            const feedback = buildDangerVaultFeedback(
              `Insufficient ${token}`,
              `${token} unavailable`,
              `${token} is not loaded in your on-chain wallet balance.`,
            );
            setVerifiedBalanceFeedback(feedback);
            showToast({
              title: feedback.toastTitle,
              message: feedback.toastMessage,
              variant: feedback.toastVariant,
            });
            return;
          }
          const publicBalanceAtomic = decimalBalanceToAtomic(
            freshSelectedPublicToken.balance,
            selectedTokenConfig.decimals,
          );
          if (publicBalanceAtomic == null || amountAtomic > publicBalanceAtomic) {
            const feedback = buildDangerVaultFeedback(
              `Insufficient ${token}`,
              `Insufficient ${token}`,
              `Available: ${freshSelectedPublicToken.balance} ${token}.`,
            );
            setVerifiedBalanceFeedback(feedback);
            showToast({
              title: feedback.toastTitle,
              message: feedback.toastMessage,
              variant: feedback.toastVariant,
            });
            return;
          }
        }

        if (submissionAction === 'withdraw') {
          if (
            freshSelectedVaultBalance?.state !== 'shared' ||
            freshSelectedVaultBalance.rawBalance == null
          ) {
            showToast({
              title: 'Vault balance not ready',
              message: 'Wait for shield to settle',
              variant: 'warning',
            });
            refreshBalances(true);
            return;
          }
          const shieldedBalanceAtomic = rawBalanceToAtomic(freshSelectedVaultBalance.rawBalance);
          if (shieldedBalanceAtomic == null) {
            const feedback = buildDangerVaultFeedback(
              'Unable to verify vault',
              'Vault balance unavailable',
              'Refresh shielded balance',
            );
            setVerifiedBalanceFeedback(feedback);
            showToast({
              title: feedback.toastTitle,
              message: feedback.toastMessage,
              variant: feedback.toastVariant,
            });
            refreshBalances(true);
            return;
          }
          if (amountAtomic > shieldedBalanceAtomic) {
            const displayBalance = formatAtomicAmount(
              freshSelectedVaultBalance.rawBalance,
              selectedTokenConfig.decimals,
              6,
            );
            const feedback = buildDangerVaultFeedback(
              `Insufficient ${token}`,
              `Insufficient shielded ${token}`,
              `Available: ${displayBalance} ${token}.`,
            );
            setVerifiedBalanceFeedback(feedback);
            showToast({
              title: feedback.toastTitle,
              message: feedback.toastMessage,
              variant: feedback.toastVariant,
            });
            return;
          }
        }
        const fundingIssue = getUmbraSolFundingIssue(freshWalletBalance);
        if (fundingIssue != null) {
          const feedback = buildDangerVaultFeedback(
            'Insufficient SOL',
            fundingIssue.title,
            fundingIssue.message,
          );
          setVerifiedBalanceFeedback(feedback);
          showToast({
            title: feedback.toastTitle,
            message: feedback.toastMessage,
            variant: feedback.toastVariant,
          });
          return;
        }

        showToast({
          title: submissionAction === 'withdraw' ? `Withdrawing ${token}` : `Shielding ${token}`,
          message: 'Submitting...',
          variant: 'info',
        });
        const onSuccess = (result: { title: string; subtitle: string }) => {
          setVerifiedBalanceFeedback(null);
          setAmount('');
          showToast({
            title: result.title,
            message: result.subtitle,
            variant: 'success',
          });
          void walletBalanceQuery.refetch();
          refreshBalances(true);
        };
        const tokenMint =
          submissionAction === 'withdraw'
            ? (freshSelectedVaultBalance?.mint ?? selectedTokenConfig.mint)
            : (freshSelectedPublicToken?.mint ?? selectedTokenConfig.mint);

        if (submissionAction === 'withdraw') {
          const result = await unshieldMutation.mutateAsync({
            walletAddress,
            walletId,
            network,
            token,
            tokenMint,
            amount: cleanedAmount,
            recipient: null,
          });
          onSuccess(result);
          return;
        }

        const result = await shieldMutation.mutateAsync({
          walletAddress,
          walletId,
          network,
          token,
          tokenMint,
          amount: cleanedAmount,
          recipient: null,
        });
        onSuccess(result);
      } catch (error) {
        const friendlyError = getUmbraFriendlyError(error, submissionAction);
        showToast({
          title: friendlyError.title,
          message: friendlyError.message,
          variant: 'error',
        });
        void walletBalanceQuery.refetch();
        refreshBalances(true);
      } finally {
        submitInFlightRef.current = false;
      }
    })();
  };

  return (
    <View
      style={[
        styles.content,
        compact && styles.contentCompact,
        dense && styles.contentDense,
        style,
      ]}
    >
      {showHeader ? (
        <View style={styles.header}>
          <Pressable
            style={styles.headerIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
          >
            <Ionicons
              name="chevron-back"
              size={layout.iconSizeNav}
              color={colors.brand.glossAccent}
            />
          </Pressable>
          <Text
            variant="h2"
            color={colors.text.primary}
            style={styles.headerTitle}
            numberOfLines={1}
          >
            Private Vault
          </Text>
          <View style={styles.headerIconBtn}>
            <Ionicons
              name="lock-closed-outline"
              size={layout.iconSizeNav}
              color={colors.brand.glossAccent}
            />
          </View>
        </View>
      ) : null}

      <UmbraVaultPortfolioCard
        balances={balances}
        tokens={supportedTokens}
        balanceLoadState={encryptedBalanceLoadState}
        balanceStatusMessage={encryptedBalanceStatusMessage}
        vaultRegistered={vaultRegistered}
        loading={encryptedBalancesQuery.isFetching}
        disabled={!canUseVault}
        disabledMessage={disabledMessage}
        networkLabel={networkLabel}
        repairLoading={repairKeyMutation.isPending}
        repairAvailable={hasUmbraKeyMismatch}
        tokenLogos={tokenLogoMap}
        onRepair={handleRepairVaultKey}
        onRefresh={() => refreshBalances(false)}
      />

      <UmbraVaultActionPanel
        action={action}
        token={token}
        tokens={supportedTokens}
        balances={balances}
        balanceLoadState={encryptedBalanceLoadState}
        subtitle={vaultActionSubtitle}
        amount={amount}
        loading={isActionSubmitting || fundsValidationPending}
        loadingLabel={fundsValidationPending ? 'Check' : 'Send'}
        disabled={actionSubmitDisabled}
        feedbackLabel={actionFeedback.label}
        feedbackTone={actionFeedback.tone}
        disabledMessage={disabledMessage}
        maxAmount={maxAmountValue}
        onActionChange={(nextAction) => {
          setAction(nextAction);
        }}
        onTokenChange={setToken}
        onAmountChange={(nextAmount) => {
          const decimals = selectedTokenConfig?.decimals ?? 9;
          setAmount(sanitizeDecimalInput(nextAmount, decimals));
        }}
        onMaxPress={() => {
          if (maxAmountValue == null) return;
          setAmount(maxAmountValue);
        }}
        onSubmit={handleSubmitAction}
      />
    </View>
  );
}

export function UmbraVaultScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const compact = width < 390 || height < 760 || fontScale > 1.05;
  const dense = width < 350 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <GradientBackground />
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.screenContent,
              {
                paddingTop: insets.top + (compact ? spacing.md : spacing.lg),
                paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md,
                paddingHorizontal: horizontalPadding,
              },
            ]}
          >
            <UmbraVaultContent style={styles.contentFrame} />
          </ScrollView>
        </KeyboardAvoidingView>
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
  screenContent: {
    flexGrow: 1,
    alignItems: 'center',
  },
  contentFrame: {
    width: '100%',
    maxWidth: 430,
  },
  content: {
    gap: spacing.lg,
  },
  contentCompact: {
    gap: spacing.md,
  },
  contentDense: {
    gap: spacing.sm,
  },
  header: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.whiteStream,
    padding: spacing.xs,
    boxShadow: `0 2px 8px rgba(16, 16, 16, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)`,
  },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.brand.glassTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: fontFamily.displaySemiBold,
  },
});
