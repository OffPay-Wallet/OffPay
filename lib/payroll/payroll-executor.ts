import { getPayrollSubmissionAttemptId, isPayrollRowSendable } from '@/lib/payroll/payroll-types';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';
import { isAbortError } from '@/lib/perf/abort';

import type { PayrollRoute, PayrollRow } from '@/lib/payroll/payroll-types';

/** Result of submitting a single row through a route submitter. */
export type PayrollSubmitOutcome =
  | { status: 'submitted'; signature: string; txId?: string | null; initSignature?: string | null }
  | { status: 'queued'; txId: string; signature?: string | null; initSignature?: string | null }
  | { status: 'deposited_unclaimed'; signature: string; initSignature?: string | null };

export interface PayrollRowSubmitContext {
  row: PayrollRow;
  route: PayrollRoute;
  signal?: AbortSignal;
}

export interface PayrollExecutorHooks {
  /**
   * Submits a single row. Implementations call Umbra / MagicBlock. Throwing
   * marks the row failed; returning an outcome locks the row against resend.
   */
  submitRow: (context: PayrollRowSubmitContext) => Promise<PayrollSubmitOutcome>;
  /**
   * Atomically persists the durable submission tombstone and changes the row
   * from `ready` to `sending`. False means another executor already claimed it.
   */
  onRowSubmissionStart: (rowId: string, attemptId: string, startedAt: number) => boolean;
  /** Persisted after every row mutation so a crash mid-run is recoverable. */
  onRowUpdate: (rowId: string, patch: Partial<Omit<PayrollRow, 'id'>>) => void;
  /** Advances the persisted resume cursor. */
  onCursorAdvance: (cursor: number) => void;
}

export interface RunPayrollBatchParams {
  rows: PayrollRow[];
  /** Resume from here; earlier rows are assumed already processed. */
  startIndex?: number;
  hooks: PayrollExecutorHooks;
  signal?: AbortSignal;
}

export interface PayrollBatchSummary {
  submitted: number;
  queued: number;
  depositedUnclaimed: number;
  failed: number;
  skipped: number;
  /** True when execution stopped early due to pause/cancel. */
  interrupted: boolean;
  /** Index to resume from next time. */
  nextCursor: number;
}

/**
 * Executes a batch send sequentially. One row at a time to avoid JS /
 * prover / RPC saturation; yields to the UI between rows so the screen stays
 * responsive during a long run.
 *
 * Guarantees:
 *  - A row with any signature / tx id / deposit signature is never resent.
 *  - A durable attempt tombstone is claimed before route submission. An
 *    uncertain outcome is reconciliation-only and is never auto-retried.
 *  - Umbra success is recorded as `deposited_unclaimed` (recipient must
 *    claim), not `submitted`.
 *  - Pause/cancel (via `signal`) stops after the current row; completed rows
 *    persist and the cursor points at the next pending row.
 */
export async function runPayrollBatch(params: RunPayrollBatchParams): Promise<PayrollBatchSummary> {
  const { rows, hooks } = params;
  const summary: PayrollBatchSummary = {
    submitted: 0,
    queued: 0,
    depositedUnclaimed: 0,
    failed: 0,
    skipped: 0,
    interrupted: false,
    nextCursor: params.startIndex ?? 0,
  };

  for (let index = params.startIndex ?? 0; index < rows.length; index += 1) {
    if (params.signal?.aborted === true) {
      summary.interrupted = true;
      summary.nextCursor = index;
      return summary;
    }

    const row = rows[index];

    // Only `ready` rows are sent. `failed` rows are NOT auto-resent on a
    // resume. Only pre-submission failures can be reset by the explicit retry
    // path; a durable attempt tombstone makes an uncertain row reconciliation-
    // only. `isPayrollRowSendable` is the final double-pay backstop.
    if (row.route == null || row.status !== 'ready' || !isPayrollRowSendable(row)) {
      if (row.status === 'skipped' || row.status === 'invalid') summary.skipped += 1;
      summary.nextCursor = index + 1;
      hooks.onCursorAdvance(summary.nextCursor);
      continue;
    }

    const submissionAttemptId = getPayrollSubmissionAttemptId(row.idempotencyKey);
    const submissionStartedAt = Date.now();
    if (!hooks.onRowSubmissionStart(row.id, submissionAttemptId, submissionStartedAt)) {
      // A concurrent executor or a prior persisted attempt owns this row.
      summary.nextCursor = index + 1;
      hooks.onCursorAdvance(summary.nextCursor);
      continue;
    }

    try {
      const claimedRow: PayrollRow = {
        ...row,
        status: 'sending',
        submissionAttemptId,
        submissionStartedAt,
        reconciliationRequired: false,
      };
      const outcome = await hooks.submitRow({
        row: claimedRow,
        route: row.route,
        signal: params.signal,
      });

      if (outcome.status === 'submitted') {
        hooks.onRowUpdate(row.id, {
          status: 'submitted',
          signature: outcome.signature,
          txId: outcome.txId ?? null,
          initSignature: outcome.initSignature ?? null,
          requiresRecipientClaim: false,
          reconciliationRequired: false,
          validationError: null,
        });
        summary.submitted += 1;
      } else if (outcome.status === 'queued') {
        hooks.onRowUpdate(row.id, {
          status: 'queued',
          txId: outcome.txId,
          signature: outcome.signature ?? null,
          initSignature: outcome.initSignature ?? null,
          requiresRecipientClaim: false,
          reconciliationRequired: false,
          validationError: null,
        });
        summary.queued += 1;
      } else {
        // Umbra deposit: recipient must claim.
        hooks.onRowUpdate(row.id, {
          status: 'deposited_unclaimed',
          signature: outcome.signature,
          initSignature: outcome.initSignature ?? null,
          requiresRecipientClaim: true,
          reconciliationRequired: false,
          validationError: null,
        });
        summary.depositedUnclaimed += 1;
      }
    } catch (error) {
      const aborted = isAbortError(error);
      const cause = error instanceof Error ? error.message.trim() : '';
      const message = aborted
        ? 'Submission was interrupted after execution started. Its outcome is unknown. Verify on-chain before any manual retry.'
        : `Submission outcome is unknown after execution started${
            cause.length > 0 ? ` (${cause})` : ''
          }. Verify on-chain before any manual retry.`;
      hooks.onRowUpdate(row.id, {
        status: 'failed',
        reconciliationRequired: true,
        validationError: message,
        retryCount: row.retryCount + 1,
      });
      summary.failed += 1;

      if (aborted) {
        summary.interrupted = true;
        summary.nextCursor = index + 1;
        hooks.onCursorAdvance(summary.nextCursor);
        return summary;
      }
    }

    summary.nextCursor = index + 1;
    hooks.onCursorAdvance(summary.nextCursor);
    await yieldToUi();
  }

  return summary;
}
