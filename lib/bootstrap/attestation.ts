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

export function getConfiguredOffpayAttestationAdapter(): OffpayAttestationAdapter {
  if (process.env.EXPO_PUBLIC_OFFPAY_ATTESTATION_MODE === 'prototype') {
    return prototypeBypassOffpayAttestationAdapter;
  }

  if (__DEV__ && Platform.OS === 'android') {
    return prototypeBypassOffpayAttestationAdapter;
  }

  return unsupportedOffpayAttestationAdapter;
}
