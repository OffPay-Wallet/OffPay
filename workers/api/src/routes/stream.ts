import { Hono } from 'hono';
import { PublicKey } from '@solana/web3.js';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  DEFAULT_STREAM_ACTIVITY_LIMIT,
  DEFAULT_STREAM_POLL_INTERVAL_MS,
  DEFAULT_STREAM_WEBSOCKET_FALLBACK_POLL_INTERVAL_MS,
  getStreamCapabilities,
  getWalletTokenAccountAddresses,
  getWalletTransactions,
  type WalletTransactionRecord,
} from '../lib/helius.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getSupportedStablecoins,
} from '../lib/offline.js';
import { getRpcWebSocketUrlCandidates, type RpcProviderEndpoint } from '../lib/solana-rpc-providers.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidSolanaAddress,
  networkSchema,
  readSearchParams,
} from '../lib/validation.js';

const streamCapabilitiesQuerySchema = z.object({
  network: networkSchema,
});

const walletActivityQuerySchema = z.object({
  wallet: z.string().min(1),
  network: networkSchema,
});

const MAX_TRACKED_STREAM_SIGNATURES = 200;
const MAX_STREAM_ACCOUNT_SUBSCRIPTIONS = 24;
const STREAM_SLEEP_CHUNK_MS = 2_000;
const STREAM_WS_CONNECT_TIMEOUT_MS = 4_000;
const STREAM_WS_ACTIVITY_DEBOUNCE_MS = 700;

function assertWalletAddress(value: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
    });
  }
}

function assertRequestedNetwork(requestedNetwork: Network, authenticatedNetwork: Network): void {
  if (requestedNetwork !== authenticatedNetwork) {
    throw new AppError({
      status: 400,
      code: 'INVALID_NETWORK',
      message: 'Requested network must match the authenticated network.',
    });
  }
}

function assertWalletScope(requestedWallet: string, authenticatedWallet: string): void {
  if (requestedWallet !== authenticatedWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet activity streams are limited to the authenticated wallet.',
    });
  }
}

function assertEventStreamRequest(acceptHeader: string | undefined): void {
  const normalized = acceptHeader?.toLowerCase() ?? '';
  if (!normalized.includes('text/event-stream')) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Expected an EventSource request.',
    });
  }
}

function deriveAssociatedTokenAddress(params: {
  owner: string;
  mint: string;
  tokenProgramId: string;
}): string | null {
  try {
    const [address] = PublicKey.findProgramAddressSync(
      [
        new PublicKey(params.owner).toBuffer(),
        new PublicKey(params.tokenProgramId).toBuffer(),
        new PublicKey(params.mint).toBuffer(),
      ],
      new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    );
    return address.toBase58();
  } catch {
    return null;
  }
}

function serializeActivityEvent(transaction: WalletTransactionRecord): string {
  return JSON.stringify({
    type: transaction.type,
    signature: transaction.signature,
    description: transaction.description ?? '',
    timestamp: transaction.timestamp,
    amount: transaction.amount ?? null,
    rawAmount: transaction.rawAmount ?? null,
    tokenMint: transaction.tokenMint ?? null,
    tokenSymbol: transaction.tokenSymbol ?? null,
    tokenName: transaction.tokenName ?? null,
    tokenLogo: transaction.tokenLogo ?? null,
    tokenDecimals: transaction.tokenDecimals ?? null,
    direction: transaction.direction ?? null,
    sender: transaction.sender ?? null,
    recipient: transaction.recipient ?? null,
    counterparties: transaction.counterparties,
    fee: transaction.fee,
    status: transaction.status,
  });
}

function serializeStreamErrorEvent(): string {
  return JSON.stringify({
    code: 'STREAM_ERROR',
    retryable: true,
  });
}

function rememberSignatures(
  trackedSignatures: Set<string>,
  transactions: readonly WalletTransactionRecord[],
): void {
  for (const transaction of transactions) {
    trackedSignatures.add(transaction.signature);
  }

  while (trackedSignatures.size > MAX_TRACKED_STREAM_SIGNATURES) {
    const oldestSignature = trackedSignatures.values().next().value;
    if (!oldestSignature) {
      break;
    }

    trackedSignatures.delete(oldestSignature);
  }
}

