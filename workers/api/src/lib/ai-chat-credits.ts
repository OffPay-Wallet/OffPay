import { MongoClient, type Collection, type Db } from 'mongodb';

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
}

interface AiChatUsageDocument {
  subject_type: AiChatCreditSubjectType;
  subject_key: string;
  limit: number;
  used: number;
  consumed_turn_ids: string[];
  window_started_at: Date;
  reset_at: Date;
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

type DatabaseRunner = <T>(config: AiChatCreditConfig, run: (db: Db) => Promise<T>) => Promise<T>;

const AI_CHAT_USAGE_COLLECTION = 'ai_chat_usage';
const DEFAULT_AI_CHAT_CREDIT_LIMIT = 5;
const DEFAULT_AI_CHAT_CREDIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_TURN_ID_LENGTH = 96;
const FALLBACK_SUBJECT_KEY_PATTERN = /^[a-f0-9]{64}$/i;

let databaseRunner: DatabaseRunner = withMongoDatabase;

export async function getAiChatCreditStatus(
  bindings: Bindings,
  request: AiChatCreditRequest,
): Promise<AiChatCreditStatus> {
  const config = getCreditConfig(bindings);
  const subject = getCreditSubject(request);
  const now = new Date();
  const document = await databaseRunner(config, async (db) => {
    const collection = aiChatUsageCollection(db);
    await ensureUsageDocument(collection, subject, config, now, { touchExisting: false });
    await resetExpiredUsageWindow(collection, subject, config, now);
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

  return databaseRunner(config, async (db) => {
    const collection = aiChatUsageCollection(db);
    const now = new Date();
    await ensureUsageDocument(collection, subject, config, now);
    await resetExpiredUsageWindow(collection, subject, config, now);

    const existing = await collection.findOne({
      subject_type: subject.type,
      subject_key: subject.key,
    });
    if (existing?.consumed_turn_ids?.includes(turnId)) {
      return {
        allowed: true,
        status: statusFromDocument(existing, config, subject.type, now),
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
      };
    }

    return {
      allowed: false,
      status: statusFromDocument(document, config, subject.type, now),
    };
  });
}

export function setAiChatCreditDatabaseRunnerForTests(runner: DatabaseRunner): void {
  databaseRunner = runner;
}

export function resetAiChatCreditDatabaseRunnerForTests(): void {
  databaseRunner = withMongoDatabase;
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
  options: { touchExisting?: boolean } = {},
): Promise<void> {
  const setExisting =
    options.touchExisting === false ? {} : { limit: config.limit, updated_at: now };

  await collection.updateOne(
    {
      subject_type: subject.type,
      subject_key: subject.key,
    },
    {
      $setOnInsert: {
        subject_type: subject.type,
        subject_key: subject.key,
        limit: config.limit,
        used: 0,
        consumed_turn_ids: [],
        window_started_at: now,
        reset_at: new Date(now.getTime() + config.windowMs),
        created_at: now,
      },
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
        used: 0,
        consumed_turn_ids: [],
        window_started_at: now,
        reset_at: new Date(now.getTime() + config.windowMs),
        updated_at: now,
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
