export type FlashMarketSymbol = string;
export type FlashTradeType = 'market' | 'limit';
export type FlashSide = 'long' | 'short';
export type FlashPrivilege = 'none' | 'stake' | 'referral';
export type FlashApiSide = 'LONG' | 'SHORT';
export type FlashApiOrderType = 'MARKET' | 'LIMIT';
export type FlashTriggerOrderType = 'take_profit' | 'stop_loss';
export type FlashPositionStatus = 'open';
export type FlashOrderStatus = 'open';

export interface FlashHealthResponse {
  status: string;
  program: string;
  accounts: Record<string, number>;
  config: {
    source: string;
    env: string;
    version?: string | null;
    branch?: string | null;
    publishedAt?: string | null;
    loadedAtUnix?: number | null;
    pools?: number;
    markets?: number;
    tokens?: number;
  };
}

export interface FlashTokenInfo {
  symbol: string;
  mint: string;
  decimals: number;
  isStable: boolean;
  isVirtual: boolean;
  lazerId?: number | null;
  pythTicker?: string | null;
  isToken2022: boolean;
}

export interface FlashPriceInfo {
  price: number;
  exponent: number;
  confidence: number;
  priceUi: number;
  timestampUs: number;
  marketSession: string;
}

export interface FlashPrice {
  symbol: FlashMarketSymbol;
  price: number;
  confidenceInterval: number;
  updatedAt: number;
  marketSession: string;
}

export interface FlashRawAccount<T = unknown> {
  pubkey: string;
  account: T;
}

export interface FlashRawMarketAccount {
  pool?: string;
  targetCustody?: string;
  collateralCustody?: string;
  side?: string;
  permissions?: {
    allowOpenPosition?: boolean;
    allowClosePosition?: boolean;
    allowSizeChange?: boolean;
    allowCollateralWithdrawal?: boolean;
  };
}

export interface FlashMarketExecutionAccounts {
  side: FlashSide;
  marketPubkey: string;
  poolPubkey: string;
  targetCustodyPubkey: string;
  collateralCustodyPubkey: string;
  custodyPubkeysBySymbol: Record<string, string>;
}

export interface FlashEncodedAmount {
  rawAmount: string;
  decimals: number;
  symbol: string;
}

export interface FlashExpectedMarketAccounts {
  side: FlashSide;
  marketPubkey: string;
  poolPubkey: string;
  targetCustodyPubkey: string;
  collateralCustodyPubkey: string;
}

export interface FlashExpectedTriggerOrder {
  triggerPrice: number;
  isStopLoss: boolean;
  size: FlashEncodedAmount;
  receiveCustodyPubkey: string;
}

