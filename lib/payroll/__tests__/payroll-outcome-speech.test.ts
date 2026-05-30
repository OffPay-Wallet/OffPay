import {
  payrollRunOutcomeSpeech,
  shouldSpeakPayrollRunOutcome,
} from '@/lib/payroll/payroll-copy';
import { canUseCloudTtsForText } from '@/lib/agentic-payments/voice-privacy';

import type { PayrollRunStatus } from '@/lib/payroll/payroll-types';

describe('payrollRunOutcomeSpeech', () => {
  it('produces a phrase for each terminal status', () => {
    expect(payrollRunOutcomeSpeech('completed')).toMatch(/completed/i);
    expect(payrollRunOutcomeSpeech('completed_with_claims_pending')).toMatch(/claim/i);
    expect(payrollRunOutcomeSpeech('completed_with_errors')).toMatch(/failed|skipped/i);
    expect(payrollRunOutcomeSpeech('paused')).toMatch(/paused/i);
    expect(payrollRunOutcomeSpeech('cancelled')).toMatch(/cancelled/i);
    expect(payrollRunOutcomeSpeech('failed')).toMatch(/failed/i);
  });

  it('returns null for non-terminal statuses', () => {
    const nonTerminal: PayrollRunStatus[] = ['draft', 'validating', 'ready', 'confirming', 'running'];
    for (const status of nonTerminal) {
      expect(payrollRunOutcomeSpeech(status)).toBeNull();
    }
  });

  it('only emits phrases safe for payroll-mode cloud TTS (no amounts/addresses)', () => {
    const terminal: PayrollRunStatus[] = [
      'completed',
      'completed_with_claims_pending',
      'completed_with_errors',
      'paused',
      'cancelled',
      'failed',
    ];
    for (const status of terminal) {
      const phrase = payrollRunOutcomeSpeech(status);
      expect(phrase).not.toBeNull();
      // Every spoken payroll outcome must pass the strict payroll TTS gate.
      expect(canUseCloudTtsForText(phrase as string, { payrollMode: true })).toBe(true);
    }
  });

  it('speaks only fresh transitions out of live execution', () => {
    expect(shouldSpeakPayrollRunOutcome(null, 'completed')).toBe(false);
    expect(shouldSpeakPayrollRunOutcome('paused', 'completed')).toBe(false);
    expect(shouldSpeakPayrollRunOutcome('running', 'completed')).toBe(true);
    expect(shouldSpeakPayrollRunOutcome('confirming', 'completed_with_errors')).toBe(true);
    expect(shouldSpeakPayrollRunOutcome('running', 'ready')).toBe(false);
  });
});
