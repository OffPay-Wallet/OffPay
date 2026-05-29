import * as SecureStore from 'expo-secure-store';

const KEYS = {
  REQUEST_SECRET: 'offpay_request_secret',
  BOOTSTRAP_VERSION: 'offpay_bootstrap_version',
  REQUEST_WALLET_ADDRESS: 'offpay_request_wallet_address',
  DEVICE_ID: 'offpay_device_id',
} as const;

const DEVICE_SECRET_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `offpay-${bytesToHex(bytes)}`;
}

export async function getOrCreateOffpayDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEYS.DEVICE_ID, DEVICE_SECRET_OPTIONS);
  if (existing != null && existing.length > 0) return existing;

  const deviceId = createDeviceId();
  await SecureStore.setItemAsync(KEYS.DEVICE_ID, deviceId, DEVICE_SECRET_OPTIONS);
  return deviceId;
}

export async function getOffpayRequestSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.REQUEST_SECRET, DEVICE_SECRET_OPTIONS);
}

export async function getOffpayRequestWalletAddress(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.REQUEST_WALLET_ADDRESS, DEVICE_SECRET_OPTIONS);
}

export async function setOffpayRequestSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.REQUEST_SECRET, secret, DEVICE_SECRET_OPTIONS);
}

export async function getOffpayBootstrapVersion(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(KEYS.BOOTSTRAP_VERSION, DEVICE_SECRET_OPTIONS);
  if (raw == null) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setOffpayBootstrapVersion(version: number): Promise<void> {
  await SecureStore.setItemAsync(
    KEYS.BOOTSTRAP_VERSION,
    String(version),
    DEVICE_SECRET_OPTIONS,
  );
}

export async function storeOffpayBootstrapCredentials(params: {
  secret: string;
  bootstrapVersion: number;
  walletAddress: string;
}): Promise<void> {
  await Promise.all([
    setOffpayRequestSecret(params.secret),
    setOffpayBootstrapVersion(params.bootstrapVersion),
    SecureStore.setItemAsync(
      KEYS.REQUEST_WALLET_ADDRESS,
      params.walletAddress,
      DEVICE_SECRET_OPTIONS,
    ),
  ]);
}

export async function clearOffpayBootstrapCredentials(): Promise<void> {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(KEYS.REQUEST_SECRET, DEVICE_SECRET_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.BOOTSTRAP_VERSION, DEVICE_SECRET_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.REQUEST_WALLET_ADDRESS, DEVICE_SECRET_OPTIONS),
  ]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (rejected != null) {
    throw new Error(
      rejected.reason instanceof Error
        ? `Failed to clear OffPay bootstrap credentials: ${rejected.reason.message}`
        : 'Failed to clear OffPay bootstrap credentials.',
    );
  }
}
