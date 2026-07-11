import {
  FLASH_MAX_SLIPPAGE_BPS,
  FLASH_MIN_COLLATERAL_USD,
  FLASH_MIN_COLLATERAL_WITH_TPSL_USD,
  FLASH_PRICE_STALE_THRESHOLD_MS,
} from '@/lib/flash-trade/constants';
import {
  FlashTradeApiError,
  type FlashEncodedAmount,
  type FlashMarket,
  type FlashMarketExecutionAccounts,
  type FlashExpectedMarketAccounts,
  type FlashPosition,
  type FlashPrice,
  type FlashSide,
  type FlashTriggerOrder,
} from '@/lib/flash-trade';
import {
  decodeFlashTradeEconomicInstructions,
  type FlashDecodedEconomicInstruction,
} from '@/lib/flash-trade/execution';
import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export function errorCodeFromUnknown(error: unknown, fallback: string): string {
  if (error instanceof FlashTradeApiError) return error.code.toLowerCase();
  return fallback;
}

export function requireMainnet(
  network: string | null | undefined,
): { ok: true } | { ok: false; code: string } {
  return network === 'mainnet' ? { ok: true } : { ok: false, code: 'flash_mainnet_only' };
}

export function requireWallet(
  walletAddress: string | null | undefined,
): { ok: true; walletAddress: string } | { ok: false; code: string } {
  return walletAddress != null && walletAddress.length > 0
    ? { ok: true, walletAddress }
    : { ok: false, code: 'wallet_not_connected' };
}

export function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function expectedMarketAccounts(
  accounts: FlashMarketExecutionAccounts,
  expectedSide: FlashSide,
): FlashExpectedMarketAccounts {
  if (accounts.side !== expectedSide) {
    throw new Error(
      `Flash Trade returned a ${accounts.side} market for a confirmed ${expectedSide} intent.`,
    );
  }
  return {
    side: accounts.side,
    marketPubkey: accounts.marketPubkey,
    poolPubkey: accounts.poolPubkey,
    targetCustodyPubkey: accounts.targetCustodyPubkey,
    collateralCustodyPubkey: accounts.collateralCustodyPubkey,
  };
}

export function custodyPubkeyForSymbol(
  accounts: FlashMarketExecutionAccounts,
  symbol: string,
): string | null {
  return accounts.custodyPubkeysBySymbol[symbol.trim().toUpperCase()] ?? null;
}

export function symbolForCustodyPubkey(
  accounts: FlashMarketExecutionAccounts,
  custodyPubkey: string,
): string | null {
  const match = Object.entries(accounts.custodyPubkeysBySymbol).find(
    ([, pubkey]) => pubkey === custodyPubkey,
  );
  return match?.[0] ?? null;
}

export function encodedAmountFromUi(params: {
  amountUi: string;
  decimals: number;
  symbol: string;
}): FlashEncodedAmount | null {
  const rawAmount = decimalInputToAtomicAmount(params.amountUi, params.decimals);
  if (
    rawAmount == null ||
    !/^\d+$/.test(rawAmount) ||
    BigInt(rawAmount) <= 0n ||
    BigInt(rawAmount) > (1n << 64n) - 1n
  ) {
    return null;
  }
  return {
    rawAmount,
    decimals: params.decimals,
    symbol: params.symbol,
  };
}

export function requireDecodedInstruction(
  transactionBase64: string,
  name: string,
): FlashDecodedEconomicInstruction {
  const matches = decodeFlashTradeEconomicInstructions(transactionBase64).filter(
    (instruction) => instruction.name === name,
  );
  if (matches.length !== 1 || matches[0] == null) {
    throw new Error(`Flash Trade transaction does not contain exactly one ${name} instruction.`);
  }
  return matches[0];
}

