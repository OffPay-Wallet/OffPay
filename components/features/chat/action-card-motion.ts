import { Easing, withTiming } from 'react-native-reanimated';

import type {
  EntryAnimationsValues,
  ExitAnimationsValues,
  LayoutAnimation,
} from 'react-native-reanimated';

export const ACTION_CARD_MORPH_OPEN_DURATION_MS = 340;
export const ACTION_CARD_MORPH_CLOSE_DURATION_MS = 240;
export const ACTION_CARD_MORPH_EASING = Easing.bezier(0.16, 1, 0.3, 1);

const ACTION_CARD_MORPH_FADE_IN_DURATION_MS = 190;
const ACTION_CARD_MORPH_FADE_OUT_DURATION_MS = 150;
const ACTION_CARD_MORPH_TRANSLATE_Y = 30;
const ACTION_CARD_MORPH_SCALE_X = 0.965;
const ACTION_CARD_MORPH_SCALE_Y = 0.985;
const ACTION_CARD_MORPH_START_RADIUS = 20;
const ACTION_CARD_MORPH_EXIT_EASING = Easing.bezier(0.4, 0, 1, 1);
const ACTION_CARD_FADE_EASING = Easing.out(Easing.quad);
const ACTION_CARD_EXIT_FADE_EASING = Easing.in(Easing.quad);
const ACTION_CARD_SUMMARY_ENTER_DURATION_MS = 260;
const ACTION_CARD_SUMMARY_EXIT_DURATION_MS = 170;
const ACTION_CARD_SUMMARY_TRANSLATE_Y = 14;
const ACTION_CARD_SUMMARY_EXIT_TRANSLATE_Y = 7;
const ACTION_CARD_SUMMARY_SCALE = 0.985;

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
        { scaleY: ACTION_CARD_MORPH_SCALE_Y },
      ],
    },
    animations: {
      opacity: withTiming(1, {
        duration: ACTION_CARD_MORPH_FADE_IN_DURATION_MS,
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
        {
          scaleY: withTiming(1, {
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
      transform: [{ translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }],
    },
    animations: {
      opacity: withTiming(0, {
        duration: ACTION_CARD_MORPH_FADE_OUT_DURATION_MS,
        easing: ACTION_CARD_EXIT_FADE_EASING,
      }),
      height: withTiming(0, {
        duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
        easing: ACTION_CARD_MORPH_EXIT_EASING,
      }),
      borderRadius: withTiming(ACTION_CARD_MORPH_START_RADIUS, {
        duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
        easing: ACTION_CARD_MORPH_EXIT_EASING,
      }),
      transform: [
        {
          translateY: withTiming(ACTION_CARD_MORPH_TRANSLATE_Y, {
            duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
            easing: ACTION_CARD_MORPH_EXIT_EASING,
          }),
        },
        {
          scaleX: withTiming(ACTION_CARD_MORPH_SCALE_X, {
            duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
            easing: ACTION_CARD_MORPH_EXIT_EASING,
          }),
        },
        {
          scaleY: withTiming(ACTION_CARD_MORPH_SCALE_Y, {
            duration: ACTION_CARD_MORPH_CLOSE_DURATION_MS,
            easing: ACTION_CARD_MORPH_EXIT_EASING,
          }),
        },
      ],
    },
  };
}

export function actionCardSummaryEnter(): LayoutAnimation {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [
        { translateY: ACTION_CARD_SUMMARY_TRANSLATE_Y },
        { scale: ACTION_CARD_SUMMARY_SCALE },
      ],
    },
    animations: {
      opacity: withTiming(1, {
        duration: ACTION_CARD_SUMMARY_ENTER_DURATION_MS,
        easing: ACTION_CARD_FADE_EASING,
      }),
      transform: [
        {
          translateY: withTiming(0, {
            duration: ACTION_CARD_SUMMARY_ENTER_DURATION_MS,
            easing: ACTION_CARD_MORPH_EASING,
          }),
        },
        {
          scale: withTiming(1, {
            duration: ACTION_CARD_SUMMARY_ENTER_DURATION_MS,
            easing: ACTION_CARD_MORPH_EASING,
          }),
        },
      ],
    },
  };
}

export function actionCardSummaryExit(): LayoutAnimation {
  'worklet';
  return {
    initialValues: {
      opacity: 1,
      transform: [{ translateY: 0 }, { scale: 1 }],
    },
    animations: {
      opacity: withTiming(0, {
        duration: ACTION_CARD_SUMMARY_EXIT_DURATION_MS,
        easing: ACTION_CARD_EXIT_FADE_EASING,
      }),
      transform: [
        {
          translateY: withTiming(ACTION_CARD_SUMMARY_EXIT_TRANSLATE_Y, {
            duration: ACTION_CARD_SUMMARY_EXIT_DURATION_MS,
            easing: ACTION_CARD_MORPH_EXIT_EASING,
          }),
        },
        {
          scale: withTiming(ACTION_CARD_SUMMARY_SCALE, {
            duration: ACTION_CARD_SUMMARY_EXIT_DURATION_MS,
            easing: ACTION_CARD_MORPH_EXIT_EASING,
          }),
        },
      ],
    },
  };
}
