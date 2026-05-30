import { isPayrollRowSendable } from '@/lib/payroll/payroll-types';

import type { PayrollRow, PayrollRun } from '@/lib/payroll/payroll-types';

/**
 * Resume-after-restart support.
 *
 * When the app is killed mid-run, the executor dies but the MMKV-persisted
 * run keeps its last status. A run still marked `running` on the next launch
 * is therefore ORPHANED — nothing is actually executing it. Such runs must be
 * demoted to `paused` (after `reconcileInterruptedRows` converts any orphaned
 * `sending` row to `failed`) so the run is never silently considered live.
 *
 * Resuming a paused run requires wallet re-authentication because the
 * signing-seed cache is cleared on background/lock. This module only computes
 * which runs need attention; the re-auth + continue is driven by the UI hook.
 */

/** A run is orphaned if it was left mid-execution by a kill/crash. */
export function isOrphanedRunningRun(run: PayrollRun): boolean {
  return run.status === 'running' || run.status === 'confirming';
}

/** Whether a paused/interrupted run still has rows left to send. */
export function runHasPendingRows(rows: readonly PayrollRow[]): boolean {
  return rows.some((row) => row.status === 'sending' || isPayrollRowSendable(row));
}

export interface ResumableRunSummary {
  runId: string;
  pendingCount: number;
  /** Rows already settled (submitted/queued/deposited) — never re-sent. */
  settledCount: number;
  failedCount: number;
}

function countResumable(rows: readonly PayrollRow[]): Omit<ResumableRunSummary, 'runId'> {
  let pendingCount = 0;
  let settledCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    if (row.status === 'submitted' || row.status === 'queued' || row.status === 'deposited_unclaimed') {
      settledCount += 1;
    } else if (row.status === 'failed') {
      failedCount += 1;
    } else if (row.status === 'sending' || isPayrollRowSendable(row)) {
      pendingCount += 1;
    }
  }
  return { pendingCount, settledCount, failedCount };
}

/**
 * Identifies runs that can be resumed: `paused` runs (or orphaned `running`
 * runs, which a launch reconcile should already have demoted) that still have
 * pending rows. Returned newest-first.
 */
export function findResumableRuns(
  runs: Record<string, PayrollRun>,
  rowsByRun: Record<string, readonly PayrollRow[]>,
): ResumableRunSummary[] {
  const resumable: Array<ResumableRunSummary & { updatedAt: number }> = [];
  for (const run of Object.values(runs)) {
    if (run.status !== 'paused' && !isOrphanedRunningRun(run)) continue;
    const rows = rowsByRun[run.id] ?? [];
    if (!runHasPendingRows(rows)) continue;
    resumable.push({ runId: run.id, updatedAt: run.updatedAt, ...countResumable(rows) });
  }
  return resumable
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(({ updatedAt: _updatedAt, ...summary }) => summary);
}
