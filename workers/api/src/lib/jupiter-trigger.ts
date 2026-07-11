import { AppError } from './errors.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
} from './provider-utils.js';
import { acquireRedisLock, releaseRedisLock } from './redis-lock.js';
import { readBoundTransactionMessage } from './solana-transaction-binding.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const DEFAULT_JUPITER_TRIGGER_API_BASE_URL = 'https://api.jup.ag/trigger/v2';
const TRIGGER_AUTH_KEY_PREFIX = 'trigger-auth:v1';
const TRIGGER_JWT_TTL_MS = 24 * 60 * 60 * 1000;
const TRIGGER_JWT_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const TRIGGER_DEPOSIT_KEY_PREFIX = 'trigger-deposit:v1';
const TRIGGER_DEPOSIT_LOCK_KEY_PREFIX = 'trigger-deposit-lock:v1';
const TRIGGER_DEPOSIT_TTL_MS = 60_000;
const TRIGGER_DEPOSIT_LOCK_TTL_SECONDS = 120;
const TRIGGER_CANCEL_KEY_PREFIX = 'trigger-cancel:v1';
const TRIGGER_CANCEL_LOCK_KEY_PREFIX = 'trigger-cancel-lock:v1';
const TRIGGER_CANCEL_TTL_MS = 5 * 60_000;
const TRIGGER_CANCEL_RESULT_TTL_MS = 24 * 60 * 60_000;
const TRIGGER_CANCEL_LOCK_TTL_SECONDS = 120;

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
  orderSubType: TriggerOrderType;
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

type TriggerOrderState =
  | 'pending'
  | 'open'
  | 'executing'
  | 'filled'
  | 'pending_withdraw'
  | 'cancelled'
  | 'expired'
  | 'failed';

