import {
  buildOffpayPublicReadHeaders,
  getWalletTransactions,
  offpayPublicFetch,
} from '@/lib/api/offpay-api-client';
import { isDisplayableWalletPaymentTransaction } from '@/lib/api/offpay-wallet-data';
import { mark, measure } from '@/lib/perf/perf-marks';

import type {
  OffpayNetwork,
  WalletActivityErrorEvent,
  WalletActivityEvent,
  WalletActivityPingEvent,
} from '@/types/offpay-api';

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
  close: () => void;
  reconnect: () => void;
  refreshAccounts: () => void;
}

interface WalletActivityStreamConnectOptions extends WalletActivityStreamHandlers {
  signal?: AbortSignal;
}

const POLL_INTERVAL_MS = 4_000;
const MIN_REFRESH_POLL_INTERVAL_MS = 10_000;
const SSE_OPEN_TIMEOUT_MS = 15_000;
const SSE_MAX_BUFFER_CHARS = 64 * 1024;
const SSE_PARTIAL_EVENT_TIMEOUT_MS = 15_000;
const ACTIVITY_LIMIT = 10;
const MAX_TRACKED_SIGNATURES = 200;

interface ParsedSseEvent {
  event: string;
  data: string;
}

type WalletActivityCounterparty = NonNullable<WalletActivityEvent['counterparties']>[number];

function toActivityEvent(
  transaction: Awaited<ReturnType<typeof getWalletTransactions>>['transactions'][number],
): WalletActivityEvent {
  return {
    type: transaction.type,
    signature: transaction.signature,
    description: transaction.description,
    timestamp: transaction.timestamp,
    amount: transaction.amount ?? null,
    rawAmount: transaction.rawAmount ?? null,
    tokenMint: transaction.tokenMint ?? null,
    tokenSymbol: transaction.tokenSymbol ?? null,
    tokenName: transaction.tokenName ?? null,
    tokenLogo: transaction.tokenLogo ?? null,
    tokenDecimals: transaction.tokenDecimals ?? null,
    fee: transaction.fee,
    status: transaction.status,
    direction: transaction.direction ?? null,
    sender: transaction.sender ?? null,
    recipient: transaction.recipient ?? null,
    counterparties: transaction.counterparties,
  };
}

