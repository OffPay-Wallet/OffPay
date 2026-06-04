import { usePayrollStore } from '@/store/payrollStore';

import type { PayrollRow, PayrollRun } from '@/lib/payroll/payroll-types';

function makeRun(overrides: Partial<PayrollRun> = {}): PayrollRun {
  const now = Date.now();
  return {
    id: 'run-1',
    walletAddress: 'wallet-1',
    network: 'devnet',
    status: 'draft',
    routePolicy: 'private_auto',
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    sourceName: 'payroll.csv',
    rowIds: ['run-1-row-2', 'run-1-row-3'],
    cursor: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRow(id: string, overrides: Partial<PayrollRow> = {}): PayrollRow {
  const now = Date.now();
  return {
    id,
    sourceRow: 2,
    label: 'Alice',
    recipient: 'recipient-1',
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    amountAtomic: '1000000',
    amountDisplay: '1',
    route: null,
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

describe('payrollStore', () => {
  beforeEach(() => {
    usePayrollStore.setState({ runs: {}, rowsByRun: {} });
  });

  it('creates a run with its rows and reads them back', () => {
    const run = makeRun();
    usePayrollStore.getState().createRun(run, [makeRow('run-1-row-2')]);

    expect(usePayrollStore.getState().getRun('run-1')?.status).toBe('draft');
    expect(usePayrollStore.getState().getRows('run-1')).toHaveLength(1);
  });

  it('transitions run status and row status independently', () => {
    usePayrollStore.getState().createRun(makeRun(), [makeRow('run-1-row-2')]);
    usePayrollStore.getState().setRunStatus('run-1', 'running');
    usePayrollStore.getState().updateRow('run-1', 'run-1-row-2', {
      status: 'submitted',
      signature: 'sig-1',
    });

    expect(usePayrollStore.getState().getRun('run-1')?.status).toBe('running');
    expect(usePayrollStore.getState().getRows('run-1')[0]).toMatchObject({
      status: 'submitted',
      signature: 'sig-1',
    });
  });

  it('retries only failed rows without an on-chain artifact', () => {
    usePayrollStore
      .getState()
      .createRun(makeRun(), [
        makeRow('run-1-row-2', { status: 'failed' }),
        makeRow('run-1-row-3', { status: 'failed', signature: 'already-sent' }),
        makeRow('run-1-row-4', { status: 'submitted', signature: 'sig' }),
      ]);

    const reset = usePayrollStore.getState().prepareRetryFailedRows('run-1');

    expect(reset).toBe(1);
    const rows = usePayrollStore.getState().getRows('run-1');
    expect(rows[0].status).toBe('ready');
    // Failed-but-already-sent row stays failed (double-pay guard).
    expect(rows[1].status).toBe('failed');
    // Settled row untouched.
    expect(rows[2].status).toBe('submitted');
  });

  it('does not resurrect deposited_unclaimed Umbra rows on retry', () => {
    usePayrollStore.getState().createRun(makeRun(), [
      makeRow('run-1-row-2', {
        status: 'deposited_unclaimed',
        signature: 'deposit-sig',
        requiresRecipientClaim: true,
      }),
    ]);

    const reset = usePayrollStore.getState().prepareRetryFailedRows('run-1');
    expect(reset).toBe(0);
    expect(usePayrollStore.getState().getRows('run-1')[0].status).toBe('deposited_unclaimed');
  });

  it('reconciles orphaned sending rows to failed-needs-verify', () => {
    usePayrollStore
      .getState()
      .createRun(makeRun(), [
        makeRow('run-1-row-2', { status: 'sending' }),
        makeRow('run-1-row-3', { status: 'sending', signature: 'broadcast-sig' }),
      ]);

    const reconciled = usePayrollStore.getState().reconcileInterruptedRows('run-1');

    expect(reconciled).toBe(1);
    const rows = usePayrollStore.getState().getRows('run-1');
    // No-artifact sending row -> failed with a verify message.
    expect(rows[0].status).toBe('failed');
    expect(rows[0].validationError).toMatch(/Verify on-chain/);
    // A sending row that already carries a signature is left as-is (it is a
    // settled artifact, never reverted).
    expect(rows[1].status).toBe('sending');
  });

  it('persists cursor for resume', () => {
    usePayrollStore.getState().createRun(makeRun(), [makeRow('run-1-row-2')]);
    usePayrollStore.getState().setRunCursor('run-1', 3);
    expect(usePayrollStore.getState().getRun('run-1')?.cursor).toBe(3);
  });

  it('updates the run token and marks routes dirty', () => {
    usePayrollStore.getState().createRun(makeRun(), [makeRow('run-1-row-2')]);

    usePayrollStore.getState().setRunToken('run-1', {
      mint: 'mint-2',
      symbol: 'USDT',
      decimals: 6,
    });

    expect(usePayrollStore.getState().getRun('run-1')).toMatchObject({
      tokenMint: 'mint-2',
      tokenSymbol: 'USDT',
      tokenDecimals: 6,
      routesDirty: true,
    });
  });

  it('keeps run row ids in sync when rows are replaced', () => {
    usePayrollStore
      .getState()
      .createRun(makeRun(), [makeRow('run-1-row-2'), makeRow('run-1-row-3')]);

    usePayrollStore
      .getState()
      .replaceRows('run-1', [makeRow('run-1-row-3'), makeRow('run-1-row-manual-1')]);

    expect(usePayrollStore.getState().getRun('run-1')).toMatchObject({
      rowIds: ['run-1-row-3', 'run-1-row-manual-1'],
      routesDirty: true,
    });
  });

  it('deletes a run and its rows', () => {
    usePayrollStore.getState().createRun(makeRun(), [makeRow('run-1-row-2')]);
    usePayrollStore.getState().deleteRun('run-1');
    expect(usePayrollStore.getState().getRun('run-1')).toBeNull();
    expect(usePayrollStore.getState().getRows('run-1')).toEqual([]);
  });

  it('demotes orphaned running runs to paused and reconciles their sending rows on launch', () => {
    usePayrollStore
      .getState()
      .createRun(makeRun({ status: 'running' }), [
        makeRow('run-1-row-2', { status: 'sending' }),
        makeRow('run-1-row-3', { status: 'submitted', signature: 'sig' }),
      ]);

    const demoted = usePayrollStore.getState().reconcileOrphanedRunsOnLaunch();

    expect(demoted).toBe(1);
    expect(usePayrollStore.getState().getRun('run-1')?.status).toBe('paused');
    const rows = usePayrollStore.getState().getRows('run-1');
    // Orphaned sending row -> failed; settled row untouched.
    expect(rows[0].status).toBe('failed');
    expect(rows[1].status).toBe('submitted');
  });

  it('leaves non-orphaned runs untouched on launch', () => {
    usePayrollStore
      .getState()
      .createRun(makeRun({ status: 'paused' }), [makeRow('run-1-row-2', { status: 'ready' })]);

    const demoted = usePayrollStore.getState().reconcileOrphanedRunsOnLaunch();

    expect(demoted).toBe(0);
    expect(usePayrollStore.getState().getRun('run-1')?.status).toBe('paused');
    expect(usePayrollStore.getState().getRows('run-1')[0].status).toBe('ready');
  });

  describe('setRowSkipped', () => {
    it('toggles a ready row to skipped and back', () => {
      usePayrollStore
        .getState()
        .createRun(makeRun(), [makeRow('run-1-row-2', { status: 'ready' })]);

      expect(usePayrollStore.getState().setRowSkipped('run-1', 'run-1-row-2', true)).toBe(true);
      expect(usePayrollStore.getState().getRows('run-1')[0].status).toBe('skipped');
      expect(usePayrollStore.getState().getRun('run-1')?.routesDirty).toBe(true);

      expect(usePayrollStore.getState().setRowSkipped('run-1', 'run-1-row-2', false)).toBe(true);
      expect(usePayrollStore.getState().getRows('run-1')[0].status).toBe('ready');
    });

    it('can clear the route-dirty marker after routes refresh', () => {
      usePayrollStore
        .getState()
        .createRun(makeRun(), [makeRow('run-1-row-2', { status: 'ready' })]);

      expect(usePayrollStore.getState().setRowSkipped('run-1', 'run-1-row-2', true)).toBe(true);
      expect(usePayrollStore.getState().getRun('run-1')?.routesDirty).toBe(true);

      usePayrollStore.getState().setRunRoutesDirty('run-1', false);
      expect(usePayrollStore.getState().getRun('run-1')?.routesDirty).toBe(false);
    });

    it('never skips settled or invalid rows', () => {
      usePayrollStore
        .getState()
        .createRun(makeRun(), [
          makeRow('run-1-row-2', { status: 'submitted', signature: 'sig' }),
          makeRow('run-1-row-3', { status: 'invalid', validationError: 'bad' }),
        ]);

      expect(usePayrollStore.getState().setRowSkipped('run-1', 'run-1-row-2', true)).toBe(false);
      expect(usePayrollStore.getState().setRowSkipped('run-1', 'run-1-row-3', true)).toBe(false);
      const rows = usePayrollStore.getState().getRows('run-1');
      expect(rows[0].status).toBe('submitted');
      expect(rows[1].status).toBe('invalid');
    });
  });
});
