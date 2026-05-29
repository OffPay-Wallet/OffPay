import { useCallback, useMemo, useReducer } from 'react';

import type { ProcessResultDetailRow, ProcessResultTokenLeg, ProcessResultVariant } from '@/components/ui/ProcessResultScreen';

/**
 * Input-identity state slice for `app/(tabs)/swap.tsx`.
 *
 * Background:
 *   The swap screen previously held seven `useState` calls for closely
 *   coupled state (input mints, input amount, last result, action error,
 *   action refreshable, process result) plus a broad `useEffect` that
 *   reset five of them on every `payAmount`, `payTokenMint`, or
 *   `receiveTokenMint` change. The effect fired on every keystroke
 *   because `payAmount` updated character-by-character, queuing five
 *   re-renders per keystroke and triggering quote/price queries to
 *   evaluate their `enabled` flags multiple times per change.
 *
 *   This reducer collapses those scattered setters into a small set of
 *   intent-named actions. Each user-driven action that changes input
 *   identity (`setUserAmount`, `setPayToken`, `setReceiveToken`, `flip`)
 *   atomically clears the stale post-execution state in one render
 *   instead of five.
 *
 *   `normalizeAmount` exists as a separate action specifically because
 *   the old broad reset effect would clear action state every time the
 *   amount text was normalized internally (e.g. trimming trailing zeros
 *   after the user finished typing). That clear was incidental, not
 *   intentional. With the reducer, internal sanitization keeps action
 *   state intact.
 *
 * Slice boundary:
 *   In:  payTokenMint, receiveTokenMint, payAmount, lastSwapResult,
 *        swapActionErrorLabel, swapActionRefreshable, processResult
 *   Out: debouncedPayAmount (separate effect), reviewSwap,
 *        privateReviewSwap, sliderResetNonce, quoteClock, privateSwapMode,
 *        tabDataReady, all *Query results.
 *
 *   Review/private-review state is interaction state, not input identity,
 *   and stays in the screen component. The slider reset nonce is a
 *   pure UI ratchet.
 */

/**
 * Outcome of an `executeSwapMutation`. Lives here because the slice
 * needs to clear it on input change. Other shape is screen-internal.
 */
export interface SwapExecutionResult {
  signature: string;
  refreshedQuote: boolean;
}

/**
 * Process-result screen state shown after a completed or failed swap.
 * Co-located with the slice so input-change actions can clear it
 * atomically.
 */
export interface SwapProcessResultState {
  variant: ProcessResultVariant;
  title: string;
  message: string;
  statusLabel: string;
  tokenLegs: ProcessResultTokenLeg[];
  detailRows: ProcessResultDetailRow[];
}

export interface SwapInputState {
  payTokenMint: string | null;
  receiveTokenMint: string | null;
  payAmount: string;
  lastSwapResult: SwapExecutionResult | null;
  swapActionErrorLabel: string | null;
  swapActionRefreshable: boolean;
  processResult: SwapProcessResultState | null;
}

export type SwapInputAction =
  /** User-driven amount change. Clears stale post-execution state. */
  | { type: 'setUserAmount'; amount: string }
  /**
   * Internal amount normalization (e.g. trimming trailing zeros after
   * user finishes typing). Updates `payAmount` only — does NOT clear
   * action/result state, because the user did not change their intent.
   */
  | { type: 'normalizeAmount'; amount: string }
  /** User picked a different pay token. Clears stale post-execution state. */
  | { type: 'setPayToken'; mint: string | null }
  /** User picked a different receive token. Clears stale post-execution state. */
  | { type: 'setReceiveToken'; mint: string | null }
  /**
   * User tapped the swap-direction button. Sets both mints atomically
   * and optionally seeds the pay amount from the previous receive
   * amount. Clears stale post-execution state.
   */
  | {
      type: 'flip';
      payMint: string | null;
      receiveMint: string | null;
      nextAmount?: string;
    }
  /** Manual clear of action error label + refreshable flag. */
  | { type: 'clearActionState' }
  /** Set the action error label and refreshable flag. */
  | { type: 'setActionError'; label: string | null; refreshable: boolean }
  /** Persist the most recent swap execution outcome. */
  | { type: 'setLastSwapResult'; result: SwapExecutionResult | null }
  /** Show or clear the post-swap process-result screen. */
  | { type: 'setProcessResult'; result: SwapProcessResultState | null };

const INPUT_CHANGE_CLEARS = {
  lastSwapResult: null,
  swapActionErrorLabel: null,
  swapActionRefreshable: false,
  processResult: null,
} as const;

export const initialSwapInputState: SwapInputState = {
  payTokenMint: null,
  receiveTokenMint: null,
  payAmount: '',
  lastSwapResult: null,
  swapActionErrorLabel: null,
  swapActionRefreshable: false,
  processResult: null,
};

