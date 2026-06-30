import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { usePreferencesStore } from '@/store/preferencesStore';

const OFFLINE_NETWORK_ERROR_NAME = 'OfflineNetworkBlockedError';

type FetchLike = typeof fetch;
export interface OfflineNetworkBlockedMetadata {
  method?: string | null;
  owner?: string | null;
  queryKey?: string | null;
  route?: string | null;
  url?: string | null;
}

let fetchGuardInstalled = false;
let originalFetch: FetchLike | null = null;
let preferencesUnsubscribe: (() => void) | null = null;
let netInfoUnsubscribe: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
let lastReachableOnline = true;
let focusRestoreTimer: ReturnType<typeof setTimeout> | null = null;
const fetchMetadataByUrl = new Map<string, OfflineNetworkBlockedMetadata>();

const FOCUS_RESTORE_DELAY_MS = 500;

export class OfflineNetworkBlockedError extends Error {
  readonly method: string | null;
  readonly owner: string | null;
  readonly queryKey: string | null;
  readonly route: string | null;
  readonly url: string | null;

  constructor(
    message = 'Offline mode is active. Internet requests are disabled.',
    options?: OfflineNetworkBlockedMetadata,
  ) {
    super(message);
    this.name = OFFLINE_NETWORK_ERROR_NAME;
    this.method = options?.method ?? null;
    this.owner = options?.owner ?? null;
    this.queryKey = options?.queryKey ?? null;
    this.route = options?.route ?? null;
    this.url = options?.url ?? null;
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

export function rememberOfflineFetchMetadata(
  url: string,
  metadata: OfflineNetworkBlockedMetadata,
): () => void {
  const entry = {
    ...metadata,
    url,
  };
  fetchMetadataByUrl.set(url, entry);

  return () => {
    if (fetchMetadataByUrl.get(url) === entry) {
      fetchMetadataByUrl.delete(url);
    }
  };
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

function getBlockedFetchUrl(input: Parameters<FetchLike>[0]): string | null {
  if (!isManualOfflineModeActive()) return null;

  const rawUrl = getFetchUrl(input);
  if (rawUrl == null) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return isLoopbackHost(url.hostname) ? null : rawUrl;
  } catch {
    return null;
  }
}

function installFetchGuard(): void {
  if (fetchGuardInstalled || typeof globalThis.fetch !== 'function') return;

  originalFetch = globalThis.fetch.bind(globalThis) as FetchLike;
  globalThis.fetch = ((input, init) => {
    const blockedUrl = getBlockedFetchUrl(input as Parameters<FetchLike>[0]);
    if (blockedUrl != null) {
      const metadata = fetchMetadataByUrl.get(blockedUrl);
      return Promise.reject(
        new OfflineNetworkBlockedError(undefined, {
          method: metadata?.method ?? init?.method ?? null,
          owner: metadata?.owner ?? null,
          queryKey: metadata?.queryKey ?? null,
          route: metadata?.route ?? null,
          url: blockedUrl,
        }),
      );
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
