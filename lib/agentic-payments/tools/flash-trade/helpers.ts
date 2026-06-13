import { FLASH_MIN_COLLATERAL_USD, FLASH_MIN_COLLATERAL_WITH_TPSL_USD, FLASH_MAX_LEVERAGE_STANDARD, FLASH_MAX_LEVERAGE_DEGEN, FLASH_PRICE_STALE_THRESHOLD_MS } from '@/lib/flash-trade/constants';
import { FlashTradeApiError, type FlashMarket, type FlashPrice } from '@/lib/flash-trade';

export function errorCodeFromUnknown(error: unknown, fallback: string): string {
  if (error instanceof FlashTradeApiError) {
    return error.code.toLowerCase().replace(/_/g, '_');
  }
  if (error instanceof Error) {
    return fallback;
  }
  return fallback;
}

export function requireMainnet(network: string | null | undefined): { ok: true } | { ok: false; code: string } {
  if (network !== 'mainnet') {
    return { ok: false, code: 'flash_mainnet_only' };
  }
  return { ok: true };
}

export function requireWallet(walletAddress: string | null | undefined): { ok: true } | { ok: false; code: string } {
  if (walletAddress == null || walletAddress.length === 0) {
    return { ok: false, code: 'wallet_not_connected' };
  }
  return { ok: true };
}

export function validateCollateral(collateralUsd: number, hasTpsl: boolean): { ok: true } | { ok: false; code: string } {
  const minCollateral = hasTpsl ? FLASH_MIN_COLLATERAL_WITH_TPSL_USD : FLASH_MIN_COLLATERAL_USD;
  if (collateralUsd < minCollateral) {
    return { ok: false, code: hasTpsl ? 'collateral_too_low_for_tpsl' : 'insufficient_collateral' };
  }
  return { ok: true };
}

export function validateLeverage(
  leverage: number,
  maxLeverage: number,
  degenMode: boolean,
): { ok: true } | { ok: false; code: string } {
  if (leverage < 1) {
    return { ok: false, code: 'invalid_leverage' };
  }
  const effectiveMaxLeverage = degenMode ? Math.min(maxLeverage, FLASH_MAX_LEVERAGE_DEGEN) : Math.min(maxLeverage, FLASH_MAX_LEVERAGE_STANDARD);
  if (leverage > effectiveMaxLeverage) {
    return { ok: false, code: degenMode ? 'leverage_hard_cap' : 'leverage_exceeded' };
  }
  return { ok: true };
}

export function validateSide(side: string): { ok: true; side: 'long' | 'short' } | { ok: false; code: string } {
  if (side === 'long' || side === 'short') {
    return { ok: true, side };
  }
  return { ok: false, code: 'invalid_side' };
}

export function validateTriggerPrice(params: {
  orderType: 'take_profit' | 'stop_loss';
  side: 'long' | 'short';
  triggerPrice: number;
  entryPrice: number;
  currentPrice: number;
}): { ok: true } | { ok: false; code: string } {
  const { orderType, side, triggerPrice, entryPrice, currentPrice } = params;
  const isLong = side === 'long';

  if (orderType === 'take_profit') {
    if (isLong && triggerPrice <= entryPrice) {
      return { ok: false, code: 'tp_below_entry' };
    }
    if (!isLong && triggerPrice >= entryPrice) {
      return { ok: false, code: 'tp_above_entry' };
    }
    if (isLong && triggerPrice <= currentPrice) {
      return { ok: false, code: 'tp_already_hit' };
    }
    if (!isLong && triggerPrice >= currentPrice) {
      return { ok: false, code: 'tp_already_hit' };
    }
  }

  if (orderType === 'stop_loss') {
    if (isLong && triggerPrice >= entryPrice) {
      return { ok: false, code: 'sl_above_entry' };
    }
    if (!isLong && triggerPrice <= entryPrice) {
      return { ok: false, code: 'sl_below_entry' };
    }
    if (isLong && triggerPrice >= currentPrice) {
      return { ok: false, code: 'sl_already_hit' };
    }
    if (!isLong && triggerPrice <= currentPrice) {
      return { ok: false, code: 'sl_already_hit' };
    }
  }

  return { ok: true };
}

export function isPriceStale(price: FlashPrice): boolean {
  return Date.now() - price.updatedAt > FLASH_PRICE_STALE_THRESHOLD_MS;
}

export function findMarketBySymbol(markets: FlashMarket[], symbol: string): FlashMarket | null {
  const upperSymbol = symbol.toUpperCase();
  return markets.find((m) => m.symbol.toUpperCase() === upperSymbol) ?? null;
}

export function formatLeverage(leverage: number): string {
  return `${leverage.toFixed(1)}x`;
}

export function formatUsd(amount: number): string {
  if (amount >= 1000) {
    return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  return `$${amount.toFixed(2)}`;
}

export function formatPnl(pnlUsd: number): string {
  const sign = pnlUsd >= 0 ? '+' : '';
  return `${sign}${formatUsd(pnlUsd)}`;
}

export function formatPriceChangePercent(currentPrice: number, entryPrice: number): string {
  const change = ((currentPrice - entryPrice) / entryPrice) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}
