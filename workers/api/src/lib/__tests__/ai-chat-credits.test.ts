import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  consumeAiChatCredit,
  getAiChatCreditStatus,
  releaseAiChatCredit,
  resetAiChatCreditDatabaseRunnerForTests,
  resetExpiredAiChatCreditWindows,
  setAiChatCreditDatabaseRunnerForTests,
} from '../ai-chat-credits';

import type { Db } from 'mongodb';
import type { Bindings } from '../types';

interface FakeUsageDocument {
  subject_type?: string;
  subject_key?: string;
  limit?: number;
  window_ms?: number;
  used?: number;
  consumed_turn_ids?: string[];
  window_started_at?: Date;
  reset_at?: Date;
  reset_count?: number;
  last_status_checked_at?: Date;
  last_consumed_at?: Date;
  last_released_at?: Date;
  last_release_reason?: string;
  last_blocked_at?: Date;
  last_reset_at?: Date;
  last_reset_reason?: string;
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
      window_ms: 60 * 60 * 1000,
      used: 0,
      consumed_turn_ids: [],
      reset_count: 0,
      last_status_checked_at: new Date('2026-06-29T10:00:00.000Z'),
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
      charged: true,
      status: { limit: 5, used: 1, remaining: 4, subjectType: 'wallet' },
    });
    expect(collection.snapshot()[0]).toMatchObject({
      last_consumed_at: new Date('2026-06-29T10:00:00.000Z'),
      last_status_checked_at: new Date('2026-06-29T10:00:00.000Z'),
    });

    const retry = await consumeAiChatCredit(env, {
      walletSubject: 'Wallet111',
      fallbackSubjectKey: fallbackKey('device-1'),
      turnId: 'turn-1',
    });
    expect(retry).toMatchObject({
      allowed: true,
      charged: false,
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
    expect(blocked.charged).toBe(false);
    expect(blocked.status).toMatchObject({ used: 5, remaining: 0 });
    expect(blocked.status.retryAfterMs).toBeGreaterThan(0);
  });

  it('releases a newly charged turn when the provider fails before a response', async () => {
    const charged = await consumeAiChatCredit(env, {
      walletSubject: 'WalletRelease111',
      fallbackSubjectKey: fallbackKey('device-release'),
      turnId: 'turn-provider-timeout',
    });

    expect(charged).toMatchObject({
      allowed: true,
      charged: true,
      status: { used: 1, remaining: 4 },
    });

    const released = await releaseAiChatCredit(
      env,
      {
        walletSubject: 'WalletRelease111',
        fallbackSubjectKey: fallbackKey('device-release'),
        turnId: 'turn-provider-timeout',
      },
      'provider_timeout',
    );

    expect(released).toMatchObject({ used: 0, remaining: 5 });
    expect(collection.snapshot()[0]).toMatchObject({
      used: 0,
      consumed_turn_ids: [],
      last_released_at: new Date('2026-06-29T10:00:00.000Z'),
      last_release_reason: 'provider_timeout',
    });
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
    expect(collection.snapshot()[0]).toMatchObject({
      reset_count: 1,
      last_reset_at: new Date('2026-06-29T11:00:01.000Z'),
      last_reset_reason: 'request',
      window_started_at: new Date('2026-06-29T11:00:01.000Z'),
    });
  });

  it('resets expired windows from the scheduled worker without a client request', async () => {
    for (const turnId of ['turn-1', 'turn-2']) {
      await consumeAiChatCredit(env, {
        walletSubject: 'WalletScheduled111',
        fallbackSubjectKey: fallbackKey('device-scheduled'),
        turnId,
      });
    }

    jest.setSystemTime(new Date('2026-06-29T11:00:01.000Z'));
    const summary = await resetExpiredAiChatCreditWindows(
      env,
      new Date('2026-06-29T11:00:01.000Z'),
    );

    expect(summary).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    expect(collection.snapshot()[0]).toMatchObject({
      used: 0,
      consumed_turn_ids: [],
      reset_count: 1,
      last_reset_at: new Date('2026-06-29T11:00:01.000Z'),
      last_reset_reason: 'scheduled',
      window_started_at: new Date('2026-06-29T11:00:01.000Z'),
      reset_at: new Date('2026-06-29T12:00:01.000Z'),
    });
  });

  it('keeps each user on an independent reset timestamp during scheduled resets', async () => {
    await consumeAiChatCredit(env, {
      walletSubject: 'ExpiredWallet111',
      fallbackSubjectKey: fallbackKey('device-expired'),
      turnId: 'expired-turn-1',
    });
    await consumeAiChatCredit(env, {
      walletSubject: 'ActiveWallet111',
      fallbackSubjectKey: fallbackKey('device-active'),
      turnId: 'active-turn-1',
    });
    await getAiChatCreditStatus(env, {
      walletSubject: 'UnusedExpiredWallet111',
      fallbackSubjectKey: fallbackKey('device-unused-expired'),
    });

    collection.patchOne(
      { subject_type: 'wallet', subject_key: 'ExpiredWallet111' },
      {
        reset_at: new Date('2026-06-29T10:30:00.000Z'),
        window_started_at: new Date('2026-06-29T09:30:00.000Z'),
      },
    );
    collection.patchOne(
      { subject_type: 'wallet', subject_key: 'ActiveWallet111' },
      {
        reset_at: new Date('2026-06-29T11:30:00.000Z'),
        window_started_at: new Date('2026-06-29T10:30:00.000Z'),
      },
    );
    collection.patchOne(
      { subject_type: 'wallet', subject_key: 'UnusedExpiredWallet111' },
      {
        reset_at: new Date('2026-06-29T10:30:00.000Z'),
        window_started_at: new Date('2026-06-29T09:30:00.000Z'),
      },
    );

    const summary = await resetExpiredAiChatCreditWindows(
      env,
      new Date('2026-06-29T10:45:00.000Z'),
    );
    const documentsBySubject = new Map(
      collection.snapshot().map((document) => [document.subject_key, document]),
    );

    expect(summary).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    expect(documentsBySubject.get('ExpiredWallet111')).toMatchObject({
      used: 0,
      consumed_turn_ids: [],
      reset_at: new Date('2026-06-29T11:45:00.000Z'),
      last_reset_reason: 'scheduled',
    });
    expect(documentsBySubject.get('ActiveWallet111')).toMatchObject({
      used: 1,
      reset_at: new Date('2026-06-29T11:30:00.000Z'),
      window_started_at: new Date('2026-06-29T10:30:00.000Z'),
    });
    expect(documentsBySubject.get('ActiveWallet111')).not.toHaveProperty('last_reset_reason');
    expect(documentsBySubject.get('UnusedExpiredWallet111')).toMatchObject({
      used: 0,
      reset_at: new Date('2026-06-29T10:30:00.000Z'),
    });
    expect(documentsBySubject.get('UnusedExpiredWallet111')).not.toHaveProperty(
      'last_reset_reason',
    );
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

  patchOne(filter: Record<string, unknown>, patch: Partial<FakeUsageDocument>): void {
    const document = this.documents.find((item) => matchesFilter(item, filter));
    if (document == null) throw new Error('Fake document not found.');
    Object.assign(document, patch);
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

  async updateMany(
    filter: Record<string, unknown>,
    update: Record<string, Record<string, unknown>>,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    let matchedCount = 0;
    let modifiedCount = 0;

    for (const document of this.documents) {
      if (!matchesFilter(document, filter)) continue;
      matchedCount += 1;
      applyUpdate(document, update, false);
      modifiedCount += 1;
    }

    return { matchedCount, modifiedCount };
  }
}

function matchesFilter(document: FakeUsageDocument, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = document[key as keyof FakeUsageDocument];
    if (isOperatorFilter(expected)) {
      if (expected.$lte != null && !(actual instanceof Date && actual <= expected.$lte)) {
        return false;
      }
      if (
        expected.$gt != null &&
        !(
          (actual instanceof Date && expected.$gt instanceof Date && actual > expected.$gt) ||
          (typeof actual === 'number' && typeof expected.$gt === 'number' && actual > expected.$gt)
        )
      ) {
        return false;
      }
      if (expected.$lt != null && !(typeof actual === 'number' && actual < expected.$lt)) {
        return false;
      }
      if ('$ne' in expected) {
        if (Array.isArray(actual) && actual.includes(String(expected.$ne))) return false;
        if (!Array.isArray(actual) && actual === expected.$ne) return false;
      }
      continue;
    }

    if (Array.isArray(actual)) {
      if (!actual.includes(expected as never)) return false;
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

  for (const [key, value] of Object.entries(update.$pull ?? {})) {
    const current = (document as Record<string, unknown>)[key];
    if (!Array.isArray(current)) continue;
    (document as Record<string, unknown>)[key] = current.filter((entry) => entry !== value);
  }
}

function isOperatorFilter(value: unknown): value is {
  $lte?: Date;
  $gt?: Date | number;
  $lt?: number;
  $ne?: unknown;
} {
  return (
    typeof value === 'object' &&
    value != null &&
    Object.keys(value).some((key) => key.startsWith('$'))
  );
}
