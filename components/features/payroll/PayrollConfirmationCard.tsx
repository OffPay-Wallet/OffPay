/**
 * In-chat batch-send confirmation card. Presentation only — all totals and
 * gating come from `buildPayrollConfirmationSummary`. The single "Start
 * confirmation control begins the whole batch; there are no per-recipient
 * prompts after this. Large batches require a typed confirmation that voice
 * cannot satisfy on its own.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import {
  isTypedConfirmationValid,
  resolvePayrollStartGate,
} from '@/lib/payroll/payroll-confirmation';
import { payrollRoutePolicyCopy } from '@/lib/payroll/payroll-copy';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import { payrollStyles as styles } from './styles';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollRoutePolicy } from '@/lib/payroll/payroll-types';

interface PayrollConfirmationCardProps {
  summary: PayrollConfirmationSummary;
  busy: boolean;
  onStart: () => void;
  onOpenDetails?: () => void;
  onSetupUmbra?: () => void;
  onRoutePolicyChange?: (policy: PayrollRoutePolicy) => void;
  onCancel?: () => void;
  setupBusy?: boolean;
}

const ROUTE_POLICY_OPTIONS: { policy: PayrollRoutePolicy; label: string }[] = [
  { policy: 'private_auto', label: 'Auto' },
  { policy: 'umbra_only', label: 'Umbra' },
  { policy: 'magicblock_only', label: 'MagicBlock' },
];

function Stat({
  label,
  value,
  align = 'left',
}: {
  label: string;
  value: string;
  align?: 'left' | 'center' | 'right';
}): React.JSX.Element {
  const alignStyles = [
    align === 'center' && styles.statCenter,
    align === 'right' && styles.statRight,
  ];
  const textAlignStyles = [
    align === 'center' && styles.textCenter,
    align === 'right' && styles.textRight,
  ];

  return (
    <View style={[styles.stat, alignStyles]}>
      <Text
        style={[styles.statLabel, textAlignStyles]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {label}
      </Text>
      <Text
        style={[styles.statValue, textAlignStyles]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {value}
      </Text>
    </View>
  );
}

export function PayrollConfirmationCard({
  summary,
  busy,
  onStart,
  onOpenDetails,
  onSetupUmbra,
  onRoutePolicyChange,
  onCancel,
  setupBusy = false,
}: PayrollConfirmationCardProps): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const [ackBlocked, setAckBlocked] = useState(false);

  const typedOk = !summary.requiresTypedConfirmation || isTypedConfirmationValid(summary, typed);
  const blockedBySetup = summary.requiresUmbraSetup;
  const balanceBlocked = !summary.hasSufficientBalanceForRun;
  const { canStart, needsBlockedAck } = resolvePayrollStartGate({
    summary,
    typedConfirmationOk: typedOk,
    blockedAcknowledged: ackBlocked,
    busy,
  });
  const routePolicyLabel =
    ROUTE_POLICY_OPTIONS.find((option) => option.policy === summary.routePolicy)?.label ??
    payrollRoutePolicyCopy(summary.routePolicy);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          Review batch send
        </Text>
        <View style={styles.routeSummaryPill}>
          <Text style={styles.routeSummaryText} numberOfLines={1}>
            {routePolicyLabel}
          </Text>
        </View>
      </View>

      <View style={styles.statGrid}>
        <Stat label="Recipients" value={String(summary.recipientCount)} />
        <View style={styles.statDivider} />
        <Stat label="Total" value={summary.totalLabel} align="center" />
        <View style={styles.statDivider} />
        <Stat label="Network" value={summary.network} align="right" />
      </View>

      <View style={styles.walletStrip}>
        <Text style={styles.statLabel}>Wallet</Text>
        <Text style={styles.walletValue} numberOfLines={1}>
          {shortenWalletAddress(summary.walletAddress)}
        </Text>
      </View>

      <View style={styles.routePickerBlock}>
        <Text style={styles.statLabel}>Route</Text>
        <View style={styles.routePicker}>
          {ROUTE_POLICY_OPTIONS.map((option) => {
            const selected = summary.routePolicy === option.policy;
            return (
              <Pressable
                key={option.policy}
                onPress={() => onRoutePolicyChange?.(option.policy)}
                disabled={busy || selected || onRoutePolicyChange == null}
                style={({ pressed }) => [
                  styles.routePickerOption,
                  selected && styles.routePickerOptionSelected,
                  pressed && !selected && styles.routePickerOptionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Use ${option.label} batch send route`}
                accessibilityState={{ selected, disabled: busy || onRoutePolicyChange == null }}
              >
                <Text
                  style={[
                    styles.routePickerText,
                    selected && styles.routePickerTextSelected,
                    busy && styles.routePickerTextDisabled,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.badgeRow}>
        {summary.split.umbra > 0 ? (
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={13} color={colors.brand.deepShadow} />
            <Text style={styles.badgeText}>{summary.split.umbra} Umbra</Text>
          </View>
        ) : null}
        {summary.split.magicblock > 0 ? (
          <View style={styles.badge}>
            <Ionicons name="flash" size={13} color={colors.brand.deepShadow} />
            <Text style={styles.badgeText}>{summary.split.magicblock} MagicBlock</Text>
          </View>
        ) : null}
        {summary.invalidCount > 0 ? (
          <View style={styles.badge}>
            <Ionicons name="alert-circle" size={13} color={colors.semantic.error} />
            <Text style={styles.badgeText}>{summary.invalidCount} blocked</Text>
          </View>
        ) : null}
      </View>

      {summary.claimRequiredCount > 0 ? (
        <Text style={styles.claimNote}>
          {summary.claimRequiredCount} Umbra claim
          {summary.claimRequiredCount === 1 ? '' : 's'} pending.
        </Text>
      ) : null}

      {summary.unprobedRecipientCount > 0 ? (
        <Text style={styles.claimNote}>
          {summary.unprobedRecipientCount} recipient
          {summary.unprobedRecipientCount === 1 ? '' : 's'} not Umbra-checked.
        </Text>
      ) : null}

      {summary.showLargeBatchWarning ? (
        <Text style={styles.warningText}>Large batch. Payments run one by one.</Text>
      ) : null}

      {balanceBlocked ? (
        <Text style={styles.warningText}>
          Not enough balance. Add funds or choose another token.
        </Text>
      ) : null}

      {needsBlockedAck && !blockedBySetup ? (
        <Pressable
          style={pressStyles.ackRow}
          onPress={() => setAckBlocked((prev) => !prev)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ackBlocked }}
          accessibilityLabel={`Skip ${summary.invalidCount} blocked rows and pay the rest`}
        >
          <Ionicons
            name={ackBlocked ? 'checkbox' : 'square-outline'}
            size={20}
            color={ackBlocked ? colors.brand.deepShadow : colors.text.tertiary}
          />
          <Text style={styles.claimNote}>
            Skip {summary.invalidCount} blocked row{summary.invalidCount === 1 ? '' : 's'}
          </Text>
        </Pressable>
      ) : null}

      {blockedBySetup ? (
        <>
          <Text style={styles.warningText}>Umbra setup required before batch send can start.</Text>
          <Pressable
            style={[styles.secondaryButton, setupBusy && styles.primaryButtonDisabled]}
            onPress={onSetupUmbra}
            disabled={setupBusy || onSetupUmbra == null}
            accessibilityRole="button"
            accessibilityLabel="Set up Umbra"
            accessibilityState={{ disabled: setupBusy || onSetupUmbra == null }}
          >
            {setupBusy ? (
              <LazyLoadingSpinner size={18} color={colors.brand.deepShadow} />
            ) : (
              <Text style={styles.secondaryButtonText}>Set up Umbra</Text>
            )}
          </Pressable>
        </>
      ) : null}

      {summary.requiresTypedConfirmation && !blockedBySetup ? (
        <View>
          <Text style={styles.statLabel}>Type {summary.recipientCount} or total</Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            keyboardType="numeric"
            placeholder={String(summary.recipientCount)}
            placeholderTextColor={colors.text.placeholder}
            style={styles.typedConfirmInput}
            selectionColor={colors.brand.whiteStream}
            accessibilityLabel="Type to confirm batch send"
          />
        </View>
      ) : null}

      <View style={styles.payrollActionStack}>
        <Pressable
          style={[styles.primaryButton, !canStart && styles.primaryButtonDisabled]}
          onPress={onStart}
          disabled={!canStart}
          accessibilityRole="button"
          accessibilityLabel="Confirm batch send"
          accessibilityState={{ disabled: !canStart }}
        >
          {busy ? (
            <LazyLoadingSpinner size={18} color={colors.brand.whiteStream} />
          ) : (
            <>
              <Ionicons name="send" size={15} color={colors.brand.whiteStream} />
              <Text style={styles.primaryButtonText}>Confirm</Text>
            </>
          )}
        </Pressable>

        {onOpenDetails != null || onCancel != null ? (
          <View style={styles.secondaryRow}>
            {onOpenDetails != null ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={onOpenDetails}
                accessibilityRole="button"
                accessibilityLabel="Open batch send details"
              >
                <Ionicons name="list-outline" size={15} color={colors.text.primary} />
                <Text style={styles.secondaryButtonText}>Review</Text>
              </Pressable>
            ) : null}
            {onCancel != null ? (
              <Pressable
                style={[styles.secondaryButton, styles.dangerSecondaryButton]}
                onPress={onCancel}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Cancel batch send"
                accessibilityState={{ disabled: busy }}
              >
                <Ionicons name="close" size={15} color={colors.semantic.error} />
                <Text style={[styles.secondaryButtonText, styles.dangerSecondaryButtonText]}>
                  Cancel
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const pressStyles = StyleSheet.create({
  ackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
});
