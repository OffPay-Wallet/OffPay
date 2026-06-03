import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  estimateOfflineNonceRent,
  getNoncePoolStatus,
  getOfflineTokenContext,
  prepareNonceAdvance,
  prepareNoncePool,
} from '../lib/offline.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidSolanaAddress,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const integerStringSchema = z.string().trim().regex(/^\d+$/, 'Expected an integer string.');

const rentEstimateQuerySchema = z.object({
  slotCount: integerStringSchema,
  wallet: z.string().trim().min(1).optional(),
  network: networkSchema,
});

const noncePoolPrepareBodySchema = z.object({
  walletAddress: z.string().trim().min(1),
  nonceAuthority: z.string().trim().min(1),
  nonceAccounts: z.array(z.string().trim().min(1)).min(1).max(50),
  network: networkSchema,
});

const noncePoolAdvanceBodySchema = z.object({
  walletAddress: z.string().trim().min(1),
  nonceAccount: z.string().trim().min(1),
  network: networkSchema,
});

const noncePoolStatusQuerySchema = z.object({
  wallet: z.string().trim().min(1),
  targetSlotCount: integerStringSchema.optional(),
  network: networkSchema,
});

const tokenContextQuerySchema = z.object({
  mint: z.string().trim().min(1),
  owner: z.string().trim().min(1).optional(),
  sender: z.string().trim().min(1).optional(),
  recipient: z.string().trim().min(1),
  network: networkSchema,
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

function assertAuthenticatedWallet(requestWallet: string, authenticatedWallet: string, message: string): void {
  if (requestWallet !== authenticatedWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function parseSlotCount(value: string): number {
  return Number(value);
}

function readIdempotencyKey(request: Request): string {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Idempotency-Key header is required for this offline nonce operation.',
    });
  }

  return value;
}

const offlineRoutes = new Hono<AppEnv>();

offlineRoutes.get('/rent-estimate', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, rentEstimateQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);
  if (query.wallet) {
    assertWalletAddress(query.wallet, 'Wallet address is invalid.');
    assertAuthenticatedWallet(query.wallet, authenticatedContext.wallet, 'Wallet must match the authenticated wallet.');
  }

  const response = context.json(
    await estimateOfflineNonceRent(context.env, {
      slotCount: parseSlotCount(query.slotCount),
      network: query.network,
      ...(query.wallet ? { walletAddress: query.wallet } : {}),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

offlineRoutes.post('/nonce-pool/prepare', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const idempotencyKey = readIdempotencyKey(context.req.raw);
  const body = await readJsonBody(
    context.req.raw,
    noncePoolPrepareBodySchema,
    'Request body is required.',
    'Malformed nonce-pool prepare request body.',
  );

  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertWalletAddress(body.nonceAuthority, 'Nonce authority is invalid.');
  for (const nonceAccount of body.nonceAccounts) {
    assertWalletAddress(nonceAccount, 'Nonce account address is invalid.');
  }
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet, 'Wallet must match the authenticated wallet.');
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await prepareNoncePool(context.env, {
      walletAddress: body.walletAddress,
      nonceAuthority: body.nonceAuthority,
      nonceAccounts: body.nonceAccounts,
      network: body.network,
      idempotencyKey,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

offlineRoutes.post('/nonce-pool/advance', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const idempotencyKey = readIdempotencyKey(context.req.raw);
  const body = await readJsonBody(
    context.req.raw,
    noncePoolAdvanceBodySchema,
    'Request body is required.',
    'Malformed nonce-pool advance request body.',
  );

  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertWalletAddress(body.nonceAccount, 'Nonce account address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet, 'Wallet must match the authenticated wallet.');
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await prepareNonceAdvance(context.env, {
      walletAddress: body.walletAddress,
      nonceAccount: body.nonceAccount,
      network: body.network,
      idempotencyKey,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

offlineRoutes.get('/nonce-pool/status', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, noncePoolStatusQuerySchema);

  assertWalletAddress(query.wallet, 'Wallet address is invalid.');
  assertAuthenticatedWallet(query.wallet, authenticatedContext.wallet, 'Wallet must match the authenticated wallet.');
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getNoncePoolStatus(context.env, {
      walletAddress: query.wallet,
      network: query.network,
      ...(query.targetSlotCount ? { targetSlotCount: parseSlotCount(query.targetSlotCount) } : {}),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

offlineRoutes.get('/token-context', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, tokenContextQuerySchema);
  const sender = query.sender ?? query.owner;

  if (!sender) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Sender wallet is required.',
    });
  }

  assertWalletAddress(query.mint, 'Mint address is invalid.');
  assertWalletAddress(sender, 'Sender wallet address is invalid.');
  assertWalletAddress(query.recipient, 'Recipient wallet address is invalid.');
  assertAuthenticatedWallet(sender, authenticatedContext.wallet, 'Sender must match the authenticated wallet.');
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getOfflineTokenContext(context.env, {
      mint: query.mint,
      sender,
      recipient: query.recipient,
      network: query.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default offlineRoutes;
