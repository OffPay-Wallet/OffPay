import { createNetworkCacheKey, memoryCache } from './cache.js';
import { AppError } from './errors.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
} from './provider-utils.js';
import {
  broadcastRawTransaction,
  getRpcAccounts,
  getRpcSignatureStatuses,
} from './helius.js';
import {
  TOKEN_PROGRAM_ID,
  verifyJupiterTransaction,
} from './jupiter-transaction-verifier.js';
import { acquireRedisLock, releaseRedisLock } from './redis-lock.js';
import { readBoundTransactionDetails } from './solana-transaction-binding.js';
import {
  isRecord,
  isValidEd25519Signature,
  isValidSolanaAddress,
} from './validation.js';
import type { Bindings, Network } from './types.js';

const DEFAULT_JUPITER_API_BASE_URL = 'https://api.jup.ag';
const SWAP_TOKENS_CACHE_TTL_MS = 5 * 60 * 1000;
const SWAP_PRICE_CACHE_TTL_MS = 10 * 1000;
const DEFAULT_QUOTE_TTL_MS = 45 * 1000;
const QUOTE_RESULT_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_SWAP_SLIPPAGE_BPS = 50;
const QUOTE_STATE_KEY_PREFIX = 'swap-quote:v2';
const QUOTE_EXECUTE_LOCK_KEY_PREFIX = 'swap-quote-execute-lock:v1';
const QUOTE_EXECUTE_LOCK_TTL_SEC = 120;
const RECURRING_STATE_KEY_PREFIX = 'swap-recurring:v1';
const RECURRING_EXECUTE_LOCK_KEY_PREFIX = 'swap-recurring-execute-lock:v1';
const RECURRING_IDEMPOTENCY_KEY_PREFIX = 'swap-recurring-idempotency:v1';
const RECURRING_DRAFT_TTL_MS = 60_000;
const RECURRING_RESULT_TTL_MS = 24 * 60 * 60_000;
const QUOTE_EXECUTE_EXPIRED_CODES = new Set([-1004, -2003]);
const QUOTE_EXECUTE_INVALID_CODES = new Set([-2, -3, -1002, -1003]);
const MAINNET_ONLY_JUPITER_ROUTES = new Set(['quote', 'execute', 'recurring']);
const MISSING_CACHED_ORDER_EXECUTE_CODES = new Set([-1]);
const MAX_RECURRING_INTERVAL_SEC = 365 * 24 * 60 * 60;
const MAX_RECURRING_ORDER_COUNT = 10_000;
const MAX_RECURRING_TOTAL_DURATION_SEC = 365 * 24 * 60 * 60;
const RECURRING_PRESET_INTERVALS = new Map<string, number>([
  ['hourly', 60 * 60],
  ['daily', 24 * 60 * 60],
  ['weekly', 7 * 24 * 60 * 60],
  ['monthly', 30 * 24 * 60 * 60],
]);

interface SwapToken {
  mint: string;
  name: string;
  symbol: string;
  logo: string | null;
  decimals: number;
  verified: boolean;
}

interface SwapTokensResponse {
  tokens: SwapToken[];
}

interface SwapPriceResponse {
  mint: string;
  price: number;
  currency: 'USD';
  fetchedAt: number;
}

interface SwapQuoteRequest {
  takerAddress: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  useManualSlippage?: boolean;
  network: Network;
  receiverAddress?: string;
  context?: SwapQuoteContext;
}

interface SwapQuoteContext {
  purpose: 'rwa';
  assetMint: string;
  issuerAssetId: string;
  scaledUiMultiplier: string;
  eligibilityPolicyVersion: string;
  side: 'buy' | 'sell';
}

interface SwapQuoteResponse {
  quoteId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minimumOutputAmount: string;
  slippageBps: number | null;
  slippageMode: 'auto' | 'manual';
  priceImpactPct: number;
  fee: string;
  routeSummary: string;
  expiresAt: number;
  unsignedTransaction: string;
}

interface SwapExecuteRequest {
  takerAddress: string;
  quoteId: string;
  signedTransaction: string;
  network: Network;
  contextPurpose?: 'rwa';
}

interface SwapExecuteResponse {
  signature: string;
}

interface SwapExecuteDetailedResponse extends SwapExecuteResponse {
  code: number;
  inputAmountResult: string | null;
  outputAmountResult: string | null;
  totalInputAmount: string | null;
  totalOutputAmount: string | null;
}

interface SwapRecurringCreateRequest {
  walletAddress: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  frequency: string;
  idempotencyKey: string;
  network: Network;
}

interface SwapRecurringCreateResponse {
  recurringId: string;
  status: 'requires_signature';
  unsignedTransaction: string;
}

interface SwapRecurringExecuteRequest {
  recurringId: string;
  signedTransaction: string;
  walletAddress: string;
  network: Network;
}

interface SwapRecurringExecuteResponse {
  recurringId: string;
  status: 'Success' | 'Failed';
  signature: string;
  orderId: string | null;
  operation: 'create' | 'cancel';
}

interface RecurringOrderSummary {
  orderId: string;
  inputMint: string;
  outputMint: string;
  rawInDeposited: string;
  rawInWithdrawn: string;
  rawInUsed: string;
  rawOutReceived: string;
  rawOutWithdrawn: string;
  rawInAmountPerCycle: string;
  cycleFrequency: string;
  userClosed: boolean;
  openSignature: string | null;
  closeSignature: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface RecurringOrderListRequest {
  walletAddress: string;
  network: Network;
  status: 'active' | 'history';
  page?: number;
  mint?: string;
  includeFailedTransactions?: boolean;
}

interface RecurringOrderListResponse {
  walletAddress: string;
  status: 'active' | 'history';
  orders: RecurringOrderSummary[];
  page: number;
  totalPages: number;
}

interface RecurringCancelPrepareRequest {
  walletAddress: string;
  network: Network;
  orderId: string;
  inputMint: string;
  outputMint: string;
}

interface RecurringCancelPrepareResponse {
  recurringId: string;
  orderId: string;
  status: 'requires_signature';
  unsignedTransaction: string;
}

interface StoredSwapQuoteState {
  requestId: string;
  provider: 'ultra' | 'metis';
  takerAddress: string;
  network: Network;
  expiresAt: number;
  lastValidBlockHeight: string | null;
  transactionMessageBase64: string;
  context: SwapQuoteContext | null;
  status: 'prepared' | 'submitting' | 'completed';
  expectedSignature: string | null;
  result: SwapExecuteDetailedResponse | null;
}

interface StoredRecurringOrderState {
  walletAddress: string;
  network: Network;
  transactionMessageBase64: string;
  unsignedTransaction: string;
  providerRequestId: string;
  operation: 'create' | 'cancel';
  orderId: string;
  status: 'pending' | 'submitting' | 'completed';
  expectedSignature: string | null;
  signature: string | null;
  completedOrderId: string | null;
  expiresAt: number;
}

interface StoredRecurringIdempotencyState {
  intentFingerprint: string;
  recurringId: string;
  expiresAt: number;
}

interface JupiterHttpResult {
  response: Response;
  payload: unknown;
}

interface ParsedRecurringFrequency {
  interval: number;
  numberOfOrders: number;
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value) && value !== '0';
}

function readSwapQuoteContext(value: unknown): SwapQuoteContext | null {
  if (!isRecord(value) || value.purpose !== 'rwa') return null;
  const assetMint = readTrimmedString(value.assetMint);
  const issuerAssetId = readTrimmedString(value.issuerAssetId);
  const scaledUiMultiplier = readTrimmedString(value.scaledUiMultiplier);
  const eligibilityPolicyVersion = readTrimmedString(value.eligibilityPolicyVersion);
  const side = readTrimmedString(value.side);
  if (
    !assetMint ||
    !isValidSolanaAddress(assetMint) ||
    !issuerAssetId ||
    !scaledUiMultiplier ||
    !eligibilityPolicyVersion ||
    !/^\d+(?:\.\d+)?$/.test(scaledUiMultiplier) ||
    (side !== 'buy' && side !== 'sell')
  ) {
    return null;
  }
  return {
    purpose: 'rwa',
    assetMint,
    issuerAssetId,
    scaledUiMultiplier,
    eligibilityPolicyVersion,
    side,
  };
}

function isBase64String(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length > 0;
}

