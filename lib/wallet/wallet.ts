/**
 * Solana wallet service — real BIP39 mnemonic + Ed25519 key derivation.
 *
 * Security model (matching Phantom / Backpack):
 *  - Mnemonic generated from cryptographically secure entropy
 *  - HD derivation path m/44'/501'/0'/0' (Solana standard)
 *  - Private keys exist in JS memory only during derivation
 *  - After derivation, secrets are stored via secure-wallet-store.ts
 *    (iOS Keychain / Android EncryptedSharedPreferences)
 *  - No private key material in logs, analytics, or error reports
 *
 * Dependencies (all pure JS, zero Node.js polyfills):
 *  - @scure/bip39 (audited BIP39 implementation)
 *  - @noble/curves/ed25519 (Ed25519 public key derivation)
 *  - lib/ed25519-hd-key (pure JS SLIP-0010 derivation via @noble/hashes)
 *  - bs58 (Base58 encoding for Solana addresses)
 */
import { derivePath } from '@/lib/wallet/ed25519-hd-key';
import { mark, measure } from '@/lib/perf/perf-marks';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import bs58 from 'bs58';

import type { PrivateKeyWalletData, RecoveryWordCount, WalletData } from '@/types/wallet';

/** Solana BIP44 derivation path — standard used by Phantom, Solflare, Backpack */
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

/** Entropy bits: 128 = 12 words, 256 = 24 words */
const ENTROPY_BITS: Record<RecoveryWordCount, 128 | 256> = {
  12: 128,
  24: 256,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a new Solana wallet from cryptographically secure entropy.
 *
 * @param wordCount — 12 or 24 words
 * @returns WalletData with mnemonic, public key, and derivation path
 */
export async function generateWallet(wordCount: RecoveryWordCount): Promise<WalletData> {
  // 1. Generate BIP39 mnemonic from crypto-secure entropy
  const mnemonic = bip39.generateMnemonic(wordlist, ENTROPY_BITS[wordCount]);

  // 2. Derive keypair from mnemonic
  const { publicKeyBase58, secretKey } = await deriveKeypairFromMnemonic(mnemonic);

  try {
    return {
      publicKey: publicKeyBase58,
      mnemonic,
      derivationPath: SOLANA_DERIVATION_PATH,
    };
  } finally {
    // Best-effort zeroing of secret key material in memory
    zeroOutKey(secretKey);
  }
}

/**
 * Restore a wallet from a BIP39 mnemonic phrase.
 *
 * @param mnemonic — space-separated BIP39 words (12 or 24)
 * @throws Error if mnemonic is invalid
 */
export async function restoreWalletFromMnemonic(mnemonic: string): Promise<WalletData> {
  const normalized = normalizeMnemonic(mnemonic);

  // Validate before derivation
  if (!validateMnemonic(normalized)) {
    throw new Error('Invalid recovery phrase. Please check your words and try again.');
  }

  const { publicKeyBase58, secretKey } = await deriveKeypairFromMnemonic(normalized);

  try {
    return {
      publicKey: publicKeyBase58,
      mnemonic: normalized,
      derivationPath: SOLANA_DERIVATION_PATH,
    };
  } finally {
    zeroOutKey(secretKey);
  }
}

/**
 * Import a wallet from a raw private key.
 *
 * Accepts:
 *  - Base58-encoded 64-byte secret key (standard Solana format: secret + public)
 *  - Base58-encoded 32-byte seed (just the private scalar)
 *  - JSON array of bytes (e.g. from Solana CLI)
 *
 * @throws Error if the key is invalid
 */
export function restoreWalletFromPrivateKey(privateKeyInput: string): PrivateKeyWalletData {
  const trimmed = privateKeyInput.trim();

  try {
    let seed: Uint8Array | null = null;
    let keyBytes: Uint8Array | null = null;
    let decoded: Uint8Array | null = null;

    try {
      // Try JSON array format first (e.g. [12,34,56,...])
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        let bytes: unknown;
        try {
          bytes = JSON.parse(trimmed);
        } catch {
          throw new Error('Invalid JSON key array. Please check the format.');
        }
        if (!Array.isArray(bytes) || bytes.length === 0) {
          throw new Error('Invalid key array');
        }
        // Validate each value is an integer in [0, 255]
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i] as number;
          if (!Number.isInteger(b) || b < 0 || b > 255) {
            throw new Error(`Invalid byte value at index ${i}: ${String(b)}`);
          }
        }
        keyBytes = Uint8Array.from(bytes as number[]);
        // Extract 32-byte seed from either 32-byte or 64-byte input
        seed = keyBytes.length === 64 ? keyBytes.slice(0, 32) : keyBytes;
      } else {
        // Base58-encoded private key
        try {
          decoded = bs58.decode(trimmed);
        } catch {
          throw new Error('Invalid Base58 encoding. The private key contains invalid characters.');
        }
        seed = decoded.length === 64 ? decoded.slice(0, 32) : Uint8Array.from(decoded);
      }

      if (seed.length !== 32) {
        throw new Error('Invalid key length');
      }

      // Derive public key from the 32-byte seed
      const publicKeyBytes = ed25519.getPublicKey(seed);
      const publicKeyBase58 = bs58.encode(publicKeyBytes);

      zeroOutKey(publicKeyBytes);

      return { publicKey: publicKeyBase58 };
    } finally {
      if (seed != null) zeroOutKey(seed);
      if (keyBytes != null && keyBytes !== seed) zeroOutKey(keyBytes);
      if (decoded != null && decoded !== seed) zeroOutKey(decoded);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Invalid recovery') || msg.includes('Invalid key')) {
      throw error;
    }
    throw new Error('Invalid private key. Please check the format and try again.');
  }
}

