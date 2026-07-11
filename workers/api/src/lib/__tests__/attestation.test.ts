import { describe, expect, it } from '@jest/globals';

import { hasValidAndroidRequestBinding } from '../android-attestation-binding';

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
