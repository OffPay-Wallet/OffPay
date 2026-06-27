import { Buffer } from 'buffer';
import { SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import {
  broadcastRawTransaction,
  getFeeForMessage,
  getLatestBlockhash,
  getMinimumBalanceForRentExemption,
  getRpcAccounts,
  getRpcEpochInfo,
  getRpcSignatureStatuses,
  getRpcSignaturesForAddress,
  getRpcSlot,
  getRpcTokenLargestAccounts,
} from '../lib/helius.js';
import { requestDevnetTreasuryAirdrop } from '../lib/devnet-faucet.js';
import { AppError } from '../lib/errors.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  isValidEd25519Signature,
  isValidSolanaAddress,
  networkSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const base64StringSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected a base64-encoded string.');

const broadcastBodySchema = z.object({
  rawTransaction: base64StringSchema,
  network: networkSchema,
});

const offlineSlotBroadcastPurposeSchema = z.enum(['nonce-create', 'nonce-advance', 'nonce-close']);

const offlineSlotBroadcastBodySchema = broadcastBodySchema.extend({
  purpose: offlineSlotBroadcastPurposeSchema,
});

type OfflineSlotBroadcastPurpose = z.infer<typeof offlineSlotBroadcastPurposeSchema>;

const networkQuerySchema = z.object({
  network: networkSchema,
});

const feeForMessageBodySchema = z.object({
  messageBase64: base64StringSchema,
  network: networkSchema,
});

const minimumBalanceForRentExemptionBodySchema = z.object({
  space: z.number().int().min(0).max(10_000_000),
  network: networkSchema,
});

const accountsBodySchema = z.object({
  addresses: z.array(z.string().trim().min(1)).min(1).max(50),
  network: networkSchema,
});

const tokenLargestAccountsBodySchema = z.object({
  mint: z.string().trim().min(1),
  network: networkSchema,
});

const signatureStatusesBodySchema = z.object({
  signatures: z.array(z.string().trim().min(1)).min(1).max(50),
  network: networkSchema,
});

const signaturesForAddressBodySchema = z.object({
  address: z.string().trim().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  before: z.string().trim().min(1).optional(),
  network: networkSchema,
});

const devnetAirdropBodySchema = z.object({
  walletAddress: z.string().trim().min(1),
  network: z.literal('devnet'),
});

function assertRequestedNetwork(requestedNetwork: Network, authenticatedNetwork: Network): void {
  if (requestedNetwork !== authenticatedNetwork) {
    throw new AppError({
      status: 400,
      code: 'INVALID_NETWORK',
      message: 'Requested network must match the authenticated network.',
    });
  }
}

function assertWalletAddress(value: string, message: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertSignature(value: string, message: string): void {
  if (!isValidEd25519Signature(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertOfflineSlotBroadcastTransaction(params: {
  rawTransaction: string;
  walletAddress: string;
  purpose: OfflineSlotBroadcastPurpose;
}): void {
  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(params.rawTransaction, 'base64'));
  } catch {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Offline slot broadcast transaction is invalid.',
    });
  }

  if (transaction.feePayer?.toBase58() !== params.walletAddress) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Offline slot broadcast fee payer must match the authenticated wallet.',
    });
  }

  const walletSignature = transaction.signatures.find(
    (entry) => entry.publicKey.toBase58() === params.walletAddress,
  );
  if (walletSignature?.signature == null) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Offline slot broadcast must be signed by the authenticated wallet.',
    });
  }

  const expectedInstructionTypes: Record<OfflineSlotBroadcastPurpose, string[]> = {
    'nonce-create': ['Create', 'InitializeNonceAccount'],
    'nonce-advance': ['AdvanceNonceAccount'],
    'nonce-close': ['WithdrawNonceAccount'],
  };
  const expectedTypes = expectedInstructionTypes[params.purpose];
  if (transaction.instructions.length !== expectedTypes.length) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Offline slot broadcast transaction does not match the requested purpose.',
    });
  }

  for (let index = 0; index < transaction.instructions.length; index += 1) {
    const instruction = transaction.instructions[index];
    if (!instruction.programId.equals(SystemProgram.programId)) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Offline slot broadcast only supports system nonce transactions.',
      });
    }

    let instructionType: string;
    try {
      instructionType = SystemInstruction.decodeInstructionType(instruction);
    } catch {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Offline slot broadcast contains an unsupported system instruction.',
      });
    }

    if (instructionType !== expectedTypes[index]) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Offline slot broadcast transaction does not match the requested purpose.',
      });
    }
  }
}

