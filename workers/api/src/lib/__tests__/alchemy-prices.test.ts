import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { fetchAlchemyHistoricalTokenUsdPrices } from '../alchemy-prices';

import type { Bindings } from '../types';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Alchemy historical prices', () => {
  it('treats an unsupported token as empty history', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Token not found' } }), { status: 404 }),
    );

    await expect(
      fetchAlchemyHistoricalTokenUsdPrices(
        { ALCHEMY_PRICE_API_KEY: 'test-key' } as Bindings,
        { type: 'symbol', symbol: 'UNKNOWN' },
        {
          startTime: '2026-07-11T00:00:00Z',
          endTime: '2026-07-12T00:00:00Z',
          interval: '1h',
        },
      ),
    ).resolves.toEqual([]);
  });
});