interface TriggerOrderSummary {
  id: string;
  orderType: TriggerOrderType;
  orderState: TriggerOrderState;
  rawState: string | null;
  inputMint: string;
  outputMint: string;
  triggerMint: string | null;
  initialInputAmount: string | null;
  remainingInputAmount: string | null;
  outputAmount: string | null;
  expiresAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

interface TriggerOrderListRequest {
  walletAddress: string;
  network: Network;
  state?: 'active' | 'past';
  limit?: number;
  offset?: number;
}

interface TriggerOrderListResponse {
  orders: TriggerOrderSummary[];
  pagination: { total: number; limit: number; offset: number };
}

interface TriggerCancelPrepareRequest {
  walletAddress: string;
  network: Network;
  orderId: string;
}

interface TriggerCancelPrepareResponse {
  orderId: string;
  cancelRequestId: string;
  unsignedTransaction: string;
}

interface TriggerCancelConfirmRequest {
  walletAddress: string;
  network: Network;
  orderId: string;
  cancelRequestId: string;
  signedTransaction: string;
}

interface TriggerCancelConfirmResponse {
  orderId: string;
  status: 'cancelled';
  signature: string;
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

interface StoredTriggerDeposit {
  walletAddress: string;
  network: Network;
  inputMint: string;
  outputMint: string;
  amount: string;
  orderSubType: TriggerOrderType;
  transactionMessageBase64: string;
  expiresAt: number;
}

interface StoredTriggerCancelIntent {
  walletAddress: string;
  network: Network;
  orderId: string;
  transactionMessageBase64: string;
  status: 'pending' | 'completed';
  signature: string | null;
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

function assertTriggerLifecycleVerifiable(): void {
  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message:
      'Trigger order creation and cancellation are disabled until vault withdrawal transactions can be semantically verified for every refund leg.',
    retryable: false,
  });
}

function buildTriggerAuthKey(network: Network, walletAddress: string): string {
  return `${TRIGGER_AUTH_KEY_PREFIX}:${network}:${walletAddress}`;
}

function buildTriggerDepositKey(depositRequestId: string): string {
  return `${TRIGGER_DEPOSIT_KEY_PREFIX}:${depositRequestId}`;
}

function buildTriggerDepositLockKey(depositRequestId: string): string {
  return `${TRIGGER_DEPOSIT_LOCK_KEY_PREFIX}:${depositRequestId}`;
}

function buildTriggerCancelKey(cancelRequestId: string): string {
  return `${TRIGGER_CANCEL_KEY_PREFIX}:${cancelRequestId}`;
}

function buildTriggerCancelLockKey(cancelRequestId: string): string {
  return `${TRIGGER_CANCEL_LOCK_KEY_PREFIX}:${cancelRequestId}`;
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

function readJupiterTriggerApiBaseUrl(bindings: Bindings): string {
  const configuredUrl =
    bindings.JUPITER_TRIGGER_API_BASE_URL?.trim() || DEFAULT_JUPITER_TRIGGER_API_BASE_URL;

  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol !== 'https:') throw new Error('Jupiter Trigger API must use HTTPS.');
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Jupiter Trigger API configuration is unavailable.',
      retryable: true,
      cause: error,
    });
  }
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
    response = await fetch(`${readJupiterTriggerApiBaseUrl(bindings)}${path}`, {
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
  await runKvPipeline(
    bindings,
    [
      [
        'SET',
        buildTriggerAuthKey(session.network, session.walletAddress),
        JSON.stringify(session),
        'EX',
        ttlSeconds,
      ],
    ],
    'Trigger session storage is unavailable.',
  );
}

async function storeTriggerDeposit(
  bindings: Bindings,
  depositRequestId: string,
  deposit: StoredTriggerDeposit,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((deposit.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [['SET', buildTriggerDepositKey(depositRequestId), JSON.stringify(deposit), 'EX', ttlSeconds]],
    'Trigger deposit state storage is unavailable.',
  );
}

async function getTriggerDeposit(
  bindings: Bindings,
  depositRequestId: string,
): Promise<StoredTriggerDeposit | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildTriggerDepositKey(depositRequestId)]],
    'Trigger deposit state storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isRecord(parsed)) return null;
    const walletAddress = readTrimmedString(parsed.walletAddress);
    const network = readTrimmedString(parsed.network);
    const inputMint = readTrimmedString(parsed.inputMint);
    const outputMint = readTrimmedString(parsed.outputMint);
    const amount = readTrimmedString(parsed.amount);
    const orderSubType = readTrimmedString(parsed.orderSubType);
    const transactionMessageBase64 = readTrimmedString(parsed.transactionMessageBase64);
    const expiresAt = readFiniteNumber(parsed.expiresAt);
    if (
      !walletAddress ||
      !isValidSolanaAddress(walletAddress) ||
      (network !== 'mainnet' && network !== 'devnet') ||
      !inputMint ||
      !isValidSolanaAddress(inputMint) ||
      !outputMint ||
      !isValidSolanaAddress(outputMint) ||
      !amount ||
      (orderSubType !== 'single' && orderSubType !== 'oco' && orderSubType !== 'otoco') ||
      !transactionMessageBase64 ||
      expiresAt == null
    ) {
      return null;
    }
    return {
      walletAddress,
      network,
      inputMint,
      outputMint,
      amount,
      orderSubType,
      transactionMessageBase64,
      expiresAt,
    };
  } catch {
    return null;
  }
}

async function deleteTriggerDeposit(bindings: Bindings, depositRequestId: string): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildTriggerDepositKey(depositRequestId)]],
    'Trigger deposit state storage is unavailable.',
  );
}

async function storeTriggerCancelIntent(
  bindings: Bindings,
  cancelRequestId: string,
  intent: StoredTriggerCancelIntent,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((intent.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [['SET', buildTriggerCancelKey(cancelRequestId), JSON.stringify(intent), 'EX', ttlSeconds]],
    'Trigger cancellation state storage is unavailable.',
  );
}

async function getTriggerCancelIntent(
  bindings: Bindings,
  cancelRequestId: string,
): Promise<StoredTriggerCancelIntent | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildTriggerCancelKey(cancelRequestId)]],
    'Trigger cancellation state storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isRecord(parsed)) return null;
    const walletAddress = readTrimmedString(parsed.walletAddress);
    const network = readTrimmedString(parsed.network);
    const orderId = readTrimmedString(parsed.orderId);
    const transactionMessageBase64 = readTrimmedString(parsed.transactionMessageBase64);
    const status = readTrimmedString(parsed.status);
    const signature = readTrimmedString(parsed.signature);
    const expiresAt = readFiniteNumber(parsed.expiresAt);
    if (
      !walletAddress ||
      !isValidSolanaAddress(walletAddress) ||
      network !== 'mainnet' ||
      !orderId ||
      !transactionMessageBase64 ||
      (status !== 'pending' && status !== 'completed') ||
      (status === 'completed' && !signature) ||
      expiresAt == null
    ) {
      return null;
    }
    return {
      walletAddress,
      network,
      orderId,
      transactionMessageBase64,
      status,
      signature,
      expiresAt,
    };
  } catch {
    return null;
  }
}

