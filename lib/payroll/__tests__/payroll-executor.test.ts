import { runPayrollBatch, type PayrollExecutorHooks } from '@/lib/payroll/payroll-executor';

import type { PayrollRoute, PayrollRow } from '@/lib/payroll/payroll-types';

function makeRow(id: string, route: PayrollRoute | null, overrides: Partial<PayrollRow> = {}): PayrollRow {
  const now = Date.now();
  return {
    id,
    sourceRow: 2,
    label: null,
    recipient: `recipient-${id}`,
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    amountAtomic: '1000000',
    amountDisplay: '1',
    route,
    status: 'ready',
    requiresRecipientClaim: false,
    validationError: null,
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: `${id}-key`,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Test harness that mutates a local row map exactly like the store would,
 * so assertions can read final row state.
 */
function makeHarness(rows: PayrollRow[]) {
  const map = new Map(rows.map((row) => [row.id, { ...row }]));
  let cursor = 0;
  const submitCalls: string[] = [];
  const hooks: PayrollExecutorHooks = {
    submitRow: async () => {
      throw new Error('override submitRow per test');
    },
    onRowUpdate: (rowId, patch) => {
      const current = map.get(rowId);
      if (current != null) map.set(rowId, { ...current, ...patch });
    },
    onCursorAdvance: (next) => {
      cursor = next;
    },
  };
  return {
    hooks,
    submitCalls,
    rows: () => Array.from(map.values()),
    row: (id: string) => map.get(id)!,
    cursor: () => cursor,
  };
}

describe('runPayrollBatch', () => {
  it('executes rows sequentially and records MagicBlock submitted/queued', async () => {
    const rows = [makeRow('a', 'magicblock'), makeRow('b', 'magicblock')];
    const harness = makeHarness(rows);
    harness.hooks.submitRow = async ({ row }) => {
      harness.submitCalls.push(row.id);
      return row.id === 'a'
        ? { status: 'submitted', signature: 'sig-a' }
        : { status: 'queued', txId: 'tx-b' };
    };

    const summary = await runPayrollBatch({ rows, hooks: harness.hooks });

    expect(harness.submitCalls).toEqual(['a', 'b']);
    expect(summary.submitted).toBe(1);
    expect(summary.queued).toBe(1);
    expect(harness.row('a')).toMatchObject({ status: 'submitted', signature: 'sig-a' });
    expect(harness.row('b')).toMatchObject({ status: 'queued', txId: 'tx-b' });
  });

  it('records Umbra success as deposited_unclaimed with requiresRecipientClaim', async () => {
    const rows = [makeRow('u', 'umbra')];
    const harness = makeHarness(rows);
    harness.hooks.submitRow = async () => ({ status: 'deposited_unclaimed', signature: 'dep-sig' });

    const summary = await runPayrollBatch({ rows, hooks: harness.hooks });

    expect(summary.depositedUnclaimed).toBe(1);
    expect(harness.row('u')).toMatchObject({
      status: 'deposited_unclaimed',
      signature: 'dep-sig',
      requiresRecipientClaim: true,
    });
  });

  it('marks a row failed and continues the batch', async () => {
    const rows = [makeRow('a', 'magicblock'), makeRow('b', 'magicblock')];
    const harness = makeHarness(rows);
    harness.hooks.submitRow = async ({ row }) => {
      if (row.id === 'a') throw new Error('RPC timeout');
      return { status: 'submitted', signature: 'sig-b' };
    };

    const summary = await runPayrollBatch({ rows, hooks: harness.hooks });

    expect(summary.failed).toBe(1);
    expect(summary.submitted).toBe(1);
    expect(harness.row('a')).toMatchObject({ status: 'failed', retryCount: 1 });
    expect(harness.row('b').status).toBe('submitted');
  });

  it('never re-sends a row that already carries a signature', async () => {
    const rows = [makeRow('a', 'magicblock', { status: 'failed', signature: 'already' })];
    const harness = makeHarness(rows);
    const submit = jest.fn();
    harness.hooks.submitRow = submit;

    await runPayrollBatch({ rows, hooks: harness.hooks });

    expect(submit).not.toHaveBeenCalled();
  });

  it('does not auto-resend a failed row on a plain resume (only ready rows send)', async () => {
    const rows = [
      makeRow('a', 'magicblock', { status: 'failed' }), // no artifact, but still failed
      makeRow('b', 'magicblock', { status: 'ready' }),
    ];
    const harness = makeHarness(rows);
    const sent: string[] = [];
    harness.hooks.submitRow = async ({ row }) => {
      sent.push(row.id);
      return { status: 'submitted', signature: `sig-${row.id}` };
    };

    const summary = await runPayrollBatch({ rows, hooks: harness.hooks });

    // The failed row is skipped; only the ready row is sent.
    expect(sent).toEqual(['b']);
    expect(summary.submitted).toBe(1);
    expect(harness.row('a').status).toBe('failed');
  });

  it('stops after the current row when aborted and points the cursor at the pending row', async () => {
    const rows = [makeRow('a', 'magicblock'), makeRow('b', 'magicblock'), makeRow('c', 'magicblock')];
    const harness = makeHarness(rows);
    const controller = new AbortController();
    harness.hooks.submitRow = async ({ row }) => {
      if (row.id === 'b') controller.abort();
      return { status: 'submitted', signature: `sig-${row.id}` };
    };

    const summary = await runPayrollBatch({
      rows,
      hooks: harness.hooks,
      signal: controller.signal,
    });

    expect(summary.submitted).toBe(2);
    expect(summary.interrupted).toBe(true);
    expect(summary.nextCursor).toBe(2); // row 'c' pending
    expect(harness.row('c').status).toBe('ready');
  });

  it('resumes from startIndex without touching earlier rows', async () => {
    const rows = [
      makeRow('a', 'magicblock', { status: 'submitted', signature: 'done' }),
      makeRow('b', 'magicblock'),
    ];
    const harness = makeHarness(rows);
    const submit = jest.fn(async () => ({ status: 'submitted' as const, signature: 'sig-b' }));
    harness.hooks.submitRow = submit;

    const summary = await runPayrollBatch({ rows, hooks: harness.hooks, startIndex: 1 });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(summary.submitted).toBe(1);
    expect(harness.row('a').signature).toBe('done');
  });
});
