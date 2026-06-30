import app from './app';
import { resetExpiredAiChatCreditWindows } from './lib/ai-chat-credits';
import { refreshHotCaches } from './lib/hot-cache';
import type { Bindings } from './lib/types';
import type { ExecutionContext } from 'hono';

export { AiCreditsEntrypoint } from './ai-credits-entrypoint';

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx));
  },
  scheduled(_event: unknown, env: Bindings, ctx: ExecutionContext): void {
    ctx.waitUntil(
      Promise.all([
        refreshHotCaches(env),
        resetExpiredAiChatCreditWindows(env).catch((error: unknown) => {
          console.warn('api.aiChatCredits.scheduledResetError', {
            message: error instanceof Error ? error.message : String(error),
          });
        }),
      ]).then(() => undefined),
    );
  },
};
