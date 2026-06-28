import { Directory, File, Paths } from 'expo-file-system';

import { yieldToEventLoop, yieldToUi } from '@/lib/perf/ui-work-scheduler';

const ROOT_DIRECTORY = new Directory(Paths.document, 'offpay-cache');

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function ensureRootDirectory(): void {
  if (!ROOT_DIRECTORY.exists) {
    ROOT_DIRECTORY.create({
      idempotent: true,
      intermediates: true,
    });
  }
}

function getFileForKey(key: string): File {
  ensureRootDirectory();
  return new File(ROOT_DIRECTORY, `${safeFilePart(key)}.json`);
}

export async function readPersistedJson<T>(
  key: string,
  normalize: (value: unknown) => T | null,
): Promise<T | null> {
  try {
    const file = getFileForKey(key);
    if (!file.exists) return null;
    const raw = await file.text();
    if (raw.length === 0) return null;
    await yieldToUi();
    const parsed = JSON.parse(raw);
    await yieldToEventLoop();
    return normalize(parsed);
  } catch {
    return null;
  }
}

export function readPersistedJsonSync<T>(
  key: string,
  normalize: (value: unknown) => T | null,
): T | null {
  try {
    const file = getFileForKey(key);
    if (!file.exists) return null;
    const readTextSync = (file as File & { textSync?: () => string }).textSync;
    if (typeof readTextSync !== 'function') return null;
    const raw = readTextSync.call(file);
    if (raw.length === 0) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writePersistedJson(key: string, value: unknown): Promise<void> {
  const file = getFileForKey(key);
  await yieldToUi();
  const payload = JSON.stringify(value);
  await yieldToEventLoop();

  if (!file.exists) {
    file.create({
      intermediates: true,
    });
  }

  await yieldToEventLoop();
  file.write(payload);
}

export async function deletePersistedJson(key: string): Promise<void> {
  try {
    const file = getFileForKey(key);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ignore cache cleanup failures; callers treat the cache as best-effort.
  }
}
