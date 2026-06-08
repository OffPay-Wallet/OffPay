import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

import { mark, measure } from '@/lib/perf/perf-marks';

import type { Groth16ProofA, Groth16ProofB, Groth16ProofC } from '@umbra-privacy/sdk/zk-prover';

type NativeRnZkProver = typeof import('@umbra-privacy/rn-zk-prover');
type NativeCircomProofResult = Awaited<ReturnType<NativeRnZkProver['generateCircomProof']>>;
type NativeCircomProof = Awaited<ReturnType<NativeRnZkProver['generateCircomProof']>>['proof'];
type NativeProofLib = NativeRnZkProver['ProofLib'][keyof NativeRnZkProver['ProofLib']];
type NativeMoproBinding = {
  generateCircomProof: NativeRnZkProver['generateCircomProof'];
  verifyCircomProof: NativeRnZkProver['verifyCircomProof'];
};
type ClaimBatchSize = 1 | 2 | 3 | 4;
type UmbraProofResult = {
  readonly proofA: Groth16ProofA;
  readonly proofB: Groth16ProofB;
  readonly proofC: Groth16ProofC;
};
type IZkProverForUserRegistration = { prove: (inputs: unknown) => Promise<UmbraProofResult> };
type IZkProverForReceiverClaimableUtxo = {
  prove: (inputs: unknown) => Promise<UmbraProofResult>;
};
type ZkProverForReceiverClaimableUtxoFromPublicBalance = {
  prove: (inputs: unknown) => Promise<UmbraProofResult>;
};
type ZkProverForSelfClaimableUtxoFromPublicBalance = {
  prove: (inputs: unknown) => Promise<UmbraProofResult>;
};
type IZkProverForClaimReceiverClaimableUtxoIntoEncryptedBalance = {
  prove: (inputs: unknown, nLeaves: ClaimBatchSize) => Promise<UmbraProofResult>;
};
type IZkProverForClaimSelfClaimableUtxoIntoEncryptedBalance = {
  readonly maxUtxoCapacity: 1;
  prove: (inputs: unknown) => Promise<UmbraProofResult>;
};
type ZKeyType =
  | 'userRegistration'
  | 'createDepositWithConfidentialAmount'
  | 'createDepositWithPublicAmount'
  | 'claimDepositIntoConfidentialAmount'
  | 'claimDepositIntoPublicAmount';
type ClaimVariant = `n${1 | 2 | 3 | 4}`;
type ManifestAssetEntry = {
  url: string;
  version?: string;
};
type ManifestAsset = ManifestAssetEntry | Partial<Record<ClaimVariant, ManifestAssetEntry>>;
type ZkAssetManifest = {
  version?: string;
  assets?: Partial<Record<ZKeyType, ManifestAsset>>;
};
type LocalZkAssetManifest = {
  manifestVersion: string;
  downloadedAt: number;
  assets: Record<string, { version: string; localPath: string; size?: number }>;
};
type MoproInputs = Record<string, string[]>;

// The on-device native crate inside @umbra-privacy/rn-zk-prover must match the
// proving assets expected by the deployed Umbra programs. rn-zk-prover@5.x
// ships v5 native witness code, so do not use the root manifest (currently
// v3). Keep the cache keyed by the matching versioned manifest so a zkey
// rotation replaces stale local files.
const UMBRA_ZK_ASSET_BASE_URL = 'https://zk.api.umbraprivacy.com';
const UMBRA_RN_ZK_ASSET_VERSION = 'v5';
const UMBRA_ZK_MANIFEST_PATH = `${UMBRA_RN_ZK_ASSET_VERSION}/manifest.json`;
const UMBRA_ZK_ASSET_MANIFEST_URL = `${UMBRA_ZK_ASSET_BASE_URL}/${UMBRA_ZK_MANIFEST_PATH}`;
const UMBRA_ZK_ASSET_DIRECTORY = new Directory(Paths.cache, 'offpay-umbra-zk-assets');
const UMBRA_ZK_ASSET_LOCAL_MANIFEST_FILENAME = 'manifest.json';
const UMBRA_ZK_REMOTE_MANIFEST_CACHE_TTL_MS = 60_000;
// Umbra zkey sizes range widely (the public-balance deposit circuit is ~4 MB,
// user-registration is ~50 MB). A global minimum is unreliable, so we treat a
// zkey as "complete" only if it non-empty AND matches the size in our local
// manifest (populated from the Content-Length of the successful download).
const MIN_ZKEY_BYTES = 512 * 1024;
const MOPRO_MODULE_NAME = 'MoproFfi';
export const RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE =
  'Umbra private P2P proving requires an Android build that includes the MoproFfi native module. Rebuild the Android development or preview app after installing @umbra-privacy/rn-zk-prover.';

