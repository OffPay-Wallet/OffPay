import app from './app';
import { refreshHotCaches } from './lib/hot-cache';
import type { Bindings } from './lib/types';
import type { ExecutionContext } from 'hono';

export { AiCreditsEntrypoint } from './ai-credits-entrypoint';

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx));
  },
  scheduled(_event: unknown, env: Bindings, ctx: ExecutionContext): void {
    ctx.waitUntil(refreshHotCaches(env));
  },
};
