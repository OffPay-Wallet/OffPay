import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAppToast } from '@/components/ui/AppToast';
import { GlassToggle } from '@/components/ui/GlassToggle';
import { PillButton } from '@/components/ui/PillButton';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import {
  OFFLINE_PAYMENT_SLOT_MAX,
  OFFLINE_PAYMENT_SLOT_MIN,
  OFFLINE_PAYMENT_SLOT_PRESETS,
  clampOfflinePaymentSlotCount,
} from '@/constants/offline-payment-slots';
import { layout, radii, spacing } from '@/constants/spacing';
import { fontFamily } from '@/constants/typography';
import { useOfflinePaymentSlots } from '@/hooks/useOfflinePaymentSlots';
import { isOfflinePaymentSlotReclaimable } from '@/lib/offline/offline-payment-slots';
import { formatLamportsAsExactSol, parseLamports } from '@/lib/crypto/solana-amounts';

interface OfflinePaymentSlotsStepProps {
  enabled: boolean;
  poolSize: number;
  onEnabledChange: (enabled: boolean) => void;
  onPoolSizeChange: (size: number) => void;
  networkReadsEnabled?: boolean;
}

type SlotStageTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

interface SlotStageItem {
  label: string;
  value: number;
  tone: SlotStageTone;
  visible: boolean;
}

function clampPoolSize(value: number): number {
  return clampOfflinePaymentSlotCount(value);
}

function parsePoolSize(value: string): number {
  return clampPoolSize(Number.parseInt(value, 10));
}

function getStageTextColor(tone: SlotStageTone): string {
  if (tone === 'success') return colors.semantic.success;
  if (tone === 'info') return colors.semantic.info;
  if (tone === 'warning') return colors.semantic.warning;
  if (tone === 'danger') return colors.semantic.error;
  return colors.text.secondary;
}

