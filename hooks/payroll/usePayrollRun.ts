/**
 * Orchestration hook for a single payroll run. Owns the lifecycle that the
 * chat payroll card and full-screen review bind to:
 *
 *   stage(text) -> assignRoutes(facts) -> confirm() -> execute()
 *                                                  -> pause()/resume()/retry()
 *
 * Heavy work (parse, validate, sign, submit) lives in `@/lib/payroll`; this
 * hook is the thin React adapter that wires those pure modules to the
 * MMKV-backed `usePayrollStore`, an AbortController for pause/cancel, and the
 * row submitter bridge. Execution is sequential and yields to the UI between
 * rows so the screen never freezes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { runPayrollBatch } from '@/lib/payroll/payroll-executor';
import { createPayrollRowSubmitter } from '@/lib/payroll/payroll-row-submitter';
import { isPayrollRowSendable } from '@/lib/payroll/payroll-types';
import {
  resolveCompletedRunStatus,
  resolveInterruptedRunStatus,
} from '@/lib/payroll/payroll-run-status';
import { usePayrollStore } from '@/store/payrollStore';

import type { OffpayNetwork } from '@/types/offpay-api';
import type { PayrollRun } from '@/lib/payroll/payroll-types';

export interface UsePayrollRunParams {
  runId: string | null;
  walletId: string | null;
}

export interface UsePayrollRunResult {
  run: PayrollRun | null;
  isExecuting: boolean;
  execute: () => Promise<void>;
  pause: () => void;
  retryFailed: () => Promise<void>;
  cancel: () => void;
}

function nextRunStatus(rows: ReturnType<typeof usePayrollStore.getState>['rowsByRun'][string]) {
  return resolveCompletedRunStatus(rows);
}

export function usePayrollRun(params: UsePayrollRunParams): UsePayrollRunResult {
  const { runId, walletId } = params;
  const run = usePayrollStore((state) => (runId != null ? state.runs[runId] ?? null : null));
  const setRunStatus = usePayrollStore((state) => state.setRunStatus);
  const setRunCursor = usePayrollStore((state) => state.setRunCursor);
  const updateRow = usePayrollStore((state) => state.updateRow);
  const prepareRetryFailedRows = usePayrollStore((state) => state.prepareRetryFailedRows);
  const reconcileInterruptedRows = usePayrollStore((state) => state.reconcileInterruptedRows);

  const [isExecuting, setIsExecuting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Distinguishes a user cancel from a pause: both abort the same controller,
  // but cancel must win the terminal status write.
  const cancelRequestedRef = useRef(false);

  // Abort any in-flight run if the component unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const runExecution = useCallback(
    async (startIndex: number) => {
      if (runId == null) return;
      // Recover any rows orphaned in `sending` by a prior crash/kill before
      // we compute where to resume.
      reconcileInterruptedRows(runId);

      const current = usePayrollStore.getState().getRun(runId);
      const rows = usePayrollStore.getState().getRows(runId);
      if (current == null || rows.length === 0) return;

      const controller = new AbortController();
      abortRef.current = controller;
      cancelRequestedRef.current = false;
      setIsExecuting(true);
      setRunStatus(runId, 'running');

      const submitter = createPayrollRowSubmitter({
        walletAddress: current.walletAddress,
        walletId: current.walletId ?? walletId,
        network: current.network as OffpayNetwork,
        tokenSymbol: current.tokenSymbol ?? '',
      });

      try {
        const summary = await runPayrollBatch({
          rows,
          startIndex,
          signal: controller.signal,
          hooks: {
            submitRow: submitter,
            onRowUpdate: (rowId, patch) => updateRow(runId, rowId, patch),
            onCursorAdvance: (cursor) => setRunCursor(runId, cursor),
          },
        });

        if (summary.interrupted) {
          // Respect cancel intent over the default pause.
          setRunStatus(runId, resolveInterruptedRunStatus(cancelRequestedRef.current));
          return;
        }
        setRunStatus(runId, nextRunStatus(usePayrollStore.getState().getRows(runId)));
      } finally {
        abortRef.current = null;
        cancelRequestedRef.current = false;
        setIsExecuting(false);
      }
    },
    [runId, walletId, setRunStatus, setRunCursor, updateRow, reconcileInterruptedRows],
  );

  const execute = useCallback(async () => {
    if (runId == null) return;
    const current = usePayrollStore.getState().getRun(runId);
    if (current == null) return;
    await runExecution(current.cursor ?? 0);
  }, [runId, runExecution]);

  const retryFailed = useCallback(async () => {
    if (runId == null) return;
    const reset = prepareRetryFailedRows(runId);
    if (reset === 0) return;
    // Resume from the first sendable row so settled rows are skipped.
    const rows = usePayrollStore.getState().getRows(runId);
    const firstPending = rows.findIndex((row) => isPayrollRowSendable(row));
    await runExecution(firstPending < 0 ? rows.length : firstPending);
  }, [runId, prepareRetryFailedRows, runExecution]);

  const pause = useCallback(() => {
    cancelRequestedRef.current = false;
    abortRef.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    cancelRequestedRef.current = true;
    const inFlight = abortRef.current;
    if (inFlight != null) {
      inFlight.abort();
    } else if (runId != null) {
      // Nothing running — write the terminal status directly.
      setRunStatus(runId, 'cancelled');
    }
  }, [runId, setRunStatus]);

  return useMemo(
    () => ({ run, isExecuting, execute, pause, retryFailed, cancel }),
    [run, isExecuting, execute, pause, retryFailed, cancel],
  );
}