export type FlashTradeEconomicIntent =
  | {
      operation: 'open_position';
      side: FlashSide;
      tradeType: FlashTradeType;
      positionChange: 'open' | 'increase';
      market: FlashExpectedMarketAccounts;
      inputCustodyPubkey: string;
      collateral: FlashEncodedAmount;
      size: FlashEncodedAmount;
      /** Exact price bound encoded by the market/increase instruction; null for a limit order. */
      executionPriceLimit: number | null;
      /** Explicit ER privilege enum; limit orders have no privilege field and must use null. */
      privilege: FlashPrivilege | null;
      limitPrice?: number;
      stopLossPrice?: number;
      takeProfitPrice?: number;
      triggerOrders: FlashExpectedTriggerOrder[];
    }
  | {
      operation: 'close_position';
      side: FlashSide;
      closeMode: 'full' | 'partial';
      market: FlashExpectedMarketAccounts;
      outputCustodyPubkey: string;
      outputTokenSymbol: string;
      size: FlashEncodedAmount | null;
      executionPriceLimit: number;
      privilege: FlashPrivilege;
      cleanupTriggerOrders: boolean;
    }
  | {
      operation: 'add_collateral';
      side: FlashSide;
      market: FlashExpectedMarketAccounts;
      inputCustodyPubkey: string;
      amount: FlashEncodedAmount;
    }
  | {
      operation: 'remove_collateral';
      side: FlashSide;
      market: FlashExpectedMarketAccounts;
      outputCustodyPubkey: string;
      outputTokenSymbol: string;
      /** `remove_collateral_er` encodes `collateral_delta_usd` in six-decimal USD atoms. */
      usdAmountRaw: string;
    }
  | {
      operation: 'place_trigger_order';
      side: FlashSide;
      market: FlashExpectedMarketAccounts;
      receiveCustodyPubkey: string;
      receiveTokenSymbol: string;
      triggerPrice: number;
      isStopLoss: boolean;
      size: FlashEncodedAmount;
    }
  | {
      operation: 'edit_trigger_order';
      side: FlashSide;
      market: FlashExpectedMarketAccounts;
      receiveCustodyPubkey: string;
      receiveTokenSymbol: string;
      orderSlot: number;
      triggerPrice: number;
      isStopLoss: boolean;
      size: FlashEncodedAmount;
    }
  | {
      operation: 'cancel_trigger_order';
      side: FlashSide;
      market: FlashExpectedMarketAccounts;
      orderSlot: number;
      isStopLoss: boolean;
    }
  | {
      operation: 'cancel_all_trigger_orders';
      side: FlashSide;
      market: FlashExpectedMarketAccounts;
    }
  | {
      operation: 'reverse_position';
      sourceSide: FlashSide;
      destinationSide: FlashSide;
      sourceMarket: FlashExpectedMarketAccounts;
      destinationMarket: FlashExpectedMarketAccounts;
      settlementCustodyPubkey: string;
      settlementTokenSymbol: string;
      collateral: FlashEncodedAmount;
      size: FlashEncodedAmount;
      closeExecutionPriceLimit: number;
      openExecutionPriceLimit: number;
      closePrivilege: FlashPrivilege;
      openPrivilege: FlashPrivilege;
      cleanupTriggerOrders: boolean;
    };

export interface FlashPoolCustodyStats {
  custodyAccount: string;
  symbol: string;
  isStable: boolean;
  isVirtual: boolean;
  maxLeverage: string;
  maxDegenLeverage: string;
  openPositionFeeRate: string;
  closePositionFeeRate: string;
  utilizationUi: string;
  totalUsdOwnedAmountUi: string;
  availableToAddUsdUi: string;
  availableToRemoveUsdUi: string;
  priceUi: string;
  [key: string]: unknown;
}

export interface FlashPoolMarketStats {
  marketAccount: string;
  targetSymbol: string;
  side: FlashSide;
  openInterestUsd: string;
  collectiveSizeUsd: string;
  openPositions: number;
  maxPayoffBps: number;
  maxPositionLockedUsd: number;
  correlation: boolean;
}

export interface FlashPoolData {
  basketCount: number;
  custodyStats: FlashPoolCustodyStats[];
  marketStats: FlashPoolMarketStats[];
  poolAddress: string;
  poolName: string;
  lpStats: {
    equityUsd: string;
    lpPrice: string;
    lpTokenSupply: string;
    maxAumUsd: string;
    stableCoinPercentage: string;
    totalPoolValueUsd: string;
  };
}

export interface FlashPoolDataResponse {
  pools: FlashPoolData[];
}

export interface FlashMarket {
  symbol: FlashMarketSymbol;
  pubkey: string;
  longMarketPubkey: string | null;
  shortMarketPubkey: string | null;
  poolPubkey: string;
  poolName: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  minLeverage: number;
  maxLeverage: number;
  maxLeverageDegen: number;
  status: 'active' | 'paused' | 'disabled';
  feePercent: number;
  marketSession: string | null;
}

export interface FlashOraclePriceRaw {
  price: string;
  exponent: number;
  confidence: string;
  timestamp: string;
}

