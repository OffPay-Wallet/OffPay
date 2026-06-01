import {
  __clearUmbraZkManifestCacheForTesting,
  convertUmbraCircuitInputsToMoproInputs,
  convertNativeCircomProofToUmbraProofBytes,
  getRnUserRegistrationProver,
  getUmbraZkeyCacheFileName,
  isRnZkProverNativeModuleAvailable,
  resolveUmbraZkeyPath,
  serializeUmbraCircuitInputsForNativeProver,
  shouldRefreshUmbraZkeyAfterProofError,
} from '@/lib/umbra/umbra-rn-zk-prover';
import { File } from 'expo-file-system';
import { NativeModules } from 'react-native';

const originalFetch = global.fetch;

function buildManifest(version: string) {
  return {
    version,
    assets: {
      userRegistration: {
        url: `${version}/zkey-wasm/userregistration.zkey`,
        version,
      },
    },
  };
}

function mockManifestFetch(...manifests: ReturnType<typeof buildManifest>[]) {
  // The prover fetches the manifest once per resolve, and also issues a HEAD
  // against the zkey URL on every download to size-check the response. The
  // mock returns the next manifest for manifest fetches and a HEAD-style
  // response with a Content-Length header for zkey URLs.
  let manifestCallIndex = 0;
  const fetchMock = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (init?.method === 'HEAD') {
      return {
        ok: true,
        headers: {
          get: (key: string) =>
            key.toLowerCase() === 'content-length' ? String(10_000_001) : null,
        },
      } as unknown as Response;
    }
    if (url.includes('manifest.json')) {
      const index = Math.min(manifestCallIndex, manifests.length - 1);
      manifestCallIndex += 1;
      return {
        ok: true,
        json: async () => manifests[index],
      } as unknown as Response;
    }
    // Unknown URL – return a neutral empty response.
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('umbra-rn-zk-prover', () => {
  beforeEach(() => {
    (require('expo-file-system') as { __INTERNAL_RESET?: () => void }).__INTERNAL_RESET?.();
    delete (NativeModules as Record<string, unknown>).MoproFfi;
    global.fetch = originalFetch;
    __clearUmbraZkManifestCacheForTesting();
  });

  it('serializes bigint-heavy circuit inputs for the native bridge', () => {
    const inputs = {
      amount: 123n,
      nested: [1n, [2n]],
      bytes: new Uint8Array([3, 4]),
    };

    expect(convertUmbraCircuitInputsToMoproInputs(inputs)).toEqual({
      amount: ['123'],
      nested: ['1', '2'],
      bytes: ['3', '4'],
    });
    expect(serializeUmbraCircuitInputsForNativeProver(inputs)).toBe(
      '{"amount":["123"],"nested":["1","2"],"bytes":["3","4"]}',
    );
  });

  it('rejects null or undefined circuit scalars before handing them to Arkworks', () => {
    expect(() => convertUmbraCircuitInputsToMoproInputs({ privateKey: null })).toThrow(
      /null or undefined scalar/i,
    );
    expect(() => convertUmbraCircuitInputsToMoproInputs({ privateKey: undefined })).toThrow(
      /null or undefined scalar/i,
    );
  });

  it('uses Umbra native prover zkey filenames', () => {
    expect(getUmbraZkeyCacheFileName('userRegistration')).toBe('userregistration.zkey');
    expect(getUmbraZkeyCacheFileName('createDepositWithPublicAmount')).toBe(
      'createdepositwithpublicamount.zkey',
    );
    expect(getUmbraZkeyCacheFileName('claimDepositIntoConfidentialAmount', 'n1')).toBe(
      'claimdepositintoconfidentialamountn1.zkey',
    );
  });

  it('refreshes cached zkeys only for native Rust panic proof failures', () => {
    expect(shouldRefreshUmbraZkeyAfterProofError({ inner: ['Rust panic'] })).toBe(true);
    expect(shouldRefreshUmbraZkeyAfterProofError(new Error('Rust panic'))).toBe(true);
    expect(shouldRefreshUmbraZkeyAfterProofError(new Error('invalid witness input'))).toBe(false);
  });

  it('validates the downloaded zkey via the returned handle and normalizes it back to the canonical path', async () => {
    // Reproduces the device bug: on Android the response streams into the
    // destination and `File.downloadFileAsync` resolves to the *downloaded*
    // handle, whose uri can differ from the pre-download target. The resolver
    // must validate the returned handle, then move it back onto the
    // deterministic target path so future cache reuse (keyed by target.uri)
    // and offline reuse work without re-downloading.
    (NativeModules as Record<string, unknown>).MoproFfi = {};
    mockManifestFetch(buildManifest('v3'));
    const downloadFileAsync = File.downloadFileAsync as jest.Mock;
    downloadFileAsync.mockImplementationOnce(async (_url: string, destination: { uri: string }) => {
      const resolvedUri = `${destination.uri}.partial-resolved`;
      const resolved = new File(resolvedUri);
      resolved.write('x'.repeat(10_000_001));
      return resolved;
    });

    // Resolves to the canonical cache path, not the transient download uri.
    await expect(resolveUmbraZkeyPath('userRegistration')).resolves.toBe(
      '/cache/offpay-umbra-zk-assets/userregistration.zkey',
    );
    expect(downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached zkey on a second resolve after a different-uri download (no re-download)', async () => {
    // Guards the cache-key normalization: a download that resolved to a
    // non-canonical uri must still be reused next run instead of re-downloading
    // the ~76MB asset every time.
    (NativeModules as Record<string, unknown>).MoproFfi = {};
    mockManifestFetch(buildManifest('v3'));
    const downloadFileAsync = File.downloadFileAsync as jest.Mock;
    downloadFileAsync.mockImplementationOnce(async (_url: string, destination: { uri: string }) => {
      const resolved = new File(`${destination.uri}.partial-resolved`);
      resolved.write('x'.repeat(10_000_001));
      return resolved;
    });

    await resolveUmbraZkeyPath('userRegistration');
    await resolveUmbraZkeyPath('userRegistration');

    // Second resolve must hit the normalized cache, not download again.
    expect(downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects a truncated zkey download against the advertised content-length', async () => {
    // The HEAD response advertises 10_000_001 bytes (see mockManifestFetch),
    // but the download lands fewer bytes. Exact-size validation must fail and
    // the error must report the real byte count, never "null".
    (NativeModules as Record<string, unknown>).MoproFfi = {};
    mockManifestFetch(buildManifest('v3'));
    const downloadFileAsync = File.downloadFileAsync as jest.Mock;
    downloadFileAsync.mockImplementationOnce(async (_url: string, destination: { uri: string }) => {
      const resolved = new File(destination.uri);
      resolved.write('x'.repeat(9_000_000));
      return resolved;
    });

    await expect(resolveUmbraZkeyPath('userRegistration')).rejects.toThrow(
      /is incomplete \(got 9000000 bytes, expected 10000001\)/,
    );
  });

  it('reuses a cached zkey only while the manifest asset version still matches', async () => {
    (NativeModules as Record<string, unknown>).MoproFfi = {};
    const fetchMock = mockManifestFetch(buildManifest('v3'));
    const downloadFileAsync = File.downloadFileAsync as jest.Mock;

    await expect(resolveUmbraZkeyPath('userRegistration')).resolves.toBe(
      '/cache/offpay-umbra-zk-assets/userregistration.zkey',
    );
    await expect(resolveUmbraZkeyPath('userRegistration')).resolves.toBe(
      '/cache/offpay-umbra-zk-assets/userregistration.zkey',
    );

    // The remote manifest is cached briefly after the first resolve, so the
    // second resolve can reuse the local zkey without another manifest fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      'https://zk.api.umbraprivacy.com/v5/manifest.json',
    );
    expect(downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('replaces cached zkeys when the Umbra manifest version changes', async () => {
    (NativeModules as Record<string, unknown>).MoproFfi = {};
    mockManifestFetch(buildManifest('v3'), buildManifest('v4'));
    const downloadFileAsync = File.downloadFileAsync as jest.Mock;

    await resolveUmbraZkeyPath('userRegistration');
    __clearUmbraZkManifestCacheForTesting();
    await resolveUmbraZkeyPath('userRegistration');

    expect(downloadFileAsync).toHaveBeenCalledTimes(2);
    expect(downloadFileAsync.mock.calls[0]?.[0]).toBe(
      'https://zk.api.umbraprivacy.com/v3/zkey-wasm/userregistration.zkey',
    );
    expect(downloadFileAsync.mock.calls[1]?.[0]).toBe(
      'https://zk.api.umbraprivacy.com/v4/zkey-wasm/userregistration.zkey',
    );
  });

  it('wipes every cached zkey when the top-level manifest version bumps', async () => {
    (NativeModules as Record<string, unknown>).MoproFfi = {};
    // First call caches userRegistration on v3, second call caches it on v4.
    // Because the manifest version flipped, the previously cached
    // createDepositWithPublicAmount zkey must also be gone.
    const extendedManifest = (version: string) => ({
      version,
      assets: {
        userRegistration: {
          url: `${version}/zkey-wasm/userregistration.zkey`,
          version,
        },
        createDepositWithPublicAmount: {
          url: `${version}/zkey-wasm/createdepositwithpublicamount.zkey`,
          version,
        },
      },
    });
    let manifestCallIndex = 0;
    const fetchMock = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'HEAD') {
        return {
          ok: true,
          headers: {
            get: (key: string) =>
              key.toLowerCase() === 'content-length' ? String(10_000_001) : null,
          },
        } as unknown as Response;
      }
      if (url.includes('manifest.json')) {
        // Second manifest call onwards should return v4. The in-memory
        // manifest cache is cleared before the final resolve to simulate TTL
        // expiry without waiting in the test.
        const version = manifestCallIndex >= 1 ? 'v4' : 'v3';
        manifestCallIndex += 1;
        return { ok: true, json: async () => extendedManifest(version) } as unknown as Response;
      }
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({}),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await resolveUmbraZkeyPath('userRegistration');
    await resolveUmbraZkeyPath('createDepositWithPublicAmount');
    __clearUmbraZkManifestCacheForTesting();
    await resolveUmbraZkeyPath('userRegistration');

    const downloadFileAsync = File.downloadFileAsync as jest.Mock;
    // 1) userRegistration v3
    // 2) createDepositWithPublicAmount v3
    // 3) userRegistration v4 (manifest bumped → cache wiped → re-download)
    expect(downloadFileAsync).toHaveBeenCalledTimes(3);
    expect(downloadFileAsync.mock.calls[2]?.[0]).toBe(
      'https://zk.api.umbraprivacy.com/v4/zkey-wasm/userregistration.zkey',
    );
  });

  it('converts native circom proof coordinates into Umbra verifier byte layout', () => {
    const proofBytes = convertNativeCircomProofToUmbraProofBytes({
      a: { x: '1', y: '2', z: '1' },
      b: { x: ['3', '4'], y: ['5', '6'], z: ['1', '0'] },
      c: { x: '7', y: '8', z: '1' },
      protocol: 'groth16',
      curve: 'bn128',
    } as never);

    expect(proofBytes.proofA).toHaveLength(64);
    expect(proofBytes.proofB).toHaveLength(128);
    expect(proofBytes.proofC).toHaveLength(64);
    expect(Array.from(proofBytes.proofA.slice(-2))).toEqual([0, 2]);
    expect(proofBytes.proofB[31]).toBe(4);
    expect(proofBytes.proofB[63]).toBe(3);
    expect(proofBytes.proofB[95]).toBe(6);
    expect(proofBytes.proofB[127]).toBe(5);
    expect(Array.from(proofBytes.proofC.slice(-2))).toEqual([0, 8]);
  });

  it('does not import the native prover when MoproFfi is missing', async () => {
    expect(isRnZkProverNativeModuleAvailable()).toBe(false);

    await expect(getRnUserRegistrationProver().prove({} as never)).rejects.toThrow(
      'MoproFfi native module',
    );
  });
});
