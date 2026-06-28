import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_NAME = 'OffPay';
const APP_SLUG = 'offpay';
const APP_VERSION = '1.0.0';
const APP_SCHEME = 'offpay';
const IOS_BUNDLE_IDENTIFIER = 'com.offpay.app';
const ANDROID_PACKAGE = 'com.offpay.app';
const APP_ICON_PATH = './assets/AppIcons/appstore.png';
const ANDROID_ICON_PATH = './assets/AppIcons/playstore.png';
const ANDROID_ADAPTIVE_ICON_FOREGROUND_PATH = './assets/AppIcons/playstore.png';
const ANDROID_SPLASH_DRAWABLE_PATH = './assets/splash-transparent.xml';
/** Matches colors.backgroundGradient.base from constants/colors.ts. */
const BRAND_BACKGROUND_COLOR = '#050505';
const ANDROID_ADAPTIVE_ICON_BACKGROUND_COLOR = '#000000';
const ANDROID_NOTIFICATION_COLOR = '#F7F7F2';
const ANDROID_PHONE_BUILD_ARCHS = ['armeabi-v7a', 'arm64-v8a'];

export default function appConfig(_context: ConfigContext): ExpoConfig {
  return {
    name: APP_NAME,
    slug: APP_SLUG,
    owner: 'offpay_app',
    version: APP_VERSION,
    orientation: 'portrait',
    icon: APP_ICON_PATH,
    scheme: APP_SCHEME,
    userInterfaceStyle: 'automatic',
    // newArchEnabled is configured via gradle.properties for compatibility
    backgroundColor: BRAND_BACKGROUND_COLOR,
    ios: {
      supportsTablet: true,
      icon: APP_ICON_PATH,
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      infoPlist: {
        NSBluetoothAlwaysUsageDescription:
          'OffPay uses Bluetooth to deliver offline payment receipts between nearby devices.',
        NSBluetoothPeripheralUsageDescription:
          'OffPay uses Bluetooth to receive offline payment receipts from nearby devices.',
        NSMicrophoneUsageDescription:
          'OffPay uses the microphone to let you speak commands to the Yuga assistant.',
      },
    },
    android: {
      package: ANDROID_PACKAGE,
      icon: ANDROID_ICON_PATH,
      adaptiveIcon: {
        backgroundColor: ANDROID_ADAPTIVE_ICON_BACKGROUND_COLOR,
        foregroundImage: ANDROID_ADAPTIVE_ICON_FOREGROUND_PATH,
        monochromeImage: ANDROID_ADAPTIVE_ICON_FOREGROUND_PATH,
      },
      permissions: [
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_ADMIN',
        'android.permission.BLUETOOTH_SCAN',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.BLUETOOTH_ADVERTISE',
        'android.permission.ACCESS_FINE_LOCATION',
        // Microphone for the Yuga voice assistant (Sarvam STT).
        'android.permission.RECORD_AUDIO',
        // Required by Privy passkey enrollment so Android Credential
        // Manager can bind a passkey to a biometric on supported
        // devices. Documented at
        // https://docs.privy.io/basics/android/advanced/setup-passkeys
        'android.permission.USE_BIOMETRIC',
      ],
      // Note: edgeToEdgeEnabled is set in gradle.properties instead
      // to maintain compatibility across Expo SDK versions
      predictiveBackGestureEnabled: false,
    },
    androidStatusBar: {
      backgroundColor: BRAND_BACKGROUND_COLOR,
      // Light icons (time, battery, signal) on the dark chrome — matches
      // `StatusBar style="light"` in the root layout and edge-to-edge.
      barStyle: 'light-content',
      translucent: true,
    },
    web: {
      output: 'static',
      favicon: ANDROID_ICON_PATH,
    },
    plugins: [
      'expo-router',
      'expo-asset',
      'expo-image',
      'expo-status-bar',
      [
        'expo-audio',
        {
          microphonePermission:
            'OffPay uses the microphone to let you speak commands to the Yuga assistant.',
        },
      ],
      [
        'expo-font',
        {
          // Embedding fonts at build time is materially faster than
          // calling `useFonts` at runtime: the bytes ship as native
          // assets, are mapped by the platform on launch, and never
          // block the splash hide. See
          // https://docs.expo.dev/develop/user-interface/fonts/.
          fonts: [
            './assets/fonts/Geist/ttf/Geist-Regular.ttf',
            './assets/fonts/Geist/ttf/Geist-Medium.ttf',
            './assets/fonts/Geist/ttf/Geist-SemiBold.ttf',
            './assets/fonts/Geist/ttf/Geist-Bold.ttf',
            './assets/fonts/GeistMono/ttf/GeistMono-Regular.ttf',
            './assets/fonts/GeistMono/ttf/GeistMono-Medium.ttf',
            './assets/fonts/GeistMono/ttf/GeistMono-SemiBold.ttf',
            './assets/fonts/Quicksand/static/Quicksand-Regular.ttf',
            './assets/fonts/Quicksand/static/Quicksand-SemiBold.ttf',
            './assets/fonts/Quicksand/static/Quicksand-Bold.ttf',
            './assets/fonts/cirka/Cirka-Light.otf',
            './assets/fonts/cirka/Cirka-Bold.otf',
          ],
        },
      ],
      [
        'expo-splash-screen',
        {
          backgroundColor: BRAND_BACKGROUND_COLOR,
          android: {
            backgroundColor: BRAND_BACKGROUND_COLOR,
            drawable: {
              icon: ANDROID_SPLASH_DRAWABLE_PATH,
            },
          },
          dark: {
            backgroundColor: BRAND_BACKGROUND_COLOR,
          },
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: false,
        },
      ],
      'expo-secure-store',
      [
        'expo-notifications',
        {
          // Local notifications only — no remote push tokens. The
          // plugin still needs to be present for the Android
          // notification channel and iOS entitlements to be wired.
          color: ANDROID_NOTIFICATION_COLOR,
        },
      ],
      [
        'react-native-ble-manager',
        {
          isBackgroundEnabled: false,
          neverForLocation: false,
          bluetoothAlwaysPermission:
            'OffPay uses Bluetooth to deliver offline payment receipts between nearby devices.',
        },
      ],
      // Required by `@privy-io/expo` so the SDK can open the OAuth
      // flow in a Custom Tab on Android. The plugin wires up the
      // intent filter on the Android manifest side.
      'expo-web-browser',
      [
        'expo-build-properties',
        {
          android: {
            // Build physical-device ARM slices only. Google Play gets an
            // AAB and serves device-specific APKs from it; local APKs use
            // this same ARM set for broad phone compatibility without
            // shipping emulator-only x86/x86_64 native binaries.
            buildArchs: ANDROID_PHONE_BUILD_ARCHS,
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            networkInspector: false,
          },
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '56dc74fa-f0b3-4927-86a5-00e2c7c8f417',
      },
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
}
