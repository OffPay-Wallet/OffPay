import { Hono } from 'hono';
import { z } from 'zod';
import { getAuthenticatedContext } from '../lib/auth.js';
import { getOrSetEdgeJsonCache } from '../lib/edge-cache.js';
import { AppError } from '../lib/errors.js';
import {
  SWAP_TOKENS_CACHE_TTL_MS,
  createRecurringOrder,
  createSwapQuote,
  executeRecurringOrder,
  executeSwapQuote,
  getSwapPrice,
  getSwapTokens,
} from '../lib/jupiter.js';
import {
  createTriggerOrder,
  prepareTriggerOrderDeposit,
  requestTriggerChallenge,
  verifyTriggerChallenge,
} from '../lib/jupiter-trigger.js';
import {
  finalizeSwapPrivacyEnvelope,
  prepareSwapPrivacyEnvelope,
  refreshSwapPrivacyEnvelopeQuote,
} from '../lib/swap-privacy.js';
import type { AppEnv, Network } from '../lib/types.js';
import {
  DEFAULT_MAX_JSON_BODY_BYTES,
  isValidSolanaAddress,
  networkSchema,
  parseWithSchema,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';

const MAX_AMOUNT_DIGITS = 40;
const MAX_ID_LENGTH = 128;
const MAX_MINT_LENGTH = 64;
const MAX_SIGNATURE_LENGTH = 128;
const MAX_TRANSACTION_BASE64_LENGTH = 256_000;
const MAX_FREQUENCY_LENGTH = 64;

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

const mintStringSchema = z.string().trim().min(1).max(MAX_MINT_LENGTH);
const idStringSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);

const swapTokensQuerySchema = z.object({
  network: networkSchema,
});

const swapPriceQuerySchema = z.object({
  mint: mintStringSchema,
  network: networkSchema,
});

const swapQuoteBodySchema = z.object({
  inputMint: mintStringSchema,
  outputMint: mintStringSchema,
  amount: positiveIntegerStringSchema,
  slippageBps: z.coerce.number().int().min(0).max(10_000).optional(),
  receiverAddress: mintStringSchema.optional(),
  network: networkSchema,
});

const swapExecuteBodySchema = z.object({
  quoteId: idStringSchema,
  signedTransaction: base64StringSchema,
  network: networkSchema,
});

const swapRecurringCreateBodySchema = z.object({
  inputMint: mintStringSchema,
  outputMint: mintStringSchema,
  amount: positiveIntegerStringSchema,
  frequency: z.string().trim().min(1).max(MAX_FREQUENCY_LENGTH),
  network: networkSchema,
});

const swapRecurringExecuteBodySchema = z.object({
  recurringId: idStringSchema,
  signedTransaction: base64StringSchema,
  network: networkSchema,
});

const triggerChallengeBodySchema = z.object({
  action: z.literal('auth_challenge'),
  challengeType: z.enum(['message', 'transaction']).default('message'),
  network: networkSchema,
});

const triggerVerifyMessageBodySchema = z.object({
  action: z.literal('auth_verify'),
  challengeType: z.literal('message'),
  signature: z.string().trim().min(1).max(MAX_SIGNATURE_LENGTH),
  network: networkSchema,
});

const triggerVerifyTransactionBodySchema = z.object({
  action: z.literal('auth_verify'),
  challengeType: z.literal('transaction'),
  signedChallengeTransaction: base64StringSchema,
  network: networkSchema,
});

const triggerPrepareBodySchema = z.object({
  action: z.literal('prepare'),
  inputMint: mintStringSchema,
  outputMint: mintStringSchema,
  amount: positiveIntegerStringSchema,
  network: networkSchema,
});

