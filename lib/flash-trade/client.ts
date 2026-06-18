import { FLASH_API_BASE_URL, FLASH_API_TIMEOUT_MS } from './constants';
import { fetchWithTimeout } from '@/lib/api/offpay-api-client';
import type {
  FlashApiErrorResponse,
  FlashMarket,
  FlashPosition,
  FlashPrice,
  FlashTriggerOrder,
  FlashPoolStats,
  FlashOpenPositionRequest,
  FlashOpenPositionResponse,
  FlashClosePositionRequest,
  FlashClosePositionResponse,
  FlashAddCollateralRequest,
  FlashAddCollateralResponse,
  FlashRemoveCollateralRequest,
  FlashRemoveCollateralResponse,
  FlashPlaceTriggerOrderRequest,
  FlashPlaceTriggerOrderResponse,
  FlashEditTriggerOrderRequest,
  FlashCancelTriggerOrderRequest,
  FlashCancelAllTriggerOrdersRequest,
  FlashReversePositionRequest,
  FlashReversePositionResponse,
  FlashPreviewLimitOrderRequest,
  FlashPreviewLimitOrderResponse,
  FlashPreviewTpSlRequest,
  FlashPreviewTpSlResponse,
  FlashPreviewMarginRequest,
  FlashPreviewMarginResponse,
  FlashPreviewExitFeeRequest,
  FlashPreviewExitFeeResponse,
} from './types';

export class FlashTradeApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
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

interface FlashApiClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function mapHttpError(status: number, path: string, body: string): FlashTradeApiError {
  let code = 'INTERNAL_ERROR';
  let message = body;

  try {
    const parsed = JSON.parse(body) as FlashApiErrorResponse;
    if (parsed.error) {
      code = parsed.error.code;
      message = parsed.error.message;
    }
  } catch {
    // Use defaults
  }

  if (status === 429) {
    code = 'RATE_LIMITED';
    message = 'Flash Trade API rate limit exceeded. Please wait and retry.';
  } else if (status === 401 || status === 403) {
    code = 'UNAUTHORIZED';
    message = 'Unauthorized access to Flash Trade API.';
  } else if (status === 404) {
    code = 'NOT_FOUND';
    message = 'Resource not found on Flash Trade API.';
  }

  return new FlashTradeApiError(code, status, message);
}

