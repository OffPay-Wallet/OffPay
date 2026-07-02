import { ProviderError, positiveInt } from './http';
import { runAiProxyUpstashPipeline, sha256Hex } from './upstash';

import type { AiProxyEnv } from './types';

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 40;
/**
 * Anonymous callers (no validated session token) are capped well below the
 * authenticated budget. Combined with `AI_PROXY_REQUIRE_SESSION_TOKEN`,
 * this is the "stranger ceiling" while the token rollout is staged.
 */
const DEFAULT_ANONYMOUS_RATE_LIMIT_MAX = 8;
const MAX_BUCKETS = 2_000;

type Bucket = {
  windowStart: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

export async function assertAiProxyRateLimit(
  request: Request,
  env: AiProxyEnv,
  context?: { walletSubject?: string | null },
): Promise<void> {
  const isAuthenticated = context?.walletSubject != null && context.walletSubject.length > 0;
  // Authenticated callers get the configured budget. Anonymous callers
  // (no session token validated) get a much smaller bucket — this is the
  // pre-attestation "stranger ceiling" so a leaked URL alone can't drain
  // provider quota.
  const maxRequests = isAuthenticated
    ? positiveInt(env.AI_PROXY_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX)
    : Math.max(
        1,
        Math.min(
          DEFAULT_ANONYMOUS_RATE_LIMIT_MAX,
          positiveInt(env.AI_PROXY_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
        ),
      );
  const windowMs = positiveInt(env.AI_PROXY_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS);
  const now = Date.now();
  const key = rateLimitKey(request, context?.walletSubject ?? null);
  const upstashResult = await assertUpstashRateLimit(key, maxRequests, windowMs, now, env);
  if (upstashResult === 'allowed') return;
  if (upstashResult instanceof ProviderError) throw upstashResult;

  const bucket = buckets.get(key);

  if (bucket == null || now - bucket.windowStart >= windowMs) {
    pruneExpiredBuckets(now, windowMs);
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }

  if (bucket.count >= maxRequests) {
    const retryAfterMs = Math.max(1_000, bucket.windowStart + windowMs - now);
    throw new ProviderError('proxy', 429, 'AI proxy rate limit exceeded.', retryAfterMs);
  }

  bucket.count += 1;
}

export function resetAiProxyRateLimitForTests(): void {
  buckets.clear();
}

function rateLimitKey(request: Request, walletSubject: string | null): string {
  // Authenticated wallet subjects always win. Bucket is keyed by the
  // verified subject so a single attacker rotating IPs cannot dodge the
  // limit, and a single legitimate wallet bouncing across networks isn't
  // double-charged.
  if (walletSubject != null && walletSubject.length > 0) {
    return `wallet:${walletSubject}`;
  }

  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp != null && cfIp.length > 0) return `ip:${cfIp}`;

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor != null && forwardedFor.length > 0) return `ip:${forwardedFor}`;

  const origin = request.headers.get('origin')?.trim() ?? 'native';
  const userAgent = request.headers.get('user-agent')?.trim() ?? 'unknown';
  return `fallback:${origin}:${userAgent}`;
}

function pruneExpiredBuckets(now: number, windowMs: number): void {
  if (buckets.size < MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }

  if (buckets.size < MAX_BUCKETS) return;

  const overflowCount = buckets.size - MAX_BUCKETS + 1;
  let deleted = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    deleted += 1;
    if (deleted >= overflowCount) return;
  }
}

async function assertUpstashRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  now: number,
  env: AiProxyEnv,
): Promise<'allowed' | 'unavailable' | ProviderError> {
  const hashedKey = await sha256Hex(key);
  const redisKey = `ai-proxy:ratelimit:v1:${hashedKey}`;
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const result = await runAiProxyUpstashPipeline(env, [
    ['INCR', redisKey],
    ['EXPIRE', redisKey, windowSec, 'NX'],
    ['TTL', redisKey],
  ]);

  if (result == null) return 'unavailable';

  const count = Number(result[0] ?? 0);
  const ttl = Number(result[2] ?? windowSec);
  if (!Number.isFinite(count) || count <= maxRequests) return 'allowed';

  const retryAfterMs = Math.max(1_000, (Number.isFinite(ttl) && ttl > 0 ? ttl : windowSec) * 1000);
  return new ProviderError('proxy', 429, 'AI proxy rate limit exceeded.', retryAfterMs);
}
