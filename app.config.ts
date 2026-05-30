import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_NAME = 'OffPay';
const APP_SLUG = 'offpay';
const APP_VERSION = '1.0.0';
const APP_SCHEME = 'offpay';
const IOS_BUNDLE_IDENTIFIER = 'com.offpay.app';
const ANDROID_PACKAGE = 'com.offpay.app';
const APP_ICON_PATH = './assets/appIcons/ios/iTunesArtwork@2x.png';
const ANDROID_ICON_PATH = './assets/appIcons/android/playstore-icon.png';
const ANDROID_ADAPTIVE_FOREGROUND_PATH =
  './assets/appIcons/android/mipmap-xxxhdpi/ic_launcher_foreground.png';
/** Matches colors.backgroundGradient.base from constants/colors.ts — Arctic Mist */
const BRAND_BACKGROUND_COLOR = '#5BC8E8';
const ANDROID_ADAPTIVE_ICON_BACKGROUND_COLOR = '#ffffff';

export default function appConfig(_context: ConfigContext): ExpoConfig {
  return {
    name: APP_NAME,
    slug: APP_SLUG,
    owner: 'offpay_wallet',
    version: APP_VERSION,
    orientation: 'portrait',
    icon: APP_ICON_PATH,
    scheme: APP_SCHEME,
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
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
        foregroundImage: ANDROID_ADAPTIVE_FOREGROUND_PATH,
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
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    androidStatusBar: {
      backgroundColor: BRAND_BACKGROUND_COLOR,
    },
    web: {
      output: 'static',
      favicon: ANDROID_ICON_PATH,
    },
    plugins: [
      'expo-router',
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
          ],
        },
      ],
      // expo-splash-screen is a versioned default plugin: even when not
      // listed here, @expo/prebuild-config applies it during prebuild and
      // writes `Theme.App.SplashScreen` + a `splashscreen_logo` drawable.
      // We declare it explicitly so the brand background color is wired
      // consistently; the transparent icon and MainActivity overrides
      // are owned by the custom plugin below.
      //
      // ORDERING: our custom plugin must come AFTER `expo-splash-screen`
      // here because the `withMod` chain wraps in registration order:
      // the LATEST-registered mod runs FIRST, with the previous mod
      // exposed as `nextMod`. By being last in this list, our mod runs
      // last in the resolved chain and gets the final say on the splash
      // style and MainActivity contents.
      [
        'expo-splash-screen',
        {
          backgroundColor: BRAND_BACKGROUND_COLOR,
          android: {
            backgroundColor: BRAND_BACKGROUND_COLOR,
            drawable: {
              icon: './assets/splash-transparent.xml',
            },
          },
          dark: {
            backgroundColor: BRAND_BACKGROUND_COLOR,
          },
        },
      ],
      './plugins/with-transparent-android-splash-icon',
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
          color: BRAND_BACKGROUND_COLOR,
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
      './plugins/with-ble-scan-location-permission',
      // Required by `@privy-io/expo` so the SDK can open the OAuth
      // flow in a Custom Tab on Android. The plugin wires up the
      // intent filter on the Android manifest side.
      'expo-web-browser',
      // Pins the Android compile/min SDK and AndroidX flags Privy's
      // native modules expect. Privy's installation guide says this
      // is the easiest way to keep the manifest in sync without
      // manually editing the prebuild output.
      [
        'expo-build-properties',
        {
          android: {
            // Privy/react-native-passkeys rely on Android Credential
            // Manager APIs. Keep this explicit so prebuilds do not
            // fall below the SDK level required by the native module.
            compileSdkVersion: 36,
            // react-native-passkeys requires Credential Manager,
            // which lives in androidx.credentials. The 1.2.x line
            // matches the version Privy's SDK is built against.
            extraMavenRepos: [],
          },
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '91779995-1a31-4ae3-b840-52dcd24c1a30',
      },
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
}
