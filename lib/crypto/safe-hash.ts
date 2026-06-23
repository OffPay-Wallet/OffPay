import { hmac as nobleHmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

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
  return digestBytes(algorithm, input);
}

export function hmacSha256HexSafe(
  secret: string | Uint8Array,
  message: string | Uint8Array,
): string {
  return bytesToHex(nobleHmac(sha256, toBytes(secret), toBytes(message)));
}
