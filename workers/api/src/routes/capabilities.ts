import { Hono } from 'hono';
import { z } from 'zod';
import { getCapabilities } from '../lib/capabilities.js';
import type { AppEnv } from '../lib/types.js';
import { networkSchema, readSearchParams } from '../lib/validation.js';

const capabilitiesQuerySchema = z.object({
  network: networkSchema,
});

const capabilitiesRoutes = new Hono<AppEnv>();

capabilitiesRoutes.get('/', async (context) => {
  const query = readSearchParams(context.req.url, capabilitiesQuerySchema);

  const response = context.json(await getCapabilities(context.env, query.network));
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export default capabilitiesRoutes;
