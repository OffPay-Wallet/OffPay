import { assertAiProxyRateLimit, resetAiProxyRateLimitForTests } from '../rate-limit';

import type { AiProxyEnv } from '../types';

describe('AI Worker rate limit', () => {
  beforeEach(() => {
    resetAiProxyRateLimitForTests();
  });

  it('rejects repeated requests from the same Cloudflare client IP', async () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '2',
    };
    const request = new Request('https://ai.offpay.test/api/ai/chat', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.10',
      },
    });

    await expect(assertAiProxyRateLimit(request, env)).resolves.toBeUndefined();
    await expect(assertAiProxyRateLimit(request, env)).resolves.toBeUndefined();
    await expect(assertAiProxyRateLimit(request, env)).rejects.toThrow(
      'AI proxy rate limit exceeded.',
    );
  });

  it('keeps separate client IPs in separate buckets', async () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '1',
    };

    await expect(
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.10' },
        }),
        env,
      ),
    ).resolves.toBeUndefined();

    await expect(
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.11' },
        }),
        env,
      ),
    ).resolves.toBeUndefined();
  });

  it('keys authenticated callers by wallet subject so IP rotation does not bypass the limit', async () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '2',
    };

    await expect(
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.10' },
        }),
        env,
        { walletSubject: 'Wallet1234' },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.20' }, // different IP, same wallet
        }),
        env,
        { walletSubject: 'Wallet1234' },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.30' },
        }),
        env,
        { walletSubject: 'Wallet1234' },
      ),
    ).rejects.toThrow('AI proxy rate limit exceeded.');
  });

  it('uses a tighter anonymous bucket when no wallet subject is bound', async () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '40',
    };
    const ip = '203.0.113.99';

    // Anonymous cap is min(8, configured) — so the 9th anonymous request
    // from the same IP must fail even though the authenticated max is 40.
    for (let index = 0; index < 8; index += 1) {
      await expect(
        assertAiProxyRateLimit(
          new Request('https://ai.offpay.test/api/ai/chat', {
            method: 'POST',
            headers: { 'cf-connecting-ip': ip },
          }),
          env,
        ),
      ).resolves.toBeUndefined();
    }

    await expect(
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': ip },
        }),
        env,
      ),
    ).rejects.toThrow('AI proxy rate limit exceeded.');
  });
});
