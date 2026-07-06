import type { AiChatCreditStatus } from '@/lib/agentic-payments/types';

export const AI_CREDITS_UNKNOWN_LABEL = '--/5';

export interface ChatCreditIndicator {
  label: string;
  tone: 'ready' | 'low' | 'empty' | 'loading' | 'error';
  resetLabel?: string | null;
}

export function buildCreditIndicator(
  credits: AiChatCreditStatus | null,
  loading: boolean,
  error: string | null,
  nowMs: number,
): ChatCreditIndicator | null {
  if (credits == null) {
    if (loading) {
      return { label: AI_CREDITS_UNKNOWN_LABEL, tone: 'loading' };
    }
    if (error != null) {
      return { label: AI_CREDITS_UNKNOWN_LABEL, tone: 'error' };
    }
    return null;
  }

  const remaining = credits.remaining;
  const tone: ChatCreditIndicator['tone'] =
    remaining <= 0 ? 'empty' : remaining <= 1 ? 'low' : 'ready';

  return {
    label: `${remaining}/${credits.limit}`,
    tone,
    resetLabel:
      remaining <= 0
        ? credits.resetAtMs <= nowMs && loading
          ? 'syncing reset'
          : `resets ${formatCompactCreditResetLabel(credits.resetAtMs, nowMs, credits.windowMs)}`
        : null,
  };
}

export function formatCreditResetLabel(
  resetAtMs: number,
  nowMs: number,
  windowMs?: number,
): string {
  const remainingMs = getCreditResetRemainingMs(resetAtMs, nowMs, windowMs);
  if (remainingMs <= 1_000) return 'now';

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (totalMinutes < 60) return `in ${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `in ${hours}h`;

  return `in ${hours}h ${minutes}m`;
}

export function formatCompactCreditResetLabel(
  resetAtMs: number,
  nowMs: number,
  windowMs?: number,
): string {
  return formatCreditResetLabel(resetAtMs, nowMs, windowMs).replace(/^in\s+/, '');
}

function getCreditResetRemainingMs(resetAtMs: number, nowMs: number, windowMs?: number): number {
  const rawRemainingMs = Math.max(0, resetAtMs - nowMs);
  if (windowMs == null || !Number.isFinite(windowMs) || windowMs <= 0) return rawRemainingMs;
  return Math.min(rawRemainingMs, windowMs);
}
