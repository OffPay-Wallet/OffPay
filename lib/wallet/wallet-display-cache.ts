import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  offpayWalletTransactionsQueryKey,
  pendingBackupQueueStatsQueryKey,
  WALLET_TRANSACTIONS_PAGE_SIZE,
} from '@/lib/api/offpay-wallet-query-keys';
import { getWalletBalance, getWalletTransactions } from '@/lib/api/offpay-api-client';
import { getPendingBackupQueueStats } from '@/lib/payments/pending-backup-queue';
import {
  deletePersistedJson,
  readPersistedJson,
  writePersistedJson,
} from '@/lib/cache/persistent-json-cache';
import { yieldToEventLoop, yieldToUi } from '@/lib/perf/ui-work-scheduler';

import type { PendingBackupQueueStats } from '@/lib/payments/pending-backup-queue';
import type {
  OffpayNetwork,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

const CACHE_VERSION = 2;
const CACHE_KEY_PREFIX = 'offpay_wallet_display_cache_v2';
const MAX_CACHED_TOKENS = 24;
const MAX_CACHED_TRANSACTIONS = 20;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const cacheWriteLocks = new Map<string, Promise<void>>();

interface WalletDisplayCache {
  version: 2;
  walletAddress: string;
  network: OffpayNetwork;
  balance: WalletBalanceResponse | null;
  transactions: WalletTransactionsResponse | null;
  pendingBackupStats: PendingBackupQueueStats | null;
  updatedAt: number;
}

export interface WalletDisplayCacheSlice {
  walletAddress: string;
  network: OffpayNetwork;
  balance?: WalletBalanceResponse | null;
  transactions?: WalletTransactionsResponse | null;
  pendingBackupStats?: PendingBackupQueueStats | null;
  replaceTransactions?: boolean;
}

interface WalletDisplayCacheHydrationOptions {
  includeBalance?: boolean;
  includeTransactions?: boolean;
  includePendingBackupStats?: boolean;
}

interface WalletDisplayCachePersistenceOptions {
  includeBalance?: boolean;
  includeTransactions?: boolean;
  includePendingBackupStats?: boolean;
}

export interface ApplyCachedOfflineDebitParams {
  queryClient: QueryClient;
  walletAddress: string;
  network: OffpayNetwork;
  tokenMint: string;
  rawAmount: string;
}

export interface ApplyCachedOfflineCreditParams extends ApplyCachedOfflineDebitParams {
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenLogo?: string | null;
  tokenDecimals?: number | null;
}

export interface UpsertWalletTransactionParams {
  queryClient: QueryClient;
  walletAddress: string;
  network: OffpayNetwork;
  transaction: WalletTransactionsResponse['transactions'][number];
}

type WalletTransaction = WalletTransactionsResponse['transactions'][number];

function safeKeyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function cacheKey(walletAddress: string, network: OffpayNetwork): string {
  return `${CACHE_KEY_PREFIX}_${safeKeyPart(network)}_${safeKeyPart(walletAddress)}`;
}

async function withCacheWriteLock(key: string, task: () => Promise<void>): Promise<void> {
  const previous = cacheWriteLocks.get(key) ?? Promise.resolve();
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

  cacheWriteLocks.set(key, gate);

  try {
    await next;
  } finally {
    if (cacheWriteLocks.get(key) === gate) {
      cacheWriteLocks.delete(key);
    }
  }
}

function trimBalance(
  balance: WalletBalanceResponse | null | undefined,
): WalletBalanceResponse | null {
  if (balance == null) return null;
  return {
    ...balance,
    tokens: balance.tokens.slice(0, MAX_CACHED_TOKENS),
  };
}

function nonEmptyText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : null;
}

function isSwapTransactionRecord(transaction: WalletTransaction): boolean {
  const normalized = `${transaction.type} ${transaction.description ?? ''}`.toLowerCase();
  return (
    normalized.includes('swap') || normalized.includes('swapped') || normalized.includes('jupiter')
  );
}

function isUnenrichedTransactionRecord(transaction: WalletTransaction): boolean {
  return transaction.type === 'unknown';
}

function isGenericTransactionDescription(value: string | null | undefined): boolean {
  const normalized = value?.trim();
  return (
    normalized != null &&
    (/^Tx\s+\S+\.\.\.\S+$/i.test(normalized) || normalized === 'Solana transaction')
  );
}

