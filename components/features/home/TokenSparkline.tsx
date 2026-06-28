/**
 * TokenSparkline — inline micro price chart for token holding rows.
 *
 * A dependency-free `react-native-svg` line + gradient-fill chart, adapted from
 * the token details screen's `buildChartPath` / `PriceLineChart` but stripped of
 * axes, tooltips, and gesture interaction. Color is driven by the 24h change
 * tone (green positive / red negative / neutral).
 *
 * The chart stretches to fill its parent's width (measured via `onLayout`) and
 * fades out at both horizontal edges via a mask so it blends into the row.
 *
 * Pure geometry/state helpers live in `./token-sparkline-geometry` so they can
 * be unit-tested without pulling in the React Native render tree.
 */
import { memo, useCallback, useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';

import { SkeletonBlock } from '@/components/ui/Skeleton';
import { colors } from '@/constants/colors';
import { radii } from '@/constants/spacing';

import {
  buildSparklinePath,
  sparklineColor,
  sparklineRenderMode,
  type SparklineTone,
} from './token-sparkline-geometry';

import type { ConvertedTokenPriceHistorySample } from '@/hooks/useOffpayTokenPriceHistory';

export {
  buildSparklinePath,
  sparklineColor,
  sparklineRenderMode,
  type SparklineRenderMode,
  type SparklineTone,
} from './token-sparkline-geometry';

/** Peak line opacity — kept below 1 so the line reads as a soft accent. */
const SPARKLINE_LINE_OPACITY = 0.82;
/** Soft fade-in width on the left edge (where the line meets the price text). */
const SPARKLINE_LEFT_FADE = 0.1;

export interface TokenSparklineProps {
  /** Price samples from `useOffpayTokenPriceHistory().data.samples`. */
  samples: ConvertedTokenPriceHistorySample[];
  /** Drives the line + gradient color; from `data.change.tone`. */
  tone: SparklineTone;
  /** Plot box height in px (chosen responsively by the row). */
  height: number;
  /** True while the price-history query is pending with no usable data. */
  loading?: boolean;
}

export const TokenSparkline = memo(function TokenSparkline({
  samples,
  tone,
  height,
  loading = false,
}: TokenSparklineProps): React.JSX.Element {
  // Unique gradient/mask ids per instance so multiple sparklines do not collide
  // in react-native-svg's shared <Defs> id namespace (colons stripped for web).
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const areaGradientId = `spark-area-${rawId}`;
  const edgeFadeId = `spark-edge-${rawId}`;
  const maskId = `spark-mask-${rawId}`;

  const [width, setWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  const mode = sparklineRenderMode(loading, samples.length);
  const path = mode === 'chart' && width > 0 ? buildSparklinePath(samples, width, height) : null;

  let content: React.JSX.Element;
  if (mode === 'loading') {
    content = <SkeletonBlock width="100%" height={height} radius={radii.sm} />;
  } else if (path == null) {
    content = (
      <View style={[styles.emptyFrame, { height }]}>
        <View style={styles.emptyBaseline} />
      </View>
    );
  } else {
    const stroke = sparklineColor(tone);
    content = (
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.2" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0.02" />
          </LinearGradient>
          <LinearGradient id={edgeFadeId} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset={`${SPARKLINE_LEFT_FADE}`} stopColor="#ffffff" stopOpacity="1" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="1" />
          </LinearGradient>
          <Mask id={maskId} x="0" y="0" width={width} height={height} maskUnits="userSpaceOnUse">
            <Rect x="0" y="0" width={width} height={height} fill={`url(#${edgeFadeId})`} />
          </Mask>
        </Defs>
        <G mask={`url(#${maskId})`}>
          <Path d={path.areaPath} fill={`url(#${areaGradientId})`} />
          <Path
            d={path.linePath}
            fill="none"
            stroke={stroke}
            strokeOpacity={SPARKLINE_LINE_OPACITY}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      </Svg>
    );
  }

  return (
    <View style={[styles.fill, { height }]} onLayout={handleLayout}>
      {content}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    justifyContent: 'center',
  },
  emptyFrame: {
    width: '100%',
    justifyContent: 'center',
  },
  emptyBaseline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.holdingsCard.divider,
  },
});
