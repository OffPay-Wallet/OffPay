import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  getPrivatePaymentBalance,
  executePrivatePayment,
  initializePrivatePaymentMint,
  preparePrivatePayment,
  settlePrivatePayments,
} from '../lib/payment.js';
import { loginMagicBlockAuth, requestMagicBlockAuthChallenge } from '../lib/magicblock.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidSolanaAddress,
  isValidEd25519Signature,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const positiveIntegerStringSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Expected a positive integer string.')
  .refine((value) => value !== '0', 'Amount must be greater than zero.');

const base64StringSchema = z
  .string()
  .trim()
  .max(10_000, 'Expected a bounded base64-encoded string.')
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected a base64-encoded string.');

const privateInitMintBodySchema = z.object({
  walletAddress: z.string().min(1),
  mintAddress: z.string().min(1),
  network: networkSchema,
});

const privateBalanceQuerySchema = z.object({
  wallet: z.string().min(1),
  network: networkSchema,
  mint: z.string().min(1).optional(),
});

const privateAuthChallengeBodySchema = z.object({
  walletAddress: z.string().trim().min(1),
  network: networkSchema,
});

const privateAuthLoginBodySchema = privateAuthChallengeBodySchema.extend({
  challenge: z.string().trim().min(1).max(4_096),
  signature: z.string().trim().min(1).max(128),
});

const privateSendBodySchema = z.object({
  walletAddress: z.string().min(1),
  recipient: z.string().min(1),
  amount: positiveIntegerStringSchema,
  mint: z.string().min(1),
  network: networkSchema,
});

const privateSendExecuteBodySchema = z.object({
  intentId: z.string().uuid(),
  walletAddress: z.string().min(1),
  network: networkSchema,
  signedTransaction: base64StringSchema,
});

const settleBodySchema = z.object({
  signedBlobs: z.array(base64StringSchema).min(1).max(50),
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
      message: 'Payment wallet must match the authenticated wallet.',
    });
  }
}

const paymentRoutes = new Hono<AppEnv>();

paymentRoutes.post('/private-auth/challenge', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privateAuthChallengeBodySchema,
    'Request body is required.',
    'Malformed MagicBlock authentication challenge request body.',
  );
  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet);
  assertRequestedNetwork(body.network, authenticatedContext.network);
  const response = context.json(
    await requestMagicBlockAuthChallenge(context.env, {
      walletAddress: body.walletAddress,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

paymentRoutes.post('/private-auth/login', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privateAuthLoginBodySchema,
    'Request body is required.',
    'Malformed MagicBlock authentication login request body.',
  );
  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet);
  assertRequestedNetwork(body.network, authenticatedContext.network);
  if (!isValidEd25519Signature(body.signature)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'MagicBlock authentication signature is invalid.',
    });
  }
  const response = context.json(
    await loginMagicBlockAuth(context.env, {
      walletAddress: body.walletAddress,
      network: body.network,
      challenge: body.challenge,
      signature: body.signature,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

paymentRoutes.post('/private-init-mint', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privateInitMintBodySchema,
    'Request body is required.',
    'Malformed private-init-mint request body.',
  );

  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertWalletAddress(body.mintAddress, 'Mint address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet);
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await initializePrivatePaymentMint(context.env, {
      walletAddress: body.walletAddress,
      mintAddress: body.mintAddress,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

paymentRoutes.get('/private-balance', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, privateBalanceQuerySchema);

  assertWalletAddress(query.wallet, 'Wallet address is invalid.');
  if (query.mint) {
    assertWalletAddress(query.mint, 'Mint address is invalid.');
  }
  assertAuthenticatedWallet(query.wallet, authenticatedContext.wallet);
  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(
    await getPrivatePaymentBalance(context.env, {
      walletAddress: query.wallet,
      network: query.network,
      ...(query.mint ? { mintAddress: query.mint } : {}),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

paymentRoutes.post('/private-send', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privateSendBodySchema,
    'Request body is required.',
    'Malformed private-send request body.',
  );

  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertWalletAddress(body.recipient, 'Recipient wallet address is invalid.');
  assertWalletAddress(body.mint, 'Mint address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet);
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await preparePrivatePayment(context.env, {
      walletAddress: body.walletAddress,
      recipient: body.recipient,
      amount: body.amount,
      mint: body.mint,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

paymentRoutes.post('/private-send/execute', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privateSendExecuteBodySchema,
    'Request body is required.',
    'Malformed private-send execution request body.',
  );
  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');
  assertAuthenticatedWallet(body.walletAddress, authenticatedContext.wallet);
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await executePrivatePayment(context.env, {
      intentId: body.intentId,
      walletAddress: body.walletAddress,
      signedTransaction: body.signedTransaction,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

paymentRoutes.post('/settle', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    settleBodySchema,
    'Request body is required.',
    'Malformed settlement request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await settlePrivatePayments(context.env, {
      signedBlobs: body.signedBlobs,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default paymentRoutes;
