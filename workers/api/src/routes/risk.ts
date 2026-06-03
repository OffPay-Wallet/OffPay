import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { getRiskScore } from '../lib/risk.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidSolanaAddress,
  networkSchema,
  readSearchParams,
} from '../lib/validation.js';

const riskScoreQuerySchema = z.object({
  address: z.string().min(1),
  network: networkSchema,
});

function assertWalletAddress(value: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
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

const riskRoutes = new Hono<AppEnv>();

riskRoutes.get('/score', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, riskScoreQuerySchema);

  assertWalletAddress(query.address);
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getRiskScore(context.env, {
      address: query.address,
      network: query.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default riskRoutes;
