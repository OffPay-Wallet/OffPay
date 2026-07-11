import type { SwapExecuteResponse, SwapQuoteResponse } from '@/types/offpay-api';

export type NormalSwapExecutionGateResult =
  | {
      kind: 'executed';
      execution: SwapExecuteResponse;
      quote: SwapQuoteResponse;
      refreshedQuote: boolean;
    }
  | { kind: 'needs_confirmation'; quote: SwapQuoteResponse };

export async function executeNormalSwapWithReviewGate(params: {
  quote: SwapQuoteResponse;
  refreshedQuote: boolean;
  refreshOnly?: boolean;
  executeQuote: (quote: SwapQuoteResponse) => Promise<SwapExecuteResponse>;
  fetchFreshQuote: (quote: SwapQuoteResponse) => Promise<SwapQuoteResponse>;
  shouldRefresh: (error: unknown) => boolean;
}): Promise<NormalSwapExecutionGateResult> {
  if (params.refreshOnly === true) {
    return { kind: 'needs_confirmation', quote: await params.fetchFreshQuote(params.quote) };
  }

  try {
    return {
      kind: 'executed',
      execution: await params.executeQuote(params.quote),
      quote: params.quote,
      refreshedQuote: params.refreshedQuote,
    };
  } catch (error) {
    if (!params.shouldRefresh(error)) throw error;
    return { kind: 'needs_confirmation', quote: await params.fetchFreshQuote(params.quote) };
  }
}

export function resolveSwapExecutionAmounts(params: {
  execution: SwapExecuteResponse;
  quote: SwapQuoteResponse;
}): { inputRawAmount: string; outputRawAmount: string } {
  return {
    inputRawAmount:
      params.execution.totalInputAmount ??
      params.execution.inputAmountResult ??
      params.quote.inAmount,
    outputRawAmount:
      params.execution.totalOutputAmount ??
      params.execution.outputAmountResult ??
      params.quote.outAmount,
  };
}
