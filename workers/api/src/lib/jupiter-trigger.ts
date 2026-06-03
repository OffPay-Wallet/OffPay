import { AppError } from './errors.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
} from './provider-utils.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const JUPITER_TRIGGER_API_BASE_URL = 'https://api.jup.ag/trigger/v2';
const TRIGGER_AUTH_KEY_PREFIX = 'trigger-auth:v1';
const TRIGGER_JWT_TTL_MS = 24 * 60 * 60 * 1000;
const TRIGGER_JWT_REFRESH_WINDOW_MS = 5 * 60 * 1000;

type TriggerChallengeType = 'message' | 'transaction';
type TriggerOrderType = 'single' | 'oco' | 'otoco';
type TriggerCondition = 'above' | 'below';

interface TriggerChallengeRequest {
  walletAddress: string;
  network: Network;
  challengeType: TriggerChallengeType;
}

interface TriggerChallengeResponse {
  challengeType: TriggerChallengeType;
  challenge: string | null;
  unsignedChallengeTransaction: string | null;
}

interface TriggerAuthenticationRequest {
  walletAddress: string;
  network: Network;
  challengeType: TriggerChallengeType;
  signature?: string;
  signedChallengeTransaction?: string;
}

interface TriggerAuthenticationResponse {
  authenticated: true;
  expiresAt: number;
}

interface TriggerVaultResponse {
  walletAddress: string;
  vaultAddress: string;
  privyVaultId: string;
  privyUserId: string | null;
}

interface TriggerDepositPreparationRequest {
  walletAddress: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  network: Network;
}

interface TriggerDepositPreparationResponse {
  depositRequestId: string;
  unsignedTransaction: string;
  receiverAddress: string | null;
  mint: string;
  amount: string;
  tokenDecimals: number | null;
  vault: TriggerVaultResponse;
}

interface TriggerOrderRequest {
  walletAddress: string;
  network: Network;
  orderType: TriggerOrderType;
  depositRequestId: string;
  depositSignedTransaction: string;
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  expiresAt: number;
  triggerCondition?: TriggerCondition;
  triggerPriceUsd?: number;
  slippageBps?: number;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
}

interface TriggerOrderResponse {
  triggerId: string;
  status: 'open';
  depositSignature: string;
}

interface JupiterTriggerHttpResult {
  response: Response;
  payload: unknown;
}

interface StoredTriggerAuthSession {
  walletAddress: string;
  network: Network;
  token: string;
  expiresAt: number;
}

function extractProviderMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return sanitizeText(
    readTrimmedString(payload.error) ??
      readTrimmedString(payload.message) ??
      readTrimmedString(payload.cause) ??
      readTrimmedString(payload.status),
    160,
  );
}

function assertBase64Transaction(value: string, message: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length === 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertPositiveIntegerAmount(value: string, message: string): void {
  if (!/^\d+$/.test(value) || value === '0') {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertSupportedMint(mint: string, message: string): void {
  if (!isValidSolanaAddress(mint)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertTriggerMainnet(network: Network): void {
  if (network === 'mainnet') {
    return;
  }

  throw new AppError({
    status: 400,
    code: 'INVALID_NETWORK',
    message: 'Jupiter Trigger V2 is currently available only on mainnet.',
  });
}

function buildTriggerAuthKey(network: Network, walletAddress: string): string {
  return `${TRIGGER_AUTH_KEY_PREFIX}:${network}:${walletAddress}`;
}

function buildTriggerHeaders(
  bindings: Bindings,
  jwtToken?: string,
  extraHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(extraHeaders);
  headers.set('x-api-key', getRequiredBinding(bindings, 'JUPITER_API_KEY'));

  if (jwtToken) {
    headers.set('Authorization', `Bearer ${jwtToken}`);
  }

  return headers;
}

async function fetchTriggerJson(
  bindings: Bindings,
  path: string,
  init: RequestInit,
  errorMessage: string,
  jwtToken?: string,
): Promise<JupiterTriggerHttpResult> {
  let response: Response;
  try {
    response = await fetch(`${JUPITER_TRIGGER_API_BASE_URL}${path}`, {
      ...init,
      headers: buildTriggerHeaders(bindings, jwtToken, init.headers),
    });
  } catch (error) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: errorMessage,
      retryable: true,
      cause: error,
    });
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { response, payload };
}

async function storeTriggerAuthSession(
  bindings: Bindings,
  session: StoredTriggerAuthSession,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await runKvPipeline(bindings, [[
    'SET',
    buildTriggerAuthKey(session.network, session.walletAddress),
    JSON.stringify(session),
    'EX',
    ttlSeconds,
  ]], 'Trigger session storage is unavailable.');
}

async function clearTriggerAuthSession(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildTriggerAuthKey(network, walletAddress)]],
    'Trigger session storage is unavailable.',
  );
}