/**
 * Validate a BIP39 mnemonic phrase.
 *
 * @returns true if all words are valid BIP39 English words and checksum passes
 */
function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

/**
 * Derive a Base58-encoded 64-byte Solana secret key (seed + public key)
 * from a valid mnemonic, without persisting it anywhere.
 *
 * Intended for "export private key" / "wallet keys" UI flows.
 */
export async function deriveSecretKeyBase58FromMnemonic(mnemonic: string): Promise<string> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized)) {
    throw new Error('Invalid recovery phrase. Please check your words and try again.');
  }

  const { secretKey } = await deriveKeypairFromMnemonic(normalized);
  const publicKeyBytes = ed25519.getPublicKey(secretKey);
  const secretKey64 = new Uint8Array(64);
  secretKey64.set(secretKey, 0);
  secretKey64.set(publicKeyBytes, 32);

  try {
    return bs58.encode(secretKey64);
  } finally {
    zeroOutKey(secretKey);
    zeroOutKey(publicKeyBytes);
    zeroOutKey(secretKey64);
  }
}

/**
 * Derive the 32-byte Ed25519 signing seed for the active Solana wallet.
 *
 * Intended for short-lived signing flows such as OffPay API request
 * authentication. Callers must zero the returned bytes after use.
 */
export async function deriveSigningSeedFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized)) {
    throw new Error('Invalid recovery phrase. Please check your words and try again.');
  }

  const { secretKey } = await deriveKeypairFromMnemonic(normalized);

  try {
    return Uint8Array.from(secretKey);
  } finally {
    zeroOutKey(secretKey);
  }
}

/**
 * Decode a Solana private-key import into the 32-byte Ed25519 signing seed.
 *
 * Accepts the same formats as restoreWalletFromPrivateKey(). Callers must zero
 * the returned bytes after use.
 */
export function decodeSigningSeedFromPrivateKey(privateKeyInput: string): Uint8Array {
  const trimmed = privateKeyInput.trim();
  let seed: Uint8Array | null = null;
  let keyBytes: Uint8Array | null = null;
  let decoded: Uint8Array | null = null;

  try {
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      let bytes: unknown;
      try {
        bytes = JSON.parse(trimmed);
      } catch {
        throw new Error('Invalid JSON key array. Please check the format.');
      }

      if (!Array.isArray(bytes) || bytes.length === 0) {
        throw new Error('Invalid key array');
      }

      for (let i = 0; i < bytes.length; i++) {
        const value = bytes[i] as number;
        if (!Number.isInteger(value) || value < 0 || value > 255) {
          throw new Error(`Invalid byte value at index ${i}: ${String(value)}`);
        }
      }

      keyBytes = Uint8Array.from(bytes as number[]);
      seed = keyBytes.length === 64 ? keyBytes.slice(0, 32) : keyBytes;
    } else {
      try {
        decoded = bs58.decode(trimmed);
      } catch {
        throw new Error('Invalid Base58 encoding. The private key contains invalid characters.');
      }

      seed = decoded.length === 64 ? decoded.slice(0, 32) : Uint8Array.from(decoded);
    }

    if (seed.length !== 32) {
      throw new Error('Invalid key length');
    }

    return Uint8Array.from(seed);
  } finally {
    if (seed != null) zeroOutKey(seed);
    if (keyBytes != null && keyBytes !== seed) zeroOutKey(keyBytes);
    if (decoded != null && decoded !== seed) zeroOutKey(decoded);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derived keypair result */
interface DerivedKeypair {
  publicKeyBase58: string;
  secretKey: Uint8Array;
}

/**
 * Derive a Solana keypair from a BIP39 mnemonic using the standard derivation path.
 * Uses @noble/curves/ed25519 — zero Node.js dependencies.
 */
async function deriveKeypairFromMnemonic(mnemonic: string): Promise<DerivedKeypair> {
  const startedAt = mark();
  // Convert mnemonic to 64-byte seed (PBKDF2 with 2048 rounds)
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const seedDoneAt = mark();
  measure('wallet.mnemonicToSeed', startedAt);

  try {
    // Derive Ed25519 key using BIP44 path (pure JS, no Buffer needed)
    const seedHex = bytesToHex(seed);
    const { key: derivedSeed } = derivePath(SOLANA_DERIVATION_PATH, seedHex);

    // Compute public key from the 32-byte derived seed
    const publicKeyBytes = ed25519.getPublicKey(derivedSeed);
    measure('wallet.deriveKeypairFromMnemonic.derive', seedDoneAt);
    measure('wallet.deriveKeypairFromMnemonic.total', startedAt);
    try {
      const publicKeyBase58 = bs58.encode(publicKeyBytes);

      return { publicKeyBase58, secretKey: derivedSeed };
    } finally {
      zeroOutKey(publicKeyBytes);
    }
  } finally {
    zeroOutKey(seed);
  }
}

/**
 * Convert a Uint8Array to hex string without Buffer.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalize a mnemonic phrase:
 *  - Lowercase
 *  - Collapse whitespace
 *  - Trim
 */
function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Best-effort zeroing of a Uint8Array to minimize key material in memory.
 * Defense-in-depth measure — not a guarantee against JS GC, but standard practice.
 */
function zeroOutKey(key: Uint8Array): void {
  try {
    key.fill(0);
  } catch {
    // If the array is frozen or immutable, silently skip
  }
}