function rememberSignature(trackedSignatures: Set<string>, signature: string): void {
  trackedSignatures.add(signature);
  while (trackedSignatures.size > MAX_TRACKED_SIGNATURES) {
    const oldestSignature = trackedSignatures.values().next().value;
    if (!oldestSignature) break;
    trackedSignatures.delete(oldestSignature);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new Error('Wallet activity stream connection was aborted.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseWalletActivityEvent(value: unknown): WalletActivityEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.signature !== 'string') return null;
  if (typeof value.timestamp !== 'number') return null;

  return {
    type: typeof value.type === 'string' ? value.type : 'unknown',
    signature: value.signature,
    description: typeof value.description === 'string' ? value.description : '',
    timestamp: value.timestamp,
    amount: typeof value.amount === 'string' ? value.amount : null,
    rawAmount: typeof value.rawAmount === 'string' ? value.rawAmount : null,
    tokenMint: typeof value.tokenMint === 'string' ? value.tokenMint : null,
    tokenSymbol: typeof value.tokenSymbol === 'string' ? value.tokenSymbol : null,
    tokenName: typeof value.tokenName === 'string' ? value.tokenName : null,
    tokenLogo: typeof value.tokenLogo === 'string' ? value.tokenLogo : null,
    tokenDecimals: typeof value.tokenDecimals === 'number' ? value.tokenDecimals : null,
    fee: typeof value.fee === 'number' ? value.fee : 0,
    status: value.status === 'success' || value.status === 'failed' ? value.status : 'success',
    direction: value.direction === 'send' || value.direction === 'receive' ? value.direction : null,
    sender: typeof value.sender === 'string' ? value.sender : null,
    recipient: typeof value.recipient === 'string' ? value.recipient : null,
    counterparties: Array.isArray(value.counterparties)
      ? value.counterparties.filter(
          (entry): entry is WalletActivityCounterparty =>
            isRecord(entry) && typeof entry.address === 'string' && typeof entry.role === 'string',
        )
      : [],
  };
}

function parseSseEvents(text: string): ParsedSseEvent[] {
  return text
    .split(/\n\n/)
    .map((part) => {
      let event = 'message';
      const dataLines: string[] = [];

      for (const rawLine of part.split(/\n/)) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      return {
        event,
        data: dataLines.join('\n'),
      };
    })
    .filter((event) => event.data.length > 0 && event.data !== '[DONE]');
}

function consumeSseBuffer(buffer: string): { events: ParsedSseEvent[]; remainder: string } {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() ?? '';
  return {
    events: parts.flatMap((part) => parseSseEvents(`${part}\n\n`)),
    remainder,
  };
}

function dispatchSseEvent(event: ParsedSseEvent, handlers: WalletActivityStreamHandlers): void {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
    return;
  }

  if (event.event === 'ping') {
    const timestamp =
      isRecord(payload) && typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
    handlers.onPing?.({ timestamp });
    return;
  }

  if (event.event === 'activity') {
    const activity = parseWalletActivityEvent(payload);
    if (activity == null) {
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      return;
    }
    handlers.onActivity?.(activity);
    return;
  }

  if (event.event === 'error') {
    handlers.onStreamError?.({
      code: 'STREAM_ERROR',
      retryable: true,
    });
  }
}

async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: WalletActivityStreamHandlers,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  let partialEventStartedAt: number | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > SSE_MAX_BUFFER_CHARS) {
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      throw new Error('Wallet activity stream buffer exceeded its safety limit.');
    }

    const parsed = consumeSseBuffer(buffer);
    buffer = parsed.remainder;
    if (parsed.events.length > 0 || buffer.length === 0) {
      partialEventStartedAt = buffer.length > 0 ? Date.now() : null;
    } else {
      partialEventStartedAt ??= Date.now();
      if (Date.now() - partialEventStartedAt > SSE_PARTIAL_EVENT_TIMEOUT_MS) {
        handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
        throw new Error('Wallet activity stream partial event timed out.');
      }
    }

    for (const event of parsed.events) {
      dispatchSseEvent(event, handlers);
    }
  }

  if (buffer.trim().length > 0) {
    for (const event of parseSseEvents(`${buffer}\n\n`)) {
      dispatchSseEvent(event, handlers);
    }
  }
}

async function connectWalletActivitySse(
  walletAddress: string,
  network: OffpayNetwork,
  options: WalletActivityStreamConnectOptions = {},
): Promise<WalletActivityStreamConnection | null> {
  const { signal, ...handlers } = options;
  const startedAt = mark();
  let result: 'connected' | 'unsupported' | 'error' = 'error';
  const controller = new AbortController();
  const openTimeout = setTimeout(() => {
    controller.abort(new Error(`Wallet activity stream timed out after ${SSE_OPEN_TIMEOUT_MS}ms`));
  }, SSE_OPEN_TIMEOUT_MS);

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;
  let removeAbortListener: (() => void) | null = null;

  if (signal != null) {
    if (signal.aborted) {
      clearTimeout(openTimeout);
      controller.abort(signal.reason);
      return null;
    }

    const abortFromParent = () => {
      controller.abort(signal.reason);
    };
    signal.addEventListener('abort', abortFromParent, { once: true });
    removeAbortListener = () => {
      signal.removeEventListener('abort', abortFromParent);
      removeAbortListener = null;
    };
  }

  const closeConnection = (reason: string): void => {
    if (closed) return;
    closed = true;
    removeAbortListener?.();
    controller.abort();
    void reader?.cancel().catch(() => undefined);
    handlers.onClose?.(reason);
  };

  try {
    const response = await offpayPublicFetch({
      path: '/api/stream/wallet-activity',
      query: { wallet: walletAddress, network },
      accept: 'text/event-stream',
      headers: await buildOffpayPublicReadHeaders(),
      signal: controller.signal,
      timeoutMs: null,
    });
    clearTimeout(openTimeout);

    if (response.body == null || typeof response.body.getReader !== 'function') {
      result = 'unsupported';
      controller.abort();
      return null;
    }

    reader = response.body.getReader();
    result = 'connected';
    handlers.onOpen?.();

    void readSseStream(reader, handlers)
      .then(() => {
        if (!closed) {
          closed = true;
          removeAbortListener?.();
          handlers.onClose?.('ended');
        }
      })
      .catch(() => {
        if (!closed) {
          closed = true;
          removeAbortListener?.();
          handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
        }
      });

    return {
      supported: true,
      close: () => {
        closeConnection('closed');
      },
      reconnect: () => {
        closeConnection('reconnect');
      },
      refreshAccounts: () => {
        handlers.onPing?.({ timestamp: Date.now() });
      },
    };
  } catch {
    clearTimeout(openTimeout);
    controller.abort();
    removeAbortListener?.();
    return null;
  } finally {
    if (result !== 'connected') {
      removeAbortListener?.();
    }
    measure('walletActivity.sse.open', startedAt, {
      network,
      result,
    });
  }
}

