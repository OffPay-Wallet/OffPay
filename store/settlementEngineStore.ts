import { create } from 'zustand';

export type SettlementEngineStatus = 'idle' | 'running' | 'backoff' | 'settled' | 'error';
export type SettlementEngineTrigger = 'launch' | 'network' | 'foreground' | 'retry' | 'manual' | 'queue';

interface SettlementEngineRunStats {
  queuedCount: number;
  uploadedCount: number;
  uploadFailedCount: number;
  submittedCount: number;
  confirmedCount: number;
  failedCount: number;
  deleteFailedCount: number;
}

interface SettlementEngineState extends SettlementEngineRunStats {
  status: SettlementEngineStatus;
  trigger: SettlementEngineTrigger | null;
  lastRunAt: number | null;
  nextRetryAt: number | null;
  requestedRunId: number;
  error: string | null;
  requestRun: () => void;
  setIdle: (stats?: Partial<SettlementEngineRunStats>) => void;
  setRunning: (trigger: SettlementEngineTrigger, queuedCount: number) => void;
  setResult: (stats: SettlementEngineRunStats) => void;
  setBackoff: (params: {
    trigger: SettlementEngineTrigger;
    error: string;
    nextRetryAt: number;
    stats?: Partial<SettlementEngineRunStats>;
  }) => void;
  setError: (trigger: SettlementEngineTrigger, error: string) => void;
  reset: () => void;
}

const EMPTY_STATS: SettlementEngineRunStats = {
  queuedCount: 0,
  uploadedCount: 0,
  uploadFailedCount: 0,
  submittedCount: 0,
  confirmedCount: 0,
  failedCount: 0,
  deleteFailedCount: 0,
};

export const useSettlementEngineStore = create<SettlementEngineState>()((set) => ({
  ...EMPTY_STATS,
  status: 'idle',
  trigger: null,
  lastRunAt: null,
  nextRetryAt: null,
  requestedRunId: 0,
  error: null,

  requestRun: () => set((state) => ({ requestedRunId: state.requestedRunId + 1 })),

  setIdle: (stats) =>
    set({
      ...EMPTY_STATS,
      ...stats,
      status: 'idle',
      trigger: null,
      nextRetryAt: null,
      error: null,
    }),

  setRunning: (trigger, queuedCount) =>
    set({
      status: 'running',
      trigger,
      queuedCount,
      nextRetryAt: null,
      error: null,
    }),

  setResult: (stats) =>
    set({
      ...stats,
      status: stats.failedCount > 0 || stats.deleteFailedCount > 0 ? 'error' : 'settled',
      trigger: null,
      lastRunAt: Date.now(),
      nextRetryAt: null,
      error:
        stats.failedCount > 0 || stats.deleteFailedCount > 0
          ? 'Some queued payments could not be finalized.'
          : null,
    }),

  setBackoff: ({ trigger, error, nextRetryAt, stats }) =>
    set({
      ...EMPTY_STATS,
      ...stats,
      status: 'backoff',
      trigger,
      nextRetryAt,
      error,
    }),

  setError: (trigger, error) =>
    set({
      status: 'error',
      trigger,
      lastRunAt: Date.now(),
      nextRetryAt: null,
      error,
    }),

  reset: () =>
    set({
      ...EMPTY_STATS,
      status: 'idle',
      trigger: null,
      lastRunAt: null,
      nextRetryAt: null,
      requestedRunId: 0,
      error: null,
    }),
}));
