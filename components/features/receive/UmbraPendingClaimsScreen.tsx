import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppToast } from '@/components/ui/AppToast';
import { GradientBackground } from '@/components/ui/GradientBackground';
import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useScreenAbortSignal } from '@/hooks/useScreenAbortSignal';
import { useUmbraCacheInvalidator } from '@/hooks/useUmbraCacheInvalidator';
import { mark, measure } from '@/lib/perf/perf-marks';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import { getClaimedUmbraUtxoIndexSet, useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';
import { useWalletStore } from '@/store/walletStore';

import type { UmbraExecutionResult, UmbraPendingClaimUtxo } from '@/lib/umbra/umbra-execution';

const UMBRA_CLAIM_SCAN_PAGE_LIMIT = 384;
const CLAIM_ROW_ESTIMATED_HEIGHT = 252;

const ROW_BORDER = {
  borderTopWidth: 1,
  borderLeftWidth: 1,
  borderRightWidth: StyleSheet.hairlineWidth,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderColor: colors.glass.rim,
} as const;

function shortenAddress(address: string | null, head = 4, tail = 4): string {
  if (address == null || address.length === 0) return '—';
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

function shortenHex(hex: string, head = 6, tail = 4): string {
  if (hex == null || hex.length === 0) return '—';
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function formatTimestamp(ms: number | null): string {
  if (ms == null) return 'Unknown time';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  const now = Date.now();
  const delta = now - ms;
  if (delta >= 0 && delta < 60_000) return 'Just now';
  if (delta >= 60_000 && delta < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(delta / 60_000));
    return `${minutes}m ago`;
  }
  if (delta >= 60 * 60_000 && delta < 24 * 60 * 60_000) {
    const hours = Math.max(1, Math.round(delta / (60 * 60_000)));
    return `${hours}h ago`;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function removeClaimedUtxos(
  utxos: readonly UmbraPendingClaimUtxo[],
  insertionIndices: readonly number[],
): UmbraPendingClaimUtxo[] {
  if (insertionIndices.length === 0) return utxos.slice();
  const claimed = new Set(insertionIndices);
  return utxos.filter((utxo) => !claimed.has(utxo.insertionIndex));
}

interface ClaimRowProps {
  utxo: UmbraPendingClaimUtxo;
  busy: boolean;
  disabled: boolean;
  onClaim: (utxo: UmbraPendingClaimUtxo) => void;
  onCopyId: (utxo: UmbraPendingClaimUtxo) => void;
}

const ClaimRow = memo(function ClaimRow({
  utxo,
  busy,
  disabled,
  onClaim,
  onCopyId,
}: ClaimRowProps): React.JSX.Element {
  return (
    <View style={[{ backgroundColor: colors.surface.cardElevated }, styles.rowCard]}>
      <View style={styles.rowHeader}>
        <View style={styles.rowKindChip}>
          <Text
            variant="caption"
            color={colors.text.inverse}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
            style={styles.rowKindChipText}
          >
            {utxo.kind === 'receiver' ? 'RECEIVER' : 'SELF'}
          </Text>
        </View>
        <Text
          variant="caption"
          color={colors.text.tertiary}
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
          style={styles.rowTimestampText}
        >
          {formatTimestamp(utxo.depositTimestampMs)}
        </Text>
      </View>

      <View style={styles.rowMetaList}>
        <MetaRow label="UTXO ID" value={utxo.id} mono />
        <MetaRow label="Insertion" value={String(utxo.insertionIndex)} mono />
        <MetaRow label="Tree" value={String(utxo.treeIndex)} mono />
        <MetaRow label="Sender" value={shortenAddress(utxo.senderBase58)} mono />
        <MetaRow label="Mint" value={shortenAddress(utxo.mintBase58)} mono />
        <MetaRow label="Commitment" value={shortenHex(utxo.finalCommitmentHex)} mono />
      </View>

      <View style={styles.rowActions}>
        <Pressable
          onPress={() => onCopyId(utxo)}
          accessibilityRole="button"
          accessibilityLabel="Copy UTXO id"
          hitSlop={6}
          style={({ pressed }) => [styles.rowSecondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="copy-outline" size={14} color={colors.text.primary} />
          <Text
            variant="captionBold"
            color={colors.text.primary}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
            style={styles.rowSecondaryButtonText}
          >
            Copy ID
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onClaim(utxo)}
          disabled={disabled || busy}
          accessibilityRole="button"
          accessibilityLabel={`Claim Umbra UTXO ${utxo.id}`}
          accessibilityState={{ disabled: disabled || busy, busy }}
          style={({ pressed }) => [
            styles.rowPrimaryButton,
            disabled && !busy && styles.rowPrimaryButtonDisabled,
            pressed && !(disabled || busy) ? styles.pressed : null,
          ]}
        >
          {busy ? (
            <>
              <LazyLoadingSpinner size={18} color={colors.text.inverse} />
              <Text
                variant="button"
                color={colors.text.inverse}
                numberOfLines={1}
                maxFontSizeMultiplier={1.1}
                style={styles.rowPrimaryButtonText}
              >
                Claiming
              </Text>
            </>
          ) : (
            <Text
              variant="button"
              color={colors.text.inverse}
              numberOfLines={1}
              maxFontSizeMultiplier={1.1}
              style={styles.rowPrimaryButtonText}
            >
              Claim
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
});

interface MetaRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

const MetaRow = memo(function MetaRow({ label, value, mono }: MetaRowProps): React.JSX.Element {
  return (
    <View style={styles.metaRow}>
      <Text
        variant="caption"
        color={colors.text.tertiary}
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={styles.metaLabel}
      >
        {label}
      </Text>
      <Text
        variant="caption"
        color={colors.text.primary}
        numberOfLines={1}
        maxFontSizeMultiplier={1.1}
        style={[styles.metaValue, mono === true ? styles.metaValueMono : null]}
      >
        {value}
      </Text>
    </View>
  );
});

export function UmbraPendingClaimsScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const { showToast } = useAppToast();

  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const claimedUtxoInsertionRecord = useUmbraPrivacyStore(
    (state) => state.claimedUtxoInsertionIndices,
  );
  const markUmbraUtxosClaimed = useUmbraPrivacyStore((state) => state.markUtxosClaimed);
  const { network } = useOffpayNetwork();
  const umbraCacheInvalidator = useUmbraCacheInvalidator();

  const claimedIndexSet = useMemo<ReadonlySet<number>>(
    () =>
      getClaimedUmbraUtxoIndexSet(
        { claimedUtxoInsertionIndices: claimedUtxoInsertionRecord },
        network ?? 'mainnet',
        walletAddress,
      ),
    [claimedUtxoInsertionRecord, network, walletAddress],
  );

  const canScan =
    walletAddress != null &&
    walletId != null &&
    network != null &&
    isUmbraNetworkSupported(network) &&
    isRnZkProverNativeModuleAvailable();

  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deepScanning, setDeepScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [utxos, setUtxos] = useState<UmbraPendingClaimUtxo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recentClaimSettled, setRecentClaimSettled] = useState(false);
  const scanInFlightRef = useRef(false);
  const visibleUtxos = useMemo(
    () => utxos.filter((utxo) => !claimedIndexSet.has(utxo.insertionIndex)),
    [claimedIndexSet, utxos],
  );
  const pendingInsertionIndices = useMemo(
    () => visibleUtxos.map((utxo) => utxo.insertionIndex),
    [visibleUtxos],
  );

  // Cancel-on-blur signal so a focus-driven scan or pull-to-refresh
  // that resolves after the user navigates away does not write into
  // the unmounted screen's state.
  const getScreenSignal = useScreenAbortSignal();

  const runScan = useCallback(
    async (kind: 'initial' | 'refresh' | 'deep' | 'background'): Promise<void> => {
      if (!canScan || walletAddress == null || walletId == null || network == null) return;
      if (scanInFlightRef.current) return;
      const signal = getScreenSignal();
      scanInFlightRef.current = true;
      if (kind === 'initial') setScanning(true);
      else if (kind === 'deep') setDeepScanning(true);
      else setRefreshing(true);
      try {
        if (signal.aborted) return;
        const startedAt = mark();
        const { scanUmbraPrivateP2PClaims } = await import('@/lib/umbra/umbra-execution');
        if (signal.aborted) return;
        const latestExcluded = getClaimedUmbraUtxoIndexSet(
          {
            claimedUtxoInsertionIndices:
              useUmbraPrivacyStore.getState().claimedUtxoInsertionIndices,
          },
          network,
          walletAddress,
        );
        // Deep scan walks the whole tree with every master-seed scheme so
        // older payments (outside the fast recent window / created under a
        // legacy scheme) are discovered. It is slower and only ever runs on
        // explicit user request. The recent scan stays the bounded fast path.
        const isDeep = kind === 'deep';
        const result: UmbraExecutionResult = await scanUmbraPrivateP2PClaims({
          walletAddress,
          walletId,
          network,
          scanMode: isDeep ? 'deep' : 'recent',
          excludedInsertionIndices: latestExcluded,
          signal,
          pageLimit: UMBRA_CLAIM_SCAN_PAGE_LIMIT,
        });
        if (signal.aborted) return;
        setUtxos(result.pendingClaimUtxoDetails ?? []);
        if ((result.pendingClaimUtxoDetails?.length ?? 0) > 0) {
          setRecentClaimSettled(false);
        }
        setError(null);
        measure(
          isDeep ? 'receive.umbraClaims.deepScan' : 'receive.umbraClaims.fullScreenScan',
          startedAt,
          {
            network,
            pendingCount: result.pendingClaimCount ?? 0,
            pageLimit: UMBRA_CLAIM_SCAN_PAGE_LIMIT,
          },
        );
      } catch (scanError) {
        if (signal.aborted) return;
        if (kind !== 'background') {
          setError(
            scanError instanceof Error ? scanError.message : 'Unable to load pending claims.',
          );
        }
      } finally {
        scanInFlightRef.current = false;
        if (!signal.aborted) {
          if (kind === 'initial') setScanning(false);
          else if (kind === 'deep') setDeepScanning(false);
          else if (kind === 'refresh') setRefreshing(false);
        }
      }
    },
    [canScan, getScreenSignal, network, walletAddress, walletId],
  );

  useEffect(() => {
    const scheduled = scheduleUiWorkAfterFirstPaint(
      () => {
        void runScan('initial');
      },
      { fallbackDelayMs: 700, timeoutMs: 3000 },
    );
    return () => scheduled.cancel();
  }, [runScan]);

  const handleClaim = useCallback(
    (utxo: UmbraPendingClaimUtxo): void => {
      if (walletAddress == null || walletId == null || network == null || !canScan) {
        showToast({
          title: 'Umbra unavailable',
          message: 'Unlock wallet to claim private payments.',
          variant: 'warning',
        });
        return;
      }
      if (busyId != null) return;
      setBusyId(utxo.id);
      void (async () => {
        try {
          const {
            claimUmbraPrivateP2PToEncryptedBalance,
            getUmbraClaimScanRangeForInsertionIndices,
            isBenignAlreadyClaimedFailure,
          } = await import('@/lib/umbra/umbra-execution');
          // To claim a single UTXO we tell the SDK to skip every
          // other pending insertion index. Combined with the
          // existing on-device "already claimed" filter this leaves
          // exactly one candidate that the SDK will actually burn.
          const otherPendingIndices = pendingInsertionIndices.filter(
            (index) => index !== utxo.insertionIndex,
          );
          const exclusionSet = new Set<number>([...claimedIndexSet, ...otherPendingIndices]);

          try {
            const result = await claimUmbraPrivateP2PToEncryptedBalance({
              walletAddress,
              walletId,
              network,
              ...getUmbraClaimScanRangeForInsertionIndices([utxo.insertionIndex]),
              excludedInsertionIndices: exclusionSet,
              pageLimit: UMBRA_CLAIM_SCAN_PAGE_LIMIT,
              onUtxoClaimedOnChain: (insertionIndices) => {
                markUmbraUtxosClaimed({
                  network,
                  walletAddress,
                  insertionIndices,
                });
                setUtxos((current) => removeClaimedUtxos(current, insertionIndices));
                setRecentClaimSettled(true);
              },
            });
            const claimed = result.claimedUtxoCount ?? 0;
            const claimedIndices =
              result.claimedUtxoInsertionIndices != null &&
              result.claimedUtxoInsertionIndices.length > 0
                ? result.claimedUtxoInsertionIndices
                : claimed > 0
                  ? [utxo.insertionIndex]
                  : [];
            if (claimedIndices.length > 0) {
              markUmbraUtxosClaimed({
                network,
                walletAddress,
                insertionIndices: claimedIndices,
              });
              setUtxos((current) => removeClaimedUtxos(current, claimedIndices));
              setError(null);
              setRecentClaimSettled(true);
            }
            showToast({
              title: claimed > 0 ? 'Claim submitted' : 'Already settled',
              message: result.subtitle,
              variant: claimed > 0 ? 'success' : 'info',
            });
            umbraCacheInvalidator.scheduleRefresh({ walletAddress, network });
            void runScan('background');
          } catch (claimError) {
            if (isBenignAlreadyClaimedFailure(claimError)) {
              markUmbraUtxosClaimed({
                network,
                walletAddress,
                insertionIndices: [utxo.insertionIndex],
              });
              setUtxos((current) => removeClaimedUtxos(current, [utxo.insertionIndex]));
              setError(null);
              setRecentClaimSettled(true);
              showToast({
                title: 'Already claimed',
                message: 'Encrypted balance is up to date.',
                variant: 'success',
              });
              umbraCacheInvalidator.scheduleRefresh({ walletAddress, network });
              void runScan('background');
            } else {
              const { getUmbraFriendlyError } = await import('@/lib/umbra/umbra-error-messages');
              const friendly = getUmbraFriendlyError(claimError, 'claim');
              showToast({
                title: friendly.title,
                message: friendly.message,
                variant: 'error',
              });
            }
          }
        } finally {
          setBusyId(null);
        }
      })();
    },
    [
      busyId,
      canScan,
      claimedIndexSet,
      markUmbraUtxosClaimed,
      network,
      runScan,
      showToast,
      umbraCacheInvalidator,
      pendingInsertionIndices,
      walletAddress,
      walletId,
    ],
  );

  const handleCopyId = useCallback(
    async (utxo: UmbraPendingClaimUtxo): Promise<void> => {
      await Clipboard.setStringAsync(utxo.id);
      showToast({
        title: 'UTXO ID copied',
        message: utxo.id,
        variant: 'success',
      });
    },
    [showToast],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.navigate('/(tabs)' as never);
  }, [router]);

  const compact = width < 380 || fontScale > 1.08;
  const screenHorizontalPadding = compact ? spacing.lg : spacing['2xl'];
  const handleCopyIdPress = useCallback(
    (target: UmbraPendingClaimUtxo) => {
      void handleCopyId(target);
    },
    [handleCopyId],
  );
  const renderClaimItem = useCallback<ListRenderItem<UmbraPendingClaimUtxo>>(
    ({ item }) => (
      <ClaimRow
        utxo={item}
        busy={busyId === item.id}
        disabled={busyId != null && busyId !== item.id}
        onClaim={handleClaim}
        onCopyId={handleCopyIdPress}
      />
    ),
    [busyId, handleClaim, handleCopyIdPress],
  );
  const keyExtractor = useCallback((item: UmbraPendingClaimUtxo) => item.id, []);
  const getItemLayout = useCallback(
    (_: ArrayLike<UmbraPendingClaimUtxo> | null | undefined, index: number) => ({
      length: CLAIM_ROW_ESTIMATED_HEIGHT,
      offset: CLAIM_ROW_ESTIMATED_HEIGHT * index,
      index,
    }),
    [],
  );

  return (
    <View style={styles.container}>
      <GradientBackground />
      <FlatList
        data={visibleUtxos}
        renderItem={renderClaimItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + (compact ? spacing.sm : spacing.lg),
            paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing['4xl'],
            paddingHorizontal: screenHorizontalPadding,
          },
          visibleUtxos.length === 0 ? styles.scrollContentCentered : null,
        ]}
        ItemSeparatorComponent={ClaimRowSeparator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void runScan('refresh')}
            tintColor={colors.text.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable
              style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]}
              onPress={handleBack}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <View
                style={[{ backgroundColor: colors.surface.cardElevated }, styles.headerIconSurface]}
              >
                <Ionicons
                  name="chevron-back"
                  size={layout.iconSizeNav}
                  color={colors.text.primary}
                />
              </View>
            </Pressable>
            <Text
              variant="h2"
              color={colors.text.inverse}
              align="center"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
              maxFontSizeMultiplier={1}
              style={styles.headerTitle}
            >
              Pending Claims
            </Text>
            <View style={styles.headerSpacer} />
          </View>
        }
        ListEmptyComponent={
          scanning && visibleUtxos.length === 0 ? (
            <View style={styles.emptyState}>
              <LazyLoadingSpinner size={28} color={colors.text.primary} />
              <Text
                variant="small"
                color={colors.text.secondary}
                align="center"
                maxFontSizeMultiplier={1}
                style={styles.statusText}
              >
                Loading pending Umbra claims…
              </Text>
            </View>
          ) : error != null ? (
            <View style={styles.emptyState}>
              <Text
                variant="bodyBold"
                color={colors.semantic.error}
                align="center"
                numberOfLines={2}
                maxFontSizeMultiplier={1}
              >
                Couldn’t load claims
              </Text>
              <Text
                variant="small"
                color={colors.text.secondary}
                align="center"
                numberOfLines={3}
                maxFontSizeMultiplier={1}
                style={styles.statusText}
              >
                {error}
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              {recentClaimSettled ? (
                <View style={styles.emptySuccessIcon}>
                  <Ionicons name="checkmark" size={22} color={colors.text.primary} />
                </View>
              ) : null}
              <Text
                variant="bodyBold"
                color={colors.text.primary}
                align="center"
                maxFontSizeMultiplier={1.1}
              >
                {recentClaimSettled ? 'All caught up' : 'No pending claims'}
              </Text>
              <Text
                variant="small"
                color={colors.text.secondary}
                align="center"
                numberOfLines={2}
                maxFontSizeMultiplier={1}
                style={styles.statusText}
              >
                {recentClaimSettled
                  ? 'Claim moved into encrypted balance. Balances may take a moment to refresh.'
                  : 'New private payments will show up here.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Deep scan for older private payments"
                disabled={deepScanning || scanning || refreshing}
                onPress={() => void runScan('deep')}
                style={({ pressed }) => [
                  styles.deepScanButton,
                  !deepScanning && (scanning || refreshing) && styles.deepScanButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {deepScanning ? (
                  <LazyLoadingSpinner size={18} color={colors.text.primary} />
                ) : (
                  <Ionicons name="search" size={16} color={colors.text.primary} />
                )}
                <Text variant="captionBold" color={colors.text.primary} maxFontSizeMultiplier={1.1}>
                  {deepScanning ? 'Deep scanning…' : 'Scan for older payments'}
                </Text>
              </Pressable>
            </View>
          )
        }
      />
    </View>
  );
}

const ClaimRowSeparator = memo(function ClaimRowSeparator(): React.JSX.Element {
  return <View style={styles.claimRowSeparator} />;
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGradient.base,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollContentCentered: {
    justifyContent: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerIconBtn: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
    borderRadius: radii.full,
    overflow: 'hidden',
    ...ROW_BORDER,
    backgroundColor: colors.glass.strongFill,
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
  },
  headerSpacer: {
    width: layout.minTouchTarget + spacing.xs,
    height: layout.minTouchTarget + spacing.xs,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    gap: spacing.sm,
  },
  emptySuccessIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.notificationIcon.successFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.semantic.success,
  },
  deepScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.glass.frostFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  deepScanButtonDisabled: {
    opacity: 0.6,
  },
  statusText: {
    maxWidth: 320,
  },
  claimRowSeparator: {
    height: spacing.md,
  },
  rowCard: {
    borderRadius: radii.xl,
    borderCurve: 'continuous',
    ...ROW_BORDER,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    boxShadow: `0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowKindChip: {
    minHeight: 28,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.md,
    backgroundColor: colors.brand.actionFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowKindChipText: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0.6,
    fontSize: 11,
    lineHeight: 14,
  },
  rowTimestampText: {
    fontFamily: fontFamily.uiSemiBold,
  },
  rowMetaList: {
    gap: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metaLabel: {
    fontFamily: fontFamily.uiSemiBold,
    letterSpacing: 0.4,
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 0,
  },
  metaValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: fontFamily.regular,
  },
  metaValueMono: {
    fontFamily: fontFamily.mono,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowSecondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.surface.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
  },
  rowSecondaryButtonText: {
    fontFamily: fontFamily.semiBold,
  },
  rowPrimaryButton: {
    minHeight: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.full,
    backgroundColor: colors.brand.actionFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    maxWidth: '100%',
  },
  rowPrimaryButtonDisabled: {
    opacity: 0.4,
  },
  rowPrimaryButtonText: {
    fontFamily: fontFamily.semiBold,
  },
  pressed: {
    opacity: 0.78,
  },
});
