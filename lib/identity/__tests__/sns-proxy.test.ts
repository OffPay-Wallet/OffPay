import { fetchSnsProxyResult } from '@/lib/identity/sns-proxy';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('official SNS proxy response validation', () => {
  it('returns a successful string result from the pinned HTTPS origin', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ s: 'ok', result: '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY' }),
    });
    global.fetch = fetchMock as typeof fetch;

    await expect(
      fetchSnsProxyResult({ path: 'resolve/toly.sol', timeoutMs: 1_000, timeoutMessage: 'timeout' }),
    ).resolves.toBe('86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sdk-proxy.sns.id/resolve/toly.sol',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
  });

  it('maps the official error envelope to a missing registration', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ s: 'error', result: 'Domain not found' }),
    }) as typeof fetch;

    await expect(
      fetchSnsProxyResult({ path: 'resolve/missing.sol', timeoutMs: 1_000, timeoutMessage: 'timeout' }),
    ).resolves.toBeNull();
  });

  it('rejects malformed success envelopes instead of trusting them', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ s: 'ok', result: { owner: 'unexpected' } }),
    }) as typeof fetch;

    await expect(
      fetchSnsProxyResult({ path: 'resolve/bad.sol', timeoutMs: 1_000, timeoutMessage: 'timeout' }),
    ).rejects.toThrow('SNS returned an invalid response.');
  });
});
