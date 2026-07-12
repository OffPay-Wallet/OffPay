import { AppError } from './errors';

import type { Bindings } from './types';

type AndroidDistributionMode = 'google_play' | 'sideload';

interface AndroidAppIntegrityVerdict {
  appRecognitionVerdict?: string;
  packageName?: string;
  certificateSha256Digest?: string[];
  versionCode?: string;
}

function unavailableConfiguration(): AppError {
  return new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Required backend configuration is unavailable.',
    retryable: true,
  });
}

function getAndroidDistributionMode(bindings: Bindings): AndroidDistributionMode {
  const configuredValue = bindings.OFFPAY_ANDROID_DISTRIBUTION_MODE?.trim().toLowerCase();
  if (!configuredValue) return 'google_play';
  if (configuredValue === 'google_play' || configuredValue === 'sideload') {
    return configuredValue;
  }

  throw unavailableConfiguration();
}

function decodeBase64Url(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeCertificateSha256Digest(value: string): Uint8Array | null {
  const trimmed = value.trim();
  const hex = trimmed.replace(/:/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Uint8Array.from(
      { length: 32 },
      (_entry, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
    );
  }

  if (!/^[A-Za-z0-9_-]{43}=?$/.test(trimmed)) return null;
  const bytes = decodeBase64Url(trimmed);
  return bytes?.length === 32 ? bytes : null;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index]! ^ right[index]!;
  }
  return mismatch === 0;
}

function getExpectedCertificateDigests(bindings: Bindings): Uint8Array[] {
  const configuredValue = bindings.OFFPAY_ANDROID_CERTIFICATE_SHA256_DIGESTS?.trim();
  if (!configuredValue) throw unavailableConfiguration();

  const configuredDigests = configuredValue.split(',');
  const digests = configuredDigests
    .map(decodeCertificateSha256Digest)
    .filter((digest): digest is Uint8Array => digest !== null);
  if (digests.length === 0 || digests.length !== configuredDigests.length) {
    throw unavailableConfiguration();
  }
  return digests;
}

function hasExpectedCertificateDigest(
  bindings: Bindings,
  receivedValues: readonly string[] | undefined,
): boolean {
  const expectedDigests = getExpectedCertificateDigests(bindings);
  const receivedDigests = (receivedValues ?? [])
    .map(decodeCertificateSha256Digest)
    .filter((digest): digest is Uint8Array => digest !== null);

  return expectedDigests.some((expected) =>
    receivedDigests.some((received) => bytesEqual(expected, received)),
  );
}

function hasValidAndroidAppIntegrity(
  bindings: Bindings,
  packageName: string,
  appIntegrity: AndroidAppIntegrityVerdict | undefined,
): boolean {
  const appVerdict = appIntegrity?.appRecognitionVerdict ?? '';
  if (appIntegrity?.packageName !== packageName) return false;
  const configuredMinVersionCode = bindings.OFFPAY_ANDROID_MIN_VERSION_CODE?.trim() ?? '';
  const minVersionCode = Number(configuredMinVersionCode);
  const verdictVersionCode = Number(appIntegrity.versionCode);
  if (
    !/^\d+$/.test(configuredMinVersionCode) ||
    !Number.isSafeInteger(minVersionCode) ||
    minVersionCode < 1 ||
    !Number.isSafeInteger(verdictVersionCode) ||
    verdictVersionCode < minVersionCode
  ) {
    return false;
  }

  const isProduction = bindings.NODE_ENV?.trim().toLowerCase() === 'production';
  if (!isProduction && appVerdict === 'UNRECOGNIZED_VERSION') return true;

  const distributionMode = getAndroidDistributionMode(bindings);
  if (distributionMode === 'google_play') return appVerdict === 'PLAY_RECOGNIZED';

  return (
    (appVerdict === 'UNRECOGNIZED_VERSION' || appVerdict === 'PLAY_RECOGNIZED') &&
    hasExpectedCertificateDigest(bindings, appIntegrity.certificateSha256Digest)
  );
}

export { hasValidAndroidAppIntegrity, type AndroidAppIntegrityVerdict };
