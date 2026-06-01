import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { DottedQRCode } from '@/components/ui/DottedQRCode';
import { StaggerRevealItem } from '@/components/ui/StaggerReveal';
import {
  ReceiveModeSegmentedDivider,
  type ReceiveMode,
} from '@/components/features/receive/ReceiveModeSegmentedDivider';
import { UmbraReceiveCard } from '@/components/features/receive/UmbraReceiveCard';
import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { Text } from '@/components/ui/Text';
import { PuffyInfoCircleIcon } from '@/components/ui/icons/PuffyInfoCircleIcon';
import { PuffyQRIcon } from '@/components/ui/icons/PuffyQRIcon';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOfflineBleReceiver } from '@/hooks/useOfflineBleReceiver';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useUmbraCacheInvalidator } from '@/hooks/useUmbraCacheInvalidator';
import { useUmbraExecution } from '@/hooks/useUmbraExecution';
import { useUmbraVaultRegistrationStatus } from '@/hooks/useUmbraVaultRegistrationStatus';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import { buildOffpayReceiveRequestQr } from '@/lib/offline/offline-payments';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { offpayWalletBalanceQueryKey } from '@/lib/api/offpay-wallet-query-keys';
import { mark, measure } from '@/lib/perf/perf-marks';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import {
  isRnZkProverNativeModuleAvailable,
  RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE,
} from '@/lib/umbra/umbra-rn-zk-prover';
import { useAppStore } from '@/store/app';
import { useOfflinePaymentStore } from '@/store/offlinePaymentStore';
import { getClaimedUmbraUtxoIndexSet, useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';
import { useWalletStore } from '@/store/walletStore';

import type {
  PrivatePaymentRoute,
  PrivatePaymentRouteOption,
} from '@/components/features/private-payment/send-flow/types';
import type { UmbraExecutionResult } from '@/lib/umbra/umbra-execution';

// `ReceiveInfoModal` ships ~12 KB of glassy receive-flow copy + nested
// gradients. Defer loading it until the user taps the info icon so it
// stays out of the receive flow's first-paint cost.
const ReceiveInfoModal = lazy(() =>
  import('@/components/features/receive/ReceiveInfoModal').then((module) => ({
    default: module.ReceiveInfoModal,
  })),
);

const RECEIVE_QR_LOGO = require('../../../assets/appIcons/android/playstore-icon.png') as number;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const NATIVE_SOL_ROUTE_MINT = 'native-sol';
const RECEIVE_CONTENT_MAX_WIDTH = 430;
const UMBRA_CLAIM_SCAN_PAGE_LIMIT = 32;
// Fade-out timing for the standard / private content swap. The
// outgoing content fades quickly (the user has already committed to
// the new mode); the incoming content is revealed by the per-component
// StaggerReveal rather than a container fade-in.
const MODE_CONTENT_FADE_OUT = {
  duration: 140,
  easing: Easing.in(Easing.cubic),
} as const;

function formatNetworkLabel(network: string | null): string {
  if (network === 'mainnet') return 'Mainnet';
  if (network === 'devnet') return 'Devnet';
  return 'Network';
}

function getSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
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
      style={({ pressed }) => [styles.headerIconPressable, pressed ? styles.pressed : null]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active ? { selected: true } : undefined}
    >
      <View style={[styles.headerIconSurface, active ? styles.headerIconSurfaceActive : null]}>
        {children}
      </View>
    </Pressable>
  );
}

function isNativeSolRequest(mint: string | null, token: string | null): boolean {
  return (
    mint === NATIVE_SOL_ROUTE_MINT ||
    mint === NATIVE_SOL_MINT ||
    token?.trim().toUpperCase() === 'SOL'
  );
}