export interface FlashPositionMetrics {
  marketSymbol: string;
  collateralSymbol: string;
  sideUi: string;
  entryPriceUi: string;
  sizeAmountUi: string;
  sizeAmountUiKmb?: string | null;
  sizeUsdUi: string;
  collateralAmountUi: string;
  collateralAmountUiKmb?: string | null;
  collateralUsdUi: string;
  pnlWithFeeUsdUi: string;
  pnlPercentageWithFee: string;
  pnlWithoutFeeUsdUi: string;
  pnlPercentageWithoutFee: string;
  liquidationPriceUi: string;
  leverageUi: string;
  profitUsd: string;
  lossUsd: string;
  exitFeeUsd: string;
  borrowFeeUsd: string;
  totalFeeUsd: string;
  leverage: string;
  marginUsd: string;
  liquidationPrice: FlashOraclePriceRaw;
  exitPrice: FlashOraclePriceRaw;
}

export interface FlashTriggerOrderMetrics {
  orderId: number;
  type: 'TP' | 'SL';
  triggerPriceUi: string;
  sizeAmountUi: string;
  sizeUsdUi?: string | null;
  receiveTokenSymbol?: string | null;
}

export interface FlashLimitOrderMetrics {
  orderId: number;
  limitPriceUi: string;
  sizeAmountUi: string;
  sizeUsdUi?: string | null;
  takeProfitUi?: string | null;
  stopLossUi?: string | null;
  reserveAmountUi?: string | null;
}

export interface FlashOrderMetrics {
  marketSymbol: string;
  sideUi: string;
  limitOrders: FlashLimitOrderMetrics[];
  takeProfitOrders: FlashTriggerOrderMetrics[];
  stopLossOrders: FlashTriggerOrderMetrics[];
}

export interface FlashOwnerSnapshot {
  owner: string;
  basketPubkey?: string | null;
  basketData?: string | null;
  positionMetrics: Record<string, FlashPositionMetrics>;
  orderMetrics: Record<string, FlashOrderMetrics>;
}

export interface FlashAccountReadiness {
  ready: boolean;
  owner: string;
  basketPubkey: string | null;
  /** Basket visibility only; delegation and funded ledger are verified by the builder. */
  reason: 'basket_available' | 'basket_not_initialized' | 'basket_not_available';
}

