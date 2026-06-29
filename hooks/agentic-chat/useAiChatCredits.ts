import { useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  fetchAgentChatCredits,
  isAgenticPaymentsProxyConfigured,
} from '@/lib/agentic-payments/ai-proxy-client';
import { useAiChatCreditsStore } from '@/store/aiChatCreditsStore';

import type { AiChatCreditStatus } from '@/lib/agentic-payments/types';

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

const AI_CHAT_CREDITS_ACTIVE_SYNC_MS = 60_000;

let inFlightCreditsFetch: {
  scopeKey: string;
  promise: Promise<AiChatCreditStatus>;
} | null = null;

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

    const delayMs = Math.max(0, credits.resetAtMs - Date.now() + 250);
    const timeout = setTimeout(() => {
      void refresh();
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [credits, refresh]);

  return {
    credits,
    loading,
    error,
    refresh,
  };
}

export function useAiChatCreditsBackgroundSync(scopeKey: string | null): void {
  const credits = useAiChatCreditsStore((state) =>
    scopeKey != null && state.scopeKey === scopeKey ? state.credits : null,
  );

  useEffect(() => {
    if (scopeKey == null || !isAgenticPaymentsProxyConfigured()) return undefined;

    let interval: ReturnType<typeof setInterval> | null = null;
    let active = isAppStateActive(AppState.currentState);

    const clearSyncInterval = () => {
      if (interval == null) return;
      clearInterval(interval);
      interval = null;
    };

    const refresh = () => {
      if (!active) return;
      void prefetchAiChatCredits(scopeKey).catch(() => undefined);
    };

    const startActiveSync = () => {
      clearSyncInterval();
      refresh();
      interval = setInterval(refresh, AI_CHAT_CREDITS_ACTIVE_SYNC_MS);
    };

    if (active) {
      startActiveSync();
    }

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      active = isAppStateActive(nextState);
      if (active) {
        startActiveSync();
      } else {
        clearSyncInterval();
      }
    });

    return () => {
      subscription.remove();
      clearSyncInterval();
    };
  }, [scopeKey]);

  useEffect(() => {
    if (scopeKey == null || credits == null || credits.used <= 0) return undefined;

    const delayMs = Math.max(0, credits.resetAtMs - Date.now() + 250);
    const timeout = setTimeout(() => {
      if (isAppStateActive(AppState.currentState)) {
        void prefetchAiChatCredits(scopeKey).catch(() => undefined);
      }
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [credits, scopeKey]);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

function isAppStateActive(state: AppStateStatus): boolean {
  return state === 'active';
}