async function deleteTriggerCancelIntent(
  bindings: Bindings,
  cancelRequestId: string,
): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildTriggerCancelKey(cancelRequestId)]],
    'Trigger cancellation state storage is unavailable.',
  );
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
  if (
    !session ||
    session.walletAddress !== walletAddress ||
    session.network !== network ||
    session.expiresAt <= Date.now() + TRIGGER_JWT_REFRESH_WINDOW_MS
  ) {
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

  if (
    !userPubkey ||
    userPubkey !== walletAddress ||
    !vaultPubkey ||
    !isValidSolanaAddress(vaultPubkey) ||
    !privyVaultId
  ) {
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

function assertTriggerOrderId(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new AppError({ status: 400, code: 'INVALID_REQUEST', message: `${label} is invalid.` });
  }
}

function parseTriggerOrderSummary(value: unknown, walletAddress: string): TriggerOrderSummary {
  if (!isRecord(value)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger order history returned an invalid order.',
      retryable: true,
    });
  }
  const id = readTrimmedString(value.id);
  const orderType = readTrimmedString(value.orderType);
  const orderState = readTrimmedString(value.orderState);
  const userPubkey = readTrimmedString(value.userPubkey);
  const inputMint = readTrimmedString(value.inputMint);
  const outputMint = readTrimmedString(value.outputMint);
  const triggerMint = readTrimmedString(value.triggerMint);
  const validState =
    orderState === 'pending' ||
    orderState === 'open' ||
    orderState === 'executing' ||
    orderState === 'filled' ||
    orderState === 'pending_withdraw' ||
    orderState === 'cancelled' ||
    orderState === 'expired' ||
    orderState === 'failed';
  if (
    !id ||
    (orderType !== 'single' && orderType !== 'oco' && orderType !== 'otoco') ||
    !validState ||
    userPubkey !== walletAddress ||
    !inputMint ||
    !isValidSolanaAddress(inputMint) ||
    !outputMint ||
    !isValidSolanaAddress(outputMint) ||
    (triggerMint != null && !isValidSolanaAddress(triggerMint))
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Trigger order history could not be verified for this wallet.',
      retryable: true,
    });
  }
  return {
    id,
    orderType,
    orderState,
    rawState: readTrimmedString(value.rawState),
    inputMint,
    outputMint,
    triggerMint,
    initialInputAmount: readTrimmedString(value.initialInputAmount),
    remainingInputAmount: readTrimmedString(value.remainingInputAmount),
    outputAmount: readTrimmedString(value.outputAmount),
    expiresAt: readFiniteNumber(value.expiresAt),
    createdAt: readFiniteNumber(value.createdAt),
    updatedAt: readFiniteNumber(value.updatedAt),
  };
}

async function listTriggerOrders(
  bindings: Bindings,
  request: TriggerOrderListRequest,
): Promise<TriggerOrderListResponse> {
  assertTriggerMainnet(request.network);
  const limit = request.limit ?? 20;
  const offset = request.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Trigger order pagination is invalid.',
    });
  }
  return withTriggerAuthRetry(
    bindings,
    request.walletAddress,
    request.network,
    async (jwtToken) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        sort: 'updated_at',
        dir: 'desc',
      });
      if (request.state) params.set('state', request.state);
      const { response, payload } = await fetchTriggerJson(
        bindings,
        `/orders/history?${params.toString()}`,
        { method: 'GET' },
        'Trigger order history is currently unavailable.',
        jwtToken,
      );
      if (!response.ok || !isRecord(payload) || !Array.isArray(payload.orders)) {
        throw new AppError({
          status: response.status === 401 || response.status === 403 ? response.status : 503,
          code:
            response.status === 401
              ? 'TRIGGER_AUTH_REQUIRED'
              : response.status === 403
                ? 'INVALID_REQUEST'
                : 'UPSTREAM_UNAVAILABLE',
          message:
            extractProviderMessage(payload) ?? 'Trigger order history is currently unavailable.',
          retryable: response.status !== 403,
        });
      }
      const pagination = isRecord(payload.pagination) ? payload.pagination : null;
      const total = pagination ? readFiniteNumber(pagination.total) : null;
      const responseLimit = pagination ? readFiniteNumber(pagination.limit) : null;
      const responseOffset = pagination ? readFiniteNumber(pagination.offset) : null;
      if (
        total == null ||
        responseLimit == null ||
        responseOffset == null ||
        !Number.isInteger(total) ||
        !Number.isInteger(responseLimit) ||
        !Number.isInteger(responseOffset) ||
        total < 0 ||
        responseLimit < 1 ||
        responseOffset < 0
      ) {
        throw new AppError({
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Trigger order history pagination is invalid.',
          retryable: true,
        });
      }
      return {
        orders: payload.orders.map((order) =>
          parseTriggerOrderSummary(order, request.walletAddress),
        ),
        pagination: { total, limit: responseLimit, offset: responseOffset },
      };
    },
  );
}

