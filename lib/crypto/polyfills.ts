/**
 * Crypto polyfills for React Native.
 * MUST be imported as the very first line in app/_layout.tsx
 * before any other imports that use crypto APIs.
 *
 * Provides:
 *  - crypto.getRandomValues (via react-native-get-random-values)
 *    Required by @scure/bip39 for secure mnemonic generation.
 *  - crypto.subtle.digest for SHA-256/SHA-384/SHA-512 and a minimal Ed25519
 *    WebCrypto surface required by Solana Kit PDA/address and signer helpers.
 *  - TextEncoder / TextDecoder via fast-text-encoding, required by
 *    `@privy-io/expo` and the libraries it depends on.
 *  - `@ethersproject/shims` so libraries that expect Node's Buffer + crypto
 *    surface keep working under Hermes.
 *  - Global `Buffer` for `@solana/web3.js` and Privy's wallet plumbing.
 *    Privy explicitly recommends this in their installation guide.
 */
import 'react-native-get-random-values';
import 'fast-text-encoding';
import { Buffer } from 'buffer';
import '@ethersproject/shims';

import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

// Make Buffer available everywhere. `@solana/web3.js`, `bs58`, and Privy's
// embedded-wallet plumbing all reach for it as a global. Setting it here,
// after `react-native-get-random-values` and `fast-text-encoding`, matches
// the order Privy documents at
// https://docs.privy.io/basics/react-native/installation.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

type Ed25519Module = typeof import('@noble/curves/ed25519.js');
type Ed25519Api = Ed25519Module['ed25519'];

// Defer evaluation of `@noble/curves/ed25519.js` until the first crypto.subtle
// call that needs it. Solana Kit's signer helpers go through these subtle
// methods, all of which are async, so taking an `await import(...)` hop here
// has no observable effect on those callers and shaves the curve module out
// of the cold-start critical path.
let ed25519Promise: Promise<Ed25519Api> | null = null;

function loadEd25519(): Promise<Ed25519Api> {
  ed25519Promise ??= import('@noble/curves/ed25519.js')
    .catch((error: unknown) => {
      if (typeof require !== 'function') throw error;
      return require('@noble/curves/ed25519.js') as Ed25519Module;
    })
    .then((module) => module.ed25519);
  return ed25519Promise;
}

type DigestAlgorithmIdentifier = string | { name?: string };
type CryptoWithPartialSubtle = Partial<Crypto> & { subtle?: Partial<SubtleCrypto> };
type OffpayEd25519CryptoKey = {
  __offpayEd25519CryptoKey: true;
  algorithm: { name: 'Ed25519' };
  extractable: boolean;
  type: 'private' | 'public';
  usages: KeyUsage[];
  privateKey?: Uint8Array;
  publicKey: Uint8Array;
};

const ED25519_PKCS8_HEADER = Uint8Array.from([
  48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32,
]);
const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBytes(data: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  return new Uint8Array(data);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

function normalizeDigestAlgorithm(algorithm: DigestAlgorithmIdentifier): string {
  const rawName = typeof algorithm === 'string' ? algorithm : algorithm.name;

  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw new Error('Digest algorithm name is required.');
  }

  return rawName.replace(/[-_]/g, '').toUpperCase();
}

function digestBytes(algorithm: DigestAlgorithmIdentifier, data: BufferSource): Uint8Array {
  const bytes = toBytes(data);

  switch (normalizeDigestAlgorithm(algorithm)) {
    case 'SHA256':
      return sha256(bytes);
    case 'SHA384':
      return sha384(bytes);
    case 'SHA512':
      return sha512(bytes);
    default:
      throw new Error(`Unsupported digest algorithm: ${String(algorithm)}`);
  }
}

function normalizeAlgorithmName(algorithm: AlgorithmIdentifier): string {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Algorithm name is required.');
  }

  return name.toUpperCase();
}

