/**
 * Connects a staged payroll run to the chat UI: renders the confirmation
 * card, drives execution through `usePayrollRun`, and shows compact live
 * progress + receipts once a run starts. Self-contained so `ChatScreen` only mounts
 * this one component for the active run.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { Easing, FadeInUp, LinearTransition } from 'react-native-reanimated';

import { LazyLoadingSpinner } from '@/components/ui/lazy-loading-spinner';
import { Text } from '@/components/ui/Text';
import { usePayrollRun } from '@/hooks/payroll/usePayrollRun';
import { usePayrollStore } from '@/store/payrollStore';
import { useAppToast } from '@/components/ui/AppToast';
import { colors } from '@/constants/colors';

import { PayrollConfirmationCard } from './PayrollConfirmationCard';
import { payrollStyles as styles } from './styles';
import { buildPayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import { payrollRunOutcomeSpeech, shouldSpeakPayrollRunOutcome } from '@/lib/payroll/payroll-copy';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollRoutePolicy, PayrollRow, PayrollRunStatus } from '@/lib/payroll/payroll-types';

interface PayrollProgress {
  total: number;
  done: number;
  failed: number;
  blocked: number;
}

export interface PayrollOutcomeAnnouncement {
  status: PayrollRunStatus;
  progress: PayrollProgress;
  claimsPending: boolean;
  network: PayrollConfirmationSummary['network'];
}

interface PayrollChatControllerProps {
  runId: string;
  walletId: string | null;
  summary: PayrollConfirmationSummary | null;
  onSetupUmbra?: () => void;
  onRefreshRoutes?: () => Promise<void>;
  onRoutePolicyChange?: (policy: PayrollRoutePolicy) => void;
  /** Optional outcome read-aloud, called once when the run reaches a terminal status. */
  onSpeakOutcome?: (phrase: string) => void;
  /** Optional text announcement, called once when the run reaches a terminal status. */
  onAnnounceOutcome?: (outcome: PayrollOutcomeAnnouncement) => void;
  setupBusy?: boolean;
}

const RUNNING_STATUSES = new Set(['running']);
const TERMINAL_STATUSES = new Set<PayrollRunStatus>([
  'completed',
  'completed_with_claims_pending',
  'completed_with_errors',
  'cancelled',
  'failed',
]);
const CARD_ENTERING = FadeInUp.duration(180).easing(Easing.out(Easing.cubic));
const CARD_LAYOUT = LinearTransition.duration(200).easing(Easing.out(Easing.cubic));

