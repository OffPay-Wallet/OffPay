/**
 * Shared formatting + color helpers for 24-hour price change display.
 *
 * Extracted so the token details screen and the holdings token rows format and
 * color the percentage change identically, from a single source of truth.
 *
 * Color mapping note: in this palette `colors.semantic.success` is off-white,
 * so the actual green token for positive deltas is `colors.semantic.receive`.
 */
import { colors } from '@/constants/colors';

export type ChangeTone = 'positive' | 'negative' | 'neutral';

/**
 * Format a percentage change with a direction-matching sign.
 *
 * Examples: `2.4` -> "+2.40%", `-1.05` -> "-1.05%", `0` -> "0.00%",
 * `123.4` -> "+123.4%" (1 dp once magnitude reaches 100).
 */
export function formatPercentChange(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(Math.abs(normalized) >= 100 ? 1 : 2)}%`;
}

/**
 * Map a change tone to its display color.
 *   positive -> green (`colors.semantic.receive`)
 *   negative -> red (`colors.semantic.error`)
 *   neutral  -> secondary text color
 */
export function toneColor(tone: ChangeTone): string {
  switch (tone) {
    case 'positive':
      return colors.semantic.receive;
    case 'negative':
      return colors.semantic.error;
    default:
      return colors.text.secondary;
  }
}
