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
  poolPubkey: string;
  poolName: string;
  totalAumUsd: number;
  totalCollateralUsd: number;
  utilizationPercent: number;
  lpTokenSupply: string;
  aprPercent?: number;
  feePoolUsd?: number;
}

export interface FlashFundingRate {
  marketSymbol: FlashMarketSymbol;
  longRatePercent: number;
  shortRatePercent: number;
  longPositions: number;
  shortPositions: number;
  longUsd: number;
  shortUsd: number;
  imbalanceRatio: number;
  timestamp: number;
}

export interface FlashLiquidation {
  positionKey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  liquidationPrice: number;
  currentPrice: number;
  distancePercent: number;
  sizeUsd: number;
  leverage: number;
  timestamp: number;
}

export interface FlashOpenInterest {
  marketSymbol: FlashMarketSymbol;
  longUsd: number;
  shortUsd: number;
  totalUsd: number;
  longPositions: number;
  shortPositions: number;
  avgLeverage: number;
  timestamp: number;
}

export interface FlashPriceCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FlashTraderLeaderboardEntry {
  rank: number;
  walletAddress: string;
  totalPnlUsd: number;
  winRatePercent: number;
  totalTrades: number;
  avgLeverage: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
}

export interface FlashVolumeMetric {
  marketSymbol: FlashMarketSymbol;
  volume24hUsd: number;
  volume7dUsd: number;
  volume30dUsd: number;
  trades24h: number;
  avgTradeSizeUsd: number;
  timestamp: number;
}

export interface FlashFeeAnalytic {
  marketSymbol: FlashMarketSymbol;
  totalFeesUsd: number;
  avgFeePercent: number;
  feePoolUsd: number;
  volumeUsd: number;
  timestamp: number;
}

export interface FlashLiquidationHeatmap {
  priceRangeLow: number;
  priceRangeHigh: number;
  totalSizeUsd: number;
  positionCount: number;
  avgLeverage: number;
}

export interface FlashCorrelation {
  marketA: FlashMarketSymbol;
  marketB: FlashMarketSymbol;
  correlation: number;
  sampleSize: number;
}

export interface FlashAbsorptionMetric {
  marketSymbol: FlashMarketSymbol;
  bidDepthUsd: number;
  askDepthUsd: number;
  totalPositionSizeUsd: number;
  absorptionRatio: number;
  timestamp: number;
}

export interface FlashOptimalEntry {
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  recommendedPrice: number;
  estimatedSlippage: number;
  optimalSizeUsd: number;
  priceImpactPercent: number;
  entryFeeUsd: number;
}

export interface FlashPositionSizing {
  recommendedCollateralUsd: number;
  recommendedLeverage: number;
  maxLossUsd: number;
  maxLossPercent: number;
  kellyFraction?: number;
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
}

export interface FlashHedgeSuggestion {
  primaryMarket: FlashMarketSymbol;
  primarySide: FlashSide;
  hedgeMarket: FlashMarketSymbol;
  hedgeSide: FlashSide;
  hedgeSizePercent: number;
  correlation: number;
  reasoning: string;
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
