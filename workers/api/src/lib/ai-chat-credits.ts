import { MongoClient, type Collection, type Db } from 'mongodb';

import { runKvPipeline } from './provider-utils.js';
import type { Bindings } from './types.js';

export type AiChatCreditSubjectType = 'wallet' | 'fallback';

export interface AiChatCreditStatus {
  kind: 'ai_chat_credits';
  limit: number;
  used: number;
  remaining: number;
  resetAtMs: number;
  windowMs: number;
  subjectType: AiChatCreditSubjectType;
  retryAfterMs?: number;
}

export interface AiChatCreditRequest {
  walletSubject?: string | null;
  fallbackSubjectKey: string;
  turnId?: string | null;
}

export interface AiChatCreditConsumptionResult {
  allowed: boolean;
  status: AiChatCreditStatus;
  charged: boolean;
}

export type AiChatCreditReleaseReason = 'provider_timeout' | 'provider_error' | 'proxy_error';

interface AiChatUsageDocument {
  subject_type: AiChatCreditSubjectType;
  subject_key: string;
  limit: number;
  window_ms: number;
  used: number;
  consumed_turn_ids: string[];
  window_started_at: Date;
  reset_at: Date;
  reset_count?: number;
  last_status_checked_at?: Date;
  last_consumed_at?: Date;
  last_released_at?: Date;
  last_release_reason?: AiChatCreditReleaseReason;
  last_blocked_at?: Date;
  last_reset_at?: Date;
  last_reset_reason?: AiChatCreditResetReason;
  created_at: Date;
  updated_at: Date;
}

interface AiChatCreditConfig {
  uri: string;
  database: string;
  limit: number;
  windowMs: number;
}

interface AiChatCreditSubject {
  type: AiChatCreditSubjectType;
  key: string;
}

interface RedisAiChatCreditConfig extends AiChatCreditConfig {
  windowSec: number;
}

type AiChatCreditResetReason = 'request' | 'scheduled';

export interface AiChatCreditResetSummary {
  matchedCount: number;
  modifiedCount: number;
  resetAtMs: number;
  nextResetAtMs: number;
}

type DatabaseRunner = <T>(config: AiChatCreditConfig, run: (db: Db) => Promise<T>) => Promise<T>;

const AI_CHAT_USAGE_COLLECTION = 'ai_chat_usage';
const DEFAULT_AI_CHAT_CREDIT_LIMIT = 5;
const DEFAULT_AI_CHAT_CREDIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_TURN_ID_LENGTH = 96;
const FALLBACK_SUBJECT_KEY_PATTERN = /^[a-f0-9]{64}$/i;
const AI_CHAT_CREDIT_REDIS_PREFIX = 'ai-chat-credit:v1';
const AI_CHAT_CREDIT_REDIS_UNAVAILABLE_MESSAGE = 'Yuga credit cache is temporarily unavailable.';

const CONSUME_CREDIT_SCRIPT = `
local countKey = KEYS[1]
local turnsKey = KEYS[2]
local limit = tonumber(ARGV[1])
local windowSec = tonumber(ARGV[2])
local turnId = ARGV[3]

local ttl = redis.call("TTL", countKey)
if ttl <= 0 then
  redis.call("SET", countKey, "0", "EX", windowSec)
  redis.call("DEL", turnsKey)
  redis.call("EXPIRE", turnsKey, windowSec)
  ttl = windowSec
end

local used = tonumber(redis.call("GET", countKey) or "0")
if redis.call("SISMEMBER", turnsKey, turnId) == 1 then
  return {1, 0, used, ttl}
end

if used >= limit then
  return {0, 0, used, ttl}
end

used = redis.call("INCR", countKey)
redis.call("SADD", turnsKey, turnId)
redis.call("EXPIRE", countKey, ttl)
redis.call("EXPIRE", turnsKey, ttl)
return {1, 1, used, ttl}
`;

const RELEASE_CREDIT_SCRIPT = `
local countKey = KEYS[1]
local turnsKey = KEYS[2]
local windowSec = tonumber(ARGV[1])
local turnId = ARGV[2]

local ttl = redis.call("TTL", countKey)
if ttl <= 0 then
  redis.call("SET", countKey, "0", "EX", windowSec)
  redis.call("DEL", turnsKey)
  redis.call("EXPIRE", turnsKey, windowSec)
  ttl = windowSec
end

local used = tonumber(redis.call("GET", countKey) or "0")
if redis.call("SISMEMBER", turnsKey, turnId) == 1 then
  redis.call("SREM", turnsKey, turnId)
  if used > 0 then
    used = redis.call("DECR", countKey)
    if used < 0 then
      redis.call("SET", countKey, "0", "EX", ttl)
      used = 0
    end
  end
end

redis.call("EXPIRE", countKey, ttl)
redis.call("EXPIRE", turnsKey, ttl)
return {used, ttl}
`;