function assertSolanaAddress(value: string, message: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertPositiveIntegerAmount(value: string, message: string): void {
  if (!isPositiveIntegerString(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertBase64Transaction(value: string, message: string): void {
  if (!isBase64String(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function assertJupiterWriteNetwork(network: Network, route: string): void {
  if (network === 'mainnet') {
    return;
  }

  if (!MAINNET_ONLY_JUPITER_ROUTES.has(route)) {
    return;
  }

  throw new AppError({
    status: 400,
    code: 'INVALID_NETWORK',
    message: 'This Jupiter route is currently available only on mainnet.',
  });
}

function buildJupiterHeaders(bindings: Bindings, extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders);
  headers.set('x-api-key', getRequiredBinding(bindings, 'JUPITER_API_KEY'));
  return headers;
}

async function fetchJupiterJson(
  bindings: Bindings,
  url: string,
  init: RequestInit,
  errorMessage: string,
): Promise<JupiterHttpResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: buildJupiterHeaders(bindings, init.headers),
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

function readJupiterApiBaseUrl(bindings: Bindings): string {
  const configuredUrl = bindings.JUPITER_API_BASE_URL?.trim() || DEFAULT_JUPITER_API_BASE_URL;

  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol !== 'https:') throw new Error('Jupiter API must use HTTPS.');
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Jupiter API configuration is unavailable.',
      retryable: true,
      cause: error,
    });
  }
}

function buildQuoteStateKey(network: Network, walletAddress: string, quoteId: string): string {
  return `${QUOTE_STATE_KEY_PREFIX}:${network}:${walletAddress}:${quoteId}`;
}

function buildSwapTokenRegistryKey(network: Network): string {
  return `swap-tokens:${network}:verified`;
}

function isSwapToken(value: unknown): value is SwapToken {
  return (
    isRecord(value) &&
    typeof value.mint === 'string' &&
    typeof value.name === 'string' &&
    typeof value.symbol === 'string' &&
    (typeof value.logo === 'string' || value.logo === null) &&
    typeof value.decimals === 'number' &&
    Number.isInteger(value.decimals) &&
    value.verified === true
  );
}

function isSwapTokensResponse(value: unknown): value is SwapTokensResponse {
  return isRecord(value) && Array.isArray(value.tokens) && value.tokens.every(isSwapToken);
}

async function readHotSwapTokens(
  bindings: Bindings,
  network: Network,
): Promise<SwapTokensResponse | null> {
  const cache = bindings.TOKEN_REGISTRY_CACHE;
  if (cache == null) return null;

  const cached = await cache.get<unknown>(buildSwapTokenRegistryKey(network), 'json');
  return isSwapTokensResponse(cached) ? cached : null;
}

async function writeHotSwapTokens(
  bindings: Bindings,
  network: Network,
  payload: SwapTokensResponse,
): Promise<void> {
  const cache = bindings.TOKEN_REGISTRY_CACHE;
  if (cache == null) return;

  await cache.put(buildSwapTokenRegistryKey(network), JSON.stringify(payload), {
    expirationTtl: 24 * 60 * 60,
  });
}

function buildQuoteExecuteLockKey(
  network: Network,
  walletAddress: string,
  quoteId: string,
): string {
  return `${QUOTE_EXECUTE_LOCK_KEY_PREFIX}:${network}:${walletAddress}:${quoteId}`;
}

function buildRecurringStateKey(
  network: Network,
  walletAddress: string,
  recurringId: string,
): string {
  return `${RECURRING_STATE_KEY_PREFIX}:${network}:${walletAddress}:${recurringId}`;
}

function buildRecurringExecuteLockKey(
  network: Network,
  walletAddress: string,
  recurringId: string,
): string {
  return `${RECURRING_EXECUTE_LOCK_KEY_PREFIX}:${network}:${walletAddress}:${recurringId}`;
}

function buildRecurringIdempotencyKey(
  network: Network,
  walletAddress: string,
  idempotencyKey: string,
): string {
  return `${RECURRING_IDEMPOTENCY_KEY_PREFIX}:${network}:${walletAddress}:${idempotencyKey}`;
}

async function storeRecurringOrderState(
  bindings: Bindings,
  recurringId: string,
  state: StoredRecurringOrderState,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((state.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [[
      'SET',
      buildRecurringStateKey(state.network, state.walletAddress, recurringId),
      JSON.stringify(state),
      'EX',
      ttlSeconds,
    ]],
    'Recurring order state storage is unavailable.',
  );
}

async function getRecurringOrderState(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  recurringId: string,
): Promise<StoredRecurringOrderState | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildRecurringStateKey(network, walletAddress, recurringId)]],
    'Recurring order state storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isRecord(parsed)) return null;
    const walletAddress = readTrimmedString(parsed.walletAddress);
    const network = readTrimmedString(parsed.network);
    const transactionMessageBase64 = readTrimmedString(parsed.transactionMessageBase64);
    const unsignedTransaction = readTrimmedString(parsed.unsignedTransaction);
    const providerRequestId = readTrimmedString(parsed.providerRequestId);
    const operation = readTrimmedString(parsed.operation);
    const orderId = readTrimmedString(parsed.orderId);
    const status = readTrimmedString(parsed.status);
    const expectedSignature = readTrimmedString(parsed.expectedSignature);
    const signature = readTrimmedString(parsed.signature);
    const completedOrderId = readTrimmedString(parsed.completedOrderId);
    const expiresAt = readFiniteNumber(parsed.expiresAt);
    if (
      !walletAddress ||
      !isValidSolanaAddress(walletAddress) ||
      (network !== 'mainnet' && network !== 'devnet') ||
      !transactionMessageBase64 ||
      !unsignedTransaction ||
      !providerRequestId ||
      (operation !== 'create' && operation !== 'cancel') ||
      !orderId ||
      !isValidSolanaAddress(orderId) ||
      (status !== 'pending' && status !== 'submitting' && status !== 'completed') ||
      (status === 'submitting' && (!expectedSignature || !isValidEd25519Signature(expectedSignature))) ||
      (status === 'completed' &&
        (!signature ||
          !isValidEd25519Signature(signature) ||
          !completedOrderId ||
          !isValidSolanaAddress(completedOrderId))) ||
      expiresAt == null
    ) {
      return null;
    }
    return {
      walletAddress,
      network,
      transactionMessageBase64,
      unsignedTransaction,
      providerRequestId,
      operation,
      orderId,
      status,
      expectedSignature,
      signature,
      completedOrderId,
      expiresAt,
    };
  } catch {
    return null;
  }
}

async function deleteRecurringOrderState(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  recurringId: string,
): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildRecurringStateKey(network, walletAddress, recurringId)]],
    'Recurring order state storage is unavailable.',
  );
}

async function storeRecurringIdempotencyState(
  bindings: Bindings,
  params: {
    network: Network;
    walletAddress: string;
    idempotencyKey: string;
    state: StoredRecurringIdempotencyState;
  },
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((params.state.expiresAt - Date.now()) / 1000));
  await runKvPipeline(
    bindings,
    [[
      'SET',
      buildRecurringIdempotencyKey(
        params.network,
        params.walletAddress,
        params.idempotencyKey,
      ),
      JSON.stringify(params.state),
      'EX',
      ttlSeconds,
    ]],
    'Recurring order idempotency storage is unavailable.',
  );
}

async function getRecurringIdempotencyState(
  bindings: Bindings,
  params: { network: Network; walletAddress: string; idempotencyKey: string },
): Promise<StoredRecurringIdempotencyState | null> {
  const [result] = await runKvPipeline(
    bindings,
    [[
      'GET',
      buildRecurringIdempotencyKey(
        params.network,
        params.walletAddress,
        params.idempotencyKey,
      ),
    ]],
    'Recurring order idempotency storage is unavailable.',
  );
  if (typeof result !== 'string' || result.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isRecord(parsed)) return null;
    const intentFingerprint = readTrimmedString(parsed.intentFingerprint);
    const recurringId = readTrimmedString(parsed.recurringId);
    const expiresAt = readFiniteNumber(parsed.expiresAt);
    if (!intentFingerprint || !recurringId || expiresAt == null) return null;
    return { intentFingerprint, recurringId, expiresAt };
  } catch {
    return null;
  }
}

async function deleteRecurringIdempotencyState(
  bindings: Bindings,
  params: { network: Network; walletAddress: string; idempotencyKey: string },
): Promise<void> {
  await runKvPipeline(
    bindings,
    [[
      'DEL',
      buildRecurringIdempotencyKey(
        params.network,
        params.walletAddress,
        params.idempotencyKey,
      ),
    ]],
    'Recurring order idempotency storage is unavailable.',
  );
}

async function storeQuoteState(
  bindings: Bindings,
  quoteId: string,
  quoteState: StoredSwapQuoteState,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((quoteState.expiresAt - Date.now()) / 1000));

  await runKvPipeline(
    bindings,
    [[
      'SET',
      buildQuoteStateKey(quoteState.network, quoteState.takerAddress, quoteId),
      JSON.stringify(quoteState),
      'EX',
      ttlSeconds,
    ]],
    'Quote state storage is unavailable.',
  );
}