async function connectWalletActivityPoller(
  walletAddress: string,
  network: OffpayNetwork,
  options: WalletActivityStreamConnectOptions = {},
): Promise<WalletActivityStreamConnection> {
  const { signal, ...handlers } = options;
  let closed = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialized = false;
  let lastPollCompletedAt = 0;
  const trackedSignatures = new Set<string>();
  let removeAbortListener: (() => void) | null = null;

  const closePoller = (reason: string): void => {
    if (closed) return;
    closed = true;
    if (timer != null) clearTimeout(timer);
    timer = null;
    removeAbortListener?.();
    handlers.onClose?.(reason);
  };

  if (signal != null) {
    if (signal.aborted) {
      closed = true;
    } else {
      const abortFromParent = () => {
        closePoller('aborted');
      };
      signal.addEventListener('abort', abortFromParent, { once: true });
      removeAbortListener = () => {
        signal.removeEventListener('abort', abortFromParent);
        removeAbortListener = null;
      };
    }
  }

  const schedule = (delayMs = POLL_INTERVAL_MS): void => {
    if (closed) return;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      void poll();
    }, delayMs);
  };

  const poll = async (): Promise<void> => {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const response = await getWalletTransactions(walletAddress, network, {
        limit: ACTIVITY_LIMIT,
        useCache: false,
        signal,
      });
      const newestFirst = response.transactions;
      if (!initialized) {
        for (const transaction of newestFirst) {
          rememberSignature(trackedSignatures, transaction.signature);
        }
        initialized = true;
        handlers.onOpen?.();
      } else {
        const unseen = newestFirst
          .filter((transaction) => !trackedSignatures.has(transaction.signature))
          .reverse();
        for (const transaction of unseen) {
          if (!isDisplayableWalletPaymentTransaction(transaction)) continue;
          rememberSignature(trackedSignatures, transaction.signature);
          handlers.onActivity?.(toActivityEvent(transaction));
        }
      }
      handlers.onPing?.({ timestamp: Date.now() });
    } catch {
      if (!closed) {
        handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
      }
    } finally {
      inFlight = false;
      lastPollCompletedAt = Date.now();
      schedule();
    }
  };

  const scheduleRefreshPoll = (): void => {
    if (lastPollCompletedAt === 0) {
      schedule(0);
      return;
    }

    const elapsedMs = Date.now() - lastPollCompletedAt;
    schedule(Math.max(MIN_REFRESH_POLL_INTERVAL_MS - elapsedMs, 0));
  };

  void poll();

  return {
    supported: true,
    close: () => {
      closePoller('closed');
    },
    reconnect: () => {
      if (closed) return;
      initialized = false;
      trackedSignatures.clear();
      scheduleRefreshPoll();
    },
    refreshAccounts: () => {
      scheduleRefreshPoll();
    },
  };
}

export async function connectWalletActivityStream(
  walletAddress: string,
  network: OffpayNetwork,
  options: WalletActivityStreamConnectOptions = {},
): Promise<WalletActivityStreamConnection> {
  throwIfAborted(options.signal);
  const startedAt = mark();
  const streamConnection = await connectWalletActivitySse(walletAddress, network, options);
  throwIfAborted(options.signal);
  if (streamConnection != null) {
    measure('walletActivity.stream.connect', startedAt, {
      network,
      transport: 'sse',
    });
    return streamConnection;
  }

  const pollerConnection = await connectWalletActivityPoller(walletAddress, network, options);
  measure('walletActivity.stream.connect', startedAt, {
    network,
    transport: 'poller',
  });
  return pollerConnection;
}
