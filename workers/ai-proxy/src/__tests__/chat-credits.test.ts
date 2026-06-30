import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  consumeAiChatCredit,
  getAiChatCreditStatus,
  releaseAiChatCredit,
  type AiChatCreditConsumptionResult,
  type AiChatCreditStatus,
} from '../chat-credits';
import router from '../router';

import type { AiProxyEnv } from '../types';

const originalFetch = global.fetch;

function status(overrides: Partial<AiChatCreditStatus> = {}): AiChatCreditStatus {
  return {
    kind: 'ai_chat_credits',
    limit: 5,
    used: 0,
    remaining: 5,
    resetAtMs: Date.now() + 60 * 60 * 1000,
    windowMs: 60 * 60 * 1000,
    subjectType: 'fallback',
    ...overrides,
  };
}

function envWithService(service: AiProxyEnv['OFFPAY_API_AI_CREDITS']): AiProxyEnv {
  return {
    OFFPAY_API_AI_CREDITS: service,
  };
}

describe('AI chat credit service binding', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('serves current credits from the router status endpoint', async () => {
    const env = envWithService({
      getStatus: async () => status(),
      consume: async () => ({
        allowed: true,
        charged: true,
        status: status({ used: 1, remaining: 4 }),
      }),
    });

    const response = await router.fetch(
      new Request('https://ai.offpay.test/api/ai/credits', { method: 'GET' }),
      env,
    );
    const body = (await response.json()) as { credits?: unknown };

    expect(response.status).toBe(200);
    expect(body.credits).toMatchObject({
      kind: 'ai_chat_credits',
      limit: 5,
      used: 0,
      remaining: 5,
      subjectType: 'fallback',
    });
    expect(response.headers.get('X-Offpay-AI-Credits-Limit')).toBe('5');
    expect(response.headers.get('X-Offpay-AI-Credits-Remaining')).toBe('5');
  });

  it('forwards one visible turn id to the API worker credit service', async () => {
    let receivedPayload: unknown = null;
    const service = {
      getStatus: async () => status(),
      consume: async (payload: unknown): Promise<AiChatCreditConsumptionResult> => {
        receivedPayload = payload;
        return {
          allowed: true,
          charged: true,
          status: status({ used: 1, remaining: 4, subjectType: 'wallet' }),
        };
      },
    };

    const result = await consumeAiChatCredit(
      new Request('https://ai.offpay.test/api/ai/chat', {
        method: 'POST',
        headers: {
          'x-offpay-ai-turn-id': 'ai-turn-visible-1',
        },
      }),
      envWithService(service),
      {
        walletSubject: 'Wallet111',
        deviceId: 'device-1',
      },
    );

    expect(result).toMatchObject({
      allowed: true,
      status: { used: 1, remaining: 4, subjectType: 'wallet' },
    });
    expect(receivedPayload).toMatchObject({
      walletSubject: 'Wallet111',
      turnId: 'ai-turn-visible-1',
    });
    expect(typeof (receivedPayload as { fallbackSubjectKey?: unknown }).fallbackSubjectKey).toBe(
      'string',
    );
  });

  it('forwards one visible turn id to the API worker credit release service', async () => {
    let receivedPayload: unknown = null;
    let receivedReason: unknown = null;
    const service = {
      getStatus: async () => status(),
      consume: async (): Promise<AiChatCreditConsumptionResult> => ({
        allowed: true,
        charged: true,
        status: status({ used: 1, remaining: 4 }),
      }),
      release: async (payload: unknown, reason: string): Promise<AiChatCreditStatus> => {
        receivedPayload = payload;
        receivedReason = reason;
        return status();
      },
    };

    const released = await releaseAiChatCredit(
      new Request('https://ai.offpay.test/api/ai/chat', {
        method: 'POST',
        headers: {
          'x-offpay-ai-turn-id': 'ai-turn-visible-2',
        },
      }),
      envWithService(service),
      {
        walletSubject: 'Wallet111',
        deviceId: 'device-1',
      },
      'provider_timeout',
    );

    expect(released).toMatchObject({ used: 0, remaining: 5 });
    expect(receivedPayload).toMatchObject({
      walletSubject: 'Wallet111',
      turnId: 'ai-turn-visible-2',
    });
    expect(receivedReason).toBe('provider_timeout');
  });

  it('releases a charged credit when the provider times out', async () => {
    let releasePayload: unknown = null;
    let releaseReason: unknown = null;
    const service = {
      getStatus: async () => status(),
      consume: async (): Promise<AiChatCreditConsumptionResult> => ({
        allowed: true,
        charged: true,
        status: status({ used: 1, remaining: 4, subjectType: 'wallet' }),
      }),
      release: async (payload: unknown, reason: string): Promise<AiChatCreditStatus> => {
        releasePayload = payload;
        releaseReason = reason;
        return status({ used: 0, remaining: 5, subjectType: 'wallet' });
      },
    };
    global.fetch = jest.fn(
      async (): Promise<Response> =>
        new Response('provider timeout', {
          status: 504,
          headers: { 'content-type': 'text/plain' },
        }),
    ) as jest.MockedFunction<typeof fetch>;

    const response = await router.fetch(
      new Request('https://ai.offpay.test/api/ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-offpay-ai-turn-id': 'ai-turn-timeout-1',
        },
        body: JSON.stringify({
          responseMode: 'agent_turn',
          messages: [{ role: 'user', content: 'Show my wallet balance' }],
        }),
      }),
      {
        ...envWithService(service),
        AI_PROXY_PRIVACY_MODE: 'relaxed',
        GEMINI_API_KEY: 'test-gemini-key',
      },
    );
    const body = (await response.json()) as {
      code?: unknown;
      credits?: unknown;
      message?: unknown;
    };

    expect(response.status).toBe(504);
    expect(body.code).toBe('UPSTREAM_TIMEOUT');
    expect(body.message).toBe('The AI provider timed out. Your credit was not used. Try again.');
    expect(body.credits).toMatchObject({ used: 0, remaining: 5, subjectType: 'wallet' });
    expect(response.headers.get('X-Offpay-AI-Credits-Remaining')).toBe('5');
    expect(releasePayload).toMatchObject({ turnId: 'ai-turn-timeout-1' });
    expect(releaseReason).toBe('provider_timeout');
  });

  it('does not release a duplicate turn that was not newly charged', async () => {
    const release = jest.fn(async () => status({ used: 0, remaining: 5 }));
    const service = {
      getStatus: async () => status(),
      consume: async (): Promise<AiChatCreditConsumptionResult> => ({
        allowed: true,
        charged: false,
        status: status({ used: 1, remaining: 4, subjectType: 'wallet' }),
      }),
      release,
    };
    global.fetch = jest.fn(
      async (): Promise<Response> => new Response('provider timeout', { status: 504 }),
    ) as jest.MockedFunction<typeof fetch>;

    const response = await router.fetch(
      new Request('https://ai.offpay.test/api/ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-offpay-ai-turn-id': 'ai-turn-retry-1',
        },
        body: JSON.stringify({
          responseMode: 'agent_turn',
          messages: [{ role: 'user', content: 'Show my wallet balance' }],
        }),
      }),
      {
        ...envWithService(service),
        AI_PROXY_PRIVACY_MODE: 'relaxed',
        GEMINI_API_KEY: 'test-gemini-key',
      },
    );
    const body = (await response.json()) as { credits?: unknown };

    expect(response.status).toBe(504);
    expect(body.credits).toMatchObject({ used: 1, remaining: 4 });
    expect(release).not.toHaveBeenCalled();
  });

  it('fails closed when the API worker binding is missing', async () => {
    await expect(
      getAiChatCreditStatus(
        new Request('https://ai.offpay.test/api/ai/credits'),
        {},
        { walletSubject: 'Wallet111' },
      ),
    ).rejects.toThrow('Yuga credit service binding is not configured.');
  });
});
