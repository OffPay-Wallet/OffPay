import { describe, expect, it } from '@jest/globals';

import { getWorkerConfigStatus, toPublicWorkerConfigStatus } from '../config';

import type { Bindings } from '../types';

function androidProductionBindings(): Bindings {
  return {
    NODE_ENV: 'production',
    OFFPAY_PROTOTYPE_MODE: 'false',
    OFFPAY_INVITE_GATE_MODE: 'disabled',
    OFFPAY_ANDROID_PACKAGE_NAME: 'com.offpay.app',
    OFFPAY_ANDROID_MIN_VERSION_CODE: '1',
    OFFPAY_ANDROID_ATTESTATION_MODE: 'play_integrity',
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: 'play-integrity@offpay.test',
    GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: 'test-private-key',
    AI_PROXY_SESSION_SECRET: 'test-ai-session-secret-at-least-32-characters',
    OFFPAY_BOOTSTRAP_SECRET: 'bootstrap-secret',
    BOOTSTRAP_SECRET_VERSION: '1',
    MIN_APP_VERSION: '1.0.0',
    OFFPAY_BACKUP_HMAC_SECRET: 'backup-secret',
    UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
    UPSTASH_REDIS_REST_TOKEN: 'redis-token',
    HELIUS_DEVNET_API_KEY: 'helius-devnet',
    HELIUS_MAINNET_API_KEY: 'helius-mainnet',
    HELIUS_DEVNET_RPC_URL: 'https://devnet.offpay.test',
    HELIUS_MAINNET_RPC_URL: 'https://mainnet.offpay.test',
    JUPITER_API_KEY: 'jupiter-key',
    MAGICBLOCK_DEVNET_VALIDATORS: '',
    MAGICBLOCK_MAINNET_VALIDATORS: '',
    PENDING_BACKUP_BUCKET: {} as Bindings['PENDING_BACKUP_BUCKET'],
  };
}

describe('Android-only Worker readiness', () => {
  it('does not require iOS App Attest configuration for an Android production client', () => {
    const status = getWorkerConfigStatus(androidProductionBindings());

    expect(status.ready).toBe(true);
    expect(status.features.androidAttestation.configured).toBe(true);
    expect(status.features.iosAttestation.configured).toBe(false);
    expect(toPublicWorkerConfigStatus(status)).toMatchObject({
      ready: true,
      features: {
        androidAttestation: true,
        iosAttestation: false,
      },
    });
  });

  it('requires an explicit signing-certificate allowlist for sideload distribution', () => {
    const status = getWorkerConfigStatus({
      ...androidProductionBindings(),
      OFFPAY_ANDROID_DISTRIBUTION_MODE: 'sideload',
    });

    expect(status.ready).toBe(false);
    expect(status.features.androidAttestation).toEqual({
      configured: false,
      missing: ['OFFPAY_ANDROID_CERTIFICATE_SHA256_DIGESTS'],
    });
  });

  it('accepts a fully configured certificate-pinned sideload distribution', () => {
    const status = getWorkerConfigStatus({
      ...androidProductionBindings(),
      OFFPAY_ANDROID_DISTRIBUTION_MODE: 'sideload',
      OFFPAY_ANDROID_CERTIFICATE_SHA256_DIGESTS:
        '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
    });

    expect(status.ready).toBe(true);
    expect(status.features.androidAttestation.configured).toBe(true);
  });
});