const rpcRoutes = new Hono<AppEnv>();

rpcRoutes.get('/latest-blockhash', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json({
    network: query.network,
    ...(await getLatestBlockhash(context.env, query.network)),
    fetchedAt: Date.now(),
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/fee-for-message', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    feeForMessageBodySchema,
    'Request body is required.',
    'Malformed fee-for-message request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const lamports = await getFeeForMessage(context.env, {
    messageBase64: body.messageBase64,
    network: body.network,
  });
  const response = context.json({ lamports: Number(lamports) });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/minimum-balance-for-rent-exemption', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    minimumBalanceForRentExemptionBodySchema,
    'Request body is required.',
    'Malformed minimum-balance-for-rent-exemption request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const lamports = await getMinimumBalanceForRentExemption(context.env, {
    space: body.space,
    network: body.network,
  });
  const response = context.json({ lamports: Number(lamports) });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/accounts', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    accountsBodySchema,
    'Request body is required.',
    'Malformed accounts request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  for (const address of body.addresses) {
    assertWalletAddress(address, 'Account address is invalid.');
  }

  const response = context.json(
    await getRpcAccounts(context.env, {
      addresses: body.addresses,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/token-largest-accounts', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    tokenLargestAccountsBodySchema,
    'Request body is required.',
    'Malformed token-largest-accounts request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  assertWalletAddress(body.mint, 'Token mint is invalid.');

  const response = context.json(
    await getRpcTokenLargestAccounts(context.env, {
      mint: body.mint,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.get('/epoch-info', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(await getRpcEpochInfo(context.env, query.network));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.get('/slot', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const query = readSearchParams(context.req.url, networkQuerySchema);

  assertRequestedNetwork(query.network, authenticatedContext.network);

  const response = context.json(await getRpcSlot(context.env, query.network));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/signature-statuses', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    signatureStatusesBodySchema,
    'Request body is required.',
    'Malformed signature-statuses request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  for (const signature of body.signatures) {
    assertSignature(signature, 'Transaction signature is invalid.');
  }

  const response = context.json(
    await getRpcSignatureStatuses(context.env, {
      signatures: body.signatures,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/signatures-for-address', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    signaturesForAddressBodySchema,
    'Request body is required.',
    'Malformed signatures-for-address request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  assertWalletAddress(body.address, 'Address is invalid.');
  if (body.before) {
    assertSignature(body.before, 'Before signature is invalid.');
  }

  const response = context.json(
    await getRpcSignaturesForAddress(context.env, {
      address: body.address,
      network: body.network,
      ...(body.limit === undefined ? {} : { limit: body.limit }),
      ...(body.before === undefined ? {} : { before: body.before }),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/broadcast', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    broadcastBodySchema,
    'Request body is required.',
    'Malformed transaction broadcast request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await broadcastRawTransaction(context.env, {
      rawTransaction: body.rawTransaction,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/offline-slot-broadcast', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    offlineSlotBroadcastBodySchema,
    'Request body is required.',
    'Malformed offline slot broadcast request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  assertOfflineSlotBroadcastTransaction({
    rawTransaction: body.rawTransaction,
    walletAddress: authenticatedContext.wallet,
    purpose: body.purpose,
  });

  const response = context.json(
    await broadcastRawTransaction(context.env, {
      rawTransaction: body.rawTransaction,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

rpcRoutes.post('/devnet-airdrop', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    devnetAirdropBodySchema,
    'Request body is required.',
    'Malformed devnet airdrop request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);
  assertWalletAddress(body.walletAddress, 'Wallet address is invalid.');

  if (body.walletAddress !== authenticatedContext.wallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Airdrop wallet must match the authenticated wallet.',
    });
  }

  const response = context.json(
    await requestDevnetTreasuryAirdrop(context.env, {
      walletAddress: body.walletAddress,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default rpcRoutes;
