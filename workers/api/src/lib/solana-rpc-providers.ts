import type { Bindings, Network } from './types.js';

export interface RpcProviderEndpoint {
  provider: 'quicknode' | 'helius';
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

function uniqueEndpoints(endpoints: RpcProviderEndpoint[]): RpcProviderEndpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = endpoint.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getRpcHttpUrlCandidates(
  bindings: Bindings,
  network: Network,
): RpcProviderEndpoint[] {
  const quickNodeUrl = readConfiguredUrl(
    network === 'devnet'
      ? bindings.QUICKNODE_DEVNET_RPC_URL
      : bindings.QUICKNODE_MAINNET_RPC_URL,
    ['http:', 'https:'],
  );
  const heliusUrl = readConfiguredUrl(
    network === 'devnet' ? bindings.HELIUS_DEVNET_RPC_URL : bindings.HELIUS_MAINNET_RPC_URL,
    ['http:', 'https:'],
  );

  return uniqueEndpoints([
    ...(quickNodeUrl != null
      ? [{ provider: 'quicknode' as const, url: quickNodeUrl }]
      : []),
    ...(heliusUrl != null
      ? [{ provider: 'helius' as const, url: heliusUrl }]
      : []),
  ]);
}
