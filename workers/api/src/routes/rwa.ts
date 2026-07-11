import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { getOrSetEdgeJsonCache } from '../lib/edge-cache.js';
import { AppError } from '../lib/errors.js';
import { createRwaQuote, executeRwaQuote, getRwaAssets, getRwaPrice } from '../lib/rwa.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  DEFAULT_MAX_JSON_BODY_BYTES,
  isValidSolanaAddress,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const RWA_ASSETS_EDGE_FRESH_TTL_MS = 30 * 1000;
const RWA_ASSETS_EDGE_STALE_TTL_MS = 0;
const MAX_MINT_LENGTH = 64;
const MAX_TRANSACTION_BASE64_LENGTH = 256_000;
const MAX_DECIMAL_STRING_LENGTH = 48;

const rwaAssetsQuerySchema = z.object({
  network: networkSchema,
});

const rwaPriceQuerySchema = z.object({
  network: networkSchema,
  mint: z.string().trim().min(1).max(MAX_MINT_LENGTH),
});

const positiveDecimalStringSchema = z
  .string()
  .trim()
  .max(MAX_DECIMAL_STRING_LENGTH, 'Expected a positive decimal string.')
  .regex(/^\d+(?:\.\d{1,12})?$/, 'Expected a positive decimal string.')
  .refine((value) => Number(value) > 0, 'Expected a positive decimal string.');

const base64StringSchema = z
  .string()
  .trim()
  .max(MAX_TRANSACTION_BASE64_LENGTH, 'Expected a base64-encoded string.')
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected a base64-encoded string.');

const rwaQuoteBodySchema = z
  .object({
    assetMint: z.string().trim().min(1).max(MAX_MINT_LENGTH).optional(),
    assetSymbol: z.string().trim().min(1).max(32).optional(),
    quantity: positiveDecimalStringSchema.optional(),
    cashAmount: positiveDecimalStringSchema.optional(),
    side: z.enum(['buy', 'sell']).optional(),
    network: networkSchema,
  })
  .superRefine((value, context) => {
    if (value.assetMint == null && value.assetSymbol == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RWA quote requires assetMint or assetSymbol.',
        path: ['assetMint'],
      });
    }

    if (value.quantity == null && value.cashAmount == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RWA quote requires quantity or cashAmount.',
        path: ['quantity'],
      });
    }

    if (value.side == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RWA quote requires side.',
        path: ['side'],
      });
    }

    if (value.quantity != null && value.cashAmount != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RWA quote accepts either quantity or cashAmount, not both.',
        path: ['cashAmount'],
      });
    }

    if (value.side === 'buy' && value.cashAmount == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RWA buy quote requires cashAmount.',
        path: ['cashAmount'],
      });
    }

    if (value.side === 'sell' && value.quantity == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RWA sell quote requires quantity.',
        path: ['quantity'],
      });
    }
  });

const rwaExecuteBodySchema = z.object({
  quoteId: z.string().trim().min(1).max(128),
  signedTransaction: base64StringSchema,
  signedTransactions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        target: z.enum(['solana_devnet', 'magicblock_er_devnet']),
        signedTransaction: base64StringSchema,
      }),
    )
    .max(8)
    .optional(),
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

function readEdgeCountryCode(
  context: Parameters<typeof getAuthenticatedContext>[0],
): string | undefined {
  const rawRequest = context.req.raw as Request & { cf?: { country?: unknown } };
  const country =
    typeof rawRequest.cf?.country === 'string'
      ? rawRequest.cf.country.trim().toUpperCase()
      : undefined;
  return country && /^[A-Z]{2}$/.test(country) ? country : undefined;
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
      resolver: () => getRwaAssets(context.env, query.network),
    }),
  );
  response.headers.set('Cache-Control', 'public, max-age=30, must-revalidate');
  return response;
});

rwaRoutes.get('/price', async (context) => {
  const query = readSearchParams(context.req.url, rwaPriceQuerySchema);
  assertSolanaAddress(query.mint, 'RWA mint address is invalid.');

  const response = context.json(
    await getRwaPrice(context.env, {
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

  if (body.assetMint != null) {
    assertSolanaAddress(body.assetMint, 'RWA mint address is invalid.');
  }
  assertRequestedNetwork(body.network, authenticatedContext.network);

  return context.json(
    await createRwaQuote(context.env, {
      ...body,
      walletAddress: authenticatedContext.wallet,
      countryCode: readEdgeCountryCode(context),
    }),
  );
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

  return context.json(
    await executeRwaQuote(context.env, {
      ...body,
      walletAddress: authenticatedContext.wallet,
      countryCode: readEdgeCountryCode(context),
    }),
  );
});

export default rwaRoutes;
