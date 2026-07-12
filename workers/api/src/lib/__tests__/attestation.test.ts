import { describe, expect, it } from '@jest/globals';

import { hasValidAndroidAppIntegrity } from '../android-app-integrity';
import { hasValidAndroidRequestBinding } from '../android-attestation-binding';

import type { Bindings } from '../types';

const PINNED_CERTIFICATE =
  '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF';

function productionBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    NODE_ENV: 'production',
    OFFPAY_ANDROID_DISTRIBUTION_MODE: 'sideload',
    OFFPAY_ANDROID_CERTIFICATE_SHA256_DIGESTS: PINNED_CERTIFICATE,
    OFFPAY_ANDROID_MIN_VERSION_CODE: '1',
    ...overrides,
  } as Bindings;
}

describe('Play Integrity app identity', () => {
  it('accepts a sideload verdict only when the package and signing certificate are pinned', () => {
    expect(
      hasValidAndroidAppIntegrity(productionBindings(), 'com.offpay.app', {
        appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
        packageName: 'com.offpay.app',
        versionCode: '1',
        certificateSha256Digest: [
          'ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8',
        ],
      }),
    ).toBe(true);
  });

  it.each([
    [
      'wrong package',
      {
        appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
        packageName: 'com.attacker.app',
        versionCode: '1',
        certificateSha256Digest: ['ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8'],
      },
    ],
    [
      'wrong signing certificate',
      {
        appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
        packageName: 'com.offpay.app',
        versionCode: '1',
        certificateSha256Digest: ['ERERERERERERERERERERERERERERERERERERERERERE'],
      },
    ],
    [
      'unevaluated app',
      {
        appRecognitionVerdict: 'UNEVALUATED',
        packageName: 'com.offpay.app',
        versionCode: '1',
        certificateSha256Digest: ['ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8'],
      },
    ],
  ])('rejects a %s', (_label, appIntegrity) => {
    expect(
      hasValidAndroidAppIntegrity(productionBindings(), 'com.offpay.app', appIntegrity),
    ).toBe(false);
  });

  it('keeps Google Play distribution fail-closed to PLAY_RECOGNIZED', () => {
    expect(
      hasValidAndroidAppIntegrity(
        productionBindings({ OFFPAY_ANDROID_DISTRIBUTION_MODE: 'google_play' }),
        'com.offpay.app',
        {
          appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
          packageName: 'com.offpay.app',
          versionCode: '1',
          certificateSha256Digest: ['ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8'],
        },
      ),
    ).toBe(false);
  });

  it('rejects a signed APK below the configured minimum version code', () => {
    expect(
      hasValidAndroidAppIntegrity(
        productionBindings({ OFFPAY_ANDROID_MIN_VERSION_CODE: '2' }),
        'com.offpay.app',
        {
          appRecognitionVerdict: 'UNRECOGNIZED_VERSION',
          packageName: 'com.offpay.app',
          versionCode: '1',
          certificateSha256Digest: ['ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8'],
        },
      ),
    ).toBe(false);
  });
});

describe('Play Integrity request binding', () => {
  const now = 1_780_000_000_000;
  const packageName = 'com.offpay.app';
  const expectedRequestHash = 'nonce-sha256-base64url';

  it('accepts a fresh Standard requestHash bound to the package and nonce', () => {
    expect(
      hasValidAndroidRequestBinding({
        packageName,
        expectedRequestHash,
        now,
        requestDetails: {
          requestPackageName: packageName,
          requestHash: expectedRequestHash,
          timestampMillis: String(now - 1_000),
        },
      }),
    ).toBe(true);
  });

  it('retains compatibility with a fresh classic nonce verdict', () => {
    expect(
      hasValidAndroidRequestBinding({
        packageName,
        expectedRequestHash,
        now,
        requestDetails: {
          requestPackageName: packageName,
          nonce: expectedRequestHash,
          timestampMillis: String(now),
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['wrong package', { requestPackageName: 'com.attacker.app', requestHash: expectedRequestHash, timestampMillis: String(now) }],
    ['wrong request hash', { requestPackageName: packageName, requestHash: 'wrong', timestampMillis: String(now) }],
    ['stale verdict', { requestPackageName: packageName, requestHash: expectedRequestHash, timestampMillis: String(now - 301_000) }],
  ])('rejects a %s', (_label, requestDetails) => {
    expect(
      hasValidAndroidRequestBinding({
        packageName,
        expectedRequestHash,
        now,
        requestDetails,
      }),
    ).toBe(false);
  });
});
