import { fetchWithTimeout } from '@/lib/api/offpay-api-client';

import { FLASH_API_BASE_URL, FLASH_API_TIMEOUT_MS } from './constants';
import type {
  FlashAccountReadiness,
  FlashAddCollateralRequest,
  FlashAddCollateralResponse,
  FlashApiErrorResponse,
  FlashCancelAllTriggerOrdersRequest,
  FlashCancelTriggerOrderRequest,
  FlashClosePositionRequest,
  FlashClosePositionResponse,
  FlashDelegateBasketRequest,
  FlashDepositRequest,
  FlashDepositDirectRequest,
  FlashEditTriggerOrderRequest,
  FlashExecuteWithdrawalRequest,
  FlashHealthResponse,
  FlashInitBasketRequest,
  FlashInitDepositLedgerRequest,
  FlashMarket,
  FlashMarketExecutionAccounts,
  FlashOpenPositionRequest,
  FlashOpenPositionResponse,
  FlashOrderMetrics,
  FlashOwnerSnapshot,
  FlashPlaceTpSlRequest,
  FlashPlaceTriggerOrderRequest,
  FlashPoolData,
  FlashPoolDataResponse,
  FlashPoolStats,
  FlashPosition,
  FlashPreviewExitFeeRequest,
  FlashPreviewExitFeeResponse,
  FlashPreviewLimitOrderRequest,
  FlashPreviewLimitOrderResponse,
  FlashPreviewMarginRequest,
  FlashPreviewMarginResponse,
  FlashPreviewTpSlRequest,
  FlashPreviewTpSlResponse,
  FlashPrice,
  FlashPriceInfo,
  FlashRawAccount,
  FlashRawMarketAccount,
  FlashRemoveCollateralRequest,
  FlashRemoveCollateralResponse,
  FlashRequestWithdrawalRequest,
  FlashReversePositionRequest,
  FlashReversePositionResponse,
  FlashTokenInfo,
  FlashTransactionResponse,
  FlashTriggerOrder,
} from './types';

export class FlashTradeApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'FlashTradeApiError';
  }
}

export class FlashTradeConnectionError extends Error {
  constructor(
    public readonly path: string,
    cause: Error,
  ) {
    super(`Flash Trade API connection error: ${cause.message}`);
    this.name = 'FlashTradeConnectionError';
    this.cause = cause;
  }
}

export interface FlashApiClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function mapHttpError(status: number, path: string, body: string): FlashTradeApiError {
  let code = status === 400 ? 'BAD_REQUEST' : 'UPSTREAM_ERROR';
  let message = body.trim() || `Flash Trade API returned HTTP ${status}.`;

  try {
    const parsed = JSON.parse(body) as FlashApiErrorResponse;
    code = parsed.error?.code ?? code;
    message = parsed.error?.message ?? parsed.message ?? parsed.err ?? message;
  } catch {
    // Some V2 validation errors are intentionally plain text.
  }

  if (status === 429) code = 'RATE_LIMITED';
  if (status === 401 || status === 403) code = 'UNAUTHORIZED';
  if (status === 404) code = 'NOT_FOUND';

  return new FlashTradeApiError(code, status, message, path);
}

function assertNoProtocolError<T>(path: string, value: T): T {
  if (value != null && typeof value === 'object' && 'err' in value) {
    const err = (value as { err?: unknown }).err;
    if (typeof err === 'string' && err.trim().length > 0) {
      throw new FlashTradeApiError('PROTOCOL_ERROR', 200, err, path);
    }
  }
  return value;
}

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sideFrom(value: unknown): 'long' | 'short' {
  return String(value).toLowerCase() === 'short' ? 'short' : 'long';
}

function feeRateToPercent(rate: string): number {
  return numberFrom(rate) / 10_000_000;
}

function transactionRequired(
  path: string,
  response: { transactionBase64?: string | null },
): asserts response is { transactionBase64: string } {
  if (typeof response.transactionBase64 !== 'string' || response.transactionBase64.length === 0) {
    throw new FlashTradeApiError(
      'INVALID_RESPONSE',
      200,
      'Flash Trade did not return a transaction for this wallet request.',
      path,
    );
  }
}

