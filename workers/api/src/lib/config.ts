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
    inviteGate: FeatureConfigStatus;
    marketPrices: FeatureConfigStatus;
    offline: FeatureConfigStatus;
    pendingBackup: FeatureConfigStatus;
    privatePayment: FeatureConfigStatus;
    privateSwap: FeatureConfigStatus;
    protectedAuth: FeatureConfigStatus;
    rpc: FeatureConfigStatus;
    swap: FeatureConfigStatus;
    umbra: FeatureConfigStatus;
    wallet: FeatureConfigStatus;
  };
}

interface PublicWorkerConfigStatus {
  ready: boolean;
  degraded: boolean;
  features: Record<keyof WorkerConfigStatus['features'], boolean>;
}

const NETWORKS = ['devnet', 'mainnet'] as const;

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
const MARKET_PRICE_BINDINGS: BindingKey[] = ['ALCHEMY_PRICE_API_KEY'];
const HELIUS_API_KEY_BINDINGS: BindingKey[] = ['HELIUS_DEVNET_API_KEY', 'HELIUS_MAINNET_API_KEY'];
const INVITE_GATE_BINDINGS: BindingKey[] = [
  'MONGODB_URI',
  'MONGODB_DATABASE',
  'OFFPAY_INVITE_CODE_PEPPER',
];
const MIN_INVITE_CODE_PEPPER_LENGTH = 32;

