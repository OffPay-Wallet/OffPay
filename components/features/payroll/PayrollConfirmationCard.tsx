/**
 * In-chat payroll confirmation card. Presentation only — all totals and
 * gating come from `buildPayrollConfirmationSummary`. The single "Start
 * payroll" control begins the whole batch; there are no per-recipient
 * prompts after this. Large batches require a typed confirmation that voice
 * cannot satisfy on its own.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { isTypedConfirmationValid, resolvePayrollStartGate } from '@/lib/payroll/payroll-confirmation';
import { payrollRoutePolicyCopy } from '@/lib/payroll/payroll-copy';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import { payrollStyles as styles } from './styles';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';

interface PayrollConfirmationCardProps {
  summary: PayrollConfirmationSummary;
  busy: boolean;
  onStart: () => void;
  onOpenDetails?: () => void;
  onSetupUmbra?: () => void;
  setupBusy?: boolean;
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function PayrollConfirmationCard({
  summary,
  busy,
  onStart,
  onOpenDetails,
  onSetupUmbra,
  setupBusy = false,
}: PayrollConfirmationCardProps): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const [ackBlocked, setAckBlocked] = useState(false);

  const typedOk = !summary.requiresTypedConfirmation || isTypedConfirmationValid(summary, typed);
  const blockedBySetup = summary.requiresUmbraSetup;
  const { canStart, needsBlockedAck } = resolvePayrollStartGate({
    summary,
    typedConfirmationOk: typedOk,
    blockedAcknowledged: ackBlocked,
    busy,
  });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Review payroll</Text>
        <Text style={styles.sourceName} numberOfLines={1}>
          {payrollRoutePolicyCopy(summary.routePolicy)}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Stat label="Recipients" value={String(summary.recipientCount)} />
        <Stat label="Total" value={`${summary.totalDisplay} ${summary.tokenSymbol}`} />
        <Stat label="Network" value={summary.network} />
        <Stat label="Wallet" value={shortenWalletAddress(summary.walletAddress)} />
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
          {summary.claimRequiredCount} Umbra recipient
          {summary.claimRequiredCount === 1 ? '' : 's'} must claim funds in their own wallet before
          the payment is spendable.
        </Text>
      ) : null}

      {summary.unprobedRecipientCount > 0 ? (
        <Text style={styles.claimNote}>
          {summary.unprobedRecipientCount} recipient
          {summary.unprobedRecipientCount === 1 ? ' was' : 's were'} not checked for the Umbra route
          (large batch) and will use MagicBlock where allowed.
        </Text>
      ) : null}

      {summary.showLargeBatchWarning ? (
        <Text style={styles.warningText}>
          Large batch ({summary.recipientCount} recipients). Execution runs one at a time and may
          take a while.
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
            Skip {summary.invalidCount} blocked row{summary.invalidCount === 1 ? '' : 's'} and pay
            the {summary.recipientCount} valid recipient
            {summary.recipientCount === 1 ? '' : 's'} only.
          </Text>
        </Pressable>
      ) : null}

      {blockedBySetup ? (
        <>
          <Text style={styles.warningText}>
            Umbra needs a one-time setup on this wallet before payroll can start.
          </Text>
          <Pressable
            style={[styles.secondaryButton, setupBusy && styles.primaryButtonDisabled]}
            onPress={onSetupUmbra}
            disabled={setupBusy || onSetupUmbra == null}
            accessibilityRole="button"
            accessibilityLabel="Set up Umbra"
            accessibilityState={{ disabled: setupBusy || onSetupUmbra == null }}
          >
            {setupBusy ? (
              <ActivityIndicator size="small" color={colors.brand.deepShadow} />
            ) : (
              <Text style={styles.secondaryButtonText}>Set up Umbra</Text>
            )}
          </Pressable>
        </>
      ) : null}

      {summary.requiresTypedConfirmation && !blockedBySetup ? (
        <View>
          <Text style={styles.statLabel}>
            Type the recipient count ({summary.recipientCount}) or total to confirm
          </Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            keyboardType="numeric"
            placeholder={String(summary.recipientCount)}
            placeholderTextColor={colors.text.placeholder}
            style={styles.typedConfirmInput}
            accessibilityLabel="Type to confirm payroll"
          />
        </View>
      ) : null}

      <Pressable
        style={[styles.primaryButton, !canStart && styles.primaryButtonDisabled]}
        onPress={onStart}
        disabled={!canStart}
        accessibilityRole="button"
        accessibilityLabel="Start payroll"
        accessibilityState={{ disabled: !canStart }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.brand.whiteStream} />
        ) : (
          <>
            <Ionicons name="send" size={16} color={colors.brand.whiteStream} />
            <Text style={styles.primaryButtonText}>Start payroll</Text>
          </>
        )}
      </Pressable>

      {onOpenDetails != null ? (
        <Pressable
          style={styles.secondaryButton}
          onPress={onOpenDetails}
          accessibilityRole="button"
          accessibilityLabel="Open payroll details"
        >
          <Text style={styles.secondaryButtonText}>Review rows</Text>
        </Pressable>
      ) : null}
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