export function OfflinePaymentSlotsStep({
  enabled,
  poolSize,
  onEnabledChange,
  onPoolSizeChange,
  networkReadsEnabled = true,
}: OfflinePaymentSlotsStepProps): React.JSX.Element {
  const [draftEnabled, setDraftEnabled] = useState(enabled);
  const [draftPoolSize, setDraftPoolSize] = useState(poolSize);
  const [customPoolSize, setCustomPoolSize] = useState(String(poolSize));
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useAppToast();
  const slots = useOfflinePaymentSlots({
    targetSlotCount: draftPoolSize,
    deferCapabilitiesUntilAfterInteractions: true,
    statusEnabled: networkReadsEnabled,
    rentEstimateEnabled: networkReadsEnabled,
  });
  const backendReady =
    slots.noncePoolCapability.available &&
    slots.nonceStatusCapability.available &&
    slots.tokenContextCapability.available &&
    slots.rentEstimateCapability.available;
  const selectedPreset = OFFLINE_PAYMENT_SLOT_PRESETS.includes(
    draftPoolSize as (typeof OFFLINE_PAYMENT_SLOT_PRESETS)[number],
  )
    ? draftPoolSize
    : 'custom';
  const reclaimableSlots = useMemo(
    () => slots.snapshot?.slots.filter(isOfflinePaymentSlotReclaimable) ?? [],
    [slots.snapshot?.slots],
  );
  const reclaimableLamports = useMemo(
    () =>
      reclaimableSlots.reduce((total, slot) => total + (parseLamports(slot.lamports) ?? 0n), 0n),
    [reclaimableSlots],
  );
  const reclaimableSol = formatLamportsAsExactSol(reclaimableLamports);
  const slotCounts = slots.snapshot?.counts;
  const readySlotCount = slotCounts?.ready ?? 0;
  const pendingSlotCount = (slotCounts?.preparing ?? 0) + (slotCounts?.settling ?? 0);
  const errorSlotCount = slotCounts?.error ?? 0;
  const staleSlotCount = slotCounts?.stale ?? 0;
  const needsRefillCount = slotCounts?.needsRefill ?? draftPoolSize;
  const isMutatingSlots = slots.prepareMutation.isPending || slots.reclaimMutation.isPending;
  const progressSlotCount =
    readySlotCount > 0 ? readySlotCount : Math.min(pendingSlotCount, draftPoolSize);
  const slotProgressLabel =
    readySlotCount > 0
      ? `${readySlotCount}/${draftPoolSize} ready`
      : pendingSlotCount > 0
        ? `${Math.min(pendingSlotCount, draftPoolSize)}/${draftPoolSize} finalizing`
        : `${readySlotCount}/${draftPoolSize} ready`;
  const hasVisibleSlotProgress = readySlotCount > 0 || pendingSlotCount > 0;
  const statusLabel = backendReady
    ? draftEnabled
      ? slots.prepareMutation.isPending
        ? 'Preparing slot transactions'
        : slots.reclaimMutation.isPending
          ? 'Restoring slot SOL'
          : errorSlotCount > 0
            ? `${errorSlotCount} slot${errorSlotCount === 1 ? '' : 's'} need attention`
            : hasVisibleSlotProgress
              ? slotProgressLabel
              : 'Ready to prepare'
      : 'Off'
    : 'Backend pending';
  const statusDetailLabel = slots.prepareMutation.isPending
    ? 'Signing, broadcasting, then checking readiness'
    : slots.reclaimMutation.isPending
      ? 'Closing unused nonce accounts'
      : saveNotice;
  const statusIconName: React.ComponentProps<typeof Ionicons>['name'] = slots.prepareMutation
    .isPending
    ? 'hourglass-outline'
    : slots.reclaimMutation.isPending
      ? 'refresh-outline'
      : errorSlotCount > 0
        ? 'warning-outline'
        : pendingSlotCount > 0
          ? 'time-outline'
          : readySlotCount > 0
            ? 'checkmark'
            : backendReady
              ? 'add-outline'
              : 'cloud-offline-outline';
  const statusIconColor =
    errorSlotCount > 0
      ? colors.semantic.error
      : pendingSlotCount > 0 || slots.prepareMutation.isPending || slots.reclaimMutation.isPending
        ? colors.semantic.info
        : readySlotCount > 0
          ? colors.semantic.success
          : backendReady
            ? colors.text.secondary
            : colors.semantic.warning;
  const progressPercent = draftEnabled
    ? Math.min(100, (progressSlotCount / draftPoolSize) * 100)
    : 0;
  const requestedRefillCount = Math.max(0, Math.min(needsRefillCount, draftPoolSize));
  const hasSlotSetupNeed = draftEnabled && requestedRefillCount > 0;
  const canStartPreparation = hasSlotSetupNeed && backendReady && slots.canPrepare;
  const estimateLabel = slots.rentEstimateQuery.data
    ? `${formatLamportsAsExactSol(slots.rentEstimateQuery.data.totalLamports)} SOL`
    : slots.rentEstimateQuery.isFetching
      ? 'Checking'
      : 'Pending';
  const canRestoreSol = reclaimableSlots.length > 0 && reclaimableLamports > 0n;
  const slotStageItems: SlotStageItem[] = [
    {
      label: 'Ready',
      value: readySlotCount,
      tone: 'success',
      visible: readySlotCount > 0 || pendingSlotCount === 0,
    },
    {
      label: 'Finalizing',
      value: pendingSlotCount,
      tone: 'info',
      visible: pendingSlotCount > 0 || slots.prepareMutation.isPending,
    },
    {
      label: 'Refill',
      value: needsRefillCount,
      tone: 'warning',
      visible: draftEnabled && needsRefillCount > 0 && !slots.prepareMutation.isPending,
    },
    {
      label: 'Stale',
      value: staleSlotCount,
      tone: 'warning',
      visible: staleSlotCount > 0,
    },
    {
      label: 'Errors',
      value: errorSlotCount,
      tone: 'danger',
      visible: errorSlotCount > 0,
    },
    {
      label: 'Restore',
      value: reclaimableSlots.length,
      tone: 'neutral',
      visible: reclaimableSlots.length > 0 || slots.reclaimMutation.isPending,
    },
  ];

  useEffect(
    () => () => {
      if (noticeTimerRef.current != null) clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  const showSaveNotice = (message: string): void => {
    if (noticeTimerRef.current != null) clearTimeout(noticeTimerRef.current);
    setSaveNotice(message);
    noticeTimerRef.current = setTimeout(() => {
      setSaveNotice(null);
      noticeTimerRef.current = null;
    }, 2600);
  };

  const handleSelectPoolSize = (size: number): void => {
    if (isMutatingSlots) return;
    const nextSize = clampPoolSize(size);
    setDraftPoolSize(nextSize);
    setCustomPoolSize(String(nextSize));
  };

  const handleCustomChange = (value: string): void => {
    if (isMutatingSlots) return;
    const digits = value.replace(/[^\d]/g, '');
    setCustomPoolSize(digits);
    if (digits.length > 0) {
      setDraftPoolSize(parsePoolSize(digits));
    }
  };

  const savePreferences = (message = 'Preferences saved'): void => {
    onEnabledChange(draftEnabled);
    onPoolSizeChange(draftPoolSize);
    showSaveNotice(message);
    showToast({
      title: message,
      message: draftEnabled ? `${draftPoolSize} payment slots selected` : 'Offline payments off',
      variant: 'success',
      notificationId: 'offline-slots-preferences-saved',
    });
  };

  const prepareSlots = (): void => {
    onEnabledChange(draftEnabled);
    onPoolSizeChange(draftPoolSize);
    setRestoreNotice(null);
    showSaveNotice('Preparing slots');
    showToast({
      title: 'Preparing offline slots',
      message: `${draftPoolSize} slots. Keep the app open.`,
      variant: 'info',
      durationMs: 3200,
      notificationId: 'offline-slots-prepare-started',
    });
    slots.prepareMutation.mutate(
      {
        targetSlotCount: draftPoolSize,
        spendAuthorization: 'user-confirmed',
      },
      {
        onSuccess: (result) => {
          const ready = result.snapshot.counts.ready;
          const pending = result.snapshot.counts.preparing + result.snapshot.counts.settling;
          const message =
            ready > 0
              ? `${ready}/${draftPoolSize} ready`
              : pending > 0
                ? `${Math.min(pending, draftPoolSize)}/${draftPoolSize} finalizing`
                : 'Slot preparation submitted';
          showSaveNotice(message);
          showToast({
            title: ready > 0 ? 'Offline slots ready' : 'Slot preparation submitted',
            message,
            variant: ready > 0 ? 'success' : 'info',
            notificationId: 'offline-slots-prepare-result',
          });
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Slot preparation failed';
          showSaveNotice(message);
          showToast({
            title: 'Slot preparation failed',
            message,
            variant: 'error',
            durationMs: 4200,
            notificationId: 'offline-slots-prepare-error',
          });
        },
      },
    );
  };

  const handleApply = (): void => {
    if (hasSlotSetupNeed) {
      if (!slots.canUseNetwork) {
        showSaveNotice('Go online first');
        showToast({
          title: 'Go online first',
          message: 'Preparing slots needs network access.',
          variant: 'warning',
          notificationId: 'offline-slots-prepare-offline',
        });
        return;
      }

      if (!canStartPreparation) {
        showSaveNotice(backendReady ? 'Slot preparation unavailable' : 'Checking setup');
        showToast({
          title: backendReady ? 'Cannot prepare slots yet' : 'Checking setup',
          message: backendReady
            ? 'Slot preparation is temporarily unavailable.'
            : 'Wait for OffPay capabilities to load.',
          variant: 'warning',
          notificationId: 'offline-slots-prepare-blocked',
        });
        return;
      }

      prepareSlots();
      return;
    }

    savePreferences();
  };

  const handleRestoreSol = (): void => {
    if (!slots.canUseNetwork) {
      setRestoreNotice('Go online first');
      showToast({
        title: 'Go online first',
        message: 'Restoring slot SOL needs network access.',
        variant: 'warning',
        notificationId: 'offline-slots-restore-offline',
      });
      return;
    }
    if (!canRestoreSol) {
      setRestoreNotice('No slot SOL to restore');
      showToast({
        title: 'No slot SOL to restore',
        variant: 'info',
        notificationId: 'offline-slots-restore-empty',
      });
      return;
    }

    setRestoreNotice('Restoring slot SOL');
    showToast({
      title: 'Restoring slot SOL',
      message: `${reclaimableSol} SOL from unused slots.`,
      variant: 'info',
      durationMs: 3200,
      notificationId: 'offline-slots-restore-started',
    });
    slots.reclaimMutation.mutate(
      { reclaimAuthorization: 'user-confirmed' },
      {
        onSuccess: (result) => {
          const message =
            result.closedCount > 0
              ? `Restored ${result.reclaimedSol} SOL`
              : result.signatures.length > 0
                ? 'Restore submitted'
                : 'No slot SOL restored';
          setRestoreNotice(message);
          showToast({
            title: result.closedCount > 0 ? 'SOL restored' : 'Restore submitted',
            message,
            variant: result.closedCount > 0 ? 'success' : 'info',
            notificationId: 'offline-slots-restore-result',
          });
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Offline slot restore failed.';
          setRestoreNotice(message);
          showToast({
            title: 'Restore failed',
            message,
            variant: 'error',
            durationMs: 4200,
            notificationId: 'offline-slots-restore-error',
          });
        },
      },
    );
  };

  const primaryActionLabel = slots.prepareMutation.isPending
    ? 'Preparing slots'
    : slots.reclaimMutation.isPending
      ? 'Restoring'
      : hasSlotSetupNeed
        ? !slots.canUseNetwork
          ? 'Go online to prepare'
          : !backendReady
            ? 'Checking setup'
            : slots.canPrepare
              ? `Prepare ${requestedRefillCount} slot${requestedRefillCount === 1 ? '' : 's'}`
              : 'Preparation unavailable'
        : 'Save & Apply';
  const primaryActionDisabled =
    isMutatingSlots || (hasSlotSetupNeed && slots.canUseNetwork && !canStartPreparation);

  return (
    <View style={styles.container}>
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={styles.statusIcon}>
            <Ionicons name={statusIconName} size={layout.iconSizeInline} color={statusIconColor} />
          </View>
          <View style={styles.statusText}>
            <Text variant="bodyBold" color={colors.text.primary} style={styles.title}>
              Offline payment slots
            </Text>
            <Text variant="small" color={colors.text.tertiary}>
              {statusLabel}
            </Text>
          </View>
          <GlassToggle
            value={draftEnabled}
            onValueChange={() => {
              if (!isMutatingSlots) setDraftEnabled((value) => !value);
            }}
            disabled={isMutatingSlots}
            accessibilityLabel="Offline payment slots toggle"
          />
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text variant="small" color={colors.text.secondary} style={styles.mono}>
          {slotProgressLabel}
        </Text>
        {statusDetailLabel != null ? (
          <Text variant="small" color={colors.text.tertiary} style={styles.statusDetail}>
            {statusDetailLabel}
          </Text>
        ) : null}
        <View style={styles.stageRow}>
          {slotStageItems
            .filter((item) => item.visible)
            .map((item) => (
              <View
                key={item.label}
                style={[
                  styles.stageChip,
                  item.tone === 'success' ? styles.stageChipSuccess : undefined,
                  item.tone === 'info' ? styles.stageChipInfo : undefined,
                  item.tone === 'warning' ? styles.stageChipWarning : undefined,
                  item.tone === 'danger' ? styles.stageChipDanger : undefined,
                ]}
              >
                <Text
                  variant="small"
                  color={getStageTextColor(item.tone)}
                  style={styles.stageChipText}
                >
                  {item.label} {item.value}
                </Text>
              </View>
            ))}
        </View>
      </View>

      <View style={styles.noteCard}>
        <Text variant="small" color={colors.text.secondary} align="center" style={styles.noteText}>
          Larger pools cost more SOL upfront but support more queued offline payments before
          reconnecting.
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="small" color={colors.text.secondary} style={styles.sectionLabel}>
          Pool size
        </Text>
        <View style={styles.presetGrid}>
          {OFFLINE_PAYMENT_SLOT_PRESETS.map((size) => (
            <Pressable
              key={size}
              style={[
                styles.presetButton,
                selectedPreset === size ? styles.presetButtonActive : undefined,
              ]}
              onPress={() => handleSelectPoolSize(size)}
              disabled={isMutatingSlots}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedPreset === size, disabled: isMutatingSlots }}
            >
              <Text
                variant="buttonSmall"
                color={selectedPreset === size ? colors.text.onAccent : colors.text.secondary}
              >
                {size}
              </Text>
            </Pressable>
          ))}
        </View>
        <View
          style={[styles.customRow, selectedPreset === 'custom' ? styles.customRowActive : null]}
        >
          <Text variant="bodyBold" color={colors.text.primary}>
            Custom
          </Text>
          <TextInput
            value={customPoolSize}
            onChangeText={handleCustomChange}
            placeholder={`${OFFLINE_PAYMENT_SLOT_MIN}-${OFFLINE_PAYMENT_SLOT_MAX}`}
            placeholderTextColor={colors.text.placeholder}
            style={styles.input}
            keyboardType="number-pad"
            editable={!isMutatingSlots}
            selectionColor={colors.brand.glossAccent}
            accessibilityLabel="Custom offline payment slot count"
          />
        </View>
      </View>

      <View style={styles.footerPanel}>
        <View style={styles.footerRow}>
          <View style={styles.footerCopy}>
            <Text variant="small" color={colors.text.tertiary}>
              Cost estimate
            </Text>
            <Text variant="bodyBold" color={colors.text.primary}>
              {estimateLabel}
            </Text>
          </View>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerRow}>
          <View style={styles.footerCopy}>
            <Text variant="small" color={colors.text.tertiary}>
              Restore SOL
            </Text>
            <Text variant="bodyBold" color={colors.text.primary}>
              {canRestoreSol ? `${reclaimableSol} SOL` : '0 SOL'}
            </Text>
            {restoreNotice != null ? (
              <Text variant="small" color={colors.text.secondary} numberOfLines={2}>
                {restoreNotice}
              </Text>
            ) : null}
          </View>
          <View style={styles.restoreButtonSlot}>
            <PillButton
              label={slots.reclaimMutation.isPending ? 'Restoring' : 'Restore'}
              variant="neutral"
              loading={slots.reclaimMutation.isPending}
              disabled={slots.reclaimMutation.isPending || !slots.canUseNetwork || !canRestoreSol}
              onPress={handleRestoreSol}
            />
          </View>
        </View>
      </View>

      <PillButton
        label={primaryActionLabel}
        variant="primary"
        loading={isMutatingSlots}
        disabled={primaryActionDisabled}
        onPress={handleApply}
      />
    </View>
  );
}

