/**
 * Pure label/derivation helpers for the redesigned token holding row.
 *
 * Kept free of React Native imports so the privacy-masking, missing-value,
 * percent-presence, and visibility-gating rules are unit-testable in isolation
 * (the row component imports them).
 */
import type { ChangeTone } from '@/lib/ui/token-change-format';

/** Placeholder shown for user-specific values while privacy mode is active. */
export const PRIVACY_MASK = '****';
/** Placeholder shown when a fiat value is unavailable. */
export const MISSING_VALUE_PLACEHOLDER = '--';

/** A value is "numeric" for display if it contains at least one digit. */
export function hasNumericLabel(value: string | null | undefined): value is string {
  return typeof value === 'string' && /\d/.test(value);
}

/** Balance subtitle: masked under privacy, otherwise `${balance} ${symbol}`. */
export function resolveBalanceLabel(
  privacyHidden: boolean,
  balance: string,
  symbol: string,
): string {
  return privacyHidden ? PRIVACY_MASK : `${balance} ${symbol}`;
}

/**
 * Fiat holding value: masked under privacy; otherwise the label when it
 * contains a digit, else the non-numeric placeholder.
 */
export function resolveFiatValueLabel(
  privacyHidden: boolean,
  fiatValueLabel: string | null | undefined,
): string {
  if (privacyHidden) return PRIVACY_MASK;
  return hasNumericLabel(fiatValueLabel) ? fiatValueLabel : MISSING_VALUE_PLACEHOLDER;
}

/**
 * Extract just the fiat amount from a unit-price label for the market price
 * line. Unit-price labels are formatted `"$ 71.82/SOL"`; the trailing
 * `/SYMBOL` suffix is dropped so the row reads `SYMBOL  $price`. Returns `null`
 * when no numeric price is available.
 */
export function resolveUnitPriceAmount(unitPriceLabel: string | null | undefined): string | null {
  if (!hasNumericLabel(unitPriceLabel)) return null;
  const amount = unitPriceLabel.split('/')[0]?.trim();
  return amount != null && amount.length > 0 ? amount : null;
}

/** The 24h percent segment renders only when a change value is available. */
export function shouldShowPercentChange(
  change: { percent: number; tone: ChangeTone } | null | undefined,
): change is { percent: number; tone: ChangeTone } {
  return change != null;
}

/** A row's price-history query is enabled exactly when the row is visible. */
export function resolvePriceHistoryEnabled(visible: boolean): boolean {
  return visible;
}
