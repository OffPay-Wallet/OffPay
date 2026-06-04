import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import { isPayrollRowSendable } from '@/lib/payroll/payroll-types';

import type {
  PayrollRoutePolicy,
  PayrollRow,
  PayrollRowStatus,
  PayrollRun,
  PayrollRunStatus,
} from '@/lib/payroll/payroll-types';

/**
 * Dedicated MMKV-backed payroll store. Row-level payroll state lives here —
 * NOT in `agenticChatStore` / `privatePaymentStore`, both of which cap and
 * evict entries. Chat only links to a `payrollRunId`; this store owns rows.
 *
 * Survives app restart through MMKV so a partially-completed run can resume
 * (after wallet re-auth) without re-sending settled rows.
 */
interface PayrollState {
  runs: Record<string, PayrollRun>;
  rowsByRun: Record<string, PayrollRow[]>;

  createRun: (run: PayrollRun, rows: PayrollRow[]) => void;
  replaceRows: (runId: string, rows: PayrollRow[]) => void;
  setRunStatus: (runId: string, status: PayrollRunStatus) => void;
  setRunPolicy: (runId: string, policy: PayrollRoutePolicy) => void;
  setRunToken: (
    runId: string,
    token: { mint: string; symbol: string; decimals: number } | null,
  ) => void;
  setRunRoutesDirty: (runId: string, dirty: boolean) => void;
  setRunCursor: (runId: string, cursor: number) => void;
  updateRow: (runId: string, rowId: string, patch: Partial<Omit<PayrollRow, 'id'>>) => void;
  /**
   * Toggles a row between `skipped` and `ready`. Only ready/skipped rows are
   * eligible — settled or invalid rows are not affected, preserving the
   * double-pay and validation guarantees. Returns true when a change applied.
   */
  setRowSkipped: (runId: string, rowId: string, skipped: boolean) => boolean;
  /** Resets failed-without-artifact rows back to `ready` for a retry pass. */
  prepareRetryFailedRows: (runId: string) => number;
  /**
   * Recovers rows orphaned in `sending` by a crash/kill. They carry no
   * on-chain artifact (the artifact is only written on a completed outcome),
   * so their fate is unknown. We mark them `failed` with an
   * interrupted-verify message rather than silently skipping (underpay) or
   * blindly re-sending (double-pay). Returns the count reconciled.
   */
  reconcileInterruptedRows: (runId: string) => number;
  /**
   * Launch-time recovery. Any run left in `running`/`confirming` by an app
   * kill is orphaned (no live executor), so we reconcile its orphaned
   * `sending` rows and demote it to `paused`. Resuming then requires wallet
   * re-auth. Returns the number of runs demoted.
   */
  reconcileOrphanedRunsOnLaunch: () => number;
  deleteRun: (runId: string) => void;
  getRun: (runId: string) => PayrollRun | null;
  getRows: (runId: string) => PayrollRow[];
}

const MAX_RUNS = 25;

function touchRun(run: PayrollRun): PayrollRun {
  return { ...run, updatedAt: Date.now() };
}

function pruneRuns(runs: Record<string, PayrollRun>): Record<string, PayrollRun> {
  const entries = Object.values(runs);
  if (entries.length <= MAX_RUNS) return runs;
  const keep = entries.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_RUNS);
  const next: Record<string, PayrollRun> = {};
  for (const run of keep) next[run.id] = run;
  return next;
}

/** A `sending` row with no on-chain artifact was interrupted mid-submit. */
function isOrphanedSendingRow(row: PayrollRow): boolean {
  return (
    row.status === 'sending' &&
    row.signature == null &&
    row.txId == null &&
    row.initSignature == null
  );
}

/**
 * Converts an orphaned `sending` row to `failed` with a verify message.
 * Returns the same row reference when no change is needed.
 */
function reconcileSendingRow(row: PayrollRow): PayrollRow {
  if (!isOrphanedSendingRow(row)) return row;
  return {
    ...row,
    status: 'failed',
    validationError:
      'Interrupted before confirmation. Verify on-chain before retrying to avoid double payment.',
    updatedAt: Date.now(),
  };
}

