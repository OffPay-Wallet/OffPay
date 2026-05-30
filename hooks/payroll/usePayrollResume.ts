/**
 * Launch-time payroll recovery + resume surfacing.
 *
 * On first mount it demotes any run orphaned in `running`/`confirming` by an
 * app kill to `paused` (reconciling orphaned `sending` rows), then exposes the
 * most recent resumable run for the active wallet/network so the chat surface
 * can offer to continue it.
 *
 * Resuming itself goes through the normal `usePayrollRun.execute` path, which
 * re-derives the signing seed — and the seed derivation prompts wallet
 * re-auth because the seed cache is cleared on background/lock. This hook does
 * not need to prompt auth directly.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { findResumableRuns } from '@/lib/payroll/payroll-resume';
import { usePayrollStore } from '@/store/payrollStore';

import type { OffpayNetwork } from '@/types/offpay-api';

export interface UsePayrollResumeParams {
  walletAddress: string | null;
  network: OffpayNetwork | null;
}

export interface UsePayrollResumeResult {
  /** Most recent resumable run id for the active scope, or null. */
  resumableRunId: string | null;
  pendingCount: number;
}

export function usePayrollResume(params: UsePayrollResumeParams): UsePayrollResumeResult {
  const reconcileOrphanedRunsOnLaunch = usePayrollStore(
    (state) => state.reconcileOrphanedRunsOnLaunch,
  );
  const runs = usePayrollStore((state) => state.runs);
  const rowsByRun = usePayrollStore((state) => state.rowsByRun);

  const [reconciled, setReconciled] = useState(false);
  const ranRef = useRef(false);

  // Run launch recovery exactly once per app session.
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    reconcileOrphanedRunsOnLaunch();
    setReconciled(true);
  }, [reconcileOrphanedRunsOnLaunch]);

  return useMemo<UsePayrollResumeResult>(() => {
    if (!reconciled || params.walletAddress == null || params.network == null) {
      return { resumableRunId: null, pendingCount: 0 };
    }

    const scoped = findResumableRuns(runs, rowsByRun).filter((summary) => {
      const run = runs[summary.runId];
      return (
        run != null &&
        run.walletAddress === params.walletAddress &&
        run.network === params.network
      );
    });

    const first = scoped[0];
    return first == null
      ? { resumableRunId: null, pendingCount: 0 }
      : { resumableRunId: first.runId, pendingCount: first.pendingCount };
  }, [reconciled, params.walletAddress, params.network, runs, rowsByRun]);
}
