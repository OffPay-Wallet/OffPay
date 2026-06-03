import { createNetworkCacheKey, memoryCache } from './cache.js';
import { AppError } from './errors.js';
import {
  getRequiredBinding,
  readFiniteNumber,
  readTrimmedString,
  runKvPipeline,
  sanitizeText,
} from './provider-utils.js';
import { broadcastRawTransaction } from './helius.js';
import { isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const DEFAULT_JUPITER_API_BASE_URL = 'https://api.jup.ag';
const SWAP_TOKENS_CACHE_TTL_MS = 5 * 60 * 1000;
const SWAP_PRICE_CACHE_TTL_MS = 10 * 1000;
const DEFAULT_QUOTE_TTL_MS = 45 * 1000;
const DEFAULT_SWAP_SLIPPAGE_BPS = 50;
const QUOTE_STATE_KEY_PREFIX = 'swap-quote:v1';
const QUOTE_EXECUTE_LOCK_KEY_PREFIX = 'swap-quote-execute-lock:v1';
const QUOTE_EXECUTE_LOCK_TTL_SEC = 120;
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
}

interface SwapQuoteResponse {
  quoteId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
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
  network: Network;
}

interface SwapRecurringExecuteResponse {
  recurringId: string;
  status: 'Success' | 'Failed';
  signature: string;
}

interface StoredSwapQuoteState {
  requestId: string;
  provider: 'ultra' | 'metis';
  takerAddress: string;
  network: Network;
  expiresAt: number;
  lastValidBlockHeight: string | null;
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
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported Jupiter API protocol.');
    }
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

function buildQuoteStateKey(quoteId: string): string {
  return `${QUOTE_STATE_KEY_PREFIX}:${quoteId}`;
}

function buildQuoteExecuteLockKey(quoteId: string): string {
  return `${QUOTE_EXECUTE_LOCK_KEY_PREFIX}:${quoteId}`;
}

async function storeQuoteState(
  bindings: Bindings,
  quoteId: string,
  quoteState: StoredSwapQuoteState,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((quoteState.expiresAt - Date.now()) / 1000));

  await runKvPipeline(bindings, [[
    'SET',
    buildQuoteStateKey(quoteId),
    JSON.stringify(quoteState),
    'EX',
    ttlSeconds,
  ]], 'Quote state storage is unavailable.');
}