let nativeProverPromise: Promise<NativeRnZkProver> | null = null;
let remoteManifestCache: { expiresAt: number; promise: Promise<ZkAssetManifest> } | null = null;

export function isRnZkProverNativeModuleAvailable(): boolean {
  if (Platform.OS === 'web') return false;

  try {
    if (NativeModules[MOPRO_MODULE_NAME] != null) return true;
    return TurboModuleRegistry.get(MOPRO_MODULE_NAME) != null;
  } catch {
    return false;
  }
}

function assertNativeRuntime(): void {
  if (Platform.OS === 'web') {
    throw new Error('Umbra private P2P proving requires a native mobile build.');
  }
  if (!isRnZkProverNativeModuleAvailable()) {
    throw new Error(RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE);
  }
}

function normalizeNativeProverImportError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /MoproFfi|NativeMopro|TurboModuleRegistry|getEnforcing|uniffi|contract_version/i.test(message)
  ) {
    return new Error(RN_ZK_PROVER_NATIVE_MODULE_UNAVAILABLE_MESSAGE, { cause: error });
  }

  return error instanceof Error ? error : new Error(message);
}

function getMoproErrorDetail(error: unknown): string | null {
  if (error == null || typeof error !== 'object') return null;

  const inner = (error as { inner?: unknown }).inner;
  if (Array.isArray(inner)) {
    const details = inner.filter((value): value is string => typeof value === 'string');
    if (details.length > 0) return details.join(' ');
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause != null && cause !== error) {
    return getMoproErrorDetail(cause);
  }

  return null;
}