async function getTriggerAuthSession(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
): Promise<StoredTriggerAuthSession | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildTriggerAuthKey(network, walletAddress)]],
    'Trigger session storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const storedWalletAddress = readTrimmedString(parsed.walletAddress);
  const storedNetwork = readTrimmedString(parsed.network);
  const token = readTrimmedString(parsed.token);
  const expiresAt = readFiniteNumber(parsed.expiresAt);

  if (
    !storedWalletAddress ||
    !token ||
    (storedNetwork !== 'devnet' && storedNetwork !== 'mainnet') ||
    expiresAt === null
  ) {
    return null;
  }

  return {
    walletAddress: storedWalletAddress,
    network: storedNetwork,
    token,
    expiresAt,
  };
}

async function requireTriggerAuthSession(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
): Promise<StoredTriggerAuthSession> {
  const session = await getTriggerAuthSession(bindings, walletAddress, network);
  if (!session || session.expiresAt <= Date.now() + TRIGGER_JWT_REFRESH_WINDOW_MS) {
    if (session) {
      await clearTriggerAuthSession(bindings, walletAddress, network);
    }

    throw new AppError({
      status: 401,
      code: 'TRIGGER_AUTH_REQUIRED',
      message: 'Trigger authentication has expired. Please authenticate again.',
      retryable: true,
    });
  }

  return session;
}

async function withTriggerAuthRetry<T>(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
  execute: (jwtToken: string) => Promise<T>,
): Promise<T> {
  const session = await requireTriggerAuthSession(bindings, walletAddress, network);

  try {
    return await execute(session.token);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      await clearTriggerAuthSession(bindings, walletAddress, network);
      throw new AppError({
        status: 401,
        code: 'TRIGGER_AUTH_REQUIRED',
        message: 'Trigger authentication has expired. Please authenticate again.',
        retryable: true,
      });
    }

    throw error;
  }
}

function parseVaultResponse(payload: unknown, walletAddress: string): TriggerVaultResponse {
  if (!isRecord(payload)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger vault details are currently unavailable.',
      retryable: true,
    });
  }

  const userPubkey = readTrimmedString(payload.userPubkey);
  const vaultPubkey = readTrimmedString(payload.vaultPubkey);
  const privyVaultId = readTrimmedString(payload.privyVaultId);
  const privyUserId = readTrimmedString(payload.privyUserId);

  if (!userPubkey || !vaultPubkey || !privyVaultId) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger vault details are currently unavailable.',
      retryable: true,
    });
  }

  return {
    walletAddress: walletAddress,
    vaultAddress: vaultPubkey,
    privyVaultId,
    privyUserId,
  };
}

