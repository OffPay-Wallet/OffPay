import { Hono } from 'hono';
import { z } from 'zod';
import { getCapabilities } from '../lib/capabilities.js';
import { getOrSetEdgeJsonCache } from '../lib/edge-cache.js';
import type { AppEnv } from '../lib/types.js';
import { networkSchema, readSearchParams } from '../lib/validation.js';

const CAPABILITIES_EDGE_FRESH_TTL_MS = 10 * 60 * 1000;
const CAPABILITIES_EDGE_STALE_TTL_MS = 10 * 60 * 1000;

const capabilitiesQuerySchema = z.object({
  network: networkSchema,
});

const capabilitiesRoutes = new Hono<AppEnv>();

capabilitiesRoutes.get('/', async (context) => {
  const query = readSearchParams(context.req.url, capabilitiesQuerySchema);

  const response = context.json(
    await getOrSetEdgeJsonCache({
      context,
      namespace: 'capabilities',
      keyParts: [query.network],
      freshTtlMs: CAPABILITIES_EDGE_FRESH_TTL_MS,
      staleTtlMs: CAPABILITIES_EDGE_STALE_TTL_MS,
      resolver: () => getCapabilities(context.env, query.network),
    }),
  );
  response.headers.set('Cache-Control', 'public, max-age=600');
  return response;
});

export default capabilitiesRoutes;