let databaseRunner: DatabaseRunner = withMongoDatabase;

export async function getAiChatCreditStatus(
  bindings: Bindings,
  request: AiChatCreditRequest,
): Promise<AiChatCreditStatus> {
  const config = getCreditConfig(bindings);
  const subject = getCreditSubject(request);
  if (shouldUseUpstashCreditBackend(bindings)) {
    try {
      return await getRedisAiChatCreditStatus(bindings, config, subject);
    } catch (error) {
      logRedisCreditFallback('status', error);
    }
  }

  const now = new Date();
  const document = await databaseRunner(config, async (db) => {
    const collection = aiChatUsageCollection(db);
    await ensureUsageDocument(collection, subject, config, now, {
      touchExisting: false,
      statusCheckedAt: now,
    });
    await resetExpiredUsageWindow(collection, subject, config, now, 'request');
    return collection.findOne({ subject_type: subject.type, subject_key: subject.key });
  });

  return statusFromDocument(document, config, subject.type, now);
}

export async function consumeAiChatCredit(
  bindings: Bindings,
  request: AiChatCreditRequest,
): Promise<AiChatCreditConsumptionResult> {
  const config = getCreditConfig(bindings);
  const subject = getCreditSubject(request);
  const turnId = readTurnId(request.turnId);
  if (shouldUseUpstashCreditBackend(bindings)) {
    try {
      return await consumeRedisAiChatCredit(bindings, config, subject, turnId);
    } catch (error) {
      logRedisCreditFallback('consume', error);
    }
  }

  return databaseRunner(config, async (db) => {
    const collection = aiChatUsageCollection(db);
    const now = new Date();
    await ensureUsageDocument(collection, subject, config, now, { statusCheckedAt: now });
    await resetExpiredUsageWindow(collection, subject, config, now, 'request');

    const existing = await collection.findOne({
      subject_type: subject.type,
      subject_key: subject.key,
    });
    if (existing?.consumed_turn_ids?.includes(turnId)) {
      return {
        allowed: true,
        status: statusFromDocument(existing, config, subject.type, now),
        charged: false,
      };
    }

    const update = await collection.updateOne(
      {
        subject_type: subject.type,
        subject_key: subject.key,
        reset_at: { $gt: now },
        used: { $lt: config.limit },
        consumed_turn_ids: { $ne: turnId },
      },
      {
        $inc: { used: 1 },
        $addToSet: { consumed_turn_ids: turnId },
        $set: {
          limit: config.limit,
          window_ms: config.windowMs,
          last_consumed_at: now,
          updated_at: now,
        },
      },
    );

    const document = await collection.findOne({
      subject_type: subject.type,
      subject_key: subject.key,
    });

    if (update.modifiedCount === 1 || document?.consumed_turn_ids?.includes(turnId)) {
      return {
        allowed: true,
        status: statusFromDocument(document, config, subject.type, now),
        charged: update.modifiedCount === 1,
      };
    }

    await collection.updateOne(
      {
        subject_type: subject.type,
        subject_key: subject.key,
      },
      {
        $set: {
          limit: config.limit,
          window_ms: config.windowMs,
          last_blocked_at: now,
          updated_at: now,
        },
      },
    );

    return {
      allowed: false,
      charged: false,
      status: statusFromDocument(
        await collection.findOne({
          subject_type: subject.type,
          subject_key: subject.key,
        }),
        config,
        subject.type,
        now,
      ),
    };
  });
}

