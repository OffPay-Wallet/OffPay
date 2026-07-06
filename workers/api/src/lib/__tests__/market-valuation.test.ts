import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { memoryCache } from '../cache';
import { resolveTokenPriceBatch } from '../market-valuation';

import type { Bindings } from '../types';

const RWA_ASSET_MINT = '5yeucZisKb3uKCywapDwkZZr3YDeaQ71tu9YoTrD5WNC';
const RWA_SETTLEMENT_MINT = 'GN2nuuhUG2PnG6RsdGEcucuu1Ev2HRaacmrprVWBmKdE';
const RWA_PRICE_REFERENCE_MINT = 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W';
const JUPITER_BASE_URL = 'https://api.jup.ag';

const bindings = {
  JUPITER_API_KEY: 'jupiter-key',
  JUPITER_API_BASE_URL: JUPITER_BASE_URL,
  OFFPAY_RWA_DEVNET_SETTLEMENT_MINT: RWA_SETTLEMENT_MINT,
  OFFPAY_RWA_DEVNET_ASSETS_JSON: JSON.stringify([
    {
      mint: RWA_ASSET_MINT,
      symbol: 'SPYd',
      name: 'SP500 Sandbox RWA',
      decimals: 6,
      priceReferenceMint: RWA_PRICE_REFERENCE_MINT,
      underlyingSymbol: 'SPY',
    },
  ]),
} as Bindings;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

afterEach(() => {
  memoryCache.clear();
  jest.restoreAllMocks();
});

describe('market valuation', () => {
  it('prices devnet RWA settlement tokens as USD stables', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    const response = await resolveTokenPriceBatch({
      bindings,
      network: 'devnet',
      currency: 'USD',
      tokens: [
        {
          mint: RWA_SETTLEMENT_MINT,
          symbol: 'RWAUSDC',
          priceSymbol: 'RWAUSDC',
        },
      ],
    });

    expect(response.unitUsdPrices).toEqual({
      [RWA_SETTLEMENT_MINT]: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prices devnet RWA assets from their Jupiter reference mint', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(
        `${JUPITER_BASE_URL}/price/v3?ids=${encodeURIComponent(RWA_PRICE_REFERENCE_MINT)}`,
      );
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('jupiter-key');
      return jsonResponse({
        [RWA_PRICE_REFERENCE_MINT]: {
          usdPrice: 544.21,
        },
      });
    });

    const response = await resolveTokenPriceBatch({
      bindings,
      network: 'devnet',
      currency: 'USD',
      tokens: [
        {
          mint: RWA_ASSET_MINT,
          symbol: 'SPYd',
          priceSymbol: 'SPYd',
        },
      ],
    });

    expect(response.unitUsdPrices).toEqual({
      [RWA_ASSET_MINT]: 544.21,
    });
  });
});