export class FlashTradeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly defaultSignal?: AbortSignal;

  constructor(config?: FlashApiClientConfig) {
    this.baseUrl = config?.baseUrl ?? FLASH_API_BASE_URL;
    this.timeoutMs = config?.timeoutMs ?? FLASH_API_TIMEOUT_MS;
    this.defaultSignal = config?.signal;
  }

  private async request<R>(
    path: string,
    init?: RequestInit & { signal?: AbortSignal },
  ): Promise<R> {
    const url = `${this.baseUrl}${path}`;
    const upstreamSignal = init?.signal ?? this.defaultSignal;
    const headers = init?.headers;
    const { signal: _signal, headers: _headers, ...restInit } = init ?? {};

    try {
      const res = await fetchWithTimeout(
        url,
        {
          ...restInit,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...headers,
          },
        },
        {
          signal: upstreamSignal,
          timeoutMs: this.timeoutMs,
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw mapHttpError(res.status, path, body);
      }

      return (await res.json()) as R;
    } catch (error) {
      if (error instanceof FlashTradeApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new FlashTradeApiError('TIMEOUT', 0, 'Request timed out');
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
    return this.request<R>(path, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    });
  }

  async getHealth(signal?: AbortSignal): Promise<{ status: string }> {
    return this.get('/health', signal);
  }

  async getMarkets(signal?: AbortSignal): Promise<FlashMarket[]> {
    const response = await this.get<{ markets: FlashMarket[] }>('/v1/markets', signal);
    return response.markets ?? [];
  }

  async getMarket(pubkey: string, signal?: AbortSignal): Promise<FlashMarket> {
    return this.get(`/v1/markets/${encodeURIComponent(pubkey)}`, signal);
  }

  async getPrices(signal?: AbortSignal): Promise<FlashPrice[]> {
    const response = await this.get<{ prices: FlashPrice[] }>('/v1/prices', signal);
    return response.prices ?? [];
  }

  async getPrice(symbol: string, signal?: AbortSignal): Promise<FlashPrice> {
    return this.get(`/v1/prices/${encodeURIComponent(symbol)}`, signal);
  }

  async getPositions(owner: string, signal?: AbortSignal): Promise<FlashPosition[]> {
    const response = await this.get<{ positions: FlashPosition[] }>(
      `/v1/positions?owner=${encodeURIComponent(owner)}`,
      signal,
    );
    return response.positions ?? [];
  }

  async getPosition(positionKey: string, signal?: AbortSignal): Promise<FlashPosition> {
    return this.get(`/v1/positions/${encodeURIComponent(positionKey)}`, signal);
  }

  async getOwnerPositions(owner: string, signal?: AbortSignal): Promise<FlashPosition[]> {
    const response = await this.get<{ positions: FlashPosition[] }>(
      `/v1/positions/owner/${encodeURIComponent(owner)}`,
      signal,
    );
    return response.positions ?? [];
  }

  async getOrders(owner: string, signal?: AbortSignal): Promise<FlashTriggerOrder[]> {
    const response = await this.get<{ orders: FlashTriggerOrder[] }>(
      `/v1/orders?owner=${encodeURIComponent(owner)}`,
      signal,
    );
    return response.orders ?? [];
  }

  async getOrder(orderId: string, signal?: AbortSignal): Promise<FlashTriggerOrder> {
    return this.get(`/v1/orders/${encodeURIComponent(orderId)}`, signal);
  }

  async getOwnerOrders(owner: string, signal?: AbortSignal): Promise<FlashTriggerOrder[]> {
    const response = await this.get<{ orders: FlashTriggerOrder[] }>(
      `/v1/orders/owner/${encodeURIComponent(owner)}`,
      signal,
    );
    return response.orders ?? [];
  }

  async getPoolData(poolPubkey?: string, signal?: AbortSignal): Promise<FlashPoolStats[]> {
    const path = poolPubkey ? `/v1/pool-data/${encodeURIComponent(poolPubkey)}` : '/v1/pool-data';
    const response = await this.get<{ pools: FlashPoolStats[] }>(path, signal);
    return response.pools ?? [];
  }

  async openPosition(
    req: FlashOpenPositionRequest,
    signal?: AbortSignal,
  ): Promise<FlashOpenPositionResponse> {
    return this.post('/v1/transaction-builder/open-position', req, signal);
  }

  async closePosition(
    req: FlashClosePositionRequest,
    signal?: AbortSignal,
  ): Promise<FlashClosePositionResponse> {
    return this.post('/v1/transaction-builder/close-position', req, signal);
  }

  async addCollateral(
    req: FlashAddCollateralRequest,
    signal?: AbortSignal,
  ): Promise<FlashAddCollateralResponse> {
    return this.post('/v1/transaction-builder/add-collateral', req, signal);
  }

  async removeCollateral(
    req: FlashRemoveCollateralRequest,
    signal?: AbortSignal,
  ): Promise<FlashRemoveCollateralResponse> {
    return this.post('/v1/transaction-builder/remove-collateral', req, signal);
  }

  async placeTriggerOrder(
    req: FlashPlaceTriggerOrderRequest,
    signal?: AbortSignal,
  ): Promise<FlashPlaceTriggerOrderResponse> {
    return this.post('/v1/transaction-builder/place-trigger-order', req, signal);
  }

  async editTriggerOrder(
    req: FlashEditTriggerOrderRequest,
    signal?: AbortSignal,
  ): Promise<{ transactionBase64: string; expiresAt: number }> {
    return this.post('/v1/transaction-builder/edit-trigger-order', req, signal);
  }

  async cancelTriggerOrder(
    req: FlashCancelTriggerOrderRequest,
    signal?: AbortSignal,
  ): Promise<{ transactionBase64: string; expiresAt: number }> {
    return this.post('/v1/transaction-builder/cancel-trigger-order', req, signal);
  }

  async cancelAllTriggerOrders(
    req: FlashCancelAllTriggerOrdersRequest,
    signal?: AbortSignal,
  ): Promise<{ transactionBase64: string; expiresAt: number }> {
    return this.post('/v1/transaction-builder/cancel-all-trigger-orders', req, signal);
  }

  async reversePosition(
    req: FlashReversePositionRequest,
    signal?: AbortSignal,
  ): Promise<FlashReversePositionResponse> {
    return this.post('/v1/transaction-builder/reverse-position', req, signal);
  }

  async previewLimitOrderFees(
    req: FlashPreviewLimitOrderRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewLimitOrderResponse> {
    return this.post('/v1/preview/limit-order-fees', req, signal);
  }

  async previewTpSl(
    req: FlashPreviewTpSlRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewTpSlResponse> {
    return this.post('/v1/preview/tp-sl', req, signal);
  }

  async previewMargin(
    req: FlashPreviewMarginRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewMarginResponse> {
    return this.post('/v1/preview/margin', req, signal);
  }

  async previewExitFee(
    req: FlashPreviewExitFeeRequest,
    signal?: AbortSignal,
  ): Promise<FlashPreviewExitFeeResponse> {
    return this.post('/v1/preview/exit-fee', req, signal);
  }
}

let flashTradeClientInstance: FlashTradeClient | null = null;

export function getFlashTradeClient(): FlashTradeClient {
  if (flashTradeClientInstance == null) {
    flashTradeClientInstance = new FlashTradeClient();
  }
  return flashTradeClientInstance;
}

export function resetFlashTradeClient(): void {
  flashTradeClientInstance = null;
}
