import * as LocalAuthentication from 'expo-local-authentication';

import { beginAppLockSuppression } from '@/lib/wallet/app-lock-suppression';

export interface BiometricAvailability {
  hasHardware: boolean;
  isEnrolled: boolean;
  isAvailable: boolean;
  label: string;
  unavailableReason: string | null;
}

export interface BiometricAuthResult {
  success: boolean;
  message: string | null;
}

function getAuthErrorMessage(error: LocalAuthentication.LocalAuthenticationError): string {
  switch (error) {
    case 'not_enrolled':
      return 'Set up fingerprint in device settings first.';
    case 'not_available':
    case 'passcode_not_set':
      return 'Fingerprint unlock is not available on this device.';
    case 'lockout':
      return 'Fingerprint unlock is temporarily locked. Use your passcode.';
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return 'Fingerprint unlock was cancelled.';
    case 'authentication_failed':
      return 'Fingerprint unlock failed. Try again or use your passcode.';
    default:
      return 'Unable to complete fingerprint unlock.';
  }
}

// `BiometricAvailability` does not change across launches. Cache the
// promise once per app session so the keypad's auto-prompt and any
// follow-up tap on the fingerprint key both reuse the same hardware
// probe — saves ~80-150 ms per opening on Android.
let availabilityPromise: Promise<BiometricAvailability> | null = null;

async function probeBiometricAvailability(): Promise<BiometricAvailability> {
  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const isAvailable = hasHardware && isEnrolled && hasFingerprint;
    const unavailableReason = !hasHardware
      ? 'This device does not expose fingerprint authentication.'
      : !hasFingerprint
        ? 'Fingerprint unlock is not available on this device.'
        : !isEnrolled
          ? 'No fingerprint is enrolled on this device.'
          : null;

    return {
      hasHardware,
      isEnrolled,
      isAvailable,
      label: 'Fingerprint',
      unavailableReason,
    };
  } catch {
    return {
      hasHardware: false,
      isEnrolled: false,
      isAvailable: false,
      label: 'Fingerprint',
      unavailableReason: 'Fingerprint unlock is not available right now.',
    };
  }
}

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  if (availabilityPromise == null) {
    availabilityPromise = probeBiometricAvailability().catch((error: unknown) => {
      // Drop the cached promise on failure so the next call retries.
      availabilityPromise = null;
      throw error;
    });
  }
  return availabilityPromise;
}

export async function authenticateWithBiometrics(params: {
  promptMessage: string;
  promptSubtitle?: string;
  promptDescription?: string;
}): Promise<BiometricAuthResult> {
  const availability = await getBiometricAvailability();
  if (!availability.isAvailable) {
    return {
      success: false,
      message: availability.unavailableReason ?? 'Fingerprint unlock is not available.',
    };
  }

  const releaseAppLockSuppression = beginAppLockSuppression();
  let result: LocalAuthentication.LocalAuthenticationResult;
  try {
    result = await LocalAuthentication.authenticateAsync({
      promptMessage: params.promptMessage,
      promptSubtitle: params.promptSubtitle,
      promptDescription: params.promptDescription,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: true,
      // Android shows an extra "Confirm" tap after the fingerprint
      // matches when `requireConfirmation` is true. Disabling it makes
      // the unlock feel instant. Strong-class biometrics still apply
      // because `biometricsSecurityLevel` is unchanged.
      requireConfirmation: false,
      biometricsSecurityLevel: 'strong',
    });
  } finally {
    releaseAppLockSuppression();
  }

  if (result.success) {
    return { success: true, message: null };
  }

  return { success: false, message: getAuthErrorMessage(result.error) };
}
