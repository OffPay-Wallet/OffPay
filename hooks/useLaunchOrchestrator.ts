import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { runOffpayLaunchSequence } from '@/lib/api/offpay-launch-orchestrator';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayLaunchStore } from '@/store/offpayLaunchStore';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayLaunchAdapters } from '@/lib/api/offpay-launch-orchestrator';

type LaunchRunResult = Awaited<ReturnType<typeof runOffpayLaunchSequence>>;

interface UseLaunchOrchestratorOptions {
  adapters?: OffpayLaunchAdapters;
  autoStart?: boolean;
}

export function useLaunchOrchestrator(options?: UseLaunchOrchestratorOptions) {
  const queryClient = useQueryClient();
  const { network, unsupportedReason } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const walletId = useWalletStore((state) => state.activeWalletId);
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletHydrated = useWalletStore((state) => state.isHydrated);
  // Subscribe only to the launch-state fields actually surfaced to
  // consumers. The previous full-store subscription re-rendered every
  // owner of this hook on each `setStep` call (one per launch stage).
  const launchState = useOffpayLaunchStore(
    useShallow((state) => ({
      status: state.status,
      runId: state.runId,
      currentStep: state.currentStep,
      intervention: state.intervention,
      error: state.error,
      pendingBackupCount: state.pendingBackupCount,
      recoveredBackupCount: state.recoveredBackupCount,
      walletDisplayHydratedAt: state.walletDisplayHydratedAt,
      portfolioPreloadedAt: state.portfolioPreloadedAt,
      steps: state.steps,
    })),
  );
  const latestLaunchRef = useRef(0);
  const adaptersRef = useRef(options?.adapters);
  const activeIdentityRef = useRef<string | null>(null);
  const inFlightLaunchRef = useRef<{
    identity: string;
    promise: Promise<LaunchRunResult>;
  } | null>(null);
  const readyIdentityRef = useRef<string | null>(null);
  const autoStart = options?.autoStart ?? true;

  useEffect(() => {
    adaptersRef.current = options?.adapters;
  }, [options?.adapters]);

  const identity = useMemo<string>(() => {
    if (!walletHydrated) return 'wallet-loading';
    return `${network ?? 'unsupported'}:${walletId ?? 'no-wallet'}:${
      walletAddress ?? 'no-address'
    }:${canUseNetwork ? 'online' : 'offline'}`;
  }, [canUseNetwork, network, walletAddress, walletHydrated, walletId]);

  useEffect(() => {
    activeIdentityRef.current = identity;
    if (readyIdentityRef.current !== identity) {
      readyIdentityRef.current = null;
    }
  }, [identity]);

  const runLaunch = useCallback(async () => {
    if (!walletHydrated) return null;
    if (!canUseNetwork) return null;
    if (
      readyIdentityRef.current === identity &&
      useOffpayLaunchStore.getState().status === 'ready'
    ) {
      return null;
    }
    if (inFlightLaunchRef.current?.identity === identity) {
      return inFlightLaunchRef.current.promise;
    }

    const runIdentity = identity;
    const launchPromise = (async () => {
      const runId = useOffpayLaunchStore.getState().startRun();
      latestLaunchRef.current = runId;
      const isCurrentRun = () =>
        latestLaunchRef.current === runId && activeIdentityRef.current === runIdentity;

      try {
        const result = await runOffpayLaunchSequence({
          queryClient,
          walletId,
          walletAddress,
          network,
          unsupportedNetworkReason: unsupportedReason,
          adapters: adaptersRef.current,
          onStep: (step, status, message) => {
            if (!isCurrentRun()) return;
            useOffpayLaunchStore.getState().setStep(step, status, message ?? null);
          },
        });

        if (!isCurrentRun()) return result;

        if (result.status === 'blocked') {
          useOffpayLaunchStore.getState().setBlocked({
            step: result.step,
            intervention: result.intervention,
            message: result.message,
          });
          readyIdentityRef.current = null;
          return result;
        }

        useOffpayLaunchStore.getState().setPendingBackupRecovery({
          pendingBackupCount: result.pendingBackupCount,
          recoveredBackupCount: result.recoveredBackupCount,
        });
        useOffpayLaunchStore
          .getState()
          .setPortfolioPreloaded(result.portfolioPreloaded ? Date.now() : null);
        useOffpayLaunchStore.getState().setReady();
        readyIdentityRef.current = runIdentity;
        return result;
      } catch (error: unknown) {
        readyIdentityRef.current = null;
        if (isCurrentRun()) {
          const failedStep = useOffpayLaunchStore.getState().currentStep ?? 'bootstrap';
          useOffpayLaunchStore
            .getState()
            .setError(failedStep, error instanceof Error ? error.message : 'Launch failed.');
        }
        throw error;
      }
    })();

    const trackedPromise = launchPromise.finally(() => {
      if (inFlightLaunchRef.current?.promise === trackedPromise) {
        inFlightLaunchRef.current = null;
      }
    });

    inFlightLaunchRef.current = {
      identity: runIdentity,
      promise: trackedPromise,
    };

    return trackedPromise;
  }, [
    network,
    queryClient,
    unsupportedReason,
    canUseNetwork,
    identity,
    walletAddress,
    walletHydrated,
    walletId,
  ]);

  useEffect(() => {
    if (!autoStart || !walletHydrated || !canUseNetwork) return;

    const scheduledLaunch = scheduleUiWorkAfterFirstPaint(
      () => {
        void runLaunch().catch(() => {
          // State is updated by runLaunch; screens can read useOffpayLaunchStore.
        });
      },
      {
        timeoutMs: 3500,
        fallbackDelayMs: 500,
      },
    );

    return () => {
      scheduledLaunch.cancel();
    };
  }, [autoStart, canUseNetwork, identity, runLaunch, walletHydrated]);

  return {
    ...launchState,
    runLaunch,
    walletHydrated,
  };
}