export class FlashTradeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultSignal?: AbortSignal;

  constructor(config?: FlashApiClientConfig) {
    this.baseUrl = (config?.baseUrl ?? FLASH_API_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = config?.timeoutMs ?? FLASH_API_TIMEOUT_MS;
    this.defaultSignal = config?.signal;
  }

  private async request<R>(
    path: string,
    init?: RequestInit & { signal?: AbortSignal },
  ): Promise<R> {
    const upstreamSignal = init?.signal ?? this.defaultSignal;
    const headers = init?.headers;
    const { signal: _signal, headers: _headers, ...restInit } = init ?? {};

    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}${path}`,
        {
          ...restInit,
          headers: {
            Accept: 'application/json',
            ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
        },
        { signal: upstreamSignal, timeoutMs: this.timeoutMs },
      );

      if (!response.ok) {
        throw mapHttpError(response.status, path, await response.text().catch(() => ''));
      }

      const value = (await response.json()) as R;
      return assertNoProtocolError(path, value);
    } catch (error) {
      if (error instanceof FlashTradeApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FlashTradeApiError('TIMEOUT', 0, 'Flash Trade request timed out.', path);
      }
      throw new FlashTradeConnectionError(
        path,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private get<R>(path: string, signal?: AbortSignal): Promise<R> {
    return this.request<R>(path, { method: 'GET', signal });
  }

  private post<R>(path: string, body: unknown, signal?: AbortSignal): Promise<R> {
    return this.request<R>(path, { method: 'POST', body: JSON.stringify(body), signal });
  }

  getHealth(signal?: AbortSignal): Promise<FlashHealthResponse> {
    return this.get('/health', signal);
  }

  getTokens(signal?: AbortSignal): Promise<FlashTokenInfo[]> {
    return this.get('/tokens', signal);
  }

  async getPrices(signal?: AbortSignal): Promise<FlashPrice[]> {
    const prices = await this.get<Record<string, FlashPriceInfo>>('/prices', signal);
    return Object.entries(prices).map(([symbol, price]) => ({
      symbol,
      price: numberFrom(price.priceUi),
      confidenceInterval: Math.abs(numberFrom(price.confidence) * 10 ** numberFrom(price.exponent)),
      updatedAt: Math.floor(numberFrom(price.timestampUs) / 1_000),
      marketSession: String(price.marketSession ?? 'unknown'),
    }));
  }

  async getPrice(symbol: string, signal?: AbortSignal): Promise<FlashPrice> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const price = await this.get<FlashPriceInfo>(
      `/prices/${encodeURIComponent(normalizedSymbol)}`,
      signal,
    );
    return {
      symbol: normalizedSymbol,
      price: numberFrom(price.priceUi),
      confidenceInterval: Math.abs(numberFrom(price.confidence) * 10 ** numberFrom(price.exponent)),
      updatedAt: Math.floor(numberFrom(price.timestampUs) / 1_000),
      marketSession: String(price.marketSession ?? 'unknown'),
    };
  }

  async getRawMarkets(signal?: AbortSignal): Promise<FlashRawAccount<FlashRawMarketAccount>[]> {
    return this.get('/raw/markets', signal);
  }

  getRawMarket(
    marketPubkey: string,
    signal?: AbortSignal,
  ): Promise<FlashRawAccount<FlashRawMarketAccount>> {
    return this.get(`/raw/markets/${encodeURIComponent(marketPubkey)}`, signal);
  }

  async getMarketExecutionAccounts(
    marketPubkey: string,
    signal?: AbortSignal,
  ): Promise<FlashMarketExecutionAccounts> {
    const market = await this.getRawMarket(marketPubkey, signal);
    const poolPubkey = market.account.pool?.trim() ?? '';
    const targetCustodyPubkey = market.account.targetCustody?.trim() ?? '';
    const collateralCustodyPubkey = market.account.collateralCustody?.trim() ?? '';
    const rawSide = market.account.side?.trim().toLowerCase() ?? '';
    const side = rawSide === 'long' || rawSide === 'short' ? rawSide : null;
    if (
      market.pubkey !== marketPubkey ||
      side == null ||
      poolPubkey.length === 0 ||
      targetCustodyPubkey.length === 0 ||
      collateralCustodyPubkey.length === 0
    ) {
      throw new FlashTradeApiError(
        'MALFORMED_RESPONSE',
        502,
        'Flash Trade returned incomplete market execution accounts.',
        `/raw/markets/${marketPubkey}`,
      );
    }

    const pools = await this.getPoolData(poolPubkey, signal);
    const pool = pools.find((candidate) => candidate.poolAddress === poolPubkey);
    if (pool == null) {
      throw new FlashTradeApiError(
        'MALFORMED_RESPONSE',
        502,
        'Flash Trade returned no matching pool execution account.',
        `/pool-data/${poolPubkey}`,
      );
    }

    const custodyPubkeysBySymbol: Record<string, string> = {};
    for (const custody of pool.custodyStats) {
      const symbol = custody.symbol.trim().toUpperCase();
      const pubkey = custody.custodyAccount.trim();
      if (symbol.length === 0 || pubkey.length === 0) continue;
      const existing = custodyPubkeysBySymbol[symbol];
      if (existing != null && existing !== pubkey) {
        throw new FlashTradeApiError(
          'AMBIGUOUS_CUSTODY',
          502,
          `Flash Trade returned multiple ${symbol} custodies for one pool.`,
          `/pool-data/${poolPubkey}`,
        );
      }
      custodyPubkeysBySymbol[symbol] = pubkey;
    }

    return {
      side,
      marketPubkey,
      poolPubkey,
      targetCustodyPubkey,
      collateralCustodyPubkey,
      custodyPubkeysBySymbol,
    };
  }

  async getPoolData(poolPubkey?: string, signal?: AbortSignal): Promise<FlashPoolData[]> {
    if (poolPubkey != null) {
      const value = await this.get<FlashPoolData | FlashPoolDataResponse>(
        `/pool-data/${encodeURIComponent(poolPubkey)}`,
        signal,
      );
      return 'pools' in value ? value.pools : [value];
    }
    return (await this.get<FlashPoolDataResponse>('/pool-data', signal)).pools ?? [];
  }

  async getMarkets(signal?: AbortSignal): Promise<FlashMarket[]> {
    const [pools, rawMarkets, tokens, prices] = await Promise.all([
      this.getPoolData(undefined, signal),
      this.getRawMarkets(signal),
      this.getTokens(signal),
      this.getPrices(signal),
    ]);
    const rawByPubkey = new Map(rawMarkets.map((market) => [market.pubkey, market.account]));
    const tokenBySymbol = new Map(tokens.map((token) => [token.symbol.toUpperCase(), token]));
    const priceBySymbol = new Map(prices.map((price) => [price.symbol.toUpperCase(), price]));
    const markets: FlashMarket[] = [];

    for (const pool of pools) {
      const statsBySymbol = new Map(
        pool.custodyStats.map((custody) => [custody.symbol.toUpperCase(), custody]),
      );
      const symbols = new Map<
        string,
        { long: string | null; short: string | null; allowLong: boolean; allowShort: boolean }
      >();

      for (const stats of pool.marketStats) {
        const symbol = stats.targetSymbol.toUpperCase();
        const current = symbols.get(symbol) ?? {
          long: null,
          short: null,
          allowLong: false,
          allowShort: false,
        };
        const raw = rawByPubkey.get(stats.marketAccount);
        const allowed = raw?.permissions?.allowOpenPosition === true;
        if (stats.side === 'short') {
          current.short = stats.marketAccount;
          current.allowShort = allowed;
        } else {
          current.long = stats.marketAccount;
          current.allowLong = allowed;
        }
        symbols.set(symbol, current);
      }

      for (const [symbol, sides] of symbols) {
        const custody = statsBySymbol.get(symbol);
        const token = tokenBySymbol.get(symbol);
        const price = priceBySymbol.get(symbol);
        const protocolOpen = sides.allowLong || sides.allowShort;
        const sessionClosed = price?.marketSession.toLowerCase() === 'closed';
        markets.push({
          symbol,
          pubkey: sides.long ?? sides.short ?? '',
          longMarketPubkey: sides.long,
          shortMarketPubkey: sides.short,
          poolPubkey: pool.poolAddress,
          poolName: pool.poolName,
          baseSymbol: symbol,
          quoteSymbol: 'USDC',
          baseDecimals: token?.decimals ?? 0,
          quoteDecimals: tokenBySymbol.get('USDC')?.decimals ?? 6,
          minLeverage: 1,
          maxLeverage: numberFrom(custody?.maxLeverage, 1),
          maxLeverageDegen: numberFrom(custody?.maxDegenLeverage, 1),
          status: !protocolOpen ? 'disabled' : sessionClosed ? 'paused' : 'active',
          feePercent: feeRateToPercent(custody?.openPositionFeeRate ?? '0'),
          marketSession: price?.marketSession ?? null,
        });
      }
    }

    return markets;
  }

  async getMarket(pubkey: string, signal?: AbortSignal): Promise<FlashMarket> {
    const market = (await this.getMarkets(signal)).find(
      (candidate) =>
        candidate.pubkey === pubkey ||
        candidate.longMarketPubkey === pubkey ||
        candidate.shortMarketPubkey === pubkey,
    );
    if (market == null) {
      throw new FlashTradeApiError('NOT_FOUND', 404, 'Flash Trade market not found.');
    }
    return market;
  }

  getOwnerSnapshot(owner: string, signal?: AbortSignal): Promise<FlashOwnerSnapshot> {
    return this.get(`/owner/${encodeURIComponent(owner)}`, signal);
  }

  async getAccountReadiness(owner: string, signal?: AbortSignal): Promise<FlashAccountReadiness> {
    const snapshot = await this.getOwnerSnapshot(owner, signal);
    const basketPubkey = snapshot.basketPubkey ?? null;
    if (basketPubkey == null) {
      return { ready: false, owner, basketPubkey: null, reason: 'basket_not_initialized' };
    }
    if (snapshot.basketData == null) {
      return { ready: false, owner, basketPubkey, reason: 'basket_not_available' };
    }
    return { ready: true, owner, basketPubkey, reason: 'basket_available' };
  }

  async getOwnerPositions(owner: string, signal?: AbortSignal): Promise<FlashPosition[]> {
    const [snapshot, prices] = await Promise.all([
      this.getOwnerSnapshot(owner, signal),
      this.getPrices(signal),
    ]);
    const priceBySymbol = new Map(prices.map((price) => [price.symbol.toUpperCase(), price.price]));

    return Object.entries(snapshot.positionMetrics ?? {}).map(([marketPubkey, metrics]) => ({
      positionKey: marketPubkey,
      marketPubkey,
      marketSymbol: metrics.marketSymbol,
      side: sideFrom(metrics.sideUi),
      leverage: numberFrom(metrics.leverageUi),
      collateralUsd: numberFrom(metrics.collateralUsdUi),
      collateralAmountUi: numberFrom(metrics.collateralAmountUi),
      collateralSymbol: metrics.collateralSymbol,
      sizeUsd: numberFrom(metrics.sizeUsdUi),
      sizeAmountUi: numberFrom(metrics.sizeAmountUi),
      entryPrice: numberFrom(metrics.entryPriceUi),
      markPrice: priceBySymbol.get(metrics.marketSymbol.toUpperCase()) ?? 0,
      liquidationPrice: numberFrom(metrics.liquidationPriceUi),
      unrealizedPnlUsd: numberFrom(metrics.pnlWithFeeUsdUi),
      status: 'open' as const,
      triggerOrderCount: triggerOrderCount(snapshot.orderMetrics?.[marketPubkey]),
      createdAt: 0,
      owner,
    }));
  }

  getPositions(owner: string, signal?: AbortSignal): Promise<FlashPosition[]> {
    return this.getOwnerPositions(owner, signal);
  }

  async getPosition(
    positionKey: string,
    owner: string,
    signal?: AbortSignal,
  ): Promise<FlashPosition> {
    const position = (await this.getOwnerPositions(owner, signal)).find(
      (candidate) => candidate.positionKey === positionKey,
    );
    if (position == null) {
      throw new FlashTradeApiError('NOT_FOUND', 404, 'Flash Trade position not found.');
    }
    return position;
  }

  async getOwnerOrders(owner: string, signal?: AbortSignal): Promise<FlashTriggerOrder[]> {
    const [snapshot, positions] = await Promise.all([
      this.getOwnerSnapshot(owner, signal),
      this.getOwnerPositions(owner, signal),
    ]);
    const positionByMarket = new Map(
      positions.map((position) => [position.marketPubkey, position]),
    );
    const orders: FlashTriggerOrder[] = [];

    for (const [marketPubkey, metrics] of Object.entries(snapshot.orderMetrics ?? {})) {
      const position = positionByMarket.get(marketPubkey);
      for (const [isStopLoss, entries] of [
        [false, metrics.takeProfitOrders ?? []],
        [true, metrics.stopLossOrders ?? []],
      ] as const) {
        for (const order of entries) {
          const sizeAmountUi = numberFrom(order.sizeAmountUi);
          const sizeUsd = numberFrom(order.sizeUsdUi, sizeAmountUi * (position?.markPrice ?? 0));
          orders.push({
            orderId: `${marketPubkey}:${isStopLoss ? 'sl' : 'tp'}:${order.orderId}`,
            orderSlot: order.orderId,
            positionKey: marketPubkey,
            marketPubkey,
            marketSymbol: metrics.marketSymbol,
            side: sideFrom(metrics.sideUi),
            triggerPrice: numberFrom(order.triggerPriceUi),
            sizeAmountUi,
            sizeUsd,
            sizePercent:
              position != null && position.sizeAmountUi > 0
                ? Math.min(100, (sizeAmountUi / position.sizeAmountUi) * 100)
                : 0,
            isStopLoss,
            receiveTokenSymbol: order.receiveTokenSymbol?.trim().toUpperCase() ?? null,
            status: 'open',
            createdAt: 0,
          });
        }
      }
    }
    return orders;
  }

  getOrders(owner: string, signal?: AbortSignal): Promise<FlashTriggerOrder[]> {
    return this.getOwnerOrders(owner, signal);
  }

  async getOrder(orderId: string, owner: string, signal?: AbortSignal): Promise<FlashTriggerOrder> {
    const order = (await this.getOwnerOrders(owner, signal)).find(
      (candidate) => candidate.orderId === orderId,
    );
    if (order == null) {
      throw new FlashTradeApiError('NOT_FOUND', 404, 'Flash Trade order not found.');
    }
    return order;
  }

  async getPoolStats(poolPubkey?: string, signal?: AbortSignal): Promise<FlashPoolStats[]> {
    return (await this.getPoolData(poolPubkey, signal)).map((pool) => {
      const totalCollateralUsd = pool.custodyStats.reduce(
        (sum, custody) => sum + numberFrom(custody.totalUsdOwnedAmountUi),
        0,
      );
      const utilizationNumerator = pool.custodyStats.reduce(
        (sum, custody) =>
          sum + numberFrom(custody.totalUsdOwnedAmountUi) * numberFrom(custody.utilizationUi),
        0,
      );
      return {
        poolPubkey: pool.poolAddress,
        poolName: pool.poolName,
        totalAumUsd: numberFrom(pool.lpStats.totalPoolValueUsd),
        totalCollateralUsd,
        utilizationPercent: totalCollateralUsd > 0 ? utilizationNumerator / totalCollateralUsd : 0,
        lpTokenSupply: pool.lpStats.lpTokenSupply,
      };
    });
  }

  openPosition(
    req: FlashOpenPositionRequest,
    signal?: AbortSignal,
  ): Promise<FlashOpenPositionResponse> {
    return this.post('/transaction-builder/open-position', req, signal);
  }

  closePosition(
    req: FlashClosePositionRequest,
    signal?: AbortSignal,
  ): Promise<FlashClosePositionResponse> {
    return this.post('/transaction-builder/close-position', req, signal);
  }

  reversePosition(
    req: FlashReversePositionRequest,
    signal?: AbortSignal,
  ): Promise<FlashReversePositionResponse> {
    return this.post('/transaction-builder/reverse-position', req, signal);
  }

  addCollateral(
    req: FlashAddCollateralRequest,
    signal?: AbortSignal,
  ): Promise<FlashAddCollateralResponse> {
    return this.post('/transaction-builder/add-collateral', req, signal);
  }

  removeCollateral(
    req: FlashRemoveCollateralRequest,
    signal?: AbortSignal,
  ): Promise<FlashRemoveCollateralResponse> {
    return this.post('/transaction-builder/remove-collateral', req, signal);
  }

  placeTriggerOrder(
    req: FlashPlaceTriggerOrderRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/place-trigger-order', req, signal);
  }

  placeTpSl(req: FlashPlaceTpSlRequest, signal?: AbortSignal): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/place-tp-sl', req, signal);
  }

  editTriggerOrder(
    req: FlashEditTriggerOrderRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/edit-trigger-order', req, signal);
  }

  cancelTriggerOrder(
    req: FlashCancelTriggerOrderRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/cancel-trigger-order', req, signal);
  }

  cancelAllTriggerOrders(
    req: FlashCancelAllTriggerOrdersRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.cancelTriggerOrder({ ...req, orderId: 255, isStopLoss: false }, signal);
  }

  previewLimitOrderFees(
    req: FlashPreviewLimitOrderRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewLimitOrderResponse> {
    return this.post('/preview/limit-order-fees', req, signal);
  }

  previewTpSl(
    req: FlashPreviewTpSlRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewTpSlResponse> {
    return this.post('/preview/tp-sl', req, signal);
  }

  previewMargin(
    req: FlashPreviewMarginRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewMarginResponse> {
    return this.post('/preview/margin', req, signal);
  }

  previewExitFee(
    req: FlashPreviewExitFeeRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewExitFeeResponse> {
    return this.post('/preview/exit-fee', req, signal);
  }

  initBasket(req: FlashInitBasketRequest, signal?: AbortSignal): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/init-basket', req, signal);
  }

  initDepositLedger(
    req: FlashInitDepositLedgerRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/init-deposit-ledger', req, signal);
  }

  delegateBasket(
    req: FlashDelegateBasketRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/delegate-basket', req, signal);
  }

  deposit(req: FlashDepositRequest, signal?: AbortSignal): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/deposit', req, signal);
  }

  depositDirect(
    req: FlashDepositDirectRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/deposit-direct', req, signal);
  }

  requestWithdrawal(
    req: FlashRequestWithdrawalRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/request-withdrawal', req, signal);
  }

  executeWithdrawal(
    req: FlashExecuteWithdrawalRequest,
    signal?: AbortSignal,
  ): Promise<FlashTransactionResponse> {
    return this.post('/transaction-builder/withdrawal-settle', req, signal);
  }

  requireTransaction<T extends { transactionBase64?: string | null }>(
    path: string,
    response: T,
  ): T & { transactionBase64: string } {
    transactionRequired(path, response);
    return response;
  }
}

function triggerOrderCount(metrics: FlashOrderMetrics | undefined): number {
  if (metrics == null) return 0;
  return (metrics.takeProfitOrders?.length ?? 0) + (metrics.stopLossOrders?.length ?? 0);
}

let flashTradeClientInstance: FlashTradeClient | null = null;

export function getFlashTradeClient(): FlashTradeClient {
  if (flashTradeClientInstance == null) flashTradeClientInstance = new FlashTradeClient();
  return flashTradeClientInstance;
}

export function resetFlashTradeClient(): void {
  flashTradeClientInstance = null;
}
