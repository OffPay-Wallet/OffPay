import type { Bindings } from './types.js';

type RateLimitScope = 'ip' | 'wallet' | 'device';

interface RateLimitPolicy {
  limit: number;
  windowSec: number;
  scope: RateLimitScope;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
  degraded: boolean;
}

interface RateLimitDescriptor {
  method: string;
  path: string;
  identifier: string;
}

interface KvClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  incrementWithWindow?(
    key: string,
    seconds: number,
  ): Promise<{ currentCount: number; ttl: number }>;
}

type KvClientFactory = (bindings: Bindings) => KvClient;

const DEFAULT_AUTHENTICATED_POLICY: RateLimitPolicy = {
  limit: 60,
  windowSec: 60,
  scope: 'wallet',
};

const RATE_LIMIT_POLICIES = new Map<string, RateLimitPolicy>([
  ['GET /api/bootstrap/provision', { limit: 60, windowSec: 60, scope: 'device' }],
  ['POST /api/bootstrap/provision', { limit: 30, windowSec: 60, scope: 'device' }],
  ['GET /api/capabilities', { limit: 60, windowSec: 5 * 60, scope: 'ip' }],
  ['GET /api/market/fx-rate', { limit: 120, windowSec: 60, scope: 'ip' }],
  ['POST /api/market/token-price', { limit: 60, windowSec: 60, scope: 'device' }],
  ['POST /api/market/token-price-history', { limit: 30, windowSec: 60, scope: 'device' }],
  ['GET /api/wallet/balance', { limit: 60, windowSec: 60, scope: 'device' }],
  ['GET /api/wallet/transactions', { limit: 20, windowSec: 60, scope: 'device' }],
  ['GET /api/risk/score', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['GET /api/swap/tokens', { limit: 10, windowSec: 5 * 60, scope: 'device' }],
  ['GET /api/swap/price', { limit: 30, windowSec: 60, scope: 'device' }],
  ['POST /api/swap/quote', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['POST /api/swap/execute', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['POST /api/swap/trigger', { limit: 12, windowSec: 60, scope: 'wallet' }],
  ['POST /api/swap/privacy-envelope/prepare', { limit: 6, windowSec: 60, scope: 'wallet' }],
  ['POST /api/swap/privacy-envelope/refresh-quote', { limit: 6, windowSec: 60, scope: 'wallet' }],
  ['POST /api/swap/privacy-envelope/finalize', { limit: 6, windowSec: 60, scope: 'wallet' }],
  ['POST /api/swap/recurring', { limit: 5, windowSec: 60, scope: 'wallet' }],
  ['POST /api/payment/private-init-mint', { limit: 5, windowSec: 60, scope: 'wallet' }],
  ['GET /api/payment/private-balance', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['POST /api/payment/private-send', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['POST /api/payment/settle', { limit: 5, windowSec: 60, scope: 'wallet' }],
  ['GET /api/offline/rent-estimate', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['POST /api/offline/nonce-pool/prepare', { limit: 3, windowSec: 60, scope: 'wallet' }],
  ['POST /api/offline/nonce-pool/advance', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['GET /api/offline/nonce-pool/status', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['GET /api/offline/token-context', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['GET /api/privacy/shielded-balance', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['GET /api/privacy/scan-announcements', { limit: 10, windowSec: 60, scope: 'wallet' }],
  [
    'POST /api/privacy/register-viewing-key',
    { limit: 3, windowSec: 24 * 60 * 60, scope: 'wallet' },
  ],
  ['GET /api/stream/capabilities', { limit: 10, windowSec: 5 * 60, scope: 'wallet' }],
  ['GET /api/stream/wallet-activity', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['POST /api/pending/backup', { limit: 50, windowSec: 60, scope: 'wallet' }],
  ['GET /api/pending/backup', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['DELETE /api/pending/backup', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['GET /api/rpc/latest-blockhash', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['POST /api/rpc/fee-for-message', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['POST /api/rpc/accounts', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['POST /api/rpc/token-largest-accounts', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['GET /api/rpc/epoch-info', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['GET /api/rpc/slot', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['POST /api/rpc/signature-statuses', { limit: 30, windowSec: 60, scope: 'wallet' }],
  ['POST /api/rpc/signatures-for-address', { limit: 20, windowSec: 60, scope: 'wallet' }],
  ['POST /api/rpc/broadcast', { limit: 5, windowSec: 60, scope: 'wallet' }],
  ['GET /api/umbra/utxos', { limit: 120, windowSec: 60, scope: 'wallet' }],
  ['GET /api/umbra/indexer-health', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['GET /api/umbra/trees', { limit: 20, windowSec: 60, scope: 'wallet' }],
  [
    'GET /api/umbra/trees/:treeIndex/proof/:insertionIndex',
    { limit: 20, windowSec: 60, scope: 'wallet' },
  ],
  ['POST /api/umbra/trees/:treeIndex/proofs', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['GET /api/umbra/relayer-info', { limit: 10, windowSec: 60, scope: 'wallet' }],
  ['POST /api/umbra/claim', { limit: 5, windowSec: 60, scope: 'wallet' }],
  ['GET /api/umbra/claim-status/:id', { limit: 20, windowSec: 60, scope: 'wallet' }],
]);

let kvClientFactory: KvClientFactory = createUpstashKvClient;

function normalizeRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function normalizePolicyPath(method: string, path: string): string {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' && /^\/api\/umbra\/trees\/[^/]+\/proof\/[^/]+$/.test(path)) {
    return '/api/umbra/trees/:treeIndex/proof/:insertionIndex';
  }

  if (normalizedMethod === 'POST' && /^\/api\/umbra\/trees\/[^/]+\/proofs$/.test(path)) {
    return '/api/umbra/trees/:treeIndex/proofs';
  }

  if (normalizedMethod === 'GET' && /^\/api\/umbra\/claim-status\/[^/]+$/.test(path)) {
    return '/api/umbra/claim-status/:id';
  }

  return path;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function buildRateLimitKey(
  scope: RateLimitScope,
  method: string,
  path: string,
  hashedIdentifier: string,
): string {
  return `ratelimit:v1:${scope}:${method.toUpperCase()}:${path}:${hashedIdentifier}`;
}

function getRateLimitPolicy(method: string, path: string): RateLimitPolicy {
  return (
    RATE_LIMIT_POLICIES.get(normalizeRouteKey(method, normalizePolicyPath(method, path))) ??
    DEFAULT_AUTHENTICATED_POLICY
  );
}

function createUpstashKvClient(bindings: Bindings): KvClient {
  const endpoint = bindings.KV_REST_API_URL.replace(/\/$/, '');
  const token = bindings.KV_REST_API_TOKEN;

  async function runPipeline(
    commands: ReadonlyArray<ReadonlyArray<string | number>>,
  ): Promise<unknown[]> {
    const response = await fetch(`${endpoint}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      throw new Error(`KV pipeline failed with status ${response.status}`);
    }

    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const erroredResult = payload.find((entry) => entry.error);
    if (erroredResult) {
      throw new Error(erroredResult.error);
    }

    return payload.map((entry) => entry.result ?? null);
  }

  return {
    async incr(key: string): Promise<number> {
      const [result] = await runPipeline([['INCR', key]]);
      return Number(result ?? 0);
    },
    async expire(key: string, seconds: number): Promise<number> {
      const [result] = await runPipeline([['EXPIRE', key, seconds]]);
      return Number(result ?? 0);
    },
    async ttl(key: string): Promise<number> {
      const [result] = await runPipeline([['TTL', key]]);
      return Number(result ?? -2);
    },
    async incrementWithWindow(
      key: string,
      seconds: number,
    ): Promise<{ currentCount: number; ttl: number }> {
      const [currentCount, , ttl] = await runPipeline([
        ['INCR', key],
        ['EXPIRE', key, seconds, 'NX'],
        ['TTL', key],
      ]);

      return {
        currentCount: Number(currentCount ?? 0),
        ttl: Number(ttl ?? -2),
      };
    },
  };
}

async function checkRateLimit(
  bindings: Bindings,
  descriptor: RateLimitDescriptor,
): Promise<RateLimitResult> {
  const policyPath = normalizePolicyPath(descriptor.method, descriptor.path);
  const policy = getRateLimitPolicy(descriptor.method, descriptor.path);

  try {
    const client = kvClientFactory(bindings);
    const hashedIdentifier = await sha256Hex(descriptor.identifier);
    const key = buildRateLimitKey(policy.scope, descriptor.method, policyPath, hashedIdentifier);

    let currentCount: number;
    let ttl: number;

    if (client.incrementWithWindow) {
      const rateLimitState = await client.incrementWithWindow(key, policy.windowSec);
      currentCount = rateLimitState.currentCount;
      ttl = rateLimitState.ttl;
    } else {
      currentCount = await client.incr(key);
      if (currentCount === 1) {
        await client.expire(key, policy.windowSec);
      }

      ttl = await client.ttl(key);
    }

    const retryAfterSec = ttl > 0 ? ttl : policy.windowSec;

    return {
      allowed: currentCount <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - currentCount),
      resetAt: Math.floor(Date.now() / 1000) + retryAfterSec,
      retryAfterSec,
      degraded: false,
    };
  } catch {
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit,
      resetAt: Math.floor(Date.now() / 1000) + policy.windowSec,
      retryAfterSec: policy.windowSec,
      degraded: true,
    };
  }
}

function applyRateLimitHeaders(headers: Headers, result: RateLimitResult): void {
  headers.set('X-RateLimit-Limit', result.limit.toString());
  headers.set('X-RateLimit-Remaining', result.remaining.toString());
  headers.set('X-RateLimit-Reset', result.resetAt.toString());

  if (!result.allowed) {
    headers.set('Retry-After', result.retryAfterSec.toString());
  }
}

function setKvClientFactory(factory: KvClientFactory): void {
  kvClientFactory = factory;
}

function resetKvClientFactory(): void {
  kvClientFactory = createUpstashKvClient;
}

export {
  RATE_LIMIT_POLICIES,
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitPolicy,
  resetKvClientFactory,
  setKvClientFactory,
  type KvClient,
  type KvClientFactory,
  type RateLimitDescriptor,
  type RateLimitPolicy,
  type RateLimitResult,
  type RateLimitScope,
};