function hasDisplayMetadata(transaction: WalletTransaction | null | undefined): boolean {
  if (transaction == null) return false;
  return Boolean(
    nonEmptyText(transaction.amount) != null ||
    nonEmptyText(transaction.rawAmount) != null ||
    nonEmptyText(transaction.tokenMint) != null ||
    nonEmptyText(transaction.tokenSymbol) != null ||
    nonEmptyText(transaction.sender) != null ||
    nonEmptyText(transaction.recipient) != null ||
    transaction.direction === 'send' ||
    transaction.direction === 'receive',
  );
}

function sortWalletTransactionRecords(
  transactions: readonly WalletTransaction[],
): WalletTransaction[] {
  return [...transactions].sort((left, right) => {
    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.signature.localeCompare(right.signature);
  });
}

function mergeWalletTransactionRecord(
  existing: WalletTransaction | null | undefined,
  incoming: WalletTransaction,
): WalletTransaction {
  if (existing == null) return incoming;

  const keepExistingSwapMetadata =
    isSwapTransactionRecord(existing) && !isSwapTransactionRecord(incoming);
  const keepExistingDisplayMetadata =
    isUnenrichedTransactionRecord(incoming) && hasDisplayMetadata(existing);
  const incomingDescription = nonEmptyText(incoming.description);
  const existingDescription = nonEmptyText(existing.description);
  const shouldDropExistingGenericDescription =
    hasDisplayMetadata(incoming) && isGenericTransactionDescription(existingDescription);

  return {
    ...incoming,
    type: keepExistingSwapMetadata || keepExistingDisplayMetadata ? existing.type : incoming.type,
    description: keepExistingSwapMetadata
      ? (existing.description ?? incoming.description ?? null)
      : shouldDropExistingGenericDescription
        ? (incomingDescription ?? null)
        : (incomingDescription ?? existing.description ?? null),
    amount: nonEmptyText(incoming.amount) ?? existing.amount ?? null,
    rawAmount: nonEmptyText(incoming.rawAmount) ?? existing.rawAmount ?? null,
    tokenMint: nonEmptyText(incoming.tokenMint) ?? existing.tokenMint ?? null,
    tokenSymbol: nonEmptyText(incoming.tokenSymbol) ?? existing.tokenSymbol ?? null,
    tokenName: nonEmptyText(incoming.tokenName) ?? existing.tokenName ?? null,
    tokenLogo: nonEmptyText(incoming.tokenLogo) ?? existing.tokenLogo ?? null,
    tokenDecimals: incoming.tokenDecimals ?? existing.tokenDecimals ?? null,
    direction: incoming.direction ?? existing.direction ?? null,
    sender: nonEmptyText(incoming.sender) ?? existing.sender ?? null,
    recipient: nonEmptyText(incoming.recipient) ?? existing.recipient ?? null,
    counterparties: incoming.counterparties,
  };
}

function mergeWalletTransactionRecords(
  primary: readonly WalletTransaction[],
  fallback: readonly WalletTransaction[] = [],
  maxTransactions = MAX_CACHED_TRANSACTIONS,
): WalletTransaction[] {
  const bySignature = new Map<string, WalletTransaction>();

  for (const transaction of fallback) {
    bySignature.set(transaction.signature, transaction);
  }

  for (const transaction of primary) {
    bySignature.set(
      transaction.signature,
      mergeWalletTransactionRecord(bySignature.get(transaction.signature), transaction),
    );
  }

  return sortWalletTransactionRecords(Array.from(bySignature.values())).slice(0, maxTransactions);
}

export function mergeWalletTransactionPage(
  page: WalletTransactionsResponse,
  fallback?: WalletTransactionsResponse | null,
): WalletTransactionsResponse {
  const fallbackTransactions =
    fallback != null && fallback.address === page.address && fallback.network === page.network
      ? fallback.transactions
      : [];
  const maxTransactions = Math.max(
    page.transactions.length,
    fallbackTransactions.length,
    WALLET_TRANSACTIONS_PAGE_SIZE,
  );

  return {
    ...page,
    transactions: mergeWalletTransactionRecords(
      page.transactions,
      fallbackTransactions,
      maxTransactions,
    ),
  };
}

