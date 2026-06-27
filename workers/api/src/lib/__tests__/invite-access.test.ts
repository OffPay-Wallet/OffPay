import { createHmac } from 'crypto';

import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const mockCollections = new Map<string, MockCollection>();

class MockCollection {
  documents: Array<Record<string, any>>;

  constructor(documents: Array<Record<string, any>> = []) {
    this.documents = documents;
  }

  async findOne(filter: Record<string, any>): Promise<Record<string, any> | null> {
    return this.documents.find((document) => matchesFilter(document, filter)) ?? null;
  }

  async updateOne(
    filter: Record<string, any>,
    update: Record<string, any>,
    options?: { upsert?: boolean },
  ): Promise<{ modifiedCount: number; upsertedCount: number }> {
    const existing = this.documents.find((document) => matchesFilter(document, filter));
    if (existing != null) {
      applyUpdate(existing, update, false);
      return { modifiedCount: 1, upsertedCount: 0 };
    }

    if (options?.upsert === true) {
      const inserted: Record<string, any> = { _id: `mock-${this.documents.length + 1}` };
      for (const [key, value] of Object.entries(filter)) {
        if (key.startsWith('$') || isOperatorObject(value)) continue;
        inserted[key] = value;
      }
      applyUpdate(inserted, update, true);
      this.documents.push(inserted);
      return { modifiedCount: 0, upsertedCount: 1 };
    }

    return { modifiedCount: 0, upsertedCount: 0 };
  }

  async insertMany(records: Array<Record<string, any>>): Promise<void> {
    this.documents.push(
      ...records.map((record) => ({ ...record, _id: `mock-${this.documents.length + 1}` })),
    );
  }
}

jest.mock('mongodb', () => ({
  MongoClient: class {
    constructor(_uri: string) {}

    async connect(): Promise<void> {}

    db(_name: string): { collection: (name: string) => MockCollection } {
      return {
        collection: (name: string) => {
          let collection = mockCollections.get(name);
          if (collection == null) {
            collection = new MockCollection();
            mockCollections.set(name, collection);
          }
          return collection;
        },
      };
    }

    async close(): Promise<void> {}
  },
}));

import {
  checkInviteEmailForAccess,
  ensureInviteAccessForBootstrap,
  verifyInviteCodeForAccess,
} from '../invite-access';
import type { Bindings } from '../types';

const PEPPER = 'invite-pepper-for-tests-minimum-32-chars';
const INVITE_CODE = 'A1B2C3';
const EMAIL = 'tester@example.com';
const DEVICE_ID = 'device-1';
const DEVICE_ID_2 = 'device-2';
const WALLET_ADDRESS = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';
const WALLET_ADDRESS_2 = '5cfv4nUTqyxTkB8JWS6nqzYJXqqf9u65c4BNGqZQW73r';

function isOperatorObject(value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value != null &&
    Object.keys(value).some((key) => key.startsWith('$'))
  );
}

function matchesFilter(document: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return Array.isArray(expected) && expected.some((entry) => matchesFilter(document, entry));
    }

    if (isOperatorObject(expected)) {
      if ('$ne' in expected && document[key] === expected.$ne) return false;
      if ('$gt' in expected && !(document[key] > expected.$gt)) return false;
      if ('$lte' in expected && !(document[key] <= expected.$lte)) return false;
      if ('$exists' in expected) {
        const exists = Object.prototype.hasOwnProperty.call(document, key);
        if (exists !== expected.$exists) return false;
      }
      return true;
    }

    return document[key] === expected;
  });
}

function applyUpdate(
  document: Record<string, any>,
  update: Record<string, any>,
  inserting: boolean,
): void {
  Object.assign(document, update.$set ?? {});

  if (inserting) {
    for (const [key, value] of Object.entries(update.$setOnInsert ?? {})) {
      if (!(key in document)) document[key] = value;
    }
  }

  for (const key of Object.keys(update.$unset ?? {})) {
    delete document[key];
  }
}

function inviteCodeHash(code: string): string {
  return createHmac('sha256', PEPPER).update(code).digest('hex');
}

