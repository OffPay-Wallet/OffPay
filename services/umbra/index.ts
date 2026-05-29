import type {
  JsonValue,
  OffpayNetwork,
  UmbraClaimRequest,
  UmbraClaimResponse,
  UmbraClaimStatusResponse,
  UmbraRelayerInfoResponse,
  UmbraTreeProofsRequest,
  UmbraTreeProofsResponse,
  UmbraUtxosRequest,
  UmbraUtxosResponse,
} from '@/types/offpay-api';
import { readJsonResponseAdaptive, stringifyJsonAdaptive } from '@/lib/perf/ui-work-scheduler';

const DEFAULT_INDEXER_URLS: Record<OffpayNetwork, string> = {
  mainnet: 'https://utxo-indexer.api.umbraprivacy.com',
  devnet: 'https://utxo-indexer.api-devnet.umbraprivacy.com',
};
const DEFAULT_RELAYER_URLS: Record<OffpayNetwork, string> = {
  mainnet: 'https://relayer.api.umbraprivacy.com',
  devnet: 'https://relayer.api-devnet.umbraprivacy.com',
};
const DEFAULT_TIMEOUT_MS = 15_000;
const UTXO_PATHS = ['/v1/utxos', '/api/v1/utxos', '/utxos'];
const TREE_PROOF_PATHS = ['/v1/trees/:treeIndex/proofs', '/api/v1/trees/:treeIndex/proofs'];
const RELAYER_INFO_PATHS = ['/v1/relayer/info', '/api/v1/relayer/info'];
const CLAIM_PATHS = ['/v1/claims', '/api/v1/claims'];
const CLAIM_STATUS_PATHS = ['/v1/claims/:id', '/api/v1/claims/:id'];
const PUBLIC_UMBRA_ENV = {
  EXPO_PUBLIC_UMBRA_INDEXER_URL_MAINNET: process.env.EXPO_PUBLIC_UMBRA_INDEXER_URL_MAINNET,
  EXPO_PUBLIC_UMBRA_INDEXER_URL_DEVNET: process.env.EXPO_PUBLIC_UMBRA_INDEXER_URL_DEVNET,
  EXPO_PUBLIC_UMBRA_RELAYER_URL_MAINNET: process.env.EXPO_PUBLIC_UMBRA_RELAYER_URL_MAINNET,
  EXPO_PUBLIC_UMBRA_RELAYER_URL_DEVNET: process.env.EXPO_PUBLIC_UMBRA_RELAYER_URL_DEVNET,
} satisfies Record<string, string | undefined>;

function publicEnv(key: keyof typeof PUBLIC_UMBRA_ENV): string | null {
  const value = PUBLIC_UMBRA_ENV[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function indexerBaseUrl(network: OffpayNetwork): string {
  const key =
    network === 'mainnet'
      ? 'EXPO_PUBLIC_UMBRA_INDEXER_URL_MAINNET'
      : 'EXPO_PUBLIC_UMBRA_INDEXER_URL_DEVNET';
  return (publicEnv(key) ?? DEFAULT_INDEXER_URLS[network]).replace(/\/$/, '');
}

function relayerBaseUrl(network: OffpayNetwork): string {
  const key =
    network === 'mainnet'
      ? 'EXPO_PUBLIC_UMBRA_RELAYER_URL_MAINNET'
      : 'EXPO_PUBLIC_UMBRA_RELAYER_URL_DEVNET';
  return (publicEnv(key) ?? DEFAULT_RELAYER_URLS[network]).replace(/\/$/, '');
}

function withTimeout(upstream?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let upstreamAbort: (() => void) | null = null;
  if (upstream != null) {
    if (upstream.aborted) {
      controller.abort(upstream.reason);
    } else {
      upstreamAbort = () => controller.abort(upstream.reason);
      upstream.addEventListener('abort', upstreamAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`Umbra request timed out after ${DEFAULT_TIMEOUT_MS}ms`));
  }, DEFAULT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (upstream != null && upstreamAbort != null) {
        upstream.removeEventListener('abort', upstreamAbort);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJsonValue(value: unknown): JsonValue {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as JsonValue;
  }
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, asJsonValue(entry)]),
    );
  }
  return String(value);
}

function replacePathParams(path: string, params: Record<string, string | number>): string {
  return Object.entries(params).reduce(
    (current, [key, value]) => current.replace(`:${key}`, encodeURIComponent(String(value))),
    path,
  );
}

async function parseProviderJson(response: Response): Promise<unknown> {
  try {
    return await readJsonResponseAdaptive(response);
  } catch {
    return null;
  }
}

async function stringifyJsonBody(value: unknown): Promise<string> {
  return stringifyJsonAdaptive(value);
}