export function PayrollChatController({
  runId,
  walletId,
  summary,
  onSetupUmbra,
  onRefreshRoutes,
  onRoutePolicyChange,
  onSpeakOutcome,
  onAnnounceOutcome,
  setupBusy = false,
}: PayrollChatControllerProps): React.JSX.Element | null {
  const { run, isExecuting, execute, pause, retryFailed, cancel } = usePayrollRun({
    runId,
    walletId,
  });
  const rows = usePayrollStore((state) => state.rowsByRun[runId]);
  const router = useRouter();
  const { showToast } = useAppToast();
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
      hasSufficientBalanceForRun: summary.hasSufficientBalanceForRun,
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
    const blocked = rows.filter(
      (row) => row.status === 'invalid' || row.status === 'skipped',
    ).length;
    return { total, done, failed, blocked };
  }, [rows]);

  // Speak only fresh in-session outcomes. A terminal status loaded from MMKV
  // on mount (old completed/paused run) must stay silent; speaking is allowed
  // only for transitions out of a live executing state.
  useEffect(() => {
    const status = run?.status;
    const network = run?.network;
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
    if (phrase != null) {
      onSpeakOutcome?.(phrase);
      if (network != null) {
        onAnnounceOutcome?.({
          status,
          progress: progress ?? { total: 0, done: 0, failed: 0, blocked: 0 },
          claimsPending: status === 'completed_with_claims_pending',
          network,
        });
      }
    }
  }, [
    runId,
    run?.network,
    run?.status,
    run?.updatedAt,
    onSpeakOutcome,
    onAnnounceOutcome,
    progress,
  ]);

  const handleStart = useCallback(() => {
    void execute();
  }, [execute]);

  const handleRetry = useCallback(() => {
    void retryFailed();
  }, [retryFailed]);

  const receipts = useMemo(() => {
    return (rows ?? [])
      .map(rowToReceipt)
      .filter((receipt): receipt is PayrollReceipt => receipt != null);
  }, [rows]);

  const copyReceipt = useCallback(
    async (receipt: PayrollReceipt) => {
      await Clipboard.setStringAsync(receipt.value);
      showToast({
        title: 'Copied',
        message: `${receipt.kind} copied to clipboard.`,
        variant: 'success',
      });
    },
    [showToast],
  );

  if (run == null) return null;

  const status = run.status;
  const isRunning = RUNNING_STATUSES.has(status) || isExecuting;
  const terminal = TERMINAL_STATUSES.has(status);

  // Pre-execution: show the confirmation card.
  if ((status === 'ready' || status === 'draft') && liveSummary != null) {
    return (
      <Animated.View entering={CARD_ENTERING} layout={CARD_LAYOUT}>
        <PayrollConfirmationCard
          summary={liveSummary}
          busy={isExecuting || run.routesDirty === true}
          onStart={handleStart}
          onOpenDetails={openDetails}
          onSetupUmbra={onSetupUmbra}
          onRoutePolicyChange={onRoutePolicyChange}
          onCancel={cancel}
          setupBusy={setupBusy}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={CARD_ENTERING} layout={CARD_LAYOUT} style={styles.card}>
      <View style={styles.runStatusHeader}>
        <View style={styles.runStatusTitleBlock}>
          <Text style={styles.runStatusEyebrow}>Batch Send</Text>
          <Text style={styles.runStatusTitle}>{humanStatusTitle(status)}</Text>
        </View>
        <View style={[styles.runStatusPill, status === 'cancelled' && styles.runStatusPillMuted]}>
          <Text style={styles.runStatusPillText}>{humanStatusBadge(status)}</Text>
        </View>
      </View>

      {progress != null ? <PayrollProgressSummary progress={progress} /> : null}

      {isRunning ? (
        <View style={styles.payrollBackgroundStatus}>
          <LazyLoadingSpinner size={18} color={colors.brand.whiteStream} />
          <Text style={styles.claimNote}>
            Sending in the background. You can keep chatting while Yuga works through the batch.
          </Text>
        </View>
      ) : null}

      {terminal ? (
        <PayrollReceiptList
          receipts={receipts}
          status={status}
          progress={progress}
          onCopy={copyReceipt}
          onOpenDetails={openDetails}
        />
      ) : null}

      <View style={styles.secondaryRow}>
        {isRunning ? <PayrollSecondaryButton label="Pause" onPress={pause} /> : null}
        {isRunning ? <PayrollSecondaryButton label="Cancel" onPress={cancel} /> : null}
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
    </Animated.View>
  );
}

function PayrollProgressSummary({ progress }: { progress: PayrollProgress }): React.JSX.Element {
  return (
    <View style={styles.runMetricRow}>
      <RunMetric label="Sent" value={String(progress.done)} />
      {progress.total > 0 ? <RunMetric label="To pay" value={String(progress.total)} /> : null}
      {progress.failed > 0 ? <RunMetric label="Failed" value={String(progress.failed)} /> : null}
      {progress.blocked > 0 ? <RunMetric label="Blocked" value={String(progress.blocked)} /> : null}
    </View>
  );
}

function RunMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.runMetricPill}>
      <Text style={styles.runMetricValue}>{value}</Text>
      <Text style={styles.runMetricLabel}>{label}</Text>
    </View>
  );
}

