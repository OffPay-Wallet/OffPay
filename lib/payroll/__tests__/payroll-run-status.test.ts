import {
  resolveCompletedRunStatus,
  resolveInterruptedRunStatus,
} from '@/lib/payroll/payroll-run-status';

import type { PayrollRow, PayrollRowStatus } from '@/lib/payroll/payroll-types';

function makeRow(status: PayrollRowStatus, overrides: Partial<PayrollRow> = {}): PayrollRow {
  const now = Date.now();
  return {
    id: `row-${Math.random()}`,
    sourceRow: 2,
    label: null,
    recipient: 'rcpt',
    tokenMint: 'mint',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    amountAtomic: '1000000',
    amountDisplay: '1',
    route: 'magicblock',
    status,
    requiresRecipientClaim: false,
    validationError: null,
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: 'key',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('resolveCompletedRunStatus', () => {
  it('reports completed when every row settled cleanly', () => {
    expect(
      resolveCompletedRunStatus([
        makeRow('submitted', { signature: 's' }),
        makeRow('queued', { txId: 't' }),
      ]),
    ).toBe('completed');
  });

  it('reports claims pending when an Umbra deposit awaits claim', () => {
    expect(
      resolveCompletedRunStatus([
        makeRow('submitted', { signature: 's' }),
        makeRow('deposited_unclaimed', { signature: 'd', requiresRecipientClaim: true }),
      ]),
    ).toBe('completed_with_claims_pending');
  });

  it('reports completed_with_errors when a row failed', () => {
    expect(
      resolveCompletedRunStatus([makeRow('submitted', { signature: 's' }), makeRow('failed')]),
    ).toBe('completed_with_errors');
  });

  it('reports completed_with_errors when rows were blocked or skipped', () => {
    expect(
      resolveCompletedRunStatus([
        makeRow('submitted', { signature: 's' }),
        makeRow('invalid', { validationError: 'No private route is ready for this recipient.' }),
      ]),
    ).toBe('completed_with_errors');

    expect(
      resolveCompletedRunStatus([makeRow('submitted', { signature: 's' }), makeRow('skipped')]),
    ).toBe('completed_with_errors');
  });

  it('treats a lingering sending row as pending (never reports complete)', () => {
    expect(
      resolveCompletedRunStatus([makeRow('submitted', { signature: 's' }), makeRow('sending')]),
    ).toBe('paused');
  });

  it('treats a ready row as pending', () => {
    expect(resolveCompletedRunStatus([makeRow('ready')])).toBe('paused');
  });
});

describe('resolveInterruptedRunStatus', () => {
  it('returns cancelled when cancel was requested', () => {
    expect(resolveInterruptedRunStatus(true)).toBe('cancelled');
  });

  it('returns paused for a plain interruption', () => {
    expect(resolveInterruptedRunStatus(false)).toBe('paused');
  });
});
