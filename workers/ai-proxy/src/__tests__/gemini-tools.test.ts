import {
  buildGeminiAgentTurnRequest,
  buildJsonAgentTurnRequest,
  generateGeminiAgentTurn,
  normalizeGeminiToolParameters,
  parseJsonAgentTurn,
  resetGeminiProviderCachesForTests,
} from '../providers/gemini';

describe('Gemini tool declaration normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetGeminiProviderCachesForTests();
  });

  it('normalizes app JSON Schema tool parameters for Gemini REST declarations', () => {
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

  it('does not attach extra tool config to Gemini native declarations', () => {
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

  it('builds a JSON protocol fallback prompt when Gemini rejects native tools', () => {
    const request = buildJsonAgentTurnRequest({
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

  it('parses JSON protocol tool calls from provider text', () => {
    const turn = parseJsonAgentTurn({
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

  it('uses Workers AI GLM before external chat providers', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Workers AI ready.',
          },
        },
      ],
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const turn = await generateGeminiAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Can you help?' }],
      },
      {
        AI: { run: aiRun },
        GEMINI_API_KEY: 'test-key',
        GROQ_API_KEY: 'groq-key',
      },
    );

    expect(aiRun).toHaveBeenCalledWith(
      '@cf/zai-org/glm-4.7-flash',
      expect.objectContaining({
        messages: expect.any(Array),
        max_completion_tokens: 192,
      }),
      {},
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(turn).toEqual({ kind: 'agent_text', text: 'Workers AI ready.' });
  });

  it('uses Workers AI native tool declarations instead of the JSON prompt', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      tool_calls: [
        {
          name: 'get_wallet_balance',
          arguments: {},
        },
      ],
    });

    const turn = await generateGeminiAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [{ role: 'user', content: 'Show my wallet balance' }],
        toolSchemas: [
          {
            name: 'get_wallet_balance',
            description: 'Returns wallet balance.',
            parameters: { type: 'object', properties: {} },
            xOffpay: {
              networkScope: 'devnet_and_mainnet',
              modelInstructions: ['Use for generic balance questions.'],
            },
          },
        ],
      },
      {
        AI: { run: aiRun },
      },
      { sessionAffinity: 'offpay-test-session' },
    );

    const providerBody = aiRun.mock.calls[0][1] as Record<string, unknown>;
    expect(providerBody).toMatchObject({
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_completion_tokens: 192,
    });
    expect(providerBody.tools).toEqual([
      expect.objectContaining({
        name: 'get_wallet_balance',
        parameters: { type: 'object', properties: {} },
      }),
    ]);
    expect(JSON.stringify(providerBody)).not.toContain('Available local tools');
    expect(aiRun.mock.calls[0][2]).toEqual({
      extraHeaders: {
        'x-session-affinity': 'offpay-test-session',
      },
    });
    expect(turn.kind).toBe('agent_tool_calls');
    if (turn.kind === 'agent_tool_calls') {
      expect(turn.toolCalls[0]).toMatchObject({
        name: 'get_wallet_balance',
        args: {},
      });
    }
  });

  it('uses a compact Workers AI final-answer prompt for replayed tool traces', async () => {
    const aiRun = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Tool result handled.',
          },
        },
      ],
    });

    const turn = await generateGeminiAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: [
          { role: 'user', content: 'Shield 5 usdc into Umbra' },
          { role: 'assistant', content: '' },
        ],
        assistantToolCalls: [
          {
            id: 'tool-1',
            name: 'draft_umbra_vault_action',
            args: { action: 'shield', amount: '5', token: 'USDC' },
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            name: 'draft_umbra_vault_action',
            result: { status: 'draft_ready' },
          },
        ],
        toolSchemas: [
          {
            name: 'draft_umbra_vault_action',
            description: 'Drafts an Umbra vault action.',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
      {
        AI: { run: aiRun },
        GEMINI_API_KEY: 'test-key',
      },
    );

    const providerBody = aiRun.mock.calls[0][1] as Record<string, unknown>;
    const serialized = JSON.stringify(providerBody);
    expect(providerBody).not.toHaveProperty('tools');
    expect(serialized).toContain('Local tool execution trace');
    expect(serialized).toContain('draft_umbra_vault_action');
    expect(serialized).not.toContain('Available local tools');
    expect(turn).toEqual({ kind: 'agent_text', text: 'Tool result handled.' });
  });

  it('falls back to Gemini when Workers AI fails', async () => {
    const aiRun = jest.fn().mockRejectedValueOnce(new Error('Workers AI overloaded'));
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Gemini fallback ready.',
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
        messages: [{ role: 'user', content: 'Can you help?' }],
      },
      {
        AI: { run: aiRun },
        GEMINI_API_KEY: 'test-key',
      },
    );

    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(turn).toEqual({ kind: 'agent_text', text: 'Gemini fallback ready.' });
  });

  it('falls back to JSON protocol when Gemini rejects the native agent-turn request', async () => {
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
        GEMINI_CHAT_MODEL: 'gemini-3.1-flash-lite',
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

  it('uses Groq when Gemini is rate-limited', async () => {
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
        GROQ_API_KEY: 'groq-key',
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(turn).toEqual({ kind: 'agent_text', text: 'Fallback is ready.' });
  });

  it('uses Groq streaming for streamed fallback agent turns', async () => {
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
            ': GROQ PROCESSING\n\n',
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
        GROQ_API_KEY: 'groq-key',
        GROQ_CHAT_MODEL: 'llama-3.1-8b-instant',
      },
      { streamGroqFallback: true },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      model: 'llama-3.1-8b-instant',
      stream: true,
      reasoning_effort: 'default',
    });
    expect(turn).toEqual({ kind: 'agent_text', text: 'Streamed fallback.' });
  });

  it('uses JSON protocol for replayed tool traces to avoid Gemini thought signature errors', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"kind":"agent_text","text":"Tool result handled."}',
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
        messages: [
          { role: 'user', content: 'Shield 5 usdc into Umbra' },
          { role: 'assistant', content: '' },
        ],
        assistantToolCalls: [
          {
            id: 'tool-1',
            name: 'draft_umbra_vault_action',
            args: { action: 'shield', amount: '5', token: 'USDC' },
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            name: 'draft_umbra_vault_action',
            result: { status: 'draft_ready' },
          },
        ],
        toolSchemas: [
          {
            name: 'draft_umbra_vault_action',
            description: 'Drafts an Umbra vault action.',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
      {
        GEMINI_API_KEY: 'test-key',
        GEMINI_CHAT_MODEL: 'gemini-3.1-flash-lite',
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const providerBody = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    const serialized = JSON.stringify(providerBody);
    expect(providerBody).not.toHaveProperty('tools');
    expect(serialized).not.toContain('functionCall');
    expect(serialized).not.toContain('functionResponse');
    expect(serialized).toContain('assistant_tool_calls');
    expect(serialized).toContain('tool_results');
    expect(turn).toEqual({ kind: 'agent_text', text: 'Tool result handled.' });
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
      GEMINI_CHAT_MODEL: 'gemini-3.1-flash-lite',
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