async function getQuoteState(
  bindings: Bindings,
  quoteId: string,
): Promise<StoredSwapQuoteState | null> {
  const [result] = await runKvPipeline(
    bindings,
    [['GET', buildQuoteStateKey(quoteId)]],
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
  const takerAddress =
    readTrimmedString(parsed.takerAddress) ?? readTrimmedString(parsed.walletAddress);
  const network = readTrimmedString(parsed.network);
  const expiresAt = readFiniteNumber(parsed.expiresAt);
  const lastValidBlockHeight = readTrimmedString(parsed.lastValidBlockHeight);

  if (
    !requestId ||
    !takerAddress ||
    (network !== 'devnet' && network !== 'mainnet') ||
    expiresAt === null
  ) {
    return null;
  }

  return {
    requestId,
    provider: parsedProvider === 'metis' ? 'metis' : 'ultra',
    takerAddress,
    network,
    expiresAt,
    lastValidBlockHeight,
  };
}

async function deleteQuoteState(bindings: Bindings, quoteId: string): Promise<void> {
  await runKvPipeline(
    bindings,
    [['DEL', buildQuoteStateKey(quoteId)]],
    'Quote state storage is unavailable.',
  );
}

async function acquireQuoteExecuteLock(bindings: Bindings, quoteId: string): Promise<string | null> {
  const lockToken = crypto.randomUUID();
  const [result] = await runKvPipeline(
    bindings,
    [['SET', buildQuoteExecuteLockKey(quoteId), lockToken, 'NX', 'EX', QUOTE_EXECUTE_LOCK_TTL_SEC]],
    'Quote state storage is unavailable.',
  );

  return result === 'OK' ? lockToken : null;
}

async function releaseQuoteExecuteLock(
  bindings: Bindings,
  quoteId: string,
  lockToken: string,
): Promise<void> {
  const lockKey = buildQuoteExecuteLockKey(quoteId);
  const [currentValue] = await runKvPipeline(
    bindings,
    [['GET', lockKey]],
    'Quote state storage is unavailable.',
  );

  if (currentValue === lockToken) {
    await runKvPipeline(
      bindings,
      [['DEL', lockKey]],
      'Quote state storage is unavailable.',
    );
  }
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
    ? readTrimmedString(payload.error.message) ??
      readTrimmedString(payload.error.error) ??
      readTrimmedString(payload.error.status)
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
  const validateRecurringRange = (interval: number, numberOfOrders: number): ParsedRecurringFrequency => {
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
        message:
          'Recurring schedules cannot span more than 365 days in total duration.',
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

async function getSwapTokens(
  bindings: Bindings,
  network: Network,
): Promise<SwapTokensResponse> {
  const cacheKey = createNetworkCacheKey(network, 'swap-tokens', ['verified']);

  return memoryCache.getOrSet(cacheKey, SWAP_TOKENS_CACHE_TTL_MS, async () => {
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

        return [{
          mint,
          name,
          symbol,
          logo,
          decimals,
          verified: true,
        } satisfies SwapToken];
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    return { tokens };
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
  const priceImpactPct = readFiniteNumber(quotePayload.priceImpactPct) ?? 0;
  const fee =
    readTrimmedString(isRecord(quotePayload.platformFee) ? quotePayload.platformFee.amount : null) ??
    '0';

  await storeQuoteState(bindings, quoteId, {
    requestId: quoteId,
    provider: 'metis',
    takerAddress: request.takerAddress,
    network: request.network,
    expiresAt,
    lastValidBlockHeight,
  });

  return {
    quoteId,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount,
    outAmount,
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
  const quoteId = readTrimmedString(payload.quoteId) ?? crypto.randomUUID();
  const expiresAt =
    parseProviderDateToMs(readTrimmedString(payload.expireAt)) ??
    Date.now() + DEFAULT_QUOTE_TTL_MS;
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

  const priceImpactPct =
    readFiniteNumber(payload.priceImpactPct) ??
    readFiniteNumber(payload.priceImpact) ??
    0;
  const slippageBps = readFiniteNumber(payload.slippageBps);
  const providerMode = readTrimmedString(payload.mode)?.toLowerCase();
  const slippageMode = providerMode === 'manual' ? 'manual' : 'auto';

  const fee =
    readTrimmedString(isRecord(payload.platformFee) ? payload.platformFee.amount : null) ?? '0';

  await storeQuoteState(bindings, quoteId, {
    requestId,
    provider: 'ultra',
    takerAddress: request.takerAddress,
    network: request.network,
    expiresAt,
    lastValidBlockHeight,
  });

  return {
    quoteId,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount,
    outAmount,
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

  const lockToken = await acquireQuoteExecuteLock(bindings, request.quoteId);
  if (!lockToken) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'This swap quote is already being executed. Please wait for the current attempt to finish.',
      retryable: true,
      retryAfterMs: 1000,
    });
  }

  try {
    const quoteState = await getQuoteState(bindings, request.quoteId);
    if (
      !quoteState ||
      quoteState.takerAddress !== request.takerAddress ||
      quoteState.network !== request.network ||
      quoteState.expiresAt <= Date.now()
    ) {
      if (quoteState) {
        await deleteQuoteState(bindings, request.quoteId);
      }

      throw toQuoteExpiredError();
    }

    if (quoteState.provider === 'metis') {
      const { signature } = await broadcastRawTransaction(bindings, {
        rawTransaction: request.signedTransaction,
        network: request.network,
      });
      await deleteQuoteState(bindings, request.quoteId);

      return {
        signature,
        code: 0,
        inputAmountResult: null,
        outputAmountResult: null,
        totalInputAmount: null,
        totalOutputAmount: null,
      };
    }

    const body = {
      signedTransaction: request.signedTransaction,
      requestId: quoteState.requestId,
      ...(quoteState.lastValidBlockHeight
        ? { lastValidBlockHeight: quoteState.lastValidBlockHeight }
        : {}),
    };

    const { payload } = await fetchJupiterJson(
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

    if (!isRecord(payload)) {
      throw new AppError({
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Swap execution is currently unavailable.',
        retryable: true,
      });
    }

    const code = readFiniteNumber(payload.code) ?? 0;
    const status = readTrimmedString(payload.status);
    const signature = readTrimmedString(payload.signature);
    const errorMessage = extractProviderMessage(payload);

    if (QUOTE_EXECUTE_EXPIRED_CODES.has(code)) {
      await deleteQuoteState(bindings, request.quoteId);
      throw toQuoteExpiredError();
    }

    if (MISSING_CACHED_ORDER_EXECUTE_CODES.has(code)) {
      await deleteQuoteState(bindings, request.quoteId);
      throw new AppError({
        status: 409,
        code: 'INVALID_REQUEST',
        message: 'The swap order is no longer available. Please request a fresh quote and sign again.',
        retryable: true,
      });
    }

    if (status === 'Success' && signature) {
      await deleteQuoteState(bindings, request.quoteId);
      return {
        signature,
        code,
        inputAmountResult: readTrimmedString(payload.inputAmountResult),
        outputAmountResult: readTrimmedString(payload.outputAmountResult),
        totalInputAmount: readTrimmedString(payload.totalInputAmount),
        totalOutputAmount: readTrimmedString(payload.totalOutputAmount),
      };
    }

    if (QUOTE_EXECUTE_INVALID_CODES.has(code) || status === 'Failed') {
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
    await releaseQuoteExecuteLock(bindings, request.quoteId, lockToken);
  }
}

async function executeSwapQuote(
  bindings: Bindings,
  request: SwapExecuteRequest,
): Promise<SwapExecuteResponse> {
  const result = await executeSwapQuoteDetailed(bindings, request);
  return { signature: result.signature };
}

async function createRecurringOrder(
  bindings: Bindings,
  request: SwapRecurringCreateRequest,
): Promise<SwapRecurringCreateResponse> {
  assertJupiterWriteNetwork(request.network, 'recurring');
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
        : extractProviderMessage(payload) ?? 'Recurring order request was rejected.',
      retryable: response.ok,
    });
  }

  if (!response.ok) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: extractProviderMessage(payload) ?? 'Recurring order request was rejected.',
    });
  }

  const recurringId = readTrimmedString(payload.requestId);
  const unsignedTransaction = readTrimmedString(payload.transaction);

  if (!recurringId || !unsignedTransaction) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Unable to build a recurring transaction at the moment.',
      retryable: true,
    });
  }

  return {
    recurringId,
    status: 'requires_signature',
    unsignedTransaction,
  };
}

