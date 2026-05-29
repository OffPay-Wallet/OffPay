import {
  getSecuritySettings,
  setFingerprintEnabled,
  setPasscode,
  verifyPasscode,
} from '@/lib/wallet/security-settings';

describe('security-settings', () => {
  const originalBuffer = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  beforeEach(() => {
    Object.defineProperty(globalThis, 'Buffer', {
      configurable: true,
      enumerable: false,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: {
        getRandomValues: (array: Uint8Array) => {
          array.set(Uint8Array.from({ length: array.length }, (_, index) => index + 1));
          return array;
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    if (originalBuffer == null) {
      delete (globalThis as { Buffer?: typeof Buffer }).Buffer;
    } else {
      Object.defineProperty(globalThis, 'Buffer', originalBuffer);
    }

    if (originalCrypto == null) {
      delete (globalThis as { crypto?: Crypto }).crypto;
    } else {
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  });

  it('saves and verifies a passcode without relying on a global Buffer', async () => {
    await setPasscode('123456');

    await expect(verifyPasscode('123456')).resolves.toBe(true);
    await expect(verifyPasscode('654321')).resolves.toBe(false);
    await expect(getSecuritySettings()).resolves.toMatchObject({ hasPasscode: true });
  });

  it('persists the fingerprint preference', async () => {
    await setFingerprintEnabled(true);
    await expect(getSecuritySettings()).resolves.toMatchObject({ fingerprintEnabled: true });

    await setFingerprintEnabled(false);
    await expect(getSecuritySettings()).resolves.toMatchObject({ fingerprintEnabled: false });
  });
});
