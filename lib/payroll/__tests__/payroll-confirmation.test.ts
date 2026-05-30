import {
  buildPayrollConfirmationSummary,
  isTypedConfirmationValid,
  resolvePayrollStartGate,
  PAYROLL_TYPED_CONFIRMATION_THRESHOLD,
} from '@/lib/payroll/payroll-confirmation';

import type { PayrollRouteSplit } from '@/lib/payroll/payroll-route-assignment';
import type { PayrollRow } from '@/lib/payroll/payroll-types';

function makeRow(id: string, status: PayrollRow['status'], amountAtomic = '1000000'): PayrollRow {
  const now = Date.now();
  return {
    id,
    sourceRow: 2,
    label: null,
    recipient: `rcpt-${id}`,
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    amountAtomic,
    amountDisplay: '1',
    route: 'umbra',
    status,
    requiresRecipientClaim: status === 'ready',
    validationError: null,
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: `${id}-key`,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

const SPLIT: PayrollRouteSplit = { umbra: 2, magicblock: 0, blocked: 0, claimRequired: 2 };

function buildSummary(rows: PayrollRow[], overrides: Partial<Parameters<typeof buildPayrollConfirmationSummary>[0]> = {}) {
  return buildPayrollConfirmationSummary({
    walletAddress: 'wallet-1',
    network: 'mainnet',
    tokenSymbol: 'USDC',
    tokenMint: 'mint-1',
    tokenDecimals: 6,
    rows,
    routePolicy: 'private_auto',
    split: SPLIT,
    requiresUmbraSetup: false,
    ...overrides,
  });
}

describe('buildPayrollConfirmationSummary', () => {
  it('totals only ready rows and counts invalid/skipped separately', () => {
    const summary = buildSummary([
      makeRow('a', 'ready', '1000000'),
      makeRow('b', 'ready', '2500000'),
      makeRow('c', 'invalid'),
      makeRow('d', 'skipped'),
    ]);

    expect(summary.recipientCount).toBe(2);
    expect(summary.totalAtomic).toBe('3500000');
    expect(summary.totalDisplay).toBe('3.5');
    expect(summary.invalidCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.claimRequiredCount).toBe(2);
  });

  it('requires typed confirmation at or above the threshold', () => {
    const rows = Array.from({ length: PAYROLL_TYPED_CONFIRMATION_THRESHOLD }, (_, index) =>
      makeRow(`r${index}`, 'ready'),
    );
    expect(buildSummary(rows).requiresTypedConfirmation).toBe(true);
  });

  it('does not require typed confirmation for small batches', () => {
    expect(buildSummary([makeRow('a', 'ready')]).requiresTypedConfirmation).toBe(false);
  });
});

describe('isTypedConfirmationValid', () => {
  const summary = buildSummary([
    makeRow('a', 'ready', '1000000'),
    makeRow('b', 'ready', '2000000'),
  ]);

  it('accepts the exact recipient count', () => {
    expect(isTypedConfirmationValid(summary, '2')).toBe(true);
  });

  it('accepts the displayed total ignoring commas/whitespace', () => {
    expect(isTypedConfirmationValid(summary, ' 3 ')).toBe(true);
  });

  it('rejects a mismatched value and empty input', () => {
    expect(isTypedConfirmationValid(summary, '99')).toBe(false);
    expect(isTypedConfirmationValid(summary, '')).toBe(false);
  });
});

describe('resolvePayrollStartGate', () => {
  const cleanSummary = buildSummary([makeRow('a', 'ready'), makeRow('b', 'ready')]);
  const blockedSummary = buildSummary([
    makeRow('a', 'ready'),
    makeRow('b', 'invalid'),
    makeRow('c', 'invalid'),
  ]);

  it('allows start for a clean run with no blocked rows', () => {
    const gate = resolvePayrollStartGate({
      summary: cleanSummary,
      typedConfirmationOk: true,
      blockedAcknowledged: false,
      busy: false,
    });
    expect(gate.canStart).toBe(true);
    expect(gate.needsBlockedAck).toBe(false);
  });

  it('blocks start when invalid rows exist until acknowledged', () => {
    const withoutAck = resolvePayrollStartGate({
      summary: blockedSummary,
      typedConfirmationOk: true,
      blockedAcknowledged: false,
      busy: false,
    });
    expect(withoutAck.needsBlockedAck).toBe(true);
    expect(withoutAck.canStart).toBe(false);

    const withAck = resolvePayrollStartGate({
      summary: blockedSummary,
      typedConfirmationOk: true,
      blockedAcknowledged: true,
      busy: false,
    });
    expect(withAck.canStart).toBe(true);
  });

  it('blocks start while Umbra setup is required', () => {
    const summary = { ...cleanSummary, requiresUmbraSetup: true };
    const gate = resolvePayrollStartGate({
      summary,
      typedConfirmationOk: true,
      blockedAcknowledged: false,
      busy: false,
    });
    expect(gate.canStart).toBe(false);
  });

  it('blocks start while busy, with no recipients, or with a failed typed confirmation', () => {
    expect(
      resolvePayrollStartGate({
        summary: cleanSummary,
        typedConfirmationOk: true,
        blockedAcknowledged: true,
        busy: true,
      }).canStart,
    ).toBe(false);

    expect(
      resolvePayrollStartGate({
        summary: buildSummary([makeRow('a', 'invalid')]),
        typedConfirmationOk: true,
        blockedAcknowledged: true,
        busy: false,
      }).canStart,
    ).toBe(false);

    const typedSummary = { ...cleanSummary, requiresTypedConfirmation: true };
    expect(
      resolvePayrollStartGate({
        summary: typedSummary,
        typedConfirmationOk: false,
        blockedAcknowledged: true,
        busy: false,
      }).canStart,
    ).toBe(false);
  });
});
