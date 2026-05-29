import type { MMKV } from 'react-native-mmkv';
import { createMMKV } from 'react-native-mmkv';

import {
  deleteSecureStoreItem,
  getSecureStoreItem,
  setSecureStoreItem,
} from '@/lib/secure-store/secure-store-chunks';

/**
 * Synchronous MMKV-backed storage adapter for Zustand's `persist`
 * middleware. Used by stores that benefit from synchronous reads (UI
 * flags, preferences, queued local receipts, agentic chat history).
 *
 * Wallet secrets — seed, signing keys, passcode hash — continue to live
 * in SecureStore (`@/lib/secure-wallet-store`). MMKV holds chat history
 * (recipients, amounts, intent text) and other low-sensitivity state.
 *
 * Encryption-at-rest:
 * - On first launch we generate a 32-byte random key, persist it to
 *   SecureStore (Keychain / Keystore), and pass it to MMKV via the
 *   native `encryptionKey` setting.
 * - SecureStore is async; MMKV's `createMMKV` is sync. We open the
 *   instance plaintext at boot and then call `recrypt(key)` once the
 *   SecureStore key resolves. `recrypt` rewrites the on-disk file with
 *   AES so any data written during the boot window is preserved.
 * - All subsequent app launches read the encrypted store directly
 *   because the SecureStore key is already present.
 *
 * The adapter ships with a one-shot migration helper that copies any
 * pre-existing SecureStore value into MMKV the first time a store is
 * read, then deletes the SecureStore copy so subsequent launches don't
 * pay for the SecureStore round-trip.
 */

const MMKV_INSTANCE_ID = 'offpay.app-state';
const MMKV_KEY_SECURE_STORE_NAME = 'offpay_mmkv_encryption_key_v1';
const MMKV_KEY_BYTES = 32;

let cachedMmkv: MMKV | null = null;
let pendingKeyResolution: Promise<void> | null = null;
let encryptionApplied = false;

function getMmkv(): MMKV {
  if (cachedMmkv == null) {
    cachedMmkv = createMMKV({ id: MMKV_INSTANCE_ID });
  }
  return cachedMmkv;
}

const migratedKeys = new Set<string>();

async function migrateFromSecureStoreIfPresent(name: string): Promise<void> {
  if (migratedKeys.has(name)) return;
  migratedKeys.add(name);

  const mmkv = getMmkv();
  if (mmkv.contains(name)) return;

  try {
    const existing = await getSecureStoreItem(name);
    if (existing == null) return;
    mmkv.set(name, existing);
    await deleteSecureStoreItem(name).catch(() => undefined);
  } catch {
    migratedKeys.delete(name);
  }
}

async function loadOrCreateEncryptionKey(): Promise<string> {
  const existing = await getSecureStoreItem(MMKV_KEY_SECURE_STORE_NAME);
  if (existing != null && existing.length > 0) return existing;

  const bytes = new Uint8Array(MMKV_KEY_BYTES);
  crypto.getRandomValues(bytes);
  const generated = bytesToBase64(bytes);
  await setSecureStoreItem(MMKV_KEY_SECURE_STORE_NAME, generated);
  return generated;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/**
 * Resolve the encryption key from SecureStore and apply it to the live
 * MMKV instance via `recrypt`. Idempotent — safe to call from multiple
 * bootstrap entry points. Stores that need crypto-on-read should
 * `await` this before reading; everyone else gets best-effort upgrade as
 * soon as the key resolves.
 */
export function bootstrapMmkvEncryption(): Promise<void> {
  if (encryptionApplied) return Promise.resolve();
  if (pendingKeyResolution != null) return pendingKeyResolution;

  pendingKeyResolution = (async () => {
    try {
      const key = await loadOrCreateEncryptionKey();
      // `recrypt` rewrites the on-disk store with the new key. Any data
      // written during the boot window before this resolves is still
      // there — recrypt converts it from plaintext to ciphertext in
      // place.
      getMmkv().recrypt(key);
      encryptionApplied = true;
    } catch {
      // Encryption setup is best-effort. We never want a SecureStore
      // glitch to lock the user out of their preferences. Reset the
      // gate so the next call retries.
      pendingKeyResolution = null;
    }
  })();

  return pendingKeyResolution;
}

// Kick the bootstrap on module load so by the time the first store
// rehydrates, the encrypted instance is usually ready.
void bootstrapMmkvEncryption();

export const mmkvStorage = {
  getItem(name: string): string | null {
    void migrateFromSecureStoreIfPresent(name);
    const value = getMmkv().getString(name);
    return value ?? null;
  },
  setItem(name: string, value: string): void {
    getMmkv().set(name, value);
  },
  removeItem(name: string): void {
    getMmkv().remove(name);
  },
};
