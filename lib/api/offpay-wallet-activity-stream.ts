import { getWalletTransactions } from '@/lib/api/offpay-api-client';

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

const POLL_INTERVAL_MS = 4_000;
const ACTIVITY_LIMIT = 10;
const MAX_TRACKED_SIGNATURES = 200;

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

export async function connectWalletActivityStream(
  walletAddress: string,
  network: OffpayNetwork,
  handlers: WalletActivityStreamHandlers = {},
): Promise<WalletActivityStreamConnection> {
  let closed = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let initialized = false;
  const trackedSignatures = new Set<string>();

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
          rememberSignature(trackedSignatures, transaction.signature);
          handlers.onActivity?.(toActivityEvent(transaction));
        }
      }
      handlers.onPing?.({ timestamp: Date.now() });
    } catch {
      handlers.onStreamError?.({ code: 'STREAM_ERROR', retryable: true });
    } finally {
      inFlight = false;
      schedule();
    }
  };

  void poll();

  return {
    supported: true,
    close: () => {
      closed = true;
      if (timer != null) clearTimeout(timer);
      timer = null;
      handlers.onClose?.('closed');
    },
    reconnect: () => {
      if (closed) return;
      initialized = false;
      trackedSignatures.clear();
      schedule(0);
    },
    refreshAccounts: () => {
      schedule(0);
    },
  };
}
