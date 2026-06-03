/**
 * Looping AI thinking indicator (from `assets/lotties/ai-loader.lottie`).
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';

import aiLoaderLottie from '@/assets/lotties/ai-loader.json';
import { colors } from '@/constants/colors';

export type AiLoaderTone = 'onDark' | 'onLight';

interface AiLoaderLottieProps {
  size?: number;
  tone?: AiLoaderTone;
  accessibilityLabel?: string;
}

const TONE_COLORS: Record<AiLoaderTone, string> = {
  onDark: colors.brand.whiteStream,
  onLight: colors.brand.deepShadow,
};

export function AiLoaderLottie({
  size = 22,
  tone = 'onDark',
  accessibilityLabel = 'Yuga is thinking',
}: AiLoaderLottieProps): React.JSX.Element {
  const colorFilters = useMemo(
    () =>
      tone === 'onLight'
        ? [{ keypath: '**', color: TONE_COLORS.onLight }]
        : undefined,
    [tone],
  );

  return (
    <View
      pointerEvents="none"
      style={[styles.frame, { width: size, height: size }]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
    >
      <LottieView
        source={aiLoaderLottie}
        autoPlay
        loop
        resizeMode="contain"
        {...(colorFilters != null ? { colorFilters } : {})}
        style={styles.lottie}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: '100%',
    height: '100%',
  },
});
