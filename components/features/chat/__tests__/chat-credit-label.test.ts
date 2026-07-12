import {
  buildCreditIndicator,
  formatCompactCreditResetLabel,
  formatCreditResetLabel,
} from '@/components/features/chat/chat-credit-label';

import type { AiChatCreditStatus } from '@/lib/agentic-payments/types';

const ONE_HOUR_MS = 60 * 60 * 1000;

function credits(overrides: Partial<AiChatCreditStatus> = {}): AiChatCreditStatus {
  return {
    kind: 'ai_chat_credits',
    limit: 10,
    used: 10,
    remaining: 0,
    resetAtMs: 1_000_000 + ONE_HOUR_MS,
    windowMs: ONE_HOUR_MS,
    subjectType: 'wallet',
    ...overrides,
  };
}

describe('chat credit reset labels', () => {
  it('does not round a one-hour reset window up to two hours', () => {
    const nowMs = 1_000_000;
    const resetAtMs = nowMs + ONE_HOUR_MS + 15_000;

    expect(formatCompactCreditResetLabel(resetAtMs, nowMs, ONE_HOUR_MS)).toBe('1h');
    expect(formatCreditResetLabel(resetAtMs, nowMs, ONE_HOUR_MS)).toBe('in 1h');
  });

  it('keeps minute labels after the reset moves under an hour', () => {
    const nowMs = 1_000_000;
    const resetAtMs = nowMs + 58 * 60_000 + 4_000;

    expect(formatCompactCreditResetLabel(resetAtMs, nowMs, ONE_HOUR_MS)).toBe('59m');
  });

  it('builds the exhausted credit label with the clamped reset window', () => {
    const nowMs = 1_000_000;
    const indicator = buildCreditIndicator(
      credits({ resetAtMs: nowMs + ONE_HOUR_MS + 2_000 }),
      false,
      null,
      nowMs,
    );

    expect(indicator).toMatchObject({
      label: '0/10',
      tone: 'empty',
      resetLabel: 'resets 1h',
    });
  });
});
