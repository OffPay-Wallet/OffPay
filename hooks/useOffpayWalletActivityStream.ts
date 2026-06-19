import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import {
  offpayWalletDashboardBaseQueryKey,
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { connectWalletActivityStream } from '@/lib/api/offpay-wallet-activity-stream';
import { shortenWalletAddress } from '@/lib/api/offpay-wallet-data';
import { useWalletStore } from '@/store/walletStore';

import type {
  OffpayNetwork,
  StreamCapabilitiesResponse,
  WalletActivityEvent,
} from '@/types/offpay-api';
import type { WalletActivityStreamConnection } from '@/lib/api/offpay-wallet-activity-stream';

const MAX_RECONNECT_FAILURES = 5;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RATE_LIMIT_FALLBACK_DELAY_MS = 60_000;
const FALLBACK_POLL_INTERVAL_MS = 60_000;
const MIN_WALLET_DATA_INVALIDATION_INTERVAL_MS = 25_000;
const ACTIVITY_INDEX_REFRESH_DELAYS_MS = [5_000, 30_000, 90_000] as const;
const FOREGROUND_STREAM_RECONNECT_DELAY_MS = 350;
const FOREGROUND_WALLET_DATA_REFRESH_DELAY_MS = 1_400;
const SEEN_SIGNATURES_LIMIT = 200;
const ACTIVITY_EVENTS_LIMIT = 50;

export type OffpayWalletActivityStreamStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'fallback'
  | 'unavailable';

/**
 * Legacy export — kept for callers that may still reference it as a
 * stable identifier. Stream capabilities are now derived locally from
 * env config, so no React Query cache is actually populated under
 * this key.
 */
export const offpayStreamCapabilitiesQueryKey = (network: OffpayNetwork | null) =>
  ['offpay', 'streamCapabilities', network] as const;

/**
 * Module-level dedup keyed by `${network}:${walletAddress}` so we
 * survive remounts (e.g., tab unfreeze, Fast Refresh) without
 * re-firing toasts for events we've already seen.
 */
const seenSignaturesByScope = new Map<string, Set<string>>();

function getSeenSignaturesScope(
  walletAddress: string | null,
  network: OffpayNetwork | null,
): Set<string> | null {
  if (walletAddress == null || network == null) return null;
  const key = `${network}:${walletAddress}`;
  const existing = seenSignaturesByScope.get(key);
  if (existing != null) return existing;
  const next = new Set<string>();
  seenSignaturesByScope.set(key, next);
  return next;
}

function rememberSeenSignature(scope: Set<string>, signature: string): boolean {
  if (scope.has(signature)) return false;
  scope.add(signature);
  if (scope.size > SEEN_SIGNATURES_LIMIT) {
    // Bounded-size FIFO without an extra array: pull the oldest
    // insertion (Sets preserve insertion order) and drop it.
    const oldest = scope.values().next().value;
    if (oldest != null) scope.delete(oldest);
  }
  return true;
}

function getReconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt - 1, 0), MAX_RECONNECT_DELAY_MS);
}

function getRateLimitDelayMs(error: unknown): number | null {
  if (typeof error !== 'object' || error == null) return null;

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    retryAfterMs?: unknown;
  };

  if (
    candidate.name !== 'OffpayApiError' ||
    candidate.code !== 'RATE_LIMITED' ||
    typeof candidate.retryAfterMs !== 'number'
  ) {
    return null;
  }

  return Math.min(Math.max(candidate.retryAfterMs, 1000), MAX_RATE_LIMIT_FALLBACK_DELAY_MS);
}

