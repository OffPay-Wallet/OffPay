/**
 * Connects a staged payroll run to the chat UI: renders the confirmation
 * card, drives execution through `usePayrollRun`, and shows live progress +
 * the row list once a run starts. Self-contained so `ChatScreen` only mounts
 * this one component for the active run.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Text } from '@/components/ui/Text';
import { usePayrollRun } from '@/hooks/payroll/usePayrollRun';
import { usePayrollStore } from '@/store/payrollStore';

import { PayrollConfirmationCard } from './PayrollConfirmationCard';
import { PayrollRowList } from './PayrollRowList';
import { payrollStyles as styles } from './styles';
import { buildPayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import {
  payrollRunOutcomeSpeech,
  shouldSpeakPayrollRunOutcome,
} from '@/lib/payroll/payroll-copy';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollRunStatus } from '@/lib/payroll/payroll-types';

interface PayrollChatControllerProps {
  runId: string;
  walletId: string | null;
  summary: PayrollConfirmationSummary | null;
  onSetupUmbra?: () => void;
  onRefreshRoutes?: () => Promise<void>;
  /** Optional outcome read-aloud, called once when the run reaches a terminal status. */
  onSpeakOutcome?: (phrase: string) => void;
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
  onRefreshRoutes,
  onSpeakOutcome,
  setupBusy = false,
}: PayrollChatControllerProps): React.JSX.Element | null {
  const { run, isExecuting, execute, pause, retryFailed, cancel } = usePayrollRun({
    runId,
    walletId,
  });
  const rows = usePayrollStore((state) => state.rowsByRun[runId]);
  const router = useRouter();
  const routeRefreshInFlightRef = useRef(false);
  const spokenStatusRef = useRef<string | null>(null);
  const previousStatusRef = useRef<{ runId: string; status: PayrollRunStatus | null }>({
    runId,
    status: null,
  });

  const openDetails = useCallback(() => {
    // `as never`: the typed-routes manifest regenerates on dev-server start;
    // matches the repo convention for newly-added routes.
    router.push({ pathname: '/payroll-review', params: { runId } } as never);
  }, [router, runId]);

  // Recompute row-derived summary fields (counts, total) from the LIVE store
  // rows so skipping/restoring in the review screen is reflected on the card,
  // while preserving the staged route-split / readiness fields.
  const liveSummary = useMemo(() => {
    if (summary == null || rows == null || run == null) return summary;
    return buildPayrollConfirmationSummary({
      walletAddress: summary.walletAddress,
      network: summary.network,
      tokenSymbol: summary.tokenSymbol,
      tokenMint: summary.tokenMint,
      tokenDecimals: run.tokenDecimals ?? 6,
      rows,
      routePolicy: summary.routePolicy,
      split: summary.split,
      requiresUmbraSetup: summary.requiresUmbraSetup,
      unprobedRecipientCount: summary.unprobedRecipientCount,
    });
  }, [summary, rows, run]);

  useEffect(() => {
    if (
      run == null ||
      run.routesDirty !== true ||
      (run.status !== 'ready' && run.status !== 'draft') ||
      onRefreshRoutes == null ||
      routeRefreshInFlightRef.current
    ) {
      return;
    }

    routeRefreshInFlightRef.current = true;
    void onRefreshRoutes().finally(() => {
      routeRefreshInFlightRef.current = false;
    });
  }, [onRefreshRoutes, run]);

  // Speak only fresh in-session outcomes. A terminal status loaded from MMKV
  // on mount (old completed/paused run) must stay silent; speaking is allowed
  // only for transitions out of a live executing state.
  useEffect(() => {
    const status = run?.status;
    const previous =
      previousStatusRef.current.runId === runId ? previousStatusRef.current.status : null;
    previousStatusRef.current = { runId, status: status ?? null };

    if (status == null || !shouldSpeakPayrollRunOutcome(previous, status)) {
      if (status === 'running' || status === 'confirming') spokenStatusRef.current = null;
      return;
    }

    const spokenKey = `${runId}:${status}:${run?.updatedAt ?? ''}`;
    if (spokenStatusRef.current === spokenKey) return;
    spokenStatusRef.current = spokenKey;
    const phrase = payrollRunOutcomeSpeech(status);
    if (phrase != null) onSpeakOutcome?.(phrase);
  }, [runId, run?.status, run?.updatedAt, onSpeakOutcome]);

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
  if ((status === 'ready' || status === 'draft') && liveSummary != null) {
    return (
      <PayrollConfirmationCard
        summary={liveSummary}
        busy={isExecuting || run.routesDirty === true}
        onStart={handleStart}
        onOpenDetails={openDetails}
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
