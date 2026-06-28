import { Easing, withTiming } from 'react-native-reanimated';

import type {
  EntryAnimationsValues,
  ExitAnimationsValues,
  LayoutAnimation,
} from 'react-native-reanimated';

const ACTION_CARD_MORPH_OPEN_DURATION_MS = 280;
const ACTION_CARD_MORPH_CLOSE_DURATION_MS = 230;
const ACTION_CARD_MORPH_FADE_DURATION_MS = 160;
const ACTION_CARD_MORPH_TRANSLATE_Y = 6;
const ACTION_CARD_MORPH_SCALE_X = 0.985;
const ACTION_CARD_MORPH_START_RADIUS = 16;
const ACTION_CARD_MORPH_EASING = Easing.bezier(0.2, 0, 0, 1);
const ACTION_CARD_FADE_EASING = Easing.out(Easing.quad);

export function actionCardMorphEnter(values: EntryAnimationsValues): LayoutAnimation {
  'worklet';
  const targetRadius =
    typeof values.targetBorderRadius === 'number'
      ? values.targetBorderRadius
      : ACTION_CARD_MORPH_START_RADIUS;

  return {
    initialValues: {
      opacity: 0,
      height: 0,
      borderRadius: ACTION_CARD_MORPH_START_RADIUS,
      transform: [
        { translateY: ACTION_CARD_MORPH_TRANSLATE_Y },
        { scaleX: ACTION_CARD_MORPH_SCALE_X },
      ],
    },
    animations: {
      opacity: withTiming(1, {
        duration: ACTION_CARD_MORPH_FADE_DURATION_MS,
        easing: ACTION_CARD_FADE_EASING,
      }),
      height: withTiming(values.targetHeight, {
        duration: ACTION_CARD_MORPH_OPEN_DURATION_MS,
        easing: ACTION_CARD_MORPH_EASING,
      }),
      borderRadius: withTiming(targetRadius, {
        duration: ACTION_CARD_MORPH_OPEN_DURATION_MS,
        easing: ACTION_CARD_MORPH_EASING,
      }),
      transform: [
        {
          translateY: withTiming(0, {
            duration: ACTION_CARD_MORPH_OPEN_DURATION_MS,
            easing: ACTION_CARD_MORPH_EASING,
          }),
        },
        {
          scaleX: withTiming(1, {
            duration: ACTION_CARD_MORPH_OPEN_DURATION_MS,
            easing: ACTION_CARD_MORPH_EASING,
          }),
        },
      ],
    },
  };
}

export function actionCardMorphExit(values: ExitAnimationsValues): LayoutAnimation {
  'worklet';
  const currentRadius =
    typeof values.currentBorderRadius === 'number'
      ? values.currentBorderRadius
      : ACTION_CARD_MORPH_START_RADIUS;

  return {
    initialValues: {
      opacity: 1,
      height: values.currentHeight,
      borderRadius: currentRadius,
      transform: [{ translateY: 0 }, { scaleX: 1 }],
    },
    animations: {
      opacity: withTiming(0, {
        duration: ACTION_CARD_MORPH_FADE_DURATION_MS,
        easing: ACTION_CARD_FADE_EASING,
      }),
      height: withTiming(0, {
        duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
        easing: ACTION_CARD_MORPH_EASING,
      }),
      borderRadius: withTiming(ACTION_CARD_MORPH_START_RADIUS, {
        duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
        easing: ACTION_CARD_MORPH_EASING,
      }),
      transform: [
        {
          translateY: withTiming(ACTION_CARD_MORPH_TRANSLATE_Y, {
            duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
            easing: ACTION_CARD_MORPH_EASING,
          }),
        },
        {
          scaleX: withTiming(ACTION_CARD_MORPH_SCALE_X, {
            duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
            easing: ACTION_CARD_MORPH_EASING,
          }),
        },
      ],
    },
  };
}
