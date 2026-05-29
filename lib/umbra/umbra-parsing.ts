import { Buffer } from 'buffer';

import bs58 from 'bs58';

/**
 * Pure parsing/byte-manipulation helpers used throughout the Umbra
 * adapters. Everything in this file is a leaf utility: no I/O, no
 * runtime dependencies, no SDK objects. Extracted from
 * `umbra-execution.ts` to keep the orchestrator focused on flow logic.
 */

export function isStatusBitSet(value: bigint, bitPosition: number): boolean {
  return (BigInt(value) & (1n << BigInt(bitPosition))) !== 0n;
}

export function byteArraysEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function getMapValueByStringKey<T>(map: ReadonlyMap<unknown, T>, key: string): T | undefined {
  const direct = map.get(key);
  if (direct !== undefined) return direct;

  for (const [candidateKey, value] of map.entries()) {
    if (String(candidateKey) === key) return value;
  }

  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function readCandidate(value: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
}

export function readNestedRecord(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  const candidate = readCandidate(value, keys);
  return isRecord(candidate) ? candidate : null;
}

export function readRequiredString(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): string {
  const candidate = readCandidate(value, keys);
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  throw new Error(`Umbra indexer response is missing ${label}.`);
}

export function readOptionalString(value: unknown, keys: readonly string[]): string | null {
  if (!isRecord(value)) return null;
  const candidate = readCandidate(value, keys);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export function readBigint(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`Umbra indexer response has invalid ${label}.`);
}

export function readRequiredBigint(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): bigint {
  return readBigint(readCandidate(value, keys), label);
}

export function getStringProperty(result: unknown, keys: readonly string[]): string | null {
  if (result == null || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function base64ToBytes(value: string, label: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'));
  if (bytes.length === 0 && value.length > 0) {
    throw new Error(`Umbra indexer response has invalid ${label}.`);
  }
  return bytes;
}

export function base64ToFixedBytes(value: string, length: number, label: string): Uint8Array {
  const bytes = base64ToBytes(value, label);
  if (bytes.length !== length) {
    throw new Error(`Umbra indexer response ${label} must be ${length} bytes.`);
  }
  return bytes;
}

export function decodeU128Le(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = 0; index < bytes.length; index += 1) {
    value += BigInt(bytes[index]) << (BigInt(index) * 8n);
  }
  return value;
}

export function encodeU128Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(16);
  let remaining = value;
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function encodeU128LeBytes(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 128n) {
    throw new RangeError('Value does not fit in U128');
  }
  return encodeU128Le(value);
}

export function splitAddressBase64(value: string, label: string): { low: bigint; high: bigint } {
  const bytes = base64ToFixedBytes(value, 32, label);
  return {
    low: decodeU128Le(bytes.slice(0, 16)),
    high: decodeU128Le(bytes.slice(16, 32)),
  };
}

export function h1AddressPartsToBase58(parts: { low: bigint; high: bigint }): string | null {
  try {
    const merged = new Uint8Array(32);
    merged.set(encodeU128Le(parts.low), 0);
    merged.set(encodeU128Le(parts.high), 16);
    if (merged.every((byte) => byte === 0)) return null;
    return bs58.encode(merged);
  } catch {
    return null;
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index].toString(16).padStart(2, '0');
  }
  return hex;
}

export function safeBigintToNumber(value: bigint): number | null {
  if (value < 0n) return null;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

export function bigintToSafeNumber(value: bigint, label: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${label} is too large for the OffPay Umbra proxy.`);
  }
  return numberValue;
}
