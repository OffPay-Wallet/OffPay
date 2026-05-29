/**
 * PreferencesModal — bottom-sheet modal for app preferences.
 *
 * Orchestrator that composes:
 * - Root menu (SettingsLineItem rows)
 * - WalletModeStep — online/offline toggle
 * - NetworkStep — Solana cluster selector
 *
 * Network selection updates the OffPay backend network used by API-backed
 * wallet, swap, and payment modules.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import { SettingsLineItem } from '@/components/features/settings/SettingsLineItem';
import { NetworkStep } from '@/components/features/preferences/NetworkStep';
import { OfflinePaymentSlotsStep } from '@/components/features/preferences/OfflinePaymentSlotsStep';
import { WalletModeStep } from '@/components/features/preferences/WalletModeStep';
import { PuffyNetworkIcon } from '@/components/ui/icons/PuffyNetworkIcon';
import { PuffyPaymentsIcon } from '@/components/ui/icons/PuffyPaymentsIcon';
import { PuffyWifiIcon } from '@/components/ui/icons/PuffyWifiIcon';
import { colors } from '@/constants/colors';
import { SOLANA_NETWORKS } from '@/constants/networks';
import { layout, radii, spacing } from '@/constants/spacing';
import { scheduleUiWorkAfterFirstPaint, yieldToUi } from '@/lib/perf/ui-work-scheduler';
import { useOffpayNetworkTransitionStore } from '@/store/offpayNetworkTransitionStore';
import { usePreferencesStore } from '@/store/preferencesStore';

import type { SolanaNetworkId } from '@/constants/networks';
import type { ScheduledUiWork } from '@/lib/perf/ui-work-scheduler';
import type { WalletMode } from '@/store/preferencesStore';

type Step = 'root' | 'walletMode' | 'offlinePayments' | 'network';

interface PreferencesModalProps {
  visible: boolean;
  onClose: () => void;
}

const SHEET_HEIGHTS: Record<Step, number> = {
  root: layout.buttonHeightLg * 4 + spacing['4xl'] + spacing.xl,
  walletMode: layout.buttonHeightLg * 3 + spacing['4xl'],
  offlinePayments: layout.buttonHeightLg * 10 + spacing['4xl'],
  network: layout.buttonHeightLg * 3 + spacing['4xl'],
};

const HEADER_TITLES: Record<Step, string> = {
  root: 'Preferences',
  walletMode: 'Wallet Mode',
  offlinePayments: 'Offline Payments',
  network: 'Network',
};

const SHEET_GLASS_COLORS = [
  colors.glass.strongFill,
  colors.glass.frostFill,
  colors.glass.clearFill,
] as const;
const SHEET_SHADOW =
  '0 8px 24px rgba(14, 42, 53, 0.14)';
const NAV_TIMING = { duration: 180, easing: Easing.out(Easing.cubic) } as const;
const SHEET_SIZE_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) } as const;
const NETWORK_SWITCH_SETTLE_OPTIONS = {
  timeoutMs: 3000,
  fallbackDelayMs: 650,
} as const;

/**
 * How long the action-button lockout (`isNetworkSwitching`) holds after
 * a switch is committed. Long enough for the WS reconnect, balance
 * refetch, and capability re-query to land in most environments;
 * short enough that the user doesn't feel locked out.
 *
 * Picked at the midpoint of the agreed 600-800ms range. Bumping this
 * up smooths slow networks but extends the visible "Switching network…"
 * label; bumping it down makes the app feel snappier but risks
 * unblocking action buttons before the new network's data settles.
 */