const GLASS_PANEL_SHADOW = [
  'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
  'inset 0 -1px 2px rgba(0, 0, 0, 0.28)',
  '0 6px 16px rgba(0, 0, 0, 0.28)',
].join(', ');

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 0,
    gap: spacing.md,
  },
  statusCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.strongFill,
    padding: spacing.lg,
    gap: spacing.sm,
    boxShadow: GLASS_PANEL_SHADOW,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusIcon: {
    width: layout.avatarSm,
    height: layout.avatarSm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.strongFill,
  },
  statusText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamily.semiBold,
  },
  progressTrack: {
    height: 6,
    borderRadius: radii.full,
    overflow: 'hidden',
    backgroundColor: colors.glass.strongFill,
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: colors.brand.glossAccent,
  },
  mono: {
    fontVariant: ['tabular-nums'],
  },
  statusDetail: {
    lineHeight: 17,
  },
  stageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  stageChip: {
    minHeight: 24,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.strongFill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  stageChipSuccess: {
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.badgeFill,
  },
  stageChipInfo: {
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.smokeWash,
  },
  stageChipWarning: {
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.surface.backgroundTint,
  },
  stageChipDanger: {
    borderColor: 'rgba(255, 77, 90, 0.28)',
    backgroundColor: 'rgba(255, 77, 90, 0.1)',
  },
  stageChipText: {
    fontFamily: fontFamily.medium,
    fontVariant: ['tabular-nums'],
  },
  noteCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.smokeWash,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: GLASS_PANEL_SHADOW,
  },
  noteText: {
    lineHeight: 18,
    maxWidth: 340,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    lineHeight: 16,
  },
  presetGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  presetButton: {
    flex: 1,
    flexGrow: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.glass.strongFill,
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.06)',
  },
  presetButtonActive: {
    borderColor: colors.glass.rim,
    backgroundColor: colors.brand.glossAccent,
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.2)',
  },
  customRow: {
    minHeight: 48,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.06)',
  },
  customRowActive: {
    borderColor: colors.glass.rim,
    backgroundColor: colors.glass.smokeWash,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.text.primary,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'right',
  },
  footerPanel: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.strongFill,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    overflow: 'hidden',
    boxShadow: GLASS_PANEL_SHADOW,
  },
  footerRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  footerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
  restoreButtonSlot: {
    width: 124,
    flexShrink: 0,
  },
});