function formatRawAmount(rawAmount: string, decimals: number): string | null {
  if (!/^\d+$/.test(rawAmount)) return null;
  const scale = 10n ** BigInt(decimals);
  const atomic = BigInt(rawAmount);
  const whole = atomic / scale;
  const fraction = atomic % scale;
  if (fraction === 0n) return whole.toString();

  return `${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function inferActivityDirection(
  event: WalletActivityEvent,
  walletAddress: string,
): 'send' | 'receive' | null {
  if (event.direction === 'send' || event.direction === 'receive') return event.direction;
  if (event.sender === walletAddress) return 'send';
  if (event.recipient === walletAddress) return 'receive';

  const counterpartyRoles = event.counterparties?.map((item) => item.role.toLowerCase()) ?? [];
  const hasSenderCounterparty = counterpartyRoles.some((role) =>
    /sender|source|from|payer/.test(role),
  );
  const hasRecipientCounterparty = counterpartyRoles.some((role) =>
    /recipient|receiver|destination|to/.test(role),
  );

  if (hasSenderCounterparty !== hasRecipientCounterparty) {
    return hasSenderCounterparty ? 'receive' : 'send';
  }

  const description = event.description?.toLowerCase() ?? '';
  if (/\breceiv|\bdeposit|\binbound/.test(description)) return 'receive';
  return null;
}

function getActivityAmount(event: WalletActivityEvent): string | null {
  const amount = event.amount?.trim();
  if (amount != null && amount.length > 0) return amount;
  if (event.rawAmount == null || event.tokenDecimals == null) return null;
  return formatRawAmount(event.rawAmount, event.tokenDecimals);
}

function findCounterpartyAddress(
  event: WalletActivityEvent,
  direction: 'send' | 'receive',
  walletAddress: string,
): string | null {
  const explicit = direction === 'receive' ? event.sender : event.recipient;
  if (explicit != null && explicit !== walletAddress) return explicit;

  const preferredRoles =
    direction === 'receive' ? /sender|source|from|payer/ : /recipient|receiver|destination|to/;
  return (
    event.counterparties?.find(
      (item) => item.address !== walletAddress && preferredRoles.test(item.role.toLowerCase()),
    )?.address ??
    event.counterparties?.find((item) => item.address !== walletAddress)?.address ??
    null
  );
}

function buildActivityDescription(
  event: WalletActivityEvent,
  walletAddress: string,
): string | null {
  const description = event.description?.trim();
  if (description != null && description.length > 0) return description;

  const amount = getActivityAmount(event);
  const symbol = event.tokenSymbol?.trim();
  if (amount == null || symbol == null || symbol.length === 0) return event.description;

  const direction = inferActivityDirection(event, walletAddress);
  if (direction == null) return `${amount} ${symbol}`;
  const counterparty = findCounterpartyAddress(event, direction, walletAddress);
  const action = direction === 'receive' ? 'Received' : 'Sent';
  const preposition = direction === 'receive' ? 'from' : 'to';
  return counterparty == null
    ? `${action} ${amount} ${symbol}`
    : `${action} ${amount} ${symbol} ${preposition} ${shortenWalletAddress(counterparty)}`;
}

export function useOffpayWalletActivityStream(options?: {
  walletAddress?: string | null;
  enabled?: boolean;
}) {
  const activeWalletAddress = useWalletStore((state) => state.publicKey);
  const walletAddress = options?.walletAddress ?? activeWalletAddress;
  const requested = options?.enabled ?? true;
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const capabilitiesQuery = useOffpayCapabilities();
  const { capabilities } = capabilitiesQuery;
  const queryClient = useQueryClient();
  const aggregateCapability = getOffpayFeatureCapability(capabilities, 'stream.walletActivity');
  const aggregateAvailable = isOffpayFeatureAvailable(capabilities, 'stream.walletActivity');

  // Stream capabilities are derived purely from local env config
  // (`hasConfiguredWsProvider`), so the previous `useQuery` round
  // trip was strictly overhead — it added latency between launch and
  // the first WS connect, during which incoming transfers could be
  // missed. Compute the same answer synchronously instead and cache
  // it in `useMemo` so the value is referentially stable across
  // renders.
  const streamCapabilities = useMemo<StreamCapabilitiesResponse | null>(() => {
    if (network == null) return null;
    return {
      network,
      capabilities: { walletActivity: aggregateAvailable },
    };
  }, [aggregateAvailable, network]);

  const streamCapabilityAvailable = streamCapabilities?.capabilities.walletActivity === true;

  const [status, setStatus] = useState<OffpayWalletActivityStreamStatus>('idle');
  const [failureCount, setFailureCount] = useState(0);
  const [lastActivity, setLastActivity] = useState<WalletActivityEvent | null>(null);
  const [activityEvents, setActivityEvents] = useState<WalletActivityEvent[]>([]);
  const [lastPingAt, setLastPingAt] = useState<number | null>(null);
  const connectionRef = useRef<WalletActivityStreamConnection | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityRefreshTimerRefs = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const walletDataInvalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foregroundReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foregroundInvalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const lastWalletDataInvalidatedAtRef = useRef(0);
  const gateLogAtRef = useRef(Date.now());

  // Diagnostic logging for the gating predicates so we can see why
  // the WS isn't opening from a single tag in the dev console. The
  // hook always runs to keep the rules of hooks happy; the body
  // bails out fast in production.
  useEffect(() => {
    if (!__DEV__) return;
    const now = Date.now();
    const elapsedMs = now - gateLogAtRef.current;
    gateLogAtRef.current = now;
    console.log('[wallet-activity-hook] gate', {
      requested,
      canUseNetwork,
      walletAddress,
      network,
      aggregateAvailable,
      streamCapabilityAvailable,
      elapsedMs,
    });
  }, [
    aggregateAvailable,
    canUseNetwork,
    network,
    requested,
    streamCapabilityAvailable,
    walletAddress,
  ]);

  useEffect(() => {
    const clearForegroundTimers = () => {
      if (foregroundReconnectTimerRef.current != null) {
        clearTimeout(foregroundReconnectTimerRef.current);
        foregroundReconnectTimerRef.current = null;
      }
      if (foregroundInvalidationTimerRef.current != null) {
        clearTimeout(foregroundInvalidationTimerRef.current);
        foregroundInvalidationTimerRef.current = null;
      }
    };

    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (fallbackPollTimerRef.current != null) {
      clearInterval(fallbackPollTimerRef.current);
      fallbackPollTimerRef.current = null;
    }
    if (walletDataInvalidationTimerRef.current != null) {
      clearTimeout(walletDataInvalidationTimerRef.current);
      walletDataInvalidationTimerRef.current = null;
    }
    clearForegroundTimers();
    activityRefreshTimerRefs.current.forEach((timer) => clearTimeout(timer));
    activityRefreshTimerRefs.current = [];
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    connectionRef.current?.close();
    connectionRef.current = null;
    setFailureCount(0);
    setLastActivity(null);
    setActivityEvents([]);
    setLastPingAt(null);

    if (!requested || !canUseNetwork) {
      setStatus('idle');
      return undefined;
    }

    if (walletAddress == null || network == null || !aggregateAvailable) {
      setStatus('unavailable');
      return undefined;
    }

    if (!streamCapabilityAvailable) {
      setStatus('unavailable');
      return undefined;
    }

    let cancelled = false;
    let reconnectAttempts = 0;
    let reconnectPending = false;
    let openStreamPending = false;
    let streamEpoch = 0;
    let streamPaused = AppState.currentState !== 'active';
    if (streamPaused) setStatus('idle');
    const seenSignatures = getSeenSignaturesScope(walletAddress, network) ?? new Set<string>();
    const walletDataQueryFilters = [
      { queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network) },
      { queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network) },
      { queryKey: offpayWalletBalanceQueryKey(walletAddress, network) },
    ] as const;

    const clearRetryTimer = () => {
      if (retryTimerRef.current == null) return;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };

    const clearFallbackTimer = () => {
      if (fallbackPollTimerRef.current == null) return;
      clearInterval(fallbackPollTimerRef.current);
      fallbackPollTimerRef.current = null;
    };

    const clearWalletDataInvalidationTimer = () => {
      if (walletDataInvalidationTimerRef.current == null) return;
      clearTimeout(walletDataInvalidationTimerRef.current);
      walletDataInvalidationTimerRef.current = null;
    };

    const clearActivityRefreshTimers = () => {
      activityRefreshTimerRefs.current.forEach((timer) => clearTimeout(timer));
      activityRefreshTimerRefs.current = [];
    };

    const abortStreamRequest = () => {
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
    };

    const closeConnection = () => {
      const connection = connectionRef.current;
      connectionRef.current = null;
      abortStreamRequest();
      connection?.close();
    };

    const isWalletDataFetchInFlight = () =>
      walletDataQueryFilters.some((filter) => queryClient.isFetching(filter) > 0);

    const getNewestWalletDataUpdatedAt = () =>
      walletDataQueryFilters.reduce((newestUpdatedAt, filter) => {
        const queries = queryClient.getQueryCache().findAll(filter);
        return queries.reduce(
          (newestForFilter, query) => Math.max(newestForFilter, query.state.dataUpdatedAt),
          newestUpdatedAt,
        );
      }, 0);

    const shouldRefreshWalletDataSnapshot = () => {
      if (streamPaused || isWalletDataFetchInFlight()) return false;
      const newestUpdatedAt = getNewestWalletDataUpdatedAt();
      if (newestUpdatedAt === 0) return true;
      return Date.now() - newestUpdatedAt >= MIN_WALLET_DATA_INVALIDATION_INTERVAL_MS;
    };

    const pauseStream = () => {
      streamPaused = true;
      streamEpoch += 1;
      reconnectPending = false;
      openStreamPending = false;
      clearRetryTimer();
      clearFallbackTimer();
      clearWalletDataInvalidationTimer();
      clearForegroundTimers();
      clearActivityRefreshTimers();
      closeConnection();
      setStatus('idle');
    };

    const invalidateWalletDataNow = () => {
      walletDataInvalidationTimerRef.current = null;
      if (cancelled || streamPaused || isWalletDataFetchInFlight()) return;
      lastWalletDataInvalidatedAtRef.current = Date.now();
      void queryClient.invalidateQueries({
        queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
        refetchType: 'active',
      });
      void queryClient.invalidateQueries({
        queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
        refetchType: 'active',
      });
      void queryClient.invalidateQueries({
        queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
        refetchType: 'active',
      });
    };

    const invalidateWalletData = () => {
      const elapsedMs = Date.now() - lastWalletDataInvalidatedAtRef.current;
      if (elapsedMs >= MIN_WALLET_DATA_INVALIDATION_INTERVAL_MS) {
        if (walletDataInvalidationTimerRef.current != null) {
          clearTimeout(walletDataInvalidationTimerRef.current);
        }
        invalidateWalletDataNow();
        return;
      }

      if (walletDataInvalidationTimerRef.current != null) return;
      walletDataInvalidationTimerRef.current = setTimeout(
        invalidateWalletDataNow,
        MIN_WALLET_DATA_INVALIDATION_INTERVAL_MS - elapsedMs,
      );
    };

    const scheduleIndexedTransactionRefreshes = () => {
      activityRefreshTimerRefs.current.forEach((timer) => clearTimeout(timer));
      activityRefreshTimerRefs.current = ACTIVITY_INDEX_REFRESH_DELAYS_MS.map((delayMs) =>
        setTimeout(invalidateWalletData, delayMs),
      );
    };

    const stopWithFallback = (refreshDelayMs = 0) => {
      if (cancelled || streamPaused) return;
      setStatus('fallback');
      if (fallbackPollTimerRef.current == null) {
        fallbackPollTimerRef.current = setInterval(invalidateWalletData, FALLBACK_POLL_INTERVAL_MS);
      }

      if (refreshDelayMs > 0) {
        retryTimerRef.current = setTimeout(invalidateWalletData, refreshDelayMs);
        return;
      }

      invalidateWalletData();
    };

    const scheduleReconnect = (error?: unknown) => {
      if (cancelled || streamPaused || reconnectPending) return;

      const rateLimitDelayMs = getRateLimitDelayMs(error);
      if (rateLimitDelayMs != null) {
        closeConnection();
        stopWithFallback(rateLimitDelayMs);
        return;
      }

      reconnectPending = true;
      reconnectAttempts += 1;
      setFailureCount(reconnectAttempts);
      closeConnection();

      if (reconnectAttempts >= MAX_RECONNECT_FAILURES) {
        stopWithFallback();
        return;
      }

      setStatus('reconnecting');
      retryTimerRef.current = setTimeout(() => {
        reconnectPending = false;
        void openStream();
      }, getReconnectDelay(reconnectAttempts));
    };

    const openStream = async () => {
      if (cancelled || streamPaused) return;
      if (openStreamPending || connectionRef.current != null) return;
      openStreamPending = true;
      const openEpoch = streamEpoch;
      const abortController = new AbortController();
      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = abortController;
      let connectionAttached = false;
      const isStaleOpen = () => cancelled || streamPaused || openEpoch !== streamEpoch;
      setStatus(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

      try {
        const connection = await connectWalletActivityStream(walletAddress, network, {
          signal: abortController.signal,
          onOpen: () => {
            if (isStaleOpen()) return;
            reconnectPending = false;
            reconnectAttempts = 0;
            setFailureCount(0);
            setStatus('connected');
            setLastPingAt(Date.now());
            if (fallbackPollTimerRef.current != null) {
              clearInterval(fallbackPollTimerRef.current);
              fallbackPollTimerRef.current = null;
            }
          },
          onActivity: (event) => {
            if (isStaleOpen()) return;
            if (!rememberSeenSignature(seenSignatures, event.signature)) {
              if (__DEV__) {
                console.log('[wallet-activity-hook] dedup skip', {
                  signature: event.signature,
                });
              }
              return;
            }
            const normalizedEvent = {
              ...event,
              description: buildActivityDescription(event, walletAddress),
              amount: getActivityAmount(event),
              direction: inferActivityDirection(event, walletAddress),
            };
            if (__DEV__) {
              console.log('[wallet-activity-hook] activity', {
                type: event.type,
                signature: event.signature,
                direction: normalizedEvent.direction,
                amount: normalizedEvent.amount,
                tokenSymbol: event.tokenSymbol,
              });
            }
            setLastActivity(normalizedEvent);
            setActivityEvents((events) =>
              [...events, normalizedEvent].slice(-ACTIVITY_EVENTS_LIMIT),
            );
            invalidateWalletData();
            scheduleIndexedTransactionRefreshes();
          },
          onPing: (event) => {
            if (!isStaleOpen()) setLastPingAt(event.timestamp);
          },
          onStreamError: (event) => {
            if (!isStaleOpen()) scheduleReconnect(event);
          },
          onClose: () => {
            if (!isStaleOpen()) scheduleReconnect();
          },
          onUnsupported: () => {
            if (!isStaleOpen()) stopWithFallback();
          },
        });

        if (isStaleOpen() || abortController.signal.aborted) {
          connection.close();
          return;
        }

        if (!connection.supported) {
          stopWithFallback();
          return;
        }

        connectionRef.current = connection;
        connectionAttached = true;
      } catch (error: unknown) {
        if (!isStaleOpen()) scheduleReconnect(error);
      } finally {
        if (!connectionAttached && streamAbortControllerRef.current === abortController) {
          streamAbortControllerRef.current = null;
        }
        openStreamPending = false;
      }
    };

    const reconnectIfDormant = () => {
      if (cancelled || streamPaused) return;
      if (connectionRef.current != null) {
        connectionRef.current?.refreshAccounts();
        return;
      }
      if (openStreamPending) return;
      reconnectAttempts = 0;
      reconnectPending = false;
      setFailureCount(0);
      void openStream();
    };

    const scheduleReconnectIfDormant = (delayMs = FOREGROUND_STREAM_RECONNECT_DELAY_MS) => {
      if (cancelled) return;
      if (foregroundReconnectTimerRef.current != null) {
        clearTimeout(foregroundReconnectTimerRef.current);
      }
      foregroundReconnectTimerRef.current = setTimeout(() => {
        foregroundReconnectTimerRef.current = null;
        reconnectIfDormant();
      }, delayMs);
    };

    const scheduleForegroundWalletDataRefresh = () => {
      if (cancelled || foregroundInvalidationTimerRef.current != null) return;
      foregroundInvalidationTimerRef.current = setTimeout(() => {
        foregroundInvalidationTimerRef.current = null;
        if (shouldRefreshWalletDataSnapshot()) {
          invalidateWalletData();
        }
      }, FOREGROUND_WALLET_DATA_REFRESH_DELAY_MS);
    };

    const appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        // Foregrounding can overlap tab transitions, passcode unlock,
        // NetInfo, and query hydration. Keep live data fresh, but let
        // the first frames after resume settle before starting stream
        // reconnects and wallet refetches.
        streamPaused = false;
        scheduleReconnectIfDormant();
        scheduleForegroundWalletDataRefresh();
      } else {
        pauseStream();
      }
    });

    const netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online && !streamPaused) scheduleReconnectIfDormant();
    });

    if (!streamPaused) {
      void openStream();
    }

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      netInfoUnsubscribe();
      clearRetryTimer();
      clearWalletDataInvalidationTimer();
      clearForegroundTimers();
      clearFallbackTimer();
      clearActivityRefreshTimers();
      closeConnection();
    };
  }, [
    aggregateAvailable,
    canUseNetwork,
    network,
    queryClient,
    requested,
    streamCapabilityAvailable,
    walletAddress,
  ]);

  return {
    status,
    failureCount,
    lastActivity,
    activityEvents,
    lastPingAt,
    walletAddress,
    network,
    aggregateCapability,
    isCapabilitiesPending: capabilitiesQuery.isCapabilitiesPending,
    streamCapabilities,
    isLive: status === 'connected',
    isFallback: status === 'fallback',
  };
}