export function encodedAmountFromDecoded(params: {
  rawAmount: string | undefined;
  decimals: number;
  symbol: string;
}): FlashEncodedAmount {
  const value = params.rawAmount;
  if (
    value == null ||
    !/^\d+$/.test(value) ||
    BigInt(value) <= 0n ||
    BigInt(value) > (1n << 64n) - 1n
  ) {
    throw new Error('Flash Trade transaction contains an invalid encoded amount.');
  }
  return { rawAmount: value, decimals: params.decimals, symbol: params.symbol };
}

export function validateCollateral(
  collateralUsd: number,
  hasTpsl: boolean,
): { ok: true } | { ok: false; code: string } {
  const minimum = hasTpsl ? FLASH_MIN_COLLATERAL_WITH_TPSL_USD : FLASH_MIN_COLLATERAL_USD;
  if (!isPositiveFinite(collateralUsd) || collateralUsd < minimum) {
    return {
      ok: false,
      code: hasTpsl ? 'collateral_too_low_for_tpsl' : 'insufficient_collateral',
    };
  }
  return { ok: true };
}

export function validateLeverage(
  leverage: number,
  maxLeverage: number,
  degenMode: boolean,
  maxDegenLeverage = maxLeverage,
): { ok: true } | { ok: false; code: string } {
  if (!isPositiveFinite(leverage) || leverage < 1) {
    return { ok: false, code: 'invalid_leverage' };
  }
  const effectiveMaximum = degenMode ? maxDegenLeverage : maxLeverage;
  if (!Number.isFinite(effectiveMaximum) || effectiveMaximum < 1 || leverage > effectiveMaximum) {
    return { ok: false, code: 'leverage_exceeded' };
  }
  return { ok: true };
}

export function validateSlippageBps(
  slippageBps: number | undefined,
): { ok: true; slippagePercentage: string } | { ok: false; code: string } {
  const bps = slippageBps ?? 50;
  if (!isPositiveFinite(bps) || bps > FLASH_MAX_SLIPPAGE_BPS) {
    return { ok: false, code: 'invalid_slippage' };
  }
  return { ok: true, slippagePercentage: String(bps / 100) };
}

export function validateSide(
  side: string,
): { ok: true; side: 'long' | 'short'; apiSide: 'LONG' | 'SHORT' } | { ok: false; code: string } {
  if (side === 'long' || side === 'short') {
    return { ok: true, side, apiSide: side === 'long' ? 'LONG' : 'SHORT' };
  }
  return { ok: false, code: 'invalid_side' };
}

export function validateTriggerPrice(params: {
  orderType: 'limit' | 'take_profit' | 'stop_loss';
  side: 'long' | 'short';
  triggerPrice: number;
  currentPrice: number;
}): { ok: true } | { ok: false; code: string } {
  const { orderType, side, triggerPrice, currentPrice } = params;
  if (!isPositiveFinite(triggerPrice) || !isPositiveFinite(currentPrice)) {
    return { ok: false, code: 'invalid_trigger_price' };
  }
  if (orderType === 'limit') {
    if (side === 'long' && triggerPrice >= currentPrice)
      return { ok: false, code: 'invalid_limit_price' };
    if (side === 'short' && triggerPrice <= currentPrice)
      return { ok: false, code: 'invalid_limit_price' };
  } else if (orderType === 'take_profit') {
    if (side === 'long' && triggerPrice <= currentPrice)
      return { ok: false, code: 'tp_already_hit' };
    if (side === 'short' && triggerPrice >= currentPrice)
      return { ok: false, code: 'tp_already_hit' };
  } else {
    if (side === 'long' && triggerPrice >= currentPrice)
      return { ok: false, code: 'sl_already_hit' };
    if (side === 'short' && triggerPrice <= currentPrice)
      return { ok: false, code: 'sl_already_hit' };
  }
  return { ok: true };
}

export function isPriceStale(price: FlashPrice): boolean {
  return Date.now() - price.updatedAt > FLASH_PRICE_STALE_THRESHOLD_MS;
}