async function sleepUntilNextPoll(
  stream: SSEStreamingApi,
  pollIntervalMs: number,
): Promise<void> {
  let remainingMs = pollIntervalMs;

  while (remainingMs > 0 && !stream.aborted) {
    const nextSleepMs = Math.min(remainingMs, STREAM_SLEEP_CHUNK_MS);
    await stream.sleep(nextSleepMs);
    remainingMs -= nextSleepMs;
  }
}

async function emitStreamErrorAndClose(stream: SSEStreamingApi): Promise<void> {
  if (!stream.closed && !stream.aborted) {
    try {
      await stream.writeSSE({
        event: 'error',
        data: serializeStreamErrorEvent(),
      });
    } catch {
      // The client may already be gone; closing still releases the stream.
    }
  }

  if (!stream.closed) {
    await stream.close();
  }
}

interface WalletActivityWebSocketHandle {
  provider: RpcProviderEndpoint['provider'];
  close: () => void;
}

function getWebSocketCtor(): typeof WebSocket | null {
  return typeof WebSocket === 'function' ? WebSocket : null;
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Wallet activity WebSocket connection timed out.'));
    }, STREAM_WS_CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
    };

    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Wallet activity WebSocket failed to connect.'));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Wallet activity WebSocket closed before subscribing.'));
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
}

function subscribeToAccount(socket: WebSocket, id: number, address: string): void {
  socket.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'accountSubscribe',
      params: [
        address,
        {
          commitment: 'confirmed',
          encoding: 'base64',
        },
      ],
    }),
  );
}

function subscribeToWalletLogs(socket: WebSocket, id: number, wallet: string): void {
  socket.send(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'logsSubscribe',
      params: [
        {
          mentions: [wallet],
        },
        {
          commitment: 'confirmed',
        },
      ],
    }),
  );
}

async function resolveStreamSubscriptionAddresses(params: {
  env: AppEnv['Bindings'];
  wallet: string;
  network: Network;
}): Promise<string[]> {
  try {
    const tokenAccounts = await getWalletTokenAccountAddresses(params.env, params.wallet, params.network);
    const unique = new Set<string>([params.wallet]);
    for (const stablecoin of getSupportedStablecoins(params.env, params.network)) {
      if (unique.size >= MAX_STREAM_ACCOUNT_SUBSCRIPTIONS) break;
      if (!stablecoin.enabled || !stablecoin.mint) continue;
      const derivedAddress = deriveAssociatedTokenAddress({
        owner: params.wallet,
        mint: stablecoin.mint,
        tokenProgramId: stablecoin.programId,
      });
      if (derivedAddress != null) unique.add(derivedAddress);
    }
    for (const tokenAccount of tokenAccounts) {
      if (unique.size >= MAX_STREAM_ACCOUNT_SUBSCRIPTIONS) break;
      unique.add(tokenAccount.address);
    }
    return Array.from(unique);
  } catch {
    return [params.wallet];
  }
}

async function openWalletActivityWebSocket(params: {
  env: AppEnv['Bindings'];
  wallet: string;
  network: Network;
  onActivity: () => void;
}): Promise<WalletActivityWebSocketHandle | null> {
  const WebSocketCtor = getWebSocketCtor();
  if (WebSocketCtor == null) return null;

  const candidates = getRpcWebSocketUrlCandidates(params.env, params.network);
  if (candidates.length === 0) return null;

  const subscriptionAddresses = await resolveStreamSubscriptionAddresses({
    env: params.env,
    wallet: params.wallet,
    network: params.network,
  });

  for (const candidate of candidates) {
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocketCtor(candidate.url);
      await waitForSocketOpen(socket);

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      socket.addEventListener('message', (event) => {
        const payload = typeof event.data === 'string' ? event.data : '';
        if (!payload.includes('notification')) return;
        if (debounceTimer != null) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          params.onActivity();
        }, STREAM_WS_ACTIVITY_DEBOUNCE_MS);
      });

      let subscriptionId = 1;
      subscribeToWalletLogs(socket, subscriptionId, params.wallet);
      subscriptionId += 1;
      for (const address of subscriptionAddresses) {
        subscribeToAccount(socket, subscriptionId, address);
        subscriptionId += 1;
      }

      return {
        provider: candidate.provider,
        close: () => {
          if (debounceTimer != null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          if (socket != null && socket.readyState < WebSocketCtor.CLOSING) {
            socket.close();
          }
        },
      };
    } catch {
      if (socket != null && socket.readyState < WebSocketCtor.CLOSING) {
        socket.close();
      }
    }
  }

  return null;
}

