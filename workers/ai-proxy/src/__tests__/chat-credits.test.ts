import { describe, expect, it } from '@jest/globals';

import {
  consumeAiChatCredit,
  getAiChatCreditStatus,
  type AiChatCreditConsumptionResult,
  type AiChatCreditStatus,
} from '../chat-credits';
import router from '../router';

import type { AiProxyEnv } from '../types';

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
  it('serves current credits from the router status endpoint', async () => {
    const env = envWithService({
      getStatus: async () => status(),
      consume: async () => ({ allowed: true, status: status({ used: 1, remaining: 4 }) }),
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
        return { allowed: true, status: status({ used: 1, remaining: 4, subjectType: 'wallet' }) };
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