interface PayrollReceipt {
  id: string;
  kind: 'Tx' | 'Queue';
  value: string;
}

const MAX_CHAT_RECEIPTS = 5;

function rowToReceipt(row: PayrollRow): PayrollReceipt | null {
  const value = row.signature ?? row.txId ?? row.initSignature;
  if (value == null || value.length === 0) return null;
  return {
    id: `${row.id}:${value}`,
    kind: row.signature == null && row.txId != null ? 'Queue' : 'Tx',
    value,
  };
}

function PayrollReceiptList({
  receipts,
  status,
  progress,
  onCopy,
  onOpenDetails,
}: {
  receipts: PayrollReceipt[];
  status: PayrollRunStatus;
  progress: PayrollProgress | null;
  onCopy: (receipt: PayrollReceipt) => void;
  onOpenDetails: () => void;
}): React.JSX.Element {
  if (receipts.length === 0) {
    return <PayrollEmptyReceiptState status={status} progress={progress} />;
  }

  const visibleReceipts = receipts.slice(0, MAX_CHAT_RECEIPTS);
  const hiddenCount = receipts.length - visibleReceipts.length;

  return (
    <View style={styles.payrollReceiptList}>
      {visibleReceipts.map((receipt, index) => (
        <Pressable
          key={receipt.id}
          style={({ pressed }) => [
            styles.payrollReceiptRow,
            pressed && styles.payrollReceiptRowPressed,
          ]}
          onPress={() => onCopy(receipt)}
          accessibilityRole="button"
          accessibilityLabel={`Copy batch send ${receipt.kind.toLowerCase()} ${index + 1}`}
        >
          <Text style={styles.payrollReceiptLabel}>
            {receipt.kind} {index + 1}
          </Text>
          <Text style={styles.payrollReceiptHash} numberOfLines={1} ellipsizeMode="middle">
            {shortenWalletAddress(receipt.value, 6)}
          </Text>
        </Pressable>
      ))}

      {hiddenCount > 0 ? (
        <Pressable
          onPress={onOpenDetails}
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Open all batch send receipts"
        >
          <Text style={styles.secondaryButtonText}>View {hiddenCount} more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PayrollEmptyReceiptState({
  status,
  progress,
}: {
  status: PayrollRunStatus;
  progress: PayrollProgress | null;
}): React.JSX.Element {
  const isCancelled = status === 'cancelled';
  const blockedCopy =
    progress != null && progress.blocked > 0
      ? `${progress.blocked} blocked row${progress.blocked === 1 ? '' : 's'} stayed unpaid.`
      : null;

  return (
    <View style={styles.emptyReceiptCard}>
      <View style={[styles.emptyReceiptIcon, isCancelled && styles.emptyReceiptIconMuted]}>
        <Ionicons
          name={isCancelled ? 'close' : 'document-text-outline'}
          size={16}
          color={isCancelled ? colors.text.secondary : colors.text.primary}
        />
      </View>
      <View style={styles.emptyReceiptCopy}>
        <Text style={styles.emptyReceiptTitle}>
          {isCancelled ? 'Cancelled before sending' : 'No receipt recorded'}
        </Text>
        <Text style={styles.emptyReceiptBody}>
          {isCancelled
            ? `No transaction was submitted.${blockedCopy != null ? ` ${blockedCopy}` : ''}`
            : 'No transaction hash was recorded for this run.'}
        </Text>
      </View>
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

function humanStatusTitle(status: string): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Complete';
    case 'completed_with_claims_pending':
      return 'Claims pending';
    case 'completed_with_errors':
      return 'Needs review';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function humanStatusBadge(status: string): string {
  switch (status) {
    case 'running':
      return 'Sending';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Sent';
    case 'completed_with_claims_pending':
      return 'Claims';
    case 'completed_with_errors':
      return 'Review';
    case 'cancelled':
      return 'Not sent';
    case 'failed':
      return 'Failed';
    default:
      return humanStatus(status);
  }
}
