import {
  OffpayAttestationUnavailableError,
  createExpoAppIntegrityAttestationAdapter,
} from '@/lib/bootstrap/attestation';

const originalProjectNumber = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;

function restoreProjectNumber(): void {
  if (originalProjectNumber == null) {
    delete process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
    return;
  }
  process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER = originalProjectNumber;
}

describe('Expo app-integrity bootstrap adapter', () => {
  afterEach(() => {
    restoreProjectNumber();
    jest.restoreAllMocks();
  });

  it('prepares Play Integrity and binds the request hash to the bootstrap nonce', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER = '123456789012';
    const prepareIntegrityTokenProviderAsync = jest.fn().mockResolvedValue(undefined);
    const requestIntegrityCheckAsync = jest.fn().mockResolvedValue('integrity-token');
    const adapter = createExpoAppIntegrityAttestationAdapter(async () => ({
      isSupported: false,
      attestKeyAsync: jest.fn(),
      generateKeyAsync: jest.fn(),
      prepareIntegrityTokenProviderAsync,
      requestIntegrityCheckAsync,
    }));

    await expect(
      adapter.collectAttestation({
        nonce: 'bootstrap-nonce',
        nonceHashBase64Url: 'nonce-request-hash',
        platform: 'android',
      }),
    ).resolves.toEqual({
      platform: 'android',
      attestationToken: 'integrity-token',
    });
    expect(prepareIntegrityTokenProviderAsync).toHaveBeenCalledWith('123456789012');
    expect(requestIntegrityCheckAsync).toHaveBeenCalledWith('nonce-request-hash');
  });

  it('re-prepares an expired Play Integrity provider exactly once', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER = '223456789012';
    const providerError = Object.assign(new Error('provider expired'), {
      code: 'ERR_APP_INTEGRITY_PROVIDER_INVALID',
    });
    const prepareIntegrityTokenProviderAsync = jest.fn().mockResolvedValue(undefined);
    const requestIntegrityCheckAsync = jest
      .fn()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce('fresh-integrity-token');
    const adapter = createExpoAppIntegrityAttestationAdapter(async () => ({
      isSupported: false,
      attestKeyAsync: jest.fn(),
      generateKeyAsync: jest.fn(),
      prepareIntegrityTokenProviderAsync,
      requestIntegrityCheckAsync,
    }));

    await expect(
      adapter.collectAttestation({
        nonce: 'bootstrap-nonce',
        nonceHashBase64Url: 'nonce-request-hash',
        platform: 'android',
      }),
    ).resolves.toEqual({
      platform: 'android',
      attestationToken: 'fresh-integrity-token',
    });
    expect(prepareIntegrityTokenProviderAsync).toHaveBeenCalledTimes(2);
    expect(requestIntegrityCheckAsync).toHaveBeenCalledTimes(2);
  });

  it('creates an App Attest key and binds its attestation to the bootstrap nonce', async () => {
    const generateKeyAsync = jest.fn().mockResolvedValue('apple-key-id');
    const attestKeyAsync = jest.fn().mockResolvedValue('apple-attestation');
    const adapter = createExpoAppIntegrityAttestationAdapter(async () => ({
      isSupported: true,
      attestKeyAsync,
      generateKeyAsync,
      prepareIntegrityTokenProviderAsync: jest.fn(),
      requestIntegrityCheckAsync: jest.fn(),
    }));

    await expect(
      adapter.collectAttestation({
        nonce: 'bootstrap-nonce',
        nonceHashBase64Url: 'nonce-request-hash',
        platform: 'ios',
      }),
    ).resolves.toEqual({
      platform: 'ios',
      attestationKeyId: 'apple-key-id',
      attestationToken: 'apple-attestation',
    });
    expect(attestKeyAsync).toHaveBeenCalledWith('apple-key-id', 'bootstrap-nonce');
  });

  it('fails closed when Play Integrity is not configured', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;
    const adapter = createExpoAppIntegrityAttestationAdapter(async () => ({
      isSupported: false,
      attestKeyAsync: jest.fn(),
      generateKeyAsync: jest.fn(),
      prepareIntegrityTokenProviderAsync: jest.fn(),
      requestIntegrityCheckAsync: jest.fn(),
    }));

    await expect(
      adapter.collectAttestation({
        nonce: 'bootstrap-nonce',
        nonceHashBase64Url: 'nonce-request-hash',
        platform: 'android',
      }),
    ).rejects.toBeInstanceOf(OffpayAttestationUnavailableError);
  });
});