function inviteEnv(): Bindings {
  return {
    OFFPAY_INVITE_GATE_MODE: 'required',
    OFFPAY_INVITE_CODE_PEPPER: PEPPER,
    MONGODB_URI: 'mongodb://mock',
    MONGODB_DATABASE: 'offpay-test',
  } as Bindings;
}

describe('invite access', () => {
  beforeEach(() => {
    mockCollections.clear();
    mockCollections.set(
      'invite_codes',
      new MockCollection([
        {
          _id: 'invite-code-1',
          code_hash: inviteCodeHash(INVITE_CODE),
          code_format: 'alphanumeric_6',
          code_length: 6,
          segment: 'B1',
          status: 'unused',
          expires_at: '2999-01-01T00:00:00.000Z',
          locked: false,
        },
      ]),
    );
    mockCollections.set('invite_access', new MockCollection());
  });

  it('saves verified email/device access and redeems it during bootstrap without code re-entry', async () => {
    await expect(
      verifyInviteCodeForAccess(inviteEnv(), INVITE_CODE, DEVICE_ID, EMAIL),
    ).resolves.toMatchObject({
      gate: 'required',
      email: EMAIL,
      segment: 'B1',
    });

    await expect(checkInviteEmailForAccess(inviteEnv(), EMAIL, DEVICE_ID)).resolves.toMatchObject({
      verified: true,
      segment: 'B1',
    });

    await expect(
      ensureInviteAccessForBootstrap(inviteEnv(), {
        walletAddress: WALLET_ADDRESS,
        deviceId: DEVICE_ID,
        email: EMAIL,
      }),
    ).resolves.toBeUndefined();

    expect(mockCollections.get('invite_codes')?.documents[0]).toMatchObject({
      status: 'used',
      used_by_wallet_address: WALLET_ADDRESS,
      used_by_email: EMAIL,
    });
    expect(mockCollections.get('invite_access')?.documents).toContainEqual(
      expect.objectContaining({
        status: 'active',
        wallet_address: WALLET_ADDRESS,
        email: EMAIL,
        invite_code_hash: inviteCodeHash(INVITE_CODE),
      }),
    );
  });

  it('restores invite access on a new device when the email already used a code', async () => {
    await verifyInviteCodeForAccess(inviteEnv(), INVITE_CODE, DEVICE_ID, EMAIL);
    await ensureInviteAccessForBootstrap(inviteEnv(), {
      walletAddress: WALLET_ADDRESS,
      deviceId: DEVICE_ID,
      email: EMAIL,
    });

    await expect(checkInviteEmailForAccess(inviteEnv(), EMAIL, DEVICE_ID_2)).resolves.toMatchObject(
      {
        verified: true,
        segment: 'B1',
      },
    );

    await expect(
      ensureInviteAccessForBootstrap(inviteEnv(), {
        walletAddress: WALLET_ADDRESS_2,
        deviceId: DEVICE_ID_2,
        email: EMAIL,
      }),
    ).resolves.toBeUndefined();

    expect(mockCollections.get('invite_access')?.documents).toContainEqual(
      expect.objectContaining({
        status: 'active',
        wallet_address: WALLET_ADDRESS_2,
        email: EMAIL,
        invite_code_hash: inviteCodeHash(INVITE_CODE),
      }),
    );
  });

  it('does not restore a pending email reservation on a different device', async () => {
    await verifyInviteCodeForAccess(inviteEnv(), INVITE_CODE, DEVICE_ID, EMAIL);

    await expect(checkInviteEmailForAccess(inviteEnv(), EMAIL, DEVICE_ID_2)).resolves.toMatchObject(
      {
        verified: false,
      },
    );

    await expect(
      ensureInviteAccessForBootstrap(inviteEnv(), {
        walletAddress: WALLET_ADDRESS_2,
        deviceId: DEVICE_ID_2,
        email: EMAIL,
      }),
    ).rejects.toMatchObject({
      code: 'INVITE_REQUIRED',
    });
  });
});
