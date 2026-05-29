import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppToast } from '@/components/ui/AppToast';

import type { SwapQuoteResponse } from '@/types/offpay-api';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * Centralized refresh controller for the swap quote query.
 *
 * Background:
 *   `app/(tabs)/swap.tsx` historically called `quoteQuery.refetch()` from six
 *   different places (manual slide-to-refresh, retry-after-error, expired
 *   quote on home, expired quote on review, expired quote on review-action,
 *   and an automatic recovery path inside `executeSwapMutation.onError`).
 *   Each site re-implemented its own toast, slider reset, and error-state
 *   clearing. There was no in-flight guard, no debounce, and the order of
 *   side effects drifted between callers.
 *
 *   This hook collapses the six call sites into three intents:
 *     - `refreshOnUserGesture('refresh' | 'retry')` for slide-to-refresh and
 *       retry-quote.
 *     - `refreshOnExpiry()` for expired quotes (home or review).
 *     - `refreshOnRecoverableError()` for the automatic onError recovery.
 *
 * Behavior:
 *   - In-flight dedupe: while `quoteQuery.isFetching` is true, every method
 *     returns immediately without scheduling another fetch. React Query
 *     would dedupe the actual network request anyway, but the duplicate
 *     refetch call still triggers extra renders and toasts.
 *   - User-gesture debounce: 300ms minimum gap between user-initiated
 *     refreshes. Auto recovery has no cooldown — those error paths are
 *     already gated by `shouldRefreshSwapExecution(error)` upstream and
 *     fire rarely.
 *   - Toast policy: user gestures show "Refreshing quote" or "Retrying
 *     quote" or "Quote expired" depending on intent. Auto recovery is
 *     silent.
 *   - Side-effect ordering: the controller invokes `resetReviewSlider` and
 *     `clearActionState` synchronously before kicking the refetch. Callers
 *     never need to remember the order.
 *
 * What this hook does NOT do:
 *   - Cancellation on input change. React Query's `signal` plumbing
 *     (wired in Task 3 via `useScreenAbortSignal`) handles that.
 *   - The auto-clear of `processResult` after a token/amount swap.
 *     That belongs to the input-identity slice (Task 11B).
 */

const USER_DEBOUNCE_MS = 300;

export type SwapQuoteRefreshLabel = 'refresh' | 'retry';

interface UseSwapQuoteControllerParams {
  quoteQuery: UseQueryResult<SwapQuoteResponse, unknown>;
  /** Reset the review slider to its initial position. */
  resetReviewSlider: () => void;
  /** Clear `swapActionErrorLabel` and `swapActionRefreshable`. */
  clearActionState: () => void;
}

export interface SwapQuoteController {
  /**
   * User-initiated slide-to-refresh after a quote error. Shows an info
   * toast keyed by `label` and clears action state before refetching.
   */
  refreshOnUserGesture: (label: SwapQuoteRefreshLabel) => void;

  /**
   * User slide on an expired quote (home or review screen). Shows a
   * warning toast and clears the review slider before refetching.
   */
  refreshOnExpiry: () => void;

  /**
   * Automatic recovery from a refreshable swap-execution error. No
   * toast, no slider reset, no action-state clear (the caller already
   * cleared the error label in its own onError handler).
   */
  refreshOnRecoverableError: () => void;

  /**
   * True while a refetch is either in flight or inside the user
   * debounce window. UI gates can use this to disable buttons without
   * sniffing `quoteQuery.isFetching` directly.
   */
  isBusy: boolean;
}

export function useSwapQuoteController(
  params: UseSwapQuoteControllerParams,
): SwapQuoteController {
  const { quoteQuery, resetReviewSlider, clearActionState } = params;
  const { showToast } = useAppToast();

  // `lastUserTriggerAtRef` tracks the wall-clock of the most recent
  // user gesture so we can debounce two rapid taps within 300ms. Auto
  // recovery deliberately bypasses this ref — those refetches are not
  // user-driven and should not be throttled by tap timing.
  const lastUserTriggerAtRef = useRef(0);
  // `inDebounceWindow` is the live render-visible companion to the
  // ref. We only need it for `isBusy`; the debounce decision itself
  // reads the ref because state writes are async.
  const [inDebounceWindow, setInDebounceWindow] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const armDebounceWindow = useCallback(() => {
    lastUserTriggerAtRef.current = Date.now();
    setInDebounceWindow(true);
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setInDebounceWindow(false);
    }, USER_DEBOUNCE_MS);
  }, []);

  const triggerRefetch = useCallback(() => {
    void quoteQuery.refetch();
  }, [quoteQuery]);

  const refreshOnUserGesture = useCallback(
    (label: SwapQuoteRefreshLabel) => {
      // In-flight dedupe: a second slide while a fetch is already
      // running is silently ignored. The first fetch will deliver
      // the latest data; firing again would just produce duplicate
      // toasts.
      if (quoteQuery.isFetching) return;
      if (Date.now() - lastUserTriggerAtRef.current < USER_DEBOUNCE_MS) return;

      armDebounceWindow();
      clearActionState();
      resetReviewSlider();
      showToast({
        title: label === 'refresh' ? 'Refreshing quote' : 'Retrying quote',
        message: 'Fetching a fresh swap quote.',
        variant: 'info',
        durationMs: 1600,
      });
      triggerRefetch();
    },
    [
      armDebounceWindow,
      clearActionState,
      quoteQuery.isFetching,
      resetReviewSlider,
      showToast,
      triggerRefetch,
    ],
  );

  const refreshOnExpiry = useCallback(() => {
    if (quoteQuery.isFetching) return;
    if (Date.now() - lastUserTriggerAtRef.current < USER_DEBOUNCE_MS) return;

    armDebounceWindow();
    resetReviewSlider();
    showToast({
      title: 'Quote expired',
      message: 'Fetching a fresh quote.',
      variant: 'warning',
    });
    triggerRefetch();
  }, [armDebounceWindow, quoteQuery.isFetching, resetReviewSlider, showToast, triggerRefetch]);

  const refreshOnRecoverableError = useCallback(() => {
    // No debounce: these auto-fires are already rare (gated upstream
    // by `shouldRefreshSwapExecution`). Dedupe still applies — if a
    // fetch is already in flight, we don't queue another.
    if (quoteQuery.isFetching) return;
    triggerRefetch();
  }, [quoteQuery.isFetching, triggerRefetch]);

  return {
    refreshOnUserGesture,
    refreshOnExpiry,
    refreshOnRecoverableError,
    isBusy: quoteQuery.isFetching || inDebounceWindow,
  };
}
