import app from './app';
import type { Bindings } from './lib/types';

export default {
  fetch(request: Request, env: Bindings): Promise<Response> {
    return Promise.resolve(app.fetch(request, env));
  },
};
