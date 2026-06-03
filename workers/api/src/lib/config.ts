import { isValidSolanaAddress } from './validation';
import type { Bindings, Network } from './types';

type BindingKey = keyof Bindings;

interface FeatureConfigStatus {
  configured: boolean;
  missing: string[];
}

interface WorkerConfigStatus {
  ready: boolean;
  degraded: boolean;
  features: {
    androidAttestation: FeatureConfigStatus;
    iosAttestation: FeatureConfigStatus;
    pendingBackup: FeatureConfigStatus;
    privateSwap: FeatureConfigStatus;
    protectedAuth: FeatureConfigStatus;
    swap: FeatureConfigStatus;
  };
}

interface PublicWorkerConfigStatus {
  ready: boolean;
  degraded: boolean;
  features: Record<keyof WorkerConfigStatus['features'], boolean>;
}

const PROTECTED_AUTH_BINDINGS: BindingKey[] = [
  'BOOTSTRAP_SECRET_VERSION',
  'KV_REST_API_TOKEN',
  'KV_REST_API_URL',
  'MIN_APP_VERSION',
  'OFFPAY_BOOTSTRAP_SECRET',
];

const ANDROID_PLAY_INTEGRITY_BINDINGS: BindingKey[] = [
  'GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY',
  'OFFPAY_ANDROID_PACKAGE_NAME',
];

const IOS_APP_ATTEST_BINDINGS: BindingKey[] = ['OFFPAY_IOS_BUNDLE_ID', 'OFFPAY_IOS_TEAM_ID'];

const PENDING_BACKUP_BINDINGS: BindingKey[] = ['OFFPAY_BACKUP_HMAC_SECRET'];
const SWAP_BINDINGS: BindingKey[] = ['JUPITER_API_KEY'];

function hasStringBinding(bindings: Bindings, key: BindingKey): boolean {
  const value = bindings[key];
  return typeof value === 'string' && value.trim().length > 0;
}

function missingStringBindings(bindings: Bindings, keys: readonly BindingKey[]): string[] {
  return keys.flatMap((key) => (hasStringBinding(bindings, key) ? [] : [key]));
}

function withConfiguredState(missing: string[]): FeatureConfigStatus {
  return {
    configured: missing.length === 0,
    missing,
  };
}

function mergeMissing(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat())].sort((left, right) => left.localeCompare(right));
}

function hasR2Bucket(bindings: Bindings): boolean {
  return bindings.PENDING_BACKUP_BUCKET != null;
}

function readConfiguredUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null;
  } catch {
    return null;
  }
}

function hasRpcUrlForNetwork(bindings: Bindings, network: Network): boolean {
  const quickNodeUrl = readConfiguredUrl(
    network === 'mainnet' ? bindings.QUICKNODE_MAINNET_RPC_URL : bindings.QUICKNODE_DEVNET_RPC_URL,
  );
  const heliusUrl = readConfiguredUrl(
    network === 'mainnet' ? bindings.HELIUS_MAINNET_RPC_URL : bindings.HELIUS_DEVNET_RPC_URL,
  );

  return quickNodeUrl != null || heliusUrl != null;
}

function missingRpcNetworkBindings(bindings: Bindings): string[] {
  return (['devnet', 'mainnet'] as const).flatMap((network) =>
    hasRpcUrlForNetwork(bindings, network)
      ? []
      : [`${network.toUpperCase()}_RPC_URL_HELIUS_OR_QUICKNODE`],
  );
}

function readMagicBlockValidators(bindings: Bindings, network: Network): string[] {
  const rawValue =
    network === 'mainnet'
      ? bindings.MAGICBLOCK_MAINNET_VALIDATORS
      : bindings.MAGICBLOCK_DEVNET_VALIDATORS;

  return (rawValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function missingMagicBlockValidatorBindings(bindings: Bindings): string[] {
  return (['devnet', 'mainnet'] as const).flatMap((network) => {
    const validators = readMagicBlockValidators(bindings, network);
    const key =
      network === 'mainnet' ? 'MAGICBLOCK_MAINNET_VALIDATORS' : 'MAGICBLOCK_DEVNET_VALIDATORS';

    if (validators.length === 0) {
      return [key];
    }

    return validators.every(isValidSolanaAddress) ? [] : [`${key}_INVALID`];
  });
}

function getAndroidAttestationStatus(bindings: Bindings): FeatureConfigStatus {
  const mode = bindings.OFFPAY_ANDROID_ATTESTATION_MODE?.trim().toLowerCase();
  if (mode === 'prototype_bypass') {
    return withConfiguredState(
      bindings.NODE_ENV?.trim().toLowerCase() === 'production'
        ? ['OFFPAY_ANDROID_ATTESTATION_MODE_PRODUCTION_BYPASS']
        : [],
    );
  }

  return withConfiguredState(missingStringBindings(bindings, ANDROID_PLAY_INTEGRITY_BINDINGS));
}

function getWorkerConfigStatus(bindings: Bindings): WorkerConfigStatus {
  const protectedAuth = withConfiguredState(
    missingStringBindings(bindings, PROTECTED_AUTH_BINDINGS),
  );
  const androidAttestation = getAndroidAttestationStatus(bindings);
  const iosAttestation = withConfiguredState(
    missingStringBindings(bindings, IOS_APP_ATTEST_BINDINGS),
  );
  const pendingBackup = withConfiguredState(
    mergeMissing(
      protectedAuth.missing,
      missingStringBindings(bindings, PENDING_BACKUP_BINDINGS),
      hasR2Bucket(bindings) ? [] : ['PENDING_BACKUP_BUCKET'],
    ),
  );
  const swap = withConfiguredState(
    mergeMissing(protectedAuth.missing, missingStringBindings(bindings, SWAP_BINDINGS)),
  );
  const privateSwap = withConfiguredState(
    mergeMissing(
      swap.missing,
      missingRpcNetworkBindings(bindings),
      missingStringBindings(bindings, ['MAGICBLOCK_DEVNET_API_KEY', 'MAGICBLOCK_MAINNET_API_KEY']),
      missingMagicBlockValidatorBindings(bindings),
    ),
  );

  const ready =
    protectedAuth.configured &&
    androidAttestation.configured &&
    iosAttestation.configured &&
    pendingBackup.configured &&
    swap.configured;

  return {
    ready,
    degraded: ready && !privateSwap.configured,
    features: {
      androidAttestation,
      iosAttestation,
      pendingBackup,
      privateSwap,
      protectedAuth,
      swap,
    },
  };
}

function toPublicWorkerConfigStatus(status: WorkerConfigStatus): PublicWorkerConfigStatus {
  return {
    ready: status.ready,
    degraded: status.degraded,
    features: {
      androidAttestation: status.features.androidAttestation.configured,
      iosAttestation: status.features.iosAttestation.configured,
      pendingBackup: status.features.pendingBackup.configured,
      privateSwap: status.features.privateSwap.configured,
      protectedAuth: status.features.protectedAuth.configured,
      swap: status.features.swap.configured,
    },
  };
}

export { getWorkerConfigStatus, toPublicWorkerConfigStatus, type WorkerConfigStatus };
