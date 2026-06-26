import type { Bindings, Network } from './types.js';

export interface RpcProviderEndpoint {
  provider: 'helius' | 'alchemy';
  transport: 'http' | 'websocket';
  url: string;
}

function readConfiguredUrl(value: string | undefined, protocols: readonly string[]): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return protocols.includes(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

function deriveWebSocketUrl(httpUrl: string | null): string | null {
  if (httpUrl == null) return null;

  try {
    const parsed = new URL(httpUrl);
    if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
      return parsed.toString();
    }

    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function uniqueEndpoints(endpoints: RpcProviderEndpoint[]): RpcProviderEndpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.transport}:${endpoint.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readNetworkUrl(
  bindings: Bindings,
  network: Network,
  provider: 'helius' | 'alchemy',
  transport: 'http' | 'websocket',
): string | undefined {
  if (provider === 'helius') {
    if (transport === 'websocket') {
      return network === 'devnet' ? bindings.HELIUS_DEVNET_WS_URL : bindings.HELIUS_MAINNET_WS_URL;
    }
    return network === 'devnet' ? bindings.HELIUS_DEVNET_RPC_URL : bindings.HELIUS_MAINNET_RPC_URL;
  }

  if (transport === 'websocket') return undefined;

  return network === 'devnet' ? bindings.ALCHEMY_DEVNET_RPC_URL : bindings.ALCHEMY_MAINNET_RPC_URL;
}

function readAlchemyFallbackRpcUrl(bindings: Bindings, network: Network): string | undefined {
  return network === 'devnet'
    ? bindings.ALCHEMY_DEVNET_FALLBACK_RPC_URL
    : bindings.ALCHEMY_MAINNET_FALLBACK_RPC_URL;
}

function readHeliusApiKey(bindings: Bindings, network: Network): string | null {
  const apiKey =
    network === 'devnet' ? bindings.HELIUS_DEVNET_API_KEY : bindings.HELIUS_MAINNET_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return null;
  }

  return apiKey.trim();
}

function applyHeliusApiKey(url: string, apiKey: string | null): string {
  if (apiKey == null) {
    return url;
  }

  const parsed = new URL(url);
  if (!parsed.searchParams.has('api-key')) {
    parsed.searchParams.set('api-key', apiKey);
  }
  return parsed.toString();
}

function deriveHeliusRpcUrlFromApiKey(bindings: Bindings, network: Network): string | null {
  const apiKey = readHeliusApiKey(bindings, network);
  if (apiKey == null) {
    return null;
  }

  const url = new URL(
    network === 'devnet' ? 'https://devnet.helius-rpc.com/' : 'https://mainnet.helius-rpc.com/',
  );
  url.searchParams.set('api-key', apiKey);
  return url.toString();
}

export function getHeliusRpcHttpUrlCandidate(
  bindings: Bindings,
  network: Network,
): RpcProviderEndpoint | null {
  const configuredUrl = readConfiguredUrl(readNetworkUrl(bindings, network, 'helius', 'http'), [
    'http:',
    'https:',
  ]);
  const derivedUrl =
    configuredUrl == null
      ? deriveHeliusRpcUrlFromApiKey(bindings, network)
      : applyHeliusApiKey(configuredUrl, readHeliusApiKey(bindings, network));
  if (derivedUrl == null) {
    return null;
  }

  return { provider: 'helius', transport: 'http', url: derivedUrl };
}

export function getRpcHttpUrlCandidates(
  bindings: Bindings,
  network: Network,
): RpcProviderEndpoint[] {
  const heliusEndpoint = getHeliusRpcHttpUrlCandidate(bindings, network);
  const alchemyUrl = readConfiguredUrl(readNetworkUrl(bindings, network, 'alchemy', 'http'), [
    'http:',
    'https:',
  ]);
  const alchemyFallbackUrl = readConfiguredUrl(readAlchemyFallbackRpcUrl(bindings, network), [
    'http:',
    'https:',
  ]);

  return uniqueEndpoints([
    ...(heliusEndpoint != null ? [heliusEndpoint] : []),
    ...(alchemyUrl != null
      ? [{ provider: 'alchemy' as const, transport: 'http' as const, url: alchemyUrl }]
      : []),
    ...(alchemyFallbackUrl != null
      ? [{ provider: 'alchemy' as const, transport: 'http' as const, url: alchemyFallbackUrl }]
      : []),
  ]);
}

export function getRpcWebSocketUrlCandidates(
  bindings: Bindings,
  network: Network,
): RpcProviderEndpoint[] {
  const heliusHttpUrl = readConfiguredUrl(readNetworkUrl(bindings, network, 'helius', 'http'), [
    'http:',
    'https:',
  ]);
  const heliusWsUrl =
    readConfiguredUrl(readNetworkUrl(bindings, network, 'helius', 'websocket'), ['ws:', 'wss:']) ??
    deriveWebSocketUrl(heliusHttpUrl);

  return uniqueEndpoints([
    ...(heliusWsUrl != null
      ? [{ provider: 'helius' as const, transport: 'websocket' as const, url: heliusWsUrl }]
      : []),
  ]);
}

export function hasConfiguredRpcHttp(bindings: Bindings, network: Network): boolean {
  return getRpcHttpUrlCandidates(bindings, network).length > 0;
}
