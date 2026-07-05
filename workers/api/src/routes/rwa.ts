import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { getOrSetEdgeJsonCache } from '../lib/edge-cache.js';
import { AppError } from '../lib/errors.js';
import { getRwaAssets, getRwaPrice } from '../lib/rwa.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  DEFAULT_MAX_JSON_BODY_BYTES,
  isValidSolanaAddress,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const RWA_ASSETS_EDGE_FRESH_TTL_MS = 5 * 60 * 1000;
const RWA_ASSETS_EDGE_STALE_TTL_MS = 10 * 60 * 1000;
const MAX_MINT_LENGTH = 64;
const MAX_TRANSACTION_BASE64_LENGTH = 256_000;
const MAX_AMOUNT_DIGITS = 40;

const rwaAssetsQuerySchema = z.object({
  network: networkSchema,
});

const rwaPriceQuerySchema = z.object({
  network: networkSchema,
  mint: z.string().trim().min(1).max(MAX_MINT_LENGTH),
});

const positiveIntegerStringSchema = z
  .string()
  .trim()
  .max(MAX_AMOUNT_DIGITS, 'Expected a positive integer string.')
  .regex(/^\d+$/, 'Expected a positive integer string.')
  .refine((value) => value !== '0', 'Expected a positive integer string.');

const base64StringSchema = z
  .string()
  .trim()
  .max(MAX_TRANSACTION_BASE64_LENGTH, 'Expected a base64-encoded string.')
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected a base64-encoded string.');

const rwaQuoteBodySchema = z.object({
  inputMint: z.string().trim().min(1).max(MAX_MINT_LENGTH),
  outputMint: z.string().trim().min(1).max(MAX_MINT_LENGTH),
  amount: positiveIntegerStringSchema,
  side: z.enum(['buy', 'sell']),
  network: networkSchema,
});

const rwaExecuteBodySchema = z.object({
  quoteId: z.string().trim().min(1).max(128),
  signedTransaction: base64StringSchema,
  network: networkSchema,
});

function assertSolanaAddress(value: string, message: string): void {
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

function throwDevnetExecutionNotImplemented(): never {
  throw new AppError({
    status: 501,
    code: 'NOT_IMPLEMENTED',
    message:
      'Devnet RWA transaction execution is not enabled yet. The current phase supports catalog and pricing only.',
  });
}

const rwaRoutes = new Hono<AppEnv>();

rwaRoutes.get('/assets', async (context) => {
  const query = readSearchParams(context.req.url, rwaAssetsQuerySchema);

  const response = context.json(
    await getOrSetEdgeJsonCache({
      context,
      namespace: 'rwa_assets',
      keyParts: [query.network],
      freshTtlMs: RWA_ASSETS_EDGE_FRESH_TTL_MS,
      staleTtlMs: RWA_ASSETS_EDGE_STALE_TTL_MS,
      resolver: () => Promise.resolve(getRwaAssets(context.env, query.network)),
    }),
  );
  response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return response;
});

rwaRoutes.get('/price', async (context) => {
  const query = readSearchParams(context.req.url, rwaPriceQuerySchema);
  assertSolanaAddress(query.mint, 'RWA mint address is invalid.');

  const response = context.json(
    getRwaPrice(context.env, {
      mint: query.mint,
      network: query.network,
    }),
  );
  response.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  return response;
});

rwaRoutes.post('/quote', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    rwaQuoteBodySchema,
    'RWA quote request body is required.',
    'Invalid RWA quote request body.',
    DEFAULT_MAX_JSON_BODY_BYTES,
  );

  assertSolanaAddress(body.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(body.outputMint, 'Output mint address is invalid.');
  assertRequestedNetwork(body.network, authenticatedContext.network);

  throwDevnetExecutionNotImplemented();
});

rwaRoutes.post('/execute', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    rwaExecuteBodySchema,
    'RWA execute request body is required.',
    'Invalid RWA execute request body.',
    DEFAULT_MAX_JSON_BODY_BYTES,
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  throwDevnetExecutionNotImplemented();
});

export default rwaRoutes;
