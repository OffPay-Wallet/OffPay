import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { SharedValue } from 'react-native-reanimated';

const ROTATION_DURATION_MS = 10_000;
const PULSE_DURATION_MS = 2_800;

interface BlobLayer {
  id: string;
  widthRatio: number;
  heightRatio: number;
  offsetXRatio: number;
  offsetYRatio: number;
  rotation: number;
  spinMultiplier: number;
  minScale: number;
  maxScale: number;
  minOpacity: number;
  maxOpacity: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
}

const BLOB_LAYERS: readonly BlobLayer[] = [
  {
    id: 'outer-halo',
    widthRatio: 1,
    heightRatio: 0.86,
    offsetXRatio: 0,
    offsetYRatio: 0.01,
    rotation: -8,
    spinMultiplier: 0.2,
    minScale: 0.98,
    maxScale: 1.03,
    minOpacity: 0.62,
    maxOpacity: 0.9,
    backgroundColor: 'rgba(37, 225, 255, 0.08)',
    borderColor: 'rgba(124, 246, 255, 0.28)',
    borderWidth: 1,
  },
  {
    id: 'cyan-current',
    widthRatio: 0.78,
    heightRatio: 0.54,
    offsetXRatio: -0.06,
    offsetYRatio: -0.03,
    rotation: 22,
    spinMultiplier: -0.36,
    minScale: 0.94,
    maxScale: 1.08,
    minOpacity: 0.5,
    maxOpacity: 0.82,
    backgroundColor: 'rgba(61, 242, 255, 0.18)',
    borderColor: 'rgba(181, 251, 255, 0.2)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  {
    id: 'violet-current',
    widthRatio: 0.6,
    heightRatio: 0.72,
    offsetXRatio: 0.07,
    offsetYRatio: 0.04,
    rotation: -34,
    spinMultiplier: 0.44,
    minScale: 0.96,
    maxScale: 1.12,
    minOpacity: 0.36,
    maxOpacity: 0.66,
    backgroundColor: 'rgba(129, 102, 255, 0.16)',
    borderColor: 'rgba(182, 171, 255, 0.16)',
    borderWidth: StyleSheet.hairlineWidth,
  },
  {
    id: 'core',
    widthRatio: 0.36,
    heightRatio: 0.36,
    offsetXRatio: 0,
    offsetYRatio: 0,
    rotation: 0,
    spinMultiplier: 0,
    minScale: 0.9,
    maxScale: 1.14,
    minOpacity: 0.42,
    maxOpacity: 0.72,
    backgroundColor: 'rgba(247, 247, 242, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: StyleSheet.hairlineWidth,
  },
] as const;

interface ScannerBlobLayerProps {
  layer: BlobLayer;
  size: number;
  rotationProgress: SharedValue<number>;
  pulseProgress: SharedValue<number>;
}

function ScannerBlobLayer({
  layer,
  size,
  rotationProgress,
  pulseProgress,
}: ScannerBlobLayerProps): React.JSX.Element {
  const width = size * layer.widthRatio;
  const height = size * layer.heightRatio;
  const left = (size - width) / 2 + size * layer.offsetXRatio;
  const top = (size - height) / 2 + size * layer.offsetYRatio;
  const borderRadius = Math.min(width, height) / 2;

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      pulseProgress.value,
      [0, 0.5, 1],
      [layer.minScale, layer.maxScale, layer.minScale],
    );
    const opacity = interpolate(
      pulseProgress.value,
      [0, 0.5, 1],
      [layer.minOpacity, layer.maxOpacity, layer.minOpacity],
    );
    const rotation = layer.rotation + rotationProgress.value * 360 * layer.spinMultiplier;

    return {
      opacity,
      transform: [{ rotate: `${rotation}deg` }, { scale }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.layer,
        {
          width,
          height,
          left,
          top,
          borderRadius,
          backgroundColor: layer.backgroundColor,
          borderColor: layer.borderColor,
          borderWidth: layer.borderWidth,
        },
        animatedStyle,
      ]}
    />
  );
}

interface ScannerLottieBlobProps {
  size: number;
}

export function ScannerLottieBlob({ size }: ScannerLottieBlobProps): React.JSX.Element {
  const rotationProgress = useSharedValue(0);
  const pulseProgress = useSharedValue(0);

  useEffect(() => {
    rotationProgress.value = withRepeat(
      withTiming(1, { duration: ROTATION_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    pulseProgress.value = withRepeat(
      withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
  }, [pulseProgress, rotationProgress]);

  return (
    <View style={[styles.shell, { width: size, height: size, borderRadius: size / 2 }]}>
      {BLOB_LAYERS.map((layer) => (
        <ScannerBlobLayer
          key={layer.id}
          layer={layer}
          size={size}
          rotationProgress={rotationProgress}
          pulseProgress={pulseProgress}
        />
      ))}
      <View
        pointerEvents="none"
        style={[styles.centerDot, { left: size / 2 - 3, top: size / 2 - 3 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 229, 255, 0.025)',
    borderColor: 'rgba(68, 242, 255, 0.28)',
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'visible',
  },
  layer: {
    position: 'absolute',
  },
  centerDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(247, 247, 242, 0.76)',
  },
});