const streamRoutes = new Hono<AppEnv>();

streamRoutes.get('/capabilities', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, streamCapabilitiesQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(await getStreamCapabilities(context.env, query.network));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

streamRoutes.get('/wallet-activity', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, walletActivityQuerySchema);

  assertWalletAddress(query.wallet);
  assertRequestedNetwork(query.network, authenticatedContext.network);
  assertWalletScope(query.wallet, authenticatedContext.wallet);
  assertEventStreamRequest(context.req.header('Accept'));

  const capabilities = await getStreamCapabilities(context.env, query.network);
  if (!capabilities.capabilities.walletActivity) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Wallet activity streaming is currently unavailable.',
      retryable: true,
    });
  }

  const initialTransactions = await getWalletTransactions(context.env, {
    address: query.wallet,
    network: query.network,
    limit: DEFAULT_STREAM_ACTIVITY_LIMIT,
    useCache: false,
  });

  const trackedSignatures = new Set<string>();
  rememberSignatures(trackedSignatures, initialTransactions.transactions);

  const response = streamSSE(
    context,
    async (stream) => {
      let webSocketHandle: WalletActivityWebSocketHandle | null = null;
      let refreshQueue = Promise.resolve();

      stream.onAbort(() => {
        trackedSignatures.clear();
        webSocketHandle?.close();
        webSocketHandle = null;
      });

      await stream.writeSSE({
        event: 'ping',
        data: JSON.stringify({ timestamp: Date.now() }),
      });

      const refreshLatestActivity = async () => {
        if (stream.aborted) return;

        const latestTransactions = await getWalletTransactions(context.env, {
          address: query.wallet,
          network: query.network,
          limit: DEFAULT_STREAM_ACTIVITY_LIMIT,
          useCache: false,
        });

        const unseenTransactions = latestTransactions.transactions.filter(
          (transaction) => !trackedSignatures.has(transaction.signature),
        );

        for (const transaction of [...unseenTransactions].reverse()) {
          if (stream.aborted) break;
          await stream.writeSSE({
            event: 'activity',
            data: serializeActivityEvent(transaction),
          });
        }

        rememberSignatures(trackedSignatures, latestTransactions.transactions);
      };

      const enqueueRefresh = (): Promise<void> => {
        refreshQueue = refreshQueue.then(refreshLatestActivity, refreshLatestActivity);
        return refreshQueue;
      };

      webSocketHandle = await openWalletActivityWebSocket({
        env: context.env,
        wallet: query.wallet,
        network: query.network,
        onActivity: () => {
          void enqueueRefresh().catch(() => undefined);
        },
      });

      while (!stream.aborted) {
        await sleepUntilNextPoll(
          stream,
          webSocketHandle == null
            ? DEFAULT_STREAM_POLL_INTERVAL_MS
            : DEFAULT_STREAM_WEBSOCKET_FALLBACK_POLL_INTERVAL_MS,
        );
        if (stream.aborted) {
          break;
        }

        await enqueueRefresh();

        await stream.writeSSE({
          event: 'ping',
          data: JSON.stringify({ timestamp: Date.now(), provider: webSocketHandle?.provider ?? 'poll' }),
        });
      }

      webSocketHandle?.close();
      webSocketHandle = null;
      if (!stream.closed) {
        await stream.close();
      }
    },
    async (_error, stream) => {
      await emitStreamErrorAndClose(stream);
    },
  );

  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Accel-Buffering', 'no');
  return response;
});

export default streamRoutes;
