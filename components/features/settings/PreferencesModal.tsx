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
import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';

import Animated from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { ModalBackdropScrim } from '@/components/ui/ModalBackdropScrim';
import {
  SETTINGS_BACKDROP_ENTERING,
  SETTINGS_BACKDROP_EXITING,
  SETTINGS_BACK_ENTERING,
  SETTINGS_BACK_EXITING,
  SETTINGS_FORWARD_ENTERING,
  SETTINGS_FORWARD_EXITING,
  SETTINGS_SURFACE_ENTERING,
  SETTINGS_SURFACE_EXITING,
} from '@/components/ui/settings-motion';
import { SettingsLineItem } from '@/components/features/settings/SettingsLineItem';
import { SettingsSectionCard } from '@/components/features/settings/SettingsSectionCard';
import { NetworkStep } from '@/components/features/preferences/NetworkStep';
import { OfflinePaymentSlotsStep } from '@/components/features/preferences/OfflinePaymentSlotsStep';
import { WalletModeStep } from '@/components/features/preferences/WalletModeStep';
import { PuffyNetworkIcon } from '@/components/ui/icons/PuffyNetworkIcon';
import { PuffyPaymentsIcon } from '@/components/ui/icons/PuffyPaymentsIcon';
import { PuffyWifiIcon } from '@/components/ui/icons/PuffyWifiIcon';
import { colors } from '@/constants/colors';
import { SOLANA_NETWORKS, isSolanaNetworkSelectable } from '@/constants/networks';
import { layout, radii, spacing } from '@/constants/spacing';
import { useOffpayNetworkTransitionStore } from '@/store/offpayNetworkTransitionStore';
import { usePreferencesStore } from '@/store/preferencesStore';

import type { SolanaNetworkId } from '@/constants/networks';
import type { WalletMode } from '@/store/preferencesStore';

type Step = 'root' | 'walletMode' | 'offlinePayments' | 'network';
interface StepState {
  value: Step;
  direction: 'back' | 'forward';
}

interface PreferencesModalProps {
  visible: boolean;
  onClose: () => void;
}

const PREFERENCE_MENU_DIVIDER_INSET = spacing.lg + 40 + spacing.md;
const SHEET_CHROME_PADDING = spacing.md;
const HEADER_FALLBACK_HEIGHT = layout.minTouchTarget + spacing.lg + spacing.md;

const HEADER_TITLES: Record<Step, string> = {
  root: 'Preferences',
  walletMode: 'Wallet Mode',
  offlinePayments: 'Offline Payments',
  network: 'Network',
};

