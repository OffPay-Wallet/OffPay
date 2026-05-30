/**
 * Short, sanitized spoken outcomes for a single agentic send. Outcome-only —
 * never includes the amount, token, recipient, or signature, so it is safe
 * for cloud TTS. Used by `useAgenticConfirmSend` to speak the result.
 */

export type AgenticSendSpeechOutcome = 'submitted' | 'queued' | 'failed';

export function agenticSendOutcomeSpeech(
  outcome: AgenticSendSpeechOutcome,
  route: 'normal' | 'magicblock',
): string {
  switch (outcome) {
    case 'submitted':
      return route === 'normal' ? 'Payment submitted.' : 'Private payment submitted.';
    case 'queued':
      return 'Payment queued.';
    case 'failed':
      return 'Payment failed.';
  }
}
