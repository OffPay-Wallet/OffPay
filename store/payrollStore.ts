import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import { getPayrollSubmissionAttemptId, isPayrollRowSendable } from '@/lib/payroll/payroll-types';

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
  /** Atomically claims a ready row before any external submission begins. */
  claimRowSubmission: (
    runId: string,
    rowId: string,
    claim: { attemptId: string; startedAt: number },
  ) => boolean;
  /**
   * Toggles a row between `skipped` and `ready`. Only ready/skipped rows are
   * eligible — settled or invalid rows are not affected, preserving the
   * double-pay and validation guarantees. Returns true when a change applied.
   */
  setRowSkipped: (runId: string, rowId: string, skipped: boolean) => boolean;
  /** Resets only failures that occurred before any submission attempt. */
  prepareRetryFailedRows: (runId: string) => number;
  /**
   * Recovers rows orphaned in `sending` by a crash/kill. They carry no
   * on-chain artifact, so their fate is unknown. We persist/recover a durable
   * attempt tombstone and mark them reconciliation-only rather than blindly
   * re-sending. Returns the count reconciled.
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

function hasDurablePaymentEvidence(row: PayrollRow): boolean {
  return (
    row.signature != null ||
    row.txId != null ||
    row.initSignature != null ||
    (row.submissionAttemptId != null && row.submissionAttemptId.trim().length > 0) ||
    row.reconciliationRequired === true
  );
}

/** Never let a row replacement erase evidence that makes re-submission unsafe. */
function preserveDurablePaymentEvidence(
  existing: PayrollRow | undefined,
  replacement: PayrollRow,
): PayrollRow {
  if (existing == null || !hasDurablePaymentEvidence(existing)) return replacement;

  return {
    ...replacement,
    status: existing.status,
    requiresRecipientClaim: existing.requiresRecipientClaim,
    validationError: existing.validationError,
    signature: existing.signature ?? replacement.signature,
    txId: existing.txId ?? replacement.txId,
    initSignature: existing.initSignature ?? replacement.initSignature,
    idempotencyKey: existing.idempotencyKey,
    submissionAttemptId: existing.submissionAttemptId ?? replacement.submissionAttemptId,
    submissionStartedAt: existing.submissionStartedAt ?? replacement.submissionStartedAt,
    reconciliationRequired:
      existing.reconciliationRequired === true ? true : replacement.reconciliationRequired,
    retryCount: Math.max(existing.retryCount, replacement.retryCount),
    updatedAt: Math.max(existing.updatedAt, replacement.updatedAt),
  };
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
  const fallbackAttemptId = `payroll:${row.idempotencyKey.trim() || row.id}`;
  return {
    ...row,
    status: 'failed',
    submissionAttemptId: row.submissionAttemptId?.trim() || fallbackAttemptId,
    submissionStartedAt: row.submissionStartedAt ?? row.updatedAt,
    reconciliationRequired: true,
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
          const existingRows = new Map((state.rowsByRun[run.id] ?? []).map((row) => [row.id, row]));
          const protectedRows = rows.map((row) =>
            preserveDurablePaymentEvidence(existingRows.get(row.id), row),
          );
          const runs = pruneRuns({ ...state.runs, [run.id]: run });
          const rowsByRun = { ...state.rowsByRun, [run.id]: protectedRows };
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
          const existingRows = new Map((state.rowsByRun[runId] ?? []).map((row) => [row.id, row]));
          const protectedRows = rows.map((row) =>
            preserveDurablePaymentEvidence(existingRows.get(row.id), row),
          );
          return {
            rowsByRun: { ...state.rowsByRun, [runId]: protectedRows },
            runs: {
              ...state.runs,
              [runId]: touchRun({
                ...run,
                rowIds: protectedRows.map((row) => row.id),
                routesDirty: true,
              }),
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
          const nextRows = rows.map((row) => {
            if (row.id !== rowId) return row;
            const next = { ...row, ...patch, updatedAt: Date.now() };
            // Generic UI/store updates may add evidence, but may never erase
            // an existing tombstone or on-chain artifact.
            if (row.submissionAttemptId != null && row.submissionAttemptId.trim().length > 0) {
              next.submissionAttemptId = row.submissionAttemptId;
              next.submissionStartedAt = row.submissionStartedAt;
            }
            if (row.reconciliationRequired === true) next.reconciliationRequired = true;
            if (row.signature != null) next.signature = row.signature;
            if (row.txId != null) next.txId = row.txId;
            if (row.initSignature != null) next.initSignature = row.initSignature;
            return next;
          });
          return { rowsByRun: { ...state.rowsByRun, [runId]: nextRows } };
        }),

      claimRowSubmission: (runId, rowId, claim) => {
        let claimed = false;
        set((state) => {
          const rows = state.rowsByRun[runId];
          if (rows == null || !Number.isSafeInteger(claim.startedAt) || claim.startedAt <= 0) {
            return state;
          }

          const nextRows = rows.map((row) => {
            if (row.id !== rowId) return row;
            if (
              row.route == null ||
              row.status !== 'ready' ||
              !isPayrollRowSendable(row) ||
              claim.attemptId !== getPayrollSubmissionAttemptId(row.idempotencyKey)
            ) {
              return row;
            }

            claimed = true;
            return {
              ...row,
              status: 'sending' as PayrollRowStatus,
              submissionAttemptId: claim.attemptId,
              submissionStartedAt: claim.startedAt,
              reconciliationRequired: false,
              validationError: null,
              updatedAt: Date.now(),
            };
          });
          return claimed ? { rowsByRun: { ...state.rowsByRun, [runId]: nextRows } } : state;
        });
        return claimed;
      },

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
            // Only pre-submission failures are eligible. Any durable attempt
            // tombstone or on-chain artifact makes the row reconciliation-only.
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