export const usePayrollStore = create<PayrollState>()(
  persist(
    (set, get) => ({
      runs: {},
      rowsByRun: {},

      createRun: (run, rows) =>
        set((state) => {
          const runs = pruneRuns({ ...state.runs, [run.id]: run });
          const rowsByRun = { ...state.rowsByRun, [run.id]: rows };
          // Drop row arrays for runs that were pruned.
          for (const key of Object.keys(rowsByRun)) {
            if (runs[key] == null) delete rowsByRun[key];
          }
          return { runs, rowsByRun };
        }),

      replaceRows: (runId, rows) =>
        set((state) => {
          const run = state.runs[runId];
          if (run == null) return state;
          return {
            rowsByRun: { ...state.rowsByRun, [runId]: rows },
            runs: {
              ...state.runs,
              [runId]: touchRun({ ...run, rowIds: rows.map((row) => row.id), routesDirty: true }),
            },
          };
        }),

      setRunStatus: (runId, status) =>
        set((state) => {
          const run = state.runs[runId];
          if (run == null) return state;
          return { runs: { ...state.runs, [runId]: touchRun({ ...run, status }) } };
        }),

      setRunPolicy: (runId, policy) =>
        set((state) => {
          const run = state.runs[runId];
          if (run == null) return state;
          return { runs: { ...state.runs, [runId]: touchRun({ ...run, routePolicy: policy }) } };
        }),

      setRunToken: (runId, token) =>
        set((state) => {
          const run = state.runs[runId];
          if (run == null) return state;
          return {
            runs: {
              ...state.runs,
              [runId]: touchRun({
                ...run,
                tokenMint: token?.mint ?? null,
                tokenSymbol: token?.symbol ?? null,
                tokenDecimals: token?.decimals ?? null,
                routesDirty: true,
              }),
            },
          };
        }),

      setRunRoutesDirty: (runId, dirty) =>
        set((state) => {
          const run = state.runs[runId];
          if (run == null || run.routesDirty === dirty) return state;
          return { runs: { ...state.runs, [runId]: touchRun({ ...run, routesDirty: dirty }) } };
        }),

      setRunCursor: (runId, cursor) =>
        set((state) => {
          const run = state.runs[runId];
          if (run == null) return state;
          return { runs: { ...state.runs, [runId]: touchRun({ ...run, cursor }) } };
        }),

      updateRow: (runId, rowId, patch) =>
        set((state) => {
          const rows = state.rowsByRun[runId];
          if (rows == null) return state;
          const nextRows = rows.map((row) =>
            row.id === rowId ? { ...row, ...patch, updatedAt: Date.now() } : row,
          );
          return { rowsByRun: { ...state.rowsByRun, [runId]: nextRows } };
        }),

      setRowSkipped: (runId, rowId, skipped) => {
        let changed = false;
        set((state) => {
          const rows = state.rowsByRun[runId];
          if (rows == null) return state;
          const nextRows = rows.map((row) => {
            if (row.id !== rowId) return row;
            // Only ready <-> skipped transitions are allowed. Never touch
            // settled (submitted/queued/deposited) or validation-invalid rows.
            if (skipped && row.status === 'ready') {
              changed = true;
              return { ...row, status: 'skipped' as PayrollRowStatus, updatedAt: Date.now() };
            }
            if (!skipped && row.status === 'skipped') {
              changed = true;
              return { ...row, status: 'ready' as PayrollRowStatus, updatedAt: Date.now() };
            }
            return row;
          });
          if (!changed) return state;
          const run = state.runs[runId];
          return {
            rowsByRun: { ...state.rowsByRun, [runId]: nextRows },
            runs:
              run == null
                ? state.runs
                : { ...state.runs, [runId]: touchRun({ ...run, routesDirty: true }) },
          };
        });
        return changed;
      },

      prepareRetryFailedRows: (runId) => {
        let reset = 0;
        set((state) => {
          const rows = state.rowsByRun[runId];
          if (rows == null) return state;
          const nextRows = rows.map((row) => {
            // Only rows that failed AND carry no on-chain artifact are
            // eligible. Settled rows (submitted/queued/deposited) are never
            // touched — this is the double-pay guard.
            if (row.status === 'failed' && isPayrollRowSendable(row)) {
              reset += 1;
              return {
                ...row,
                status: 'ready' as PayrollRowStatus,
                validationError: null,
                updatedAt: Date.now(),
              };
            }
            return row;
          });
          return { rowsByRun: { ...state.rowsByRun, [runId]: nextRows } };
        });
        return reset;
      },

      reconcileInterruptedRows: (runId) => {
        let reconciled = 0;
        set((state) => {
          const rows = state.rowsByRun[runId];
          if (rows == null) return state;
          const nextRows = rows.map((row) => {
            const next = reconcileSendingRow(row);
            if (next !== row) reconciled += 1;
            return next;
          });
          if (reconciled === 0) return state;
          return { rowsByRun: { ...state.rowsByRun, [runId]: nextRows } };
        });
        return reconciled;
      },

      reconcileOrphanedRunsOnLaunch: () => {
        let demoted = 0;
        set((state) => {
          const runs = { ...state.runs };
          const rowsByRun = { ...state.rowsByRun };
          let changed = false;

          for (const run of Object.values(state.runs)) {
            if (run.status !== 'running' && run.status !== 'confirming') continue;

            // Reconcile any orphaned in-flight rows for this run first.
            const rows = state.rowsByRun[run.id];
            if (rows != null) {
              let rowChanged = false;
              const nextRows = rows.map((row) => {
                const next = reconcileSendingRow(row);
                if (next !== row) rowChanged = true;
                return next;
              });
              if (rowChanged) {
                rowsByRun[run.id] = nextRows;
                changed = true;
              }
            }

            // Demote the orphaned run to paused — nothing is executing it.
            runs[run.id] = { ...run, status: 'paused', updatedAt: Date.now() };
            demoted += 1;
            changed = true;
          }

          return changed ? { runs, rowsByRun } : state;
        });
        return demoted;
      },

      deleteRun: (runId) =>
        set((state) => {
          const runs = { ...state.runs };
          const rowsByRun = { ...state.rowsByRun };
          delete runs[runId];
          delete rowsByRun[runId];
          return { runs, rowsByRun };
        }),

      getRun: (runId) => get().runs[runId] ?? null,
      getRows: (runId) => get().rowsByRun[runId] ?? [],
    }),
    {
      name: 'offpay-payroll',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
