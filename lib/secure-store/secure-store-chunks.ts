import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;
const MANIFEST_PREFIX = '__offpay_secure_chunks_v1__:';
const CHUNK_KEY_SEPARATOR = '.__chunk_';

interface ChunkManifest {
  version: 1;
  chunks: number;
}

function chunkKey(key: string, index: number): string {
  return `${key}${CHUNK_KEY_SEPARATOR}${index}`;
}

function parseManifest(value: string | null): ChunkManifest | null {
  if (value == null || !value.startsWith(MANIFEST_PREFIX)) return null;

  try {
    const parsed = JSON.parse(value.slice(MANIFEST_PREFIX.length)) as Partial<ChunkManifest>;
    const chunks = parsed.chunks;
    if (parsed.version !== 1 || !Number.isInteger(chunks) || chunks == null || chunks <= 0) {
      return null;
    }

    return {
      version: 1,
      chunks,
    };
  } catch {
    return null;
  }
}

async function deleteChunks(
  key: string,
  chunks: number,
  options?: SecureStore.SecureStoreOptions,
): Promise<void> {
  await Promise.allSettled(
    Array.from({ length: chunks }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, index), options),
    ),
  );
}

export async function getSecureStoreItem(
  key: string,
  options?: SecureStore.SecureStoreOptions,
): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(key, options);
  const manifest = parseManifest(raw);
  if (manifest == null) return raw;

  const chunks = await Promise.all(
    Array.from({ length: manifest.chunks }, (_, index) =>
      SecureStore.getItemAsync(chunkKey(key, index), options),
    ),
  );

  if (chunks.some((chunk) => chunk == null)) {
    return null;
  }

  return chunks.join('');
}

export async function setSecureStoreItem(
  key: string,
  value: string,
  options?: SecureStore.SecureStoreOptions,
): Promise<void> {
  const previousManifest = parseManifest(await SecureStore.getItemAsync(key, options));

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value, options);
    if (previousManifest != null) {
      await deleteChunks(key, previousManifest.chunks, options);
    }
    return;
  }

  const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) ?? [];
  await Promise.all(
    chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk, options)),
  );
  await SecureStore.setItemAsync(
    key,
    `${MANIFEST_PREFIX}${JSON.stringify({ version: 1, chunks: chunks.length })}`,
    options,
  );

  if (previousManifest != null && previousManifest.chunks > chunks.length) {
    await Promise.allSettled(
      Array.from({ length: previousManifest.chunks - chunks.length }, (_, offset) =>
        SecureStore.deleteItemAsync(chunkKey(key, chunks.length + offset), options),
      ),
    );
  }
}

export async function deleteSecureStoreItem(
  key: string,
  options?: SecureStore.SecureStoreOptions,
): Promise<void> {
  const manifest = parseManifest(await SecureStore.getItemAsync(key, options));
  await SecureStore.deleteItemAsync(key, options);

  if (manifest != null) {
    await deleteChunks(key, manifest.chunks, options);
  }
}
