import {
  __INTERNAL_GET_IN_FLIGHT_SIZE,
  __INTERNAL_GET_SIGN_CACHE_SIZE,
  clearSignCache,
  getCachedOrSign,
  invalidateSignCacheForWallet,
} from '@/lib/crypto/sign-cache';

describe('sign-cache', () => {
  beforeEach(() => {
    clearSignCache();
  });

  it('returns the signer result on a cold call and caches it', async () => {
    const signer = jest.fn(async () => 'sig-cold');

    const first = await getCachedOrSign('wallet-a', 'msg-1', signer);
    const second = await getCachedOrSign('wallet-a', 'msg-1', signer);

    expect(first).toBe('sig-cold');
    expect(second).toBe('sig-cold');
    expect(signer).toHaveBeenCalledTimes(1);
    expect(__INTERNAL_GET_SIGN_CACHE_SIZE()).toBe(1);
  });

  it('dedups concurrent calls with the same key to a single signer invocation', async () => {
    const resolverHolder: { current: ((value: string) => void) | null } = { current: null };
    const signer = jest.fn(
      () => new Promise<string>((resolve) => {
        resolverHolder.current = resolve;
      }),
    );

    const firstPromise = getCachedOrSign('wallet-a', 'msg-shared', signer);
    const secondPromise = getCachedOrSign('wallet-a', 'msg-shared', signer);
    const thirdPromise = getCachedOrSign('wallet-a', 'msg-shared', signer);

    expect(signer).toHaveBeenCalledTimes(1);
    expect(__INTERNAL_GET_IN_FLIGHT_SIZE()).toBe(1);

    resolverHolder.current?.('sig-deduped');

    const [first, second, third] = await Promise.all([firstPromise, secondPromise, thirdPromise]);
    expect(first).toBe('sig-deduped');
    expect(second).toBe('sig-deduped');
    expect(third).toBe('sig-deduped');
    expect(signer).toHaveBeenCalledTimes(1);
    expect(__INTERNAL_GET_IN_FLIGHT_SIZE()).toBe(0);
  });

  it('does not collide across different wallets', async () => {
    const signerA = jest.fn(async () => 'sig-a');
    const signerB = jest.fn(async () => 'sig-b');

    const [resultA, resultB] = await Promise.all([
      getCachedOrSign('wallet-a', 'msg-1', signerA),
      getCachedOrSign('wallet-b', 'msg-1', signerB),
    ]);

    expect(resultA).toBe('sig-a');
    expect(resultB).toBe('sig-b');
    expect(signerA).toHaveBeenCalledTimes(1);
    expect(signerB).toHaveBeenCalledTimes(1);
    expect(__INTERNAL_GET_SIGN_CACHE_SIZE()).toBe(2);
  });

  it('does not collide across different messages for the same wallet', async () => {
    const signer = jest.fn(async (message: string) => `sig:${message}`);

    const [a, b, c] = await Promise.all([
      getCachedOrSign('wallet-a', 'msg-1', signer),
      getCachedOrSign('wallet-a', 'msg-2', signer),
      getCachedOrSign('wallet-a', 'msg-3', signer),
    ]);

    expect(a).toBe('sig:msg-1');
    expect(b).toBe('sig:msg-2');
    expect(c).toBe('sig:msg-3');
    expect(signer).toHaveBeenCalledTimes(3);
  });

  it('clears the in-flight entry even if the signer rejects', async () => {
    const failingSigner = jest.fn(async () => {
      throw new Error('privy-down');
    });

    await expect(getCachedOrSign('wallet-a', 'msg-fail', failingSigner)).rejects.toThrow(
      'privy-down',
    );
    expect(__INTERNAL_GET_IN_FLIGHT_SIZE()).toBe(0);
    expect(__INTERNAL_GET_SIGN_CACHE_SIZE()).toBe(0);

    // A retry must invoke the signer again (nothing is cached for failures).
    const recoveredSigner = jest.fn(async () => 'sig-recovered');
    const result = await getCachedOrSign('wallet-a', 'msg-fail', recoveredSigner);
    expect(result).toBe('sig-recovered');
    expect(recoveredSigner).toHaveBeenCalledTimes(1);
  });

  it('invalidates all entries for a single wallet but leaves other wallets intact', async () => {
    const signer = jest.fn(async (message: string) => `sig:${message}`);

    await getCachedOrSign('wallet-a', 'msg-1', signer);
    await getCachedOrSign('wallet-a', 'msg-2', signer);
    await getCachedOrSign('wallet-b', 'msg-1', signer);

    expect(__INTERNAL_GET_SIGN_CACHE_SIZE()).toBe(3);

    invalidateSignCacheForWallet('wallet-a');

    expect(__INTERNAL_GET_SIGN_CACHE_SIZE()).toBe(1);

    // wallet-a entries should re-invoke the signer; wallet-b should hit cache.
    const signerAfterInvalidate = jest.fn(async (message: string) => `sig:${message}`);
    const [a1, a2, b1] = await Promise.all([
      getCachedOrSign('wallet-a', 'msg-1', signerAfterInvalidate),
      getCachedOrSign('wallet-a', 'msg-2', signerAfterInvalidate),
      getCachedOrSign('wallet-b', 'msg-1', signerAfterInvalidate),
    ]);

    expect(a1).toBe('sig:msg-1');
    expect(a2).toBe('sig:msg-2');
    expect(b1).toBe('sig:msg-1');
    expect(signerAfterInvalidate).toHaveBeenCalledTimes(2);
  });

  it('expires cached entries after the TTL elapses', async () => {
    const signer = jest.fn(async () => 'sig-fresh');

    await getCachedOrSign('wallet-a', 'msg-1', signer);
    expect(__INTERNAL_GET_SIGN_CACHE_SIZE()).toBe(1);

    // Advance the system clock past the 45s TTL.
    const originalNow = Date.now;
    const baseTime = originalNow();
    let currentTime = baseTime;
    Date.now = () => currentTime;
    try {
      currentTime = baseTime + 46_000;
      // The cache should treat the entry as expired and call the signer again.
      const second = await getCachedOrSign('wallet-a', 'msg-1', signer);
      expect(second).toBe('sig-fresh');
      expect(signer).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it('does not serve a stale entry from a sibling wallet after invalidation clears in-flight', async () => {
    // Two different wallets, two different messages — both miss cache and
    // start signer calls in parallel. Invalidating one wallet must not
    // accidentally surface the other's pending result.
    const signer = jest.fn(async (message: string) => `sig:${message}`);

    const promiseA = getCachedOrSign('wallet-a', 'msg-1', signer);
    invalidateSignCacheForWallet('wallet-a');
    const result = await promiseA;

    expect(result).toBe('sig:msg-1');
  });
});
