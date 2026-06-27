import { MongoClient, type Collection, type Db, type ObjectId } from 'mongodb';
import {
  OFFPAY_INVITE_ALPHABET,
  OFFPAY_INVITE_CODE_FORMAT,
  OFFPAY_INVITE_CODE_LENGTH,
  getInviteCodeValidationMessage,
  parseInviteCode,
} from '../../../../shared/invite-codes';
import { AppError } from './errors.js';
import type { Bindings } from './types.js';

interface InviteAccessParams {
  walletAddress: string;
  deviceId: string;
  inviteCode?: string | null;
  email?: string | null;
}

interface InviteVerificationResult {
  segment: string | null;
  gate: 'disabled' | 'required';
  email: string | null;
}

interface GeneratedInviteCodeResult {
  code: string;
  codeHash: string;
}

interface InviteCodeDocument {
  code_hash?: string;
  code_format?: string;
  code_length?: number;
  segment?: string;
  status?: string;
  created_at?: string;
  expires_at?: string;
  reserved_at?: string | null;
  reserved_by_email?: string | null;
  reserved_by_device_id_hash?: string | null;
  reservation_expires_at?: string | null;
  used_at?: string | null;
  used_by_wallet_address?: string | null;
  used_by_device_id_hash?: string | null;
  used_by_email?: string | null;
  failed_attempts?: number;
  locked?: boolean;
}

interface InviteGateConfig {
  enabled: boolean;
  uri: string;
  database: string;
  pepper: string;
}

interface ActiveWalletInviteAccess {
  inviteCodeHash?: string;
  segment?: string;
}

interface EmailInviteAccess {
  inviteCodeHash?: string;
  segment?: string;
  status?: string;
}

const INVITE_CODES_COLLECTION = 'invite_codes';
const INVITE_ACCESS_COLLECTION = 'invite_access';
const MIN_PEPPER_LENGTH = 32;
const INVITE_CODE_RESERVATION_TTL_MS = 30 * 60 * 1000;
const MAX_ADMIN_GENERATE_INVITE_CODES = 100;

function hasTruthyStringBinding(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isInviteGateEnabled(bindings: Bindings): boolean {
  const mode = bindings.OFFPAY_INVITE_GATE_MODE?.trim().toLowerCase();
  if (mode === 'disabled' || mode === 'off') return false;
  if (mode === 'required' || mode === 'enabled' || mode === 'on') return true;
  return hasTruthyStringBinding(bindings.OFFPAY_PROTOTYPE_MODE);
}

function readRequiredString(bindings: Bindings, key: keyof Bindings): string {
  const value = bindings[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getInviteGateConfig(bindings: Bindings): InviteGateConfig {
  const enabled = isInviteGateEnabled(bindings);
  const uri = readRequiredString(bindings, 'MONGODB_URI');
  const database = readRequiredString(bindings, 'MONGODB_DATABASE');
  const pepper = readRequiredString(bindings, 'OFFPAY_INVITE_CODE_PEPPER');

  if (!enabled) {
    return {
      enabled: false,
      uri,
      database,
      pepper,
    };
  }

  if (uri.length === 0 || database.length === 0 || pepper.length < MIN_PEPPER_LENGTH) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Invite access is not configured.',
      retryable: true,
    });
  }

  return {
    enabled: true,
    uri,
    database,
    pepper,
  };
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (entry) => entry.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

async function hashInviteDeviceId(
  config: InviteGateConfig,
  deviceId: string | null | undefined,
): Promise<string | null> {
  const normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (normalizedDeviceId.length === 0) return null;
  return sha256Hex(`${config.pepper}:${normalizedDeviceId}`);
}

async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(signature));
}

function randomInviteCode(): string {
  let output = '';
  const randomBytes = new Uint8Array(1);
  const maxUnbiasedByte =
    Math.floor(256 / OFFPAY_INVITE_ALPHABET.length) * OFFPAY_INVITE_ALPHABET.length;

  while (output.length < OFFPAY_INVITE_CODE_LENGTH) {
    crypto.getRandomValues(randomBytes);
    const value = randomBytes[0]!;
    if (value >= maxUnbiasedByte) continue;
    output += OFFPAY_INVITE_ALPHABET[value % OFFPAY_INVITE_ALPHABET.length];
  }

  return output;
}

