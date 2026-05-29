import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
}

type PendingConfirmation = 'prepare' | 'restore' | null;
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
}: OfflinePaymentSlotsStepProps): React.JSX.Element {
  const [draftEnabled, setDraftEnabled] = useState(enabled);
  const [draftPoolSize, setDraftPoolSize] = useState(poolSize);
  const [customPoolSize, setCustomPoolSize] = useState(String(poolSize));
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slots = useOfflinePaymentSlots({ targetSlotCount: draftPoolSize });
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
  const needsPreparation =
    draftEnabled &&
    backendReady &&
    slots.canPrepare &&
    (slots.snapshot?.counts.needsRefill ?? draftPoolSize) > 0;
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
    setPendingConfirmation(null);
    setDraftPoolSize(nextSize);
    setCustomPoolSize(String(nextSize));
  };

  const handleCustomChange = (value: string): void => {
    if (isMutatingSlots) return;
    const digits = value.replace(/[^\d]/g, '');
    setPendingConfirmation(null);
    setCustomPoolSize(digits);
    if (digits.length > 0) {
      setDraftPoolSize(parsePoolSize(digits));
    }
  };

  const handleApply = (): void => {
    if (needsPreparation) {
      setPendingConfirmation('prepare');
      return;
    }

    onEnabledChange(draftEnabled);
    onPoolSizeChange(draftPoolSize);
    showSaveNotice('Preferences saved');
  };

  const confirmPrepareSlots = (): void => {
    setPendingConfirmation(null);
    onEnabledChange(draftEnabled);
    onPoolSizeChange(draftPoolSize);
    setRestoreNotice(null);
    showSaveNotice('Saving preferences');
    slots.prepareMutation.mutate(
      {
        targetSlotCount: draftPoolSize,
        spendAuthorization: 'user-confirmed',
      },
      {
        onSuccess: (result) => {
          const ready = result.snapshot.counts.ready;
          const pending = result.snapshot.counts.preparing + result.snapshot.counts.settling;
          showSaveNotice(
            ready > 0
              ? `${ready}/${draftPoolSize} ready`
              : pending > 0
                ? `${Math.min(pending, draftPoolSize)}/${draftPoolSize} finalizing`
                : 'Slot preparation submitted',
          );
        },
        onError: (error) => {
          showSaveNotice(error instanceof Error ? error.message : 'Slot preparation failed');
        },
      },
    );
  };

  const handleRestoreSol = (): void => {
    if (!slots.canUseNetwork) {
      setRestoreNotice('Go online first');
      return;
    }
    if (!canRestoreSol) {
      setRestoreNotice('No slot SOL to restore');
      return;
    }
    setRestoreNotice(null);
    setPendingConfirmation('restore');
  };

  const confirmRestoreSol = (): void => {
    if (!slots.canUseNetwork || !canRestoreSol) {
      setPendingConfirmation(null);
      setRestoreNotice(!slots.canUseNetwork ? 'Go online first' : 'No slot SOL to restore');
      return;
    }

    setPendingConfirmation(null);
    slots.reclaimMutation.mutate(
      { reclaimAuthorization: 'user-confirmed' },
      {
        onSuccess: (result) => {
          setRestoreNotice(
            result.closedCount > 0
              ? `Restored ${result.reclaimedSol} SOL`
              : result.signatures.length > 0
                ? 'Restore submitted'
                : 'No slot SOL restored',
          );
        },
        onError: (error) => {
          setRestoreNotice(error instanceof Error ? error.message : 'Offline slot restore failed.');
        },
      },
    );
  };

  const confirmationTitle =
    pendingConfirmation === 'restore' ? 'Restore slot SOL?' : 'Prepare offline slots?';
  const confirmationText =
    pendingConfirmation === 'restore'
      ? `Returns ${reclaimableSol} SOL from ${reclaimableSlots.length} unused slot${
          reclaimableSlots.length === 1 ? '' : 's'
        }. Network fees apply.`
      : `Rent: ${estimateLabel}. Network fee applies.`;
  const confirmationActionLabel = pendingConfirmation === 'restore' ? 'Restore' : 'Prepare';
  const confirmPendingAction =
    pendingConfirmation === 'restore' ? confirmRestoreSol : confirmPrepareSlots;

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
          <Pressable
            style={[styles.toggle, draftEnabled ? styles.toggleActive : undefined]}
            onPress={() => {
              if (!isMutatingSlots) setDraftEnabled((value) => !value);
            }}
            disabled={isMutatingSlots}
            accessibilityRole="switch"
            accessibilityState={{ checked: draftEnabled, disabled: isMutatingSlots }}
          >
            <View style={[styles.toggleDot, draftEnabled ? styles.toggleDotActive : undefined]} />
          </Pressable>
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
        <Text
          variant="small"
          color={colors.semantic.warning}
          align="center"
          style={styles.noteText}
        >
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
            selectionColor={colors.brand.azureCyan}
            accessibilityLabel="Custom offline payment slot count"
          />
        </View>
      </View>

      <View style={styles.estimateCard}>
        <Text variant="small" color={colors.text.tertiary}>
          Cost estimate
        </Text>
        <Text variant="bodyBold" color={colors.text.primary}>
          {estimateLabel}
        </Text>
      </View>

      {pendingConfirmation != null ? (
        <View style={styles.confirmCard}>
          <View style={styles.confirmIcon}>
            <Ionicons
              name={pendingConfirmation === 'restore' ? 'refresh-outline' : 'warning-outline'}
              size={layout.iconSizeInline}
              color={colors.semantic.warning}
            />
          </View>
          <View style={styles.confirmContent}>
            <Text variant="bodyBold" color={colors.text.primary}>
              {confirmationTitle}
            </Text>
            <Text variant="small" color={colors.text.secondary} style={styles.confirmText}>
              {confirmationText}
            </Text>
            <View style={styles.confirmActions}>
              <View style={styles.confirmActionSlot}>
                <PillButton
                  label="Cancel"
                  variant="neutral"
                  onPress={() => setPendingConfirmation(null)}
                />
              </View>
              <View style={styles.confirmActionSlot}>
                <PillButton
                  label={confirmationActionLabel}
                  variant={pendingConfirmation === 'restore' ? 'danger' : 'primary'}
                  onPress={confirmPendingAction}
                />
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <View style={styles.restoreRow}>
        <View style={styles.restoreText}>
          <View>
            <Text variant="small" color={colors.text.tertiary}>
              Restore SOL
            </Text>
            <Text variant="bodyBold" color={colors.text.primary}>
              {canRestoreSol ? `${reclaimableSol} SOL` : '0 SOL'}
            </Text>
          </View>
          {restoreNotice != null ? (
            <Text variant="small" color={colors.text.tertiary} numberOfLines={2}>
              {restoreNotice}
            </Text>
          ) : null}
        </View>
        <View style={styles.restoreButtonSlot}>
          <PillButton
            label={slots.reclaimMutation.isPending ? 'Restoring' : 'Restore'}
            variant="danger"
            loading={slots.reclaimMutation.isPending}
            disabled={slots.reclaimMutation.isPending || !slots.canUseNetwork || !canRestoreSol}
            onPress={handleRestoreSol}
          />
        </View>
      </View>

      <PillButton
        label={slots.prepareMutation.isPending ? 'Preparing slots' : 'Save & Apply'}
        variant="primary"
        loading={slots.prepareMutation.isPending}
        disabled={isMutatingSlots || (draftEnabled && backendReady && !slots.canPrepare)}
        onPress={handleApply}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  statusCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    backgroundColor: colors.glass.textBacking,
    padding: spacing.lg,
    gap: spacing.sm,
    boxShadow:
      '0 2px 8px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
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
  toggle: {
    width: 60,
    height: 34,
    borderRadius: radii.full,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rim,
    padding: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'rgba(252, 252, 255, 0.84)',
    boxShadow:
      'inset 0 1px 1px rgba(255, 255, 255, 0.82), inset 0 -6px 12px rgba(14, 42, 53, 0.05)',
  },
  toggleActive: {
    borderColor: colors.brand.azureCyan,
    justifyContent: 'flex-end',
    backgroundColor: colors.brand.azureCyan,
  },
  toggleDot: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.78)',
    backgroundColor: colors.text.secondary,
    boxShadow: '0 2px 6px rgba(14, 42, 53, 0.18)',
  },
  toggleDotActive: {
    borderColor: 'rgba(255, 255, 255, 0.92)',
    backgroundColor: colors.brand.whiteStream,
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
    backgroundColor: colors.brand.azureCyan,
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
    borderColor: 'rgba(22, 138, 100, 0.24)',
    backgroundColor: 'rgba(185, 245, 216, 0.34)',
  },
  stageChipInfo: {
    borderColor: 'rgba(34, 122, 150, 0.24)',
    backgroundColor: 'rgba(189, 239, 247, 0.42)',
  },
  stageChipWarning: {
    borderColor: 'rgba(154, 107, 22, 0.26)',
    backgroundColor: 'rgba(255, 226, 122, 0.24)',
  },
  stageChipDanger: {
    borderColor: 'rgba(199, 58, 58, 0.24)',
    backgroundColor: 'rgba(255, 201, 201, 0.28)',
  },
  stageChipText: {
    fontFamily: fontFamily.medium,
    fontVariant: ['tabular-nums'],
  },
  noteCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 247, 222, 0.62)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 226, 122, 0.62)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
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
    backgroundColor: colors.glass.textBacking,
  },
  presetButtonActive: {
    borderColor: colors.brand.azureCyan,
    backgroundColor: colors.brand.azureCyan,
  },
  customRow: {
    minHeight: 48,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
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
  },
  customRowActive: {
    borderColor: colors.glass.azureCyanHalf,
    backgroundColor: colors.glass.cyanWash,
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
  estimateCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    padding: spacing.md,
    gap: spacing.xs,
  },
  confirmCard: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255, 247, 222, 0.72)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 226, 122, 0.7)',
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    boxShadow: '0 2px 6px rgba(14, 42, 53, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.6)',
  },
  confirmIcon: {
    width: layout.buttonHeightSm,
    height: layout.buttonHeightSm,
    borderRadius: radii.full,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.58)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 226, 122, 0.82)',
    flexShrink: 0,
  },
  confirmContent: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  confirmText: {
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  confirmActionSlot: {
    flex: 1,
    minWidth: 0,
  },
  restoreRow: {
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glass.textBacking,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glass.rimSubtle,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  restoreText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  restoreButtonSlot: {
    width: 132,
    flexShrink: 0,
  },
});