async function executeRecurringOrder(
  bindings: Bindings,
  request: SwapRecurringExecuteRequest,
) : Promise<SwapRecurringExecuteResponse> {
  assertJupiterWriteNetwork(request.network, 'recurring');
  assertBase64Transaction(
    request.signedTransaction,
    'Signed transaction must be a base64-encoded string.',
  );

  const { payload } = await fetchJupiterJson(
    bindings,
    `${readJupiterApiBaseUrl(bindings)}/recurring/v1/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId: request.recurringId,
        signedTransaction: request.signedTransaction,
      }),
    },
    'Recurring order execution is currently unavailable.',
  );

  if (!isRecord(payload)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Recurring order execution is currently unavailable.',
      retryable: true,
    });
  }

  const status = readTrimmedString(payload.status);
  const signature = readTrimmedString(payload.signature);

  if (status === 'Success' && signature) {
    return {
      recurringId: request.recurringId,
      status: 'Success',
      signature,
    };
  }

  throw new AppError({
    status: 400,
    code: 'INVALID_REQUEST',
    message: extractProviderMessage(payload) ?? 'Recurring transaction execution failed.',
  });
}

export {
  SWAP_PRICE_CACHE_TTL_MS,
  SWAP_TOKENS_CACHE_TTL_MS,
  createRecurringOrder,
  createSwapQuote,
  executeRecurringOrder,
  executeSwapQuote,
  executeSwapQuoteDetailed,
  getSwapPrice,
  getSwapTokens,
  type SwapExecuteDetailedResponse,
  type SwapExecuteRequest,
  type SwapExecuteResponse,
  type SwapPriceResponse,
  type SwapQuoteRequest,
  type SwapQuoteResponse,
  type SwapRecurringCreateRequest,
  type SwapRecurringCreateResponse,
  type SwapRecurringExecuteRequest,
  type SwapRecurringExecuteResponse,
  type SwapToken,
  type SwapTokensResponse,
};