export async function releaseAiChatCredit(
  bindings: Bindings,
  request: AiChatCreditRequest,
  reason: AiChatCreditReleaseReason,
): Promise<AiChatCreditStatus> {
  const config = getCreditConfig(bindings);
  const subject = getCreditSubject(request);
  const turnId = readTurnId(request.turnId);
  if (shouldUseUpstashCreditBackend(bindings)) {
    try {
      return await releaseRedisAiChatCredit(bindings, config, subject, turnId);
    } catch (error) {
      logRedisCreditFallback('release', error);
    }
  }

  return databaseRunner(config, async (db) => {
    const collection = aiChatUsageCollection(db);
    const now = new Date();
    await collection.updateOne(
      {
        subject_type: subject.type,
        subject_key: subject.key,
        used: { $gt: 0 },
        consumed_turn_ids: turnId,
      },
      {
        $inc: { used: -1 },
        $pull: { consumed_turn_ids: turnId },
        $set: {
          limit: config.limit,
          window_ms: config.windowMs,
          last_released_at: now,
          last_release_reason: reason,
          updated_at: now,
        },
      },
    );

    return statusFromDocument(
      await collection.findOne({
        subject_type: subject.type,
        subject_key: subject.key,
      }),
      config,
      subject.type,
      now,
    );
  });
}

export async function resetExpiredAiChatCreditWindows(
  bindings: Bindings,
  now = new Date(),
): Promise<AiChatCreditResetSummary> {
  const config = getCreditConfig(bindings);
  const nextResetAt = new Date(now.getTime() + config.windowMs);

  const result = await databaseRunner(config, async (db) => {
    const collection = aiChatUsageCollection(db);
    return collection.updateMany(
      {
        reset_at: { $lte: now },
        used: { $gt: 0 },
      },
      {
        $set: {
          limit: config.limit,
          window_ms: config.windowMs,
          used: 0,
          consumed_turn_ids: [],
          window_started_at: now,
          reset_at: nextResetAt,
          last_reset_at: now,
          last_reset_reason: 'scheduled',
          updated_at: now,
        },
        $inc: {
          reset_count: 1,
        },
      },
    );
  });

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    resetAtMs: now.getTime(),
    nextResetAtMs: nextResetAt.getTime(),
  };
}

export function setAiChatCreditDatabaseRunnerForTests(runner: DatabaseRunner): void {
  databaseRunner = runner;
}

export function resetAiChatCreditDatabaseRunnerForTests(): void {
  databaseRunner = withMongoDatabase;
}

function shouldUseUpstashCreditBackend(bindings: Bindings): boolean {
  const endpoint = bindings.UPSTASH_REDIS_REST_URL ?? bindings.KV_REST_API_URL;
  const token = bindings.UPSTASH_REDIS_REST_TOKEN ?? bindings.KV_REST_API_TOKEN;
  return (
    bindings.OFFPAY_AI_CHAT_CREDITS_BACKEND?.trim().toLowerCase() === 'upstash' &&
    typeof endpoint === 'string' &&
    endpoint.trim().length > 0 &&
    typeof token === 'string' &&
    token.trim().length > 0
  );
}

async function getRedisAiChatCreditStatus(
  bindings: Bindings,
  config: AiChatCreditConfig,
  subject: AiChatCreditSubject,
): Promise<AiChatCreditStatus> {
  const redisConfig = redisCreditConfig(config);
  const keys = await redisCreditKeys(subject);
  const [rawUsed, rawTtl] = await runKvPipeline(
    bindings,
    [
      ['GET', keys.countKey],
      ['TTL', keys.countKey],
    ],
    AI_CHAT_CREDIT_REDIS_UNAVAILABLE_MESSAGE,
  );
  const ttlSec = normalizeRedisTtlSec(rawTtl, redisConfig.windowSec);
  return statusFromRedisUsage(asNonNegativeInt(rawUsed), redisConfig, subject.type, ttlSec);
}

async function consumeRedisAiChatCredit(
  bindings: Bindings,
  config: AiChatCreditConfig,
  subject: AiChatCreditSubject,
  turnId: string,
): Promise<AiChatCreditConsumptionResult> {
  const redisConfig = redisCreditConfig(config);
  const keys = await redisCreditKeys(subject);
  const [rawResult] = await runKvPipeline(
    bindings,
    [
      [
        'EVAL',
        CONSUME_CREDIT_SCRIPT,
        2,
        keys.countKey,
        keys.turnsKey,
        redisConfig.limit,
        redisConfig.windowSec,
        turnId,
      ],
    ],
    AI_CHAT_CREDIT_REDIS_UNAVAILABLE_MESSAGE,
  );
  const [allowed, charged, used, ttl] = normalizeRedisArray(rawResult, 4);
  const ttlSec = normalizeRedisTtlSec(ttl, redisConfig.windowSec);
  return {
    allowed: allowed === 1,
    charged: charged === 1,
    status: statusFromRedisUsage(used, redisConfig, subject.type, ttlSec),
  };
}

