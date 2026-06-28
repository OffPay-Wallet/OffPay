/**
 * Pure geometry / state helpers for the token-row sparkline.
 *
 * Kept free of React Native / SVG imports so they can be unit-tested in
 * isolation (the `TokenSparkline` component re-exports them).
 */
import { toneColor, type ChangeTone } from '@/lib/ui/token-change-format';

export type SparklineTone = ChangeTone;

export type SparklineRenderMode = 'chart' | 'loading' | 'empty';
export interface SparklineValueSample {
  price: number;
}

/** Vertical breathing room (px) reserved at the top and bottom of the plot. */
export const SPARKLINE_VERTICAL_PADDING = 2;

/**
 * Build the SVG line and area paths for a sparkline.
 *
 * Returns `null` when there are fewer than two samples or the dimensions are
 * non-positive (the caller renders the empty/loading state instead). Every
 * produced point's x lies in `[0, width]` and y in `[0, height]`, with x
 * non-decreasing in sample order.
 */
export function buildSparklinePath(
  samples: readonly SparklineValueSample[],
  width: number,
  height: number,
): { linePath: string; areaPath: string } | null {
  if (samples.length < 2 || width <= 0 || height <= 0) return null;

  const top = Math.min(SPARKLINE_VERTICAL_PADDING, height / 2);
  const bottom = height - top;
  const plotHeight = Math.max(bottom - top, 1);

  const prices = samples.map((sample) => sample.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const rawRange = maxPrice - minPrice;
  const range = rawRange <= 0 ? Math.max(maxPrice * 0.1, 1) : rawRange;

  const points = samples.map((sample, index) => {
    const x = (index / (samples.length - 1)) * width;
    const y = bottom - ((sample.price - minPrice) / range) * plotHeight;
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath =
    `${linePath} L${last.x.toFixed(2)} ${bottom.toFixed(2)} ` +
    `L${first.x.toFixed(2)} ${bottom.toFixed(2)} Z`;

  return { linePath, areaPath };
}

/**
 * Select the render mode from the data state.
 *   - `chart` when there are at least two samples to plot
 *   - `loading` when there are fewer than two samples and the query is loading
 *   - `empty` otherwise (no data / error)
 */
export function sparklineRenderMode(loading: boolean, sampleCount: number): SparklineRenderMode {
  if (sampleCount >= 2) return 'chart';
  if (loading) return 'loading';
  return 'empty';
}

/** Map a tone to the sparkline line/gradient color (shared with the percent text). */
export function sparklineColor(tone: SparklineTone): string {
  return toneColor(tone);
}
