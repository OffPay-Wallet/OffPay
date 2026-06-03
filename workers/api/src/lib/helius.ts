import { AppError } from './errors.js';
import { getRpcHttpUrlCandidates } from './solana-rpc-providers.js';
import type { Bindings, Network } from './types.js';

interface RpcEnvelope<T> {
  jsonrpc?: string;
  id?: string;
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
}

interface LatestBlockhashValue {
  blockhash?: unknown;
  lastValidBlockHeight?: unknown;
}

interface LatestBlockhashResult {
  value?: LatestBlockhashValue;
}

interface FeeForMessageResult {
  value?: unknown;
}

interface BroadcastRawTransactionRequest {
  rawTransaction: string;
  network: Network;
}

interface FeeForMessageRequest {
  messageBase64: string;
  network: Network;
}

async function requestRpc<T>(
  bindings: Bindings,
  network: Network,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const candidates = getRpcHttpUrlCandidates(bindings, network);
  if (candidates.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Solana RPC configuration is unavailable.',
      retryable: true,
    });
  }

  let lastError: unknown;

  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `offpay-${method}`,
          method,
          params,
        }),
      });

      const payload = (await response.json().catch(() => null)) as RpcEnvelope<T> | null;
      if (!response.ok || payload?.error) {
        lastError = payload?.error ?? new Error(`RPC request failed with ${response.status}`);
        continue;
      }

      if (payload && 'result' in payload) {
        return payload.result as T;
      }

      lastError = new Error('RPC response did not include a result.');
    } catch (error) {
      lastError = error;
    }
  }

  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Solana RPC is temporarily unavailable.',
    retryable: true,
    cause: lastError,
  });
}

async function getLatestBlockhash(
  bindings: Bindings,
  network: Network,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = await requestRpc<LatestBlockhashResult>(bindings, network, 'getLatestBlockhash', [
    { commitment: 'confirmed' },
  ]);
  const blockhash = result.value?.blockhash;
  const lastValidBlockHeight = result.value?.lastValidBlockHeight;

  if (typeof blockhash !== 'string' || typeof lastValidBlockHeight !== 'number') {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Solana RPC returned an invalid blockhash response.',
      retryable: true,
    });
  }

  return { blockhash, lastValidBlockHeight };
}

async function getFeeForMessage(
  bindings: Bindings,
  request: FeeForMessageRequest,
): Promise<number> {
  const result = await requestRpc<FeeForMessageResult>(
    bindings,
    request.network,
    'getFeeForMessage',
    [request.messageBase64, { commitment: 'confirmed' }],
  );
  const fee = result.value;

  if (typeof fee !== 'number' || !Number.isFinite(fee)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Solana RPC returned an invalid fee response.',
      retryable: true,
    });
  }

  return fee;
}

async function broadcastRawTransaction(
  bindings: Bindings,
  request: BroadcastRawTransactionRequest,
): Promise<{ signature: string }> {
  const signature = await requestRpc<string>(
    bindings,
    request.network,
    'sendRawTransaction',
    [
      request.rawTransaction,
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      },
    ],
  );

  if (typeof signature !== 'string' || signature.trim().length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Solana RPC returned an invalid transaction signature.',
      retryable: true,
    });
  }

  return { signature };
}

export { broadcastRawTransaction, getFeeForMessage, getLatestBlockhash };