const triggerCreateBodySchema = z
  .object({
    action: z.literal('create'),
    orderType: z.enum(['single', 'oco', 'otoco']),
    depositRequestId: idStringSchema,
    depositSignedTransaction: base64StringSchema,
    inputMint: mintStringSchema,
    inputAmount: positiveIntegerStringSchema,
    outputMint: mintStringSchema,
    triggerMint: mintStringSchema,
    expiresAt: z.coerce.number().int().positive(),
    triggerCondition: z.enum(['above', 'below']).optional(),
    triggerPriceUsd: z.coerce.number().positive().optional(),
    slippageBps: z.coerce.number().int().min(0).max(10_000).optional(),
    tpPriceUsd: z.coerce.number().positive().optional(),
    slPriceUsd: z.coerce.number().positive().optional(),
    tpSlippageBps: z.coerce.number().int().min(0).max(10_000).optional(),
    slSlippageBps: z.coerce.number().int().min(0).max(10_000).optional(),
    network: networkSchema,
  })
  .superRefine((value, context) => {
    if (value.expiresAt <= Date.now()) {
      context.addIssue({
        code: 'custom',
        message: 'expiresAt must be a future timestamp in milliseconds.',
        path: ['expiresAt'],
      });
    }

    switch (value.orderType) {
      case 'single':
        if (!value.triggerCondition) {
          context.addIssue({
            code: 'custom',
            message: 'Single trigger orders require triggerCondition.',
            path: ['triggerCondition'],
          });
        }

        if (value.triggerPriceUsd === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'Single trigger orders require triggerPriceUsd.',
            path: ['triggerPriceUsd'],
          });
        }
        break;
      case 'oco':
        if (value.tpPriceUsd === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'OCO trigger orders require tpPriceUsd.',
            path: ['tpPriceUsd'],
          });
        }

        if (value.slPriceUsd === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'OCO trigger orders require slPriceUsd.',
            path: ['slPriceUsd'],
          });
        }

        if (
          value.tpPriceUsd !== undefined &&
          value.slPriceUsd !== undefined &&
          value.tpPriceUsd <= value.slPriceUsd
        ) {
          context.addIssue({
            code: 'custom',
            message: 'tpPriceUsd must be greater than slPriceUsd.',
            path: ['tpPriceUsd'],
          });
        }
        break;
      case 'otoco':
        if (!value.triggerCondition) {
          context.addIssue({
            code: 'custom',
            message: 'OTOCO trigger orders require triggerCondition.',
            path: ['triggerCondition'],
          });
        }

        if (value.triggerPriceUsd === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'OTOCO trigger orders require triggerPriceUsd.',
            path: ['triggerPriceUsd'],
          });
        }

        if (value.tpPriceUsd === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'OTOCO trigger orders require tpPriceUsd.',
            path: ['tpPriceUsd'],
          });
        }

        if (value.slPriceUsd === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'OTOCO trigger orders require slPriceUsd.',
            path: ['slPriceUsd'],
          });
        }

        if (
          value.tpPriceUsd !== undefined &&
          value.slPriceUsd !== undefined &&
          value.tpPriceUsd <= value.slPriceUsd
        ) {
          context.addIssue({
            code: 'custom',
            message: 'tpPriceUsd must be greater than slPriceUsd.',
            path: ['tpPriceUsd'],
          });
        }
        break;
    }
  });

const privacyPrepareBodySchema = z.object({
  executorWallet: mintStringSchema,
  inputMint: mintStringSchema,
  outputMint: mintStringSchema,
  amount: positiveIntegerStringSchema,
  slippageBps: z.coerce.number().int().min(0).max(10_000),
  fundingMemo: z.string().trim().min(1).max(120).optional(),
  network: networkSchema,
});

const privacyFinalizeBodySchema = z.object({
  sessionId: idStringSchema,
  signedTransaction: base64StringSchema,
  settlementMemo: z.string().trim().min(1).max(120).optional(),
  network: networkSchema,
});

const privacyRefreshQuoteBodySchema = z.object({
  sessionId: idStringSchema,
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

async function readUnionJsonBody(
  request: Request,
  missingBodyMessage: string,
  invalidBodyMessage: string,
): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength != null && Number(contentLength) > DEFAULT_MAX_JSON_BODY_BYTES) {
    throw new AppError({
      status: 413,
      code: 'INVALID_REQUEST',
      message: 'Request body is too large.',
    });
  }

  const rawBody = await request.clone().text();
  if (rawBody.trim().length === 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: missingBodyMessage,
    });
  }

  if (rawBody.length > DEFAULT_MAX_JSON_BODY_BYTES) {
    throw new AppError({
      status: 413,
      code: 'INVALID_REQUEST',
      message: 'Request body is too large.',
    });
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: invalidBodyMessage,
      cause: error,
    });
  }
}

const swapRoutes = new Hono<AppEnv>();

swapRoutes.get('/tokens', async (context) => {
  const query = readSearchParams(context.req.url, swapTokensQuerySchema);

  const response = context.json(
    await getOrSetEdgeJsonCache({
      context,
      namespace: 'swap_tokens',
      keyParts: [query.network],
      freshTtlMs: SWAP_TOKENS_CACHE_TTL_MS,
      staleTtlMs: 10 * 60 * 1000,
      resolver: () => getSwapTokens(context.env, query.network),
    }),
  );
  // The response is identical for every caller and only depends on the
  // requested network, so we let Cloudflare's edge cache it for as long as
  // the in-process `SWAP_TOKENS_CACHE_TTL_MS` (5 min) holds. SWR keeps the
  // user experience instant while a single PoP refreshes upstream.
  response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return response;
});

