import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a `() => AbortSignal` factory that produces a fresh signal
 * tied to the current screen focus. The signal aborts at the moment
 * the screen blurs (start of a back transition or a tab swap) and
 * again on unmount. A new signal is minted on every focus.
 *
 * Use this for imperative async work started in response to a user
 * gesture on the screen — pull-to-refresh, button-driven refetches,
 * mutation-triggered cache invalidations. Pass the signal to any
 * `lib/offpay-api-client` / `services/*` function that accepts one,
 * and the request is cancelled at the network layer the moment the
 * user navigates away.
 *
 * For React Query `queryFn` work, pass through the `signal` argument
 * the runtime provides — that signal is already lifecycle-managed by
 * React Query (cancels on unmount or query removal). This hook covers
 * the gap for *imperative* work outside of `queryFn`.
 *
 * Returning a factory (rather than the `AbortSignal` itself) ensures
 * each consumer gets a fresh signal per use, so a single screen-focus
 * lifetime can issue multiple parallel cancellable requests.
 *
 * Usage:
 * ```ts
 * const getScreenSignal = useScreenAbortSignal();
 *
 * const handleRefresh = useCallback(async () => {
 *   const signal = getScreenSignal();
 *   await balanceQuery.refetch({ signal }).catch(() => undefined);
 * }, [balanceQuery, getScreenSignal]);
 * ```
 */
export function useScreenAbortSignal(): () => AbortSignal {
  const controllerRef = useRef<AbortController | null>(null);

  const cancelActive = useCallback((reason: unknown) => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    if (controller != null && !controller.signal.aborted) {
      try {
        controller.abort(reason);
      } catch {
        // Older RN polyfills throw if abort is called with a reason;
        // fall back to the no-arg form.
        try {
          controller.abort();
        } catch {
          /* swallow */
        }
      }
    }
  }, []);

  // Cancel on screen blur — fires the moment the user starts a back
  // transition or swaps tabs. The next focus mints a fresh controller.
  useFocusEffect(
    useCallback(
      () => () => {
        cancelActive(new Error('Screen blurred'));
      },
      [cancelActive],
    ),
  );

  // Cancel on unmount as a defensive net so any focus-less unmount
  // (e.g. parent stack reset) still aborts pending work.
  useEffect(
    () => () => {
      cancelActive(new Error('Screen unmounted'));
    },
    [cancelActive],
  );

  return useCallback(() => {
    let controller = controllerRef.current;
    if (controller == null || controller.signal.aborted) {
      controller = new AbortController();
      controllerRef.current = controller;
    }
    return controller.signal;
  }, []);
}