function hasStringBinding(bindings: Bindings, key: BindingKey): boolean {
  const value = bindings[key];
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTruthyStringBinding(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
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

function readConfiguredUrl(value: string | undefined, protocols: readonly string[]): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return protocols.includes(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

function hasRpcUrlForNetwork(bindings: Bindings, network: Network): boolean {
  const heliusUrl = readConfiguredUrl(
    network === 'mainnet' ? bindings.HELIUS_MAINNET_RPC_URL : bindings.HELIUS_DEVNET_RPC_URL,
    ['http:', 'https:'],
  );
  const alchemyUrl = readConfiguredUrl(
    network === 'mainnet' ? bindings.ALCHEMY_MAINNET_RPC_URL : bindings.ALCHEMY_DEVNET_RPC_URL,
    ['http:', 'https:'],
  );
  const alchemyFallbackUrl = readConfiguredUrl(
    network === 'mainnet'
      ? bindings.ALCHEMY_MAINNET_FALLBACK_RPC_URL
      : bindings.ALCHEMY_DEVNET_FALLBACK_RPC_URL,
    ['http:', 'https:'],
  );

  return heliusUrl != null || alchemyUrl != null || alchemyFallbackUrl != null;
}

function missingRpcNetworkBindings(bindings: Bindings): string[] {
  return NETWORKS.flatMap((network) =>
    hasRpcUrlForNetwork(bindings, network)
      ? []
      : [`${network.toUpperCase()}_RPC_URL_HELIUS_OR_ALCHEMY`],
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
  return NETWORKS.flatMap((network) => {
    const validators = readMagicBlockValidators(bindings, network);
    const key =
      network === 'mainnet' ? 'MAGICBLOCK_MAINNET_VALIDATORS' : 'MAGICBLOCK_DEVNET_VALIDATORS';

    if (validators.length === 0) {
      return [key];
    }

    return validators.every(isValidSolanaAddress) ? [] : [`${key}_INVALID`];
  });
}

function isProductionEnvironment(bindings: Bindings): boolean {
  return bindings.NODE_ENV?.trim().toLowerCase() === 'production';
}

function isPrototypeMode(bindings: Bindings): boolean {
  return hasTruthyStringBinding(bindings.OFFPAY_PROTOTYPE_MODE);
}

function isInviteGateEnabled(bindings: Bindings): boolean {
  const mode = bindings.OFFPAY_INVITE_GATE_MODE?.trim().toLowerCase();
  if (mode === 'disabled' || mode === 'off') return false;
  if (mode === 'required' || mode === 'enabled' || mode === 'on') return true;
  return isPrototypeMode(bindings);
}

function missingInviteGateBindings(bindings: Bindings): string[] {
  if (!isInviteGateEnabled(bindings)) return [];

  const missing = missingStringBindings(bindings, INVITE_GATE_BINDINGS);
  const pepper = bindings.OFFPAY_INVITE_CODE_PEPPER?.trim() ?? '';
  if (pepper.length > 0 && pepper.length < MIN_INVITE_CODE_PEPPER_LENGTH) {
    return mergeMissing(missing, ['OFFPAY_INVITE_CODE_PEPPER_MIN_32']);
  }

  return missing;
}

function isAndroidPrototypeBypassEnabled(bindings: Bindings): boolean {
  return (
    bindings.OFFPAY_ANDROID_ATTESTATION_MODE?.trim().toLowerCase() === 'prototype_bypass' &&
    (!isProductionEnvironment(bindings) || isPrototypeMode(bindings))
  );
}

function getAndroidAttestationStatus(bindings: Bindings): FeatureConfigStatus {
  const mode = bindings.OFFPAY_ANDROID_ATTESTATION_MODE?.trim().toLowerCase();
  if (mode === 'prototype_bypass') {
    return withConfiguredState(
      isAndroidPrototypeBypassEnabled(bindings) ? [] : ['OFFPAY_PROTOTYPE_MODE'],
    );
  }

  return withConfiguredState(missingStringBindings(bindings, ANDROID_PLAY_INTEGRITY_BINDINGS));
}

function getWorkerConfigStatus(bindings: Bindings): WorkerConfigStatus {
  const protectedAuth = withConfiguredState(
    missingStringBindings(bindings, PROTECTED_AUTH_BINDINGS),
  );
  const inviteGate = withConfiguredState(missingInviteGateBindings(bindings));
  const androidAttestation = getAndroidAttestationStatus(bindings);
  const iosAttestation = withConfiguredState(
    missingStringBindings(bindings, IOS_APP_ATTEST_BINDINGS),
  );
  const platformAttestationReady =
    androidAttestation.configured &&
    (iosAttestation.configured || isAndroidPrototypeBypassEnabled(bindings));
  const rpc = withConfiguredState(missingRpcNetworkBindings(bindings));
  const wallet = withConfiguredState(
    mergeMissing(rpc.missing, missingStringBindings(bindings, HELIUS_API_KEY_BINDINGS)),
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
  const marketPrices = withConfiguredState(missingStringBindings(bindings, MARKET_PRICE_BINDINGS));
  const privatePayment = withConfiguredState(
    mergeMissing(
      rpc.missing,
      missingMagicBlockValidatorBindings(bindings),
    ),
  );
  const privateSwap = withConfiguredState(
    mergeMissing(swap.missing, privatePayment.missing),
  );
  const offline = withConfiguredState(mergeMissing(protectedAuth.missing, rpc.missing));
  const umbra = withConfiguredState(rpc.missing);

  const ready =
    protectedAuth.configured &&
    platformAttestationReady &&
    pendingBackup.configured &&
    inviteGate.configured &&
    swap.configured &&
    wallet.configured &&
    rpc.configured;

  return {
    ready,
    degraded:
      ready &&
      ((!iosAttestation.configured && isAndroidPrototypeBypassEnabled(bindings)) ||
        !marketPrices.configured ||
        !privatePayment.configured ||
        !privateSwap.configured ||
        !offline.configured ||
        !umbra.configured),
    features: {
      androidAttestation,
      iosAttestation,
      inviteGate,
      marketPrices,
      offline,
      pendingBackup,
      privatePayment,
      privateSwap,
      protectedAuth,
      rpc,
      swap,
      umbra,
      wallet,
    },
  };
}

function toPublicWorkerConfigStatus(status: WorkerConfigStatus): PublicWorkerConfigStatus {
  return {
    ready: status.ready,
    degraded: status.degraded,
    features: Object.fromEntries(
      Object.entries(status.features).map(([key, value]) => [key, value.configured]),
    ) as PublicWorkerConfigStatus['features'],
  };
}

export { getWorkerConfigStatus, toPublicWorkerConfigStatus, type WorkerConfigStatus };
