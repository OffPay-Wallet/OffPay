import { Hono } from 'hono';

import { issueAiSession } from '../lib/ai-session.js';
import { getAuthenticatedContext } from '../lib/auth.js';
import type { AppEnv } from '../lib/types.js';

const aiRoutes = new Hono<AppEnv>();

aiRoutes.post('/session', async (context) => {
  const authenticated = getAuthenticatedContext(context);
  const session = await issueAiSession({
    sharedSecret: context.env.AI_PROXY_SESSION_SECRET ?? '',
    walletAddress: authenticated.wallet,
    deviceId: authenticated.deviceId,
    network: authenticated.network,
  });
  const response = context.json(session, 200);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
});

export default aiRoutes;