export function ReceiveTokenFlow(): React.JSX.Element {
  useOfflineBleReceiver();

  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();
  const params = useLocalSearchParams<{
    mint?: string;
    token?: string;
    name?: string;
    amount?: string;
    memo?: string;
  }>();
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const accountName = useWalletStore((state) => state.accountName);
  const username = useAppStore((state) => state.username);
  const { network, unsupportedReason } = useOffpayNetwork();
  const getScreenSignal = useScreenAbortSignal();
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const { mixerRegisterMutation } = useUmbraExecution();
  const offlineReceipts = useOfflinePaymentStore((state) => state.receipts);
  const claimedUtxoInsertionRecord = useUmbraPrivacyStore(
    (state) => state.claimedUtxoInsertionIndices,
  );
  const markUmbraUtxosClaimed = useUmbraPrivacyStore((state) => state.markUtxosClaimed);
  const addUmbraReceipt = useUmbraPrivacyStore((state) => state.addReceipt);
  const umbraReceipts = useUmbraPrivacyStore((state) => state.receipts);
  const umbraHistoryForCurrentNetwork = useMemo(() => {
    if (network == null) return [];
    return umbraReceipts.filter(
      (receipt) => receipt.network === network && receipt.action === 'claim',
    );
  }, [network, umbraReceipts]);
  const claimedUmbraIndexSet = useMemo<ReadonlySet<number>>(
    () =>
      getClaimedUmbraUtxoIndexSet(
        { claimedUtxoInsertionIndices: claimedUtxoInsertionRecord },
        network ?? 'mainnet',
        walletAddress,
      ),
    [claimedUtxoInsertionRecord, network, walletAddress],
  );
  const [infoOpen, setInfoOpen] = useState(false);
  const [receiveRoute, setReceiveRoute] = useState<PrivatePaymentRoute>('normal');
  const [receiveMode, setReceiveMode] = useState<ReceiveMode>('standard');
  const [claimingUmbra, setClaimingUmbra] = useState(false);
  const [claimResult, setClaimResult] = useState<UmbraExecutionResult | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [_setupResult, setSetupResult] = useState<UmbraExecutionResult | null>(null);
  const [_setupError, setSetupError] = useState<string | null>(null);
  const [pendingClaimResult, setPendingClaimResult] = useState<UmbraExecutionResult | null>(null);
  const [scanningUmbraClaims, setScanningUmbraClaims] = useState(false);
  const [hasCheckedUmbraClaims, setHasCheckedUmbraClaims] = useState(false);
  const scanningUmbraClaimsRef = useRef(false);
  const pendingClaimToastRef = useRef<string | null>(null);
  const pendingClaimAutoScanKeyRef = useRef<string | null>(null);
  const umbraCacheInvalidator = useUmbraCacheInvalidator();
  const requestedMint = getSearchParam(params.mint);
  const requestedToken = getSearchParam(params.token);
  const requestedName = getSearchParam(params.name);
  const requestedAmount = getSearchParam(params.amount);
  const requestedMemo = getSearchParam(params.memo);
  const nativeSolRequest = isNativeSolRequest(requestedMint, requestedToken);
  const selectedTokenLabel = useMemo(() => {
    if (requestedMint == null && requestedToken == null) return null;

    return {
      symbol: nativeSolRequest ? 'SOL' : (requestedToken ?? 'Token'),
      name: nativeSolRequest ? 'Solana' : (requestedName ?? requestedToken ?? 'Selected token'),
    };
  }, [nativeSolRequest, requestedMint, requestedName, requestedToken]);
  const qrToken = useMemo(() => {
    if (selectedTokenLabel == null) return null;
    if (nativeSolRequest) return 'SOL';
    return requestedMint ?? requestedToken;
  }, [nativeSolRequest, requestedMint, requestedToken, selectedTokenLabel]);
  const canShowUmbraReceiveRoute =
    walletAddress != null &&
    walletId != null &&
    network != null &&
    isUmbraNetworkSupported(network);
  const umbraVaultRegistrationQuery = useUmbraVaultRegistrationStatus({
    enabled: canShowUmbraReceiveRoute && receiveMode === 'private',
  });
  const canUseUmbraNativeProver = isRnZkProverNativeModuleAvailable();
  const capabilities = capabilitiesQuery.capabilities;
  const umbraPrivateP2pCapability = getOffpayFeatureCapability(
    capabilities,
    'payment.umbraPrivateP2p',
  );
  const umbraExecutionCapability = getOffpayFeatureCapability(capabilities, 'umbra.execution');
  const canUseUmbraReceiveRoute =
    canShowUmbraReceiveRoute &&
    canUseUmbraNativeProver &&
    isOffpayFeatureAvailable(capabilities, 'payment.umbraPrivateP2p') &&
    isOffpayFeatureAvailable(capabilities, 'umbra.execution') &&
    isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast');
  const umbraReceiveDisabledReason = !canUseUmbraNativeProver
    ? RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE
    : !umbraPrivateP2pCapability.available
      ? umbraPrivateP2pCapability.message
      : !umbraExecutionCapability.available
        ? umbraExecutionCapability.message
        : null;
  const canScanUmbraClaims = canShowUmbraReceiveRoute && canUseUmbraReceiveRoute;
  const canUseUmbraClaim = canScanUmbraClaims;
  const umbraVaultRegistrationStatus = umbraVaultRegistrationQuery.data ?? null;
  const umbraAlreadyMixerRegistered = umbraVaultRegistrationStatus?.mixerRegistered === true;
  const receiveRouteOptions = useMemo<PrivatePaymentRouteOption[]>(() => {
    const routes: PrivatePaymentRouteOption[] = [
      {
        id: 'normal',
        label: 'Normal',
        description: 'Receive to your public wallet address.',
      },
    ];

    if (canShowUmbraReceiveRoute) {
      routes.push({
        id: 'umbra',
        label: 'Umbra',
        description:
          umbraReceiveDisabledReason == null
            ? 'Claim private P2P payments into encrypted balance.'
            : umbraReceiveDisabledReason,
        disabled: !canUseUmbraReceiveRoute,
        disabledReason: umbraReceiveDisabledReason ?? undefined,
      });
    }

    return routes;
  }, [canShowUmbraReceiveRoute, canUseUmbraReceiveRoute, umbraReceiveDisabledReason]);
  const selectedReceiveRoute = receiveRouteOptions.some(
    (route) => route.id === receiveRoute && route.disabled !== true,
  )
    ? receiveRoute
    : 'normal';

  const handleChangeReceiveMode = useCallback(
    (mode: ReceiveMode) => {
      setReceiveMode(mode);
      // Keep the legacy `receiveRoute` (used to encode the QR payload)
      // in sync with the segmented mode. When the user is on the
      // private surface we tag the QR with the umbra hint; the QR
      // itself is hidden but downstream callers that re-open the
      // standard tab still see a valid route.
      if (mode === 'private' && canUseUmbraReceiveRoute) {
        setReceiveRoute('umbra');
      } else if (mode === 'standard') {
        setReceiveRoute('normal');
      }
    },
    [canUseUmbraReceiveRoute],
  );

  const qrResult = useMemo(() => {
    if (walletAddress == null) {
      return { value: null as string | null, error: 'Unlock a wallet to receive tokens.' };
    }

    if (network == null) {
      return { value: null, error: unsupportedReason ?? 'This network is not supported.' };
    }

    try {
      return {
        value: buildOffpayReceiveRequestQr({
          recipient: walletAddress,
          network,
          amount: requestedAmount,
          token: qrToken,
          memo: requestedMemo,
          route: selectedReceiveRoute === 'umbra' ? 'umbra' : 'normal',
          bleName: username,
        }),
        error: null,
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'Unable to generate receive QR.',
      };
    }
  }, [
    network,
    qrToken,
    requestedAmount,
    requestedMemo,
    selectedReceiveRoute,
    unsupportedReason,
    username,
    walletAddress,
  ]);

  const compactReceive = width < 390 || height < 760 || fontScale > 1.08;
  const denseReceive = width < 350 || fontScale > 1.18;
  const screenHorizontalPadding = denseReceive
    ? spacing.md
    : compactReceive
      ? spacing.lg
      : spacing['2xl'];
  const contentMaxWidth = Math.min(
    Math.max(width - screenHorizontalPadding * 2, 0),
    RECEIVE_CONTENT_MAX_WIDTH,
  );
  const qrSize = Math.min(
    Math.max(contentMaxWidth - (denseReceive ? spacing['2xl'] : spacing['3xl']), 208),
    denseReceive ? 260 : compactReceive ? 286 : 310,
  );
  const networkLabel = formatNetworkLabel(network);
  const title =
    selectedTokenLabel == null ? 'Receive Address' : `Receive ${selectedTokenLabel.symbol}`;
  const walletDisplayName =
    username != null && username.length > 0
      ? `@${username}`
      : accountName != null && accountName.length > 0
        ? accountName
        : 'Wallet';
  const truncatedWalletAddress = useMemo(
    () => (walletAddress == null ? null : shortenWalletAddress(walletAddress, 5)),
    [walletAddress],
  );
  const latestReceivedReceipt = useMemo(() => {
    const now = Date.now();
    return (
      offlineReceipts
        .filter(
          (receipt) =>
            receipt.direction === 'receive' &&
            receipt.status === 'received' &&
            (network == null || receipt.network === network) &&
            now - receipt.createdAt < 2 * 60 * 1000,
        )
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }, [network, offlineReceipts]);
  const pendingClaimCount = pendingClaimResult?.pendingClaimCount ?? 0;

  const [renderedReceiveMode, setRenderedReceiveMode] = useState<ReceiveMode>('standard');
  const modeContentOpacity = useSharedValue(1);
  const isUmbraSurfaceVisible =
    renderedReceiveMode === 'private' && (canShowUmbraReceiveRoute || pendingClaimCount > 0);

  // Crossfade the content area out on mode change. The fade-out runs
  // first; once it lands we commit the new mode, then snap the
  // container back to full opacity and let the per-component
  // StaggerReveal handle the smooth entrance of the new content. Both
  // subtrees stay mounted (display: none) so swapping back is free —
  // the QR component never rebuilds its 700+ SVG nodes, and the Umbra
  // hooks keep their warm React Query cache.
  useEffect(() => {
    if (renderedReceiveMode === receiveMode) return;
    modeContentOpacity.value = withTiming(0, MODE_CONTENT_FADE_OUT, (finished) => {
      if (!finished) return;
      runOnJS(setRenderedReceiveMode)(receiveMode);
    });
  }, [modeContentOpacity, receiveMode, renderedReceiveMode]);

  useEffect(() => {
    // Snap the container opaque immediately — the staggered reveal of
    // the individual components is now the visible entrance.
    modeContentOpacity.value = 1;
  }, [modeContentOpacity, renderedReceiveMode]);

  const modeContentStyle = useAnimatedStyle(() => ({
    opacity: modeContentOpacity.value,
  }));

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.navigate('/(tabs)' as never);
  }, [router]);

  const handleOpenHistoryTab = useCallback(() => {
    router.navigate('/(tabs)/history' as never);
  }, [router]);

  const handleViewAllPendingClaims = useCallback(() => {
    router.push('/umbra-pending-claims' as never);
  }, [router]);

  const handleCopyAddress = useCallback(async () => {
    if (walletAddress == null) {
      showToast({
        title: 'Wallet required',
        message: 'Unlock a wallet first.',
        variant: 'warning',
      });
      return;
    }

    await Clipboard.setStringAsync(walletAddress);
    showToast({
      title: 'Address copied',
      message: 'Ready to share.',
      variant: 'success',
    });
  }, [showToast, walletAddress]);

  const handleShareAddress = useCallback(async () => {
    if (walletAddress == null) {
      showToast({
        title: 'Wallet required',
        message: 'Unlock a wallet first.',
        variant: 'warning',
      });
      return;
    }

    try {
      await Share.share({
        message: walletAddress,
        title: `My ${networkLabel} Solana address`,
      });
    } catch {
      // User cancelled the share sheet, or the system rejected it.
      // No toast here — silent dismissal is the expected behaviour
      // across iOS and Android system share sheets.
    }
  }, [networkLabel, showToast, walletAddress]);

  const scanUmbraPendingClaims = useCallback(() => {
    if (walletAddress == null || walletId == null || network == null || !canScanUmbraClaims) {
      setPendingClaimResult(null);
      return;
    }
    if (scanningUmbraClaimsRef.current) return;

    const signal = getScreenSignal();
    scanningUmbraClaimsRef.current = true;
    setScanningUmbraClaims(true);
    void (async () => {
      const startedAt = mark();
      const { scanUmbraPrivateP2PClaims } = await import('@/lib/umbra/umbra-execution');
      if (signal.aborted) return;
      const latestClaimedUmbraIndexSet = getClaimedUmbraUtxoIndexSet(
        {
          claimedUtxoInsertionIndices: useUmbraPrivacyStore.getState().claimedUtxoInsertionIndices,
        },
        network,
        walletAddress,
      );
      const result = await scanUmbraPrivateP2PClaims({
        walletAddress,
        walletId,
        network,
        scanMode: 'recent',
        excludedInsertionIndices: latestClaimedUmbraIndexSet,
        signal,
        pageLimit: UMBRA_CLAIM_SCAN_PAGE_LIMIT,
      });
      if (signal.aborted) return;
      const count = result.pendingClaimCount ?? 0;
      setPendingClaimResult(count > 0 ? result : null);
      setHasCheckedUmbraClaims(true);
      measure('receive.umbraClaims.scan', startedAt, {
        network,
        pendingCount: count,
        pageLimit: UMBRA_CLAIM_SCAN_PAGE_LIMIT,
      });
      if (count > 0) {
        if (canUseUmbraClaim) {
          setReceiveRoute('umbra');
          // Auto-flip the segmented divider to the private surface
          // when a pending claim appears so the Claim button is the
          // first thing the user sees.
          setReceiveMode('private');
        }
        const toastKey = `${walletAddress}:${network}:${count}:${result.nextScanStartIndex ?? ''}`;
        if (pendingClaimToastRef.current !== toastKey) {
          pendingClaimToastRef.current = toastKey;
          showToast({
            title: 'Private payment ready',
            message: result.subtitle,
            variant: 'success',
          });
        }
      }
    })()
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setPendingClaimResult(null);
        setHasCheckedUmbraClaims(true);
      })
      .finally(() => {
        scanningUmbraClaimsRef.current = false;
        if (!signal.aborted) {
          setScanningUmbraClaims(false);
        }
      });
  }, [
    canScanUmbraClaims,
    canUseUmbraClaim,
    getScreenSignal,
    network,
    showToast,
    walletAddress,
    walletId,
  ]);

  // Latch the latest `scanUmbraPendingClaims` callback in a ref so the
  // deferred private-tab scan can stay cancellable without re-scheduling
  // the heavy Umbra SDK import on every render.
  const scanLatestRef = useRef(scanUmbraPendingClaims);
  useEffect(() => {
    scanLatestRef.current = scanUmbraPendingClaims;
  }, [scanUmbraPendingClaims]);

  // The encrypted-balance query lags the claim by one Arcium decryption
  // cycle (typically 5-15 s on mainnet, longer on devnet) and the
  // public wallet balance / transactions list lag by another 30 s
  // because of upstream caching. Delegate the post-action refresh
  // schedule to the central invalidator so the curve, cleanup, and
  // query-key list stay aligned with shield/withdraw/setup.
  const schedulePostClaimEncryptedBalanceRefetch = useCallback(() => {
    umbraCacheInvalidator.scheduleRefresh({ walletAddress, network });
  }, [network, umbraCacheInvalidator, walletAddress]);

  useEffect(() => {
    if (!canScanUmbraClaims) {
      setPendingClaimResult(null);
      setHasCheckedUmbraClaims(false);
      pendingClaimAutoScanKeyRef.current = null;
      return;
    }
    if (!isUmbraSurfaceVisible || walletAddress == null || network == null) return;

    const key = `${network}:${walletAddress}`;
    if (pendingClaimAutoScanKeyRef.current === key) return;
    pendingClaimAutoScanKeyRef.current = key;

    const scheduled = scheduleUiWorkAfterFirstPaint(
      () => {
        scanLatestRef.current();
      },
      { fallbackDelayMs: 700, timeoutMs: 3000 },
    );

    return () => scheduled.cancel();
  }, [canScanUmbraClaims, isUmbraSurfaceVisible, network, walletAddress]);

  const handleClaimUmbraPayments = useCallback(() => {
    if (walletAddress == null || walletId == null || network == null || !canUseUmbraClaim) {
      showToast({
        title: 'Umbra unavailable',
        message:
          walletAddress == null || walletId == null || network == null
            ? 'Unlock wallet'
            : RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE,
        variant: 'warning',
      });
      return;
    }

    setClaimingUmbra(true);
    setClaimError(null);
    setClaimResult(null);
    void (async () => {
      const {
        claimUmbraPrivateP2PToEncryptedBalance,
        getUmbraClaimScanRangeForInsertionIndices,
        isBenignAlreadyClaimedFailure,
      } = await import('@/lib/umbra/umbra-execution');
      const { isTransientRelayerFailure } = await import('@/lib/umbra/umbra-error-messages');

      // Bounded auto-retry on transient relayer failures. The Umbra
      // relayer occasionally surfaces `tx_pipeline: RPC error:
      // sendTransaction` when its Solana RPC step times out or the
      // blockhash expires before the claim transaction lands. The
      // on-chain state is unchanged on these errors so a bare retry
      // is safe; the new ZK proof + buffer cycle restarts cleanly.
      const TRANSIENT_RETRY_DELAYS_MS = [0, 4_000, 12_000] as const;
      let result: UmbraExecutionResult | null = null;
      let lastTransientError: unknown = null;

      for (let attempt = 0; attempt < TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
        const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
        if (delay > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }

        try {
          const pendingScanRange = getUmbraClaimScanRangeForInsertionIndices(
            pendingClaimResult?.pendingClaimUtxoInsertionIndices,
          );
          result = await claimUmbraPrivateP2PToEncryptedBalance({
            walletAddress,
            walletId,
            network,
            ...pendingScanRange,
            excludedInsertionIndices: claimedUmbraIndexSet,
            pageLimit: UMBRA_CLAIM_SCAN_PAGE_LIMIT,
            // Synchronous persistence callback. The SDK invokes this
            // the moment a UTXO's on-chain nullifier is confirmed,
            // BEFORE this promise resolves. That closes the timing
            // window where the receive screen could be navigated
            // away mid-claim and miss the post-success markUtxos
            // call below — which would leave the UTXO surfacing as
            // "ready to claim" forever.
            onUtxoClaimedOnChain: (insertionIndices) => {
              markUmbraUtxosClaimed({
                network,
                walletAddress,
                insertionIndices,
              });
            },
          });
          break;
        } catch (error) {
          // Already-claimed: short-circuit to the success-equivalent
          // path. On-chain state is correct; persist exclusion indices
          // so the scan stops re-surfacing these UTXOs.
          if (isBenignAlreadyClaimedFailure(error)) {
            const fallbackIndices = pendingClaimResult?.pendingClaimUtxoInsertionIndices ?? [];
            if (fallbackIndices.length > 0) {
              markUmbraUtxosClaimed({
                network,
                walletAddress,
                insertionIndices: fallbackIndices,
              });
            }
            setPendingClaimResult(null);
            pendingClaimToastRef.current = null;
            void queryClient.invalidateQueries({
              queryKey: ['offpay', 'umbraEncryptedBalances', network, walletAddress],
            });
            showToast({
              title: 'Already claimed',
              message: 'Encrypted balance is up to date.',
              variant: 'success',
            });
            // Surface the benign already-claimed outcome in the
            // inline history strip + History tab as well, so the user
            // can see that their tap reconciled the on-chain state
            // even though the SDK reported a duplicate-nullifier.
            addUmbraReceipt({
              id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              action: 'claim',
              title: 'Claim confirmed',
              subtitle:
                fallbackIndices.length > 0
                  ? `${fallbackIndices.length} Umbra UTXO${
                      fallbackIndices.length === 1 ? '' : 's'
                    } already settled into encrypted balance.`
                  : 'Encrypted balance is already up to date.',
              signature: null,
              network,
              createdAt: Date.now(),
            });
            scanUmbraPendingClaims();
            schedulePostClaimEncryptedBalanceRefetch();
            return;
          }

          // Transient relayer / Solana-RPC failure — no nullifier was
          // inserted on-chain, the buffer was closed, the user's UTXOs
          // are still legitimately pending. Retry up to the bound.
          if (isTransientRelayerFailure(error) && attempt + 1 < TRANSIENT_RETRY_DELAYS_MS.length) {
            lastTransientError = error;
            continue;
          }

          throw error;
        }
      }

      if (result == null) {
        // All transient retries exhausted — surface a retryable
        // friendly message rather than the raw relayer string.
        throw lastTransientError ?? new Error('Unable to claim private payments.');
      }

      setClaimResult(result);
      const claimedIndices = result.claimedUtxoInsertionIndices ?? [];
      if (claimedIndices.length > 0) {
        markUmbraUtxosClaimed({
          network,
          walletAddress,
          insertionIndices: claimedIndices,
        });
      }
      if ((result.claimedUtxoCount ?? 0) > 0) {
        setPendingClaimResult(null);
        pendingClaimToastRef.current = null;
      }
      // Persist a claim receipt so the inline history strip and the
      // History tab both reflect the action. We only emit the receipt
      // when at least one UTXO actually moved into the encrypted
      // balance (or we hit the benign already-claimed short-circuit
      // — that path runs through its own catch arm above and emits
      // its own receipt below).
      if ((result.claimedUtxoCount ?? 0) > 0) {
        addUmbraReceipt({
          id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: 'claim',
          title:
            result.title === 'Already claimed'
              ? 'Claim confirmed'
              : `Claimed ${result.claimedUtxoCount} private payment${
                  (result.claimedUtxoCount ?? 0) === 1 ? '' : 's'
                }`,
          subtitle: result.subtitle,
          signature: result.primarySignature ?? result.signatures[0] ?? null,
          network,
          createdAt: Date.now(),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ['offpay', 'umbraEncryptedBalances', network, walletAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
      });
      const claimedAlready = result.title === 'Already claimed';
      showToast({
        title: claimedAlready
          ? 'Already claimed'
          : result.claimedUtxoCount === 0
            ? 'No private payments found'
            : 'Claim submitted',
        message: result.claimedUtxoCount === 0 ? undefined : result.subtitle,
        variant: result.claimedUtxoCount === 0 ? 'info' : 'success',
      });
      // Refresh the pending list so any UTXOs we just persisted in the
      // claimed-index filter disappear from the card immediately. The
      // encrypted balance lags behind by an Arcium decryption cycle,
      // so retry a few times to surface the new amount when it lands.
      scanUmbraPendingClaims();
      schedulePostClaimEncryptedBalanceRefetch();
    })()
      .catch(async (error) => {
        const { getUmbraFriendlyError } = await import('@/lib/umbra/umbra-error-messages');
        const friendly = getUmbraFriendlyError(error, 'claim');
        const rawMessage =
          error instanceof Error ? error.message : 'Unable to claim private payments.';
        setClaimError(rawMessage);
        showToast({
          title: friendly.title,
          message: friendly.message,
          variant: 'error',
        });
      })
      .finally(() => setClaimingUmbra(false));
  }, [
    addUmbraReceipt,
    canUseUmbraClaim,
    claimedUmbraIndexSet,
    markUmbraUtxosClaimed,
    network,
    pendingClaimResult,
    queryClient,
    scanUmbraPendingClaims,
    schedulePostClaimEncryptedBalanceRefetch,
    showToast,
    walletAddress,
    walletId,
  ]);

  const handleSetupUmbraPrivateP2P = useCallback(() => {
    if (walletAddress == null || walletId == null || network == null || !canUseUmbraReceiveRoute) {
      showToast({
        title: 'Umbra unavailable',
        message: umbraReceiveDisabledReason ?? 'Umbra private P2P is unavailable.',
        variant: 'warning',
      });
      return;
    }
    if (mixerRegisterMutation.isPending) return;
    if (umbraAlreadyMixerRegistered) {
      setSetupError(null);
      setSetupResult(null);
      showToast({
        title: 'Already active',
        variant: 'success',
      });
      return;
    }

    setSetupError(null);
    setSetupResult(null);
    void mixerRegisterMutation
      .mutateAsync({ walletAddress, walletId, network })
      .then((result) => {
        setSetupResult(result);
        void queryClient.invalidateQueries({
          queryKey: ['offpay', 'umbraEncryptedBalances', network, walletAddress],
        });
        void queryClient.invalidateQueries({
          queryKey: ['offpay', 'umbraVaultRegistrationStatus', network, walletAddress],
        });
        showToast({
          title: result.title,
          message: result.subtitle,
          variant: result.mixerRegistered === true ? 'success' : 'warning',
        });
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unable to set up Umbra private P2P.';
        setSetupError(message);
        showToast({
          title: 'Setup failed',
          message,
          variant: 'error',
        });
      });
  }, [
    canUseUmbraReceiveRoute,
    mixerRegisterMutation,
    network,
    queryClient,
    showToast,
    umbraAlreadyMixerRegistered,
    umbraReceiveDisabledReason,
    walletAddress,
    walletId,
  ]);

  return (
    <View style={styles.container}>
      <GradientBackground />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + (denseReceive ? spacing.sm : spacing.lg),
            paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing['4xl'],
            paddingHorizontal: screenHorizontalPadding,
          },
        ]}
      >
        <View style={[styles.content, { maxWidth: contentMaxWidth }]}>
          <View style={styles.header}>
            <HeaderIconButton onPress={handleClose} accessibilityLabel="Go back">
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
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1}
            >
              {title}
            </Text>
            <HeaderIconButton
              onPress={() => setInfoOpen(true)}
              accessibilityLabel="Receive token information"
              active={infoOpen}
            >
              <PuffyInfoCircleIcon
                size={layout.iconSizeNav}
                color={colors.brand.deepShadow}
                focused={infoOpen}
              />
            </HeaderIconButton>
          </View>

          {canShowUmbraReceiveRoute || pendingClaimCount > 0 ? (
            <ReceiveModeSegmentedDivider
              selectedMode={
                canShowUmbraReceiveRoute || pendingClaimCount > 0 ? receiveMode : 'standard'
              }
              onChangeMode={handleChangeReceiveMode}
              privateModeBadge={pendingClaimCount}
            />
          ) : null}

          <Animated.View style={[styles.modeContent, modeContentStyle]}>
            {/* Both subtrees stay mounted across mode swaps. Toggling
                `display` instead of conditionally rendering keeps the
                heavy QR component (700+ SVG circles) and the Umbra
                hooks alive, so swapping back is instant — no chunk
                eval, no React Query refetch, no SVG rebuild. */}
            <View
              key="receive-mode-standard"
              style={[styles.standardLayout, isUmbraSurfaceVisible && styles.modeHidden]}
              pointerEvents={isUmbraSurfaceVisible ? 'none' : 'auto'}
              accessibilityElementsHidden={isUmbraSurfaceVisible}
              importantForAccessibility={isUmbraSurfaceVisible ? 'no-hide-descendants' : 'auto'}
            >
              {latestReceivedReceipt != null ? (
                <StaggerRevealItem index={0} trigger={renderedReceiveMode}>
                  <View style={styles.receivedPill}>
                    <Ionicons name="checkmark" size={14} color={colors.semantic.success} />
                    <Text variant="captionBold" color={colors.text.primary} numberOfLines={1}>
                      Received {latestReceivedReceipt.amountLabel?.replace(/^\+/, '') ?? 'payment'}
                    </Text>
                  </View>
                </StaggerRevealItem>
              ) : null}

              <StaggerRevealItem
                index={1}
                trigger={renderedReceiveMode}
                style={styles.identityBlock}
              >
                <Text
                  variant="bodyBold"
                  color={colors.text.primary}
                  style={styles.identityName}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={1.05}
                >
                  {walletDisplayName}
                </Text>
                <Text
                  variant="caption"
                  color={colors.text.secondary}
                  style={styles.identityAddress}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1}
                >
                  {truncatedWalletAddress ?? 'Unlock a wallet first'}
                </Text>
              </StaggerRevealItem>

              <StaggerRevealItem index={2} trigger={renderedReceiveMode}>
                <View style={[styles.qrCard, denseReceive && styles.qrCardDense]}>
                  {qrResult.value != null ? (
                    <DottedQRCode
                      value={qrResult.value}
                      size={qrSize}
                      color={colors.brand.deepShadow}
                      backgroundColor={colors.brand.whiteStream}
                      logo={RECEIVE_QR_LOGO}
                      logoSize={Math.max(42, qrSize * 0.12)}
                    />
                  ) : (
                    <View style={[styles.qrEmpty, { width: qrSize, height: qrSize }]}>
                      <PuffyQRIcon size={layout.avatarLg} color={colors.text.tertiary} />
                      <Text variant="small" color={colors.text.secondary} align="center">
                        QR unavailable
                      </Text>
                    </View>
                  )}
                </View>
              </StaggerRevealItem>

              <StaggerRevealItem index={3} trigger={renderedReceiveMode}>
                <View style={styles.networkChip}>
                  <View style={styles.networkChipDot} />
                  <Text
                    variant="captionBold"
                    color={colors.text.primary}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1}
                  >
                    {`Solana ${networkLabel}`}
                  </Text>
                </View>
              </StaggerRevealItem>

              {qrResult.error != null ? (
                <Text
                  variant="small"
                  color={colors.semantic.warning}
                  style={styles.qrErrorMessage}
                  numberOfLines={2}
                  maxFontSizeMultiplier={1}
                >
                  {qrResult.error}
                </Text>
              ) : null}

              <StaggerRevealItem
                index={4}
                trigger={renderedReceiveMode}
                style={styles.addressActionRow}
              >
                <Pressable
                  onPress={handleCopyAddress}
                  disabled={walletAddress == null}
                  accessibilityRole="button"
                  accessibilityLabel="Copy receive address"
                  style={({ pressed }) => [
                    styles.addressActionChip,
                    walletAddress == null && styles.addressActionChipDisabled,
                    pressed && walletAddress != null && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="copy-outline"
                    size={denseReceive ? 15 : 16}
                    color={colors.brand.deepShadow}
                  />
                  <Text
                    variant="captionBold"
                    color={colors.brand.deepShadow}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1}
                  >
                    Copy address
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleShareAddress}
                  disabled={walletAddress == null}
                  accessibilityRole="button"
                  accessibilityLabel="Share receive address"
                  style={({ pressed }) => [
                    styles.addressActionChip,
                    walletAddress == null && styles.addressActionChipDisabled,
                    pressed && walletAddress != null && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="share-outline"
                    size={denseReceive ? 15 : 16}
                    color={colors.brand.deepShadow}
                  />
                  <Text
                    variant="captionBold"
                    color={colors.brand.deepShadow}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1}
                  >
                    Share
                  </Text>
                </Pressable>
              </StaggerRevealItem>
            </View>
            <View
              key="receive-mode-private"
              style={[!isUmbraSurfaceVisible && styles.modeHidden]}
              pointerEvents={!isUmbraSurfaceVisible ? 'none' : 'auto'}
              accessibilityElementsHidden={!isUmbraSurfaceVisible}
              importantForAccessibility={!isUmbraSurfaceVisible ? 'no-hide-descendants' : 'auto'}
            >
              <UmbraReceiveCard
                unavailableMessage={
                  canUseUmbraReceiveRoute ? null : (umbraReceiveDisabledReason ?? null)
                }
                setupPanel={
                  canUseUmbraReceiveRoute
                    ? {
                        title: 'Umbra Claims',
                        buttonLabel: 'Set up',
                        loadingLabel: 'Setting up',
                        onPress: handleSetupUmbraPrivateP2P,
                        disabled: !canUseUmbraReceiveRoute || mixerRegisterMutation.isPending,
                        loading: mixerRegisterMutation.isPending,
                        accessibilityLabel: 'Set up Umbra private P2P',
                        completed: umbraAlreadyMixerRegistered,
                      }
                    : undefined
                }
                pendingClaimPanel={{
                  pendingCount: pendingClaimCount,
                  status:
                    pendingClaimCount > 0
                      ? claimError
                      : (claimError ??
                        claimResult?.subtitle ??
                        (scanningUmbraClaims
                          ? 'Checking for pending private payments.'
                          : hasCheckedUmbraClaims
                            ? 'No pending private payments found.'
                            : 'Check for pending private payments when needed.')),
                  statusTone:
                    claimError != null
                      ? 'error'
                      : pendingClaimCount > 0
                        ? 'success'
                        : claimResult != null
                          ? 'success'
                          : 'neutral',
                  buttonLabel:
                    pendingClaimCount > 0
                      ? 'Claim all'
                      : hasCheckedUmbraClaims
                        ? 'Check again'
                        : 'Check pending',
                  loadingLabel: pendingClaimCount > 0 ? 'Claiming' : 'Checking',
                  onPress:
                    pendingClaimCount > 0 ? handleClaimUmbraPayments : scanUmbraPendingClaims,
                  onViewAllPress: handleViewAllPendingClaims,
                  allowEmptyAction: true,
                  disabled: !canUseUmbraClaim || claimingUmbra || scanningUmbraClaims,
                  loading: claimingUmbra || scanningUmbraClaims,
                  accessibilityLabel:
                    pendingClaimCount > 0
                      ? 'Claim all pending Umbra private payments'
                      : 'Check for pending Umbra private payments',
                }}
                history={umbraHistoryForCurrentNetwork}
                historyLimit={3}
                onViewAllHistory={
                  umbraHistoryForCurrentNetwork.length > 0 ? handleOpenHistoryTab : undefined
                }
                revealKey={renderedReceiveMode}
              />
            </View>
          </Animated.View>
        </View>
      </ScrollView>

      <Suspense fallback={null}>
        {infoOpen ? (
          <ReceiveInfoModal
            visible={infoOpen}
            networkLabel={networkLabel}
            onClose={() => setInfoOpen(false)}
          />
        ) : null}
      </Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  scrollContent: {
    alignItems: 'center',
  },
  content: {
    width: '100%',
    gap: spacing.lg,
    zIndex: 1,
  },
  header: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerIconPressable: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.glass.clearFill,
  },
  headerIconSurface: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconSurfaceActive: {
    backgroundColor: colors.glass.cyanWash,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.semiBold,
  },
  pressed: {
    opacity: 0.78,
  },

  // Wrapper that crossfades between standard and private subtrees.
  // Sized to fill the remaining width so neither child reflows during
  // the swap.
  modeContent: {
    width: '100%',
  },
  // Both subtrees stay mounted across mode swaps; the inactive one
  // collapses out of the layout entirely. `display: none` gives us
  // the same effect as a conditional render without remounting the
  // children, so the QR component (~700 SVG circles) never has to
  // rebuild and Umbra hooks keep their warm React Query cache.
  modeHidden: {
    display: 'none',
  },

  // Standard mode lays everything out as a single centred column —
  // identity, QR card, network chip, action row. No nested cards, no
  // duplicated dividers; the QR is the single visual anchor.
  standardLayout: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.lg,
  },
  receivedPill: {
    minHeight: layout.buttonHeightSm,
    maxWidth: '100%',
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  identityBlock: {
    width: '100%',
    alignItems: 'center',
    gap: 2,
    marginBottom: spacing.xs,
  },
  identityName: {
    fontFamily: fontFamily.semiBold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  identityAddress: {
    fontFamily: fontFamily.monoMedium,
    fontSize: 13,
    lineHeight: 17,
    textAlign: 'center',
  },
  qrCard: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.brand.whiteStream,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCardDense: {
    padding: spacing.md,
  },
  qrEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  qrErrorMessage: {
    width: '100%',
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  networkChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  networkChipDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.semantic.success,
  },
  addressActionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  addressActionChip: {
    flex: 1,
    minHeight: layout.buttonHeightMd,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  addressActionChipDisabled: {
    opacity: 0.48,
  },
});
