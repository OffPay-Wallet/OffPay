import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  getShieldedBalanceMetadata,
  registerUmbraViewingKey,
  scanUmbraAnnouncements,
} from '../lib/umbra.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidSolanaAddress,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const shieldedBalanceQuerySchema = z.object({
  wallet: z.string().min(1),
  network: networkSchema,
});

const scanAnnouncementsQuerySchema = z.object({
  wallet: z.string().min(1),
  network: networkSchema,
});

const registerViewingKeyBodySchema = z.object({
  walletAddress: z.string().min(1),
  viewingKeyPublicKey: z.string().trim().min(1).max(512),
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

function assertAuthenticatedWallet(requestWallet: string, authenticatedWallet: string): void {
  if (requestWallet !== authenticatedWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Privacy wallet must match the authenticated wallet.',
    });
  }
}

const privacyRoutes = new Hono<AppEnv>();

privacyRoutes.get('/shielded-balance', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, shieldedBalanceQuerySchema);

  assertWalletAddress(query.wallet, 'Wallet address is invalid.');
  assertAuthenticatedWallet(query.wallet, authenticatedContext.wallet);
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getShieldedBalanceMetadata(context.env, {
      walletAddress: query.wallet,
      network: query.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

privacyRoutes.get('/scan-announcements', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, scanAnnouncementsQuerySchema);

  assertWalletAddress(query.wallet, 'Wallet address is invalid.');
  assertAuthenticatedWallet(query.wallet, authenticatedContext.wallet);
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await scanUmbraAnnouncements(context.env, {
      walletAddress: query.wallet,
      network: query.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

privacyRoutes.post('/register-viewing-key', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    registerViewingKeyBodySchema,
    'Request body is required.',
    'Malformed viewing-key registration request body.',
  );

  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet);
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await registerUmbraViewingKey(context.env, {
      walletAddress: body.walletAddress,
      viewingKeyPublicKey: body.viewingKeyPublicKey,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default privacyRoutes;
