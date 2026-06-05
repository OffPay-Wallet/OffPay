import { Hono } from 'hono';
import { z } from 'zod';
import {
  fetchAlchemyHistoricalTokenUsdPrices,
  fetchAlchemyTokenUsdPrice,
} from '../lib/alchemy-prices.js';
import { fetchUsdToCurrencyRate } from '../lib/fx-rates.js';
import type { AppEnv } from '../lib/types.js';
import { networkSchema, readJsonBody, readSearchParams } from '../lib/validation.js';

const priceIdentifierSchema = z.union([
  z.object({
    type: z.literal('symbol'),
    symbol: z.string().trim().min(1).max(24),
  }),
  z.object({
    type: z.literal('address'),
    network: z.string().trim().min(1).max(64),
    address: z.string().trim().min(1).max(128),
  }),
]);

const tokenPriceBodySchema = z.object({
  identifier: priceIdentifierSchema,
  network: networkSchema,
});

const historicalTokenPriceBodySchema = z.object({
  identifier: priceIdentifierSchema,
  startTime: z.string().trim().min(1).max(64),
  endTime: z.string().trim().min(1).max(64),
  interval: z.enum(['5m', '1h', '1d']),
  withMarketData: z.boolean().optional(),
  network: networkSchema,
});

const fxRateQuerySchema = z.object({
  currency: z.string().trim().min(3).max(3),
});

const marketRoutes = new Hono<AppEnv>();

marketRoutes.get('/fx-rate', async (context) => {
  const query = readSearchParams(context.req.url, fxRateQuerySchema);
  const response = context.json(await fetchUsdToCurrencyRate(query.currency));
  response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
  return response;
});

marketRoutes.post('/token-price', async (context) => {
  const body = await readJsonBody(
    context.req.raw,
    tokenPriceBodySchema,
    'Request body is required.',
    'Malformed token-price request body.',
  );

  const response = context.json({
    price: await fetchAlchemyTokenUsdPrice(context.env, body.identifier),
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

marketRoutes.post('/token-price-history', async (context) => {
  const body = await readJsonBody(
    context.req.raw,
    historicalTokenPriceBodySchema,
    'Request body is required.',
    'Malformed token-price-history request body.',
  );

  const response = context.json({
    prices: await fetchAlchemyHistoricalTokenUsdPrices(context.env, body.identifier, {
      startTime: body.startTime,
      endTime: body.endTime,
      interval: body.interval,
      withMarketData: body.withMarketData,
    }),
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default marketRoutes;