async function requestTriggerChallenge(
  bindings: Bindings,
  request: TriggerChallengeRequest,
): Promise<TriggerChallengeResponse> {
  assertTriggerMainnet(request.network);

  const { response, payload } = await fetchTriggerJson(
    bindings,
    '/auth/challenge',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletPubkey: request.walletAddress,
        type: request.challengeType,
      }),
    },
    'Trigger authentication is currently unavailable.',
  );

  if (!response.ok || !isRecord(payload)) {
    throw new AppError({
      status: response.status === 400 ? 400 : 503,
      code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'Trigger authentication is currently unavailable.',
      retryable: response.status !== 400,
    });
  }

  const responseType = readTrimmedString(payload.type);
  if (responseType !== 'message' && responseType !== 'transaction') {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger authentication challenge is currently unavailable.',
      retryable: true,
    });
  }

  const challenge = readTrimmedString(payload.challenge);
  const unsignedChallengeTransaction = readTrimmedString(payload.transaction);
  if (
    (responseType === 'message' && !challenge) ||
    (responseType === 'transaction' && !unsignedChallengeTransaction)
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger authentication challenge is currently unavailable.',
      retryable: true,
    });
  }

  return {
    challengeType: responseType,
    challenge: challenge ?? null,
    unsignedChallengeTransaction: unsignedChallengeTransaction ?? null,
  };
}

async function verifyTriggerChallenge(
  bindings: Bindings,
  request: TriggerAuthenticationRequest,
): Promise<TriggerAuthenticationResponse> {
  assertTriggerMainnet(request.network);

  if (request.challengeType === 'message') {
    const signature = request.signature?.trim();
    if (!signature) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'A base58 signature is required for trigger message authentication.',
      });
    }
  } else {
    const signedChallengeTransaction = request.signedChallengeTransaction?.trim();
    if (!signedChallengeTransaction) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message:
          'A signed base64 transaction is required for hardware-wallet trigger authentication.',
      });
    }

    assertBase64Transaction(
      signedChallengeTransaction,
      'Signed challenge transaction must be base64-encoded.',
    );
  }

  const body =
    request.challengeType === 'message'
      ? {
          type: 'message',
          walletPubkey: request.walletAddress,
          signature: request.signature?.trim(),
        }
      : {
          type: 'transaction',
          walletPubkey: request.walletAddress,
          signedTransaction: request.signedChallengeTransaction?.trim(),
        };

  const { response, payload } = await fetchTriggerJson(
    bindings,
    '/auth/verify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    'Trigger authentication verification is currently unavailable.',
  );

  if (!response.ok || !isRecord(payload)) {
    throw new AppError({
      status: response.status === 400 ? 400 : 503,
      code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ??
        'Trigger authentication verification is currently unavailable.',
      retryable: response.status !== 400,
    });
  }

  const token = readTrimmedString(payload.token);
  if (!token) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger authentication verification is currently unavailable.',
      retryable: true,
    });
  }

  const expiresAt = Date.now() + TRIGGER_JWT_TTL_MS;
  await storeTriggerAuthSession(bindings, {
    walletAddress: request.walletAddress,
    network: request.network,
    token,
    expiresAt,
  });

  return {
    authenticated: true,
    expiresAt,
  };
}

async function getOrRegisterTriggerVault(
  bindings: Bindings,
  walletAddress: string,
  network: Network,
): Promise<TriggerVaultResponse> {
  assertTriggerMainnet(network);

  return withTriggerAuthRetry(bindings, walletAddress, network, async (jwtToken) => {
    const vaultResult = await fetchTriggerJson(
      bindings,
      '/vault',
      {
        method: 'GET',
      },
      'Trigger vault details are currently unavailable.',
      jwtToken,
    );

    if (vaultResult.response.ok) {
      return parseVaultResponse(vaultResult.payload, walletAddress);
    }

    if (vaultResult.response.status === 401 || vaultResult.response.status === 403) {
      throw new AppError({
        status: 401,
        code: 'TRIGGER_AUTH_REQUIRED',
        message: 'Trigger authentication has expired. Please authenticate again.',
        retryable: true,
      });
    }

    const registerResult = await fetchTriggerJson(
      bindings,
      '/vault/register',
      {
        method: 'GET',
      },
      'Trigger vault details are currently unavailable.',
      jwtToken,
    );

    if (!registerResult.response.ok) {
      throw new AppError({
        status: registerResult.response.status === 400 ? 400 : 503,
        code: registerResult.response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
        message:
          extractProviderMessage(registerResult.payload) ??
          'Trigger vault details are currently unavailable.',
        retryable: registerResult.response.status !== 400,
      });
    }

    return parseVaultResponse(registerResult.payload, walletAddress);
  });
}