async function withMongoDatabase<T>(
  config: InviteGateConfig,
  run: (db: Db) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(config.uri);

  try {
    await client.connect();
    return await run(client.db(config.database));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Invite access is temporarily unavailable.',
      retryable: true,
      cause: error,
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

function inviteCodesCollection(db: Db): Collection<InviteCodeDocument> {
  return db.collection<InviteCodeDocument>(INVITE_CODES_COLLECTION);
}

function inviteAccessCollection(db: Db): Collection {
  return db.collection(INVITE_ACCESS_COLLECTION);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function findActiveWalletInviteAccess(
  config: InviteGateConfig,
  walletAddress: string,
): Promise<ActiveWalletInviteAccess | null> {
  const document = await withMongoDatabase(config, (db) =>
    inviteAccessCollection(db).findOne(
      {
        status: 'active',
        wallet_address: walletAddress,
      },
      {
        projection: {
          _id: 1,
          status: 1,
          invite_code_hash: 1,
          invite_code_segment: 1,
        },
      },
    ),
  );

  if (document?.status !== 'active') return null;

  return {
    inviteCodeHash: document.invite_code_hash,
    segment: document.invite_code_segment,
  };
}

/**
 * Look up an existing invite_access record by the code hash and email.
 * This allows returning users (cache wipe, device change) to re-verify
 * a used code as long as they supply the same email they originally used.
 */
async function findInviteAccessByCodeAndEmail(
  config: InviteGateConfig,
  inviteCodeHash: string,
  email: string,
): Promise<boolean> {
  const document = await withMongoDatabase(config, (db) =>
    inviteAccessCollection(db).findOne(
      {
        invite_code_hash: inviteCodeHash,
        email,
        status: 'active',
      },
      {
        projection: { _id: 1 },
      },
    ),
  );

  return document != null;
}

async function findActiveInviteAccessByEmail(
  config: InviteGateConfig,
  email: string,
): Promise<EmailInviteAccess | null> {
  const document = await withMongoDatabase(config, (db) =>
    inviteAccessCollection(db).findOne(
      {
        email,
        status: 'active',
      },
      { projection: { invite_code_hash: 1, invite_code_segment: 1, status: 1 } },
    ),
  );

  if (document == null) return null;
  return {
    inviteCodeHash: document.invite_code_hash,
    segment: document.invite_code_segment,
    status: document.status,
  };
}

/**
 * Look up an existing invite_access record by email and device.
 * Pending access remains device-bound until bootstrap redeems the invite code.
 */
async function findInviteAccessByEmailAndDevice(
  config: InviteGateConfig,
  email: string,
  deviceIdHash: string,
  nowIso: string,
): Promise<EmailInviteAccess | null> {
  const document = await withMongoDatabase(config, (db) =>
    inviteAccessCollection(db).findOne(
      {
        email,
        device_id_hash: deviceIdHash,
        $or: [
          { status: 'active' },
          {
            status: 'pending',
            reservation_expires_at: { $gt: nowIso },
          },
        ],
      },
      { projection: { invite_code_hash: 1, invite_code_segment: 1, status: 1 } },
    ),
  );

  if (document == null) return null;
  return {
    inviteCodeHash: document.invite_code_hash,
    segment: document.invite_code_segment,
    status: document.status,
  };
}

async function recordPendingInviteAccess(params: {
  config: InviteGateConfig;
  deviceIdHash: string;
  inviteCodeHash: string;
  segment: string;
  email: string;
  nowIso: string;
  reservationExpiresAtIso: string;
}): Promise<void> {
  await withMongoDatabase(params.config, (db) =>
    inviteAccessCollection(db).updateOne(
      {
        device_id_hash: params.deviceIdHash,
        status: 'pending',
      },
      {
        $set: {
          status: 'pending',
          device_id_hash: params.deviceIdHash,
          invite_code_hash: params.inviteCodeHash,
          invite_code_segment: params.segment,
          email: params.email,
          updated_at: params.nowIso,
          reservation_expires_at: params.reservationExpiresAtIso,
        },
        $setOnInsert: {
          created_at: params.nowIso,
        },
      },
      { upsert: true },
    ),
  );
}

function buildInviteAccessSet(params: {
  walletAddress: string;
  deviceIdHash: string;
  inviteCodeHash: string;
  segment: string;
  nowIso: string;
  email?: string | null;
}): Record<string, unknown> {
  return {
    status: 'active',
    wallet_address: params.walletAddress,
    device_id_hash: params.deviceIdHash,
    invite_code_hash: params.inviteCodeHash,
    invite_code_segment: params.segment,
    updated_at: params.nowIso,
    ...(params.email != null && params.email.length > 0 ? { email: params.email } : {}),
  };
}

async function updateInviteAccessById(
  collection: Collection,
  id: ObjectId,
  params: {
    walletAddress: string;
    deviceIdHash: string;
    inviteCodeHash: string;
    segment: string;
    nowIso: string;
    email?: string | null;
  },
): Promise<void> {
  await collection.updateOne(
    { _id: id },
    {
      $set: buildInviteAccessSet(params),
    },
  );
}

async function upsertWalletDeviceInviteAccess(
  collection: Collection,
  params: {
    walletAddress: string;
    deviceIdHash: string;
    inviteCodeHash: string;
    segment: string;
    nowIso: string;
    email?: string | null;
  },
): Promise<void> {
  await collection.updateOne(
    {
      wallet_address: params.walletAddress,
      device_id_hash: params.deviceIdHash,
    },
    {
      $set: buildInviteAccessSet(params),
      $setOnInsert: {
        created_at: params.nowIso,
      },
    },
    { upsert: true },
  );
}

async function upsertInviteAccessWithLegacyFallback(
  collection: Collection,
  params: {
    walletAddress: string;
    deviceIdHash: string;
    inviteCodeHash: string;
    segment: string;
    nowIso: string;
    email?: string | null;
  },
): Promise<void> {
  try {
    await upsertWalletDeviceInviteAccess(collection, params);
    return;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const legacyFilters: Record<string, unknown>[] = [];
  if (params.email != null && params.email.length > 0) {
    legacyFilters.push({ email: params.email, status: 'active' });
  }
  legacyFilters.push(
    { wallet_address: params.walletAddress, status: 'active' },
    { device_id_hash: params.deviceIdHash, status: 'active' },
  );

  for (const filter of legacyFilters) {
    const legacyRecord = await collection.findOne(filter, { projection: { _id: 1 } });
    if (legacyRecord == null) continue;
    await updateInviteAccessById(collection, legacyRecord._id, params);
    return;
  }

  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'Invite access requires a database index migration.',
    retryable: true,
  });
}

async function upsertInviteAccess(params: {
  config: InviteGateConfig;
  walletAddress: string;
  deviceIdHash: string;
  inviteCodeHash: string;
  segment: string;
  nowIso: string;
  email?: string | null;
}): Promise<void> {
  await withMongoDatabase(params.config, async (db) => {
    const collection = inviteAccessCollection(db);

    if (params.email != null && params.email.length > 0) {
      // Compatibility: upgrade pre-reservation pending records created by older clients.
      const pendingRecord = await collection.findOne({
        invite_code_hash: params.inviteCodeHash,
        email: params.email,
        status: 'pending',
      });

      if (pendingRecord != null) {
        try {
          await updateInviteAccessById(collection, pendingRecord._id, params);
          return;
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }
      }
    }

    await upsertInviteAccessWithLegacyFallback(collection, params);
  });
}

async function findInviteCodeDocument(
  config: InviteGateConfig,
  codeHash: string,
): Promise<InviteCodeDocument | null> {
  return withMongoDatabase(config, (db) =>
    inviteCodesCollection(db).findOne(
      {
        code_hash: codeHash,
      },
      {
        projection: {
          code_hash: 1,
          code_format: 1,
          code_length: 1,
          segment: 1,
          status: 1,
          expires_at: 1,
          reserved_by_email: 1,
          reserved_by_device_id_hash: 1,
          reservation_expires_at: 1,
          used_by_wallet_address: 1,
          used_by_device_id_hash: 1,
          used_by_email: 1,
          locked: 1,
        },
      },
    ),
  );
}

function isExpired(expiresAt: string | undefined, nowIso: string): boolean {
  return typeof expiresAt !== 'string' || expiresAt.length === 0 || expiresAt <= nowIso;
}

function throwInviteCodeStateError(document: InviteCodeDocument | null, nowIso: string): never {
  if (document == null) {
    throw new AppError({
      status: 403,
      code: 'INVALID_INVITE_CODE',
      message: 'Invite code is invalid.',
    });
  }

  if (document.locked === true || document.status === 'revoked') {
    throw new AppError({
      status: 403,
      code: 'INVITE_REVOKED',
      message: 'Invite code is no longer active.',
    });
  }

  if (document.status === 'expired' || isExpired(document.expires_at, nowIso)) {
    throw new AppError({
      status: 403,
      code: 'INVITE_EXPIRED',
      message: 'Invite code has expired.',
    });
  }

  throw new AppError({
    status: 403,
    code: 'INVITE_ALREADY_USED',
    message: 'Invite code has already been used.',
  });
}

function parseRequiredInviteCode(
  input: string | null | undefined,
): NonNullable<ReturnType<typeof parseInviteCode>['parsed']> & { code: string } {
  const parsedInvite = parseInviteCode(input ?? '');
  if (!parsedInvite.valid || parsedInvite.parsed == null) {
    throw new AppError({
      status: parsedInvite.reason === 'empty' ? 403 : 400,
      code: parsedInvite.reason === 'empty' ? 'INVITE_REQUIRED' : 'INVALID_INVITE_CODE',
      message:
        parsedInvite.reason === 'empty'
          ? 'Invite code is required.'
          : getInviteCodeValidationMessage(parsedInvite.reason),
    });
  }

  return parsedInvite.parsed;
}

function reservationExpired(document: InviteCodeDocument, nowIso: string): boolean {
  return (
    typeof document.reservation_expires_at !== 'string' ||
    document.reservation_expires_at.length === 0 ||
    document.reservation_expires_at <= nowIso
  );
}

function isSameReservation(
  document: InviteCodeDocument,
  email: string,
  deviceIdHash: string,
): boolean {
  return (
    document.status === 'reserved' &&
    document.reserved_by_email === email &&
    document.reserved_by_device_id_hash === deviceIdHash
  );
}

async function reserveInviteCode(params: {
  config: InviteGateConfig;
  codeHash: string;
  email: string;
  deviceIdHash: string;
  nowIso: string;
  reservationExpiresAtIso: string;
}): Promise<boolean> {
  const response = await withMongoDatabase(params.config, (db) =>
    inviteCodesCollection(db).updateOne(
      {
        code_hash: params.codeHash,
        locked: { $ne: true },
        expires_at: { $gt: params.nowIso },
        $or: [
          { status: 'unused' },
          {
            status: 'reserved',
            reserved_by_email: params.email,
            reserved_by_device_id_hash: params.deviceIdHash,
          },
          {
            status: 'reserved',
            reservation_expires_at: { $lte: params.nowIso },
          },
        ],
      },
      {
        $set: {
          status: 'reserved',
          reserved_at: params.nowIso,
          reserved_by_email: params.email,
          reserved_by_device_id_hash: params.deviceIdHash,
          reservation_expires_at: params.reservationExpiresAtIso,
        },
      },
    ),
  );

  return response.modifiedCount === 1;
}

async function redeemInviteCode(params: {
  config: InviteGateConfig;
  walletAddress: string;
  deviceIdHash: string;
  codeHash: string;
  nowIso: string;
  email?: string | null;
}): Promise<boolean> {
  const reservationMatchers =
    params.email != null && params.email.length > 0
      ? [
          {
            status: 'reserved',
            reserved_by_email: params.email,
            reserved_by_device_id_hash: params.deviceIdHash,
          },
        ]
      : [];
  const response = await withMongoDatabase(params.config, (db) =>
    inviteCodesCollection(db).updateOne(
      {
        code_hash: params.codeHash,
        locked: { $ne: true },
        expires_at: { $gt: params.nowIso },
        $or: [{ status: 'unused' }, ...reservationMatchers],
      },
      {
        $set: {
          status: 'used',
          used_at: params.nowIso,
          used_by_wallet_address: params.walletAddress,
          used_by_device_id_hash: params.deviceIdHash,
          ...(params.email != null && params.email.length > 0
            ? { used_by_email: params.email }
            : {}),
        },
        $unset: {
          reservation_expires_at: '',
        },
      },
    ),
  );

  return response.modifiedCount === 1;
}

async function bindUsedInviteEmailForDevice(params: {
  config: InviteGateConfig;
  walletAddress: string;
  deviceIdHash: string;
  codeHash: string;
  segment: string;
  email: string;
  nowIso: string;
}): Promise<void> {
  await Promise.all([
    withMongoDatabase(params.config, (db) =>
      inviteCodesCollection(db).updateOne(
        {
          code_hash: params.codeHash,
          status: 'used',
          used_by_device_id_hash: params.deviceIdHash,
          $or: [
            { used_by_email: { $exists: false } },
            { used_by_email: null },
            { used_by_email: params.email },
          ],
        },
        {
          $set: {
            used_by_email: params.email,
          },
        },
      ),
    ),
    upsertInviteAccess({
      config: params.config,
      walletAddress: params.walletAddress,
      deviceIdHash: params.deviceIdHash,
      inviteCodeHash: params.codeHash,
      segment: params.segment,
      nowIso: params.nowIso,
      email: params.email,
    }),
  ]);
}

export async function verifyInviteCodeForAccess(
  bindings: Bindings,
  inviteCode: string | null | undefined,
  deviceId?: string | null,
  email?: string | null,
): Promise<InviteVerificationResult> {
  const parsedInvite = parseRequiredInviteCode(inviteCode);
  const config = getInviteGateConfig(bindings);
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;

  if (!config.enabled) {
    return {
      segment: null,
      gate: 'disabled',
      email: normalizedEmail,
    };
  }

  const codeHash = await hmacSha256Hex(config.pepper, parsedInvite.code);
  const nowIso = new Date().toISOString();
  const document = await findInviteCodeDocument(config, codeHash);
  const deviceIdHash = await hashInviteDeviceId(config, deviceId);

  if (normalizedEmail == null || normalizedEmail.length === 0 || deviceIdHash == null) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Email and device identifier are required.',
    });
  }

  const reservationExpiresAtIso = new Date(
    Date.now() + INVITE_CODE_RESERVATION_TTL_MS,
  ).toISOString();
  const reserved = await reserveInviteCode({
    config,
    codeHash,
    email: normalizedEmail,
    deviceIdHash,
    nowIso,
    reservationExpiresAtIso,
  });

  if (reserved) {
    const reservedDocument = document ?? (await findInviteCodeDocument(config, codeHash));
    await recordPendingInviteAccess({
      config,
      deviceIdHash,
      inviteCodeHash: codeHash,
      segment: reservedDocument?.segment ?? 'unknown',
      email: normalizedEmail,
      nowIso,
      reservationExpiresAtIso,
    });

    return {
      segment: reservedDocument?.segment ?? null,
      gate: 'required',
      email: normalizedEmail,
    };
  }

  if (
    document?.status === 'used' &&
    deviceIdHash != null &&
    document.used_by_device_id_hash === deviceIdHash
  ) {
    if (
      document.used_by_wallet_address != null &&
      document.used_by_wallet_address.length > 0 &&
      normalizedEmail != null &&
      normalizedEmail.length > 0
    ) {
      await bindUsedInviteEmailForDevice({
        config,
        walletAddress: document.used_by_wallet_address,
        deviceIdHash,
        codeHash,
        segment: document.segment ?? 'unknown',
        email: normalizedEmail,
        nowIso,
      });
    }

    return {
      segment: document.segment ?? null,
      gate: 'required',
      email: normalizedEmail,
    };
  }

  // Case 3: Code is used + different device, but same email as original verification.
  // This handles cache wipes, device switches, and reinstalls.
  if (document?.status === 'used' && normalizedEmail != null && normalizedEmail.length > 0) {
    const emailMatches = await findInviteAccessByCodeAndEmail(config, codeHash, normalizedEmail);
    if (emailMatches) {
      return {
        segment: document.segment ?? null,
        gate: 'required',
        email: normalizedEmail,
      };
    }
  }

  if (
    document != null &&
    isSameReservation(document, normalizedEmail, deviceIdHash) &&
    !reservationExpired(document, nowIso)
  ) {
    return {
      segment: document.segment ?? null,
      gate: 'required',
      email: normalizedEmail,
    };
  }

  throwInviteCodeStateError(document, nowIso);
}