function mergeWalletTransactionPageMetadata(
  page: WalletTransactionsResponse,
  fallback?: WalletTransactionsResponse | null,
): WalletTransactionsResponse {
  const fallbackTransactions =
    fallback != null && fallback.address === page.address && fallback.network === page.network
      ? fallback.transactions
      : [];
  const fallbackBySignature = new Map<string, WalletTransaction>();

  for (const transaction of fallbackTransactions) {
    fallbackBySignature.set(
      transaction.signature,
      mergeWalletTransactionRecord(fallbackBySignature.get(transaction.signature), transaction),
    );
  }

  return {
    ...page,
    transactions: sortWalletTransactionRecords(
      page.transactions.map((transaction) =>
        mergeWalletTransactionRecord(fallbackBySignature.get(transaction.signature), transaction),
      ),
    ),
  };
}

function trimTransactions(
  transactions: WalletTransactionsResponse | null | undefined,
): WalletTransactionsResponse | null {
  if (transactions == null) return null;
  return {
    ...transactions,
    transactions: sortWalletTransactionRecords(transactions.transactions).slice(
      0,
      MAX_CACHED_TRANSACTIONS,
    ),
  };
}

function decimalStringToAtomicAmount(value: string, decimals: number): bigint | null {
  const normalized = value.trim().replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (match == null) return null;

  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(decimals, '0').slice(0, decimals);
  const atomicText = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
  return BigInt(atomicText);
}