async function getQuoteState(
  bindings: Bindings,
  network: Network,
  takerAddress: string,
  quoteId: string,
): Promise<StoredSwapQuoteState | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildQuoteStateKey(network, takerAddress, quoteId)]],
    'Quote state storage is unavailable.',
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

  const requestId = readTrimmedString(parsed.requestId);
  const parsedProvider = readTrimmedString(parsed.provider);
  const storedTakerAddress =
    readTrimmedString(parsed.takerAddress) ?? readTrimmedString(parsed.walletAddress);
  const storedNetwork = readTrimmedString(parsed.network);
  const expiresAt = readFiniteNumber(parsed.expiresAt);
  const lastValidBlockHeight = readTrimmedString(parsed.lastValidBlockHeight);
  const transactionMessageBase64 = readTrimmedString(parsed.transactionMessageBase64);
  const context = readSwapQuoteContext(parsed.context);
  const parsedStatus = readTrimmedString(parsed.status);
  const status =
    parsedStatus == null
      ? 'prepared'
      : parsedStatus === 'prepared' || parsedStatus === 'submitting' || parsedStatus === 'completed'
        ? parsedStatus
        : null;
  const expectedSignature = readTrimmedString(parsed.expectedSignature);
  const rawResult = isRecord(parsed.result) ? parsed.result : null;
  const resultSignature = readTrimmedString(rawResult?.signature);
  const resultCode = readFiniteNumber(rawResult?.code);
  const readResultAmount = (value: unknown): string | null | undefined => {
    if (value == null) return null;
    const amount = readTrimmedString(value);
    return amount != null && /^\d+$/.test(amount) ? amount : undefined;
  };
  const inputAmountResult = readResultAmount(rawResult?.inputAmountResult);
  const outputAmountResult = readResultAmount(rawResult?.outputAmountResult);
  const totalInputAmount = readResultAmount(rawResult?.totalInputAmount);
  const totalOutputAmount = readResultAmount(rawResult?.totalOutputAmount);
  const storedResult =
    rawResult != null &&
    resultSignature != null &&
    isValidEd25519Signature(resultSignature) &&
    resultCode != null &&
    Number.isInteger(resultCode) &&
    inputAmountResult !== undefined &&
    outputAmountResult !== undefined &&
    totalInputAmount !== undefined &&
    totalOutputAmount !== undefined
      ? {
          signature: resultSignature,
          code: resultCode,
          inputAmountResult,
          outputAmountResult,
          totalInputAmount,
          totalOutputAmount,
        }
      : null;

  if (
    !requestId ||
    !storedTakerAddress ||
    (storedNetwork !== 'devnet' && storedNetwork !== 'mainnet') ||
    expiresAt === null ||
    !transactionMessageBase64 ||
    status == null ||
    ((status === 'submitting' || status === 'completed') &&
      (!expectedSignature || !isValidEd25519Signature(expectedSignature))) ||
    (status === 'completed' && storedResult == null) ||
    (parsed.context != null && context == null)
  ) {
    return null;
  }

  return {
    requestId,
    provider: parsedProvider === 'metis' ? 'metis' : 'ultra',
    takerAddress: storedTakerAddress,
    network: storedNetwork,
    expiresAt,
    lastValidBlockHeight,
    transactionMessageBase64,
    context,
    status,
    expectedSignature,
    result: storedResult,
  };
}

async function getSwapQuoteContext(
  bindings: Bindings,
  request: { quoteId: string; takerAddress: string; network: Network },
): Promise<SwapQuoteContext | null> {
  const quoteState = await getQuoteState(
    bindings,
    request.network,
    request.takerAddress,
    request.quoteId,
  );
  if (
    quoteState == null ||
    quoteState.takerAddress !== request.takerAddress ||
    quoteState.network !== request.network ||
    (quoteState.status === 'prepared' && quoteState.expiresAt <= Date.now())
  ) {
    return null;
  }
  return quoteState.context;
}

async function deleteQuoteState(
  bindings: Bindings,
  network: Network,
  takerAddress: string,
  quoteId: string,
): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildQuoteStateKey(network, takerAddress, quoteId)]],
    'Quote state storage is unavailable.',
  );
}

async function acquireQuoteExecuteLock(
  bindings: Bindings,
  network: Network,
  takerAddress: string,
  quoteId: string,
): Promise<string | null> {
  return acquireNamedLock(bindings, buildQuoteExecuteLockKey(network, takerAddress, quoteId));
}

async function acquireNamedLock(bindings: Bindings, lockKey: string): Promise<string | null> {
  return acquireRedisLock({
    bindings,
    key: lockKey,
    ttlSeconds: QUOTE_EXECUTE_LOCK_TTL_SEC,
    unavailableMessage: 'Quote state storage is unavailable.',
  });
}

async function releaseQuoteExecuteLock(
  bindings: Bindings,
  network: Network,
  takerAddress: string,
  quoteId: string,
  lockToken: string,
): Promise<void> {
  await releaseNamedLock(
    bindings,
    buildQuoteExecuteLockKey(network, takerAddress, quoteId),
    lockToken,
  );
}

async function releaseNamedLock(
  bindings: Bindings,
  lockKey: string,
  lockToken: string,
): Promise<void> {
  await releaseRedisLock({
    bindings,
    key: lockKey,
    token: lockToken,
    unavailableMessage: 'Quote state storage is unavailable.',
  });
}

function parseProviderDateToMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildRouteSummary(routePlan: unknown, fallbackRouter: string | null): string {
  if (!Array.isArray(routePlan)) {
    return fallbackRouter ? `Jupiter ${fallbackRouter} route` : 'Jupiter route';
  }

  const labels = routePlan.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.swapInfo)) {
      return [];
    }

    const label = sanitizeText(readTrimmedString(entry.swapInfo.label), 48);
    return label ? [label] : [];
  });

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) {
    return fallbackRouter ? `Jupiter ${fallbackRouter} route` : 'Jupiter route';
  }

  return uniqueLabels.join(' -> ').slice(0, 160);
}

function extractProviderMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return sanitizeText(payload, 240);
  }

  if (!isRecord(payload)) {
    return null;
  }

  const nestedError = isRecord(payload.error)
    ? (readTrimmedString(payload.error.message) ??
      readTrimmedString(payload.error.error) ??
      readTrimmedString(payload.error.status))
    : null;

  return sanitizeText(
    nestedError ??
      readTrimmedString(payload.errorMessage) ??
      readTrimmedString(payload.error) ??
      readTrimmedString(payload.message) ??
      readTrimmedString(payload.status),
    240,
  );
}

function isGaslessMinimumMessage(message: string | null): boolean {
  return message != null && /minimum.*\$?\s*\d+.*gasless|gasless.*minimum/i.test(message);
}

function toQuoteExpiredError(): AppError {
  return new AppError({
    status: 410,
    code: 'QUOTE_EXPIRED',
    message: 'The swap price has refreshed. Please review the new quote.',
    retryable: true,
  });
}

function parseRecurringFrequency(frequency: string): ParsedRecurringFrequency {
  const normalized = frequency.trim().toLowerCase();
  const validateRecurringRange = (
    interval: number,
    numberOfOrders: number,
  ): ParsedRecurringFrequency => {
    if (!Number.isSafeInteger(interval) || interval <= 0 || interval > MAX_RECURRING_INTERVAL_SEC) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: `Recurring interval must be between 1 and ${MAX_RECURRING_INTERVAL_SEC} seconds.`,
      });
    }

    if (
      !Number.isSafeInteger(numberOfOrders) ||
      numberOfOrders < 2 ||
      numberOfOrders > MAX_RECURRING_ORDER_COUNT
    ) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: `Recurring numberOfOrders must be between 2 and ${MAX_RECURRING_ORDER_COUNT}.`,
      });
    }

    if (interval * numberOfOrders > MAX_RECURRING_TOTAL_DURATION_SEC) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Recurring schedules cannot span more than 365 days in total duration.',
      });
    }

    return { interval, numberOfOrders };
  };

  const presetMatch = /^(hourly|daily|weekly|monthly):(\d+)$/.exec(normalized);
  if (presetMatch) {
    const preset = presetMatch[1];
    const orderCountValue = presetMatch[2];
    if (!preset || !orderCountValue) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message:
          'Frequency must be one of hourly:<count>, daily:<count>, weekly:<count>, monthly:<count>, or interval:<seconds>:<count>.',
      });
    }

    const interval = RECURRING_PRESET_INTERVALS.get(preset);
    const numberOfOrders = Number(orderCountValue);

    if (interval && Number.isInteger(numberOfOrders) && numberOfOrders >= 2) {
      return validateRecurringRange(interval, numberOfOrders);
    }
  }

  const intervalMatch = /^interval:(\d+):(\d+)$/.exec(normalized);
  if (intervalMatch) {
    const [, intervalValue, orderCountValue] = intervalMatch;
    const interval = Number(intervalValue);
    const numberOfOrders = Number(orderCountValue);

    if (
      Number.isInteger(interval) &&
      interval > 0 &&
      Number.isInteger(numberOfOrders) &&
      numberOfOrders >= 2
    ) {
      return validateRecurringRange(interval, numberOfOrders);
    }
  }

  throw new AppError({
    status: 400,
    code: 'INVALID_REQUEST',
    message:
      'Frequency must be one of hourly:<count>, daily:<count>, weekly:<count>, monthly:<count>, or interval:<seconds>:<count>.',
  });
}