export async function ensureInviteAccessForBootstrap(
  bindings: Bindings,
  params: InviteAccessParams,
): Promise<void> {
  const config = getInviteGateConfig(bindings);
  if (!config.enabled) return;

  const deviceIdHash = await hashInviteDeviceId(config, params.deviceId);
  const normalizedEmail =
    typeof params.email === 'string' ? params.email.trim().toLowerCase() : null;
  if (deviceIdHash == null) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Device identifier is required.',
    });
  }
  const nowIso = new Date().toISOString();

  const existingWalletAccess = await findActiveWalletInviteAccess(config, params.walletAddress);
  if (existingWalletAccess != null) {
    if (
      normalizedEmail != null &&
      normalizedEmail.length > 0 &&
      existingWalletAccess.inviteCodeHash != null
    ) {
      await upsertInviteAccess({
        config,
        walletAddress: params.walletAddress,
        deviceIdHash,
        inviteCodeHash: existingWalletAccess.inviteCodeHash,
        segment: existingWalletAccess.segment ?? 'unknown',
        nowIso,
        email: normalizedEmail,
      });
    }
    return;
  }

  const existingDeviceEmailAccess =
    normalizedEmail != null && normalizedEmail.length > 0
      ? await findInviteAccessByEmailAndDevice(config, normalizedEmail, deviceIdHash, nowIso)
      : null;
  if (existingDeviceEmailAccess?.inviteCodeHash != null) {
    if (existingDeviceEmailAccess.status === 'pending') {
      const redeemed = await redeemInviteCode({
        config,
        walletAddress: params.walletAddress,
        deviceIdHash,
        codeHash: existingDeviceEmailAccess.inviteCodeHash,
        nowIso,
        email: normalizedEmail,
      });

      if (!redeemed) {
        const document = await findInviteCodeDocument(
          config,
          existingDeviceEmailAccess.inviteCodeHash,
        );
        throwInviteCodeStateError(document, nowIso);
      }
    }

    await upsertInviteAccess({
      config,
      walletAddress: params.walletAddress,
      deviceIdHash,
      inviteCodeHash: existingDeviceEmailAccess.inviteCodeHash,
      segment: existingDeviceEmailAccess.segment ?? 'unknown',
      nowIso: new Date().toISOString(),
      email: normalizedEmail,
    });
    return;
  }

  const existingActiveEmailAccess =
    normalizedEmail != null && normalizedEmail.length > 0
      ? await findActiveInviteAccessByEmail(config, normalizedEmail)
      : null;
  if (existingActiveEmailAccess?.inviteCodeHash != null) {
    await upsertInviteAccess({
      config,
      walletAddress: params.walletAddress,
      deviceIdHash,
      inviteCodeHash: existingActiveEmailAccess.inviteCodeHash,
      segment: existingActiveEmailAccess.segment ?? 'unknown',
      nowIso: new Date().toISOString(),
      email: normalizedEmail,
    });
    return;
  }

  const parsedInvite = parseRequiredInviteCode(params.inviteCode);
  const codeHash = await hmacSha256Hex(config.pepper, parsedInvite.code);
  const redeemed = await redeemInviteCode({
    config,
    walletAddress: params.walletAddress,
    deviceIdHash,
    codeHash,
    nowIso,
    email: normalizedEmail,
  });

  if (redeemed) {
    const document = await findInviteCodeDocument(config, codeHash);
    await upsertInviteAccess({
      config,
      walletAddress: params.walletAddress,
      deviceIdHash,
      inviteCodeHash: codeHash,
      segment: document?.segment ?? 'unknown',
      nowIso,
      email: normalizedEmail,
    });
    return;
  }

  const document = await findInviteCodeDocument(config, codeHash);
  const sameWalletOrDevice =
    document?.status === 'used' &&
    (document.used_by_wallet_address === params.walletAddress ||
      document.used_by_device_id_hash === deviceIdHash);

  if (sameWalletOrDevice) {
    await upsertInviteAccess({
      config,
      walletAddress: params.walletAddress,
      deviceIdHash,
      inviteCodeHash: codeHash,
      segment: document.segment ?? 'unknown',
      nowIso,
      email: normalizedEmail,
    });
    return;
  }

  // Case 4: Code is used by a different wallet+device, but same email
  // as the original invite_access record. This handles cache wipes and
  // device switches where the user is re-onboarding with the same email.
  if (document?.status === 'used' && normalizedEmail != null && normalizedEmail.length > 0) {
    const emailMatches = await findInviteAccessByCodeAndEmail(config, codeHash, normalizedEmail);
    if (emailMatches) {
      await upsertInviteAccess({
        config,
        walletAddress: params.walletAddress,
        deviceIdHash,
        inviteCodeHash: codeHash,
        segment: document.segment ?? 'unknown',
        nowIso,
        email: normalizedEmail,
      });
      return;
    }
  }

  throwInviteCodeStateError(document, nowIso);
}

