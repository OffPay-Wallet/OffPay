import { create } from 'zustand';

import type { AiChatCreditStatus } from '@/lib/agentic-payments/types';

interface AiChatCreditsState {
  scopeKey: string | null;
  credits: AiChatCreditStatus | null;
  loading: boolean;
  error: string | null;
  setCredits: (credits: AiChatCreditStatus, scopeKey?: string | null) => void;
  setLoading: (loading: boolean, scopeKey?: string | null) => void;
  setError: (error: string | null, scopeKey?: string | null) => void;
  clear: (scopeKey?: string | null) => void;
}

export const useAiChatCreditsStore = create<AiChatCreditsState>()((set) => ({
  scopeKey: null,
  credits: null,
  loading: false,
  error: null,
  setCredits: (credits, scopeKey) =>
    set((state) => ({
      scopeKey: scopeKey === undefined ? state.scopeKey : scopeKey,
      credits: normalizeCredits(credits),
      loading: false,
      error: null,
    })),
  setLoading: (loading, scopeKey) =>
    set((state) => {
      if (scopeKey === undefined || state.scopeKey === scopeKey) {
        return { loading };
      }

      return {
        scopeKey,
        credits: null,
        loading,
        error: null,
      };
    }),
  setError: (error, scopeKey) =>
    set((state) => ({
      scopeKey: scopeKey === undefined ? state.scopeKey : scopeKey,
      error,
      loading: false,
    })),
  clear: (scopeKey) =>
    set((state) => {
      if (scopeKey != null && state.scopeKey !== scopeKey) return {};

      return {
        scopeKey: null,
        credits: null,
        loading: false,
        error: null,
      };
    }),
}));

function normalizeCredits(credits: AiChatCreditStatus): AiChatCreditStatus {
  const limit = positiveInt(credits.limit, 5);
  const used = Math.max(0, Math.min(positiveInt(credits.used, 0), limit));
  const remaining = Math.max(0, Math.min(positiveInt(credits.remaining, limit - used), limit));
  const windowMs = positiveInt(credits.windowMs, 60 * 60 * 1000);
  const resetAtMs = positiveInt(credits.resetAtMs, Date.now() + windowMs);

  return {
    kind: 'ai_chat_credits',
    limit,
    used,
    remaining,
    resetAtMs,
    windowMs,
    subjectType: credits.subjectType === 'wallet' ? 'wallet' : 'fallback',
    ...(credits.retryAfterMs == null
      ? {}
      : {
          retryAfterMs: positiveInt(credits.retryAfterMs, Math.max(1_000, resetAtMs - Date.now())),
        }),
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
