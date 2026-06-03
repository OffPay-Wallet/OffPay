import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { getWalletBalance, getWalletTransactions } from '../lib/helius.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidSolanaAddress,
  networkSchema,
  readSearchParams,
} from '../lib/validation.js';

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

function assertRequestedNetwork(requestedNetwork: Network, authenticatedNetwork: Network): void {
  if (requestedNetwork !== authenticatedNetwork) {
    throw new AppError({
      status: 400,
      code: 'INVALID_NETWORK',
      message: 'Requested network must match the authenticated network.',
    });
  }
}

const walletRoutes = new Hono<AppEnv>();

walletRoutes.get('/balance', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, walletBalanceQuerySchema);

  assertWalletAddress(query.address, 'Wallet address is invalid.');
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getWalletBalance(context.env, {
      address: query.address,
      network: query.network,
      useCache: query.useCache ?? true,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

walletRoutes.get('/transactions', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, walletTransactionsQuerySchema);

  assertWalletAddress(query.address, 'Wallet address is invalid.');
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getWalletTransactions(context.env, {
      address: query.address,
      network: query.network,
      cursor: query.cursor ?? null,
      limit: query.limit,
      useCache: query.cursor != null,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default walletRoutes;
