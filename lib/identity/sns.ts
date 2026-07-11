import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { fetchSnsProxyResult } from '@/lib/identity/sns-proxy';

const SNS_CACHE_TTL_MS = 60 * 1000;
const SNS_RESOLUTION_TIMEOUT_MS = 6_000;

interface CachedSnsResolution {
  address: string;
  expiresAt: number;
}

const snsResolutionCache = new Map<string, CachedSnsResolution>();

export function normalizeSnsNameInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^@+/, '') ?? '';
  if (trimmed.length === 0 || isValidSolanaAddress(trimmed)) return null;
  if (trimmed.length > 128 || /\s/.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  const normalized = trimmed.toLowerCase();
  return normalized.endsWith('.sol') ? normalized : `${normalized}.sol`;
}

export function isSnsNameInput(value: string | null | undefined): boolean {
  return normalizeSnsNameInput(value) != null;
}

async function resolveSnsNameWithoutTimeout(domain: string): Promise<string> {
  const address = await fetchSnsProxyResult({
    path: `resolve/${encodeURIComponent(domain)}`,
    timeoutMs: SNS_RESOLUTION_TIMEOUT_MS,
    timeoutMessage: 'SNS lookup timed out. Check the name or paste a wallet address.',
  });
  if (address == null) {
    throw new Error('SNS name was not found. Check the name or paste a wallet address.');
  }
  if (!isValidSolanaAddress(address)) {
    throw new Error('SNS resolved to an invalid wallet address.');
  }

  snsResolutionCache.set(domain, {
    address,
    expiresAt: Date.now() + SNS_CACHE_TTL_MS,
  });

  return address;
}

export async function resolveSnsName(value: string): Promise<string> {
  const domain = normalizeSnsNameInput(value);
  if (domain == null) {
    throw new Error('Enter a valid Solana address or SNS name.');
  }

  const cached = snsResolutionCache.get(domain);
  if (cached != null && cached.expiresAt > Date.now()) {
    return cached.address;
  }

  return resolveSnsNameWithoutTimeout(domain);
}