async function prepareTriggerOrderDeposit(
  bindings: Bindings,
  request: TriggerDepositPreparationRequest,
): Promise<TriggerDepositPreparationResponse> {
  assertTriggerMainnet(request.network);
  assertSupportedMint(request.inputMint, 'Input mint address is invalid.');
  assertSupportedMint(request.outputMint, 'Output mint address is invalid.');
  assertPositiveIntegerAmount(
    request.amount,
    'Trigger order amount must be a positive integer string.',
  );

  const vault = await getOrRegisterTriggerVault(bindings, request.walletAddress, request.network);

  return withTriggerAuthRetry(bindings, request.walletAddress, request.network, async (jwtToken) => {
    const { response, payload } = await fetchTriggerJson(
      bindings,
      '/deposit/craft',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          userAddress: request.walletAddress,
          amount: request.amount,
        }),
      },
      'Trigger deposit preparation is currently unavailable.',
      jwtToken,
    );

    if (!response.ok || !isRecord(payload)) {
      throw new AppError({
        status: response.status === 400 ? 400 : 503,
        code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
        message:
          extractProviderMessage(payload) ?? 'Trigger deposit preparation is currently unavailable.',
        retryable: response.status !== 400,
      });
    }

    const depositRequestId = readTrimmedString(payload.requestId);
    const unsignedTransaction = readTrimmedString(payload.transaction);
    const receiverAddress = readTrimmedString(payload.receiverAddress);
    const mint = readTrimmedString(payload.mint);
    const amount = readTrimmedString(payload.amount);
    const tokenDecimals = readFiniteNumber(payload.tokenDecimals);

    if (!depositRequestId || !unsignedTransaction || !mint || !amount) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Trigger deposit preparation is currently unavailable.',
        retryable: true,
      });
    }

    return {
      depositRequestId,
      unsignedTransaction,
      receiverAddress,
      mint,
      amount,
      tokenDecimals,
      vault,
    };
  });
}

