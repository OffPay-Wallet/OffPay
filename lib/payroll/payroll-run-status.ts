import { isPayrollRowSendable } from '@/lib/payroll/payroll-types';

import type { PayrollRow, PayrollRunStatus } from '@/lib/payroll/payroll-types';

/**
 * Terminal status for a run after a non-interrupted execution pass. Pure so
 * it can be unit-tested without the hook.
 *
 * `sending` is treated as pending defensively: a row left mid-submit must
 * never let the run report complete. Reconciliation normally converts those
 * to `failed` before execution, but this guards the window between a crash
 * and the next reconcile.
 */
export function resolveCompletedRunStatus(rows: readonly PayrollRow[]): PayrollRunStatus {
  let hasFailed = false;
  let hasClaimPending = false;
  let hasPending = false;
  for (const row of rows) {
    if (row.status === 'failed' || row.status === 'invalid' || row.status === 'skipped') {
      hasFailed = true;
    } else if (row.status === 'deposited_unclaimed') hasClaimPending = true;
    else if (row.status === 'sending' || isPayrollRowSendable(row)) hasPending = true;
  }
  if (hasPending) return 'paused';
  if (hasFailed) return 'completed_with_errors';
  if (hasClaimPending) return 'completed_with_claims_pending';
  return 'completed';
}

/**
 * Resolves the status to write when an execution pass is interrupted. Cancel
 * intent wins over the default pause so a user cancel is not overwritten by
 * the executor's interrupted summary.
 */
export function resolveInterruptedRunStatus(cancelRequested: boolean): PayrollRunStatus {
  return cancelRequested ? 'cancelled' : 'paused';
}
