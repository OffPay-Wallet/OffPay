import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  FadeOutDown,
  FadeOutLeft,
  FadeOutRight,
  type WithSpringConfig,
} from 'react-native-reanimated';

/* --------------------------------------------------------------------------
 * SETTINGS MOTION STORYBOARD
 *
 *   0ms  interaction state commits; backdrop and surface motion start together
 *   0ms  no staging delay, no setTimeout, no requestAnimationFrame sequencing
 *  80ms  exiting content is gone
 * 100ms  fades and directional content morphs are settled
 * ~180ms spring-driven surfaces settle without blocking interaction
 * -------------------------------------------------------------------------- */

export const SETTINGS_MOTION = {
  fadeMs: 100,
  exitMs: 80,
  morphOffset: 8,
} as const;

const SETTINGS_SPRING_VALUES = {
  damping: 34,
  stiffness: 460,
  mass: 0.65,
} as const;

export const SETTINGS_SPRING: WithSpringConfig = SETTINGS_SPRING_VALUES;

export const SETTINGS_PRESS_SPRING: WithSpringConfig = {
  damping: 36,
  stiffness: 520,
  mass: 0.55,
};

export const SETTINGS_BACKDROP_ENTERING = FadeIn.duration(SETTINGS_MOTION.fadeMs).easing(
  Easing.out(Easing.cubic),
);
export const SETTINGS_BACKDROP_EXITING = FadeOut.duration(SETTINGS_MOTION.exitMs).easing(
  Easing.in(Easing.cubic),
);

export const SETTINGS_SURFACE_ENTERING = FadeInDown.springify()
  .damping(SETTINGS_SPRING_VALUES.damping)
  .stiffness(SETTINGS_SPRING_VALUES.stiffness)
  .mass(SETTINGS_SPRING_VALUES.mass)
  .withInitialValues({
    opacity: 0,
    transform: [{ translateY: SETTINGS_MOTION.morphOffset }],
  });

export const SETTINGS_SURFACE_EXITING = FadeOutDown.duration(SETTINGS_MOTION.exitMs).easing(
  Easing.in(Easing.cubic),
);

export const SETTINGS_FORWARD_ENTERING = FadeInRight.duration(SETTINGS_MOTION.fadeMs)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({
    opacity: 0,
    transform: [{ translateX: SETTINGS_MOTION.morphOffset }],
  });
export const SETTINGS_FORWARD_EXITING = FadeOutLeft.duration(SETTINGS_MOTION.exitMs).easing(
  Easing.in(Easing.cubic),
);

export const SETTINGS_BACK_ENTERING = FadeInLeft.duration(SETTINGS_MOTION.fadeMs)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({
    opacity: 0,
    transform: [{ translateX: -SETTINGS_MOTION.morphOffset }],
  });
export const SETTINGS_BACK_EXITING = FadeOutRight.duration(SETTINGS_MOTION.exitMs).easing(
  Easing.in(Easing.cubic),
);
