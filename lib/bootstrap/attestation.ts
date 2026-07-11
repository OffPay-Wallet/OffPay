import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { Platform } from 'react-native';

import type { BootstrapProvisionBody } from '@/types/offpay-api';

const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export type OffpayBootstrapPlatform = BootstrapProvisionBody['platform'];

export type OffpayBootstrapAttestation =
  | {
      platform: 'ios';
      attestationToken: string;
      attestationKeyId: string;
    }
  | {
      platform: 'android';
      attestationToken: string;
    }
  | {
      platform: 'android';
      prototypeBypass: true;
    };

export interface OffpayAttestationRequest {
  nonce: string;
  nonceHashBase64Url: string;
  platform: OffpayBootstrapPlatform;
}

export interface OffpayAttestationAdapter {
  collectAttestation(request: OffpayAttestationRequest): Promise<OffpayBootstrapAttestation>;
}

interface ExpoAppIntegrityModule {
  readonly isSupported: boolean;
  attestKeyAsync(keyId: string, challenge: string): Promise<string>;
  generateKeyAsync(): Promise<string>;
  prepareIntegrityTokenProviderAsync(cloudProjectNumber: string): Promise<void>;
  requestIntegrityCheckAsync(requestHash: string): Promise<string>;
}

type ExpoAppIntegrityLoader = () => Promise<ExpoAppIntegrityModule>;

export class OffpayAttestationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffpayAttestationUnavailableError';
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let output = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output += BASE64_URL_ALPHABET[(value >> 18) & 63];
    output += BASE64_URL_ALPHABET[(value >> 12) & 63];
    output += BASE64_URL_ALPHABET[(value >> 6) & 63];
    output += BASE64_URL_ALPHABET[value & 63];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const value = bytes[i] << 16;
    output += BASE64_URL_ALPHABET[(value >> 18) & 63];
    output += BASE64_URL_ALPHABET[(value >> 12) & 63];
  } else if (remaining === 2) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8);
    output += BASE64_URL_ALPHABET[(value >> 18) & 63];
    output += BASE64_URL_ALPHABET[(value >> 12) & 63];
    output += BASE64_URL_ALPHABET[(value >> 6) & 63];
  }

  return output;
}

export function buildAndroidIntegrityNonceHash(nonce: string): string {
  return bytesToBase64Url(sha256(utf8ToBytes(nonce)));
}

export function getBootstrapPlatform(): OffpayBootstrapPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';

  throw new OffpayAttestationUnavailableError('OffPay bootstrap requires iOS or Android.');
}

export const unsupportedOffpayAttestationAdapter: OffpayAttestationAdapter = {
  async collectAttestation(request) {
    if (request.platform === 'ios') {
      throw new OffpayAttestationUnavailableError(
        'iOS App Attest is not wired in this build.',
      );
    }

    throw new OffpayAttestationUnavailableError(
      'Android Play Integrity is not wired in this build.',
    );
  },
};

export function createAndroidPrototypeBypassAttestationAdapter(): OffpayAttestationAdapter {
  return {
    async collectAttestation(request) {
      if (request.platform !== 'android') {
        throw new OffpayAttestationUnavailableError(
          'Prototype attestation bypass is only valid for Android builds.',
        );
      }

      return {
        platform: 'android',
        prototypeBypass: true,
      };
    },
  };
}

export const prototypeBypassOffpayAttestationAdapter =
  createAndroidPrototypeBypassAttestationAdapter();

let preparedAndroidProjectNumber: string | null = null;
let androidProviderPreparation: {
  projectNumber: string;
  promise: Promise<void>;
} | null = null;

function getGoogleCloudProjectNumber(): string {
  const projectNumber = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER?.trim() ?? '';
  if (!/^\d{6,20}$/.test(projectNumber)) {
    throw new OffpayAttestationUnavailableError(
      'EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER must be configured for Play Integrity.',
    );
  }
  return projectNumber;
}

