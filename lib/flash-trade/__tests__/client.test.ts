import { FlashTradeClient } from '@/lib/flash-trade/client';

const originalFetch = global.fetch;

describe('FlashTradeClient', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('passes an abort signal to fetch when no caller signal is provided', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ markets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new FlashTradeClient({
      baseUrl: 'https://flash.example',
      timeoutMs: 1000,
    });

    await client.getMarkets();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