function assertEd25519Algorithm(algorithm: AlgorithmIdentifier): void {
  if (normalizeAlgorithmName(algorithm) !== 'ED25519') {
    throw new Error(`Unsupported key algorithm: ${String(algorithm)}`);
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;

    output += BASE64_URL_ALPHABET[(value >> 18) & 63];
    output += BASE64_URL_ALPHABET[(value >> 12) & 63];
    if (index + 1 < bytes.length) output += BASE64_URL_ALPHABET[(value >> 6) & 63];
    if (index + 2 < bytes.length) output += BASE64_URL_ALPHABET[value & 63];
  }

  return output;
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/=/g, '');
  const output: number[] = [];

  for (let index = 0; index < normalized.length; index += 4) {
    const chars = [
      BASE64_URL_ALPHABET.indexOf(normalized[index] ?? ''),
      BASE64_URL_ALPHABET.indexOf(normalized[index + 1] ?? ''),
      BASE64_URL_ALPHABET.indexOf(normalized[index + 2] ?? ''),
      BASE64_URL_ALPHABET.indexOf(normalized[index + 3] ?? ''),
    ];

    if (
      chars[0] < 0 ||
      chars[1] < 0 ||
      (normalized[index + 2] != null && chars[2] < 0) ||
      (normalized[index + 3] != null && chars[3] < 0)
    ) {
      throw new Error('Invalid base64url data.');
    }

    const first = chars[0];
    const second = chars[1];
    const third = chars[2] < 0 ? 0 : chars[2];
    const fourth = chars[3] < 0 ? 0 : chars[3];
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;

    output.push((combined >> 16) & 255);
    if (normalized[index + 2] != null) output.push((combined >> 8) & 255);
    if (normalized[index + 3] != null) output.push(combined & 255);
  }

  return Uint8Array.from(output);
}

function createPublicKey(
  publicKey: Uint8Array,
  extractable: boolean,
  usages: KeyUsage[],
): CryptoKey {
  if (publicKey.byteLength !== 32) {
    throw new Error(`Ed25519 public keys must be 32 bytes, got ${publicKey.byteLength}.`);
  }

  return {
    __offpayEd25519CryptoKey: true,
    algorithm: { name: 'Ed25519' },
    extractable,
    publicKey: Uint8Array.from(publicKey),
    type: 'public',
    usages: [...usages],
  } as unknown as CryptoKey;
}

async function createPrivateKey(
  privateKey: Uint8Array,
  extractable: boolean,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (privateKey.byteLength !== 32) {
    throw new Error(`Ed25519 private keys must be 32 bytes, got ${privateKey.byteLength}.`);
  }

  const ed25519 = await loadEd25519();

  return {
    __offpayEd25519CryptoKey: true,
    algorithm: { name: 'Ed25519' },
    extractable,
    privateKey: Uint8Array.from(privateKey),
    publicKey: Uint8Array.from(ed25519.getPublicKey(privateKey)),
    type: 'private',
    usages: [...usages],
  } as unknown as CryptoKey;
}

function isOffpayEd25519CryptoKey(key: CryptoKey): key is CryptoKey & OffpayEd25519CryptoKey {
  return (key as Partial<OffpayEd25519CryptoKey>).__offpayEd25519CryptoKey === true;
}

function assertOffpayEd25519CryptoKey(
  key: CryptoKey,
): asserts key is CryptoKey & OffpayEd25519CryptoKey {
  if (!isOffpayEd25519CryptoKey(key)) {
    throw new Error('Unsupported CryptoKey implementation.');
  }
}

async function importEd25519Key(
  format: KeyFormat,
  keyData: JsonWebKey | BufferSource,
  algorithm: AlgorithmIdentifier,
  extractable: boolean,
  keyUsages: readonly KeyUsage[],
): Promise<CryptoKey> {
  assertEd25519Algorithm(algorithm);

  if (format === 'raw') {
    return createPublicKey(toBytes(keyData as BufferSource), extractable, [...keyUsages]);
  }

  if (format === 'pkcs8') {
    const bytes = toBytes(keyData as BufferSource);
    const privateKey =
      bytes.byteLength === 32
        ? bytes
        : bytes.byteLength === ED25519_PKCS8_HEADER.byteLength + 32
          ? bytes.slice(ED25519_PKCS8_HEADER.byteLength)
          : null;

    if (privateKey == null) {
      throw new Error(`Unsupported Ed25519 PKCS#8 key length: ${bytes.byteLength}.`);
    }

    return createPrivateKey(privateKey, extractable, [...keyUsages]);
  }

  if (format === 'jwk') {
    const jwk = keyData as JsonWebKey;
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
      throw new Error('Unsupported Ed25519 JWK.');
    }

    if (typeof jwk.d === 'string' && keyUsages.includes('sign')) {
      return createPrivateKey(base64UrlDecode(jwk.d), extractable, [...keyUsages]);
    }

    return createPublicKey(base64UrlDecode(jwk.x), extractable, [...keyUsages]);
  }

  throw new Error(`Unsupported Ed25519 key format: ${format}.`);
}

