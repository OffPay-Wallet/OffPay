/**
 * Connects a staged payroll run to the chat UI: renders the confirmation
 * card, drives execution through `usePayrollRun`, and shows live progress +
 * the row list once a run starts. Self-contained so `ChatScreen` only mounts
 * this one component for the active run.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { usePayrollRun } from '@/hooks/payroll/usePayrollRun';
import { usePayrollStore } from '@/store/payrollStore';

import { PayrollConfirmationCard } from './PayrollConfirmationCard';
import { PayrollRowList } from './PayrollRowList';
import { payrollStyles as styles } from './styles';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';

interface PayrollChatControllerProps {
  runId: string;
  walletId: string | null;
  summary: PayrollConfirmationSummary | null;
  onSetupUmbra?: () => void;
  setupBusy?: boolean;
}

const RUNNING_STATUSES = new Set(['running']);
const SHOW_ROWS_STATUSES = new Set([
  'running',
  'paused',
  'completed',
  'completed_with_claims_pending',
  'completed_with_errors',
  'cancelled',
]);

export function PayrollChatController({
  runId,
  walletId,
  summary,
  onSetupUmbra,
  setupBusy = false,
}: PayrollChatControllerProps): React.JSX.Element | null {
  const { run, isExecuting, execute, pause, retryFailed, cancel } = usePayrollRun({
    runId,
    walletId,
  });
  const rows = usePayrollStore((state) => state.rowsByRun[runId]);

  const progress = useMemo(() => {
    if (rows == null) return null;
    const total = rows.filter((row) => row.status !== 'invalid' && row.status !== 'skipped').length;
    const done = rows.filter(
      (row) =>
        row.status === 'submitted' ||
        row.status === 'queued' ||
        row.status === 'deposited_unclaimed',
    ).length;
    const failed = rows.filter((row) => row.status === 'failed').length;
    const blocked = rows.filter((row) => row.status === 'invalid' || row.status === 'skipped').length;
    return { total, done, failed, blocked };
  }, [rows]);

  const handleStart = useCallback(() => {
    void execute();
  }, [execute]);

  const handleRetry = useCallback(() => {
    void retryFailed();
  }, [retryFailed]);

  if (run == null) return null;

  const status = run.status;
  const showRows = SHOW_ROWS_STATUSES.has(status) && rows != null && rows.length > 0;
  const isRunning = RUNNING_STATUSES.has(status) || isExecuting;

  // Pre-execution: show the confirmation card.
  if ((status === 'ready' || status === 'draft') && summary != null) {
    return (
      <PayrollConfirmationCard
        summary={summary}
        busy={isExecuting}
        onStart={handleStart}
        onSetupUmbra={onSetupUmbra}
        setupBusy={setupBusy}
      />
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Payroll · {humanStatus(status)}</Text>
        {progress != null ? (
          <Text style={styles.sourceName}>
            {progress.done}/{progress.total} sent
            {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
            {progress.blocked > 0 ? ` · ${progress.blocked} blocked` : ''}
          </Text>
        ) : null}
      </View>

      {showRows ? (
        <View style={{ height: Math.min(320, (rows?.length ?? 0) * 64 + 8) }}>
          <PayrollRowList rows={rows} />
        </View>
      ) : null}

      <View style={styles.secondaryRow}>
        {isRunning ? (
          <PayrollSecondaryButton label="Pause" onPress={pause} />
        ) : null}
        {isRunning ? (
          <PayrollSecondaryButton label="Cancel" onPress={cancel} />
        ) : null}
        {!isRunning && status === 'completed_with_errors' ? (
          <PayrollSecondaryButton label="Retry failed" onPress={handleRetry} />
        ) : null}
        {!isRunning && status === 'paused' ? (
          <PayrollSecondaryButton label="Resume" onPress={handleStart} />
        ) : null}
      </View>

      {status === 'completed_with_claims_pending' ? (
        <Text style={styles.claimNote}>
          Some Umbra recipients still need to claim their funds in their own wallet.
        </Text>
      ) : null}
    </View>
  );
}

function PayrollSecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={styles.secondaryButton}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function humanStatus(status: string): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'complete';
    case 'completed_with_claims_pending':
      return 'complete · claims pending';
    case 'completed_with_errors':
      return 'complete with errors';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    default:
      return status;
  }
}
