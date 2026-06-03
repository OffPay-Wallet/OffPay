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

export function getRpcHttpUrlCandidates(
  bindings: Bindings,
  network: Network,
): RpcProviderEndpoint[] {
  const heliusUrl = readConfiguredUrl(readNetworkUrl(bindings, network, 'helius', 'http'), [
    'http:',
    'https:',
  ]);
  const alchemyUrl = readConfiguredUrl(readNetworkUrl(bindings, network, 'alchemy', 'http'), [
    'http:',
    'https:',
  ]);
  const alchemyFallbackUrl = readConfiguredUrl(readAlchemyFallbackRpcUrl(bindings, network), [
    'http:',
    'https:',
  ]);

  return uniqueEndpoints([
    ...(heliusUrl != null
      ? [{ provider: 'helius' as const, transport: 'http' as const, url: heliusUrl }]
      : []),
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
