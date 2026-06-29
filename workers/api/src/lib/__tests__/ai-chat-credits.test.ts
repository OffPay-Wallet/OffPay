import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  consumeAiChatCredit,
  getAiChatCreditStatus,
  resetAiChatCreditDatabaseRunnerForTests,
  setAiChatCreditDatabaseRunnerForTests,
} from '../ai-chat-credits';

import type { Db } from 'mongodb';
import type { Bindings } from '../types';

interface FakeUsageDocument {
  subject_type?: string;
  subject_key?: string;
  limit?: number;
  used?: number;
  consumed_turn_ids?: string[];
  window_started_at?: Date;
  reset_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}

const env: Bindings = {
  MONGODB_URI: 'mongodb://unit-test',
  MONGODB_DATABASE: 'offpay-test',
  OFFPAY_AI_CHAT_CREDIT_LIMIT: '5',
  OFFPAY_AI_CHAT_CREDIT_WINDOW_MS: String(60 * 60 * 1000),
  JUPITER_API_KEY: 'test-jupiter',
  OFFPAY_BOOTSTRAP_SECRET: 'test-bootstrap',
  BOOTSTRAP_SECRET_VERSION: '1',
  OFFPAY_BACKUP_HMAC_SECRET: 'test-backup',
  KV_REST_API_URL: 'https://kv.test',
  KV_REST_API_TOKEN: 'test-token',
  MAGICBLOCK_DEVNET_VALIDATORS: '',
  MAGICBLOCK_MAINNET_VALIDATORS: '',
  MIN_APP_VERSION: '1.0.0',
};

describe('API Worker AI chat Mongo credits', () => {
  let collection: FakeCollection;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-29T10:00:00.000Z'));
    collection = new FakeCollection();
    setAiChatCreditDatabaseRunnerForTests(async (_config, run) =>
      run({ collection: () => collection } as unknown as Db),
    );
  });

  afterEach(() => {
    resetAiChatCreditDatabaseRunnerForTests();
    jest.useRealTimers();
  });

  it('creates a zero-use usage document when status is read', async () => {
    const status = await getAiChatCreditStatus(env, {
      walletSubject: 'WalletStatus111',
      fallbackSubjectKey: fallbackKey('device-status'),
    });

    expect(status).toMatchObject({
      limit: 5,
      used: 0,
      remaining: 5,
      subjectType: 'wallet',
    });
    expect(collection.snapshot()).toHaveLength(1);
    expect(collection.snapshot()[0]).toMatchObject({
      subject_type: 'wallet',
      subject_key: 'WalletStatus111',
      limit: 5,
      used: 0,
      consumed_turn_ids: [],
    });
  });

  it('counts one visible user turn once and blocks the sixth turn', async () => {
    const first = await consumeAiChatCredit(env, {
      walletSubject: 'Wallet111',
      fallbackSubjectKey: fallbackKey('device-1'),
      turnId: 'turn-1',
    });
    expect(first).toMatchObject({
      allowed: true,
      status: { limit: 5, used: 1, remaining: 4, subjectType: 'wallet' },
    });

    const retry = await consumeAiChatCredit(env, {
      walletSubject: 'Wallet111',
      fallbackSubjectKey: fallbackKey('device-1'),
      turnId: 'turn-1',
    });
    expect(retry).toMatchObject({
      allowed: true,
      status: { used: 1, remaining: 4 },
    });

    for (const turnId of ['turn-2', 'turn-3', 'turn-4', 'turn-5']) {
      const result = await consumeAiChatCredit(env, {
        walletSubject: 'Wallet111',
        fallbackSubjectKey: fallbackKey('device-1'),
        turnId,
      });
      expect(result.allowed).toBe(true);
    }

    const fifthStatus = await getAiChatCreditStatus(env, {
      walletSubject: 'Wallet111',
      fallbackSubjectKey: fallbackKey('device-1'),
    });
    expect(fifthStatus).toMatchObject({ used: 5, remaining: 0 });

    const blocked = await consumeAiChatCredit(env, {
      walletSubject: 'Wallet111',
      fallbackSubjectKey: fallbackKey('device-1'),
      turnId: 'turn-6',
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.status).toMatchObject({ used: 5, remaining: 0 });
    expect(blocked.status.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets credits after the configured window ends', async () => {
    for (const turnId of ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5']) {
      await consumeAiChatCredit(env, {
        walletSubject: 'Wallet222',
        fallbackSubjectKey: fallbackKey('device-1'),
        turnId,
      });
    }

    jest.setSystemTime(new Date('2026-06-29T11:00:01.000Z'));
    const status = await getAiChatCreditStatus(env, {
      walletSubject: 'Wallet222',
      fallbackSubjectKey: fallbackKey('device-1'),
    });

    expect(status).toMatchObject({ limit: 5, used: 0, remaining: 5 });
  });
});

