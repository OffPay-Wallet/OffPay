import {
  buildSparklinePath,
  sparklineColor,
  sparklineRenderMode,
} from '@/components/features/home/token-sparkline-geometry';
import { colors } from '@/constants/colors';

import type { ConvertedTokenPriceHistorySample } from '@/hooks/useOffpayTokenPriceHistory';

function makeSamples(prices: number[]): ConvertedTokenPriceHistorySample[] {
  return prices.map((price, index) => ({
    price,
    usdPrice: price,
    timestamp: 1_700_000_000_000 + index * 60_000,
    marketCapUsd: null,
    totalVolumeUsd: null,
  }));
}

/** Parse the numeric coordinates out of an SVG path string. */
function pathPoints(path: string): { x: number; y: number }[] {
  const matches = path.match(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g) ?? [];
  return matches.map((token) => {
    const [, x, y] = token.match(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)!;
    return { x: Number(x), y: Number(y) };
  });
}

describe('TokenSparkline helpers', () => {
  // Feature: token-card-redesign, Property 5: Sparkline geometry within bounds and ordered
  describe('buildSparklinePath', () => {
    it('returns null for fewer than two samples or non-positive dimensions', () => {
      expect(buildSparklinePath(makeSamples([10]), 56, 28)).toBeNull();
      expect(buildSparklinePath([], 56, 28)).toBeNull();
      expect(buildSparklinePath(makeSamples([1, 2]), 0, 28)).toBeNull();
      expect(buildSparklinePath(makeSamples([1, 2]), 56, 0)).toBeNull();
    });

    it('produces one line point per sample, in-bounds, with non-decreasing x', () => {
      const widths = [40, 48, 56, 120];
      const heights = [22, 24, 28, 40];
      const series = [
        [1, 2, 3, 4, 5],
        [5, 4, 3, 2, 1],
        [10, 10, 10, 10],
        [0.01, 0.05, 0.02, 0.09, 0.03, 0.07],
      ];

      for (const width of widths) {
        for (const height of heights) {
          for (const prices of series) {
            const samples = makeSamples(prices);
            const path = buildSparklinePath(samples, width, height);
            expect(path).not.toBeNull();
            const points = pathPoints(path!.linePath);
            expect(points).toHaveLength(samples.length);

            let previousX = -Infinity;
            for (const point of points) {
              expect(point.x).toBeGreaterThanOrEqual(0);
              expect(point.x).toBeLessThanOrEqual(width + 0.001);
              expect(point.y).toBeGreaterThanOrEqual(0);
              expect(point.y).toBeLessThanOrEqual(height + 0.001);
              expect(point.x).toBeGreaterThanOrEqual(previousX - 0.001);
              previousX = point.x;
            }
          }
        }
      }
    });

    it('closes the area path back to the baseline', () => {
      const path = buildSparklinePath(makeSamples([1, 3, 2]), 56, 28);
      expect(path!.areaPath.startsWith(path!.linePath)).toBe(true);
      expect(path!.areaPath.trim().endsWith('Z')).toBe(true);
    });
  });

  // Feature: token-card-redesign, Property 6: Sparkline render-mode over the data state space
  describe('sparklineRenderMode', () => {
    it('is chart whenever there are at least two samples', () => {
      expect(sparklineRenderMode(false, 2)).toBe('chart');
      expect(sparklineRenderMode(true, 2)).toBe('chart');
      expect(sparklineRenderMode(false, 180)).toBe('chart');
    });

    it('is loading only when loading with fewer than two samples', () => {
      expect(sparklineRenderMode(true, 0)).toBe('loading');
      expect(sparklineRenderMode(true, 1)).toBe('loading');
    });

    it('is empty for no-data / error states when not loading', () => {
      expect(sparklineRenderMode(false, 0)).toBe('empty');
      expect(sparklineRenderMode(false, 1)).toBe('empty');
    });

    it('only produces a plotted line in chart mode', () => {
      for (let count = 0; count <= 3; count += 1) {
        for (const loading of [true, false]) {
          const mode = sparklineRenderMode(loading, count);
          const path = buildSparklinePath(
            makeSamples(Array.from({ length: count }, (_, i) => i + 1)),
            56,
            28,
          );
          if (mode === 'chart') {
            expect(path).not.toBeNull();
          } else {
            expect(path).toBeNull();
          }
        }
      }
    });
  });

  // Feature: token-card-redesign, Property 3: Tone-to-color mapping (sparkline side)
  describe('sparklineColor', () => {
    it('matches the shared tone color mapping', () => {
      expect(sparklineColor('positive')).toBe(colors.semantic.receive);
      expect(sparklineColor('negative')).toBe(colors.semantic.error);
      expect(sparklineColor('neutral')).toBe(colors.text.secondary);
    });
  });
});