export function validateTradablePrice(
  price: FlashPrice,
): { ok: true } | { ok: false; code: string } {
  if (!isPositiveFinite(price.price)) return { ok: false, code: 'price_unavailable' };
  if (isPriceStale(price)) return { ok: false, code: 'stale_price' };
  if (price.marketSession.toLowerCase() === 'closed') {
    return { ok: false, code: 'market_session_closed' };
  }
  return { ok: true };
}

export function findMarketsBySymbol(markets: FlashMarket[], symbol: string): FlashMarket[] {
  const upperSymbol = symbol.trim().toUpperCase();
  return markets.filter((market) => market.symbol.toUpperCase() === upperSymbol);
}

export function findMarketBySymbol(
  markets: FlashMarket[],
  symbol: string,
  side?: 'long' | 'short',
): FlashMarket | null {
  const candidates = findMarketsBySymbol(markets, symbol);
  return (
    candidates.find(
      (market) =>
        market.status === 'active' &&
        (side == null ||
          (side === 'long' ? market.longMarketPubkey != null : market.shortMarketPubkey != null)),
    ) ??
    candidates[0] ??
    null
  );
}

export function expectedMarketPubkeys(
  markets: FlashMarket[],
  symbol: string,
  side: 'long' | 'short',
): string[] {
  return Array.from(
    new Set(
      findMarketsBySymbol(markets, symbol)
        .filter((market) => market.status === 'active')
        .map((market) => (side === 'long' ? market.longMarketPubkey : market.shortMarketPubkey))
        .filter((pubkey): pubkey is string => pubkey != null),
    ),
  );
}

export function sortedPositions(positions: readonly FlashPosition[]): FlashPosition[] {
  return [...positions].sort((a, b) =>
    `${a.marketSymbol}:${a.side}:${a.positionKey}`.localeCompare(
      `${b.marketSymbol}:${b.side}:${b.positionKey}`,
    ),
  );
}

export function positionRef(position: Pick<FlashPosition, 'positionKey'>): string {
  return `position_ref_${opaqueReference(position.positionKey)}`;
}

export function resolvePositionReference(
  positions: readonly FlashPosition[],
  reference: string,
): FlashPosition | null {
  return (
    positions.find((position) => positionRef(position) === reference) ??
    positions.find((position) => position.positionKey === reference) ??
    null
  );
}

export function sortedOrders(orders: readonly FlashTriggerOrder[]): FlashTriggerOrder[] {
  return [...orders].sort((a, b) =>
    `${a.marketSymbol}:${a.side}:${a.isStopLoss ? 1 : 0}:${a.orderSlot}:${a.orderId}`.localeCompare(
      `${b.marketSymbol}:${b.side}:${b.isStopLoss ? 1 : 0}:${b.orderSlot}:${b.orderId}`,
    ),
  );
}

export function orderRef(order: Pick<FlashTriggerOrder, 'orderId'>): string {
  return `order_ref_${opaqueReference(order.orderId)}`;
}

export function resolveOrderReference(
  orders: readonly FlashTriggerOrder[],
  reference: string,
): FlashTriggerOrder | null {
  return (
    orders.find((order) => orderRef(order) === reference) ??
    orders.find((order) => order.orderId === reference) ??
    null
  );
}

function opaqueReference(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(`offpay:flash-v2:${value}`))).slice(0, 24);
}

export function formatLeverage(leverage: number): string {
  return `${leverage.toFixed(1)}x`;
}

export function formatUsd(amount: number): string {
  return amount >= 1000
    ? `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : `$${amount.toFixed(2)}`;
}

export function formatPnl(pnlUsd: number): string {
  return `${pnlUsd >= 0 ? '+' : ''}${formatUsd(pnlUsd)}`;
}

export function formatPriceChangePercent(currentPrice: number, entryPrice: number): string {
  const change = ((currentPrice - entryPrice) / entryPrice) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}