function normalizeCircomProofError(type: ZKeyType, proofLib: string, error: unknown): Error {
  const detail = getMoproErrorDetail(error);
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Umbra ${type} proof failed with ${proofLib}: ${detail ?? message}`, {
    cause: error,
  });
}

export function shouldRefreshUmbraZkeyAfterProofError(error: unknown): boolean {
  const detail = getMoproErrorDetail(error);
  const message = error instanceof Error ? error.message : String(error);
  return /rust panic/i.test(`${detail ?? ''} ${message}`);
}

function describeCircomProofFailure(proofLib: string, error: unknown): string {
  const detail = getMoproErrorDetail(error);
  const message = error instanceof Error ? error.message : String(error);
  return `${proofLib}: ${detail ?? message}`;
}

async function getNativeProver(): Promise<NativeRnZkProver> {
  assertNativeRuntime();
  nativeProverPromise ??= import('@umbra-privacy/rn-zk-prover')
    .then(async (module) => {
      if (typeof module.uniffiInitAsync !== 'function') {
        throw new Error('MoproFfi package is missing uniffiInitAsync.');
      }
      await module.uniffiInitAsync();
      return module;
    })
    .catch((error) => {
      nativeProverPromise = null;
      throw normalizeNativeProverImportError(error);
    });

  return nativeProverPromise;
}

function getNativeMoproBinding(nativeProver: NativeRnZkProver): NativeMoproBinding {
  const nativeDefault = nativeProver.default as Record<string, unknown>;
  const binding = nativeDefault.mopro_umbra_2 ?? nativeDefault.mopro;
  if (
    binding == null ||
    typeof binding !== 'object' ||
    typeof (binding as Partial<NativeMoproBinding>).generateCircomProof !== 'function' ||
    typeof (binding as Partial<NativeMoproBinding>).verifyCircomProof !== 'function'
  ) {
    throw new Error(
      'Umbra private P2P prover binding is unavailable. Rebuild the app with a compatible @umbra-privacy/rn-zk-prover package.',
    );
  }

  return binding as NativeMoproBinding;
}

function ensureAssetDirectory(): void {
  if (!UMBRA_ZK_ASSET_DIRECTORY.exists) {
    UMBRA_ZK_ASSET_DIRECTORY.create({
      idempotent: true,
      intermediates: true,
    });
  }
}

function getLocalManifestFile(): File {
  return new File(UMBRA_ZK_ASSET_DIRECTORY, UMBRA_ZK_ASSET_LOCAL_MANIFEST_FILENAME);
}

async function readLocalManifest(): Promise<LocalZkAssetManifest | null> {
  const manifestFile = getLocalManifestFile();
  if (!manifestFile.exists) return null;

  try {
    const manifest = JSON.parse(await manifestFile.text()) as Partial<LocalZkAssetManifest>;
    if (typeof manifest.manifestVersion !== 'string' || manifest.assets == null) {
      return null;
    }
    return {
      manifestVersion: manifest.manifestVersion,
      downloadedAt: typeof manifest.downloadedAt === 'number' ? manifest.downloadedAt : 0,
      assets: manifest.assets,
    };
  } catch {
    return null;
  }
}

async function writeLocalManifest(manifest: LocalZkAssetManifest): Promise<void> {
  ensureAssetDirectory();
  getLocalManifestFile().write(JSON.stringify(manifest));
}

/**
 * Delete every cached zkey and the local manifest file. Invoked when the
 * remote manifest publishes a new top-level version (e.g. v3 → v4) so we
 * never feed a stale zkey to the Arkworks prover.
 */
export function clearUmbraZkAssetsCache(): void {
  if (UMBRA_ZK_ASSET_DIRECTORY.exists) {
    UMBRA_ZK_ASSET_DIRECTORY.delete();
  }
  remoteManifestCache = null;
}

export function __clearUmbraZkManifestCacheForTesting(): void {
  remoteManifestCache = null;
}

let manifestVersionCheckPromise: Promise<void> | null = null;

/**
 * Ensures the on-disk manifest's top-level version matches the remote.
 * Clears the cache when it drifts. Cheap after the first run because we
 * memoize on the module.
 */
async function ensureManifestVersionMatches(remoteVersion: string | undefined): Promise<void> {
  if (remoteVersion == null) return;
  if (manifestVersionCheckPromise != null) {
    await manifestVersionCheckPromise;
    return;
  }

  manifestVersionCheckPromise = (async () => {
    const local = await readLocalManifest();
    if (local == null) return;
    if (local.manifestVersion === remoteVersion) return;
    clearUmbraZkAssetsCache();
  })();

  try {
    await manifestVersionCheckPromise;
  } finally {
    // Let subsequent calls re-check once the guard is populated. readLocalManifest
    // is cheap and we want to notice future remote bumps without a restart.
    manifestVersionCheckPromise = null;
  }
}

function toAssetUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const trimmed = path.replace(/^\/+/, '');
  return `${UMBRA_ZK_ASSET_BASE_URL}/${trimmed}`;
}

function getManifestAssetEntry(
  manifest: ZkAssetManifest,
  type: ZKeyType,
  variant?: ClaimVariant,
): ManifestAssetEntry {
  const asset = manifest.assets?.[type];
  if (asset == null) {
    throw new Error(`Umbra ZK asset ${type} is missing from the manifest.`);
  }

  if ('url' in asset) {
    if (typeof asset.url !== 'string' || asset.url.length === 0) {
      throw new Error(`Umbra ZK asset ${type} has an invalid URL.`);
    }
    return asset as ManifestAssetEntry;
  }

  if (variant == null) {
    throw new Error(`Umbra ZK asset ${type} requires a variant.`);
  }

  const entry = asset[variant];
  if (entry == null || typeof entry.url !== 'string' || entry.url.length === 0) {
    throw new Error(`Umbra ZK asset ${type}/${variant} is missing from the manifest.`);
  }

  return entry;
}

function getManifestAssetKey(type: ZKeyType, variant?: ClaimVariant): string {
  return variant == null ? type : `${type}:${variant}`;
}

function getManifestAssetVersion(manifest: ZkAssetManifest, entry: ManifestAssetEntry): string {
  return entry.version ?? manifest.version ?? entry.url;
}

async function fetchZkeyManifest(options?: { forceRefresh?: boolean }): Promise<ZkAssetManifest> {
  const now = Date.now();
  if (
    options?.forceRefresh !== true &&
    remoteManifestCache != null &&
    remoteManifestCache.expiresAt > now
  ) {
    return remoteManifestCache.promise;
  }

  const startedAt = mark();
  const manifestPromise = fetch(`${UMBRA_ZK_ASSET_MANIFEST_URL}?t=${now}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to fetch Umbra ZK manifest: ${response.status}`);
      }

      return (await response.json()) as ZkAssetManifest;
    })
    .finally(() => {
      measure('umbra.zkProver.manifest', startedAt, {
        forceRefresh: options?.forceRefresh === true,
      });
    });
  remoteManifestCache = {
    expiresAt: now + UMBRA_ZK_REMOTE_MANIFEST_CACHE_TTL_MS,
    promise: manifestPromise,
  };

  try {
    return await manifestPromise;
  } catch (error) {
    if (remoteManifestCache?.promise === manifestPromise) {
      remoteManifestCache = null;
    }
    throw error;
  }
}

async function fetchContentLength(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return null;
    const header = response.headers.get('content-length');
    if (header == null) return null;
    const parsed = Number.parseInt(header, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function getUmbraZkeyCacheFileName(type: ZKeyType, variant?: ClaimVariant): string {
  return `${type}${variant ?? ''}.zkey`.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

function fileUriToNativePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function isNonEmptyZkeyFile(file: File): boolean {
  const size = statZkeyFileSize(file);
  return file.exists && size != null && size >= MIN_ZKEY_BYTES;
}

/**
 * Read a file's on-disk size robustly. `File.size` is a native getter that can
 * return `null`/`undefined` on a stale handle (e.g. immediately after a
 * streamed Android download via a pre-download handle). Prefer the live
 * `info().size`, fall back to the `size` getter, and normalize anything
 * non-finite to `null` so callers can distinguish "unknown" from "zero".
 */
function statZkeyFileSize(file: File): number | null {
  if (!file.exists) return null;
  try {
    const info = file.info();
    if (info.exists && typeof info.size === 'number' && Number.isFinite(info.size)) {
      return info.size;
    }
  } catch {
    // `info()` may throw if the handle cannot be read; fall through to `size`.
  }
  const rawSize = (file as { size?: number | null }).size;
  return typeof rawSize === 'number' && Number.isFinite(rawSize) ? rawSize : null;
}

/**
 * Validate a zkey's completeness from an already-resolved size. zkeys feed the
 * Groth16 prover, so when the server advertised an exact `content-length` we
 * require an exact match — extra or missing bytes must fail. Only when the
 * expected size is unknown do we fall back to the conservative minimum-size
 * heuristic.
 */
function isCompleteZkeyFileSize(
  exists: boolean,
  actualSize: number | null,
  expectedSize: number | null,
): boolean {
  if (!exists) return false;
  if (actualSize == null) return false;
  if (actualSize < MIN_ZKEY_BYTES) return false;
  if (expectedSize != null) return actualSize === expectedSize;
  return true;
}

function isCompleteZkeyFile(file: File, expectedSize?: number | null): boolean {
  return isCompleteZkeyFileSize(file.exists, statZkeyFileSize(file), expectedSize ?? null);
}

export async function resolveUmbraZkeyPath(
  type: ZKeyType,
  variant?: ClaimVariant,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  assertNativeRuntime();
  ensureAssetDirectory();

  let target = new File(UMBRA_ZK_ASSET_DIRECTORY, getUmbraZkeyCacheFileName(type, variant));
  if (target.exists && !isNonEmptyZkeyFile(target)) {
    target.delete();
  }

  // Always reconcile against the remote manifest first. Trusting the local zkey
  // without checking the manifest can break hard when the on-chain program
  // upgrades (v3 → v4): a stale v4 zkey would otherwise be fed to the v3
  // Arkworks crate and the Rust prover would panic.
  let remoteManifest: ZkAssetManifest | null = null;
  try {
    remoteManifest = await fetchZkeyManifest({ forceRefresh: options?.forceRefresh === true });
    await ensureManifestVersionMatches(remoteManifest.version);
  } catch {
    // Manifest fetch failed: if we already have a complete local copy that was
    // registered against a matching local manifest, trust it offline. Otherwise
    // bubble the failure up through the download path below.
    remoteManifest = null;
  }

  if (!UMBRA_ZK_ASSET_DIRECTORY.exists) {
    ensureAssetDirectory();
  }
  target = new File(UMBRA_ZK_ASSET_DIRECTORY, getUmbraZkeyCacheFileName(type, variant));

  const localManifest = await readLocalManifest();
  const localAsset = localManifest?.assets[getManifestAssetKey(type, variant)] ?? null;

  if (options?.forceRefresh !== true && remoteManifest != null) {
    const entry = getManifestAssetEntry(remoteManifest, type, variant);
    const remoteVersion = getManifestAssetVersion(remoteManifest, entry);
    if (
      localAsset?.version === remoteVersion &&
      localAsset.localPath === target.uri &&
      isCompleteZkeyFile(target, localAsset.size ?? null)
    ) {
      return fileUriToNativePath(target.uri);
    }
  } else if (remoteManifest == null) {
    // Offline path: only reuse the local file if the local manifest considers
    // it complete. Never fall back to a file whose size is unknown.
    if (
      localAsset?.localPath === target.uri &&
      isCompleteZkeyFile(target, localAsset.size ?? null)
    ) {
      return fileUriToNativePath(target.uri);
    }
    throw new Error(`Unable to fetch Umbra ZK manifest and no complete local cache for ${type}.`);
  }

  // Download path.
  const manifest =
    remoteManifest ?? (await fetchZkeyManifest({ forceRefresh: options?.forceRefresh === true }));
  await ensureManifestVersionMatches(manifest.version);
  if (!UMBRA_ZK_ASSET_DIRECTORY.exists) {
    ensureAssetDirectory();
  }
  target = new File(UMBRA_ZK_ASSET_DIRECTORY, getUmbraZkeyCacheFileName(type, variant));

  const entry = getManifestAssetEntry(manifest, type, variant);
  const downloadUrl = toAssetUrl(entry.url);
  const expectedSize = await fetchContentLength(downloadUrl);

  if (target.exists) target.delete();
  // `File.downloadFileAsync` resolves to the *downloaded* `File`; its `uri`
  // (and the filename derived from response headers) can differ from the
  // pre-download `target` handle. On Android the body streams into the
  // destination and the original handle's cached native peer does not reflect
  // the post-download size — reading `target.size` here returns a stale/`null`
  // value even though the bytes landed. Always re-stat through the returned
  // handle (falling back to a fresh handle on the resolved uri) before
  // validating, so the completeness check sees the real on-disk size.
  const downloaded = await File.downloadFileAsync(downloadUrl, target, { idempotent: true });
  let persisted = new File(downloaded?.uri ?? target.uri);
  const persistedSize = statZkeyFileSize(persisted);
  if (!isCompleteZkeyFileSize(persisted.exists, persistedSize, expectedSize ?? null)) {
    if (persisted.exists) persisted.delete();
    throw new Error(
      `Umbra ZK asset ${type}${variant == null ? '' : `/${variant}`} is incomplete (got ${
        persistedSize == null ? 'null' : String(persistedSize)
      } bytes${expectedSize != null ? `, expected ${expectedSize}` : ''}).`,
    );
  }

  // Normalize the downloaded file back to the deterministic `target` path. If
  // `downloadFileAsync` resolved the body to a different uri (Android can
  // derive the filename from response headers), future cache reuse — which
  // requires `localAsset.localPath === target.uri` — and offline reuse would
  // otherwise miss and force a re-download every run. Move it onto the
  // canonical path so the cache key is stable.
  if (persisted.uri !== target.uri) {
    try {
      if (target.exists) target.delete();
      persisted.move(target);
      persisted = new File(target.uri);
    } catch {
      // If the move fails we still have a valid file at `persisted.uri`;
      // fall back to persisting that path so this run succeeds.
    }
  }

  const existingManifest = await readLocalManifest();
  const manifestVersion = manifest.version ?? entry.version ?? 'unknown';
  const finalSize = statZkeyFileSize(persisted);
  await writeLocalManifest({
    manifestVersion,
    downloadedAt: Date.now(),
    assets: {
      ...(existingManifest?.manifestVersion === manifestVersion ? existingManifest.assets : {}),
      [getManifestAssetKey(type, variant)]: {
        version: getManifestAssetVersion(manifest, entry),
        localPath: persisted.uri,
        size: finalSize ?? undefined,
      },
    },
  });

  return fileUriToNativePath(persisted.uri);
}

function toMoproStringArray(value: unknown): string[] {
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString());
  }
  if (Array.isArray(value)) {
    return value.flatMap((nestedValue) => toMoproStringArray(nestedValue));
  }
  if (value == null) {
    throw new Error('Umbra circuit input contains a null or undefined scalar.');
  }
  return [String((value as { toString(): string }).toString())];
}

export function convertUmbraCircuitInputsToMoproInputs(inputs: unknown): MoproInputs {
  if (inputs == null || typeof inputs !== 'object') {
    throw new Error('Umbra circuit inputs must be an object.');
  }
  return Object.fromEntries(
    Object.entries(inputs as Record<string, unknown>).map(([key, value]) => [
      key,
      toMoproStringArray(value),
    ]),
  );
}

export function serializeUmbraCircuitInputsForNativeProver(inputs: unknown): string {
  return JSON.stringify(convertUmbraCircuitInputsToMoproInputs(inputs));
}

function u256ToBeBytes(value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  view.setBigUint64(0, (value >> 192n) & 0xffffffffffffffffn, false);
  view.setBigUint64(8, (value >> 128n) & 0xffffffffffffffffn, false);
  view.setBigUint64(16, (value >> 64n) & 0xffffffffffffffffn, false);
  view.setBigUint64(24, value & 0xffffffffffffffffn, false);
  return new Uint8Array(buffer);
}

function readProofScalar(value: string | number | bigint, label: string): Uint8Array {
  try {
    return u256ToBeBytes(BigInt(value));
  } catch (error) {
    throw new Error(`Umbra proof scalar ${label} is invalid.`, { cause: error });
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

type NativeProofLibCandidate = {
  readonly name: 'Rapidsnark' | 'Arkworks';
  readonly value: NativeProofLib;
};

function getNativeProofLibCandidates(
  nativeProver: NativeRnZkProver,
): readonly NativeProofLibCandidate[] {
  const candidates: NativeProofLibCandidate[] = [];
  const proofLib = nativeProver.ProofLib;

  if (proofLib.Rapidsnark != null) {
    candidates.push({ name: 'Rapidsnark', value: proofLib.Rapidsnark });
  }
  if (proofLib.Arkworks != null) {
    candidates.push({ name: 'Arkworks', value: proofLib.Arkworks });
  }

  return candidates;
}

export function convertNativeCircomProofToUmbraProofBytes(proof: NativeCircomProof): {
  proofA: Groth16ProofA;
  proofB: Groth16ProofB;
  proofC: Groth16ProofC;
} {
  const bx = proof.b.x;
  const by = proof.b.y;
  if (bx.length < 2 || by.length < 2) {
    throw new Error('Umbra native proof B component is incomplete.');
  }

  return {
    proofA: concatBytes([
      readProofScalar(proof.a.x, 'A.x'),
      readProofScalar(proof.a.y, 'A.y'),
    ]) as Groth16ProofA,
    proofB: concatBytes([
      readProofScalar(bx[1], 'B.x1'),
      readProofScalar(bx[0], 'B.x0'),
      readProofScalar(by[1], 'B.y1'),
      readProofScalar(by[0], 'B.y0'),
    ]) as Groth16ProofB,
    proofC: concatBytes([
      readProofScalar(proof.c.x, 'C.x'),
      readProofScalar(proof.c.y, 'C.y'),
    ]) as Groth16ProofC,
  };
}

async function generateAndVerifyNativeCircomProof(
  mopro: NativeMoproBinding,
  nativeProver: NativeRnZkProver,
  zkeyPath: string,
  serializedInputs: string,
  assetLabel: string,
): Promise<UmbraProofResult> {
  const candidates = getNativeProofLibCandidates(nativeProver);
  const failures: string[] = [];

  for (const candidate of candidates) {
    const proofStartedAt = mark();
    const proofStartTime = Date.now();
    try {
      if (__DEV__) {
        console.log(
          `[umbra-prover] Starting ${candidate.name} proof generation for ${assetLabel}...`,
        );
      }

      const result: NativeCircomProofResult = await mopro.generateCircomProof(
        zkeyPath,
        serializedInputs,
        candidate.value,
      );

      const proofDuration = Date.now() - proofStartTime;
      if (__DEV__) {
        console.log(
          `[umbra-prover] ${candidate.name} proof generated in ${(proofDuration / 1000).toFixed(2)}s, verifying...`,
        );
      }

      const verifyStartTime = Date.now();
      const locallyVerified = mopro.verifyCircomProof(zkeyPath, result, candidate.value);
      const verifyDuration = Date.now() - verifyStartTime;

      measure('umbra.zkProver.generateProof', proofStartedAt, {
        asset: assetLabel,
        proofLib: candidate.name,
        ok: locallyVerified,
        localVerified: locallyVerified,
        proofDurationMs: proofDuration,
        verifyDurationMs: verifyDuration,
      });

      if (__DEV__) {
        console.log(
          `[umbra-prover] ${candidate.name} proof verified in ${(verifyDuration / 1000).toFixed(2)}s, result: ${locallyVerified}`,
        );
      }

      if (!locallyVerified) {
        failures.push(`${candidate.name}: native proof did not verify locally`);
        continue;
      }

      if (__DEV__) {
        console.log(
          `[umbra-prover] Total proof generation time: ${((proofDuration + verifyDuration) / 1000).toFixed(2)}s`,
        );
      }

      return convertNativeCircomProofToUmbraProofBytes(result.proof);
    } catch (proofError) {
      const proofDuration = Date.now() - proofStartTime;
      const message = proofError instanceof Error ? proofError.message : String(proofError);

      if (__DEV__) {
        console.error(
          `[umbra-prover] ${candidate.name} proof failed after ${(proofDuration / 1000).toFixed(2)}s:`,
          message,
        );
      }

      measure('umbra.zkProver.generateProof', proofStartedAt, {
        asset: assetLabel,
        proofLib: candidate.name,
        ok: false,
        localVerified: false,
        error: message,
        proofDurationMs: proofDuration,
      });
      failures.push(`${candidate.name}: ${message}`);
    }
  }

  throw new Error(`Umbra ${assetLabel} native proof failed: ${failures.join('; ')}`);
}

async function proveCircom(type: ZKeyType, inputs: unknown, variant?: ClaimVariant) {
  const label = variant == null ? type : `${type}/${variant}`;
  const zkeyStartedAt = mark();
  const [nativeProver, zkeyPath] = await Promise.all([
    getNativeProver(),
    resolveUmbraZkeyPath(type, variant),
  ]);
  // Non-secret zkey diagnostics for the Umbra team's claim-failure bundle:
  // which asset/variant was used and its on-disk byte size (so we can confirm
  // the v5 zkey downloaded intact and matches the expected proving key).
  const resolvedZkeyFile = new File(
    zkeyPath.startsWith('file://') ? zkeyPath : `file://${zkeyPath}`,
  );
  measure('umbra.zkProver.resolveZkey', zkeyStartedAt, {
    asset: label,
    zkeyFileName: getUmbraZkeyCacheFileName(type, variant),
    zkeyBytes: statZkeyFileSize(resolvedZkeyFile) ?? -1,
  });
  const serializedInputs = serializeUmbraCircuitInputsForNativeProver(inputs);
  const mopro = getNativeMoproBinding(nativeProver);
  const generateProof = async (path: string) => {
    return generateAndVerifyNativeCircomProof(mopro, nativeProver, path, serializedInputs, label);
  };

  try {
    return await generateProof(zkeyPath);
  } catch (arkworksError) {
    if (!shouldRefreshUmbraZkeyAfterProofError(arkworksError)) {
      throw normalizeCircomProofError(type, 'Arkworks', arkworksError);
    }

    const failure = describeCircomProofFailure('Arkworks', arkworksError);
    try {
      const refreshedZkeyPath = await resolveUmbraZkeyPath(type, variant, { forceRefresh: true });
      return await generateProof(refreshedZkeyPath);
    } catch (refreshRetryError) {
      throw normalizeCircomProofError(
        type,
        'Arkworks',
        `${failure}; ${describeCircomProofFailure('Arkworks after zkey refresh', refreshRetryError)}`,
      );
    }
  }
}