function isInvalidIntegrityProviderError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error != null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'ERR_APP_INTEGRITY_PROVIDER_INVALID' ||
    message.includes('ERR_APP_INTEGRITY_PROVIDER_INVALID')
  );
}

function resetAndroidIntegrityProvider(): void {
  preparedAndroidProjectNumber = null;
  androidProviderPreparation = null;
}

async function prepareAndroidIntegrityProvider(
  appIntegrity: ExpoAppIntegrityModule,
  projectNumber: string,
): Promise<void> {
  if (preparedAndroidProjectNumber === projectNumber) return;

  if (androidProviderPreparation?.projectNumber !== projectNumber) {
    const promise = appIntegrity
      .prepareIntegrityTokenProviderAsync(projectNumber)
      .then(() => {
        preparedAndroidProjectNumber = projectNumber;
      })
      .catch((error: unknown) => {
        if (androidProviderPreparation?.projectNumber === projectNumber) {
          resetAndroidIntegrityProvider();
        }
        throw error;
      });
    androidProviderPreparation = { projectNumber, promise };
  }

  await androidProviderPreparation.promise;
}

async function collectAndroidIntegrity(
  appIntegrity: ExpoAppIntegrityModule,
  requestHash: string,
): Promise<OffpayBootstrapAttestation> {
  const projectNumber = getGoogleCloudProjectNumber();
  await prepareAndroidIntegrityProvider(appIntegrity, projectNumber);

  try {
    return {
      platform: 'android',
      attestationToken: await appIntegrity.requestIntegrityCheckAsync(requestHash),
    };
  } catch (error) {
    if (!isInvalidIntegrityProviderError(error)) throw error;

    resetAndroidIntegrityProvider();
    await prepareAndroidIntegrityProvider(appIntegrity, projectNumber);
    return {
      platform: 'android',
      attestationToken: await appIntegrity.requestIntegrityCheckAsync(requestHash),
    };
  }
}

async function loadExpoAppIntegrity(): Promise<ExpoAppIntegrityModule> {
  return import('@expo/app-integrity');
}

export function createExpoAppIntegrityAttestationAdapter(
  loader: ExpoAppIntegrityLoader = loadExpoAppIntegrity,
): OffpayAttestationAdapter {
  return {
    async collectAttestation(request) {
      let appIntegrity: ExpoAppIntegrityModule;
      try {
        appIntegrity = await loader();
      } catch (error) {
        throw new OffpayAttestationUnavailableError(
          `App integrity module is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (request.platform === 'android') {
        try {
          return await collectAndroidIntegrity(appIntegrity, request.nonceHashBase64Url);
        } catch (error) {
          if (error instanceof OffpayAttestationUnavailableError) throw error;
          throw new OffpayAttestationUnavailableError(
            `Play Integrity check failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (!appIntegrity.isSupported) {
        throw new OffpayAttestationUnavailableError(
          'Apple App Attest is not supported on this device.',
        );
      }

      try {
        const attestationKeyId = await appIntegrity.generateKeyAsync();
        const attestationToken = await appIntegrity.attestKeyAsync(
          attestationKeyId,
          request.nonce,
        );
        return {
          platform: 'ios',
          attestationKeyId,
          attestationToken,
        };
      } catch (error) {
        throw new OffpayAttestationUnavailableError(
          `Apple App Attest failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

export const expoAppIntegrityAttestationAdapter =
  createExpoAppIntegrityAttestationAdapter();

export function getConfiguredOffpayAttestationAdapter(): OffpayAttestationAdapter {
  if (
    __DEV__ &&
    Platform.OS === 'android' &&
    process.env.EXPO_PUBLIC_OFFPAY_ATTESTATION_MODE === 'prototype'
  ) {
    return prototypeBypassOffpayAttestationAdapter;
  }

  if (__DEV__ && Platform.OS === 'android') {
    return prototypeBypassOffpayAttestationAdapter;
  }

  return expoAppIntegrityAttestationAdapter;
}