async function getSwapTokens(bindings: Bindings, network: Network): Promise<SwapTokensResponse> {
  const cacheKey = createNetworkCacheKey(network, 'swap-tokens', ['verified']);

  return memoryCache.getOrSet(cacheKey, SWAP_TOKENS_CACHE_TTL_MS, async () => {
    const hotRegistry = await readHotSwapTokens(bindings, network).catch(() => null);
    if (hotRegistry != null) return hotRegistry;

    const { response, payload } = await fetchJupiterJson(
      bindings,
      `${readJupiterApiBaseUrl(bindings)}/tokens/v2/tag?query=verified`,
      { method: 'GET' },
      'Token metadata is currently unavailable.',
    );

    if (!response.ok || !Array.isArray(payload)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Token metadata is currently unavailable.',
        retryable: true,
      });
    }

    const tokens = payload
      .flatMap((entry) => {
        if (!isRecord(entry)) {
          return [];
        }

        const mint = readTrimmedString(entry.id);
        const name = sanitizeText(readTrimmedString(entry.name), 80);
        const symbol = sanitizeText(readTrimmedString(entry.symbol), 24);
        const logo = readTrimmedString(entry.icon);
        const decimals = readFiniteNumber(entry.decimals);
        const verified = entry.isVerified === true;

        if (
          !mint ||
          !name ||
          !symbol ||
          decimals === null ||
          !Number.isInteger(decimals) ||
          !verified
        ) {
          return [];
        }

        return [
          {
            mint,
            name,
            symbol,
            logo,
            decimals,
            verified: true,
          } satisfies SwapToken,
        ];
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    const result = { tokens };
    await writeHotSwapTokens(bindings, network, result).catch(() => undefined);
    return result;
  });
}

async function getSwapPrice(
  bindings: Bindings,
  request: { mint: string; network: Network },
): Promise<SwapPriceResponse> {
  assertSolanaAddress(request.mint, 'Mint address is invalid.');

  const cacheKey = createNetworkCacheKey(request.network, 'swap-price', [request.mint]);

  return memoryCache.getOrSet(cacheKey, SWAP_PRICE_CACHE_TTL_MS, async () => {
    const { response, payload } = await fetchJupiterJson(
      bindings,
      `${readJupiterApiBaseUrl(bindings)}/price/v3?ids=${encodeURIComponent(request.mint)}`,
      { method: 'GET' },
      'Token price is currently unavailable.',
    );

    if (!response.ok || !isRecord(payload)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Token price is currently unavailable.',
        retryable: true,
      });
    }

    const entry = payload[request.mint];
    if (!isRecord(entry)) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Price is unavailable for the requested token.',
      });
    }

    const price = readFiniteNumber(entry.usdPrice);
    if (price === null) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Price is unavailable for the requested token.',
      });
    }

    return {
      mint: request.mint,
      price,
      currency: 'USD',
      fetchedAt: Date.now(),
    };
  });
}

async function createMetisSwapQuote(
  bindings: Bindings,
  request: SwapQuoteRequest,
): Promise<SwapQuoteResponse> {
  const slippageBps = request.slippageBps ?? DEFAULT_SWAP_SLIPPAGE_BPS;
  const quoteParams = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: String(slippageBps),
    swapMode: 'ExactIn',
    instructionVersion: 'V2',
  });

  const { response: quoteResponse, payload: quotePayload } = await fetchJupiterJson(
    bindings,
    `${readJupiterApiBaseUrl(bindings)}/swap/v1/quote?${quoteParams.toString()}`,
    { method: 'GET' },
    'Swap quotes are currently unavailable.',
  );

  if (!isRecord(quotePayload) || !quoteResponse.ok) {
    throw new AppError({
      status: quoteResponse.ok ? 503 : 400,
      code: quoteResponse.ok ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
      message: extractProviderMessage(quotePayload) ?? 'Swap quote request was rejected.',
      retryable: quoteResponse.ok,
    });
  }

  const { response: swapResponse, payload: swapPayload } = await fetchJupiterJson(
    bindings,
    `${readJupiterApiBaseUrl(bindings)}/swap/v1/swap`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quoteResponse: quotePayload,
        userPublicKey: request.takerAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    },
    'Unable to build a swap transaction at the moment.',
  );

  if (!isRecord(swapPayload) || !swapResponse.ok) {
    throw new AppError({
      status: swapResponse.ok ? 503 : 400,
      code: swapResponse.ok ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
      message:
        extractProviderMessage(swapPayload) ?? 'Unable to build a swap transaction at the moment.',
      retryable: swapResponse.ok,
    });
  }

  const unsignedTransaction = readTrimmedString(swapPayload.swapTransaction);
  const inAmount = readTrimmedString(quotePayload.inAmount);
  const outAmount = readTrimmedString(quotePayload.outAmount);
  if (!unsignedTransaction || !inAmount || !outAmount) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Unable to build a swap transaction at the moment.',
      retryable: true,
    });
  }

  const quoteId = crypto.randomUUID();
  const lastValidBlockHeightNumber = readFiniteNumber(swapPayload.lastValidBlockHeight);
  const lastValidBlockHeight =
    lastValidBlockHeightNumber === null ? null : String(Math.trunc(lastValidBlockHeightNumber));
  const expiresAt = Date.now() + DEFAULT_QUOTE_TTL_MS;
  const dynamicSlippageReport = isRecord(swapPayload.dynamicSlippageReport)
    ? swapPayload.dynamicSlippageReport
    : null;
  const responseSlippageBps =
    readFiniteNumber(dynamicSlippageReport?.slippageBps) ??
    readFiniteNumber(quotePayload.slippageBps) ??
    slippageBps;
  const minimumOutputAmount = readTrimmedString(quotePayload.otherAmountThreshold);
  const platformFeeBps =
    readFiniteNumber(isRecord(quotePayload.platformFee) ? quotePayload.platformFee.feeBps : null) ??
    0;
  if (
    !minimumOutputAmount ||
    !/^\d+$/.test(minimumOutputAmount) ||
    !Number.isInteger(responseSlippageBps) ||
    responseSlippageBps < 0 ||
    responseSlippageBps > 10_000 ||
    !Number.isInteger(platformFeeBps) ||
    platformFeeBps < 0 ||
    platformFeeBps > 10_000
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Swap quote safety terms are unavailable.',
      retryable: true,
    });
  }
  const priceImpactPct = readFiniteNumber(quotePayload.priceImpactPct) ?? 0;
  const fee =
    readTrimmedString(
      isRecord(quotePayload.platformFee) ? quotePayload.platformFee.amount : null,
    ) ?? '0';

  const verifiedTransaction = await verifyJupiterTransaction({
    bindings,
    network: request.network,
    transactionBase64: unsignedTransaction,
    intent: {
      kind: 'swap',
      walletAddress: request.takerAddress,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inputAmount: inAmount,
      outputAmount: outAmount,
      minimumOutputAmount,
      slippageBps: responseSlippageBps,
      platformFeeBps,
      providerRequestId: quoteId,
    },
  });

  await storeQuoteState(bindings, quoteId, {
    requestId: quoteId,
    provider: 'metis',
    takerAddress: request.takerAddress,
    network: request.network,
    expiresAt,
    lastValidBlockHeight,
    transactionMessageBase64: verifiedTransaction.transactionMessageBase64,
    context: request.context ?? null,
    status: 'prepared',
    expectedSignature: null,
    result: null,
  });

  return {
    quoteId,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount,
    outAmount,
    minimumOutputAmount,
    slippageBps: responseSlippageBps,
    slippageMode: 'manual',
    priceImpactPct,
    fee,
    routeSummary: buildRouteSummary(quotePayload.routePlan, 'metis'),
    expiresAt,
    unsignedTransaction,
  };
}

