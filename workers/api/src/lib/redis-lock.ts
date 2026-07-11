import { runKvPipeline } from './provider-utils.js';

import type { Bindings } from './types.js';

const RELEASE_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

async function acquireRedisLock(params: {
  bindings: Bindings;
  key: string;
  ttlSeconds: number;
  unavailableMessage: string;
}): Promise<string | null> {
  const lockToken = crypto.randomUUID();
  const [result] = await runKvPipeline(
    params.bindings,
    [['SET', params.key, lockToken, 'NX', 'EX', params.ttlSeconds]],
    params.unavailableMessage,
  );
  return result === 'OK' ? lockToken : null;
}

async function releaseRedisLock(params: {
  bindings: Bindings;
  key: string;
  token: string;
  unavailableMessage: string;
}): Promise<void> {
  await runKvPipeline(
    params.bindings,
    [['EVAL', RELEASE_LOCK_SCRIPT, 1, params.key, params.token]],
    params.unavailableMessage,
  );
}

export { acquireRedisLock, releaseRedisLock };
