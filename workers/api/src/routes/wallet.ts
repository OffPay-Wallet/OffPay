import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { getCapabilities } from '../lib/capabilities.js';
import { getOrSetEdgeJsonCache } from '../lib/edge-cache.js';
import { AppError } from '../lib/errors.js';
import {
  getStreamCapabilities,
  getWalletBalance,
  getWalletTokenTransactions,
  getWalletTransactions,
} from '../lib/helius.js';
import { recordRequestTiming } from '../lib/timing.js';
import type { AppEnv } from '../lib/types.js';
import { isValidSolanaAddress, networkSchema, readSearchParams } from '../lib/validation.js';

const WALLET_BALANCE_EDGE_FRESH_TTL_MS = 10 * 1000;
const WALLET_BALANCE_EDGE_STALE_TTL_MS = 30 * 1000;
const WALLET_TRANSACTIONS_EDGE_FRESH_TTL_MS = 30 * 1000;
const WALLET_TRANSACTIONS_EDGE_STALE_TTL_MS = 60 * 1000;
const WALLET_DASHBOARD_EDGE_FRESH_TTL_MS = 10 * 1000;
const WALLET_DASHBOARD_EDGE_STALE_TTL_MS = 30 * 1000;

const booleanQuerySchema = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')
  .optional();

const walletBalanceQuerySchema = z.object({
  address: z.string().min(1),
  network: networkSchema,
  useCache: booleanQuerySchema,
});

const walletTransactionsQuerySchema = z.object({
  address: z.string().min(1),
  network: networkSchema,
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  useCache: booleanQuerySchema,
});

const walletTokenTransactionsQuerySchema = z.object({
  address: z.string().min(1),
  network: networkSchema,
  mint: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  useCache: booleanQuerySchema,
});

const walletDashboardQuerySchema = z.object({
  address: z.string().min(1),
  network: networkSchema,
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  useCache: booleanQuerySchema,
  includeTransactions: booleanQuerySchema.default('true'),
});

