import { isPayrollRowSendable } from '@/lib/payroll/payroll-types';
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
 * Executes a payroll batch sequentially. One row at a time to avoid JS /
 * prover / RPC saturation; yields to the UI between rows so the screen stays
 * responsive during a long run.
 *
 * Guarantees:
 *  - A row with any signature / tx id / deposit signature is never resent.
 *  - Umbra success is recorded as `deposited_unclaimed` (recipient must
 *    claim), not `submitted`.
 *  - Pause/cancel (via `signal`) stops after the current row; completed rows
 *    persist and the cursor points at the next pending row.
 */
export async function runPayrollBatch(
  params: RunPayrollBatchParams,
): Promise<PayrollBatchSummary> {
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
    // resume — they require the explicit retry path (which resets them to
    // `ready` first), so an interrupted/failed row can be verified before
    // re-attempting. The artifact guard in `isPayrollRowSendable` is the
    // final double-pay backstop.
    if (row.route == null || row.status !== 'ready' || !isPayrollRowSendable(row)) {
      if (row.status === 'skipped' || row.status === 'invalid') summary.skipped += 1;
      summary.nextCursor = index + 1;
      hooks.onCursorAdvance(summary.nextCursor);
      continue;
    }

    hooks.onRowUpdate(row.id, { status: 'sending' });

    try {
      const outcome = await hooks.submitRow({ row, route: row.route, signal: params.signal });

      if (outcome.status === 'submitted') {
        hooks.onRowUpdate(row.id, {
          status: 'submitted',
          signature: outcome.signature,
          txId: outcome.txId ?? null,
          initSignature: outcome.initSignature ?? null,
          requiresRecipientClaim: false,
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
          validationError: null,
        });
        summary.depositedUnclaimed += 1;
      }
    } catch (error) {
      if (isAbortError(error)) {
        // Roll the in-flight row back to ready so resume re-attempts it.
        hooks.onRowUpdate(row.id, { status: 'ready' });
        summary.interrupted = true;
        summary.nextCursor = index;
        return summary;
      }
      const message = error instanceof Error ? error.message : 'Payment failed.';
      hooks.onRowUpdate(row.id, {
        status: 'failed',
        validationError: message,
        retryCount: row.retryCount + 1,
      });
      summary.failed += 1;
    }

    summary.nextCursor = index + 1;
    hooks.onCursorAdvance(summary.nextCursor);
    await yieldToUi();
  }

  return summary;
}
