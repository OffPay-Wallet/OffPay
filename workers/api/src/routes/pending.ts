import { Hono } from 'hono';
import bs58 from 'bs58';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  deletePendingBackup,
  listPendingBackups,
  storePendingBackup,
} from '../lib/pending-backup.js';
import type { AppEnv } from '../lib/types.js';
import { readJsonBody, readSearchParams } from '../lib/validation.js';

const SECRETBOX_NONCE_LENGTH = 24;
const SECRETBOX_OVERHEAD_LENGTH = 16;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_CIPHERTEXT_LENGTH = 512_000;
const MAX_NONCE_LENGTH = 128;

const pendingBackupQuerySchema = z.object({
  wallet: z.string().min(1).max(64),
});

const pendingBackupBodySchema = z.object({
  txId: z.string().uuid(),
  ciphertext: z.string().min(1).max(MAX_CIPHERTEXT_LENGTH),
  nonce: z.string().min(1).max(MAX_NONCE_LENGTH),
  createdAt: z
    .number()
    .int()
    .positive()
    .refine(
      (value) => value <= Date.now() + CLOCK_SKEW_MS,
      'createdAt cannot be too far in the future.',
    ),
});

const deletePendingBackupBodySchema = z.object({
  txId: z.string().uuid(),
});

function isBase58WithMinimumLength(value: string, minimumLength: number): boolean {
  try {
    return bs58.decode(value).length >= minimumLength;
  } catch {
    return false;
  }
}

function isValidSecretboxNonce(value: string): boolean {
  try {
    return bs58.decode(value).length === SECRETBOX_NONCE_LENGTH;
  } catch {
    return false;
  }
}

function assertPendingBackupWallet(queryWallet: string, authenticatedWallet: string): void {
  if (queryWallet !== authenticatedWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Backup wallet must match the authenticated wallet.',
    });
  }
}

const pendingRoutes = new Hono<AppEnv>();

pendingRoutes.post('/backup', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    pendingBackupBodySchema,
    'Request body is required.',
    'Malformed pending backup request body.',
  );

  if (!isValidSecretboxNonce(body.nonce)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Pending backup nonce is invalid.',
    });
  }

  if (!isBase58WithMinimumLength(body.ciphertext, SECRETBOX_OVERHEAD_LENGTH)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Pending backup ciphertext is invalid.',
    });
  }

  await storePendingBackup(context.env, authenticatedContext.wallet, authenticatedContext.network, body);

  const response = context.json({
    stored: true,
    txId: body.txId,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

pendingRoutes.get('/backup', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, pendingBackupQuerySchema);

  assertPendingBackupWallet(query.wallet, authenticatedContext.wallet);

  const backups = await listPendingBackups(
    context.env,
    authenticatedContext.wallet,
    authenticatedContext.network,
  );
  const response = context.json({ backups });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

pendingRoutes.delete('/backup', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    deletePendingBackupBodySchema,
    'Request body is required.',
    'Malformed pending backup delete request body.',
  );

  await deletePendingBackup(
    context.env,
    authenticatedContext.wallet,
    authenticatedContext.network,
    body.txId,
  );

  const response = context.json({
    deleted: true,
    txId: body.txId,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default pendingRoutes;
