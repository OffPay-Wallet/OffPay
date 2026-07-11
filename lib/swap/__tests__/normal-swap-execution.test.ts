import {
  executeNormalSwapWithReviewGate,
  resolveSwapExecutionAmounts,
} from '@/lib/swap/normal-swap-execution';

import type { SwapExecuteResponse, SwapQuoteResponse } from '@/types/offpay-api';

const quote = (id: string, outAmount = '1000000'): SwapQuoteResponse => ({
  quoteId: id,
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inAmount: '1000000000',
  outAmount,
  minimumOutputAmount: '990000',
  slippageBps: 100,
  slippageMode: 'manual',
  priceImpactPct: 0.1,
  fee: '0',
  routeSummary: 'Metis',
  expiresAt: Date.now() + 60_000,
  unsignedTransaction: `unsigned-${id}`,
});

const execution = (overrides: Partial<SwapExecuteResponse> = {}): SwapExecuteResponse => ({
  signature: 'signature-1',
  code: 0,
  inputAmountResult: null,
  outputAmountResult: null,
  totalInputAmount: null,
  totalOutputAmount: null,
  ...overrides,
});

describe('normal swap refreshed-review gate', () => {
  it('returns a fresh quote for confirmation without executing the fresh transaction', async () => {
    const original = quote('original');
    const fresh = quote('fresh', '1100000');
    const executeQuote = jest.fn().mockRejectedValueOnce(new Error('quote expired'));
    const fetchFreshQuote = jest.fn().mockResolvedValue(fresh);

    await expect(
      executeNormalSwapWithReviewGate({
        quote: original,
        refreshedQuote: false,
        executeQuote,
        fetchFreshQuote,
        shouldRefresh: () => true,
      }),
    ).resolves.toEqual({ kind: 'needs_confirmation', quote: fresh });

    expect(executeQuote).toHaveBeenCalledTimes(1);
    expect(executeQuote).toHaveBeenCalledWith(original);
    expect(executeQuote).not.toHaveBeenCalledWith(fresh);
  });

  it('refreshes an expired review without attempting any signature or execution', async () => {
    const original = quote('expired');
    const fresh = quote('fresh');
    const executeQuote = jest.fn();

    await expect(
      executeNormalSwapWithReviewGate({
        quote: original,
        refreshedQuote: true,
        refreshOnly: true,
        executeQuote,
        fetchFreshQuote: async () => fresh,
        shouldRefresh: () => true,
      }),
    ).resolves.toEqual({ kind: 'needs_confirmation', quote: fresh });
    expect(executeQuote).not.toHaveBeenCalled();
  });

  it('prefers provider totals, then leg results, then quote amounts for receipts', () => {
    expect(
      resolveSwapExecutionAmounts({
        quote: quote('amounts'),
        execution: execution({
          inputAmountResult: '900',
          outputAmountResult: '800',
          totalInputAmount: '700',
          totalOutputAmount: '600',
        }),
      }),
    ).toEqual({ inputRawAmount: '700', outputRawAmount: '600' });

    expect(
      resolveSwapExecutionAmounts({
        quote: quote('fallback', '444'),
        execution: execution({ inputAmountResult: '333', outputAmountResult: null }),
      }),
    ).toEqual({ inputRawAmount: '333', outputRawAmount: '444' });
  });
});
