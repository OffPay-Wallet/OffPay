import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import {
  getUmbraClaimStatus,
  getUmbraIndexerHealth,
  getUmbraRelayerInfo,
  getUmbraTreeProof,
  getUmbraTreeProofs,
  getUmbraTreeSummaries,
  getUmbraUtxos,
  submitUmbraClaim,
  type UmbraJsonObject,
} from '../lib/umbra.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isRecord,
  isValidSolanaAddress,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const integerStringSchema = z.string().trim().max(39).regex(/^\d+$/, 'Expected an integer string.');
const idParamSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const insertionIndexSchema = z.union([z.number().int().min(0), integerStringSchema]);

const utxosQuerySchema = z.object({
  start: integerStringSchema.optional(),
  end: integerStringSchema.optional(),
  limit: integerStringSchema.optional(),
  network: networkSchema,
});

const networkQuerySchema = z.object({
  network: networkSchema,
});

const treeProofsBodySchema = z.object({
  insertionIndexes: z.array(insertionIndexSchema).min(1).max(8),
  network: networkSchema,
});

const umbraClaimBodySchema = z.object({
  network: networkSchema,
}).passthrough();

const WALLET_MATCH_KEYS = new Set(['walletaddress', 'owner', 'wallet', 'sender']);
const SENSITIVE_REQUEST_KEY_FRAGMENTS = [
  'privatekey',
  'spendingkey',
  'mnemonic',
  'seed',
  'masterviewingkey',
  'secret',
  'apikey',
  'authorization',
  'bearertoken',
  'authtoken',
  'accesstoken',
  'refreshtoken',
] as const;

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
  if (!isValidSolanaAddress(requestWallet)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Umbra wallet address is invalid.',
    });
  }

  if (requestWallet !== authenticatedWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Umbra wallet fields must match the authenticated wallet.',
    });
  }
}

function parseBoundedInteger(value: string, fieldName: string, maxValue: number): number {
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0 || parsedValue > maxValue) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${fieldName} must be a non-negative integer less than or equal to ${maxValue}.`,
    });
  }

  return parsedValue;
}

function parseRouteInteger(value: string | undefined, fieldName: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${fieldName} must be a non-negative integer.`,
    });
  }

  return parseBoundedInteger(value, fieldName, Number.MAX_SAFE_INTEGER);
}

function parseInsertionIndex(value: string | number): number {
  if (typeof value === 'number') {
    return value;
  }

  return parseBoundedInteger(value, 'insertionIndex', Number.MAX_SAFE_INTEGER);
}

function normalizeRequestKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

const UMBRA_CIPHERTEXT_KEY_PREFIXES = ['rescueencrypted', 'rescueencryption', 'aesencrypted', 'encrypted', 'groth16', 'merkle', 'linker', 'utxoslot', 'proofaccount'] as const;

function isUmbraCiphertextKey(normalizedKey: string): boolean {
  return UMBRA_CIPHERTEXT_KEY_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix));
}

function isSensitiveRequestKey(key: string): boolean {
  const normalizedKey = normalizeRequestKey(key);
  if (isUmbraCiphertextKey(normalizedKey)) return false;
  return SENSITIVE_REQUEST_KEY_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment));
}

function assertNoSensitiveUmbraPayload(value: unknown, authenticatedWallet: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoSensitiveUmbraPayload(entry, authenticatedWallet);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveRequestKey(key)) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Umbra proxy requests must not include private keys, secrets, or bearer tokens.',
      });
    }

    if (WALLET_MATCH_KEYS.has(normalizeRequestKey(key))) {
      if (typeof nestedValue !== 'string') {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'Umbra wallet fields must be strings.',
        });
      }
      assertAuthenticatedWallet(nestedValue, authenticatedWallet);
    }

    assertNoSensitiveUmbraPayload(nestedValue, authenticatedWallet);
  }
}

function setNoStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

const umbraRoutes = new Hono<AppEnv>();

umbraRoutes.get('/utxos', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, utxosQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  const limit = query.limit ? parseBoundedInteger(query.limit, 'limit', 5000).toString() : undefined;

  return setNoStore(context.json(
    await getUmbraUtxos(context.env, {
      network: query.network,
      ...(query.start !== undefined ? { start: query.start } : {}),
      ...(query.end !== undefined ? { end: query.end } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),
  ));
});

umbraRoutes.get('/indexer-health', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  return setNoStore(context.json(
    await getUmbraIndexerHealth(context.env, {
      network: query.network,
    }),
  ));
});

umbraRoutes.get('/trees', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  return setNoStore(context.json(
    await getUmbraTreeSummaries(context.env, {
      network: query.network,
    }),
  ));
});

umbraRoutes.get('/trees/:treeIndex/proof/:insertionIndex', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);
  const treeIndex = parseRouteInteger(context.req.param('treeIndex'), 'treeIndex');
  const insertionIndex = parseRouteInteger(context.req.param('insertionIndex'), 'insertionIndex');

  assertRequestedNetwork(query.network, authenticatedContext.network);

  return setNoStore(context.json(
    await getUmbraTreeProof(context.env, {
      network: query.network,
      treeIndex,
      insertionIndex,
    }),
  ));
});

umbraRoutes.post('/trees/:treeIndex/proofs', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const treeIndex = parseRouteInteger(context.req.param('treeIndex'), 'treeIndex');
  const body = await readJsonBody(
    context.req.raw,
    treeProofsBodySchema,
    'Request body is required.',
    'Malformed Umbra proof batch request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  return setNoStore(context.json(
    await getUmbraTreeProofs(context.env, {
      network: body.network,
      treeIndex,
      insertionIndexes: body.insertionIndexes.map(parseInsertionIndex),
    }),
  ));
});

umbraRoutes.get('/relayer-info', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  return setNoStore(context.json(
    await getUmbraRelayerInfo(context.env, {
      network: query.network,
    }),
  ));
});

umbraRoutes.post('/claim', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    umbraClaimBodySchema,
    'Request body is required.',
    'Malformed Umbra claim request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  assertNoSensitiveUmbraPayload(body, authenticatedContext.wallet);

  return setNoStore(context.json(
    await submitUmbraClaim(context.env, {
      network: body.network,
      payload: body as UmbraJsonObject,
    }),
  ));
});

umbraRoutes.get('/claim-status/:id', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);
  const idResult = idParamSchema.safeParse(context.req.param('id'));
  if (!idResult.success) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Claim status id is invalid.',
    });
  }

  assertRequestedNetwork(query.network, authenticatedContext.network);

  return setNoStore(context.json(
    await getUmbraClaimStatus(context.env, {
      network: query.network,
      id: idResult.data,
    }),
  ));
});

export default umbraRoutes;
