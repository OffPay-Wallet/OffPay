import { useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  fetchAgentChatCredits,
  isAgenticPaymentsProxyConfigured,
} from '@/lib/agentic-payments/ai-proxy-client';
import { useAiChatCreditsStore } from '@/store/aiChatCreditsStore';

import type { AiChatCreditStatus } from '@/lib/agentic-payments/types';

const CREDIT_RESET_REFRESH_SKEW_MS = 250;
const CREDIT_RESET_FALLBACK_RETRY_MS = 15_000;

interface PrefetchAiChatCreditsOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface UseAiChatCreditsResult {
  credits: AiChatCreditStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

let inFlightCreditsFetch: {
  scopeKey: string;
  promise: Promise<AiChatCreditStatus>;
} | null = null;

export function shouldRefreshAiChatCreditsFromBackend(
  credits: AiChatCreditStatus | null,
  nowMs = Date.now(),
): boolean {
  return credits != null && credits.used > 0 && credits.resetAtMs <= nowMs;
}

export async function prefetchAiChatCredits(
  scopeKey: string,
  options: PrefetchAiChatCreditsOptions = {},
): Promise<AiChatCreditStatus | null> {
  const normalizedScopeKey = scopeKey.trim();
  const store = useAiChatCreditsStore.getState();

  if (!isAgenticPaymentsProxyConfigured()) {
    store.clear();
    return null;
  }

  if (inFlightCreditsFetch?.scopeKey === normalizedScopeKey) {
    return inFlightCreditsFetch.promise;
  }

  useAiChatCreditsStore.getState().setLoading(true, normalizedScopeKey);

  const promise = fetchAgentChatCredits({
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    scopeKey: normalizedScopeKey,
  })
    .catch((error: unknown) => {
      if (!isAbortError(error)) {
        useAiChatCreditsStore
          .getState()
          .setError(
            error instanceof Error ? error.message : 'Yuga credits are unavailable.',
            normalizedScopeKey,
          );
      }
      throw error;
    })
    .finally(() => {
      if (inFlightCreditsFetch?.promise === promise) {
        inFlightCreditsFetch = null;
      }
    });

  inFlightCreditsFetch = { scopeKey: normalizedScopeKey, promise };
  return promise;
}

export function useAiChatCredits(scopeKey: string): UseAiChatCreditsResult {
  const credits = useAiChatCreditsStore((state) =>
    state.scopeKey === scopeKey ? state.credits : null,
  );
  const loading = useAiChatCreditsStore((state) =>
    state.scopeKey === scopeKey ? state.loading : false,
  );
  const error = useAiChatCreditsStore((state) =>
    state.scopeKey === scopeKey ? state.error : null,
  );
  const clear = useAiChatCreditsStore((state) => state.clear);

  const refresh = useCallback(async () => {
    if (!isAgenticPaymentsProxyConfigured()) {
      clear();
      return;
    }

    try {
      await prefetchAiChatCredits(scopeKey);
    } catch (error: unknown) {
      if (isAbortError(error)) return;
    }
  }, [clear, scopeKey]);

  useEffect(() => {
    if (!isAgenticPaymentsProxyConfigured()) {
      clear();
      return;
    }

    const controller = new AbortController();
    void prefetchAiChatCredits(scopeKey, { signal: controller.signal }).catch(() => undefined);

    return () => controller.abort('chat credits scope changed');
  }, [clear, scopeKey]);

  useEffect(() => {
    if (credits == null || credits.used <= 0) return;

    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clearScheduledRefresh = () => {
      if (timeout == null) return;
      clearTimeout(timeout);
      timeout = null;
    };

    const scheduleRefresh = (delayMs: number) => {
      clearScheduledRefresh();
      timeout = setTimeout(() => {
        void refreshAndRetryIfNeeded();
      }, delayMs);
    };

    const refreshAndRetryIfNeeded = async () => {
      if (disposed) return;

      await refresh();
      if (disposed) return;

      const current = useAiChatCreditsStore.getState();
      const currentCredits = current.scopeKey === scopeKey ? current.credits : null;
      if (shouldRefreshAiChatCreditsFromBackend(currentCredits)) {
        scheduleRefresh(CREDIT_RESET_FALLBACK_RETRY_MS);
      }
    };

    scheduleRefresh(Math.max(0, credits.resetAtMs - Date.now() + CREDIT_RESET_REFRESH_SKEW_MS));

    return () => {
      disposed = true;
      clearScheduledRefresh();
    };
  }, [credits, refresh, scopeKey]);

  useEffect(() => {
    if (credits == null || credits.used <= 0) return;

    const refreshIfBackendWindowElapsed = () => {
      const current = useAiChatCreditsStore.getState();
      const currentCredits = current.scopeKey === scopeKey ? current.credits : null;
      if (shouldRefreshAiChatCreditsFromBackend(currentCredits)) {
        void refresh();
      }
    };

    refreshIfBackendWindowElapsed();

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        refreshIfBackendWindowElapsed();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [credits, refresh, scopeKey]);

  return {
    credits,
    loading,
    error,
    refresh,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}
