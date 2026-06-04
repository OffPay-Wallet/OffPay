/**
 * Tracks tab navigation history so screens can navigate "back"
 * to the previously visited tab (not just the initial route).
 *
 * Tab navigators in expo-router don't maintain a back stack,
 * so we track it manually here.
 */
import { create } from 'zustand';

import type { Href } from 'expo-router';

/**
 * Static map of every known tab route to its expo-router `Href`.
 *
 * The dynamic `` `/(tabs)/${name}` `` template-literal pattern that
 * historically lived in each screen's back handler couldn't be proven
 * by TypeScript, which forced an `as never` / `as any` cast at every
 * `router.navigate` call site. Keeping the full mapping here lets
 * each screen look up a `Href`-typed value without casting.
 *
 * Add new tabs here when they're added under `app/(tabs)/`. The
 * `TabRouteName` union below is derived from the keys of this map,
 * so a missing entry produces a compile-time error at every consumer.
 */
export const TAB_ROUTE_HREFS = {
  index: '/(tabs)',
  chat: '/(tabs)/chat',
  history: '/(tabs)/history',
  rwas: '/(tabs)/rwas',
  scanner: '/(tabs)/scanner',
  settings: '/(tabs)/settings',
  shopping: '/(tabs)/shopping',
  swap: '/(tabs)/swap',
} as const satisfies Record<string, Href>;

/** Names of tabs that may be recorded in the history store. */
export type TabRouteName = keyof typeof TAB_ROUTE_HREFS;

/**
 * Type guard for narrowing arbitrary route name strings (e.g. from a
 * navigator's `state.routes[].name`) into the constrained
 * `TabRouteName` union before they reach the store. Unknown names
 * are dropped at the boundary, which means consumers never need to
 * defend against a route name the back handler can't navigate to.
 */
export function isTabRouteName(name: string): name is TabRouteName {
  return Object.prototype.hasOwnProperty.call(TAB_ROUTE_HREFS, name);
}

interface TabHistoryState {
  /** Whether at least one tab switch has been recorded */
  hasHistory: boolean;
  /** The previously active tab index */
  previousIndex: number;
  /** The previously active tab route name */
  previousRoute: TabRouteName;
  /** Update the history when switching tabs */
  recordTabSwitch: (fromIndex: number, fromRoute: TabRouteName) => void;
}

export const useTabHistoryStore = create<TabHistoryState>((set) => ({
  hasHistory: false,
  previousIndex: 0,
  previousRoute: 'index',
  recordTabSwitch: (fromIndex, fromRoute) =>
    set({ hasHistory: true, previousIndex: fromIndex, previousRoute: fromRoute }),
}));
