/**
 * HoldingsValueChangeChart — large balance-card area chart.
 *
 * Uses the same pure sparkline geometry as token rows, but renders a larger
 * soft-filled curve for the home balance card.
 */
import { memo, useCallback, useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { SkeletonBlock } from '@/components/ui/Skeleton';
import { colors } from '@/constants/colors';
import { radii } from '@/constants/spacing';
import {
  buildSparklinePath,
  sparklineColor,
  sparklineRenderMode,
  type SparklineTone,
} from '@/components/features/home/token-sparkline-geometry';

import type { HoldingsValueChangeSample } from '@/hooks/useOffpayHoldingsValueChange';

interface HoldingsValueChangeChartProps {
  samples: readonly HoldingsValueChangeSample[];
  tone: SparklineTone;
  height: number;
  loading?: boolean;
  hidden?: boolean;
}

const CHART_LINE_OPACITY = 0.92;

export const HoldingsValueChangeChart = memo(function HoldingsValueChangeChart({
  samples,
  tone,
  height,
  loading = false,
  hidden = false,
}: HoldingsValueChangeChartProps): React.JSX.Element {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const areaGradientId = `holdings-change-area-${rawId}`;
  const [width, setWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);
  const valueSamples = hidden ? [] : samples.map((sample) => ({ price: sample.value }));
  const mode = sparklineRenderMode(loading && !hidden, valueSamples.length);
  const path =
    mode === 'chart' && width > 0 ? buildSparklinePath(valueSamples, width, height) : null;

  let content: React.JSX.Element;
  if (mode === 'loading') {
    content = <SkeletonBlock width="100%" height={height} radius={radii.md} />;
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
            <Stop offset="0" stopColor={stroke} stopOpacity="0.34" />
            <Stop offset="0.62" stopColor={stroke} stopOpacity="0.16" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        <Path d={path.areaPath} fill={`url(#${areaGradientId})`} />
        <Path
          d={path.linePath}
          fill="none"
          stroke={stroke}
          strokeOpacity={CHART_LINE_OPACITY}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  return (
    <View style={[styles.fill, { height }]} onLayout={handleLayout} pointerEvents="none">
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