const NETWORK_SWITCH_FINISH_DELAY_MS = 700;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PreferencesModal({
  visible,
  onClose,
}: PreferencesModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const [step, setStep] = useState<Step>('root');
  const walletModeCommitIdRef = React.useRef(0);
  const walletModeCommitRef = React.useRef<ScheduledUiWork | null>(null);
  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const sheetMaxWidth = 430;
  const rootIconSize = dense ? 20 : compact ? 22 : layout.iconSizeNav;

  // Store values
  const walletMode = usePreferencesStore((s) => s.walletMode);
  const offlinePaymentsEnabled = usePreferencesStore((s) => s.offlinePaymentsEnabled);
  const offlinePaymentPoolSize = usePreferencesStore((s) => s.offlinePaymentPoolSize);
  const network = usePreferencesStore((s) => s.network);
  const [optimisticWalletMode, setOptimisticWalletMode] = useState(walletMode);
  const [optimisticNetwork, setOptimisticNetwork] = useState(network);

  const setWalletMode = usePreferencesStore((s) => s.setWalletMode);
  const setOfflinePaymentsEnabled = usePreferencesStore((s) => s.setOfflinePaymentsEnabled);
  const setOfflinePaymentPoolSize = usePreferencesStore((s) => s.setOfflinePaymentPoolSize);
  const setNetwork = usePreferencesStore((s) => s.setNetwork);
  const beginNetworkSwitch = useOffpayNetworkTransitionStore((s) => s.beginNetworkSwitch);
  const finishNetworkSwitch = useOffpayNetworkTransitionStore((s) => s.finishNetworkSwitch);
  const queryClient = useQueryClient();

  useEffect(() => {
    setOptimisticWalletMode(walletMode);
  }, [walletMode]);

  useEffect(() => {
    setOptimisticNetwork(network);
  }, [network]);

  useEffect(() => {
    return () => {
      walletModeCommitIdRef.current += 1;
      walletModeCommitRef.current?.cancel();
      walletModeCommitRef.current = null;
    };
  }, []);

  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;
  const maxSheetHeight = windowHeight - insets.top - overlayPaddingBottom - spacing.lg;
  const sheetHeight = Math.max(
    layout.buttonHeightLg * 4 + spacing['3xl'],
    Math.min(SHEET_HEIGHTS[step], maxSheetHeight),
  );

  const translateY = useSharedValue(windowHeight);
  const opacity = useSharedValue(0);
  const animatedSheetHeight = useSharedValue(sheetHeight);
  const contentProgress = useSharedValue(1);
  const contentDirection = useSharedValue(1);

  // Animation
  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: 220 });
      translateY.value = withTiming(0, {
        duration: 320,
        easing: Easing.out(Easing.poly(4)),
      });
    } else {
      translateY.value = withTiming(windowHeight, {
        duration: 220,
        easing: Easing.in(Easing.ease),
      });
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      setStep('root');
    }
  }, [opacity, translateY, visible, windowHeight]);

  useEffect(() => {
    animatedSheetHeight.value = withTiming(sheetHeight, SHEET_SIZE_TIMING);
  }, [animatedSheetHeight, sheetHeight]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    height: animatedSheetHeight.value,
    transform: [{ translateY: translateY.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 0.74 + contentProgress.value * 0.26,
    transform: [
      {
        translateX: (1 - contentProgress.value) * contentDirection.value * (dense ? 8 : 14),
      },
    ],
  }));

  const handleClose = useCallback(
    (afterClose?: () => void): void => {
      const finishClose = (): void => {
        onClose();
        afterClose?.();
      };

      translateY.value = withTiming(
        windowHeight,
        { duration: 220, easing: Easing.in(Easing.ease) },
        () => runOnJS(finishClose)(),
      );
      opacity.value = withTiming(0, { duration: 220 });
    },
    [onClose, opacity, translateY, windowHeight],
  );

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const networkLabel = useMemo(() => {
    const found = SOLANA_NETWORKS.find((n) => n.id === optimisticNetwork);
    return found?.label ?? 'Mainnet';
  }, [optimisticNetwork]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const navigateToStep = useCallback(
    (nextStep: Step): void => {
      contentDirection.value = nextStep === 'root' ? -1 : 1;
      contentProgress.value = 0;
      setStep(nextStep);
      requestAnimationFrame(() => {
        contentProgress.value = withTiming(1, NAV_TIMING);
      });
    },
    [contentDirection, contentProgress],
  );

  const handleWalletModeSelect = useCallback(
    (mode: WalletMode): void => {
      if (mode === optimisticWalletMode) return;

      setOptimisticWalletMode(mode);
      walletModeCommitRef.current?.cancel();

      const commitId = walletModeCommitIdRef.current + 1;
      walletModeCommitIdRef.current = commitId;
      walletModeCommitRef.current = scheduleUiWorkAfterFirstPaint(
        () => {
          if (walletModeCommitIdRef.current !== commitId) return;
          setWalletMode(mode);
          walletModeCommitRef.current = null;
        },
        {
          timeoutMs: 1200,
          fallbackDelayMs: 160,
        },
      );
    },
    [optimisticWalletMode, setWalletMode],
  );

  const handleNetworkSelect = useCallback(
    (id: SolanaNetworkId): void => {
      if (id === optimisticNetwork) return;

      setOptimisticNetwork(id);

      handleClose(() => {
        scheduleUiWorkAfterFirstPaint(
          async () => {
            // Order matters here:
            //   1. `beginNetworkSwitch` flips the suspension + switching
            //      flags BEFORE we touch `queryClient`. Read-only hooks
            //      gate on `canUseNetwork` so they stop fanning out
            //      immediately. Action buttons gate on
            //      `isNetworkSwitching` for visible "Switching
            //      network…" feedback.
            //   2. `cancelQueries` runs while the OLD network is still
            //      committed in `preferencesStore`. This drops in-flight
            //      requests against the old endpoint without racing the
            //      new-network queries that would otherwise have started
            //      had we already flipped the network.
            //   3. `await yieldToUi()` lets the cancellation actually
            //      land before we rotate to the new network.
            //   4. `setNetwork(id)` rotates the network. New-network
            //      queries with the same key shape will re-key and
            //      mount fresh.
            //   5. `finishNetworkSwitch(epoch)` re-enables action
            //      buttons after a fixed 700ms. The epoch guard means
            //      a stale finish from a superseded switch (rapid
            //      double-toggle) is silently ignored.
            const { epoch } = beginNetworkSwitch(NETWORK_SWITCH_SETTLE_OPTIONS);

            // Cancel old-network in-flight queries. Mutations are NOT
            // touched: `cancelQueries` only affects queries, so a
            // running swap/send mutation completes against the old
            // network's RPC and the user's pending money flow is
            // unaffected. Every OffPay query keys with `['offpay', ...]`
            // (verified via grep across the codebase), so a single
            // prefix match is exhaustive.
            await queryClient.cancelQueries({ queryKey: ['offpay'] });
            await yieldToUi();
            setNetwork(id);

            setTimeout(() => {
              finishNetworkSwitch(epoch);
            }, NETWORK_SWITCH_FINISH_DELAY_MS);
          },
          {
            timeoutMs: 1600,
            fallbackDelayMs: 240,
          },
        );
      });
    },
    [
      beginNetworkSwitch,
      finishNetworkSwitch,
      handleClose,
      optimisticNetwork,
      queryClient,
      setNetwork,
    ],
  );

  if (!mounted) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}>
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <ModalBackdropScrim />
        <TouchableWithoutFeedback onPress={() => handleClose()}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>

      {/* Sheet */}
      <View
        style={[
          styles.overlay,
          { paddingBottom: overlayPaddingBottom, paddingHorizontal: horizontalPadding },
        ]}
      >
        <Animated.View
          style={[styles.sheet, { width: '100%', maxWidth: sheetMaxWidth }, sheetStyle]}
        >
          <LinearGradient
            colors={[...SHEET_GLASS_COLORS]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.04, y: 0 }}
            end={{ x: 1, y: 1 }}
          />

          {/* Header */}
          <View style={[styles.headerRow, compact ? styles.headerRowCompact : undefined]}>
            <View style={styles.headerLeft}>
              {step !== 'root' ? (
                <Pressable
                  style={styles.headerIconBtn}
                  onPress={() => navigateToStep('root')}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  hitSlop={6}
                >
                  <Ionicons
                    name="chevron-back"
                    size={layout.iconSizeNav}
                    color={colors.brand.deepShadow}
                  />
                </Pressable>
              ) : (
                <View style={styles.headerIconPlaceholder} />
              )}
            </View>
            <Text
              variant="h2"
              color={colors.text.primary}
              style={[styles.headerTitle, compact && styles.headerTitleCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              maxFontSizeMultiplier={1.05}
            >
              {HEADER_TITLES[step]}
            </Text>
            <View style={styles.headerRight}>
              <Pressable
                style={styles.headerIconBtn}
                onPress={() => handleClose()}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={6}
              >
                <Ionicons
                  name="close"
                  size={layout.iconSizeInline}
                  color={colors.brand.azureCyan}
                />
              </Pressable>
            </View>
          </View>

          {/* Body — delegates to sub-components */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={[
              styles.bodyContent,
              step !== 'root' ? styles.bodySubStep : undefined,
              compact && step !== 'root' ? styles.bodyCompact : undefined,
            ]}
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View style={[styles.stepContent, contentStyle]}>
              {step === 'root' ? (
                <>
                  <SettingsLineItem
                    icon={
                      <PuffyWifiIcon
                        size={rootIconSize}
                        color={colors.text.primary}
                        focused
                        off={optimisticWalletMode === 'offline'}
                      />
                    }
                    title="Wallet Mode"
                    subtitle={
                      optimisticWalletMode === 'online'
                        ? 'Live OffPay services while connected'
                        : 'Offline tools stay available even when online'
                    }
                    right={
                      <Text
                        variant="small"
                        color={colors.text.secondary}
                        style={[styles.rightLabel, dense && styles.rightLabelDense]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1}
                      >
                        {optimisticWalletMode === 'online' ? 'Online' : 'Offline'}
                      </Text>
                    }
                    compact={compact}
                    dense={dense}
                    onPress={() => navigateToStep('walletMode')}
                  />
                  <View style={styles.divider} />

                  <SettingsLineItem
                    icon={
                      <PuffyPaymentsIcon size={rootIconSize} color={colors.text.primary} focused />
                    }
                    title="Offline Payments"
                    subtitle={
                      offlinePaymentsEnabled
                        ? `${offlinePaymentPoolSize} payment slots requested`
                        : 'Prepare payment slots for offline P2P'
                    }
                    right={
                      <Text
                        variant="small"
                        color={colors.text.secondary}
                        style={[styles.rightLabel, dense && styles.rightLabelDense]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1}
                      >
                        {offlinePaymentsEnabled ? `${offlinePaymentPoolSize}` : 'Off'}
                      </Text>
                    }
                    compact={compact}
                    dense={dense}
                    onPress={() => navigateToStep('offlinePayments')}
                  />
                  <View style={styles.divider} />

                  <SettingsLineItem
                    icon={
                      <PuffyNetworkIcon size={rootIconSize} color={colors.text.primary} focused />
                    }
                    title="Network"
                    subtitle="Solana cluster"
                    right={
                      <Text
                        variant="small"
                        color={colors.text.secondary}
                        style={[styles.rightLabel, dense && styles.rightLabelDense]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        maxFontSizeMultiplier={1}
                      >
                        {networkLabel}
                      </Text>
                    }
                    compact={compact}
                    dense={dense}
                    onPress={() => navigateToStep('network')}
                  />
                </>
              ) : null}

              {step === 'walletMode' ? (
                <WalletModeStep
                  walletMode={optimisticWalletMode}
                  onSelect={handleWalletModeSelect}
                />
              ) : null}

              {step === 'offlinePayments' ? (
                <OfflinePaymentSlotsStep
                  enabled={offlinePaymentsEnabled}
                  poolSize={offlinePaymentPoolSize}
                  onEnabledChange={setOfflinePaymentsEnabled}
                  onPoolSizeChange={setOfflinePaymentPoolSize}
                />
              ) : null}

              {step === 'network' ? (
                <NetworkStep selectedNetwork={optimisticNetwork} onSelect={handleNetworkSelect} />
              ) : null}
            </Animated.View>
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles (modal shell only — step styles live in sub-components)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    borderRadius: radii['2xl'],
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.strongFill,
    boxShadow: SHEET_SHADOW,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  headerRowCompact: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  headerLeft: { width: layout.minTouchTarget },
  headerRight: { width: layout.minTouchTarget, alignItems: 'flex-end' },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 16px rgba(14, 42, 53, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.82)',
  },
  headerIconPlaceholder: { width: layout.minTouchTarget, height: layout.minTouchTarget },
  headerTitle: { flex: 1, minWidth: 0, textAlign: 'center' },
  headerTitleCompact: {
    fontSize: 23,
    lineHeight: 30,
  },
  rightLabel: { minWidth: 0, flexShrink: 1, textAlign: 'right' },
  rightLabelDense: {
    fontSize: 11,
    lineHeight: 14,
  },
  body: { flex: 1 },
  bodyContent: { paddingBottom: spacing.sm },
  bodySubStep: {
    paddingTop: 0,
    gap: spacing.xs,
  },
  bodyCompact: {
    paddingTop: 0,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  stepContent: {
    minWidth: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
    marginHorizontal: spacing.md,
  },
});
