import {
  assertAiProxyRateLimit,
  resetAiProxyRateLimitForTests,
} from '../rate-limit';

import type { AiProxyEnv } from '../types';

describe('AI Worker rate limit', () => {
  beforeEach(() => {
    resetAiProxyRateLimitForTests();
  });

  it('rejects repeated requests from the same Cloudflare client IP', () => {
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

    expect(() => assertAiProxyRateLimit(request, env)).not.toThrow();
    expect(() => assertAiProxyRateLimit(request, env)).not.toThrow();
    expect(() => assertAiProxyRateLimit(request, env)).toThrow('AI proxy rate limit exceeded.');
  });

  it('keeps separate client IPs in separate buckets', () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '1',
    };

    expect(() =>
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.10' },
        }),
        env,
      ),
    ).not.toThrow();

    expect(() =>
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.11' },
        }),
        env,
      ),
    ).not.toThrow();
  });

  it('keys authenticated callers by wallet subject so IP rotation does not bypass the limit', () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '2',
    };

    expect(() =>
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.10' },
        }),
        env,
        { walletSubject: 'Wallet1234' },
      ),
    ).not.toThrow();
    expect(() =>
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.20' }, // different IP, same wallet
        }),
        env,
        { walletSubject: 'Wallet1234' },
      ),
    ).not.toThrow();
    expect(() =>
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.30' },
        }),
        env,
        { walletSubject: 'Wallet1234' },
      ),
    ).toThrow('AI proxy rate limit exceeded.');
  });

  it('uses a tighter anonymous bucket when no wallet subject is bound', () => {
    const env: AiProxyEnv = {
      AI_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      AI_PROXY_RATE_LIMIT_MAX: '40',
    };
    const ip = '203.0.113.99';

    // Anonymous cap is min(8, configured) — so the 9th anonymous request
    // from the same IP must fail even though the authenticated max is 40.
    for (let index = 0; index < 8; index += 1) {
      expect(() =>
        assertAiProxyRateLimit(
          new Request('https://ai.offpay.test/api/ai/chat', {
            method: 'POST',
            headers: { 'cf-connecting-ip': ip },
          }),
          env,
        ),
      ).not.toThrow();
    }

    expect(() =>
      assertAiProxyRateLimit(
        new Request('https://ai.offpay.test/api/ai/chat', {
          method: 'POST',
          headers: { 'cf-connecting-ip': ip },
        }),
        env,
      ),
    ).toThrow('AI proxy rate limit exceeded.');
  });
});