function exportEd25519Key(format: KeyFormat, key: CryptoKey): JsonWebKey | ArrayBuffer {
  assertOffpayEd25519CryptoKey(key);

  if (!key.extractable) {
    throw new Error('CryptoKey is not extractable.');
  }

  if (format === 'raw') {
    if (key.type !== 'public') {
      throw new Error('Raw Ed25519 export requires a public key.');
    }

    return toArrayBuffer(key.publicKey);
  }

  if (format === 'pkcs8') {
    if (key.type !== 'private' || key.privateKey == null) {
      throw new Error('PKCS#8 Ed25519 export requires a private key.');
    }

    return toArrayBuffer(concatBytes(ED25519_PKCS8_HEADER, key.privateKey));
  }

  if (format === 'jwk') {
    const jwk: JsonWebKey = {
      crv: 'Ed25519',
      ext: key.extractable,
      key_ops: key.usages,
      kty: 'OKP',
      x: base64UrlEncode(key.publicKey),
    };

    if (key.type === 'private' && key.privateKey != null) {
      jwk.d = base64UrlEncode(key.privateKey);
    }

    return jwk;
  }

  throw new Error(`Unsupported Ed25519 export format: ${format}.`);
}

async function signEd25519(key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
  assertOffpayEd25519CryptoKey(key);

  if (key.type !== 'private' || key.privateKey == null) {
    throw new Error('Ed25519 signing requires a private key.');
  }

  const ed25519 = await loadEd25519();
  return toArrayBuffer(ed25519.sign(toBytes(data), key.privateKey));
}

async function verifyEd25519(
  key: CryptoKey,
  signature: BufferSource,
  data: BufferSource,
): Promise<boolean> {
  assertOffpayEd25519CryptoKey(key);

  const ed25519 = await loadEd25519();
  return ed25519.verify(toBytes(signature), toBytes(data), key.publicKey);
}

async function generateEd25519Key(
  extractable: boolean,
  keyUsages: readonly KeyUsage[],
): Promise<CryptoKeyPair> {
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const ed25519 = await loadEd25519();

  return {
    privateKey: await createPrivateKey(
      privateKeyBytes,
      extractable,
      keyUsages.filter((usage) => usage === 'sign'),
    ),
    publicKey: createPublicKey(
      ed25519.getPublicKey(privateKeyBytes),
      true,
      keyUsages.filter((usage) => usage === 'verify'),
    ),
  };
}

export function installSubtleDigestPolyfill(): void {
  const currentCrypto = globalThis.crypto as CryptoWithPartialSubtle | undefined;
  const cryptoTarget: CryptoWithPartialSubtle = currentCrypto ?? {};

  if (currentCrypto == null) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: cryptoTarget,
      writable: true,
    });
  }

  const subtleTarget: Partial<SubtleCrypto> = cryptoTarget.subtle ?? {};

  if (typeof subtleTarget.digest !== 'function') {
    Object.defineProperty(subtleTarget, 'digest', {
      configurable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) =>
        toArrayBuffer(digestBytes(algorithm, data)),
      writable: true,
    });
  }

  if (typeof subtleTarget.importKey !== 'function') {
    Object.defineProperty(subtleTarget, 'importKey', {
      configurable: true,
      value: (
        format: KeyFormat,
        keyData: JsonWebKey | BufferSource,
        algorithm: AlgorithmIdentifier,
        extractable: boolean,
        keyUsages: readonly KeyUsage[],
      ) => importEd25519Key(format, keyData, algorithm, extractable, keyUsages),
      writable: true,
    });
  }

  if (typeof subtleTarget.exportKey !== 'function') {
    Object.defineProperty(subtleTarget, 'exportKey', {
      configurable: true,
      value: async (format: KeyFormat, key: CryptoKey) => exportEd25519Key(format, key),
      writable: true,
    });
  }

  if (typeof subtleTarget.sign !== 'function') {
    Object.defineProperty(subtleTarget, 'sign', {
      configurable: true,
      value: (_algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) =>
        signEd25519(key, data),
      writable: true,
    });
  }

  if (typeof subtleTarget.verify !== 'function') {
    Object.defineProperty(subtleTarget, 'verify', {
      configurable: true,
      value: (
        _algorithm: AlgorithmIdentifier,
        key: CryptoKey,
        signature: BufferSource,
        data: BufferSource,
      ) => verifyEd25519(key, signature, data),
      writable: true,
    });
  }

  if (typeof subtleTarget.generateKey !== 'function') {
    Object.defineProperty(subtleTarget, 'generateKey', {
      configurable: true,
      value: (
        algorithm: AlgorithmIdentifier,
        extractable: boolean,
        keyUsages: readonly KeyUsage[],
      ) => {
        assertEd25519Algorithm(algorithm);
        return generateEd25519Key(extractable, keyUsages);
      },
      writable: true,
    });
  }

  Object.defineProperty(cryptoTarget, 'subtle', {
    configurable: true,
    enumerable: true,
    value: subtleTarget,
    writable: true,
  });
}

installSubtleDigestPolyfill();