export function isInviteGateRequired(bindings: Bindings): boolean {
  return getInviteGateConfig(bindings).enabled;
}

export async function generateInviteCodesForAccess(
  bindings: Bindings,
  params: {
    count: number;
    segment: string;
    expiresAtIso: string;
  },
): Promise<{
  codeFormat: string;
  codeLength: number;
  expiresAt: string;
  segment: string;
  codes: GeneratedInviteCodeResult[];
}> {
  const config = getInviteGateConfig(bindings);
  if (!config.enabled) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Invite gate is disabled.',
    });
  }

  if (
    !Number.isInteger(params.count) ||
    params.count <= 0 ||
    params.count > MAX_ADMIN_GENERATE_INVITE_CODES
  ) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: `Invite code count must be between 1 and ${MAX_ADMIN_GENERATE_INVITE_CODES}.`,
    });
  }

  const normalizedSegment = params.segment.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(normalizedSegment)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Invite segment must be 1-8 letters or digits.',
    });
  }

  const expiresAt = new Date(params.expiresAtIso);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Invite expiry must be a future timestamp.',
    });
  }

  const nowIso = new Date().toISOString();
  const expiresAtIso = expiresAt.toISOString();
  const generatedCodes: GeneratedInviteCodeResult[] = [];
  const seenCodes = new Set<string>();
  const records: InviteCodeDocument[] = [];

  for (let index = 0; index < params.count; index += 1) {
    let code = randomInviteCode();
    while (seenCodes.has(code)) {
      code = randomInviteCode();
    }
    seenCodes.add(code);
    const codeHash = await hmacSha256Hex(config.pepper, code);
    generatedCodes.push({ code, codeHash });
    records.push({
      code_hash: codeHash,
      code_format: OFFPAY_INVITE_CODE_FORMAT,
      code_length: OFFPAY_INVITE_CODE_LENGTH,
      segment: normalizedSegment,
      status: 'unused',
      created_at: nowIso,
      expires_at: expiresAtIso,
      reserved_by_email: null,
      reserved_by_device_id_hash: null,
      reservation_expires_at: null,
      used_by_wallet_address: null,
      used_by_device_id_hash: null,
      used_by_email: null,
      locked: false,
    });
  }

  await withMongoDatabase(config, async (db) => {
    await inviteCodesCollection(db).insertMany(records, { ordered: true });
  });

  return {
    codeFormat: OFFPAY_INVITE_CODE_FORMAT,
    codeLength: OFFPAY_INVITE_CODE_LENGTH,
    expiresAt: expiresAtIso,
    segment: normalizedSegment,
    codes: generatedCodes,
  };
}

export async function checkInviteEmailForAccess(
  bindings: Bindings,
  email: string,
  deviceId?: string | null,
): Promise<{ verified: boolean; segment?: string }> {
  const config = getInviteGateConfig(bindings);
  if (!config.enabled) {
    return { verified: true };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length === 0) {
    return { verified: false };
  }

  const activeEmailAccess = await findActiveInviteAccessByEmail(config, normalizedEmail);
  if (activeEmailAccess?.inviteCodeHash != null) {
    return { verified: true, segment: activeEmailAccess.segment };
  }

  const deviceIdHash = await hashInviteDeviceId(config, deviceId);
  if (deviceIdHash != null) {
    const existingDeviceAccess = await findInviteAccessByEmailAndDevice(
      config,
      normalizedEmail,
      deviceIdHash,
      new Date().toISOString(),
    );
    if (existingDeviceAccess?.inviteCodeHash != null) {
      return { verified: true, segment: existingDeviceAccess.segment };
    }
  }

  return { verified: false };
}
