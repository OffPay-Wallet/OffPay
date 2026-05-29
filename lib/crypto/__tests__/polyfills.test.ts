import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

import { installSubtleDigestPolyfill } from '@/lib/crypto/polyfills';

describe('polyfills', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  afterEach(() => {
    if (originalCrypto == null) {
      delete (globalThis as { crypto?: Crypto }).crypto;
      return;
    }

    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  });

  it('installs a SHA digest implementation without replacing getRandomValues', async () => {
    const getRandomValues = jest.fn((array: Uint8Array) => array);

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: { getRandomValues },
      writable: true,
    });

    installSubtleDigestPolyfill();

    const input = Uint8Array.from([1, 2, 3]);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', input);

    expect(new Uint8Array(digest)).toEqual(sha256(input));
    expect(globalThis.crypto.getRandomValues).toBe(getRandomValues);
  });

  it('respects an existing native digest implementation', async () => {
    const digest = jest.fn(async () => new ArrayBuffer(1));

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: { subtle: { digest } },
      writable: true,
    });

    installSubtleDigestPolyfill();

    await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from([1]));

    expect(digest).toHaveBeenCalledTimes(1);
    expect(typeof globalThis.crypto.subtle.importKey).toBe('function');
  });

  it('supports Solana Kit Ed25519 keypair signing when WebCrypto is missing', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: {
        getRandomValues: (array: Uint8Array) => {
          array.fill(7);
          return array;
        },
      },
      writable: true,
    });

    installSubtleDigestPolyfill();

    const {
      createKeyPairSignerFromPrivateKeyBytes,
    } = require('@solana/kit') as typeof import('@solana/kit');
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const publicKey = ed25519.getPublicKey(seed);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
    const message = Object.freeze({ content: Uint8Array.from([9, 8, 7]), signatures: {} });
    const [signatureMap] = await signer.signMessages([message]);
    const signature = signatureMap[signer.address];

    expect(signer.address).toBe(bs58.encode(publicKey));
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(ed25519.verify(signature, message.content, publicKey)).toBe(true);
  });
});