async function prepareTriggerOrderDeposit(
  bindings: Bindings,
  request: TriggerDepositPreparationRequest,
): Promise<TriggerDepositPreparationResponse> {
  assertTriggerLifecycleVerifiable();
  assertTriggerMainnet(request.network);
  assertSupportedMint(request.inputMint, 'Input mint address is invalid.');
  assertSupportedMint(request.outputMint, 'Output mint address is invalid.');
  assertPositiveIntegerAmount(
    request.amount,
    'Trigger order amount must be a positive integer string.',
  );

  const vault = await getOrRegisterTriggerVault(bindings, request.walletAddress, request.network);

  return withTriggerAuthRetry(
    bindings,
    request.walletAddress,
    request.network,
    async (jwtToken) => {
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
            orderType: 'price',
            orderSubType: request.orderSubType,
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
            extractProviderMessage(payload) ??
            'Trigger deposit preparation is currently unavailable.',
          retryable: response.status !== 400,
        });
      }

      const depositRequestId = readTrimmedString(payload.requestId);
      const unsignedTransaction = readTrimmedString(payload.transaction);
      const receiverAddress = readTrimmedString(payload.receiverAddress);
      const mint = readTrimmedString(payload.mint);
      const amount = readTrimmedString(payload.amount);
      const tokenDecimals = readFiniteNumber(payload.tokenDecimals);

      if (
        !depositRequestId ||
        !unsignedTransaction ||
        mint !== request.inputMint ||
        amount !== request.amount ||
        (receiverAddress != null && !isValidSolanaAddress(receiverAddress))
      ) {
        throw new AppError({
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Trigger deposit preparation is currently unavailable.',
          retryable: true,
        });
      }

      await storeTriggerDeposit(bindings, depositRequestId, {
        walletAddress: request.walletAddress,
        network: request.network,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        orderSubType: request.orderSubType,
        transactionMessageBase64: readBoundTransactionMessage({
          transactionBase64: unsignedTransaction,
          requiredSignerAddress: request.walletAddress,
          requireSignerSignature: false,
          label: 'Trigger deposit',
        }),
        expiresAt: Date.now() + TRIGGER_DEPOSIT_TTL_MS,
      });

      return {
        depositRequestId,
        unsignedTransaction,
        receiverAddress,
        mint,
        amount,
        tokenDecimals,
        vault,
      };
    },
  );
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
          message: 'OTOCO trigger orders require triggerPriceUsd, tpPriceUsd, and slPriceUsd.',
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
  assertTriggerLifecycleVerifiable();
  validateTriggerOrderRequest(request);

  const lockKey = buildTriggerDepositLockKey(request.depositRequestId);
  const lockToken = await acquireRedisLock({
    bindings,
    key: lockKey,
    ttlSeconds: TRIGGER_DEPOSIT_LOCK_TTL_SECONDS,
    unavailableMessage: 'Trigger deposit state storage is unavailable.',
  });
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This trigger deposit is already being submitted.',
      retryable: true,
      retryAfterMs: 1000,
    });
  }
  const acquiredLockToken = lockToken;

  try {
    const deposit = await getTriggerDeposit(bindings, request.depositRequestId);
    if (deposit == null) {
      throw new AppError({
        status: 409,
        code: 'QUOTE_EXPIRED',
        message: 'The trigger deposit draft expired. Please prepare and sign a fresh deposit.',
        retryable: true,
      });
    }
    if (
      deposit.walletAddress !== request.walletAddress ||
      deposit.network !== request.network ||
      deposit.inputMint !== request.inputMint ||
      deposit.outputMint !== request.outputMint ||
      deposit.amount !== request.inputAmount ||
      deposit.orderSubType !== request.orderType ||
      deposit.expiresAt <= Date.now()
    ) {
      await deleteTriggerDeposit(bindings, request.depositRequestId);
      throw new AppError({
        status: 409,
        code: 'QUOTE_EXPIRED',
        message: 'The trigger deposit draft expired. Please prepare and sign a fresh deposit.',
        retryable: true,
      });
    }

    const signedMessage = readBoundTransactionMessage({
      transactionBase64: request.depositSignedTransaction,
      requiredSignerAddress: request.walletAddress,
      requireSignerSignature: true,
      label: 'Trigger deposit',
    });
    if (signedMessage !== deposit.transactionMessageBase64) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed trigger deposit does not match the prepared transaction.',
      });
    }

    const result = await withTriggerAuthRetry<TriggerOrderResponse>(
      bindings,
      request.walletAddress,
      request.network,
      async (jwtToken) => {
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
            message:
              extractProviderMessage(payload) ?? 'Trigger order creation is currently unavailable.',
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
      },
    );
    await deleteTriggerDeposit(bindings, request.depositRequestId);
    return result;
  } finally {
    await releaseRedisLock({
      bindings,
      key: lockKey,
      token: acquiredLockToken,
      unavailableMessage: 'Trigger deposit state storage is unavailable.',
    });
  }
}

