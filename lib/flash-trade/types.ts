export type FlashMarketSymbol = string;

export type FlashTradeType = 'market' | 'limit';

export type FlashSide = 'long' | 'short';

export type FlashTriggerOrderType = 'take_profit' | 'stop_loss';

export type FlashPositionStatus = 'open' | 'closed' | 'liquidated';

export type FlashOrderStatus = 'open' | 'triggered' | 'cancelled';

export interface FlashMarket {
  symbol: FlashMarketSymbol;
  pubkey: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  minLeverage: number;
  maxLeverage: number;
  maxLeverageDegen: number;
  status: 'active' | 'paused' | 'disabled';
  feePercent: number;
}

export interface FlashPrice {
  symbol: FlashMarketSymbol;
  price: number;
  confidenceInterval: number;
  updatedAt: number;
}

export interface FlashPosition {
  positionKey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  leverage: number;
  collateralUsd: number;
  sizeUsd: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  unrealizedPnlUsd: number;
  status: FlashPositionStatus;
  triggerOrderCount: number;
  createdAt: number;
  owner: string;
}

export interface FlashTriggerOrder {
  orderId: string;
  positionKey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  triggerPrice: number;
  sizeUsd: number;
  sizePercent: number;
  isStopLoss: boolean;
  status: FlashOrderStatus;
  createdAt: number;
}

export interface FlashPoolStats {
  totalAumUsd: number;
  totalCollateralUsd: number;
  utilizationPercent: number;
  lpTokenSupply: string;
}

export interface FlashOpenPositionRequest {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  leverage: number;
  collateralUsd: number;
  inputTokenSymbol: string;
  tradeType: FlashTradeType;
  limitPrice?: number;
  slippageBps?: number;
  degenMode?: boolean;
  owner: string;
}

export interface FlashOpenPositionResponse {
  positionKey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  leverage: number;
  collateralUsd: number;
  sizeUsd: number;
  entryPrice: number;
  liquidationPrice: number;
  entryFeeUsd: number;
  hourlyBorrowRatePercent: number;
  transactionBase64: string;
  expiresAt: number;
}

export interface FlashClosePositionRequest {
  positionKey: string;
  closeAmountUsd?: number;
  withdrawTokenSymbol: string;
  slippageBps?: number;
  owner: string;
}

export interface FlashClosePositionResponse {
  exitPrice: number;
  feesUsd: number;
  realizedPnlUsd: number;
  transactionBase64: string;
  expiresAt: number;
}

export interface FlashAddCollateralRequest {
  positionKey: string;
  depositAmount: number;
  depositTokenSymbol: string;
  owner: string;
}

export interface FlashAddCollateralResponse {
  newLeverage: number;
  newLiquidationPrice: number;
  transactionBase64: string;
  expiresAt: number;
}

export interface FlashRemoveCollateralRequest {
  positionKey: string;
  withdrawAmountUsd: number;
  withdrawTokenSymbol: string;
  owner: string;
}

export interface FlashRemoveCollateralResponse {
  newLeverage: number;
  newLiquidationPrice: number;
  transactionBase64: string;
  expiresAt: number;
}

export interface FlashPlaceTriggerOrderRequest {
  positionKey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  triggerPrice: number;
  sizeUsd?: number;
  sizePercent?: number;
  isStopLoss: boolean;
  owner: string;
}

export interface FlashPlaceTriggerOrderResponse {
  orderId: string;
  transactionBase64: string;
  expiresAt: number;
}

export interface FlashEditTriggerOrderRequest {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  orderId: string;
  newTriggerPrice: number;
  newSizeUsd?: number;
  isStopLoss: boolean;
  owner: string;
}

export interface FlashCancelTriggerOrderRequest {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  orderId: string;
  isStopLoss: boolean;
  owner: string;
}

export interface FlashCancelAllTriggerOrdersRequest {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  owner: string;
}

export interface FlashReversePositionRequest {
  positionKey: string;
  owner: string;
}

export interface FlashReversePositionResponse {
  newPositionKey: string;
  transactionBase64: string;
  expiresAt: number;
}

export interface FlashPreviewLimitOrderRequest {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  inputAmount: number;
  outputAmount: number;
}

export interface FlashPreviewLimitOrderResponse {
  entryPrice: number;
  liquidationPrice: number;
  entryFeeUsd: number;
  priceImpactPercent: number;
}

export interface FlashPreviewTpSlRequest {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  entryPrice: number;
  triggerPrice: number;
  collateralUsd: number;
  leverage: number;
}

export interface FlashPreviewTpSlResponse {
  pnlUsd: number;
  pnlPercent: number;
  projectedSizeUsd: number;
}

export interface FlashPreviewMarginRequest {
  positionKey: string;
  marginDeltaUsd: number;
  action: 'add' | 'remove';
}

export interface FlashPreviewMarginResponse {
  newLeverage: number;
  newLiquidationPrice: number;
  estimatedFees: number;
}

export interface FlashPreviewExitFeeRequest {
  positionKey: string;
  closeAmountUsd?: number;
}

export interface FlashPreviewExitFeeResponse {
  exitFeeUsd: number;
  exitPrice: number;
}

export type FlashApiErrorCode =
  | 'INSUFFICIENT_COLLATERAL'
  | 'LEVERAGE_EXCEEDED'
  | 'LEVERAGE_BELOW_MIN'
  | 'MARKET_NOT_FOUND'
  | 'MARKET_PAUSED'
  | 'MARKET_DISABLED'
  | 'POSITION_NOT_FOUND'
  | 'POSITION_NOT_OPEN'
  | 'POSITION_ALREADY_CLOSED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_CANCELLED'
  | 'INVALID_PRICE'
  | 'STALE_PRICE'
  | 'MAX_ORDERS_EXCEEDED'
  | 'COLLATERAL_TOO_LOW_FOR_TRIGGER'
  | 'BLOCKHASH_EXPIRED'
  | 'SIMULATION_FAILED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

export interface FlashApiError {
  code: FlashApiErrorCode;
  message: string;
}

export interface FlashApiErrorResponse {
  error: FlashApiError;
}