export interface FlashPosition {
  positionKey: string;
  marketPubkey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  leverage: number;
  collateralUsd: number;
  collateralAmountUi: number;
  collateralSymbol: string;
  sizeUsd: number;
  sizeAmountUi: number;
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
  orderSlot: number;
  positionKey: string;
  marketPubkey: string;
  marketSymbol: FlashMarketSymbol;
  side: FlashSide;
  triggerPrice: number;
  sizeAmountUi: number;
  sizeUsd: number;
  sizePercent: number;
  isStopLoss: boolean;
  receiveTokenSymbol: string | null;
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

export interface FlashOpenPositionRequest {
  inputTokenSymbol: string;
  outputTokenSymbol: string;
  inputAmountUi: string;
  leverage: number;
  tradeType: FlashApiSide;
  orderType?: FlashApiOrderType;
  limitPrice?: string;
  takeProfit?: string;
  stopLoss?: string;
  owner?: string;
  slippagePercentage?: string;
}

export interface FlashTriggerQuote {
  exitPriceUi: string;
  profitUsdUi: string;
  lossUsdUi: string;
  exitFeeUsdUi: string;
  receiveUsdUi: string;
  pnlPercentage: string;
}

export interface FlashOpenPositionResponse {
  oldLeverage?: string | null;
  newLeverage: string;
  oldEntryPrice?: string | null;
  newEntryPrice: string;
  oldLiquidationPrice?: string | null;
  newLiquidationPrice: string;
  entryFee: string;
  entryFeeBeforeDiscount: string;
  openPositionFeePercent: string;
  availableLiquidity: string;
  youPayUsdUi: string;
  youRecieveUsdUi: string;
  marginFeePercentage: string;
  outputAmount: string;
  outputAmountUi: string;
  transactionBase64?: string | null;
  takeProfitQuote?: FlashTriggerQuote | null;
  stopLossQuote?: FlashTriggerQuote | null;
  err?: string | null;
}

export interface FlashClosePositionRequest {
  marketSymbol: string;
  side: FlashApiSide;
  inputUsdUi: string;
  withdrawTokenSymbol: string;
  owner: string;
  slippagePercentage?: string;
}

export interface FlashClosePositionResponse {
  receiveTokenSymbol: string;
  receiveTokenAmountUi: string;
  receiveTokenAmountUsdUi: string;
  markPrice: string;
  entryPrice: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  existingSize: string;
  newSize: string;
  existingCollateral: string;
  newCollateral: string;
  existingLeverage: string;
  newLeverage: string;
  settledPnl: string;
  fees: string;
  feesBeforeDiscount: string;
  lockAndUnsettledFeeUsd?: string | null;
  transactionBase64?: string | null;
  err?: string | null;
}

export interface FlashAddCollateralRequest {
  marketSymbol: string;
  side: FlashApiSide;
  depositAmountUi: string;
  depositTokenSymbol: string;
  owner: string;
  slippagePercentage?: string;
}

export interface FlashAddCollateralResponse {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  depositUsdValue: string;
  maxAddableUsd: string;
  transactionBase64?: string | null;
  err?: string | null;
}

export interface FlashRemoveCollateralRequest {
  marketSymbol: string;
  side: FlashApiSide;
  withdrawAmountUsdUi: string;
  withdrawTokenSymbol: string;
  owner: string;
  slippagePercentage?: string;
}

export interface FlashRemoveCollateralResponse {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  receiveAmountUi: string;
  receiveAmountUsdUi: string;
  maxWithdrawableUsd: string;
  transactionBase64?: string | null;
  err?: string | null;
}

export interface FlashPlaceTriggerOrderRequest {
  marketSymbol: string;
  side: FlashApiSide;
  triggerPriceUi: string;
  sizeAmountUi: string;
  isStopLoss: boolean;
  owner: string;
}

export interface FlashPlaceTpSlRequest {
  marketSymbol: string;
  side: FlashApiSide;
  takeProfitUi?: string;
  stopLossUi?: string;
  sizeAmountUi: string;
  owner: string;
}

export interface FlashEditTriggerOrderRequest {
  marketSymbol: string;
  side: FlashApiSide;
  orderId: number;
  isStopLoss: boolean;
  triggerPriceUi: string;
  sizeAmountUi: string;
  owner: string;
}

export interface FlashCancelTriggerOrderRequest {
  marketSymbol: string;
  side: FlashApiSide;
  orderId: number;
  isStopLoss: boolean;
  owner: string;
}

export interface FlashCancelAllTriggerOrdersRequest {
  marketSymbol: string;
  side: FlashApiSide;
  owner: string;
}

export interface FlashReversePositionRequest {
  marketSymbol: string;
  side: FlashApiSide;
  leverage: number;
  owner: string;
  slippagePercentage?: string;
}

export interface FlashReversePositionResponse {
  closeReceiveUsd: string;
  closeFees: string;
  closeSettledPnl: string;
  newSide: string;
  newLeverage: string;
  newEntryPrice: string;
  newLiquidationPrice: string;
  newSizeUsd: string;
  newSizeAmountUi: string;
  newCollateralUsd: string;
  openEntryFee: string;
  transactionBase64?: string | null;
  err?: string | null;
}

export interface FlashTransactionResponse {
  transactionBase64: string;
}

/** Official one-shot V2 onboarding deposit. Amount is expressed in UI units. */
export interface FlashDepositRequest {
  owner: string;
  tokenSymbol: string;
  amount: string;
}

export interface FlashInitBasketRequest {
  owner: string;
}
export interface FlashInitDepositLedgerRequest {
  owner: string;
}
export interface FlashDelegateBasketRequest {
  payer: string;
  owner: string;
}
export interface FlashDepositDirectRequest {
  owner: string;
  tokenMint: string;
  amount: string;
}
export interface FlashRequestWithdrawalRequest {
  owner: string;
  /** Must be a distinct signer. The live program rejects owner === feePayer. */
  feePayer: string;
  tokenMint: string;
  amount: string;
}
export interface FlashExecuteWithdrawalRequest {
  owner: string;
  tokenMint: string;
}

export interface FlashPreviewLimitOrderRequest {
  marketSymbol: string;
  inputAmountUi: string;
  outputAmountUi: string;
  side: FlashApiSide;
  limitPrice?: string;
}

export interface FlashPreviewLimitOrderResponse {
  entryPriceUi: string;
  entryFeeUsdUi: string;
  liquidationPriceUi: string;
  borrowRateUi: string;
  err?: string | null;
}

export interface FlashPreviewTpSlRequest {
  mode: 'forward' | 'reverse_pnl' | 'reverse_roi';
  marketSymbol: string;
  side: FlashApiSide;
  owner?: string;
  entryPriceUi?: string;
  sizeUsdUi?: string;
  collateralUsdUi?: string;
  triggerPriceUi?: string;
  targetPnlUsdUi?: string;
  targetRoiPercent?: number;
}

export interface FlashPreviewTpSlResponse {
  pnlUsdUi?: string | null;
  pnlPercentage?: string | null;
  triggerPriceUi?: string | null;
  err?: string | null;
}

export interface FlashPreviewMarginRequest {
  marketSymbol: string;
  side: FlashApiSide;
  marginDeltaUsdUi: string;
  action: 'ADD' | 'REMOVE';
  owner: string;
}

export interface FlashPreviewMarginResponse {
  newLeverageUi: string;
  newLiquidationPriceUi: string;
  maxAmountUsdUi: string;
  existingCollateralUsdUi?: string | null;
  newCollateralUsdUi?: string | null;
  existingLeverageUi?: string | null;
  existingLiquidationPriceUi?: string | null;
  deltaUsdUi?: string | null;
  err?: string | null;
}

export interface FlashPreviewExitFeeRequest {
  marketSymbol: string;
  side: FlashApiSide;
  closeAmountUsdUi: string;
  owner: string;
}

export interface FlashPreviewExitFeeResponse {
  exitFeeUsdUi: string;
  exitFeeAmountUi: string;
  exitPriceUi: string;
  err?: string | null;
}

export type FlashApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PROTOCOL_ERROR';

export interface FlashApiErrorResponse {
  error?: { code?: string; message?: string };
  err?: string | null;
  message?: string;
}

// These analytical shapes remain for display compatibility. No production tool
// may synthesize them; values must originate in a documented provider response.
export interface FlashFundingRate {
  marketSymbol: string;
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
  marketSymbol: string;
  side: FlashSide;
  liquidationPrice: number;
  currentPrice: number;
  distancePercent: number;
  sizeUsd: number;
  leverage: number;
  timestamp: number;
}
export interface FlashOpenInterest {
  marketSymbol: string;
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
  marketSymbol: string;
  volume24hUsd: number;
  volume7dUsd: number;
  volume30dUsd: number;
  trades24h: number;
  avgTradeSizeUsd: number;
  timestamp: number;
}
export interface FlashFeeAnalytic {
  marketSymbol: string;
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
  marketA: string;
  marketB: string;
  correlation: number;
  sampleSize: number;
}
export interface FlashAbsorptionMetric {
  marketSymbol: string;
  bidDepthUsd: number;
  askDepthUsd: number;
  totalPositionSizeUsd: number;
  absorptionRatio: number;
  timestamp: number;
}
export interface FlashOptimalEntry {
  marketSymbol: string;
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
  primaryMarket: string;
  primarySide: FlashSide;
  hedgeMarket: string;
  hedgeSide: FlashSide;
  hedgeSizePercent: number;
  correlation: number;
  reasoning: string;
}