export function getRnUserRegistrationProver(): IZkProverForUserRegistration {
  return {
    prove: (inputs) => proveCircom('userRegistration', inputs),
  };
}

export function getRnCreateReceiverClaimableUtxoFromPublicBalanceProver(): ZkProverForReceiverClaimableUtxoFromPublicBalance {
  return {
    prove: (inputs: unknown) => proveCircom('createDepositWithPublicAmount', inputs),
  };
}

export function getRnCreateSelfClaimableUtxoFromPublicBalanceProver(): ZkProverForSelfClaimableUtxoFromPublicBalance {
  return {
    prove: (inputs: unknown) => proveCircom('createDepositWithPublicAmount', inputs),
  };
}

export function getRnCreateReceiverClaimableUtxoFromEncryptedBalanceProver(): IZkProverForReceiverClaimableUtxo {
  return {
    prove: (inputs: unknown) => proveCircom('createDepositWithConfidentialAmount', inputs),
  };
}

export function getRnClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(): IZkProverForClaimReceiverClaimableUtxoIntoEncryptedBalance {
  return {
    prove: (inputs: unknown, nLeaves: ClaimBatchSize) =>
      proveCircom('claimDepositIntoConfidentialAmount', inputs, `n${nLeaves}`),
  };
}

export function getRnClaimSelfClaimableUtxoIntoEncryptedBalanceProver(): IZkProverForClaimSelfClaimableUtxoIntoEncryptedBalance {
  return {
    maxUtxoCapacity: 1,
    prove: (inputs: unknown) => proveCircom('claimDepositIntoConfidentialAmount', inputs, 'n1'),
  };
}