async function prepareTriggerOrderCancellation(
  bindings: Bindings,
  request: TriggerCancelPrepareRequest,
): Promise<TriggerCancelPrepareResponse> {
  assertTriggerLifecycleVerifiable();
  assertTriggerMainnet(request.network);
  assertTriggerOrderId(request.orderId, 'Trigger order ID');

  return withTriggerAuthRetry(
    bindings,
    request.walletAddress,
    request.network,
    async (jwtToken) => {
      const { response, payload } = await fetchTriggerJson(
        bindings,
        `/orders/price/cancel/${encodeURIComponent(request.orderId)}`,
        { method: 'POST' },
        'Trigger order cancellation is currently unavailable.',
        jwtToken,
      );
      if (!response.ok || !isRecord(payload)) {
        throw new AppError({
          status:
            response.status === 400 ||
            response.status === 401 ||
            response.status === 403 ||
            response.status === 404
              ? response.status
              : 503,
          code:
            response.status === 401
              ? 'TRIGGER_AUTH_REQUIRED'
              : response.status === 404
                ? 'NOT_FOUND'
                : response.status === 400 || response.status === 403
                  ? 'INVALID_REQUEST'
                  : 'UPSTREAM_UNAVAILABLE',
          message:
            extractProviderMessage(payload) ??
            'Trigger order cancellation is currently unavailable.',
          retryable: response.status >= 500 || response.status === 401,
        });
      }
      const orderId = readTrimmedString(payload.id);
      const unsignedTransaction = readTrimmedString(payload.transaction);
      const cancelRequestId = readTrimmedString(payload.requestId);
      if (orderId !== request.orderId || !unsignedTransaction || !cancelRequestId) {
        throw new AppError({
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Trigger cancellation response could not be bound to the requested order.',
          retryable: true,
        });
      }
      assertTriggerOrderId(cancelRequestId, 'Trigger cancel request ID');
      await storeTriggerCancelIntent(bindings, cancelRequestId, {
        walletAddress: request.walletAddress,
        network: request.network,
        orderId: request.orderId,
        transactionMessageBase64: readBoundTransactionMessage({
          transactionBase64: unsignedTransaction,
          requiredSignerAddress: request.walletAddress,
          requireSignerSignature: false,
          label: 'Trigger cancellation withdrawal',
        }),
        status: 'pending',
        signature: null,
        expiresAt: Date.now() + TRIGGER_CANCEL_TTL_MS,
      });
      return { orderId, cancelRequestId, unsignedTransaction };
    },
  );
}

