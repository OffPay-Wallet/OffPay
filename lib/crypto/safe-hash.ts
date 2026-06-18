import { hmac as nobleHmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { CryptoDigestAlgorithm } from 'expo-crypto';

type ExpoCryptoModule = typeof import('expo-crypto');

let expoCryptoModulePromise: Promise<ExpoCryptoModule | null> | null = null;

function loadExpoCrypto(): Promise<ExpoCryptoModule | null> {
  expoCryptoModulePromise ??= import('expo-crypto').catch((error: unknown) => {
    if (typeof require !== 'function') throw error;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-crypto') as ExpoCryptoModule;
  });

  return expoCryptoModulePromise.catch(() => null);
}

function normalizeDigestAlgorithm(algorithm: string): 'SHA256' | 'SHA384' | 'SHA512' {
  const normalized = algorithm.replace(/[-_]/g, '').toUpperCase();
  if (normalized !== 'SHA256' && normalized !== 'SHA384' && normalized !== 'SHA512') {
    throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  }
  return normalized;
}

function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === 'string' ? utf8ToBytes(input) : input;
}

function toArrayBufferBackedBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(input.byteLength);
  output.set(input);
  return output;
}

function digestWithNoble(
  algorithm: ReturnType<typeof normalizeDigestAlgorithm>,
  input: string | Uint8Array,
): Uint8Array {
  const bytes = toBytes(input);
  switch (algorithm) {
    case 'SHA256':
      return sha256(bytes);
    case 'SHA384':
      return sha384(bytes);
    case 'SHA512':
      return sha512(bytes);
  }
}

function toExpoDigestAlgorithm(
  algorithm: ReturnType<typeof normalizeDigestAlgorithm>,
): CryptoDigestAlgorithm {
  switch (algorithm) {
    case 'SHA256':
      return 'SHA-256' as CryptoDigestAlgorithm;
    case 'SHA384':
      return 'SHA-384' as CryptoDigestAlgorithm;
    case 'SHA512':
      return 'SHA-512' as CryptoDigestAlgorithm;
  }
}

function isUnavailableNativeDigest(bytes: Uint8Array): boolean {
  // The Expo Crypto test shim leaves the output buffer untouched. Treat that as
  // unavailable so tests and unsupported runtimes keep the same correctness path.
  return bytes.every((byte) => byte === 0);
}

export function digestBytes(algorithm: string, input: string | Uint8Array): Uint8Array {
  return digestWithNoble(normalizeDigestAlgorithm(algorithm), input);
}

export function digestHex(algorithm: string, input: string | Uint8Array): string {
  return bytesToHex(digestBytes(algorithm, input));
}

export async function digestBytesAsync(
  algorithm: string,
  input: string | Uint8Array,
): Promise<Uint8Array> {
  const normalized = normalizeDigestAlgorithm(algorithm);
  const bytes = toBytes(input);
  const expoCrypto = await loadExpoCrypto();

  if (typeof expoCrypto?.digest === 'function') {
    try {
      const nativeDigest = new Uint8Array(
        await expoCrypto.digest(toExpoDigestAlgorithm(normalized), toArrayBufferBackedBytes(bytes)),
      );
      if (!isUnavailableNativeDigest(nativeDigest)) {
        return nativeDigest;
      }
    } catch {
      // Fall through to the dependency-light noble implementation when the
      // native Expo module is unavailable, such as in Jest or unsupported runtimes.
    }
  }

  return digestWithNoble(normalized, bytes);
}

export function hmacSha256HexSafe(
  secret: string | Uint8Array,
  message: string | Uint8Array,
): string {
  return bytesToHex(nobleHmac(sha256, toBytes(secret), toBytes(message)));
}
