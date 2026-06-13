const IS_ANDROID = process.env.EXPO_OS === 'android';

export const SWAP_PANEL_SHADOW = IS_ANDROID
  ? undefined
  : '0 18px 42px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.14)';

export const SWAP_CONTROL_SHADOW = IS_ANDROID
  ? undefined
  : '0 14px 30px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14)';
