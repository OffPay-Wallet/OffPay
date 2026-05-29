import { parseSseEvents } from '@/lib/agentic-payments/ai-proxy-client';

describe('parseSseEvents', () => {
  it('parses delta + done events from a complete SSE buffer', () => {
    const sse = [
      'event: chat_delta',
      'data: {"kind":"chat_delta","text":"Hi"}',
      '',
      'event: chat_delta',
      'data: {"kind":"chat_delta","text":" there"}',
      '',
      'event: chat_done',
      'data: {"kind":"chat_done","responseId":"abc"}',
      '',
      '',
    ].join('\n');

    const events = parseSseEvents(sse);

    expect(events).toEqual([
      { kind: 'chat_delta', text: 'Hi' },
      { kind: 'chat_delta', text: ' there' },
      { kind: 'chat_done', responseId: 'abc' },
    ]);
  });

  it('skips [DONE] sentinels and empty data lines', () => {
    const sse = ['data: [DONE]', '', 'data: ', '', ''].join('\n');
    expect(parseSseEvents(sse)).toEqual([]);
  });

  it('passes error events through verbatim', () => {
    const sse = [
      'event: error',
      'data: {"kind":"error","code":"UPSTREAM_TIMEOUT","message":"timeout","retryAfterMs":5000}',
      '',
      '',
    ].join('\n');

    expect(parseSseEvents(sse)).toEqual([
      {
        kind: 'error',
        code: 'UPSTREAM_TIMEOUT',
        message: 'timeout',
        retryAfterMs: 5000,
      },
    ]);
  });
});
