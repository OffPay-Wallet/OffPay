/**
 * SLIP-0010 Ed25519 HD key derivation — pure JS implementation.
 *
 * Replaces the `ed25519-hd-key` npm package which depends on Node.js `stream`
 * and cannot run in React Native.
 *
 * Uses @noble/hashes v2 (already a dep of @scure/bip39) for
 * HMAC-SHA512. No Node.js polyfills needed.
 *
 * Reference: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

/** Result of HD key derivation */
interface DerivedKey {
  /** 32-byte private key */
  key: Uint8Array;
  /** 32-byte chain code */
  chainCode: Uint8Array;
}

const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;

/**
 * Derive an Ed25519 private key from a seed using the SLIP-0010 standard.
 *
 * @param path — BIP44 derivation path, e.g. "m/44'/501'/0'/0'"
 * @param seedHex — hex-encoded seed (from BIP39 mnemonicToSeed)
 * @returns DerivedKey with the 32-byte private key
 */
export function derivePath(path: string, seedHex: string): DerivedKey {
  // Validate path format
  if (!path.startsWith('m')) {
    throw new Error(`Invalid derivation path: must start with "m"`);
  }

  // Parse path segments (skip the leading "m")
  const segments = path
    .split('/')
    .slice(1)
    .map((segment) => {
      const isHardened = segment.endsWith("'") || segment.endsWith('h');
      const index = parseInt(isHardened ? segment.slice(0, -1) : segment, 10);

      if (isNaN(index) || index < 0) {
        throw new Error(`Invalid path segment: ${segment}`);
      }

      // SLIP-0010 only supports hardened derivation for Ed25519
      if (!isHardened) {
        throw new Error(
          `Ed25519 only supports hardened derivation. Segment "${segment}" is not hardened.`,
        );
      }

      return index + HARDENED_OFFSET;
    });

  // Master key from seed
  const seedBytes = hexToBytes(seedHex);
  let derived = getMasterKeyFromSeed(seedBytes);

  // Derive each path segment
  for (const index of segments) {
    derived = deriveChild(derived, index);
  }

  return derived;
}

/**
 * Compute the master key from a BIP39 seed.
 * HMAC-SHA512(key="ed25519 seed", data=seed)
 */
function getMasterKeyFromSeed(seed: Uint8Array): DerivedKey {
  const I = hmac(sha512, ED25519_SEED_KEY, seed);
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

/**
 * Derive a child key (hardened only — per SLIP-0010 for Ed25519).
 * HMAC-SHA512(key=chainCode, data=0x00 || key || index)
 */
function deriveChild(parent: DerivedKey, index: number): DerivedKey {
  // data = 0x00 || parent.key (32 bytes) || index (4 bytes BE)
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parent.key, 1);
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;

  const I = hmac(sha512, parent.chainCode, data);
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

/**
 * Convert a hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const length = hex.length / 2;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i * 2}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}