async function releaseRedisAiChatCredit(
  bindings: Bindings,
  config: AiChatCreditConfig,
  subject: AiChatCreditSubject,
  turnId: string,
): Promise<AiChatCreditStatus> {
  const redisConfig = redisCreditConfig(config);
  const keys = await redisCreditKeys(subject);
  const [rawResult] = await runKvPipeline(
    bindings,
    [
      [
        'EVAL',
        RELEASE_CREDIT_SCRIPT,
        2,
        keys.countKey,
        keys.turnsKey,
        redisConfig.windowSec,
        turnId,
      ],
    ],
    AI_CHAT_CREDIT_REDIS_UNAVAILABLE_MESSAGE,
  );
  const [used, ttl] = normalizeRedisArray(rawResult, 2);
  return statusFromRedisUsage(
    used,
    redisConfig,
    subject.type,
    normalizeRedisTtlSec(ttl, redisConfig.windowSec),
  );
}

function redisCreditConfig(config: AiChatCreditConfig): RedisAiChatCreditConfig {
  return {
    ...config,
    windowSec: Math.max(1, Math.ceil(config.windowMs / 1000)),
  };
}

async function redisCreditKeys(subject: AiChatCreditSubject): Promise<{
  countKey: string;
  turnsKey: string;
}> {
  const subjectHash = await sha256Hex(`${subject.type}:${subject.key}`);
  const prefix = `${AI_CHAT_CREDIT_REDIS_PREFIX}:${subject.type}:${subjectHash}`;
  return {
    countKey: `${prefix}:count`,
    turnsKey: `${prefix}:turns`,
  };
}

function statusFromRedisUsage(
  rawUsed: number,
  config: RedisAiChatCreditConfig,
  subjectType: AiChatCreditSubjectType,
  ttlSec: number,
): AiChatCreditStatus {
  const now = Date.now();
  const used = Math.max(0, Math.min(rawUsed, config.limit));
  const remaining = Math.max(0, config.limit - used);
  const retryAfterMs = remaining === 0 ? Math.max(1_000, ttlSec * 1000) : undefined;
  return {
    kind: 'ai_chat_credits',
    limit: config.limit,
    used,
    remaining,
    resetAtMs: now + ttlSec * 1000,
    windowMs: config.windowMs,
    subjectType,
    ...(retryAfterMs == null ? {} : { retryAfterMs }),
  };
}

function normalizeRedisArray(value: unknown, minLength: number): number[] {
  const values = Array.isArray(value) ? value : [];
  if (values.length < minLength) {
    throw new Error('AI credit Redis service returned an invalid response.');
  }
  return values.map((entry) => asNonNegativeInt(entry));
}

function normalizeRedisTtlSec(value: unknown, fallback: number): number {
  const parsed = asNonNegativeInt(value);
  return parsed > 0 ? parsed : fallback;
}

function asNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function logRedisCreditFallback(operation: 'status' | 'consume' | 'release', error: unknown): void {
  console.warn('api.aiChatCredits.redisFallback', {
    operation,
    message: error instanceof Error ? error.message : String(error),
  });
}

function getCreditConfig(bindings: Bindings): AiChatCreditConfig {
  const uri = bindings.MONGODB_URI?.trim() ?? '';
  const database = bindings.MONGODB_DATABASE?.trim() ?? '';

  if (uri.length === 0 || database.length === 0) {
    throw new Error('Yuga credit tracking is not configured.');
  }

  return {
    uri,
    database,
    limit: positiveInt(bindings.OFFPAY_AI_CHAT_CREDIT_LIMIT, DEFAULT_AI_CHAT_CREDIT_LIMIT),
    windowMs: positiveInt(
      bindings.OFFPAY_AI_CHAT_CREDIT_WINDOW_MS,
      DEFAULT_AI_CHAT_CREDIT_WINDOW_MS,
    ),
  };
}

async function withMongoDatabase<T>(
  config: AiChatCreditConfig,
  run: (db: Db) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(config.uri);

  try {
    await client.connect();
    return await run(client.db(config.database));
  } finally {
    await client.close().catch(() => undefined);
  }
}

function aiChatUsageCollection(db: Db): Collection<AiChatUsageDocument> {
  return db.collection<AiChatUsageDocument>(AI_CHAT_USAGE_COLLECTION);
}