function atomicAmountToDecimalString(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toString();

  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText}`;
}

function isNativeSolMint(value: string): boolean {
  const normalized = value.trim();
  return normalized === 'SOL' || normalized === 'native-sol' || normalized === NATIVE_SOL_MINT;
}

function applyDebitToBalance(
  balance: WalletBalanceResponse,
  params: Pick<ApplyCachedOfflineDebitParams, 'tokenMint' | 'rawAmount'>,
): WalletBalanceResponse {
  if (!/^\d+$/.test(params.rawAmount)) return balance;
  const rawAmount = BigInt(params.rawAmount);
  if (rawAmount <= 0n) return balance;

  if (isNativeSolMint(params.tokenMint)) {
    const nextSolLamports = Number(
      BigInt(Math.max(0, Math.trunc(balance.solBalance))) > rawAmount
        ? BigInt(Math.max(0, Math.trunc(balance.solBalance))) - rawAmount
        : 0n,
    );
    return {
      ...balance,
      solBalance: nextSolLamports,
      fetchedAt: Date.now(),
    };
  }

  let changed = false;
  const tokens = balance.tokens.map((token) => {
    if (changed || token.mint !== params.tokenMint) return token;

    const current = decimalStringToAtomicAmount(token.balance, token.decimals);
    if (current == null) return token;

    changed = true;
    const next = current > rawAmount ? current - rawAmount : 0n;
    return {
      ...token,
      balance: atomicAmountToDecimalString(next, token.decimals),
    };
  });

  if (!changed) return balance;

  return {
    ...balance,
    tokens,
    fetchedAt: Date.now(),
  };
}

function applyCreditToBalance(
  balance: WalletBalanceResponse,
  params: Pick<
    ApplyCachedOfflineCreditParams,
    'tokenMint' | 'rawAmount' | 'tokenSymbol' | 'tokenName' | 'tokenLogo' | 'tokenDecimals'
  >,
): WalletBalanceResponse {
  if (!/^\d+$/.test(params.rawAmount)) return balance;
  const rawAmount = BigInt(params.rawAmount);
  if (rawAmount <= 0n) return balance;

  if (isNativeSolMint(params.tokenMint)) {
    return {
      ...balance,
      solBalance: Number(BigInt(Math.max(0, Math.trunc(balance.solBalance))) + rawAmount),
      fetchedAt: Date.now(),
    };
  }

  let changed = false;
  const tokens = balance.tokens.map((token) => {
    if (changed || token.mint !== params.tokenMint) return token;

    const current = decimalStringToAtomicAmount(token.balance, token.decimals);
    if (current == null) return token;

    changed = true;
    return {
      ...token,
      balance: atomicAmountToDecimalString(current + rawAmount, token.decimals),
    };
  });

  if (changed) {
    return {
      ...balance,
      tokens,
      fetchedAt: Date.now(),
    };
  }

  const decimals =
    typeof params.tokenDecimals === 'number' && Number.isInteger(params.tokenDecimals)
      ? Math.max(0, Math.min(255, params.tokenDecimals))
      : 6;
  return {
    ...balance,
    tokens: [
      ...tokens,
      {
        mint: params.tokenMint,
        name: params.tokenName?.trim() || params.tokenSymbol?.trim() || params.tokenMint,
        symbol: params.tokenSymbol?.trim() || params.tokenMint,
        logo: params.tokenLogo?.trim() || null,
        balance: atomicAmountToDecimalString(rawAmount, decimals),
        decimals,
        verified: true,
        spam: false,
      },
    ],
    fetchedAt: Date.now(),
  };
}

function upsertTransactionIntoPage(
  page: WalletTransactionsResponse,
  transaction: WalletTransaction,
): WalletTransactionsResponse {
  return {
    ...page,
    fetchedAt: Date.now(),
    transactions: mergeWalletTransactionRecords(
      [transaction],
      page.transactions,
      Math.max(page.transactions.length, WALLET_TRANSACTIONS_PAGE_SIZE),
    ),
  };
}

function isWalletDisplayCache(value: unknown): value is WalletDisplayCache {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) return false;
  const candidate = value as Partial<WalletDisplayCache>;
  return (
    candidate.version === CACHE_VERSION &&
    typeof candidate.walletAddress === 'string' &&
    (candidate.network === 'mainnet' || candidate.network === 'devnet') &&
    typeof candidate.updatedAt === 'number'
  );
}

async function readWalletDisplayCache(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<WalletDisplayCache | null> {
  return readPersistedJson(
    cacheKey(params.walletAddress, params.network),
    (value): WalletDisplayCache | null => {
      if (!isWalletDisplayCache(value)) return null;
      if (value.walletAddress !== params.walletAddress || value.network !== params.network) {
        return null;
      }
      return value;
    },
  );
}

export async function writeWalletDisplayCacheSlice(slice: WalletDisplayCacheSlice): Promise<void> {
  const key = cacheKey(slice.walletAddress, slice.network);
  await withCacheWriteLock(key, async () => {
    const current = await readWalletDisplayCache(slice);
    await yieldToUi();
    const next: WalletDisplayCache = {
      version: CACHE_VERSION,
      walletAddress: slice.walletAddress,
      network: slice.network,
      balance: 'balance' in slice ? trimBalance(slice.balance) : (current?.balance ?? null),
      transactions:
        'transactions' in slice
          ? slice.transactions == null
            ? null
            : trimTransactions(
                slice.replaceTransactions
                  ? slice.transactions
                  : mergeWalletTransactionPage(slice.transactions, current?.transactions),
              )
          : (current?.transactions ?? null),
      pendingBackupStats:
        'pendingBackupStats' in slice
          ? (slice.pendingBackupStats ?? null)
          : (current?.pendingBackupStats ?? null),
      updatedAt: Date.now(),
    };

    await yieldToEventLoop();
    await writePersistedJson(key, next);
  });
}

export async function deleteWalletDisplayCache(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<void> {
  await deletePersistedJson(cacheKey(params.walletAddress, params.network));
}

export async function mergeWalletTransactionsWithDisplayCache(params: {
  walletAddress: string;
  network: OffpayNetwork;
  transactions: WalletTransactionsResponse;
  fallback?: WalletTransactionsResponse | null;
}): Promise<WalletTransactionsResponse> {
  const cached = await readWalletDisplayCache(params);
  await yieldToUi();
  return mergeWalletTransactionPageMetadata(
    mergeWalletTransactionPageMetadata(params.transactions, params.fallback),
    cached?.transactions ?? null,
  );
}

export async function applyCachedOfflineDebit(
  params: ApplyCachedOfflineDebitParams,
): Promise<boolean> {
  const balanceKey = offpayWalletBalanceQueryKey(params.walletAddress, params.network);
  const existing =
    params.queryClient.getQueryData<WalletBalanceResponse>(balanceKey) ??
    (await readWalletDisplayCache(params))?.balance ??
    null;

  if (existing == null) return false;
  if (existing.address !== params.walletAddress || existing.network !== params.network) {
    return false;
  }

  const next = applyDebitToBalance(existing, params);
  if (next === existing) return false;

  await yieldToUi();
  params.queryClient.setQueryData(balanceKey, next, { updatedAt: Date.now() });
  await writeWalletDisplayCacheSlice({
    walletAddress: params.walletAddress,
    network: params.network,
    balance: next,
  });
  return true;
}

export async function applyCachedOfflineCredit(
  params: ApplyCachedOfflineCreditParams,
): Promise<boolean> {
  const balanceKey = offpayWalletBalanceQueryKey(params.walletAddress, params.network);
  const existing =
    params.queryClient.getQueryData<WalletBalanceResponse>(balanceKey) ??
    (await readWalletDisplayCache(params))?.balance ??
    null;

  if (existing == null) return false;
  if (existing.address !== params.walletAddress || existing.network !== params.network) {
    return false;
  }

  const next = applyCreditToBalance(existing, params);
  if (next === existing) return false;

  await yieldToUi();
  params.queryClient.setQueryData(balanceKey, next, { updatedAt: Date.now() });
  await writeWalletDisplayCacheSlice({
    walletAddress: params.walletAddress,
    network: params.network,
    balance: next,
  });
  return true;
}

export async function upsertWalletTransactionIntoCache(
  params: UpsertWalletTransactionParams,
): Promise<void> {
  const baseQueryKey = offpayWalletTransactionsBaseQueryKey(params.walletAddress, params.network);
  await yieldToUi();
  params.queryClient.setQueriesData<InfiniteData<WalletTransactionsResponse, unknown>>(
    {
      queryKey: baseQueryKey,
    },
    (current) => {
      if (current == null || current.pages.length === 0) return current;

      const [firstPage, ...remainingPages] = current.pages;
      if (firstPage == null) return current;
      if (firstPage.address !== params.walletAddress || firstPage.network !== params.network) {
        return current;
      }

      return {
        ...current,
        pages: [upsertTransactionIntoPage(firstPage, params.transaction), ...remainingPages],
      };
    },
  );

  const defaultQueryKey = offpayWalletTransactionsQueryKey(
    params.walletAddress,
    params.network,
    WALLET_TRANSACTIONS_PAGE_SIZE,
  );
  await yieldToUi();
  params.queryClient.setQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
    defaultQueryKey,
    (current) => {
      if (current != null) return current;

      return {
        pages: [
          {
            address: params.walletAddress,
            network: params.network,
            transactions: [params.transaction],
            cursor: null,
            fetchedAt: Date.now(),
          },
        ],
        pageParams: [undefined],
      };
    },
  );

  const defaultData =
    params.queryClient.getQueryData<InfiniteData<WalletTransactionsResponse, string | undefined>>(
      defaultQueryKey,
    );

  await writeWalletDisplayCacheSlice({
    walletAddress: params.walletAddress,
    network: params.network,
    transactions: defaultData?.pages[0] ?? {
      address: params.walletAddress,
      network: params.network,
      transactions: [params.transaction],
      cursor: null,
      fetchedAt: Date.now(),
    },
  });
}

export async function hydrateWalletDisplayCacheIntoQueryClient(params: {
  queryClient: QueryClient;
  walletAddress: string;
  network: OffpayNetwork;
  options?: WalletDisplayCacheHydrationOptions;
}): Promise<boolean> {
  const cache = await readWalletDisplayCache(params);
  if (cache == null) return false;
  const includeBalance = params.options?.includeBalance ?? true;
  const includeTransactions = params.options?.includeTransactions ?? true;
  const includePendingBackupStats = params.options?.includePendingBackupStats ?? true;

  const balanceKey = offpayWalletBalanceQueryKey(params.walletAddress, params.network);
  if (
    includeBalance &&
    cache.balance != null &&
    params.queryClient.getQueryData(balanceKey) == null
  ) {
    await yieldToUi();
    params.queryClient.setQueryData(balanceKey, cache.balance, { updatedAt: cache.updatedAt });
  }

  const transactionsKey = offpayWalletTransactionsQueryKey(
    params.walletAddress,
    params.network,
    WALLET_TRANSACTIONS_PAGE_SIZE,
  );
  if (
    includeTransactions &&
    cache.transactions != null &&
    params.queryClient.getQueryData(transactionsKey) == null
  ) {
    const infiniteData: InfiniteData<WalletTransactionsResponse, string | undefined> = {
      pages: [cache.transactions],
      pageParams: [undefined],
    };
    await yieldToUi();
    params.queryClient.setQueryData(transactionsKey, infiniteData, {
      updatedAt: cache.updatedAt,
    });
  }

  const statsKey = pendingBackupQueueStatsQueryKey(params.walletAddress, params.network);
  if (
    includePendingBackupStats &&
    cache.pendingBackupStats != null &&
    params.queryClient.getQueryData(statsKey) == null
  ) {
    await yieldToUi();
    params.queryClient.setQueryData(statsKey, cache.pendingBackupStats, {
      updatedAt: cache.updatedAt,
    });
  }

  return true;
}

export async function persistWalletDisplayCacheFromQueryClient(params: {
  queryClient: QueryClient;
  walletAddress: string;
  network: OffpayNetwork;
  options?: WalletDisplayCachePersistenceOptions;
}): Promise<void> {
  const includeBalance = params.options?.includeBalance ?? true;
  const includeTransactions = params.options?.includeTransactions ?? true;
  const includePendingBackupStats = params.options?.includePendingBackupStats ?? true;
  const transactionsData = params.queryClient.getQueryData<
    InfiniteData<WalletTransactionsResponse, string | undefined>
  >(
    offpayWalletTransactionsQueryKey(
      params.walletAddress,
      params.network,
      WALLET_TRANSACTIONS_PAGE_SIZE,
    ),
  );

  await writeWalletDisplayCacheSlice({
    walletAddress: params.walletAddress,
    network: params.network,
    balance: includeBalance
      ? params.queryClient.getQueryData<WalletBalanceResponse>(
          offpayWalletBalanceQueryKey(params.walletAddress, params.network),
        )
      : null,
    transactions: includeTransactions ? (transactionsData?.pages[0] ?? null) : undefined,
    replaceTransactions: true,
    pendingBackupStats: includePendingBackupStats
      ? params.queryClient.getQueryData<PendingBackupQueueStats>(
          pendingBackupQueueStatsQueryKey(params.walletAddress, params.network),
        )
      : undefined,
  });
}

export async function prefetchWalletDisplayData(params: {
  queryClient: QueryClient;
  walletAddress: string;
  network: OffpayNetwork;
  canFetchBalance: boolean;
  canFetchTransactions: boolean;
  forceRefresh?: boolean;
}): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  const walletBalanceStaleTime = params.forceRefresh ? 0 : 1000 * 15;
  const walletTransactionStaleTime = params.forceRefresh ? 0 : 1000 * 60 * 2;
  const queueStatsStaleTime = params.forceRefresh ? 0 : 1000 * 60;

  if (params.canFetchBalance) {
    tasks.push(
      params.queryClient.prefetchQuery({
        queryKey: offpayWalletBalanceQueryKey(params.walletAddress, params.network),
        queryFn: () =>
          getWalletBalance(params.walletAddress, params.network, {
            useCache: false,
            requestOwner: 'wallet.displayPrefetch.balance',
          }),
        staleTime: walletBalanceStaleTime,
      }),
    );
  }

  if (params.canFetchTransactions) {
    tasks.push(
      params.queryClient.prefetchInfiniteQuery({
        queryKey: offpayWalletTransactionsQueryKey(
          params.walletAddress,
          params.network,
          WALLET_TRANSACTIONS_PAGE_SIZE,
        ),
        queryFn: async ({ pageParam }) => {
          const page = await getWalletTransactions(params.walletAddress, params.network, {
            cursor: pageParam,
            limit: WALLET_TRANSACTIONS_PAGE_SIZE,
            requestOwner: 'wallet.displayPrefetch.transactions',
          });

          if (pageParam != null) return page;

          return mergeWalletTransactionsWithDisplayCache({
            walletAddress: params.walletAddress,
            network: params.network,
            transactions: page,
          });
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage: WalletTransactionsResponse) => lastPage.cursor ?? undefined,
        staleTime: walletTransactionStaleTime,
      }),
    );
  }

  tasks.push(
    params.queryClient.prefetchQuery({
      queryKey: pendingBackupQueueStatsQueryKey(params.walletAddress, params.network),
      queryFn: () =>
        getPendingBackupQueueStats({
          walletAddress: params.walletAddress,
          network: params.network,
        }),
      staleTime: queueStatsStaleTime,
    }),
  );

  await Promise.allSettled(tasks);
  await yieldToUi();
  await persistWalletDisplayCacheFromQueryClient({
    ...params,
    options: {
      includeBalance: true,
      includeTransactions: true,
      includePendingBackupStats: true,
    },
  });
}
