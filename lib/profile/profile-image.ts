import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { beginAppLockSuppression } from '@/lib/wallet/app-lock-suppression';

const PROFILE_IMAGE_DIR_NAME = 'profile-images';
const PROFILE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const SUPPORTED_PROFILE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const SUPPORTED_PROFILE_IMAGE_MIME_TYPES = Object.keys(EXTENSION_BY_MIME_TYPE);

function getProfileImageDirectory(): Directory {
  return new Directory(Paths.document, PROFILE_IMAGE_DIR_NAME);
}

function getManagedProfileImagePrefix(): string {
  const directoryUri = getProfileImageDirectory().uri;
  return directoryUri.endsWith('/') ? directoryUri : `${directoryUri}/`;
}

function inferProfileImageExtension(asset: DocumentPicker.DocumentPickerAsset): string | null {
  const mimeExtension =
    asset.mimeType == null ? null : (EXTENSION_BY_MIME_TYPE[asset.mimeType.toLowerCase()] ?? null);
  if (mimeExtension != null) return mimeExtension;

  const nameExtension = asset.name.split('.').pop()?.toLowerCase();
  if (nameExtension != null && SUPPORTED_PROFILE_IMAGE_EXTENSIONS.has(nameExtension)) {
    return nameExtension === 'jpeg' ? 'jpg' : nameExtension;
  }

  return null;
}

function normalizeFileExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, '');
  return normalized === 'jpeg' ? 'jpg' : normalized;
}

function isSupportedProfileImageFile(file: File): boolean {
  return (
    file.exists && SUPPORTED_PROFILE_IMAGE_EXTENSIONS.has(normalizeFileExtension(file.extension))
  );
}

function listManagedProfileImageFiles(): File[] {
  try {
    const directory = getProfileImageDirectory();
    if (!directory.exists) return [];

    return directory
      .list()
      .filter((entry): entry is File => entry instanceof File && isSupportedProfileImageFile(entry))
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
  } catch {
    return [];
  }
}

function assertSupportedProfileImage(asset: DocumentPicker.DocumentPickerAsset): string {
  const extension = inferProfileImageExtension(asset);

  if (extension == null) {
    throw new Error('Choose a PNG, JPG, or WebP image.');
  }

  if (asset.mimeType != null && !asset.mimeType.toLowerCase().startsWith('image/')) {
    throw new Error('Choose an image file.');
  }

  const sourceFile = new File(asset.uri);
  const sourceSize = asset.size ?? sourceFile.size;
  if (sourceSize > PROFILE_IMAGE_MAX_BYTES) {
    throw new Error('Choose an image smaller than 8 MB.');
  }

  if (!sourceFile.exists) {
    throw new Error('Selected image is unavailable.');
  }

  return extension;
}

export async function pickAndPersistLocalProfileImage(): Promise<string | null> {
  const releaseAppLockSuppression = beginAppLockSuppression();

  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: SUPPORTED_PROFILE_IMAGE_MIME_TYPES,
      multiple: false,
      copyToCacheDirectory: true,
      base64: false,
    });

    if (result.canceled) {
      return null;
    }

    const asset = result.assets[0];
    if (asset == null) {
      return null;
    }

    const extension = assertSupportedProfileImage(asset);
    const profileImageDirectory = getProfileImageDirectory();
    profileImageDirectory.create({ intermediates: true, idempotent: true });

    const sourceFile = new File(asset.uri);
    const destinationFile = new File(
      profileImageDirectory,
      `profile-avatar-${Date.now()}.${extension}`,
    );
    sourceFile.copy(destinationFile);
    pruneManagedProfileImages(destinationFile.uri);

    return destinationFile.uri;
  } finally {
    releaseAppLockSuppression();
  }
}

export function isManagedProfileImageUri(uri: string | null | undefined): uri is string {
  if (uri == null || uri.length === 0) return false;
  return uri.startsWith(getManagedProfileImagePrefix());
}

export function deleteManagedProfileImage(uri: string | null | undefined): void {
  if (!isManagedProfileImageUri(uri)) return;

  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort local cleanup only. The persisted URI is cleared by the caller.
  }
}

export function deleteAllManagedProfileImages(): void {
  try {
    const directory = getProfileImageDirectory();
    if (directory.exists) {
      directory.delete();
    }
  } catch {
    // Best-effort local cleanup only. The persisted URI is cleared by the caller.
  }
}

export function pruneManagedProfileImages(keepUri: string | null | undefined): void {
  const normalizedKeepUri = keepUri ?? null;

  for (const file of listManagedProfileImageFiles()) {
    if (file.uri === normalizedKeepUri) continue;

    try {
      file.delete();
    } catch {
      // Ignore stale cache cleanup failures; the active URI remains authoritative.
    }
  }
}

export function resolveStoredProfileImageUri(currentUri: string | null | undefined): string | null {
  if (currentUri != null && currentUri.length > 0) {
    try {
      const currentFile = new File(currentUri);
      if (currentFile.exists) {
        return currentUri;
      }
    } catch {
      // Fall through and attempt recovery from the current app documents path.
    }
  }

  return listManagedProfileImageFiles()[0]?.uri ?? null;
}
