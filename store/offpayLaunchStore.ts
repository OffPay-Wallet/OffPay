import { create } from 'zustand';

export type OffpayLaunchStep =
  | 'wallet'
  | 'bootstrap'
  | 'capabilities'
  | 'pendingBackups'
  | 'nonce'
  | 'settlement'
  | 'portfolio';

type OffpayLaunchStatus = 'idle' | 'running' | 'ready' | 'blocked' | 'error';
type OffpayLaunchStepStatus = 'idle' | 'running' | 'complete' | 'skipped' | 'blocked' | 'error';
type OffpayLaunchIntervention = 'create_or_import_wallet' | 'complete_nonce_setup';

interface OffpayLaunchStepState {
  status: OffpayLaunchStepStatus;
  message: string | null;
  updatedAt: number | null;
}

interface OffpayLaunchState {
  status: OffpayLaunchStatus;
  runId: number;
  currentStep: OffpayLaunchStep | null;
  intervention: OffpayLaunchIntervention | null;
  error: string | null;
  pendingBackupCount: number;
  recoveredBackupCount: number;
  walletDisplayHydratedAt: number | null;
  portfolioPreloadedAt: number | null;
  steps: Record<OffpayLaunchStep, OffpayLaunchStepState>;
  startRun: () => number;
  setStep: (step: OffpayLaunchStep, status: OffpayLaunchStepStatus, message?: string | null) => void;
  setPendingBackupRecovery: (params: { pendingBackupCount: number; recoveredBackupCount: number }) => void;
  setWalletDisplayHydrated: (timestamp: number | null) => void;
  setPortfolioPreloaded: (timestamp: number | null) => void;
  setBlocked: (params: {
    step: OffpayLaunchStep;
    intervention: OffpayLaunchIntervention | null;
    message: string;
  }) => void;
  setError: (step: OffpayLaunchStep, message: string) => void;
  setReady: () => void;
  reset: () => void;
}

const LAUNCH_STEPS: readonly OffpayLaunchStep[] = [
  'wallet',
  'bootstrap',
  'capabilities',
  'pendingBackups',
  'nonce',
  'settlement',
  'portfolio',
] as const;

function buildInitialSteps(): Record<OffpayLaunchStep, OffpayLaunchStepState> {
  return Object.fromEntries(
    LAUNCH_STEPS.map((step) => [
      step,
      {
        status: 'idle',
        message: null,
        updatedAt: null,
      } satisfies OffpayLaunchStepState,
    ]),
  ) as Record<OffpayLaunchStep, OffpayLaunchStepState>;
}

export const useOffpayLaunchStore = create<OffpayLaunchState>()((set, get) => ({
  status: 'idle',
  runId: 0,
  currentStep: null,
  intervention: null,
  error: null,
  pendingBackupCount: 0,
  recoveredBackupCount: 0,
  walletDisplayHydratedAt: null,
  portfolioPreloadedAt: null,
  steps: buildInitialSteps(),

  startRun: () => {
    const runId = get().runId + 1;
    set({
      status: 'running',
      runId,
      currentStep: null,
      intervention: null,
      error: null,
      pendingBackupCount: 0,
      recoveredBackupCount: 0,
      steps: buildInitialSteps(),
    });
    return runId;
  },

  setStep: (step, status, message = null) =>
    set((state) => ({
      currentStep: status === 'running' ? step : state.currentStep,
      steps: {
        ...state.steps,
        [step]: {
          status,
          message,
          updatedAt: Date.now(),
        },
      },
    })),

  setPendingBackupRecovery: ({ pendingBackupCount, recoveredBackupCount }) =>
    set({
      pendingBackupCount,
      recoveredBackupCount,
    }),

  setWalletDisplayHydrated: (timestamp) =>
    set({
      walletDisplayHydratedAt: timestamp,
    }),

  setPortfolioPreloaded: (timestamp) =>
    set({
      portfolioPreloadedAt: timestamp,
    }),

  setBlocked: ({ step, intervention, message }) =>
    set((state) => ({
      status: 'blocked',
      currentStep: step,
      intervention,
      error: null,
      steps: {
        ...state.steps,
        [step]: {
          status: 'blocked',
          message,
          updatedAt: Date.now(),
        },
      },
    })),

  setError: (step, message) =>
    set((state) => ({
      status: 'error',
      currentStep: step,
      intervention: null,
      error: message,
      steps: {
        ...state.steps,
        [step]: {
          status: 'error',
          message,
          updatedAt: Date.now(),
        },
      },
    })),

  setReady: () =>
    set({
      status: 'ready',
      currentStep: null,
      intervention: null,
      error: null,
    }),

  reset: () =>
    set({
      status: 'idle',
      runId: 0,
      currentStep: null,
      intervention: null,
      error: null,
      pendingBackupCount: 0,
      recoveredBackupCount: 0,
      walletDisplayHydratedAt: null,
      portfolioPreloadedAt: null,
      steps: buildInitialSteps(),
    }),
}));
