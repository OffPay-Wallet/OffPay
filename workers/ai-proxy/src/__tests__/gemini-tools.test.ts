import {
  buildGeminiAgentTurnRequest,
  buildGemmaJsonAgentTurnRequest,
  generateGeminiAgentTurn,
  normalizeGeminiToolParameters,
  parseGemmaJsonAgentTurn,
  resetGeminiProviderCachesForTests,
} from '../providers/gemini';

describe('Gemini tool declaration normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetGeminiProviderCachesForTests();
  });

  it('normalizes app JSON Schema tool parameters for Gemma REST declarations', () => {
    expect(
      normalizeGeminiToolParameters({
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token symbol.' },
          tokens: {
            type: 'array',
            items: { type: 'string' },
            description: 'Token symbols.',
          },
          limit: { type: 'number' },
          route: { type: 'string', enum: ['normal', 'umbra'] },
        },
      }),
    ).toEqual({
      type: 'OBJECT',
      properties: {
        token: { type: 'STRING', description: 'Token symbol.' },
        tokens: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Token symbols.',
        },
        limit: { type: 'NUMBER' },
        route: { type: 'STRING', enum: ['normal', 'umbra'] },
      },
    });
  });

  it('omits parameter objects for no-argument tools', () => {
    expect(
      normalizeGeminiToolParameters({
        type: 'object',
        properties: {},
      }),
    ).toBeNull();
  });

  it('does not attach extra tool config to Gemma native declarations', () => {
    const request = buildGeminiAgentTurnRequest({
      responseMode: 'agent_turn',
      messages: [{ role: 'user', content: 'Show my wallet balance' }],
      toolSchemas: [
        {
          name: 'get_wallet_balance',
          description: 'Returns wallet balance.',
          parameters: { type: 'object', properties: {} },
          xOffpay: {
            category: 'wallet_read',
            networkScope: 'devnet_and_mainnet',
            pendingLabel: 'Checking wallet balance',
            modelInstructions: ['Use for generic balance questions.'],
          },
        },
      ],
    });

    expect(request.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'get_wallet_balance',
            description: 'Returns wallet balance.',
          },
        ],
      },
    ]);
    expect(request).not.toHaveProperty('toolConfig');
  });

  it('builds a JSON protocol fallback prompt when Gemma rejects native tools', () => {
    const request = buildGemmaJsonAgentTurnRequest({
      responseMode: 'agent_turn',
      messages: [{ role: 'user', content: 'Show my wallet balance' }],
      toolSchemas: [
        {
          name: 'get_wallet_balance',
          description: 'Returns wallet balance.',
          parameters: { type: 'object', properties: {} },
          xOffpay: {
            category: 'wallet_read',
            networkScope: 'devnet_and_mainnet',
            pendingLabel: 'Checking wallet balance',
            modelInstructions: ['Use for generic balance questions.'],
          },
        },
      ],
    });

    expect(request).toMatchObject({
      contents: [{ role: 'user' }],
    });
    expect(JSON.stringify(request)).toContain('agent_tool_calls');
    expect(JSON.stringify(request)).toContain('get_wallet_balance');
    expect(JSON.stringify(request)).toContain('devnet_and_mainnet');
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('systemInstruction');
  });

  it('parses JSON protocol tool calls from Gemma text', () => {
    const turn = parseGemmaJsonAgentTurn({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"kind":"agent_tool_calls","toolCalls":[{"name":"get_wallet_balance","args":{}}]}',
              },
            ],
          },
        },
      ],
    });

    expect(turn.kind).toBe('agent_tool_calls');
    if (turn.kind === 'agent_tool_calls') {
      expect(turn.toolCalls[0]).toMatchObject({
        name: 'get_wallet_balance',
        args: {},
      });
      expect(turn.toolCalls[0].id).toEqual(expect.any(String));
    }
  });

  it('falls back to JSON protocol when Gemma rejects the native agent-turn request', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"kind":"agent_tool_calls","toolCalls":[{"name":"get_wallet_balance","args":{}}]}',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const turn = await generateGeminiAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Show my wallet balance' }],
        toolSchemas: [
          {
            name: 'get_wallet_balance',
            description: 'Returns wallet balance.',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
      {
        GEMINI_API_KEY: 'test-key',
        GEMINI_CHAT_MODEL: 'gemma-4-26b-a4b-it',
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(turn.kind).toBe('agent_tool_calls');
    if (turn.kind === 'agent_tool_calls') {
      expect(turn.toolCalls[0]).toMatchObject({
        name: 'get_wallet_balance',
        args: {},
      });
    }
  });

  it('uses OpenRouter when Gemini is rate-limited', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"kind":"agent_text","text":"Fallback is ready."}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const turn = await generateGeminiAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Can you help?' }],
      },
      {
        GEMINI_API_KEY: 'test-key',
        OPENROUTER_API_KEY: 'openrouter-key',
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(turn).toEqual({ kind: 'agent_text', text: 'Fallback is ready.' });
  });

  it('uses OpenRouter streaming for streamed fallback agent turns', async () => {
    const sseChunk = (content: string): string =>
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            ': OPENROUTER PROCESSING\n\n',
            sseChunk('{"kind":"agent_text",'),
            sseChunk('"text":"Streamed fallback."}'),
            'data: [DONE]\n\n',
          ].join(''),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      );

    const turn = await generateGeminiAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Can you help?' }],
      },
      {
        GEMINI_API_KEY: 'test-key',
        OPENROUTER_API_KEY: 'openrouter-key',
        OPENROUTER_CHAT_MODEL: 'google/gemma-4-31b-it:free',
      },
      { streamOpenRouterFallback: true },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      model: 'google/gemma-4-31b-it:free',
      stream: true,
    });
    expect(turn).toEqual({ kind: 'agent_text', text: 'Streamed fallback.' });
  });

  it('caches native tool rejection and skips the failed native attempt on the next turn', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"kind":"agent_text","text":"JSON fallback one"}',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"kind":"agent_text","text":"JSON fallback two"}',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const request = {
      responseMode: 'agent_turn' as const,
      messages: [{ role: 'user' as const, content: 'Show my wallet balance' }],
      toolSchemas: [
        {
          name: 'get_wallet_balance',
          description: 'Returns wallet balance.',
          parameters: { type: 'object', properties: {} },
        },
      ],
    };
    const env = {
      GEMINI_API_KEY: 'test-key',
      GEMINI_CHAT_MODEL: 'gemma-4-26b-a4b-it',
    };

    await expect(generateGeminiAgentTurn(request, env)).resolves.toEqual({
      kind: 'agent_text',
      text: 'JSON fallback one',
    });
    await expect(generateGeminiAgentTurn(request, env)).resolves.toEqual({
      kind: 'agent_text',
      text: 'JSON fallback two',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String((fetchSpy.mock.calls[2][1] as RequestInit).body))).not.toHaveProperty(
      'tools',
    );
  });
});
