import { getConfiguredWsEndpoints, getWalletStreamableAccounts } from '@/services/rpc';

import type {
  OffpayNetwork,
  WalletActivityErrorEvent,
  WalletActivityEvent,
  WalletActivityPingEvent,
} from '@/types/offpay-api';
import type { WalletStreamableTokenAccount } from '@/services/rpc';

export interface WalletActivityStreamHandlers {
  onOpen?: () => void;
  onActivity?: (event: WalletActivityEvent) => void;
  onPing?: (event: WalletActivityPingEvent) => void;
  onStreamError?: (event: WalletActivityErrorEvent | null) => void;
  onClose?: (reason: string) => void;
  onUnsupported?: (reason: string) => void;
}

export interface WalletActivityStreamConnection {
  supported: boolean;
  /** Force the stream to close and stop reconnecting. */
  close: () => void;
  /** Force a reconnect cycle (e.g., on AppState foreground / NetInfo regain). */
  reconnect: () => void;
  /** Re-discover SPL token accounts for the wallet, e.g. when a new ATA appears. */
  refreshAccounts: () => void;
}

interface RpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
  params?: {
    subscription?: number;
    result?: {
      context?: { slot?: number };
      value?: {
        signature?: string;
        err?: unknown;
        logs?: unknown;
        lamports?: number;
        data?: unknown;
      };
    };
  };
}

interface SubscribedAccount {
  /** Account pubkey we asked the node to watch — base wallet or an SPL ATA. */
  pubkey: string;
  /** SPL mint, or `null` for the base SOL account. */
  mint: string | null;
  /** Mint decimals (9 for SOL). */
  decimals: number;
  /** Raw atomic balance baseline. Updated on every notification. */
  rawBaseline: bigint;
  /** Display symbol used in synthesized descriptions. */
  symbol: string;
  /** Most recent slot processed, used to drop out-of-order notifications. */
  lastSlot: number;
}

const WS_CONNECT_TIMEOUT_MS = 12_000;
const WS_RECONNECT_BASE_MS = 800;
const WS_RECONNECT_MAX_MS = 12_000;
const WS_HEARTBEAT_INTERVAL_MS = 25_000;
const WS_HEARTBEAT_TIMEOUT_MS = 10_000;
const WS_SUBSCRIBE_ACK_TIMEOUT_MS = 8_000;
const ACCOUNT_REDISCOVERY_INTERVAL_MS = 5 * 60_000;
const MAX_DEDUPED_NOTIFICATIONS = 200;

const SOL_DECIMALS = 9;
const SOL_SYMBOL = 'SOL';

// Reserved id ranges so handler routing doesn't need a global map.
const LOGS_SUBSCRIBE_ID = 1;
const ACCOUNT_SUBSCRIBE_BASE_ID = 1_000;
const UNSUBSCRIBE_BASE_ID = 2_000;
const HEARTBEAT_ID = 9_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMessage(raw: string): RpcMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as RpcMessage) : null;
  } catch {
    return null;
  }
}

function parseRawAmountFromTokenData(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const parsed = isRecord(value.parsed) ? value.parsed : null;
  const info = parsed && isRecord(parsed.info) ? parsed.info : null;
  const tokenAmount = info && isRecord(info.tokenAmount) ? info.tokenAmount : null;
  const amount = typeof tokenAmount?.amount === 'string' ? tokenAmount.amount : null;
  return amount != null && /^\d+$/.test(amount) ? amount : null;
}