swapRoutes.get('/price', async (context) => {
  const query = readSearchParams(context.req.url, swapPriceQuerySchema);

  assertSolanaAddress(query.mint, 'Mint address is invalid.');

  const response = context.json(
    await getSwapPrice(context.env, {
      mint: query.mint,
      network: query.network,
    }),
  );
  // Matches the in-process `SWAP_PRICE_CACHE_TTL_MS` (10 sec). Prices are
  // time-sensitive, so the TTL is short; SWR is also short to bound stale
  // exposure if the upstream is briefly unreachable.
  response.headers.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
  return response;
});

swapRoutes.post('/quote', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    swapQuoteBodySchema,
    'Swap quote request body is required.',
    'Invalid swap quote request body.',
  );

  assertSolanaAddress(body.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(body.outputMint, 'Output mint address is invalid.');
  if (body.receiverAddress) {
    assertSolanaAddress(body.receiverAddress, 'Receiver wallet address is invalid.');
  }
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await createSwapQuote(context.env, {
      takerAddress: authenticatedContext.wallet,
      inputMint: body.inputMint,
      outputMint: body.outputMint,
      amount: body.amount,
      ...(body.slippageBps === undefined ? {} : { slippageBps: body.slippageBps }),
      ...(body.receiverAddress ? { receiverAddress: body.receiverAddress } : {}),
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

swapRoutes.post('/execute', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    swapExecuteBodySchema,
    'Swap execute request body is required.',
    'Invalid swap execute request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await executeSwapQuote(context.env, {
      takerAddress: authenticatedContext.wallet,
      quoteId: body.quoteId,
      signedTransaction: body.signedTransaction,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

swapRoutes.post('/trigger', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const rawBody = await readUnionJsonBody(
    context.req.raw,
    'Swap trigger request body is required.',
    'Invalid swap trigger request body.',
  );

  const challengeBody = triggerChallengeBodySchema.safeParse(rawBody);
  if (challengeBody.success) {
    assertRequestedNetwork(challengeBody.data.network, authenticatedContext.network);

    const response = context.json(
      await requestTriggerChallenge(context.env, {
        walletAddress: authenticatedContext.wallet,
        network: challengeBody.data.network,
        challengeType: challengeBody.data.challengeType,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const verifyMessageBody = triggerVerifyMessageBodySchema.safeParse(rawBody);
  if (verifyMessageBody.success) {
    assertRequestedNetwork(verifyMessageBody.data.network, authenticatedContext.network);

    const response = context.json(
      await verifyTriggerChallenge(context.env, {
        walletAddress: authenticatedContext.wallet,
        network: verifyMessageBody.data.network,
        challengeType: 'message',
        signature: verifyMessageBody.data.signature,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const verifyTransactionBody = triggerVerifyTransactionBodySchema.safeParse(rawBody);
  if (verifyTransactionBody.success) {
    assertRequestedNetwork(verifyTransactionBody.data.network, authenticatedContext.network);

    const response = context.json(
      await verifyTriggerChallenge(context.env, {
        walletAddress: authenticatedContext.wallet,
        network: verifyTransactionBody.data.network,
        challengeType: 'transaction',
        signedChallengeTransaction: verifyTransactionBody.data.signedChallengeTransaction,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const prepareBody = triggerPrepareBodySchema.safeParse(rawBody);
  if (prepareBody.success) {
    assertSolanaAddress(prepareBody.data.inputMint, 'Input mint address is invalid.');
    assertSolanaAddress(prepareBody.data.outputMint, 'Output mint address is invalid.');
    assertRequestedNetwork(prepareBody.data.network, authenticatedContext.network);

    const response = context.json(
      await prepareTriggerOrderDeposit(context.env, {
        walletAddress: authenticatedContext.wallet,
        inputMint: prepareBody.data.inputMint,
        outputMint: prepareBody.data.outputMint,
        amount: prepareBody.data.amount,
        network: prepareBody.data.network,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const createBody = parseWithSchema(
    triggerCreateBodySchema,
    rawBody,
    'Invalid swap trigger request body.',
  );

  assertSolanaAddress(createBody.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(createBody.outputMint, 'Output mint address is invalid.');
  assertSolanaAddress(createBody.triggerMint, 'Trigger mint address is invalid.');
  assertRequestedNetwork(createBody.network, authenticatedContext.network);

  const response = context.json(
    await createTriggerOrder(context.env, {
      walletAddress: authenticatedContext.wallet,
      network: createBody.network,
      orderType: createBody.orderType,
      depositRequestId: createBody.depositRequestId,
      depositSignedTransaction: createBody.depositSignedTransaction,
      inputMint: createBody.inputMint,
      inputAmount: createBody.inputAmount,
      outputMint: createBody.outputMint,
      triggerMint: createBody.triggerMint,
      expiresAt: createBody.expiresAt,
      ...(createBody.triggerCondition ? { triggerCondition: createBody.triggerCondition } : {}),
      ...(createBody.triggerPriceUsd === undefined
        ? {}
        : { triggerPriceUsd: createBody.triggerPriceUsd }),
      ...(createBody.slippageBps === undefined ? {} : { slippageBps: createBody.slippageBps }),
      ...(createBody.tpPriceUsd === undefined ? {} : { tpPriceUsd: createBody.tpPriceUsd }),
      ...(createBody.slPriceUsd === undefined ? {} : { slPriceUsd: createBody.slPriceUsd }),
      ...(createBody.tpSlippageBps === undefined
        ? {}
        : { tpSlippageBps: createBody.tpSlippageBps }),
      ...(createBody.slSlippageBps === undefined
        ? {}
        : { slSlippageBps: createBody.slSlippageBps }),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

swapRoutes.post('/privacy-envelope/prepare', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privacyPrepareBodySchema,
    'Private swap prepare request body is required.',
    'Invalid private swap prepare request body.',
  );

  assertSolanaAddress(body.executorWallet, 'Executor wallet address is invalid.');
  assertSolanaAddress(body.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(body.outputMint, 'Output mint address is invalid.');
  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await prepareSwapPrivacyEnvelope(context.env, {
      ownerWallet: authenticatedContext.wallet,
      executorWallet: body.executorWallet,
      inputMint: body.inputMint,
      outputMint: body.outputMint,
      amount: body.amount,
      slippageBps: body.slippageBps,
      network: body.network,
      ...(body.fundingMemo ? { fundingMemo: body.fundingMemo } : {}),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

swapRoutes.post('/privacy-envelope/refresh-quote', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privacyRefreshQuoteBodySchema,
    'Private swap quote refresh request body is required.',
    'Invalid private swap quote refresh request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await refreshSwapPrivacyEnvelopeQuote(context.env, {
      ownerWallet: authenticatedContext.wallet,
      sessionId: body.sessionId,
      network: body.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

swapRoutes.post('/privacy-envelope/finalize', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const body = await readJsonBody(
    context.req.raw,
    privacyFinalizeBodySchema,
    'Private swap finalize request body is required.',
    'Invalid private swap finalize request body.',
  );

  assertRequestedNetwork(body.network, authenticatedContext.network);

  const response = context.json(
    await finalizeSwapPrivacyEnvelope(context.env, {
      ownerWallet: authenticatedContext.wallet,
      sessionId: body.sessionId,
      signedTransaction: body.signedTransaction,
      network: body.network,
      ...(body.settlementMemo ? { settlementMemo: body.settlementMemo } : {}),
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

swapRoutes.post('/recurring', async (context) => {
  const authenticatedContext = getAuthenticatedContext(context);
  const rawBody = await readUnionJsonBody(
    context.req.raw,
    'Swap recurring request body is required.',
    'Invalid swap recurring request body.',
  );

  const executeAttempt = swapRecurringExecuteBodySchema.safeParse(rawBody);
  if (executeAttempt.success) {
    assertRequestedNetwork(executeAttempt.data.network, authenticatedContext.network);

    const response = context.json(
      await executeRecurringOrder(context.env, {
        recurringId: executeAttempt.data.recurringId,
        signedTransaction: executeAttempt.data.signedTransaction,
        network: executeAttempt.data.network,
      }),
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const createBody = parseWithSchema(
    swapRecurringCreateBodySchema,
    rawBody,
    'Invalid swap recurring request body.',
  );
  assertSolanaAddress(createBody.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(createBody.outputMint, 'Output mint address is invalid.');
  assertRequestedNetwork(createBody.network, authenticatedContext.network);

  const response = context.json(
    await createRecurringOrder(context.env, {
      walletAddress: authenticatedContext.wallet,
      inputMint: createBody.inputMint,
      outputMint: createBody.outputMint,
      amount: createBody.amount,
      frequency: createBody.frequency,
      network: createBody.network,
    }),
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default swapRoutes;