function assertSlippageBps(value: number | undefined, fieldLabel: string): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${fieldLabel} must be an integer between 0 and 10000.`,
    });
  }
}

function assertPositivePrice(value: number | undefined, fieldLabel: string): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `${fieldLabel} must be a positive number.`,
    });
  }
}

function validateTriggerOrderRequest(request: TriggerOrderRequest): void {
  assertTriggerMainnet(request.network);
  assertSupportedMint(request.inputMint, 'Input mint address is invalid.');
  assertSupportedMint(request.outputMint, 'Output mint address is invalid.');
  assertSupportedMint(request.triggerMint, 'Trigger mint address is invalid.');
  assertPositiveIntegerAmount(
    request.inputAmount,
    'Trigger order inputAmount must be a positive integer string.',
  );
  assertBase64Transaction(
    request.depositSignedTransaction,
    'Signed trigger deposit transaction must be base64-encoded.',
  );

  if (request.expiresAt <= Date.now()) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Trigger order expiresAt must be a future timestamp in milliseconds.',
    });
  }

  assertSlippageBps(request.slippageBps, 'Trigger order slippageBps');
  assertSlippageBps(request.tpSlippageBps, 'Trigger order tpSlippageBps');
  assertSlippageBps(request.slSlippageBps, 'Trigger order slSlippageBps');

  switch (request.orderType) {
    case 'single':
      if (!request.triggerCondition) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'Single trigger orders require a triggerCondition.',
        });
      }

      assertPositivePrice(request.triggerPriceUsd, 'Trigger order triggerPriceUsd');
      if (request.triggerPriceUsd === undefined) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'Single trigger orders require a triggerPriceUsd.',
        });
      }
      break;
    case 'oco':
      assertPositivePrice(request.tpPriceUsd, 'Trigger order tpPriceUsd');
      assertPositivePrice(request.slPriceUsd, 'Trigger order slPriceUsd');
      if (request.tpPriceUsd === undefined || request.slPriceUsd === undefined) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'OCO trigger orders require both tpPriceUsd and slPriceUsd.',
        });
      }

      if (request.tpPriceUsd <= request.slPriceUsd) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'OCO take-profit price must be greater than stop-loss price.',
        });
      }
      break;
    case 'otoco':
      if (!request.triggerCondition) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'OTOCO trigger orders require a parent triggerCondition.',
        });
      }

      assertPositivePrice(request.triggerPriceUsd, 'Trigger order triggerPriceUsd');
      assertPositivePrice(request.tpPriceUsd, 'Trigger order tpPriceUsd');
      assertPositivePrice(request.slPriceUsd, 'Trigger order slPriceUsd');

      if (
        request.triggerPriceUsd === undefined ||
        request.tpPriceUsd === undefined ||
        request.slPriceUsd === undefined
      ) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message:
            'OTOCO trigger orders require triggerPriceUsd, tpPriceUsd, and slPriceUsd.',
        });
      }

      if (request.tpPriceUsd <= request.slPriceUsd) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'OTOCO take-profit price must be greater than stop-loss price.',
        });
      }
      break;
  }
}

async function createTriggerOrder(
  bindings: Bindings,
  request: TriggerOrderRequest,
): Promise<TriggerOrderResponse> {
  validateTriggerOrderRequest(request);

  return withTriggerAuthRetry(bindings, request.walletAddress, request.network, async (jwtToken) => {
    const body: Record<string, unknown> = {
      orderType: request.orderType,
      depositRequestId: request.depositRequestId,
      depositSignedTx: request.depositSignedTransaction,
      userPubkey: request.walletAddress,
      inputMint: request.inputMint,
      inputAmount: request.inputAmount,
      outputMint: request.outputMint,
      triggerMint: request.triggerMint,
      expiresAt: request.expiresAt,
    };

    if (request.triggerCondition) {
      body.triggerCondition = request.triggerCondition;
    }

    if (request.triggerPriceUsd !== undefined) {
      body.triggerPriceUsd = request.triggerPriceUsd;
    }

    if (request.slippageBps !== undefined) {
      body.slippageBps = request.slippageBps;
    }

    if (request.tpPriceUsd !== undefined) {
      body.tpPriceUsd = request.tpPriceUsd;
    }

    if (request.slPriceUsd !== undefined) {
      body.slPriceUsd = request.slPriceUsd;
    }

    if (request.tpSlippageBps !== undefined) {
      body.tpSlippageBps = request.tpSlippageBps;
    }

    if (request.slSlippageBps !== undefined) {
      body.slSlippageBps = request.slSlippageBps;
    }

    const { response, payload } = await fetchTriggerJson(
      bindings,
      '/orders/price',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      'Trigger order creation is currently unavailable.',
      jwtToken,
    );

    if (!response.ok || !isRecord(payload)) {
      throw new AppError({
        status: response.status === 400 ? 400 : 503,
        code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
        message: extractProviderMessage(payload) ?? 'Trigger order creation is currently unavailable.',
        retryable: response.status !== 400,
      });
    }

    const triggerId = readTrimmedString(payload.id);
    const depositSignature = readTrimmedString(payload.txSignature);

    if (!triggerId || !depositSignature) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Trigger order creation is currently unavailable.',
        retryable: true,
      });
    }

    return {
      triggerId,
      status: 'open',
      depositSignature,
    };
  });
}

export {
  createTriggerOrder,
  getOrRegisterTriggerVault,
  prepareTriggerOrderDeposit,
  requestTriggerChallenge,
  verifyTriggerChallenge,
  type TriggerAuthenticationRequest,
  type TriggerAuthenticationResponse,
  type TriggerChallengeRequest,
  type TriggerChallengeResponse,
  type TriggerChallengeType,
  type TriggerCondition,
  type TriggerDepositPreparationRequest,
  type TriggerDepositPreparationResponse,
  type TriggerOrderRequest,
  type TriggerOrderResponse,
  type TriggerOrderType,
  type TriggerVaultResponse,
};