function formatRawAmount(rawAmount: bigint, decimals: number): string {
  if (decimals <= 0) return rawAmount.toString();
  const scale = 10n ** BigInt(decimals);
  const negative = rawAmount < 0n;
  const absolute = negative ? -rawAmount : rawAmount;
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const sign = negative ? '-' : '';
  if (fraction === 0n) return `${sign}${whole.toString()}`;
  const frac = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${frac.length > 0 ? `.${frac}` : ''}`;
}

function streamLog(message: string, payload?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (payload == null) {
    console.log(`[wallet-activity-stream] ${message}`);
    return;
  }
  console.log(`[wallet-activity-stream] ${message}`, payload);
}

export async function connectWalletActivityStream(
  walletAddress: string,
  network: OffpayNetwork,
  handlers: WalletActivityStreamHandlers = {},
): Promise<WalletActivityStreamConnection> {
  const endpoints = getConfiguredWsEndpoints(network);
  if (endpoints.length === 0) {
    streamLog('no WS endpoint configured', { network });
    handlers.onUnsupported?.('No client WebSocket provider is configured for this network.');
    return {
      supported: false,
      close: () => undefined,
      reconnect: () => undefined,
      refreshAccounts: () => undefined,
    };
  }

  let closed = false;
  let currentEndpointIndex = 0;
  let reconnectAttempt = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let accountRediscoveryTimer: ReturnType<typeof setInterval> | null = null;

  /** Local subscribe-id → request descriptor while waiting for the numeric ack. */
  const pendingSubscriptions = new Map<
    number,
    { kind: 'logs' } | { kind: 'account'; pubkey: string }
  >();
  let pendingSubscribeAckTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Confirmed server subscription id → routing target. */
  const logsSubscriptionIds = new Set<number>();
  const accountSubscriptionByServerId = new Map<number, SubscribedAccount>();
  /** Local map keyed by ATA / base pubkey for fast updates. */
  const accountsByPubkey = new Map<string, SubscribedAccount>();

  const recentNotifications: string[] = [];
  const recentNotificationSet = new Set<string>();

  const clearConnectTimeout = (): void => {
    if (connectTimeout == null) return;
    clearTimeout(connectTimeout);
    connectTimeout = null;
  };

  const clearHeartbeatTimers = (): void => {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatTimeoutTimer != null) {
      clearTimeout(heartbeatTimeoutTimer);
      heartbeatTimeoutTimer = null;
    }
  };

  const clearAccountRediscoveryTimer = (): void => {
    if (accountRediscoveryTimer != null) {
      clearInterval(accountRediscoveryTimer);
      accountRediscoveryTimer = null;
    }
  };

  const rememberNotification = (key: string): boolean => {
    if (recentNotificationSet.has(key)) return false;
    recentNotificationSet.add(key);
    recentNotifications.push(key);
    if (recentNotifications.length > MAX_DEDUPED_NOTIFICATIONS) {
      const removed = recentNotifications.shift();
      if (removed != null) recentNotificationSet.delete(removed);
    }
    return true;
  };

  const sendLogsSubscribe = (activeSocket: WebSocket): void => {
    pendingSubscriptions.set(LOGS_SUBSCRIBE_ID, { kind: 'logs' });
    activeSocket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: LOGS_SUBSCRIBE_ID,
        method: 'logsSubscribe',
        params: [
          { mentions: [walletAddress] },
          { commitment: 'confirmed' },
        ],
      }),
    );
  };

  const sendAccountSubscribe = (
    activeSocket: WebSocket,
    account: SubscribedAccount,
  ): void => {
    const id = ACCOUNT_SUBSCRIBE_BASE_ID + accountsByPubkey.size + 1;
    pendingSubscriptions.set(id, { kind: 'account', pubkey: account.pubkey });
    accountsByPubkey.set(account.pubkey, account);
    // Token accounts use jsonParsed so we can read the new balance
    // straight from the notification without a follow-up RPC. Base
    // wallet uses base64 because we only need lamport deltas, which
    // are available in `value.lamports` regardless of encoding.
    const encoding: 'base64' | 'jsonParsed' = account.mint == null ? 'base64' : 'jsonParsed';
    activeSocket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'accountSubscribe',
        params: [account.pubkey, { commitment: 'confirmed', encoding }],
      }),
    );
  };

  const armSubscribeAckTimeout = (): void => {
    if (pendingSubscribeAckTimeout != null) return;
    pendingSubscribeAckTimeout = setTimeout(() => {
      pendingSubscribeAckTimeout = null;
      if (closed || pendingSubscriptions.size === 0) return;
      streamLog('subscribe ack timeout', { pending: pendingSubscriptions.size });
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      try {
        socket?.close();
      } catch {
        /* swallow */
      }
    }, WS_SUBSCRIBE_ACK_TIMEOUT_MS);
  };

  const sendHeartbeat = (): void => {
    if (closed || socket == null || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(
        JSON.stringify({ jsonrpc: '2.0', id: HEARTBEAT_ID, method: 'getHealth', params: [] }),
      );
    } catch {
      try {
        socket.close();
      } catch {
        /* swallow */
      }
      return;
    }
    if (heartbeatTimeoutTimer != null) clearTimeout(heartbeatTimeoutTimer);
    heartbeatTimeoutTimer = setTimeout(() => {
      streamLog('heartbeat timed out');
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      try {
        socket?.close();
      } catch {
        /* swallow */
      }
    }, WS_HEARTBEAT_TIMEOUT_MS);
  };

  const startHeartbeat = (): void => {
    clearHeartbeatTimers();
    heartbeatTimer = setInterval(sendHeartbeat, WS_HEARTBEAT_INTERVAL_MS);
  };

  const startAccountRediscovery = (): void => {
    clearAccountRediscoveryTimer();
    accountRediscoveryTimer = setInterval(() => {
      void rediscoverAccounts();
    }, ACCOUNT_REDISCOVERY_INTERVAL_MS);
  };

  const rediscoverAccounts = async (): Promise<void> => {
    if (closed || socket == null || socket.readyState !== WebSocket.OPEN) return;
    try {
      const snapshot = await getWalletStreamableAccounts(walletAddress, network);
      const next = new Map<string, WalletStreamableTokenAccount>();
      for (const account of snapshot.tokenAccounts) {
        next.set(account.pubkey, account);
      }
      let added = 0;
      for (const [pubkey, account] of next) {
        if (accountsByPubkey.has(pubkey)) continue;
        if (closed || socket == null || socket.readyState !== WebSocket.OPEN) return;
        const subscribed: SubscribedAccount = {
          pubkey,
          mint: account.mint,
          decimals: account.decimals,
          rawBaseline: BigInt(account.rawAmount),
          symbol: account.symbol,
          lastSlot: 0,
        };
        sendAccountSubscribe(socket, subscribed);
        added += 1;
      }
      if (added > 0) streamLog('rediscovered SPL accounts', { added });
    } catch (error) {
      streamLog('rediscoverAccounts failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleSubscribeAck = (id: number, result: unknown): void => {
    const pending = pendingSubscriptions.get(id);
    if (pending == null) return;
    pendingSubscriptions.delete(id);
    if (typeof result !== 'number') return;

    if (pending.kind === 'logs') {
      logsSubscriptionIds.add(result);
      streamLog('logsSubscribe ack', { serverId: result });
      // Logs ack is our "stream is live" signal; account-subscribes
      // fan out separately and don't need to hold the open state.
      handlers.onOpen?.();
      handlers.onPing?.({ timestamp: Date.now() });
    } else {
      const account = accountsByPubkey.get(pending.pubkey);
      if (account == null) return;
      accountSubscriptionByServerId.set(result, account);
      streamLog('accountSubscribe ack', {
        serverId: result,
        pubkey: pending.pubkey,
        mint: account.mint,
      });
    }

    if (pendingSubscriptions.size === 0 && pendingSubscribeAckTimeout != null) {
      clearTimeout(pendingSubscribeAckTimeout);
      pendingSubscribeAckTimeout = null;
    }
  };

  const handleSubscribeError = (id: number, error: unknown): void => {
    const pending = pendingSubscriptions.get(id);
    if (pending == null) return;
    pendingSubscriptions.delete(id);
    streamLog('subscribe rejected', { id, kind: pending.kind, error });
    // logsSubscribe is the primary stream — failure is fatal.
    if (pending.kind === 'logs') {
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      try {
        socket?.close();
      } catch {
        /* swallow */
      }
    }
    // accountSubscribe failures are tolerable; the rediscovery loop retries.
  };

  const buildLogsActivityEvent = (signature: string, err: unknown): WalletActivityEvent | null => {
    if (!rememberNotification(`logs:${signature}`)) return null;
    const status: 'success' | 'failed' = err == null ? 'success' : 'failed';
    return {
      type: 'on_chain_transaction',
      signature,
      description: status === 'failed' ? 'Transaction failed on-chain' : 'New on-chain transaction',
      timestamp: Date.now(),
      fee: null,
      status,
      direction: null,
      sender: null,
      recipient: null,
      counterparties: null,
      // Slot is encoded into the description payload for debugging
      // but not into the typed shape — the React layer only cares
      // about (signature, status).
    };
  };

  const buildAccountChangeEvent = (
    account: SubscribedAccount,
    delta: bigint,
    slot: number,
  ): WalletActivityEvent | null => {
    if (delta === 0n) return null;
    const direction: 'send' | 'receive' = delta > 0n ? 'receive' : 'send';
    const absoluteDelta = delta > 0n ? delta : -delta;
    const formatted = formatRawAmount(absoluteDelta, account.decimals);
    const signature = `account:${network}:${account.pubkey}:${slot}:${absoluteDelta.toString()}:${direction}`;
    if (!rememberNotification(signature)) return null;

    const description =
      direction === 'receive'
        ? `Received ${formatted} ${account.symbol}`
        : `Sent ${formatted} ${account.symbol}`;

    return {
      type: account.mint == null ? 'sol_account_change' : 'spl_account_change',
      signature,
      description,
      timestamp: Date.now(),
      amount: formatted,
      rawAmount: absoluteDelta.toString(),
      tokenMint: account.mint,
      tokenSymbol: account.symbol,
      tokenDecimals: account.decimals,
      fee: null,
      status: 'success',
      direction,
      sender: direction === 'receive' ? null : walletAddress,
      recipient: direction === 'receive' ? walletAddress : null,
      counterparties: null,
    };
  };

  const handleLogsNotification = (payload: RpcMessage): void => {
    const value = payload.params?.result?.value;
    const signature = typeof value?.signature === 'string' ? value.signature : null;
    const slot = payload.params?.result?.context?.slot ?? 0;
    if (signature == null) return;
    streamLog('logsNotification', { signature, slot, hasErr: value?.err != null });
    const event = buildLogsActivityEvent(signature, value?.err);
    if (event != null) handlers.onActivity?.(event);
  };

  const handleAccountNotification = (payload: RpcMessage): void => {
    const subscriptionId = payload.params?.subscription;
    if (typeof subscriptionId !== 'number') return;
    const account = accountSubscriptionByServerId.get(subscriptionId);
    if (account == null) return;

    const slot = payload.params?.result?.context?.slot ?? 0;
    if (slot > 0 && slot < account.lastSlot) return;
    account.lastSlot = slot > 0 ? slot : account.lastSlot;

    let nextRaw: bigint | null = null;
    if (account.mint == null) {
      const lamports = payload.params?.result?.value?.lamports;
      if (typeof lamports === 'number' && Number.isFinite(lamports)) {
        nextRaw = BigInt(Math.trunc(lamports));
      }
    } else {
      const data = payload.params?.result?.value?.data;
      const raw = parseRawAmountFromTokenData(data);
      if (raw != null) nextRaw = BigInt(raw);
    }
    if (nextRaw == null) return;
    const delta = nextRaw - account.rawBaseline;
    account.rawBaseline = nextRaw;
    streamLog('accountNotification', {
      pubkey: account.pubkey,
      mint: account.mint,
      delta: delta.toString(),
      slot,
    });
    const event = buildAccountChangeEvent(account, delta, slot > 0 ? slot : Date.now());
    if (event != null) handlers.onActivity?.(event);
  };

  const handleMessage = (event: WebSocketMessageEvent): void => {
    if (closed || typeof event.data !== 'string') return;
    const payload = parseMessage(event.data);
    if (payload == null) return;

    if (payload.id === HEARTBEAT_ID) {
      if (heartbeatTimeoutTimer != null) {
        clearTimeout(heartbeatTimeoutTimer);
        heartbeatTimeoutTimer = null;
      }
      handlers.onPing?.({ timestamp: Date.now() });
      return;
    }

    if (typeof payload.id === 'number') {
      if (payload.error != null) {
        handleSubscribeError(payload.id, payload.error);
        return;
      }
      if (payload.id === LOGS_SUBSCRIBE_ID || payload.id >= ACCOUNT_SUBSCRIBE_BASE_ID) {
        if (payload.id < UNSUBSCRIBE_BASE_ID) {
          handleSubscribeAck(payload.id, payload.result);
          return;
        }
      }
      // Unsubscribe ack — ignore.
      return;
    }

    if (payload.method === 'logsNotification') {
      handleLogsNotification(payload);
      return;
    }
    if (payload.method === 'accountNotification') {
      handleAccountNotification(payload);
      return;
    }
  };

  const initializeSubscriptions = async (activeSocket: WebSocket): Promise<void> => {
    // Primary stream: logsSubscribe with `mentions: [walletAddress]`
    // fires on every confirmed transaction that touches the wallet —
    // SOL transfers, SPL transfers, swaps, even self-sends. The
    // accountSubscribe fan-out below is a redundant, lower-latency
    // path that lets us synthesize a "+0.2 SOL received" preview
    // before HTTP enrichment finishes.
    sendLogsSubscribe(activeSocket);
    armSubscribeAckTimeout();

    const baseAccount: SubscribedAccount = {
      pubkey: walletAddress,
      mint: null,
      decimals: SOL_DECIMALS,
      rawBaseline: 0n,
      symbol: SOL_SYMBOL,
      lastSlot: 0,
    };
    sendAccountSubscribe(activeSocket, baseAccount);

    try {
      const snapshot = await getWalletStreamableAccounts(walletAddress, network);
      if (closed || activeSocket.readyState !== WebSocket.OPEN) return;
      // Seed the base SOL baseline so the first notification produces
      // a real diff and not a phantom "received entire wallet
      // balance" toast.
      baseAccount.rawBaseline = BigInt(snapshot.baseLamports);
      streamLog('seeded baseline', {
        baseLamports: snapshot.baseLamports,
        tokenAccounts: snapshot.tokenAccounts.length,
      });
      for (const account of snapshot.tokenAccounts) {
        if (accountsByPubkey.has(account.pubkey)) continue;
        const subscribed: SubscribedAccount = {
          pubkey: account.pubkey,
          mint: account.mint,
          decimals: account.decimals,
          rawBaseline: BigInt(account.rawAmount),
          symbol: account.symbol,
          lastSlot: 0,
        };
        sendAccountSubscribe(activeSocket, subscribed);
      }
    } catch (error) {
      streamLog('snapshot failed; logsSubscribe still active', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  function connect(): void {
    if (closed) return;
    const endpoint = endpoints[currentEndpointIndex] ?? endpoints[0];
    if (endpoint == null) return;

    clearConnectTimeout();
    pendingSubscriptions.clear();
    logsSubscriptionIds.clear();
    accountSubscriptionByServerId.clear();
    accountsByPubkey.clear();
    if (pendingSubscribeAckTimeout != null) {
      clearTimeout(pendingSubscribeAckTimeout);
      pendingSubscribeAckTimeout = null;
    }
    streamLog('connecting', {
      provider: endpoint.provider,
      attempt: reconnectAttempt,
    });

    const nextSocket = new WebSocket(endpoint.url);
    socket = nextSocket;
    connectTimeout = setTimeout(() => {
      if (closed || nextSocket.readyState === WebSocket.OPEN) return;
      streamLog('connect timeout');
      try {
        nextSocket.close();
      } catch {
        /* swallow */
      }
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      scheduleReconnect();
    }, WS_CONNECT_TIMEOUT_MS);

    nextSocket.onopen = () => {
      if (closed || socket !== nextSocket) return;
      clearConnectTimeout();
      reconnectAttempt = 0;
      streamLog('socket open; sending subscribes');
      void initializeSubscriptions(nextSocket);
      startHeartbeat();
      startAccountRediscovery();
    };

    nextSocket.onmessage = handleMessage;

    nextSocket.onerror = () => {
      if (!closed) {
        streamLog('socket error');
        handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      }
    };

    nextSocket.onclose = () => {
      streamLog('socket close');
      clearConnectTimeout();
      clearHeartbeatTimers();
      clearAccountRediscoveryTimer();
      if (!closed) scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer != null) return;
    clearConnectTimeout();
    currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
    const backoff = Math.min(
      WS_RECONNECT_MAX_MS,
      WS_RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempt, 4),
    );
    const jitter = Math.trunc(Math.random() * Math.min(backoff, 1_000));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff + jitter);
  }

  connect();

  const closeSocket = (): void => {
    closed = true;
    clearConnectTimeout();
    clearHeartbeatTimers();
    clearAccountRediscoveryTimer();
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pendingSubscribeAckTimeout != null) {
      clearTimeout(pendingSubscribeAckTimeout);
      pendingSubscribeAckTimeout = null;
    }
    const activeSocket = socket;
    socket = null;
    if (activeSocket == null) return;
    if (activeSocket.readyState === WebSocket.OPEN) {
      let unsubId = UNSUBSCRIBE_BASE_ID;
      for (const serverId of logsSubscriptionIds) {
        try {
          activeSocket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: unsubId++,
              method: 'logsUnsubscribe',
              params: [serverId],
            }),
          );
        } catch {
          break;
        }
      }
      for (const serverId of accountSubscriptionByServerId.keys()) {
        try {
          activeSocket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: unsubId++,
              method: 'accountUnsubscribe',
              params: [serverId],
            }),
          );
        } catch {
          break;
        }
      }
    }
    try {
      activeSocket.close();
    } catch {
      /* swallow */
    }
    handlers.onClose?.('client_closed');
  };

  const forceReconnect = (): void => {
    if (closed) return;
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;
    const activeSocket = socket;
    if (activeSocket != null && activeSocket.readyState !== WebSocket.CLOSED) {
      try {
        activeSocket.close();
      } catch {
        /* swallow */
      }
      return;
    }
    connect();
  };

  return {
    supported: true,
    close: closeSocket,
    reconnect: forceReconnect,
    refreshAccounts: () => {
      void rediscoverAccounts();
    },
  };
}
