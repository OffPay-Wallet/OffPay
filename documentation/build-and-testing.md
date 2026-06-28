# Build And Testing

## Expo Go Compatibility

**This app cannot run in Expo Go.** It requires a development or production build because it uses native modules that are not included in the Expo Go client.

### Native Modules Requiring Custom Build

The following dependencies use native code that requires a custom native build:

| Package | Purpose | Native Requirement |
| --- | --- | --- |
| `@privy-io/expo` | Authentication & wallet | Native encryption, passkeys |
| `@privy-io/expo-native-extensions` | Privy extensions | Native crypto operations |
| `react-native-ble-manager` | Bluetooth LE | Native BLE APIs |
| `munim-bluetooth` | Bluetooth printer | Native BLE APIs |
| `react-native-passkeys` | WebAuthn passkeys | Android Credential Manager |
| `react-native-mmkv` | Key-value storage | Native storage engine |
| `react-native-nitro-modules` | Native bridge | TurboModules |
| `react-native-worklets` | Worklet runtime | Native threading |
| `lottie-react-native` | Lottie animations | Native animation engine |
| `expo-local-authentication` | Biometrics | Native biometric APIs |
| `expo-secure-store` | Secure storage | Native secure storage |

### Development Workflow

Instead of Expo Go, use:

1. **Development build** (recommended for local dev):
   ```bash
   npm run android  # Android native build
   npm run ios      # iOS native build
   ```

2. **EAS development client**:
   ```bash
   eas build --profile development --platform android
   eas build --profile development --platform ios
   ```

3. **Preview build** (Android APK):
   ```bash
   eas build --profile preview --platform android
   ```

4. **Production build** (Android App Bundle):
   ```bash
   eas build --profile production --platform android
   ```

5. **Local release artifacts**:
   ```bash
   npm run build:android:apk
   npm run build:android:aab
   ```

## Native Configuration

`app.config.ts` defines:

- app name `OffPay`, slug `offpay`, scheme `offpay`
- iOS bundle identifier `com.offpay.app`
- Android package `com.offpay.app`
- Expo new architecture enabled
- Bluetooth permissions for offline payment receipt transport
- EAS project `@offpay_app/offpay` with id `56dc74fa-f0b3-4927-86a5-00e2c7c8f417`

`eas.json` defines:

- `development`: internal development client using the EAS `development` environment
- `preview`: internal Android APK using the EAS `preview` environment
- `production`: Android app bundle for store distribution using the EAS `production` environment

Public client environment values should be configured in EAS environments instead of hardcoded in `eas.json`. Required client build variables are `EXPO_PUBLIC_OFFPAY_API_ORIGIN`, `EXPO_PUBLIC_OFFPAY_API_ALLOWED_ORIGINS`, `EXPO_PUBLIC_OFFPAY_AI_PROXY_URL`, `EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS`, `EXPO_PUBLIC_OFFPAY_ATTESTATION_MODE`, `EXPO_PUBLIC_PRIVY_APP_ID`, and `EXPO_PUBLIC_PRIVY_CLIENT_ID`.

## Build Profiles

```mermaid
flowchart LR
  Source["Client source"]
  ExpoConfig["app.config.ts"]
  EAS["eas.json"]
  Dev["development build"]
  Preview["preview APK"]
  Production["production profile"]

  Source --> ExpoConfig
  Source --> EAS
  EAS --> Dev
  EAS --> Preview
  EAS --> Production
```

## Verification Scripts

Available scripts from `package.json`:

| Script | Purpose |
| --- | --- |
| `npm test` | Jest tests with `--runInBand` |
| `npm run test:all` | project test runner |
| `npm run test:all:coverage` | project test runner with coverage |
| `npm run test:all:android` | project test runner with Android export path |
| `npm run lint` | Expo lint |
| `npm run typecheck` | TypeScript no-emit check |
| `npm run verify:hardening` | client hardening guard |
| `npm run build:android:apk` | local release APK for direct install testing |
| `npm run build:android:apk:arm64` | local release APK for arm64-only smoke testing |
| `npm run build:android:apk:size` | print local release APK size |
| `npm run build:android:aab` | local Android App Bundle for Play-style release checks |
| `npm run build:android:aab:size` | print local Android App Bundle size |

Server-starting scripts exist (`npm start`, `npm run android`, `npm run ios`, `npm run web`) and should only be run when local server execution is intended.

## Hardening Guard

`scripts/verify-client-hardening.js` checks current source files for:

- direct provider/RPC URLs outside allowed files
- non-test `fetch()` usage outside `lib/offpay-api-client.ts`
- source hygiene markers such as mock/stub/TODO patterns
- unstable Zustand selector patterns
- required gitignore entries for planning artifacts
- offline slot spend/reclaim authorization checks
