import { getOfflineTokenContext } from '@/lib/api/offpay-api-client';
import {
  readPersistedJson,
  readPersistedJsonSync,
  writePersistedJson,
} from '@/lib/cache/persistent-json-cache';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { getUmbraSupportedTokens } from '@/lib/umbra/umbra-supported-tokens';

import type {
  OfflineTokenContextResponse,
  OfflineSupportedStablecoin,
  OffpayNetwork,
  SwapTokensResponse,
  WalletBalanceResponse,
} from '@/types/offpay-api';

const TOKEN_METADATA_KEY_PREFIX = 'offpay_offline_token_metadata_v1';
const TOKEN_CONTEXT_KEY_PREFIX = 'offpay_offline_token_context_v1';
const TOKEN_METADATA_VERSION = 1;
const TOKEN_CONTEXT_VERSION = 1;
const TOKEN_CONTEXT_STALE_MS = 24 * 60 * 60 * 1000;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const NETWORK_DEFAULT_USDC_MINT: Record<OffpayNetwork, string> = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
const NETWORK_DEFAULT_USDT_MINTS: Partial<Record<OffpayNetwork, string>> = {
  mainnet: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

export interface OfflineTokenMetadata {
  mint: string;
  symbol: string;
  name: string;
  logo?: string | null;
  decimals: number;
  verified: boolean;
  updatedAt: number;
  programId?: string | null;
}

interface OfflineTokenMetadataSnapshot {
  version: 1;
  network: OffpayNetwork;
  tokens: OfflineTokenMetadata[];
}

export interface CachedOfflineTokenContext {
  version: 1;
  network: OffpayNetwork;
  sender: string;
  recipient: string;
  mint: string;
  symbol: 'USDC' | 'USDT';
  name: string;
  decimals: number;
  programId: string;
  senderTokenAccount: {
    associatedTokenAddress: string;
    accountExists: boolean;
  };
  recipientTokenAccount: {
    associatedTokenAddress: string;
    accountExists: boolean;
  };
  fetchedAt: number;
}

const memorySnapshots = new Map<OffpayNetwork, OfflineTokenMetadataSnapshot>();
const writeLocks = new Map<OffpayNetwork, Promise<void>>();
const tokenContextMemory = new Map<string, CachedOfflineTokenContext>();

function storageKey(network: OffpayNetwork): string {
  return `${TOKEN_METADATA_KEY_PREFIX}_${String(network).replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function tokenContextStorageKey(params: {
  network: OffpayNetwork;
  sender: string;
  recipient: string;
  mint: string;
}): string {
  return [TOKEN_CONTEXT_KEY_PREFIX, params.network, params.sender, params.recipient, params.mint]
    .map((part) => String(part).replace(/[^A-Za-z0-9._-]/g, '_'))
    .join('_');
}

function getBuiltInEntries(network: OffpayNetwork): OfflineTokenMetadata[] {
  const updatedAt = 0;
  const defaultEntries: OfflineTokenMetadata[] = [
    {
      mint: NATIVE_SOL_MINT,
      symbol: 'SOL',
      name: 'Solana',
      logo: null,
      decimals: 9,
      verified: true,
      updatedAt,
    },
    {
      mint: NETWORK_DEFAULT_USDC_MINT[network],
      symbol: 'USDC',
      name: 'USD Coin',
      logo: null,
      decimals: 6,
      verified: true,
      updatedAt,
    },
    ...(NETWORK_DEFAULT_USDT_MINTS[network] != null
      ? [
          {
            mint: NETWORK_DEFAULT_USDT_MINTS[network],
            symbol: 'USDT',
            name: 'Tether USD',
            logo: null,
            decimals: 6,
            verified: true,
            updatedAt,
          },
        ]
      : []),
  ];
  const defaultMints = new Set(defaultEntries.map((entry) => entry.mint));
  const umbraEntries = getUmbraSupportedTokens(network)
    .filter((token) => !defaultMints.has(token.mint))
    .map((token) => ({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: null,
      decimals: token.decimals,
      verified: true,
      updatedAt,
    }));

  return mergeMetadataEntries(defaultEntries, umbraEntries);
}

function baseSnapshot(network: OffpayNetwork): OfflineTokenMetadataSnapshot {
  return {
    version: TOKEN_METADATA_VERSION,
    network,
    tokens: getBuiltInEntries(network),
  };
}

function getBuiltInNativeSolEntry(network: OffpayNetwork): OfflineTokenMetadata | null {
  return getBuiltInEntries(network).find((entry) => entry.mint === NATIVE_SOL_MINT) ?? null;
}

function normalizeMetadataCandidate(
  candidate: Partial<OfflineTokenMetadata> | null | undefined,
): OfflineTokenMetadata | null {
  if (candidate == null) return null;
  if (
    typeof candidate.mint !== 'string' ||
    typeof candidate.symbol !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.decimals !== 'number'
  ) {
    return null;
  }

  const mint = candidate.mint.trim();
  const symbol = candidate.symbol.trim().toUpperCase();
  const name = candidate.name.trim();
  if (!isValidSolanaAddress(mint) || symbol.length === 0 || name.length === 0) {
    return null;
  }

  const decimals = Math.trunc(candidate.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return null;
  }

  return {
    mint,
    symbol,
    name,
    logo:
      typeof candidate.logo === 'string' && candidate.logo.trim().length > 0
        ? candidate.logo.trim()
        : null,
    decimals,
    verified: candidate.verified === true,
    updatedAt:
      typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : Date.now(),
    programId:
      typeof candidate.programId === 'string' && isValidSolanaAddress(candidate.programId)
        ? candidate.programId
        : null,
  };
}

function mergeMetadataEntries(
  existing: OfflineTokenMetadata[],
  observed: OfflineTokenMetadata[],
): OfflineTokenMetadata[] {
  const merged = new Map<string, OfflineTokenMetadata>();

  for (const entry of [...existing, ...observed]) {
    const current = merged.get(entry.mint);
    if (current == null) {
      merged.set(entry.mint, entry);
      continue;
    }

    merged.set(entry.mint, {
      mint: entry.mint,
      symbol: entry.symbol.length > 0 ? entry.symbol : current.symbol,
      name: entry.name.length > 0 ? entry.name : current.name,
      logo: entry.logo ?? current.logo ?? null,
      decimals: entry.updatedAt >= current.updatedAt ? entry.decimals : current.decimals,
      verified: current.verified || entry.verified,
      updatedAt: Math.max(current.updatedAt, entry.updatedAt),
      programId: entry.programId ?? current.programId ?? null,
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function normalizeSnapshotValue(
  network: OffpayNetwork,
  value: unknown,
): OfflineTokenMetadataSnapshot | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<OfflineTokenMetadataSnapshot>;
  if (candidate.version !== TOKEN_METADATA_VERSION || candidate.network !== network) {
    return null;
  }

  if (!Array.isArray(candidate.tokens)) {
    return null;
  }

  const observed = candidate.tokens.flatMap((entry) => {
    const normalized = normalizeMetadataCandidate(entry);
    return normalized == null ? [] : [normalized];
  });

  return {
    version: TOKEN_METADATA_VERSION,
    network,
    tokens: mergeMetadataEntries(getBuiltInEntries(network), observed),
  };
}

async function loadSnapshot(network: OffpayNetwork): Promise<OfflineTokenMetadataSnapshot> {
  const cached = memorySnapshots.get(network);
  if (cached != null) {
    return cached;
  }

  const snapshot =
    (await readPersistedJson(storageKey(network), (value) =>
      normalizeSnapshotValue(network, value),
    )) ?? baseSnapshot(network);
  memorySnapshots.set(network, snapshot);
  return snapshot;
}

async function persistSnapshot(snapshot: OfflineTokenMetadataSnapshot): Promise<void> {
  memorySnapshots.set(snapshot.network, snapshot);
  await writePersistedJson(storageKey(snapshot.network), snapshot);
}

async function withWriteLock(network: OffpayNetwork, task: () => Promise<void>): Promise<void> {
  const previous = writeLocks.get(network) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await task();
      } finally {
        release();
      }
    });

  writeLocks.set(network, gate);

  try {
    await next;
  } finally {
    if (writeLocks.get(network) === gate) {
      writeLocks.delete(network);
    }
  }
}

export async function observeOfflineTokenMetadataFromWalletBalance(
  balance: WalletBalanceResponse,
): Promise<void> {
  const observed = balance.tokens.flatMap((token) => {
    const normalized = normalizeMetadataCandidate({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      decimals: token.decimals,
      verified: token.verified,
      updatedAt: balance.fetchedAt,
      programId:
        'programId' in token && typeof token.programId === 'string' ? token.programId : null,
    });

    return normalized == null ? [] : [normalized];
  });

  if (observed.length === 0) {
    return;
  }

  await withWriteLock(balance.network, async () => {
    const current = await loadSnapshot(balance.network);
    await persistSnapshot({
      ...current,
      tokens: mergeMetadataEntries(current.tokens, observed),
    });
  });
}

export async function observeOfflineTokenMetadataFromSwapTokens(
  network: OffpayNetwork,
  tokens: SwapTokensResponse['tokens'],
): Promise<void> {
  const observed = tokens.flatMap((token) => {
    const normalized = normalizeMetadataCandidate({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      logo: token.logo,
      decimals: token.decimals,
      verified: token.verified,
      updatedAt: Date.now(),
      programId:
        'programId' in token && typeof token.programId === 'string' ? token.programId : null,
    });

    return normalized == null ? [] : [normalized];
  });

  if (observed.length === 0) {
    return;
  }

  await withWriteLock(network, async () => {
    const current = await loadSnapshot(network);
    await persistSnapshot({
      ...current,
      tokens: mergeMetadataEntries(current.tokens, observed),
    });
  });
}

export async function observeOfflineSupportedStablecoins(
  network: OffpayNetwork,
  stablecoins: OfflineSupportedStablecoin[] | null | undefined,
): Promise<void> {
  const observed = (stablecoins ?? []).flatMap((token) => {
    if (!token.enabled) return [];
    const normalized = normalizeMetadataCandidate({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name ?? token.symbol,
      decimals: token.decimals,
      verified: true,
      updatedAt: Date.now(),
      programId: token.programId,
    });

    return normalized == null ? [] : [normalized];
  });

  if (observed.length === 0) return;

  await withWriteLock(network, async () => {
    const current = await loadSnapshot(network);
    await persistSnapshot({
      ...current,
      tokens: mergeMetadataEntries(current.tokens, observed),
    });
  });
}

export async function getOfflineTokenMetadata(
  network: OffpayNetwork,
  token: string | null | undefined,
): Promise<OfflineTokenMetadata | null> {
  const normalized = token?.trim();
  if (normalized == null || normalized.length === 0) {
    return getBuiltInNativeSolEntry(network);
  }

  const upper = normalized.toUpperCase();
  if (upper === 'SOL' || upper === 'WSOL' || normalized === NATIVE_SOL_MINT) {
    return getBuiltInNativeSolEntry(network);
  }
  if (upper === 'USDC' || upper === 'USDT') {
    const builtIn = getBuiltInEntries(network).find((entry) => entry.symbol === upper);
    if (builtIn != null) return builtIn;
    const snapshot = await loadSnapshot(network);
    return snapshot.tokens.find((entry) => entry.symbol === upper) ?? null;
  }

  if (!isValidSolanaAddress(normalized)) {
    return null;
  }

  const snapshot = await loadSnapshot(network);
  return snapshot.tokens.find((entry) => entry.mint === normalized) ?? null;
}

export async function getOfflineTokenMetadataEntries(
  network: OffpayNetwork,
): Promise<OfflineTokenMetadata[]> {
  const snapshot = await loadSnapshot(network);
  return snapshot.tokens;
}

export function getCachedOfflineTokenMetadataEntries(
  network: OffpayNetwork,
): OfflineTokenMetadata[] {
  const cached = memorySnapshots.get(network);
  if (cached != null) return cached.tokens;

  const persisted = readPersistedJsonSync(storageKey(network), (value) =>
    normalizeSnapshotValue(network, value),
  );
  if (persisted != null) {
    memorySnapshots.set(network, persisted);
    return persisted.tokens;
  }

  return baseSnapshot(network).tokens;
}

export async function getOfflineTokenDecimals(
  network: OffpayNetwork,
  token: string | null | undefined,
): Promise<number | null> {
  const entry = await getOfflineTokenMetadata(network, token);
  return entry?.decimals ?? null;
}

function normalizeTokenContextResponse(
  response: OfflineTokenContextResponse,
): CachedOfflineTokenContext | null {
  if (
    !isValidSolanaAddress(response.sender) ||
    !isValidSolanaAddress(response.recipient) ||
    !isValidSolanaAddress(response.mint) ||
    !isValidSolanaAddress(response.programId) ||
    !isValidSolanaAddress(response.senderTokenAccount.associatedTokenAddress) ||
    !isValidSolanaAddress(response.recipientTokenAccount.associatedTokenAddress)
  ) {
    return null;
  }

  if (response.symbol !== 'USDC' && response.symbol !== 'USDT') {
    return null;
  }

  if (!Number.isInteger(response.decimals) || response.decimals < 0 || response.decimals > 255) {
    return null;
  }

  return {
    version: TOKEN_CONTEXT_VERSION,
    network: response.network,
    sender: response.sender,
    recipient: response.recipient,
    mint: response.mint,
    symbol: response.symbol,
    name: response.name,
    decimals: response.decimals,
    programId: response.programId,
    senderTokenAccount: response.senderTokenAccount,
    recipientTokenAccount: response.recipientTokenAccount,
    fetchedAt: response.fetchedAt,
  };
}

function normalizeCachedTokenContext(value: unknown): CachedOfflineTokenContext | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return null;
  const candidate = value as Partial<CachedOfflineTokenContext>;
  if (candidate.version !== TOKEN_CONTEXT_VERSION) return null;
  if (candidate.network !== 'mainnet' && candidate.network !== 'devnet') return null;
  if (
    typeof candidate.sender !== 'string' ||
    typeof candidate.recipient !== 'string' ||
    typeof candidate.mint !== 'string' ||
    typeof candidate.symbol !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.decimals !== 'number' ||
    typeof candidate.programId !== 'string' ||
    typeof candidate.fetchedAt !== 'number' ||
    candidate.senderTokenAccount == null ||
    candidate.recipientTokenAccount == null
  ) {
    return null;
  }

  return normalizeTokenContextResponse({
    network: candidate.network,
    sender: candidate.sender,
    recipient: candidate.recipient,
    mint: candidate.mint,
    symbol: candidate.symbol === 'USDT' ? 'USDT' : 'USDC',
    name: candidate.name,
    decimals: candidate.decimals,
    programId: candidate.programId,
    senderTokenAccount: candidate.senderTokenAccount,
    recipientTokenAccount: candidate.recipientTokenAccount,
    supportedStablecoins: [],
    fetchedAt: candidate.fetchedAt,
  });
}

export function isCachedOfflineTokenContextStale(context: CachedOfflineTokenContext): boolean {
  return Date.now() - context.fetchedAt > TOKEN_CONTEXT_STALE_MS;
}

export async function cacheOfflineTokenContext(
  response: OfflineTokenContextResponse,
): Promise<CachedOfflineTokenContext> {
  const context = normalizeTokenContextResponse(response);
  if (context == null) {
    throw new Error('Offline token context response is not valid for local caching.');
  }

  const key = tokenContextStorageKey(context);
  tokenContextMemory.set(key, context);
  await writePersistedJson(key, context);

  await withWriteLock(context.network, async () => {
    const current = await loadSnapshot(context.network);
    await persistSnapshot({
      ...current,
      tokens: mergeMetadataEntries(current.tokens, [
        {
          mint: context.mint,
          symbol: context.symbol,
          name: context.name,
          decimals: context.decimals,
          verified: true,
          updatedAt: context.fetchedAt,
          programId: context.programId,
        },
      ]),
    });
  });

  return context;
}

export async function fetchAndCacheOfflineTokenContext(params: {
  network: OffpayNetwork;
  sender: string;
  recipient: string;
  mint: string;
}): Promise<CachedOfflineTokenContext> {
  const response = await getOfflineTokenContext(params);
  return cacheOfflineTokenContext(response);
}

export async function getCachedOfflineTokenContext(params: {
  network: OffpayNetwork;
  sender: string;
  recipient: string;
  token: string | null | undefined;
}): Promise<CachedOfflineTokenContext | null> {
  const metadata = await getOfflineTokenMetadata(params.network, params.token);
  if (metadata == null) return null;

  const key = tokenContextStorageKey({
    network: params.network,
    sender: params.sender,
    recipient: params.recipient,
    mint: metadata.mint,
  });
  const memoryContext = tokenContextMemory.get(key);
  if (memoryContext != null) return memoryContext;

  const context = await readPersistedJson(key, normalizeCachedTokenContext);
  if (context == null) return null;
  tokenContextMemory.set(key, context);
  return context;
}

export function resetOfflineTokenMetadataCache(): void {
  memorySnapshots.clear();
  writeLocks.clear();
  tokenContextMemory.clear();
}
