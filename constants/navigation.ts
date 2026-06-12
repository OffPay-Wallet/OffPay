import type { NativeStackNavigationOptions } from 'expo-router';

import { colors } from '@/constants/colors';

/**
 * App-wide native stack options.
 *
 * Expo Router's Stack uses the native-stack implementation, so push,
 * pop, and gesture-back transitions run on the platform navigation
 * layer instead of the JS thread. `ios_from_right` gives Android the
 * same right-to-left iOS-style push while resolving to the native
 * default on iOS.
 */
export const globalScreenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  gestureEnabled: true,
  animation: 'ios_from_right',
  animationTypeForReplace: 'push',
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
