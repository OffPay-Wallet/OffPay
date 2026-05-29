import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import blobLottie from '@/assets/lotties/blob.json';

import type { SharedValue } from 'react-native-reanimated';

const COMPOSITION_SIZE = 379;
const FRAME_DURATION_MS = 10_010;

type KeyframeValue = number | number[] | { t: number; s: number[] }[];

interface BlobAsset {
  id: string;
  w: number;
  h: number;
  p: string;
}

interface BlobLayer {
  ind?: number;
  refId: string;
  nm: string;
  ks: {
    p: { k: number[] };
    s: { k: KeyframeValue };
    r: { k: KeyframeValue };
    o: { k: KeyframeValue };
  };
}

interface BlobLottieJson {
  op: number;
  assets: BlobAsset[];
  layers: BlobLayer[];
}

interface BlobLayerModel {
  id: string;
  asset: BlobAsset;
  position: number[];
  scale: KeyframeValue;
  rotation: KeyframeValue;
  opacity: KeyframeValue;
}

const blobAnimation = blobLottie as BlobLottieJson;

function getNumberAtFrame(value: KeyframeValue, frame: number, fallback: number): number {
  'worklet';

  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
    return value[0] ?? fallback;
  }
  if (!Array.isArray(value) || value.length === 0) return fallback;

  const keyframes = value as { t: number; s: number[] }[];
  let previous = keyframes[0];
  let next = keyframes[keyframes.length - 1];

  for (let index = 1; index < keyframes.length; index += 1) {
    const candidate = keyframes[index];
    if (frame <= candidate.t) {
      next = candidate;
      break;
    }
    previous = candidate;
  }

  const startFrame = previous.t;
  const endFrame = next.t;
  const startValue = previous.s[0] ?? fallback;
  const endValue = next.s[0] ?? startValue;
  if (endFrame <= startFrame) return endValue;

  const progress = Math.max(0, Math.min(1, (frame - startFrame) / (endFrame - startFrame)));
  return startValue + (endValue - startValue) * progress;
}

function createLayerModels(): BlobLayerModel[] {
  const assetsById = new Map(blobAnimation.assets.map((asset) => [asset.id, asset]));

  return blobAnimation.layers
    .flatMap((layer) => {
      const asset = assetsById.get(layer.refId);
      if (asset == null || !asset.p.startsWith('data:image/')) return [];

      return [{
        id: `${layer.ind ?? layer.refId}-${layer.nm}`,
        asset,
        position: layer.ks.p.k,
        scale: layer.ks.s.k,
        rotation: layer.ks.r.k,
        opacity: layer.ks.o.k,
      }];
    })
    .reverse();
}

const blobLayers = createLayerModels();

function BlobLayerView({
  layer,
  size,
  frame,
}: {
  layer: BlobLayerModel;
  size: number;
  frame: SharedValue<number>;
}): React.JSX.Element {
  const factor = size / COMPOSITION_SIZE;
  const left = (layer.position[0] - layer.asset.w / 2) * factor;
  const top = (layer.position[1] - layer.asset.h / 2) * factor;
  const width = layer.asset.w * factor;
  const height = layer.asset.h * factor;

  const animatedStyle = useAnimatedStyle(() => {
    const scale = getNumberAtFrame(layer.scale, frame.value, 100) / 100;
    const rotation = getNumberAtFrame(layer.rotation, frame.value, 0);
    const opacity = getNumberAtFrame(layer.opacity, frame.value, 100) / 100;

    return {
      opacity,
      transform: [{ rotate: `${rotation}deg` }, { scale }],
    };
  });

  return (
    <Animated.View style={[styles.layer, { left, top, width, height }, animatedStyle]}>
      <ExpoImage source={{ uri: layer.asset.p }} style={styles.image} contentFit="contain" />
    </Animated.View>
  );
}

interface ScannerLottieBlobProps {
  size: number;
}

export function ScannerLottieBlob({ size }: ScannerLottieBlobProps): React.JSX.Element {
  const frame = useSharedValue(0);

  useEffect(() => {
    frame.value = withRepeat(
      withTiming(blobAnimation.op, { duration: FRAME_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
  }, [frame]);

  return (
    <View style={[styles.shell, { width: size, height: size, borderRadius: size / 2 }]}>
      {blobLayers.length > 0 ? (
        blobLayers.map((layer) => (
          <BlobLayerView key={layer.id} layer={layer} size={size} frame={frame} />
        ))
      ) : (
        <View style={styles.image} />
      )}
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
  image: {
    width: '100%',
    height: '100%',
  },
});
