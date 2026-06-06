import { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/constants/colors';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const OFFPAY_BODY_PATH =
  'm87.8 12.7h-58.9c-0.6 0-0.9-1.4-0.9-2.7 0-1.1 0.4-2 1-2h61c-1.4-1.7-3.8-3.8-6-3.8l-67.2 0.1c-5.6 0-12.9 5.8-12.8 14.8l-0.1 53.9c0 11.9 9.5 23.1 23.1 23.1h46c11.9 0 23.2-7.5 23.1-21.9v-53c0-3-4-8.5-8.3-8.5z';

const KEYFRAME_POINTS = [
  0, 0.08, 0.09, 0.2, 0.21, 0.32, 0.33, 0.36, 0.38, 0.42, 0.48, 0.49, 0.6, 0.61, 0.65, 0.67, 0.7,
  0.73, 0.77, 0.83, 0.84, 0.89, 0.9, 1,
];
const EYE_X = [
  0, 0, -4.2, -4.2, 4.2, 4.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3.2, 3.2, 0, 0,
];
const EYE_Y = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.6, 1.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const EYE_SCALE_Y = [
  1, 1, 1, 1, 1, 1, 1, 1, 0.04, 1, 1, 1, 1, 1, 1, 0.04, 1, 0.04, 1, 1, 1, 1, 1, 1,
];

const LEFT_EYE_X = 25.6;
const RIGHT_EYE_X = 60.3;
const EYE_TOP = 43.2;
const EYE_WIDTH = 14;
const EYE_HEIGHT = 10.4;
const EYE_MIN_HEIGHT = 0.65;

function buildEyePath(x: number, y: number, width: number, height: number): string {
  'worklet';

  if (height <= 1) {
    const middleY = y + height / 2;
    return `M ${x} ${middleY} L ${x + width} ${middleY} L ${x + width} ${middleY + height} L ${x} ${
      middleY + height
    } Z`;
  }

  const bottom = y + height;
  const sideTop = y + height * 0.62;
  const shoulderY = y + height * 0.18;
  const leftShoulderX = x + width * 0.16;
  const rightShoulderX = x + width * 0.84;
  const centerX = x + width / 2;

  return [
    `M ${x} ${bottom}`,
    `L ${x} ${sideTop}`,
    `C ${x} ${shoulderY} ${leftShoulderX} ${y} ${centerX} ${y}`,
    `C ${rightShoulderX} ${y} ${x + width} ${shoulderY} ${x + width} ${sideTop}`,
    `L ${x + width} ${bottom}`,
    'Z',
  ].join(' ');
}

export interface AnimatedOffPayLogoProps {
  size?: number;
  bodyColor?: string;
  eyeColor?: string;
  /** Shared value that shifts the eyes down when positive. Additive to the keyframe animation. */
  lookDownOffset?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}

export function AnimatedOffPayLogo({
  size = 132,
  bodyColor = colors.brand.whiteStream,
  eyeColor = colors.brand.deepShadow,
  lookDownOffset,
  style,
}: AnimatedOffPayLogoProps): React.JSX.Element {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
      -1,
      false,
    );

    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  const leftEyeProps = useAnimatedProps(() => {
    const offsetX = interpolate(progress.value, KEYFRAME_POINTS, EYE_X, Extrapolation.CLAMP);
    const keyframeY = interpolate(progress.value, KEYFRAME_POINTS, EYE_Y, Extrapolation.CLAMP);
    const externalY = lookDownOffset != null ? lookDownOffset.value : 0;
    const offsetY = keyframeY + externalY;
    const scaleY = interpolate(progress.value, KEYFRAME_POINTS, EYE_SCALE_Y, Extrapolation.CLAMP);
    const height = Math.max(EYE_MIN_HEIGHT, EYE_HEIGHT * scaleY);
    const bottom = EYE_TOP + EYE_HEIGHT;

    return {
      d: buildEyePath(LEFT_EYE_X + offsetX, bottom - height + offsetY, EYE_WIDTH, height),
    };
  });

  const rightEyeProps = useAnimatedProps(() => {
    const offsetX = interpolate(progress.value, KEYFRAME_POINTS, EYE_X, Extrapolation.CLAMP);
    const keyframeY = interpolate(progress.value, KEYFRAME_POINTS, EYE_Y, Extrapolation.CLAMP);
    const externalY = lookDownOffset != null ? lookDownOffset.value : 0;
    const offsetY = keyframeY + externalY;
    const scaleY = interpolate(progress.value, KEYFRAME_POINTS, EYE_SCALE_Y, Extrapolation.CLAMP);
    const height = Math.max(EYE_MIN_HEIGHT, EYE_HEIGHT * scaleY);
    const bottom = EYE_TOP + EYE_HEIGHT;

    return {
      d: buildEyePath(RIGHT_EYE_X + offsetX, bottom - height + offsetY, EYE_WIDTH, height),
    };
  });

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={style}
      accessibilityLabel="OffPay animated logo"
      accessible
    >
      <Path d={OFFPAY_BODY_PATH} fill={bodyColor} />
      <AnimatedPath animatedProps={leftEyeProps} fill={eyeColor} />
      <AnimatedPath animatedProps={rightEyeProps} fill={eyeColor} />
    </Svg>
  );
}