function fallbackKey(seed: string): string {
  const hex = Array.from(seed, (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return hex.padEnd(64, '0').slice(0, 64);
}

class FakeCollection {
  private readonly documents: FakeUsageDocument[] = [];

  snapshot(): FakeUsageDocument[] {
    return this.documents.map((document) => ({ ...document }));
  }

  async findOne(filter: Record<string, unknown>): Promise<FakeUsageDocument | null> {
    return this.documents.find((document) => matchesFilter(document, filter)) ?? null;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, Record<string, unknown>>,
    options?: { upsert?: boolean },
  ): Promise<{ modifiedCount: number; upsertedCount?: number }> {
    const document = this.documents.find((item) => matchesFilter(item, filter));
    if (document != null) {
      applyUpdate(document, update, false);
      return { modifiedCount: 1 };
    }

    if (options?.upsert === true) {
      const inserted: FakeUsageDocument = {};
      applyUpdate(inserted, update, true);
      this.documents.push(inserted);
      return { modifiedCount: 0, upsertedCount: 1 };
    }

    return { modifiedCount: 0 };
  }
}

function matchesFilter(document: FakeUsageDocument, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = document[key as keyof FakeUsageDocument];
    if (isOperatorFilter(expected)) {
      if (expected.$lte != null && !(actual instanceof Date && actual <= expected.$lte)) {
        return false;
      }
      if (expected.$gt != null && !(actual instanceof Date && actual > expected.$gt)) return false;
      if (expected.$lt != null && !(typeof actual === 'number' && actual < expected.$lt)) {
        return false;
      }
      if ('$ne' in expected) {
        if (Array.isArray(actual) && actual.includes(String(expected.$ne))) return false;
        if (!Array.isArray(actual) && actual === expected.$ne) return false;
      }
      continue;
    }

    if (actual !== expected) return false;
  }

  return true;
}

function applyUpdate(
  document: FakeUsageDocument,
  update: Record<string, Record<string, unknown>>,
  inserting: boolean,
): void {
  if (inserting) Object.assign(document, update.$setOnInsert);
  Object.assign(document, update.$set);

  for (const [key, value] of Object.entries(update.$inc ?? {})) {
    const current = Number(document[key as keyof FakeUsageDocument] ?? 0);
    (document as Record<string, unknown>)[key] = current + Number(value);
  }

  for (const [key, value] of Object.entries(update.$addToSet ?? {})) {
    const current = (document as Record<string, unknown>)[key];
    const next = Array.isArray(current) ? current : [];
    if (!next.includes(value)) next.push(value);
    (document as Record<string, unknown>)[key] = next;
  }
}

function isOperatorFilter(value: unknown): value is {
  $lte?: Date;
  $gt?: Date;
  $lt?: number;
  $ne?: unknown;
} {
  return (
    typeof value === 'object' &&
    value != null &&
    Object.keys(value).some((key) => key.startsWith('$'))
  );
}
