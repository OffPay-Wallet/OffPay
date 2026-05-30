import {
  findResumableRuns,
  isOrphanedRunningRun,
  runHasPendingRows,
} from '@/lib/payroll/payroll-resume';

import type { PayrollRow, PayrollRowStatus, PayrollRun, PayrollRunStatus } from '@/lib/payroll/payroll-types';

function makeRun(id: string, status: PayrollRunStatus, updatedAt = 1): PayrollRun {
  return {
    id,
    walletAddress: 'wallet-1',
    network: 'devnet',
    status,
    routePolicy: 'private_auto',
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    sourceName: 'payroll.csv',
    rowIds: [],
    cursor: 0,
    createdAt: 1,
    updatedAt,
  };
}

function makeRow(id: string, status: PayrollRowStatus, overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    id,
    sourceRow: 2,
    label: null,
    recipient: `rcpt-${id}`,
    tokenMint: 'mint-1',
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
    idempotencyKey: `${id}-key`,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('isOrphanedRunningRun', () => {
  it('flags running and confirming runs as orphaned', () => {
    expect(isOrphanedRunningRun(makeRun('a', 'running'))).toBe(true);
    expect(isOrphanedRunningRun(makeRun('a', 'confirming'))).toBe(true);
  });

  it('does not flag terminal or paused runs', () => {
    expect(isOrphanedRunningRun(makeRun('a', 'paused'))).toBe(false);
    expect(isOrphanedRunningRun(makeRun('a', 'completed'))).toBe(false);
    expect(isOrphanedRunningRun(makeRun('a', 'completed_with_errors'))).toBe(false);
  });
});

describe('runHasPendingRows', () => {
  it('is true when a ready or sending row remains', () => {
    expect(runHasPendingRows([makeRow('a', 'ready')])).toBe(true);
    expect(runHasPendingRows([makeRow('a', 'sending')])).toBe(true);
  });

  it('is false when every row is settled, failed-with-artifact, or invalid', () => {
    expect(
      runHasPendingRows([
        makeRow('a', 'submitted', { signature: 's' }),
        makeRow('b', 'deposited_unclaimed', { signature: 'd' }),
        makeRow('c', 'invalid'),
      ]),
    ).toBe(false);
  });
});

describe('findResumableRuns', () => {
  it('returns paused runs with pending rows, newest first', () => {
    const runs = {
      old: makeRun('old', 'paused', 1),
      fresh: makeRun('fresh', 'paused', 2),
      done: makeRun('done', 'completed', 3),
    };
    const rowsByRun = {
      old: [makeRow('a', 'ready')],
      fresh: [makeRow('b', 'ready'), makeRow('c', 'submitted', { signature: 's' })],
      done: [makeRow('d', 'submitted', { signature: 's' })],
    };

    const resumable = findResumableRuns(runs, rowsByRun);

    expect(resumable.map((entry) => entry.runId)).toEqual(['fresh', 'old']);
    expect(resumable[0]).toMatchObject({ runId: 'fresh', pendingCount: 1, settledCount: 1 });
  });

  it('excludes paused runs with no pending rows', () => {
    const runs = { a: makeRun('a', 'paused') };
    const rowsByRun = { a: [makeRow('x', 'submitted', { signature: 's' })] };
    expect(findResumableRuns(runs, rowsByRun)).toEqual([]);
  });

  it('includes orphaned running runs that still have pending rows', () => {
    const runs = { a: makeRun('a', 'running') };
    const rowsByRun = { a: [makeRow('x', 'ready')] };
    expect(findResumableRuns(runs, rowsByRun).map((r) => r.runId)).toEqual(['a']);
  });
});
