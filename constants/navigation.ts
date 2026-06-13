import type { NativeStackNavigationOptions } from 'expo-router';

import { colors } from '@/constants/colors';

/**
 * App-wide native stack options.
 *
 * Expo Router's Stack uses the native-stack implementation. Keep
 * transitions disabled globally: the app has custom heavy screens and
 * release Android devices were paying for stack animations while
 * hydration/provider work was still settling after app resume.
 */
export const globalScreenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  gestureEnabled: true,
  animation: 'none',
  animationTypeForReplace: 'pop',
  freezeOnBlur: true,
  contentStyle: { backgroundColor: colors.backgroundGradient.base },
};

export const holdingsScreenOptions: NativeStackNavigationOptions = globalScreenOptions;

export const advancedSwapScreenOptions: NativeStackNavigationOptions = globalScreenOptions;

export const privatePaymentScreenOptions: NativeStackNavigationOptions = {
  ...globalScreenOptions,
  gestureEnabled: false,
};

export const createWalletScreenOptions: NativeStackNavigationOptions = globalScreenOptions;
