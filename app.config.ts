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
/** Matches colors.backgroundGradient.base from constants/colors.ts. */
const BRAND_BACKGROUND_COLOR = '#050505';
const ANDROID_ADAPTIVE_ICON_BACKGROUND_COLOR = '#000000';
const ANDROID_NOTIFICATION_COLOR = '#F7F7F2';
const DEFAULT_ANDROID_BUILD_ARCHS = ['arm64-v8a'];

function resolveAndroidBuildArchs(): string[] {
  const raw =
    process.env.OFFPAY_ANDROID_BUILD_ARCHS ??
    process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures ??
    '';
  const archs = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return archs.length > 0 ? archs : DEFAULT_ANDROID_BUILD_ARCHS;
}

export default function appConfig(_context: ConfigContext): ExpoConfig {
  const androidBuildArchs = resolveAndroidBuildArchs();

  return {
    name: APP_NAME,
    slug: APP_SLUG,
    owner: 'karn01',
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
            // APK builds should not ship unused emulator/legacy ABI
            // slices. EAS profiles can override this with
            // OFFPAY_ANDROID_BUILD_ARCHS when a universal test APK is
            // intentionally needed.
            buildArchs: androidBuildArchs,
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            enablePngCrunchInReleaseBuilds: true,
            packagingOptions: {
              exclude: [
                'META-INF/LICENSE',
                'META-INF/LICENSE.txt',
                'META-INF/LICENSE.md',
                'META-INF/NOTICE',
                'META-INF/NOTICE.txt',
                'META-INF/NOTICE.md',
                'META-INF/DEPENDENCIES',
                'META-INF/INDEX.LIST',
              ],
            },
            // react-native-passkeys requires Credential Manager,
            // which lives in androidx.credentials. The 1.2.x line
            // matches the version Privy's SDK is built against.
            extraMavenRepos: [],
            usePrecompiledHeaders: true,
          },
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '7a90d5e4-cb4d-4c23-927c-84cd72247cec',
      },
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  };
}