const SHEET_SHADOW = [
  '0 18px 36px rgba(0, 0, 0, 0.5)',
  'inset 0 1px 2px rgba(255, 255, 255, 0.18)',
  'inset 0 0 16px rgba(255, 255, 255, 0.03)',
  'inset 0 -1px 3px rgba(0, 0, 0, 0.35)',
].join(', ');
const NETWORK_SWITCH_SETTLE_OPTIONS = {
  timeoutMs: 3000,
  fallbackDelayMs: 0,
} as const;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PreferencesModal({
  visible,
  onClose,
}: PreferencesModalProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const [stepState, setStepState] = useState<StepState>({ value: 'root', direction: 'forward' });
  const step = stepState.value;
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

  const setWalletMode = usePreferencesStore((s) => s.setWalletMode);
  const setOfflinePaymentsEnabled = usePreferencesStore((s) => s.setOfflinePaymentsEnabled);
  const setOfflinePaymentPoolSize = usePreferencesStore((s) => s.setOfflinePaymentPoolSize);
  const setNetwork = usePreferencesStore((s) => s.setNetwork);
  const beginNetworkSwitch = useOffpayNetworkTransitionStore((s) => s.beginNetworkSwitch);
  const finishNetworkSwitch = useOffpayNetworkTransitionStore((s) => s.finishNetworkSwitch);
  const queryClient = useQueryClient();

  const overlayPaddingBottom = Math.max(insets.bottom, spacing.lg) + spacing.md;
  const maxSheetHeight = windowHeight - insets.top - overlayPaddingBottom - spacing.lg;
  const bodyMaxHeight = Math.max(
    120,
    maxSheetHeight - HEADER_FALLBACK_HEIGHT - SHEET_CHROME_PADDING,
  );

  const handleClose = useCallback(
    (afterClose?: () => void): void => {
      onClose();
      afterClose?.();
    },
    [onClose],
  );

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const networkLabel = useMemo(() => {
    const found = SOLANA_NETWORKS.find((n) => n.id === network);
    return found?.label ?? 'Mainnet';
  }, [network]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const navigateToStep = useCallback(
    (nextStep: Step): void => {
      if (nextStep === step) return;
      setStepState({ value: nextStep, direction: nextStep === 'root' ? 'back' : 'forward' });
    },
    [step],
  );

  const handleWalletModeSelect = useCallback(
    (mode: WalletMode): void => {
      if (mode === walletMode) return;
      setWalletMode(mode);
    },
    [setWalletMode, walletMode],
  );

  const handleNetworkSelect = useCallback(
    (id: SolanaNetworkId): void => {
      if (!isSolanaNetworkSelectable(id)) return;
      if (id === network) return;

      handleClose(() => {
        const { epoch } = beginNetworkSwitch(NETWORK_SWITCH_SETTLE_OPTIONS);
        void (async () => {
          try {
            await queryClient.cancelQueries({ queryKey: ['offpay'] });
            await setNetwork(id);
          } finally {
            finishNetworkSwitch(epoch);
          }
        })();
      });
    },
    [beginNetworkSwitch, finishNetworkSwitch, handleClose, network, queryClient, setNetwork],
  );

  const stepBody = (
    <>
      {step === 'root' ? (
        <View style={styles.rootMenu}>
          <SettingsSectionCard dividerInset={PREFERENCE_MENU_DIVIDER_INSET}>
            <SettingsLineItem
              icon={
                <PuffyWifiIcon
                  size={rootIconSize}
                  color={colors.text.primary}
                  focused
                  off={walletMode === 'offline'}
                />
              }
              title="Wallet Mode"
              subtitle={
                walletMode === 'online'
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
                  {walletMode === 'online' ? 'Online' : 'Offline'}
                </Text>
              }
              compact={compact}
              dense={dense}
              onPress={() => navigateToStep('walletMode')}
            />
            <SettingsLineItem
              icon={<PuffyPaymentsIcon size={rootIconSize} color={colors.text.primary} focused />}
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
            <SettingsLineItem
              icon={<PuffyNetworkIcon size={rootIconSize} color={colors.text.primary} focused />}
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
          </SettingsSectionCard>
        </View>
      ) : null}

      {step === 'walletMode' ? (
        <WalletModeStep walletMode={walletMode} onSelect={handleWalletModeSelect} />
      ) : null}

      {step === 'offlinePayments' ? (
        <OfflinePaymentSlotsStep
          enabled={offlinePaymentsEnabled}
          poolSize={offlinePaymentPoolSize}
          onEnabledChange={setOfflinePaymentsEnabled}
          onPoolSizeChange={setOfflinePaymentPoolSize}
          networkReadsEnabled
        />
      ) : null}

      {step === 'network' ? (
        <NetworkStep selectedNetwork={network} onSelect={handleNetworkSelect} />
      ) : null}
    </>
  );

  if (!visible) return null;

  const contentEntering =
    stepState.direction === 'back' ? SETTINGS_BACK_ENTERING : SETTINGS_FORWARD_ENTERING;
  const contentExiting =
    stepState.direction === 'back' ? SETTINGS_BACK_EXITING : SETTINGS_FORWARD_EXITING;

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}
      accessibilityViewIsModal
    >
      {/* Backdrop */}
      <Animated.View
        entering={SETTINGS_BACKDROP_ENTERING}
        exiting={SETTINGS_BACKDROP_EXITING}
        style={StyleSheet.absoluteFill}
      >
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
          entering={SETTINGS_SURFACE_ENTERING}
          exiting={SETTINGS_SURFACE_EXITING}
          style={[
            styles.sheet,
            { width: '100%', maxWidth: sheetMaxWidth, maxHeight: maxSheetHeight },
          ]}
        >
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
                    color={colors.text.primary}
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
                <Ionicons name="close" size={layout.iconSizeInline} color={colors.text.primary} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={[styles.bodyScroll, { maxHeight: bodyMaxHeight }]}
            contentContainerStyle={styles.bodyContent}
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View
              key={step}
              entering={contentEntering}
              exiting={contentExiting}
              style={styles.stepContent}
            >
              {stepBody}
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
    ...StyleSheet.absoluteFill,
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
    backgroundColor: colors.surface.cardElevated,
    boxShadow: SHEET_SHADOW,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRowCompact: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerLeft: { width: layout.minTouchTarget },
  headerRight: { width: layout.minTouchTarget, alignItems: 'flex-end' },
  headerIconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface.cardElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.18)',
      'inset 0 -1px 2px rgba(0, 0, 0, 0.25)',
      '0 3px 8px rgba(0, 0, 0, 0.18)',
    ].join(', '),
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
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyStatic: {
    flexGrow: 0,
    flexShrink: 0,
  },
  bodyContent: {
    flexGrow: 0,
  },
  stepContent: {
    minWidth: 0,
  },
  rootMenu: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