async function createSwapQuote(
  bindings: Bindings,
  request: SwapQuoteRequest,
): Promise<SwapQuoteResponse> {
  assertJupiterWriteNetwork(request.network, 'quote');
  assertSolanaAddress(request.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(request.outputMint, 'Output mint address is invalid.');
  assertPositiveIntegerAmount(request.amount, 'Swap amount must be a positive integer string.');
  if (
    request.useManualSlippage === true &&
    (request.slippageBps == null ||
      !Number.isInteger(request.slippageBps) ||
      request.slippageBps < 0 ||
      request.slippageBps > 10_000)
  ) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Manual slippage requires an integer between 0 and 10000 basis points.',
    });
  }

  if (request.receiverAddress) {
    assertSolanaAddress(request.receiverAddress, 'Receiver wallet address is invalid.');
    if (request.receiverAddress === request.takerAddress) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Receiver wallet must differ from the taker wallet when provided.',
      });
    }
  }

  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    taker: request.takerAddress,
    swapMode: 'ExactIn',
    // Only the Jupiter V6/Metis transaction format has a fully decoded,
    // fail-closed semantic verifier. RFQ/DFlow/OKX transactions use unrelated
    // programs and must never reach a wallet under a generic allowlist.
    excludeRouters: 'jupiterz,dflow,okx',
  });

  if (request.useManualSlippage === true && request.slippageBps !== undefined) {
    params.set('slippageBps', String(request.slippageBps));
  }

  if (request.receiverAddress) {
    params.set('receiver', request.receiverAddress);
  }

  const { response, payload } = await fetchJupiterJson(
    bindings,
    `${readJupiterApiBaseUrl(bindings)}/swap/v2/order?${params.toString()}`,
    { method: 'GET' },
    'Swap quotes are currently unavailable.',
  );

  if (!isRecord(payload)) {
    throw new AppError({
      status: response.ok ? 503 : 400,
      code: response.ok ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
      message: response.ok
        ? 'Swap quotes are currently unavailable.'
        : 'Swap quote request was rejected.',
      retryable: response.ok,
    });
  }

  if (!response.ok) {
    const providerMessage = extractProviderMessage(payload);
    if (!request.receiverAddress && isGaslessMinimumMessage(providerMessage)) {
      return createMetisSwapQuote(bindings, request);
    }

    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: providerMessage ?? 'Swap quote request was rejected.',
    });
  }

  const requestId = readTrimmedString(payload.requestId);
  const unsignedTransaction = readTrimmedString(payload.transaction);
  const inAmount = readTrimmedString(payload.inAmount);
  const outAmount = readTrimmedString(payload.outAmount);
  const providerMessage = extractProviderMessage(payload);
  const quoteId = crypto.randomUUID();
  const expiresAt =
    parseProviderDateToMs(readTrimmedString(payload.expireAt)) ?? Date.now() + DEFAULT_QUOTE_TTL_MS;
  const lastValidBlockHeight = readTrimmedString(payload.lastValidBlockHeight);

  if (!requestId || !inAmount || !outAmount || !unsignedTransaction) {
    if (expiresAt <= Date.now()) {
      throw toQuoteExpiredError();
    }

    if (!request.receiverAddress && isGaslessMinimumMessage(providerMessage)) {
      return createMetisSwapQuote(bindings, request);
    }

    if (providerMessage) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: providerMessage,
      });
    }

    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Unable to build a swap transaction at the moment.',
      retryable: true,
    });
  }

  if (expiresAt <= Date.now()) {
    throw toQuoteExpiredError();
  }

  const router = readTrimmedString(payload.router)?.toLowerCase();
  const signatureFeePayer = readTrimmedString(payload.signatureFeePayer);
  if (
    router !== 'metis' ||
    payload.gasless === true ||
    (signatureFeePayer != null && signatureFeePayer !== request.takerAddress)
  ) {
    if (!request.receiverAddress) return createMetisSwapQuote(bindings, request);
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'A wallet-paid Metis route is unavailable for this receiver swap.',
      retryable: true,
    });
  }

  const priceImpactPct =
    readFiniteNumber(payload.priceImpactPct) ?? readFiniteNumber(payload.priceImpact) ?? 0;
  const slippageBps = readFiniteNumber(payload.slippageBps);
  const providerMode = readTrimmedString(payload.mode)?.toLowerCase();
  const slippageMode = providerMode === 'manual' ? 'manual' : 'auto';

  const fee =
    readTrimmedString(isRecord(payload.platformFee) ? payload.platformFee.amount : null) ?? '0';
  const minimumOutputAmount = readTrimmedString(payload.otherAmountThreshold);
  const platformFeeBps =
    readFiniteNumber(payload.feeBps) ??
    readFiniteNumber(isRecord(payload.platformFee) ? payload.platformFee.feeBps : null) ??
    0;
  if (
    !minimumOutputAmount ||
    !/^\d+$/.test(minimumOutputAmount) ||
    slippageBps == null ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000 ||
    !Number.isInteger(platformFeeBps) ||
    platformFeeBps < 0 ||
    platformFeeBps > 10_000
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Swap quote safety terms are unavailable.',
      retryable: true,
    });
  }

  let verifiedTransaction: Awaited<ReturnType<typeof verifyJupiterTransaction>>;
  try {
    verifiedTransaction = await verifyJupiterTransaction({
      bindings,
      network: request.network,
      transactionBase64: unsignedTransaction,
      intent: {
        kind: 'swap',
        walletAddress: request.takerAddress,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inputAmount: inAmount,
        outputAmount: outAmount,
        minimumOutputAmount,
        slippageBps,
        platformFeeBps,
        receiverAddress: request.receiverAddress,
        providerRequestId: requestId,
      },
    });
  } catch (error) {
    if (!request.receiverAddress) return createMetisSwapQuote(bindings, request);
    throw error;
  }

  await storeQuoteState(bindings, quoteId, {
    requestId,
    provider: 'ultra',
    takerAddress: request.takerAddress,
    network: request.network,
    expiresAt,
    lastValidBlockHeight,
    transactionMessageBase64: verifiedTransaction.transactionMessageBase64,
    context: request.context ?? null,
    status: 'prepared',
    expectedSignature: null,
    result: null,
  });

  return {
    quoteId,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount,
    outAmount,
    minimumOutputAmount,
    slippageBps,
    slippageMode,
    priceImpactPct,
    fee,
    routeSummary: buildRouteSummary(payload.routePlan, readTrimmedString(payload.router)),
    expiresAt,
    unsignedTransaction,
  };
}

