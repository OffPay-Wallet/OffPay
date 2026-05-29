import * as SecureStore from 'expo-secure-store';
import { sha256 } from '@noble/hashes/sha2.js';

const KEYS = {
  FINGERPRINT_ENABLED: 'offpay_security_fingerprint_enabled',
  PASSCODE_SALT_HEX: 'offpay_security_passcode_salt_hex',
  PASSCODE_HASH_HEX: 'offpay_security_passcode_hash_hex',
  WALLET_LOCKED: 'offpay_security_wallet_locked',
} as const;

const HEX_BYTE = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'));

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += HEX_BYTE[byte];
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[\da-f]*$/i.test(hex)) throw new Error('Invalid hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let offset = 0; offset < hex.length; offset += 2) {
    bytes[offset / 2] = Number.parseInt(hex.slice(offset, offset + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}

function isValidPasscode(passcode: string): boolean {
  return /^\d{6}$/.test(passcode);
}

function hashPasscode(passcode: string, saltHex: string): string {
  const saltBytes = hexToBytes(saltHex);
  const passBytes = new TextEncoder().encode(passcode);
  const input = new Uint8Array(saltBytes.length + passBytes.length);
  input.set(saltBytes, 0);
  input.set(passBytes, saltBytes.length);
  return bytesToHex(sha256(input));
}

export interface SecuritySettingsSnapshot {
  fingerprintEnabled: boolean;
  hasPasscode: boolean;
  walletLocked: boolean;
}

// In-memory cache for `getSecuritySettings` results. SecureStore reads
// are JNI/Keychain hops and end up on the hot path — wallet hydration
// and the lock gate both call them several times per launch. The cache
// is short-lived (5 s) and explicitly invalidated whenever a writer
// mutates one of the underlying entries.
const SECURITY_SETTINGS_TTL_MS = 5_000;
let cachedSecuritySettings: { value: SecuritySettingsSnapshot; expiresAt: number } | null = null;

function invalidateSecuritySettingsCache(): void {
  cachedSecuritySettings = null;
}

export async function getSecuritySettings(): Promise<SecuritySettingsSnapshot> {
  const now = Date.now();
  if (cachedSecuritySettings != null && now < cachedSecuritySettings.expiresAt) {
    return cachedSecuritySettings.value;
  }

  const [fingerprintRaw, hash, lockedRaw] = await Promise.all([
    SecureStore.getItemAsync(KEYS.FINGERPRINT_ENABLED),
    SecureStore.getItemAsync(KEYS.PASSCODE_HASH_HEX),
    SecureStore.getItemAsync(KEYS.WALLET_LOCKED),
  ]);

  const value: SecuritySettingsSnapshot = {
    fingerprintEnabled: fingerprintRaw === '1',
    hasPasscode: hash != null && hash.length > 0,
    walletLocked: lockedRaw === '1',
  };
  cachedSecuritySettings = { value, expiresAt: now + SECURITY_SETTINGS_TTL_MS };
  return value;
}

export async function setFingerprintEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(KEYS.FINGERPRINT_ENABLED, '1', OPTIONS);
  } else {
    await SecureStore.setItemAsync(KEYS.FINGERPRINT_ENABLED, '0', OPTIONS);
  }
  invalidateSecuritySettingsCache();
}

export async function setPasscode(passcode: string): Promise<void> {
  if (!isValidPasscode(passcode)) throw new Error('Passcode must be 6 digits');
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = bytesToHex(salt);
  const hashHex = hashPasscode(passcode, saltHex);

  await SecureStore.setItemAsync(KEYS.PASSCODE_SALT_HEX, saltHex, OPTIONS);
  await SecureStore.setItemAsync(KEYS.PASSCODE_HASH_HEX, hashHex, OPTIONS);
  invalidateSecuritySettingsCache();
  invalidatePasscodeCache();
}

export async function clearPasscode(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.PASSCODE_SALT_HEX),
    SecureStore.deleteItemAsync(KEYS.PASSCODE_HASH_HEX),
  ]);
  invalidateSecuritySettingsCache();
  invalidatePasscodeCache();
}

export async function clearSecuritySettings(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.FINGERPRINT_ENABLED),
    SecureStore.deleteItemAsync(KEYS.PASSCODE_SALT_HEX),
    SecureStore.deleteItemAsync(KEYS.PASSCODE_HASH_HEX),
    SecureStore.deleteItemAsync(KEYS.WALLET_LOCKED),
  ]);
  invalidateSecuritySettingsCache();
  invalidatePasscodeCache();
}

// Passcode salt/hash never change without going through the writers
// below. Caching them in memory turns each digit submission verify
// from two SecureStore reads into a single sha256 — keeping the
// 6th-digit feedback below ~5 ms.
const PASSCODE_CACHE_TTL_MS = 60_000;
let cachedPasscodeMaterial: {
  saltHex: string;
  storedHash: string;
  expiresAt: number;
} | null = null;

function invalidatePasscodeCache(): void {
  cachedPasscodeMaterial = null;
}

async function getPasscodeMaterial(): Promise<{ saltHex: string; storedHash: string } | null> {
  const now = Date.now();
  if (cachedPasscodeMaterial != null && now < cachedPasscodeMaterial.expiresAt) {
    return {
      saltHex: cachedPasscodeMaterial.saltHex,
      storedHash: cachedPasscodeMaterial.storedHash,
    };
  }

  const [saltHex, storedHash] = await Promise.all([
    SecureStore.getItemAsync(KEYS.PASSCODE_SALT_HEX),
    SecureStore.getItemAsync(KEYS.PASSCODE_HASH_HEX),
  ]);
  if (saltHex == null || storedHash == null) return null;

  cachedPasscodeMaterial = {
    saltHex,
    storedHash,
    expiresAt: now + PASSCODE_CACHE_TTL_MS,
  };
  return { saltHex, storedHash };
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  if (!isValidPasscode(passcode)) return false;
  const material = await getPasscodeMaterial();
  if (material == null) return false;
  const computed = hashPasscode(passcode, material.saltHex);
  return constantTimeEqual(computed, material.storedHash);
}

export async function setWalletLocked(locked: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEYS.WALLET_LOCKED, locked ? '1' : '0', OPTIONS);
  invalidateSecuritySettingsCache();
}

export async function isWalletLocked(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(KEYS.WALLET_LOCKED);
  return raw === '1';
}