function getCreditSubject(request: AiChatCreditRequest): AiChatCreditSubject {
  const wallet = request.walletSubject?.trim();
  if (wallet != null && wallet.length > 0) {
    return {
      type: 'wallet',
      key: wallet,
    };
  }

  const fallback = request.fallbackSubjectKey.trim();
  if (!FALLBACK_SUBJECT_KEY_PATTERN.test(fallback)) {
    throw new Error('Yuga credit fallback subject is invalid.');
  }

  return {
    type: 'fallback',
    key: fallback.toLowerCase(),
  };
}

function readTurnId(rawTurnId: string | null | undefined): string {
  const turnId = rawTurnId?.trim() ?? '';
  if (
    turnId.length > 0 &&
    turnId.length <= MAX_TURN_ID_LENGTH &&
    /^[A-Za-z0-9:_-]+$/.test(turnId)
  ) {
    return turnId;
  }

  return `request:${crypto.randomUUID()}`;
}

async function ensureUsageDocument(
  collection: Collection<AiChatUsageDocument>,
  subject: AiChatCreditSubject,
  config: AiChatCreditConfig,
  now: Date,
  options: { statusCheckedAt?: Date; touchExisting?: boolean } = {},
): Promise<void> {
  const setExisting: Partial<AiChatUsageDocument> =
    options.touchExisting === false
      ? {}
      : { limit: config.limit, window_ms: config.windowMs, updated_at: now };
  if (options.statusCheckedAt != null) {
    setExisting.last_status_checked_at = options.statusCheckedAt;
  }
  const setOnInsert: Partial<AiChatUsageDocument> = {
    subject_type: subject.type,
    subject_key: subject.key,
    limit: config.limit,
    window_ms: config.windowMs,
    used: 0,
    consumed_turn_ids: [],
    window_started_at: now,
    reset_at: new Date(now.getTime() + config.windowMs),
    reset_count: 0,
    ...(options.statusCheckedAt == null ? {} : { last_status_checked_at: options.statusCheckedAt }),
    created_at: now,
    updated_at: now,
  };
  for (const key of Object.keys(setExisting) as Array<keyof AiChatUsageDocument>) {
    delete setOnInsert[key];
  }

  await collection.updateOne(
    {
      subject_type: subject.type,
      subject_key: subject.key,
    },
    {
      $setOnInsert: setOnInsert,
      ...(Object.keys(setExisting).length === 0 ? {} : { $set: setExisting }),
    },
    { upsert: true },
  );
}

async function resetExpiredUsageWindow(
  collection: Collection<AiChatUsageDocument>,
  subject: AiChatCreditSubject,
  config: AiChatCreditConfig,
  now: Date,
  reason: AiChatCreditResetReason,
): Promise<void> {
  await collection.updateOne(
    {
      subject_type: subject.type,
      subject_key: subject.key,
      reset_at: { $lte: now },
    },
    {
      $set: {
        limit: config.limit,
        window_ms: config.windowMs,
        used: 0,
        consumed_turn_ids: [],
        window_started_at: now,
        reset_at: new Date(now.getTime() + config.windowMs),
        last_reset_at: now,
        last_reset_reason: reason,
        updated_at: now,
      },
      $inc: {
        reset_count: 1,
      },
    },
  );
}

function statusFromDocument(
  document: AiChatUsageDocument | null,
  config: AiChatCreditConfig,
  subjectType: AiChatCreditSubjectType,
  now: Date,
): AiChatCreditStatus {
  if (document == null) {
    return {
      kind: 'ai_chat_credits',
      limit: config.limit,
      used: 0,
      remaining: config.limit,
      resetAtMs: now.getTime() + config.windowMs,
      windowMs: config.windowMs,
      subjectType,
    };
  }

  const resetAtMs =
    document.reset_at instanceof Date
      ? document.reset_at.getTime()
      : new Date(document.reset_at).getTime();
  const used = Math.max(0, Math.min(document.used ?? 0, config.limit));
  const remaining = Math.max(0, config.limit - used);
  const retryAfterMs = remaining === 0 ? Math.max(1_000, resetAtMs - now.getTime()) : undefined;

  return {
    kind: 'ai_chat_credits',
    limit: config.limit,
    used,
    remaining,
    resetAtMs,
    windowMs: config.windowMs,
    subjectType,
    ...(retryAfterMs == null ? {} : { retryAfterMs }),
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}