async function executeSwapQuoteDetailed(
  bindings: Bindings,
  request: SwapExecuteRequest,
): Promise<SwapExecuteDetailedResponse> {
  assertJupiterWriteNetwork(request.network, 'execute');
  assertBase64Transaction(
    request.signedTransaction,
    'Signed transaction must be a base64-encoded string.',
  );

  const lockToken = await acquireQuoteExecuteLock(
    bindings,
    request.network,
    request.takerAddress,
    request.quoteId,
  );
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message:
        'This swap quote is already being executed. Please wait for the current attempt to finish.',
      retryable: true,
      retryAfterMs: 1000,
    });
  }

  try {
    const quoteState = await getQuoteState(
      bindings,
      request.network,
      request.takerAddress,
      request.quoteId,
    );
    if (!quoteState) throw toQuoteExpiredError();
    if (
      (quoteState.context?.purpose === 'rwa' && request.contextPurpose !== 'rwa') ||
      (quoteState.context == null && request.contextPurpose === 'rwa')
    ) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'This quote must be executed through the route that created it.',
      });
    }

    const signedTransaction = readBoundTransactionDetails({
      transactionBase64: request.signedTransaction,
      requiredSignerAddress: request.takerAddress,
      requiredFeePayerAddress: request.takerAddress,
      requireSignerSignature: true,
      label: 'Swap',
    });
    if (signedTransaction.transactionMessageBase64 !== quoteState.transactionMessageBase64) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed swap transaction does not match the quoted transaction.',
      });
    }
    const expectedSignature = signedTransaction.transactionSignature;
    if (!expectedSignature || !isValidEd25519Signature(expectedSignature)) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed swap transaction has an invalid transaction signature.',
      });
    }
    if (quoteState.expectedSignature && quoteState.expectedSignature !== expectedSignature) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed swap transaction does not match the in-progress submission.',
      });
    }
    if (quoteState.status === 'completed' && quoteState.result) return quoteState.result;
    if (quoteState.status === 'prepared' && quoteState.expiresAt <= Date.now()) {
      await deleteQuoteState(
        bindings,
        request.network,
        request.takerAddress,
        request.quoteId,
      );
      throw toQuoteExpiredError();
    }

    if (quoteState.status === 'submitting') {
      const status = (
        await getRpcSignatureStatuses(bindings, {
          network: request.network,
          signatures: [expectedSignature],
        })
      ).statuses[0];
      if (status?.err != null) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'The submitted swap transaction failed on-chain.',
        });
      }
      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        const reconciled: SwapExecuteDetailedResponse = {
          signature: expectedSignature,
          code: 0,
          inputAmountResult: null,
          outputAmountResult: null,
          totalInputAmount: null,
          totalOutputAmount: null,
        };
        await storeQuoteState(bindings, request.quoteId, {
          ...quoteState,
          status: 'completed',
          expectedSignature,
          result: reconciled,
          expiresAt: Date.now() + QUOTE_RESULT_TTL_MS,
        }).catch(() => undefined);
        return reconciled;
      }
    }

    const submittingState: StoredSwapQuoteState = {
      ...quoteState,
      status: 'submitting',
      expectedSignature,
      result: null,
      expiresAt: Date.now() + QUOTE_RESULT_TTL_MS,
    };
    await storeQuoteState(bindings, request.quoteId, submittingState);

    if (quoteState.provider === 'metis') {
      const { signature } = await broadcastRawTransaction(bindings, {
        rawTransaction: request.signedTransaction,
        network: request.network,
      });
      if (signature !== expectedSignature) {
        throw new AppError({
          status: 503,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'The transaction broadcaster returned an unexpected signature.',
          retryable: true,
        });
      }
      const result: SwapExecuteDetailedResponse = {
        signature,
        code: 0,
        inputAmountResult: null,
        outputAmountResult: null,
        totalInputAmount: null,
        totalOutputAmount: null,
      };
      await storeQuoteState(bindings, request.quoteId, {
        ...submittingState,
        status: 'completed',
        result,
        expiresAt: Date.now() + QUOTE_RESULT_TTL_MS,
      }).catch(() => undefined);
      return result;
    }

    const body = {
      signedTransaction: request.signedTransaction,
      requestId: quoteState.requestId,
      ...(quoteState.lastValidBlockHeight
        ? { lastValidBlockHeight: quoteState.lastValidBlockHeight }
        : {}),
    };

    const { response, payload } = await fetchJupiterJson(
      bindings,
      `${readJupiterApiBaseUrl(bindings)}/swap/v2/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      'Swap execution is currently unavailable.',
    );

    if (!response.ok || !isRecord(payload)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Swap execution is currently unavailable.',
        retryable: true,
      });
    }

    const code = readFiniteNumber(payload.code);
    const status = readTrimmedString(payload.status);
    const signature = readTrimmedString(payload.signature);
    const errorMessage = extractProviderMessage(payload);

    if (code != null && QUOTE_EXECUTE_EXPIRED_CODES.has(code)) {
      await deleteQuoteState(
        bindings,
        request.network,
        request.takerAddress,
        request.quoteId,
      );
      throw toQuoteExpiredError();
    }

    if (code != null && MISSING_CACHED_ORDER_EXECUTE_CODES.has(code)) {
      await deleteQuoteState(
        bindings,
        request.network,
        request.takerAddress,
        request.quoteId,
      );
      throw new AppError({
        status: 409,
        code: 'INVALID_REQUEST',
        message:
          'The swap order is no longer available. Please request a fresh quote and sign again.',
        retryable: true,
      });
    }

    if (status === 'Success' && code === 0 && signature === expectedSignature) {
      const readExecutionAmount = (value: unknown): string | null => {
        if (value == null) return null;
        const amount = readTrimmedString(value);
        if (amount == null || !/^\d+$/.test(amount)) {
          throw new AppError({
            status: 503,
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Swap execution returned malformed settlement amounts.',
            retryable: true,
          });
        }
        return amount;
      };
      const result: SwapExecuteDetailedResponse = {
        signature,
        code,
        inputAmountResult: readExecutionAmount(payload.inputAmountResult),
        outputAmountResult: readExecutionAmount(payload.outputAmountResult),
        totalInputAmount: readExecutionAmount(payload.totalInputAmount),
        totalOutputAmount: readExecutionAmount(payload.totalOutputAmount),
      };
      await storeQuoteState(bindings, request.quoteId, {
        ...submittingState,
        status: 'completed',
        result,
        expiresAt: Date.now() + QUOTE_RESULT_TTL_MS,
      }).catch(() => undefined);
      return result;
    }

    if (status === 'Success' || signature != null) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Swap execution response could not be bound to the signed transaction.',
        retryable: true,
      });
    }

    if ((code != null && QUOTE_EXECUTE_INVALID_CODES.has(code)) || status === 'Failed') {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: errorMessage ?? 'The signed swap transaction was rejected.',
      });
    }

    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Swap execution is currently unavailable.',
      retryable: true,
    });
  } finally {
    await releaseQuoteExecuteLock(
      bindings,
      request.network,
      request.takerAddress,
      request.quoteId,
      lockToken,
    ).catch(() => undefined);
  }
}

async function executeSwapQuote(
  bindings: Bindings,
  request: SwapExecuteRequest,
): Promise<SwapExecuteDetailedResponse> {
  return executeSwapQuoteDetailed(bindings, request);
}

function readRequiredRawAmount(value: unknown, label: string): string {
  const amount = readTrimmedString(value);
  if (amount == null || !/^\d+$/.test(amount)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: `Recurring order ${label} is invalid.`,
      retryable: true,
    });
  }
  return amount;
}

function parseRecurringOrderSummary(value: unknown, walletAddress: string): RecurringOrderSummary {
  if (!isRecord(value)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Recurring order history returned an invalid order.',
      retryable: true,
    });
  }
  const userPubkey = readTrimmedString(value.userPubkey);
  const orderId = readTrimmedString(value.orderKey);
  const inputMint = readTrimmedString(value.inputMint);
  const outputMint = readTrimmedString(value.outputMint);
  const cycleFrequencyValue =
    readTrimmedString(value.cycleFrequency) ??
    (readFiniteNumber(value.cycleFrequency) != null
      ? String(readFiniteNumber(value.cycleFrequency))
      : null);
  if (
    userPubkey !== walletAddress ||
    !orderId ||
    !isValidSolanaAddress(orderId) ||
    !inputMint ||
    !isValidSolanaAddress(inputMint) ||
    !outputMint ||
    !isValidSolanaAddress(outputMint) ||
    !cycleFrequencyValue ||
    (value.userClosed !== true && value.userClosed !== false)
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Recurring order history could not be verified for this wallet.',
      retryable: true,
    });
  }
  return {
    orderId,
    inputMint,
    outputMint,
    rawInDeposited: readRequiredRawAmount(value.rawInDeposited, 'deposit amount'),
    rawInWithdrawn: readRequiredRawAmount(value.rawInWithdrawn, 'withdrawn input amount'),
    rawInUsed: readRequiredRawAmount(value.rawInUsed, 'used input amount'),
    rawOutReceived: readRequiredRawAmount(value.rawOutReceived, 'received output amount'),
    rawOutWithdrawn: readRequiredRawAmount(value.rawOutWithdrawn, 'withdrawn output amount'),
    rawInAmountPerCycle: readRequiredRawAmount(value.rawInAmountPerCycle, 'cycle amount'),
    cycleFrequency: cycleFrequencyValue,
    userClosed: value.userClosed,
    openSignature: readTrimmedString(value.openTx),
    closeSignature: readTrimmedString(value.closeTx),
    createdAt: readTrimmedString(value.createdAt),
    updatedAt: readTrimmedString(value.updatedAt),
  };
}

async function listRecurringOrders(
  bindings: Bindings,
  request: RecurringOrderListRequest,
): Promise<RecurringOrderListResponse> {
  assertJupiterWriteNetwork(request.network, 'recurring');
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  if (request.mint) assertSolanaAddress(request.mint, 'Recurring order mint is invalid.');
  const page = request.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new AppError({ status: 400, code: 'INVALID_REQUEST', message: 'Page is invalid.' });
  }
  const params = new URLSearchParams({
    recurringType: 'time',
    orderStatus: request.status,
    user: request.walletAddress,
    page: String(page),
    includeFailedTx: request.includeFailedTransactions === true ? 'true' : 'false',
  });
  if (request.mint) params.set('mint', request.mint);
  const { response, payload } = await fetchJupiterJson(
    bindings,
    `${readJupiterApiBaseUrl(bindings)}/recurring/v1/getRecurringOrders?${params.toString()}`,
    { method: 'GET' },
    'Recurring order history is currently unavailable.',
  );
  if (!response.ok || !isRecord(payload) || !Array.isArray(payload.time)) {
    throw new AppError({
      status: response.status === 400 ? 400 : 503,
      code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'Recurring order history is currently unavailable.',
      retryable: response.status !== 400,
    });
  }
  const responseWallet = readTrimmedString(payload.user);
  const responseStatus = readTrimmedString(payload.orderStatus);
  const responsePage = readFiniteNumber(payload.page);
  const totalPages = readFiniteNumber(payload.totalPages);
  if (
    responseWallet !== request.walletAddress ||
    responseStatus !== request.status ||
    responsePage == null ||
    totalPages == null ||
    !Number.isInteger(responsePage) ||
    !Number.isInteger(totalPages) ||
    responsePage !== page ||
    totalPages < 1
  ) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Recurring order history pagination could not be verified.',
      retryable: true,
    });
  }
  return {
    walletAddress: request.walletAddress,
    status: request.status,
    orders: payload.time.map((order) => parseRecurringOrderSummary(order, request.walletAddress)),
    page: responsePage,
    totalPages,
  };
}

async function assertClassicRecurringMints(
  bindings: Bindings,
  request: { network: Network; inputMint: string; outputMint: string },
): Promise<void> {
  if (request.inputMint === request.outputMint) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Recurring input and output mints must differ.',
    });
  }

  const mintAddresses = [request.inputMint, request.outputMint];
  const { accounts } = await getRpcAccounts(bindings, {
    addresses: mintAddresses,
    network: request.network,
  });
  const accountsByAddress = new Map(accounts.map((account) => [account.address, account]));
  const unsupported = mintAddresses.some((address) => {
    const account = accountsByAddress.get(address);
    return (
      account?.exists !== true ||
      account.executable !== false ||
      account.owner !== TOKEN_PROGRAM_ID
    );
  });
  if (unsupported) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Jupiter Recurring supports only classic SPL token mints.',
    });
  }
}

function readRecurringIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(normalized)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Recurring idempotency key is invalid.',
    });
  }
  return normalized;
}

function buildRecurringIntentFingerprint(request: {
  inputMint: string;
  outputMint: string;
  amount: string;
  interval: number;
  numberOfOrders: number;
}): string {
  return JSON.stringify([
    request.inputMint,
    request.outputMint,
    request.amount,
    request.interval,
    request.numberOfOrders,
  ]);
}

function toRecurringStateUnavailableError(): AppError {
  return new AppError({
    status: 409,
    code: 'INVALID_REQUEST',
    message:
      'A previous recurring-order attempt could not be reconciled. Start a new intent before signing.',
    retryable: false,
  });
}

async function prepareRecurringOrderCancellation(
  bindings: Bindings,
  request: RecurringCancelPrepareRequest,
): Promise<RecurringCancelPrepareResponse> {
  assertJupiterWriteNetwork(request.network, 'recurring');
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  assertSolanaAddress(request.orderId, 'Recurring order ID is invalid.');
  assertSolanaAddress(request.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(request.outputMint, 'Output mint address is invalid.');
  await assertClassicRecurringMints(bindings, request);

  const { response, payload } = await fetchJupiterJson(
    bindings,
    `${readJupiterApiBaseUrl(bindings)}/recurring/v1/cancelOrder`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order: request.orderId,
        user: request.walletAddress,
        recurringType: 'time',
      }),
    },
    'Recurring order cancellation is currently unavailable.',
  );
  if (!response.ok || !isRecord(payload)) {
    throw new AppError({
      status: response.status === 400 ? 400 : 503,
      code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
      message:
        extractProviderMessage(payload) ?? 'Recurring order cancellation is currently unavailable.',
      retryable: response.status !== 400,
    });
  }
  const providerRequestId = readTrimmedString(payload.requestId);
  const unsignedTransaction = readTrimmedString(payload.transaction);
  if (!providerRequestId || providerRequestId.length > 128 || !unsignedTransaction) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Recurring cancellation response is incomplete.',
      retryable: true,
    });
  }
  const verifiedTransaction = await verifyJupiterTransaction({
    bindings,
    network: request.network,
    transactionBase64: unsignedTransaction,
    intent: {
      kind: 'recurringCancel',
      walletAddress: request.walletAddress,
      orderAddress: request.orderId,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      providerRequestId,
    },
  });
  if (verifiedTransaction.recurringOrderAddress !== request.orderId) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Recurring cancellation transaction returned an unexpected order account.',
      retryable: true,
    });
  }

  const recurringId = crypto.randomUUID();
  await storeRecurringOrderState(bindings, recurringId, {
    walletAddress: request.walletAddress,
    network: request.network,
    transactionMessageBase64: verifiedTransaction.transactionMessageBase64,
    unsignedTransaction,
    providerRequestId,
    operation: 'cancel',
    orderId: request.orderId,
    status: 'pending',
    expectedSignature: null,
    signature: null,
    completedOrderId: null,
    expiresAt: Date.now() + RECURRING_DRAFT_TTL_MS,
  });
  return {
    recurringId,
    orderId: request.orderId,
    status: 'requires_signature',
    unsignedTransaction,
  };
}

async function createRecurringOrder(
  bindings: Bindings,
  request: SwapRecurringCreateRequest,
): Promise<SwapRecurringCreateResponse> {
  assertJupiterWriteNetwork(request.network, 'recurring');
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  assertSolanaAddress(request.inputMint, 'Input mint address is invalid.');
  assertSolanaAddress(request.outputMint, 'Output mint address is invalid.');
  assertPositiveIntegerAmount(
    request.amount,
    'Recurring amount must be a positive integer string.',
  );
  const recurringInAmount = Number(request.amount);
  if (!Number.isSafeInteger(recurringInAmount) || recurringInAmount <= 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Recurring amount must be a positive integer string.',
    });
  }

  const recurringFrequency = parseRecurringFrequency(request.frequency);
  const idempotencyKey = readRecurringIdempotencyKey(request.idempotencyKey);
  const intentFingerprint = buildRecurringIntentFingerprint({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    interval: recurringFrequency.interval,
    numberOfOrders: recurringFrequency.numberOfOrders,
  });
  await assertClassicRecurringMints(bindings, request);

  const idempotencyRedisKey = buildRecurringIdempotencyKey(
    request.network,
    request.walletAddress,
    idempotencyKey,
  );
  const lockToken = await acquireNamedLock(bindings, `${idempotencyRedisKey}:lock`);
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This recurring order is already being prepared.',
      retryable: true,
      retryAfterMs: 1000,
    });
  }

  let ownsIdempotencyReservation = false;
  try {
    const existingIdempotency = await getRecurringIdempotencyState(bindings, {
      network: request.network,
      walletAddress: request.walletAddress,
      idempotencyKey,
    });
    if (existingIdempotency && existingIdempotency.expiresAt > Date.now()) {
      if (existingIdempotency.intentFingerprint !== intentFingerprint) {
        throw new AppError({
          status: 409,
          code: 'INVALID_REQUEST',
          message: 'This recurring idempotency key is already bound to a different intent.',
        });
      }
      const existingState = await getRecurringOrderState(
        bindings,
        request.network,
        request.walletAddress,
        existingIdempotency.recurringId,
      );
      if (!existingState || existingState.operation !== 'create') {
        throw toRecurringStateUnavailableError();
      }
      return {
        recurringId: existingIdempotency.recurringId,
        status: 'requires_signature',
        unsignedTransaction: existingState.unsignedTransaction,
      };
    }

    const recurringId = crypto.randomUUID();
    const idempotencyExpiresAt = Date.now() + RECURRING_RESULT_TTL_MS;
    await storeRecurringIdempotencyState(bindings, {
      network: request.network,
      walletAddress: request.walletAddress,
      idempotencyKey,
      state: { intentFingerprint, recurringId, expiresAt: idempotencyExpiresAt },
    });
    ownsIdempotencyReservation = true;

    const providerBody = {
      user: request.walletAddress,
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      params: {
        time: {
          inAmount: recurringInAmount,
          numberOfOrders: recurringFrequency.numberOfOrders,
          interval: recurringFrequency.interval,
          minPrice: null,
          maxPrice: null,
          startAt: null,
        },
      },
    };

    const { response, payload } = await fetchJupiterJson(
      bindings,
      `${readJupiterApiBaseUrl(bindings)}/recurring/v1/createOrder`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerBody),
      },
      'Recurring order creation is currently unavailable.',
    );

    if (!isRecord(payload)) {
      throw new AppError({
        status: response.ok ? 503 : 400,
        code: response.ok ? 'UPSTREAM_UNAVAILABLE' : 'INVALID_REQUEST',
        message: response.ok
          ? 'Recurring order creation is currently unavailable.'
          : (extractProviderMessage(payload) ?? 'Recurring order request was rejected.'),
        retryable: response.ok,
      });
    }

    if (!response.ok) {
      throw new AppError({
        status: response.status === 400 ? 400 : 503,
        code: response.status === 400 ? 'INVALID_REQUEST' : 'UPSTREAM_UNAVAILABLE',
        message: extractProviderMessage(payload) ?? 'Recurring order request was rejected.',
        retryable: response.status !== 400,
      });
    }

    const providerRequestId = readTrimmedString(payload.requestId);
    const unsignedTransaction = readTrimmedString(payload.transaction);

    if (!providerRequestId || providerRequestId.length > 128 || !unsignedTransaction) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Unable to build a recurring transaction at the moment.',
        retryable: true,
      });
    }

    const verifiedTransaction = await verifyJupiterTransaction({
      bindings,
      network: request.network,
      transactionBase64: unsignedTransaction,
      intent: {
        kind: 'recurringCreate',
        walletAddress: request.walletAddress,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inputAmount: request.amount,
        numberOfOrders: recurringFrequency.numberOfOrders,
        intervalSeconds: recurringFrequency.interval,
        providerRequestId,
      },
    });
    const orderId = verifiedTransaction.recurringOrderAddress;
    if (!orderId || !isValidSolanaAddress(orderId)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Recurring creation transaction did not bind an order account.',
        retryable: true,
      });
    }

    await storeRecurringOrderState(bindings, recurringId, {
      walletAddress: request.walletAddress,
      network: request.network,
      transactionMessageBase64: verifiedTransaction.transactionMessageBase64,
      unsignedTransaction,
      providerRequestId,
      operation: 'create',
      orderId,
      status: 'pending',
      expectedSignature: null,
      signature: null,
      completedOrderId: null,
      expiresAt: Date.now() + RECURRING_DRAFT_TTL_MS,
    });

    return {
      recurringId,
      status: 'requires_signature',
      unsignedTransaction,
    };
  } catch (error) {
    if (ownsIdempotencyReservation) {
      await deleteRecurringIdempotencyState(bindings, {
        network: request.network,
        walletAddress: request.walletAddress,
        idempotencyKey,
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await releaseNamedLock(bindings, `${idempotencyRedisKey}:lock`, lockToken).catch(
      () => undefined,
    );
  }
}

async function executeRecurringOrder(
  bindings: Bindings,
  request: SwapRecurringExecuteRequest,
): Promise<SwapRecurringExecuteResponse> {
  assertJupiterWriteNetwork(request.network, 'recurring');
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  assertBase64Transaction(
    request.signedTransaction,
    'Signed transaction must be a base64-encoded string.',
  );

  const lockToken = await acquireNamedLock(
    bindings,
    buildRecurringExecuteLockKey(request.network, request.walletAddress, request.recurringId),
  );
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This recurring order is already being submitted.',
      retryable: true,
      retryAfterMs: 1000,
    });
  }

  try {
    const state = await getRecurringOrderState(
      bindings,
      request.network,
      request.walletAddress,
      request.recurringId,
    );
    if (state == null) throw toQuoteExpiredError();
    if (state.status === 'pending' && state.expiresAt <= Date.now()) {
      await deleteRecurringOrderState(
        bindings,
        request.network,
        request.walletAddress,
        request.recurringId,
      );
      throw toQuoteExpiredError();
    }

    const signedTransaction = readBoundTransactionDetails({
      transactionBase64: request.signedTransaction,
      requiredSignerAddress: request.walletAddress,
      requiredFeePayerAddress: request.walletAddress,
      requireSignerSignature: true,
      label: 'Recurring order',
    });
    if (signedTransaction.transactionMessageBase64 !== state.transactionMessageBase64) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed recurring transaction does not match the prepared order.',
      });
    }
    const expectedSignature = signedTransaction.transactionSignature;
    if (!expectedSignature || !isValidEd25519Signature(expectedSignature)) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed recurring transaction has an invalid transaction signature.',
      });
    }
    if (state.expectedSignature && state.expectedSignature !== expectedSignature) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'The signed recurring transaction does not match the in-progress submission.',
      });
    }
    if (state.status === 'completed' && state.signature && state.completedOrderId) {
      return {
        recurringId: request.recurringId,
        status: 'Success',
        signature: state.signature,
        orderId: state.completedOrderId,
        operation: state.operation,
      };
    }

    if (state.status === 'submitting') {
      const rpcStatus = (
        await getRpcSignatureStatuses(bindings, {
          network: request.network,
          signatures: [expectedSignature],
        })
      ).statuses[0];
      if (rpcStatus?.err != null) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'The submitted recurring transaction failed on-chain.',
        });
      }
      if (
        rpcStatus?.confirmationStatus === 'confirmed' ||
        rpcStatus?.confirmationStatus === 'finalized'
      ) {
        const reconciled: SwapRecurringExecuteResponse = {
          recurringId: request.recurringId,
          status: 'Success',
          signature: expectedSignature,
          orderId: state.orderId,
          operation: state.operation,
        };
        await storeRecurringOrderState(bindings, request.recurringId, {
          ...state,
          status: 'completed',
          expectedSignature,
          signature: expectedSignature,
          completedOrderId: state.orderId,
          expiresAt: Date.now() + RECURRING_RESULT_TTL_MS,
        }).catch(() => undefined);
        return reconciled;
      }
    }

    const submittingState: StoredRecurringOrderState = {
      ...state,
      status: 'submitting',
      expectedSignature,
      expiresAt: Date.now() + RECURRING_RESULT_TTL_MS,
    };
    await storeRecurringOrderState(bindings, request.recurringId, submittingState);

    const { response, payload } = await fetchJupiterJson(
      bindings,
      `${readJupiterApiBaseUrl(bindings)}/recurring/v1/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: state.providerRequestId,
          signedTransaction: request.signedTransaction,
        }),
      },
      'Recurring order execution is currently unavailable.',
    );

    if (!response.ok || !isRecord(payload)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Recurring order execution is currently unavailable.',
        retryable: true,
      });
    }

    const status = readTrimmedString(payload.status);
    const signature = readTrimmedString(payload.signature);
    const orderId = readTrimmedString(payload.order);

    if (
      status === 'Success' &&
      signature === expectedSignature &&
      orderId === state.orderId
    ) {
      const result: SwapRecurringExecuteResponse = {
        recurringId: request.recurringId,
        status: 'Success',
        signature,
        orderId,
        operation: state.operation,
      };
      await storeRecurringOrderState(bindings, request.recurringId, {
        ...submittingState,
        status: 'completed',
        expectedSignature,
        signature,
        completedOrderId: orderId,
        expiresAt: Date.now() + RECURRING_RESULT_TTL_MS,
      }).catch(() => undefined);
      return result;
    }

    if (status === 'Success' || signature != null || orderId != null) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Recurring execution response could not be bound to the signed transaction.',
        retryable: true,
      });
    }

    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: extractProviderMessage(payload) ?? 'Recurring transaction execution failed.',
    });
  } finally {
    await releaseNamedLock(
      bindings,
      buildRecurringExecuteLockKey(request.network, request.walletAddress, request.recurringId),
      lockToken,
    ).catch(() => undefined);
  }
}

export {
  SWAP_PRICE_CACHE_TTL_MS,
  SWAP_TOKENS_CACHE_TTL_MS,
  createRecurringOrder,
  createSwapQuote,
  executeRecurringOrder,
  executeSwapQuote,
  executeSwapQuoteDetailed,
  getSwapQuoteContext,
  getSwapPrice,
  getSwapTokens,
  listRecurringOrders,
  prepareRecurringOrderCancellation,
  type RecurringCancelPrepareRequest,
  type RecurringCancelPrepareResponse,
  type RecurringOrderListRequest,
  type RecurringOrderListResponse,
  type RecurringOrderSummary,
  type SwapExecuteDetailedResponse,
  type SwapExecuteRequest,
  type SwapExecuteResponse,
  type SwapPriceResponse,
  type SwapQuoteRequest,
  type SwapQuoteContext,
  type SwapQuoteResponse,
  type SwapRecurringCreateRequest,
  type SwapRecurringCreateResponse,
  type SwapRecurringExecuteRequest,
  type SwapRecurringExecuteResponse,
  type SwapToken,
  type SwapTokensResponse,
};
