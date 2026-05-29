import {
  initialSwapInputState,
  swapInputReducer,
  type SwapExecutionResult,
  type SwapProcessResultState,
} from '@/hooks/useSwapInputState';

const SAMPLE_RESULT: SwapExecutionResult = {
  signature: 'SIG123',
  refreshedQuote: false,
};

const SAMPLE_PROCESS: SwapProcessResultState = {
  variant: 'success',
  title: 'Done',
  message: 'ok',
  statusLabel: 'Done',
  tokenLegs: [],
  detailRows: [],
};

const POPULATED_STATE = {
  ...initialSwapInputState,
  payTokenMint: 'PAY',
  receiveTokenMint: 'RECV',
  payAmount: '1.5',
  lastSwapResult: SAMPLE_RESULT,
  swapActionErrorLabel: 'Quote rejected',
  swapActionRefreshable: true,
  processResult: SAMPLE_PROCESS,
};

describe('swapInputReducer', () => {
  describe('setUserAmount', () => {
    it('updates payAmount and clears post-execution state', () => {
      const next = swapInputReducer(POPULATED_STATE, { type: 'setUserAmount', amount: '2' });
      expect(next.payAmount).toBe('2');
      expect(next.lastSwapResult).toBeNull();
      expect(next.swapActionErrorLabel).toBeNull();
      expect(next.swapActionRefreshable).toBe(false);
      expect(next.processResult).toBeNull();
      // Token identity is preserved.
      expect(next.payTokenMint).toBe('PAY');
      expect(next.receiveTokenMint).toBe('RECV');
    });

    it('returns the same reference when the amount is unchanged', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'setUserAmount',
        amount: POPULATED_STATE.payAmount,
      });
      expect(next).toBe(POPULATED_STATE);
    });
  });

  describe('normalizeAmount', () => {
    it('updates payAmount WITHOUT clearing post-execution state', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'normalizeAmount',
        amount: '1.50',
      });
      expect(next.payAmount).toBe('1.50');
      // Post-execution state survives an internal normalization. This
      // is the deliberate behavior change vs the old broad reset
      // effect.
      expect(next.lastSwapResult).toBe(SAMPLE_RESULT);
      expect(next.swapActionErrorLabel).toBe('Quote rejected');
      expect(next.swapActionRefreshable).toBe(true);
      expect(next.processResult).toBe(SAMPLE_PROCESS);
    });

    it('returns the same reference when the amount is unchanged', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'normalizeAmount',
        amount: POPULATED_STATE.payAmount,
      });
      expect(next).toBe(POPULATED_STATE);
    });
  });

  describe('setPayToken', () => {
    it('updates payTokenMint and clears post-execution state', () => {
      const next = swapInputReducer(POPULATED_STATE, { type: 'setPayToken', mint: 'NEW' });
      expect(next.payTokenMint).toBe('NEW');
      expect(next.lastSwapResult).toBeNull();
      expect(next.swapActionErrorLabel).toBeNull();
      expect(next.swapActionRefreshable).toBe(false);
      expect(next.processResult).toBeNull();
      // payAmount + receiveTokenMint preserved.
      expect(next.payAmount).toBe('1.5');
      expect(next.receiveTokenMint).toBe('RECV');
    });

    it('returns the same reference when the mint is unchanged', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'setPayToken',
        mint: POPULATED_STATE.payTokenMint,
      });
      expect(next).toBe(POPULATED_STATE);
    });
  });

  describe('setReceiveToken', () => {
    it('updates receiveTokenMint and clears post-execution state', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'setReceiveToken',
        mint: 'NEW',
      });
      expect(next.receiveTokenMint).toBe('NEW');
      expect(next.lastSwapResult).toBeNull();
      expect(next.processResult).toBeNull();
      expect(next.payTokenMint).toBe('PAY');
    });

    it('returns the same reference when the mint is unchanged', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'setReceiveToken',
        mint: POPULATED_STATE.receiveTokenMint,
      });
      expect(next).toBe(POPULATED_STATE);
    });
  });

  describe('flip', () => {
    it('swaps both mints atomically and clears post-execution state', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'flip',
        payMint: 'RECV',
        receiveMint: 'PAY',
      });
      expect(next.payTokenMint).toBe('RECV');
      expect(next.receiveTokenMint).toBe('PAY');
      expect(next.payAmount).toBe('1.5');
      expect(next.lastSwapResult).toBeNull();
      expect(next.swapActionErrorLabel).toBeNull();
      expect(next.processResult).toBeNull();
    });

    it('seeds the next amount when provided', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'flip',
        payMint: 'RECV',
        receiveMint: 'PAY',
        nextAmount: '0.75',
      });
      expect(next.payAmount).toBe('0.75');
    });
  });

  describe('clearActionState', () => {
    it('clears action label and refreshable flag', () => {
      const next = swapInputReducer(POPULATED_STATE, { type: 'clearActionState' });
      expect(next.swapActionErrorLabel).toBeNull();
      expect(next.swapActionRefreshable).toBe(false);
      // Other state preserved.
      expect(next.lastSwapResult).toBe(SAMPLE_RESULT);
      expect(next.processResult).toBe(SAMPLE_PROCESS);
      expect(next.payAmount).toBe('1.5');
    });

    it('returns the same reference when already cleared', () => {
      const next = swapInputReducer(initialSwapInputState, { type: 'clearActionState' });
      expect(next).toBe(initialSwapInputState);
    });
  });

  describe('setActionError', () => {
    it('updates label and refreshable together', () => {
      const next = swapInputReducer(initialSwapInputState, {
        type: 'setActionError',
        label: 'Failed',
        refreshable: true,
      });
      expect(next.swapActionErrorLabel).toBe('Failed');
      expect(next.swapActionRefreshable).toBe(true);
    });

    it('returns the same reference when label and refreshable both match', () => {
      const next = swapInputReducer(POPULATED_STATE, {
        type: 'setActionError',
        label: POPULATED_STATE.swapActionErrorLabel,
        refreshable: POPULATED_STATE.swapActionRefreshable,
      });
      expect(next).toBe(POPULATED_STATE);
    });
  });

  describe('setLastSwapResult', () => {
    it('updates only lastSwapResult', () => {
      const next = swapInputReducer(initialSwapInputState, {
        type: 'setLastSwapResult',
        result: SAMPLE_RESULT,
      });
      expect(next.lastSwapResult).toBe(SAMPLE_RESULT);
      expect(next.swapActionErrorLabel).toBeNull();
      expect(next.processResult).toBeNull();
    });
  });

  describe('setProcessResult', () => {
    it('updates only processResult', () => {
      const next = swapInputReducer(initialSwapInputState, {
        type: 'setProcessResult',
        result: SAMPLE_PROCESS,
      });
      expect(next.processResult).toBe(SAMPLE_PROCESS);
      expect(next.lastSwapResult).toBeNull();
      expect(next.swapActionErrorLabel).toBeNull();
    });
  });
});