async function fetchJsonCandidates(params: {
  baseUrl: string;
  paths: readonly string[];
  init?: RequestInit;
  query?: URLSearchParams;
  signal?: AbortSignal;
}): Promise<unknown> {
  let lastError: unknown = null;
  for (const path of params.paths) {
    if (params.signal?.aborted === true) throw params.signal.reason ?? new Error('Aborted');
    const handle = withTimeout(params.signal);
    const query = params.query?.toString();
    const url = `${params.baseUrl}${path}${query ? `?${query}` : ''}`;
    try {
      const response = await fetch(url, {
        ...(params.init ?? {}),
        headers: {
          'Content-Type': 'application/json',
          ...(params.init?.headers ?? {}),
        },
        signal: handle.signal,
      });
      const payload = await parseProviderJson(response);
      if (response.ok) return payload;
      lastError = new Error(`Umbra endpoint rejected request with HTTP ${response.status}.`);
      if (response.status !== 404) break;
    } catch (error) {
      lastError = error;
    } finally {
      handle.cleanup();
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Umbra endpoint is unavailable.');
}

function readArrayPayload(payload: unknown, keys: readonly string[]): Record<string, JsonValue>[] {
  const candidate = Array.isArray(payload)
    ? payload
    : keys.map((key) => (isRecord(payload) ? payload[key] : null)).find(Array.isArray);
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((entry) =>
    isRecord(entry) ? [asJsonValue(entry) as Record<string, JsonValue>] : [],
  );
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function getUmbraUtxos(request: UmbraUtxosRequest): Promise<UmbraUtxosResponse> {
  const query = new URLSearchParams();
  if (request.start != null) query.set('start', String(request.start));
  if (request.end != null) query.set('end', String(request.end));
  if (request.limit != null) query.set('limit', String(request.limit));
  const payload = await fetchJsonCandidates({
    baseUrl: indexerBaseUrl(request.network),
    paths: UTXO_PATHS,
    query,
  });
  return {
    network: request.network,
    utxos: readArrayPayload(payload, ['utxos', 'items', 'data']),
    cursor: isRecord(payload) ? readString(payload.cursor) : null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getUmbraTreeProofs(
  request: UmbraTreeProofsRequest,
): Promise<UmbraTreeProofsResponse> {
  const paths = TREE_PROOF_PATHS.map((path) =>
    replacePathParams(path, {
      treeIndex: request.treeIndex,
    }),
  );
  const payload = await fetchJsonCandidates({
    baseUrl: indexerBaseUrl(request.network),
    paths,
    init: {
      method: 'POST',
      body: await stringifyJsonBody({ insertionIndexes: request.insertionIndexes }),
    },
  });
  const proofs = Array.isArray(payload)
    ? payload.map(asJsonValue)
    : readArrayPayload(payload, ['proofs', 'items', 'data']);
  return {
    network: request.network,
    treeIndex: request.treeIndex,
    proofs,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getUmbraRelayerInfo(
  network: OffpayNetwork,
): Promise<UmbraRelayerInfoResponse> {
  const payload = await fetchJsonCandidates({
    baseUrl: relayerBaseUrl(network),
    paths: RELAYER_INFO_PATHS,
  });
  return {
    network,
    relayer: isRecord(payload) ? (asJsonValue(payload) as Record<string, JsonValue>) : null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function submitUmbraClaim(request: UmbraClaimRequest): Promise<UmbraClaimResponse> {
  const payload = await fetchJsonCandidates({
    baseUrl: relayerBaseUrl(request.network),
    paths: CLAIM_PATHS,
    init: {
      method: 'POST',
      body: await stringifyJsonBody(request.payload),
    },
  });
  const result = isRecord(payload) ? payload : {};
  return {
    network: request.network,
    claimId: readString(result.id) ?? readString(result.claimId) ?? readString(result.requestId),
    status: readString(result.status),
    result: isRecord(payload) ? (asJsonValue(payload) as Record<string, JsonValue>) : null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getUmbraClaimStatus(params: {
  network: OffpayNetwork;
  id: string;
}): Promise<UmbraClaimStatusResponse> {
  const paths = CLAIM_STATUS_PATHS.map((path) => replacePathParams(path, { id: params.id }));
  const payload = await fetchJsonCandidates({
    baseUrl: relayerBaseUrl(params.network),
    paths,
  });
  const result = isRecord(payload) ? payload : {};
  return {
    network: params.network,
    id: params.id,
    status: readString(result.status),
    result: isRecord(payload) ? (asJsonValue(payload) as Record<string, JsonValue>) : null,
    fetchedAt: new Date().toISOString(),
  };
}