async function confirmTriggerOrderCancellation(
  bindings: Bindings,
  request: TriggerCancelConfirmRequest,
): Promise<TriggerCancelConfirmResponse> {
  assertTriggerMainnet(request.network);
  assertTriggerOrderId(request.orderId, 'Trigger order ID');
  assertTriggerOrderId(request.cancelRequestId, 'Trigger cancel request ID');
  assertBase64Transaction(
    request.signedTransaction,
    'Signed trigger cancellation transaction must be base64-encoded.',
  );

  const lockKey = buildTriggerCancelLockKey(request.cancelRequestId);
  const lockToken = await acquireRedisLock({
    bindings,
    key: lockKey,
    ttlSeconds: TRIGGER_CANCEL_LOCK_TTL_SECONDS,
    unavailableMessage: 'Trigger cancellation state storage is unavailable.',
  });
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This trigger cancellation is already being submitted.',
      retryable: true,
      retryAfterMs: 1000,
    });
  }

  try {
    const intent = await getTriggerCancelIntent(bindings, request.cancelRequestId);
    if (
      intent == null ||
      intent.walletAddress !== request.walletAddress ||
      intent.network !== request.network ||
      intent.orderId !== request.orderId
    ) {
      throw new AppError({
        status: 409,
        code: 'QUOTE_EXPIRED',
        message: 'The trigger cancellation intent is missing or no longer matches this order.',
        retryable: true,
      });
    }
    const signedMessage = readBoundTransactionMessage({
      transactionBase64: request.signedTransaction,
      requiredSignerAddress: request.walletAddress,
      requireSignerSignature: true,
      label: 'Trigger cancellation withdrawal',
    });
    if (signedMessage !== intent.transactionMessageBase64) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed trigger cancellation does not match the prepared withdrawal.',
      });
    }
    if (intent.status === 'completed' && intent.signature) {
      return { orderId: request.orderId, status: 'cancelled', signature: intent.signature };
    }
    if (intent.expiresAt <= Date.now()) {
      await deleteTriggerCancelIntent(bindings, request.cancelRequestId);
      throw new AppError({
        status: 410,
        code: 'QUOTE_EXPIRED',
        message: 'The trigger cancellation transaction expired. Prepare a fresh cancellation.',
        retryable: true,
      });
    }

    const result = await withTriggerAuthRetry<TriggerCancelConfirmResponse>(
      bindings,
      request.walletAddress,
      request.network,
      async (jwtToken) => {
        const { response, payload } = await fetchTriggerJson(
          bindings,
          `/orders/price/confirm-cancel/${encodeURIComponent(request.orderId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              signedTransaction: request.signedTransaction,
              cancelRequestId: request.cancelRequestId,
            }),
          },
          'Trigger cancellation confirmation is currently unavailable.',
          jwtToken,
        );
        if (!response.ok || !isRecord(payload)) {
          throw new AppError({
            status:
              response.status === 400 || response.status === 401 || response.status === 403
                ? response.status
                : 503,
            code:
              response.status === 401
                ? 'TRIGGER_AUTH_REQUIRED'
                : response.status === 400 || response.status === 403
                  ? 'INVALID_REQUEST'
                  : 'UPSTREAM_UNAVAILABLE',
            message:
              extractProviderMessage(payload) ??
              'Trigger cancellation confirmation is currently unavailable.',
            retryable: response.status >= 500 || response.status === 401,
          });
        }
        const orderId = readTrimmedString(payload.id);
        const signature = readTrimmedString(payload.txSignature);
        if (orderId !== request.orderId || !signature) {
          throw new AppError({
            status: 503,
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Trigger cancellation confirmation could not be verified.',
            retryable: true,
          });
        }
        return { orderId, status: 'cancelled', signature };
      },
    );
    await storeTriggerCancelIntent(bindings, request.cancelRequestId, {
      ...intent,
      status: 'completed',
      signature: result.signature,
      expiresAt: Date.now() + TRIGGER_CANCEL_RESULT_TTL_MS,
    });
    return result;
  } finally {
    await releaseRedisLock({
      bindings,
      key: lockKey,
      token: lockToken,
      unavailableMessage: 'Trigger cancellation state storage is unavailable.',
    });
  }
}

export {
  confirmTriggerOrderCancellation,
  createTriggerOrder,
  getOrRegisterTriggerVault,
  listTriggerOrders,
  prepareTriggerOrderCancellation,
  prepareTriggerOrderDeposit,
  requestTriggerChallenge,
  verifyTriggerChallenge,
  type TriggerAuthenticationRequest,
  type TriggerAuthenticationResponse,
  type TriggerChallengeRequest,
  type TriggerChallengeResponse,
  type TriggerChallengeType,
  type TriggerCondition,
  type TriggerCancelConfirmRequest,
  type TriggerCancelConfirmResponse,
  type TriggerCancelPrepareRequest,
  type TriggerCancelPrepareResponse,
  type TriggerDepositPreparationRequest,
  type TriggerDepositPreparationResponse,
  type TriggerOrderRequest,
  type TriggerOrderResponse,
  type TriggerOrderListRequest,
  type TriggerOrderListResponse,
  type TriggerOrderState,
  type TriggerOrderSummary,
  type TriggerOrderType,
  type TriggerVaultResponse,
};
