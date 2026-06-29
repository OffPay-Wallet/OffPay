const originalProxyUrl = process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_URL;
const originalAllowedOrigins = process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS;
const originalFetch = global.fetch;

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function loadClient(): typeof import('@/lib/agentic-payments/ai-proxy-client') {
  jest.resetModules();
  process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_URL = 'https://ai.offpay.test';
  process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS = 'https://ai.offpay.test';
  return require('@/lib/agentic-payments/ai-proxy-client') as typeof import('@/lib/agentic-payments/ai-proxy-client');
}

function loadCreditPreloadModules(): {
  prefetchAiChatCredits: typeof import('@/hooks/agentic-chat/useAiChatCredits').prefetchAiChatCredits;
  useAiChatCreditsStore: typeof import('@/store/aiChatCreditsStore').useAiChatCreditsStore;
} {
  jest.resetModules();
  process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_URL = 'https://ai.offpay.test';
  process.env.EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS = 'https://ai.offpay.test';
  return {
    prefetchAiChatCredits: require('@/hooks/agentic-chat/useAiChatCredits').prefetchAiChatCredits,
    useAiChatCreditsStore: require('@/store/aiChatCreditsStore').useAiChatCreditsStore,
  };
}

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  restoreEnv('EXPO_PUBLIC_OFFPAY_AI_PROXY_URL', originalProxyUrl);
  restoreEnv('EXPO_PUBLIC_OFFPAY_AI_PROXY_ALLOWED_ORIGINS', originalAllowedOrigins);
});

describe('AI proxy credit request identity', () => {
  it('attaches the shared visible turn id to chat turn requests', async () => {
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        return new Response(
          JSON.stringify({
            turn: { kind: 'agent_text', text: 'Done.' },
            credits: {
              kind: 'ai_chat_credits',
              limit: 5,
              used: 1,
              remaining: 4,
              resetAtMs: Date.now() + 60 * 60 * 1000,
              windowMs: 60 * 60 * 1000,
              subjectType: 'wallet',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    ) as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;

    const { sendAgentTurn } = loadClient();
    await sendAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Send 1 SOL' }],
      },
      { timeoutMs: 5_000, userTurnId: 'ai-turn-visible-1' },
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    if (init == null) throw new Error('fetch init missing');
    const headers = new Headers(init.headers);
    expect(headers.get('x-offpay-ai-turn-id')).toBe('ai-turn-visible-1');
  });

  it('dedupes scoped credit preloads and stores the count before chat mounts', async () => {
    const resetAtMs = Date.now() + 60 * 60 * 1000;
    const fetchMock = jest.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        return new Response(
          JSON.stringify({
            credits: {
              kind: 'ai_chat_credits',
              limit: 5,
              used: 0,
              remaining: 5,
              resetAtMs,
              windowMs: 60 * 60 * 1000,
              subjectType: 'wallet',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    ) as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;

    const { prefetchAiChatCredits, useAiChatCreditsStore } = loadCreditPreloadModules();
    const scopeKey = 'devnet:wallet:wallet-1';

    const first = prefetchAiChatCredits(scopeKey, { timeoutMs: 5_000 });
    const second = prefetchAiChatCredits(scopeKey, { timeoutMs: 5_000 });
    await expect(first).resolves.toMatchObject({ remaining: 5, limit: 5 });
    await expect(second).resolves.toMatchObject({ remaining: 5, limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAiChatCreditsStore.getState()).toMatchObject({
      scopeKey,
      credits: {
        remaining: 5,
        limit: 5,
      },
      loading: false,
      error: null,
    });
  });

  it('locally resets partially used credits when the tracked window expires', () => {
    const { useAiChatCreditsStore } = loadCreditPreloadModules();
    const scopeKey = 'devnet:wallet:wallet-reset';
    const resetAtMs = Date.now() + 1_000;

    useAiChatCreditsStore.getState().setCredits(
      {
        kind: 'ai_chat_credits',
        limit: 5,
        used: 2,
        remaining: 3,
        resetAtMs,
        windowMs: 60 * 60 * 1000,
        subjectType: 'wallet',
      },
      scopeKey,
    );

    expect(useAiChatCreditsStore.getState().resetExpiredCredits(scopeKey, resetAtMs + 1)).toBe(
      true,
    );
    expect(useAiChatCreditsStore.getState().credits).toMatchObject({
      used: 0,
      remaining: 5,
      limit: 5,
    });
  });
});
