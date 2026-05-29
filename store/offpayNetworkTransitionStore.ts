import { create } from 'zustand';

import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';

import type { ScheduledUiWork } from '@/lib/perf/ui-work-scheduler';

interface NetworkAccessSuspensionOptions {
  timeoutMs?: number;
  fallbackDelayMs?: number;
}

interface BeginNetworkSwitchResult {
  /**
   * Snapshot of `transitionVersion` taken at the moment the switch started.
   * Pass this back to `finishNetworkSwitch` so a stale finish call from an
   * older switch cycle (e.g. user did mainnet→devnet→mainnet quickly) can
   * be ignored without flipping `isNetworkSwitching` back to `false`
   * before the latest switch finishes.
   */
  epoch: number;
}

interface OffpayNetworkTransitionState {
  /**
   * Short-lived flag that pauses background read-only network work
   * during a switch. Lifts after the next paint so dependent queries
   * can begin reloading new-network data.
   */
  networkAccessSuspended: boolean;
  /**
   * Longer-lived UX flag for action buttons (swap, send, advanced swap).
   * True from `beginNetworkSwitch` until the matching
   * `finishNetworkSwitch(epoch)` lands. Read by action buttons; NOT
   * read by background data queries — those use `networkAccessSuspended`
   * which is shorter, so balances/capabilities resume quickly.
   */
  isNetworkSwitching: boolean;
  /**
   * Monotonically increasing epoch incremented on every switch start
   * and on `clearNetworkAccessSuspension`. Used by:
   *  - `useOffpayCapabilities` to detect cross-network identity changes.
   *  - The internal suspension scheduler to drop stale clears.
   *  - `finishNetworkSwitch(epoch)` callers to enforce latest-switch-wins.
   */
  transitionVersion: number;
  suspendNetworkAccess: (options?: NetworkAccessSuspensionOptions) => void;
  clearNetworkAccessSuspension: () => void;
  /**
   * Begin a network switch lifecycle. Sets `isNetworkSwitching` and
   * `networkAccessSuspended` to true, increments `transitionVersion`,
   * and schedules a paint-frame-bounded clear of `networkAccessSuspended`.
   * Returns the new epoch — pass it to `finishNetworkSwitch` after the
   * caller has done its post-switch staging (typically a fixed timeout).
   */
  beginNetworkSwitch: (options?: NetworkAccessSuspensionOptions) => BeginNetworkSwitchResult;
  /**
   * Conclude the switch lifecycle if (and only if) `epoch` still matches
   * the current `transitionVersion`. A stale finish (from an
   * already-superseded switch) is silently ignored so the in-flight
   * latest switch keeps `isNetworkSwitching` true until its own finish
   * fires.
   */
  finishNetworkSwitch: (epoch: number) => void;
}

let suspensionTask: ScheduledUiWork | null = null;
let suspensionToken = 0;

export const useOffpayNetworkTransitionStore = create<OffpayNetworkTransitionState>()((set) => ({
  networkAccessSuspended: false,
  isNetworkSwitching: false,
  transitionVersion: 0,

  suspendNetworkAccess: (options) => {
    suspensionTask?.cancel();
    const token = suspensionToken + 1;
    suspensionToken = token;
    let nextEpoch = 0;
    set((state) => {
      nextEpoch = state.transitionVersion + 1;
      return {
        networkAccessSuspended: true,
        transitionVersion: nextEpoch,
      };
    });

    suspensionTask = scheduleUiWorkAfterFirstPaint(() => {
      if (suspensionToken !== token) return;
      suspensionTask = null;
      // Epoch guard: only release if the suspension we scheduled is
      // still the latest one. A subsequent switch may have superseded
      // this clear; in that case we let the newer task own the
      // release.
      set((state) =>
        state.transitionVersion === nextEpoch
          ? { networkAccessSuspended: false }
          : state,
      );
    }, options);
  },

  clearNetworkAccessSuspension: () => {
    suspensionTask?.cancel();
    suspensionTask = null;
    suspensionToken += 1;
    set((state) => ({
      networkAccessSuspended: false,
      isNetworkSwitching: false,
      transitionVersion: state.transitionVersion + 1,
    }));
  },

  beginNetworkSwitch: (options) => {
    suspensionTask?.cancel();
    const token = suspensionToken + 1;
    suspensionToken = token;
    let nextEpoch = 0;
    set((state) => {
      nextEpoch = state.transitionVersion + 1;
      return {
        networkAccessSuspended: true,
        isNetworkSwitching: true,
        transitionVersion: nextEpoch,
      };
    });

    suspensionTask = scheduleUiWorkAfterFirstPaint(() => {
      if (suspensionToken !== token) return;
      suspensionTask = null;
      set((state) =>
        state.transitionVersion === nextEpoch
          ? { networkAccessSuspended: false }
          : state,
      );
    }, options);

    return { epoch: nextEpoch };
  },

  finishNetworkSwitch: (epoch) => {
    set((state) =>
      state.transitionVersion === epoch && state.isNetworkSwitching
        ? { isNetworkSwitching: false }
        : state,
    );
  },
}));
