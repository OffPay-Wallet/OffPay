import {
  buildGeminiAgentTurnRequest,
  buildGemmaJsonAgentTurnRequest,
  generateGeminiAgentTurn,
  normalizeGeminiToolParameters,
  parseGemmaJsonAgentTurn,
} from '../providers/gemini';

describe('Gemini tool declaration normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
        },
      ],
    });

    expect(JSON.stringify(request)).toContain('agent_tool_calls');
    expect(JSON.stringify(request)).toContain('get_wallet_balance');
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
});