export function swapInputReducer(
  state: SwapInputState,
  action: SwapInputAction,
): SwapInputState {
  switch (action.type) {
    case 'setUserAmount':
      // No-op short-circuit: typing the same character twice (Android
      // IME quirk) shouldn't churn the post-execution state.
      if (action.amount === state.payAmount) return state;
      return {
        ...state,
        payAmount: action.amount,
        ...INPUT_CHANGE_CLEARS,
      };

    case 'normalizeAmount':
      if (action.amount === state.payAmount) return state;
      return { ...state, payAmount: action.amount };

    case 'setPayToken':
      if (action.mint === state.payTokenMint) return state;
      return {
        ...state,
        payTokenMint: action.mint,
        ...INPUT_CHANGE_CLEARS,
      };

    case 'setReceiveToken':
      if (action.mint === state.receiveTokenMint) return state;
      return {
        ...state,
        receiveTokenMint: action.mint,
        ...INPUT_CHANGE_CLEARS,
      };

    case 'flip':
      return {
        ...state,
        payTokenMint: action.payMint,
        receiveTokenMint: action.receiveMint,
        payAmount: action.nextAmount ?? state.payAmount,
        ...INPUT_CHANGE_CLEARS,
      };

    case 'clearActionState':
      if (state.swapActionErrorLabel == null && !state.swapActionRefreshable) {
        return state;
      }
      return {
        ...state,
        swapActionErrorLabel: null,
        swapActionRefreshable: false,
      };

    case 'setActionError':
      if (
        state.swapActionErrorLabel === action.label &&
        state.swapActionRefreshable === action.refreshable
      ) {
        return state;
      }
      return {
        ...state,
        swapActionErrorLabel: action.label,
        swapActionRefreshable: action.refreshable,
      };

    case 'setLastSwapResult':
      if (state.lastSwapResult === action.result) return state;
      return { ...state, lastSwapResult: action.result };

    case 'setProcessResult':
      if (state.processResult === action.result) return state;
      return { ...state, processResult: action.result };
  }
}

export interface SwapInputActions {
  setUserAmount: (amount: string) => void;
  normalizeAmount: (amount: string) => void;
  setPayToken: (mint: string | null) => void;
  setReceiveToken: (mint: string | null) => void;
  flip: (params: {
    payMint: string | null;
    receiveMint: string | null;
    nextAmount?: string;
  }) => void;
  clearActionState: () => void;
  setActionError: (params: { label: string | null; refreshable: boolean }) => void;
  setLastSwapResult: (result: SwapExecutionResult | null) => void;
  setProcessResult: (result: SwapProcessResultState | null) => void;
}

export function useSwapInputState(): [SwapInputState, SwapInputActions] {
  const [state, dispatch] = useReducer(swapInputReducer, initialSwapInputState);

  // Each individual callback uses an empty dep array so it has a
  // stable identity. Wrap them in `useMemo` to keep the *actions
  // object* identity stable too — consumers list `swapInputActions`
  // in their effect deps and we don't want a fresh object every
  // render to retrigger those effects.
  const setUserAmount = useCallback((amount: string) => {
    dispatch({ type: 'setUserAmount', amount });
  }, []);
  const normalizeAmount = useCallback((amount: string) => {
    dispatch({ type: 'normalizeAmount', amount });
  }, []);
  const setPayToken = useCallback((mint: string | null) => {
    dispatch({ type: 'setPayToken', mint });
  }, []);
  const setReceiveToken = useCallback((mint: string | null) => {
    dispatch({ type: 'setReceiveToken', mint });
  }, []);
  const flip = useCallback(
    (params: { payMint: string | null; receiveMint: string | null; nextAmount?: string }) => {
      dispatch({
        type: 'flip',
        payMint: params.payMint,
        receiveMint: params.receiveMint,
        nextAmount: params.nextAmount,
      });
    },
    [],
  );
  const clearActionState = useCallback(() => {
    dispatch({ type: 'clearActionState' });
  }, []);
  const setActionError = useCallback((params: { label: string | null; refreshable: boolean }) => {
    dispatch({
      type: 'setActionError',
      label: params.label,
      refreshable: params.refreshable,
    });
  }, []);
  const setLastSwapResult = useCallback((result: SwapExecutionResult | null) => {
    dispatch({ type: 'setLastSwapResult', result });
  }, []);
  const setProcessResult = useCallback((result: SwapProcessResultState | null) => {
    dispatch({ type: 'setProcessResult', result });
  }, []);

  const actions = useMemo<SwapInputActions>(
    () => ({
      setUserAmount,
      normalizeAmount,
      setPayToken,
      setReceiveToken,
      flip,
      clearActionState,
      setActionError,
      setLastSwapResult,
      setProcessResult,
    }),
    [
      setUserAmount,
      normalizeAmount,
      setPayToken,
      setReceiveToken,
      flip,
      clearActionState,
      setActionError,
      setLastSwapResult,
      setProcessResult,
    ],
  );

  return [state, actions];
}