function assertWalletAddress(value: string, message: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

/**
 * Phase 0 instrumentation: a context-bound recorder so the helius data layer
 * can attribute sub-step latency (token-account discovery, signatures,
 * transaction batch, shared-cache get/set) into the Server-Timing header.
 */
function makeTimingRecorder(context: Context<AppEnv>) {
  return (name: string, durationMs: number): void => recordRequestTiming(context, name, durationMs);
}

const walletRoutes = new Hono<AppEnv>();

walletRoutes.get('/dashboard', async (context) => {
  const query = readSearchParams(context.req.url, walletDashboardQuerySchema);

  assertWalletAddress(query.address, 'Wallet address is invalid.');

  const resolveDashboard = async () => {
    const recordTiming = makeTimingRecorder(context);
    const emptyTransactions = {
      address: query.address,
      network: query.network,
      transactions: [],
      displayTransactions: [],
      historyGroups: [],
      cursor: null,
      fetchedAt: Date.now(),
    };
    const [capabilities, streamCapabilities, balance, transactions] = await Promise.all([
      getCapabilities(context.env, query.network),
      getStreamCapabilities(context.env, query.network),
      getWalletBalance(context.env, {
        address: query.address,
        network: query.network,
        useCache: query.useCache ?? true,
        recordTiming,
      }),
      query.includeTransactions
        ? getWalletTransactions(context.env, {
            address: query.address,
            network: query.network,
            cursor: null,
            limit: query.limit,
            useCache: query.useCache ?? true,
            recordTiming,
          })
        : Promise.resolve(emptyTransactions),
    ]);

    return {
      network: query.network,
      address: query.address,
      capabilities,
      streamCapabilities,
      balance,
      transactions,
      transactionsIncluded: query.includeTransactions,
      fetchedAt: Date.now(),
    };
  };

  const payload =
    query.useCache === false
      ? await resolveDashboard()
      : await getOrSetEdgeJsonCache({
          context,
          namespace: 'wallet_dashboard_v4_display_history',
          keyParts: [query.network, query.address, query.limit, query.includeTransactions],
          freshTtlMs: WALLET_DASHBOARD_EDGE_FRESH_TTL_MS,
          staleTtlMs: WALLET_DASHBOARD_EDGE_STALE_TTL_MS,
          resolver: resolveDashboard,
        });

  const response = context.json(payload);
  response.headers.set(
    'Cache-Control',
    query.useCache === false ? 'no-store' : 'public, max-age=10',
  );
  return response;
});

walletRoutes.get('/balance', async (context) => {
  const query = readSearchParams(context.req.url, walletBalanceQuerySchema);

  assertWalletAddress(query.address, 'Wallet address is invalid.');

  const resolveBalance = () =>
    getWalletBalance(context.env, {
      address: query.address,
      network: query.network,
      useCache: query.useCache ?? true,
      recordTiming: makeTimingRecorder(context),
    });

  const payload =
    query.useCache === false
      ? await resolveBalance()
      : await getOrSetEdgeJsonCache({
          context,
          namespace: 'wallet_balance',
          keyParts: [query.network, query.address],
          freshTtlMs: WALLET_BALANCE_EDGE_FRESH_TTL_MS,
          staleTtlMs: WALLET_BALANCE_EDGE_STALE_TTL_MS,
          resolver: resolveBalance,
        });

  const response = context.json(payload);
  response.headers.set(
    'Cache-Control',
    query.useCache === false ? 'no-store' : 'public, max-age=10',
  );
  return response;
});

walletRoutes.get('/transactions', async (context) => {
  const query = readSearchParams(context.req.url, walletTransactionsQuerySchema);

  assertWalletAddress(query.address, 'Wallet address is invalid.');

  const resolveTransactions = () =>
    getWalletTransactions(context.env, {
      address: query.address,
      network: query.network,
      cursor: query.cursor ?? null,
      limit: query.limit,
      useCache: query.useCache ?? true,
      recordTiming: makeTimingRecorder(context),
    });

  const canUseEdgeCache = query.useCache !== false && query.cursor == null;
  const payload = canUseEdgeCache
    ? await getOrSetEdgeJsonCache({
        context,
        namespace: 'wallet_transactions_first_page_v7_sol_supplement',
        keyParts: [query.network, query.address, query.limit],
        freshTtlMs: WALLET_TRANSACTIONS_EDGE_FRESH_TTL_MS,
        staleTtlMs: WALLET_TRANSACTIONS_EDGE_STALE_TTL_MS,
        resolver: resolveTransactions,
      })
    : await resolveTransactions();

  const response = context.json(payload);
  response.headers.set('Cache-Control', canUseEdgeCache ? 'public, max-age=30' : 'no-store');
  return response;
});

walletRoutes.get('/token-transactions', async (context) => {
  const query = readSearchParams(context.req.url, walletTokenTransactionsQuerySchema);

  assertWalletAddress(query.address, 'Wallet address is invalid.');
  assertWalletAddress(query.mint, 'Token mint is invalid.');

  const resolveTransactions = () =>
    getWalletTokenTransactions(context.env, {
      address: query.address,
      network: query.network,
      mint: query.mint,
      cursor: query.cursor ?? null,
      limit: query.limit,
      useCache: query.useCache ?? true,
      recordTiming: makeTimingRecorder(context),
    });

  const canUseEdgeCache = query.useCache !== false && query.cursor == null;
  const payload = canUseEdgeCache
    ? await getOrSetEdgeJsonCache({
        context,
        namespace: 'wallet_token_transactions_first_page_v4_indexed_local_filter',
        keyParts: [query.network, query.address, query.mint, query.limit],
        freshTtlMs: WALLET_TRANSACTIONS_EDGE_FRESH_TTL_MS,
        staleTtlMs: WALLET_TRANSACTIONS_EDGE_STALE_TTL_MS,
        resolver: resolveTransactions,
      })
    : await resolveTransactions();

  const response = context.json(payload);
  response.headers.set('Cache-Control', canUseEdgeCache ? 'public, max-age=30' : 'no-store');
  return response;
});

export default walletRoutes;
