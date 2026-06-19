import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { usePreferencesStore } from '@/store/preferencesStore';

const OFFLINE_NETWORK_ERROR_NAME = 'OfflineNetworkBlockedError';

type FetchLike = typeof fetch;

let fetchGuardInstalled = false;
let originalFetch: FetchLike | null = null;
let preferencesUnsubscribe: (() => void) | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let lastReachableOnline = true;
let focusRestoreTimer: ReturnType<typeof setTimeout> | null = null;

const FOCUS_RESTORE_DELAY_MS = 500;

export class OfflineNetworkBlockedError extends Error {
  constructor(message = 'Offline mode is active. Internet requests are disabled.') {
    super(message);
    this.name = OFFLINE_NETWORK_ERROR_NAME;
  }
}

export function isOfflineNetworkBlockedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'name' in error &&
    (error as { name?: unknown }).name === OFFLINE_NETWORK_ERROR_NAME
  );
}

export function isManualOfflineModeActive(): boolean {
  return usePreferencesStore.getState().walletMode === 'offline';
}

function getFetchUrl(input: Parameters<FetchLike>[0]): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return null;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function shouldBlockFetch(input: Parameters<FetchLike>[0]): boolean {
  if (!isManualOfflineModeActive()) return false;

  const rawUrl = getFetchUrl(input);
  if (rawUrl == null) return false;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function installFetchGuard(): void {
  if (fetchGuardInstalled || typeof globalThis.fetch !== 'function') return;

  originalFetch = globalThis.fetch.bind(globalThis) as FetchLike;
  globalThis.fetch = ((input, init) => {
    if (shouldBlockFetch(input as Parameters<FetchLike>[0])) {
      return Promise.reject(new OfflineNetworkBlockedError());
    }

    return originalFetch!(input as RequestInfo, init);
  }) as FetchLike;
  fetchGuardInstalled = true;
}

function configureNetInfoReachability(): void {
  NetInfo.configure({
    useNativeReachability: true,
    reachabilityShouldRun: () => !isManualOfflineModeActive(),
  });
}

function setQueryOnlineState(): void {
  onlineManager.setOnline(!isManualOfflineModeActive() && lastReachableOnline);
}

function syncQueryOnlineState(): void {
  setQueryOnlineState();

  if (preferencesUnsubscribe != null) return;
  preferencesUnsubscribe = usePreferencesStore.subscribe((state) => {
    onlineManager.setOnline(state.walletMode !== 'offline' && lastReachableOnline);
  });

  if (netInfoUnsubscribe == null) {
    netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      lastReachableOnline =
        state.isConnected !== false && state.isInternetReachable !== false;
      setQueryOnlineState();
    });
  }
}

function syncQueryFocusState(): void {
  if (appStateSubscription != null) return;

  // TanStack Query exposes a custom focus controller for non-DOM
  // environments. Wiring it to React Native's `AppState` lets queries
  // honour `refetchOnWindowFocus: true` (or default) without each hook
  // having to re-implement focus detection. When the app is in the
  // background, focusManager prevents background polls and pauses
  // mutations until the user returns.
  focusManager.setFocused(AppState.currentState === 'active');

  appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (focusRestoreTimer != null) {
      clearTimeout(focusRestoreTimer);
      focusRestoreTimer = null;
    }

    if (status !== 'active') {
      focusManager.setFocused(false);
      return;
    }

    focusRestoreTimer = setTimeout(() => {
      focusRestoreTimer = null;
      focusManager.setFocused(true);
    }, FOCUS_RESTORE_DELAY_MS);
  });
}

export function installNetworkAccessPolicy(): void {
  configureNetInfoReachability();
  installFetchGuard();
  syncQueryOnlineState();
  syncQueryFocusState();
}
