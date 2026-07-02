import { afterEach, describe, expect, it, jest } from '@jest/globals';

import router from '../router';

import type { AiProxyEnv } from '../types';

describe('AI chat response cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reuses a cached agent turn for duplicate turn retries', async () => {
    const kvStore = new Map<string, string>();
    let providerCalls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init): Promise<Response> => {
      const url = String(input);
      if (url.includes('generativelanguage.googleapis.com')) {
        providerCalls += 1;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Cached answer.' }],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      const commands = JSON.parse(String(init?.body ?? '[]')) as unknown[][];
      const results = commands.map((command) => {
        const name = String(command[0] ?? '').toUpperCase();
        const key = String(command[1] ?? '');
        if (name === 'INCR') return { result: 1 };
        if (name === 'EXPIRE') return { result: 1 };
        if (name === 'TTL') return { result: 60 };
        if (name === 'GET') return { result: kvStore.get(key) ?? null };
        if (name === 'SET') {
          kvStore.set(key, String(command[2] ?? ''));
          return { result: 'OK' };
        }
        return { result: null };
      });
      return new Response(JSON.stringify(results), { status: 200 });
    });

    const env: AiProxyEnv = {
      GEMINI_API_KEY: 'gemini-key',
      AI_PROXY_GEMINI_PRIVACY_CONFIRMED: 'true',
      UPSTASH_REDIS_REST_URL: 'https://upstash.offpay.test',
      UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      OFFPAY_API_AI_CREDITS: {
        getStatus: async () => ({
          kind: 'ai_chat_credits',
          limit: 5,
          used: 1,
          remaining: 4,
          resetAtMs: Date.now() + 60 * 60 * 1000,
          windowMs: 60 * 60 * 1000,
          subjectType: 'fallback',
        }),
        consume: async () => ({
          allowed: true,
          charged: true,
          status: {
            kind: 'ai_chat_credits',
            limit: 5,
            used: 1,
            remaining: 4,
            resetAtMs: Date.now() + 60 * 60 * 1000,
            windowMs: 60 * 60 * 1000,
            subjectType: 'fallback',
          },
        }),
      },
    };

    const request = () =>
      new Request('https://ai.offpay.test/api/ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-offpay-ai-turn-id': 'turn-cache-1',
        },
        body: JSON.stringify({
          responseMode: 'agent_turn',
          messages: [{ role: 'user', content: 'Say hi' }],
        }),
      });

    const first = await router.fetch(request(), env);
    const second = await router.fetch(request(), env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      turn: { kind: 'agent_text', text: 'Cached answer.' },
    });
    expect(providerCalls).toBe(1);
  });
});
