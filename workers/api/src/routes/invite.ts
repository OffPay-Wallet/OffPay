import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { meetsMinVersion, timingSafeEqual } from '../lib/auth.js';
import { isAllowedOrigin } from '../lib/cors.js';
import { AppError } from '../lib/errors.js';
import {
  checkInviteEmailForAccess,
  generateInviteCodesForAccess,
  verifyInviteCodeForAccess,
} from '../lib/invite-access.js';
import type { AppEnv } from '../lib/types.js';
import { ensureSupportedVersionFormat, readJsonBody } from '../lib/validation.js';

const MAX_APP_VERSION_LENGTH = 32;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_INVITE_CODE_LENGTH = 64;
const MAX_EMAIL_LENGTH = 320;
const MAX_ADMIN_INVITE_CODE_COUNT = 100;
const MAX_ADMIN_INVITE_EXPIRY_DAYS = 365;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEGMENT_PATTERN = /^[A-Z0-9]{1,8}$/;

const inviteVerifyBodySchema = z.object({
  inviteCode: z.string().min(1).max(MAX_INVITE_CODE_LENGTH),
  email: z
    .string()
    .min(1, 'Email is required.')
    .max(MAX_EMAIL_LENGTH)
    .regex(EMAIL_PATTERN, 'Invalid email address.'),
});

const inviteCheckEmailBodySchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required.')
    .max(MAX_EMAIL_LENGTH)
    .regex(EMAIL_PATTERN, 'Invalid email address.'),
});

const inviteAdminGenerateBodySchema = z.object({
  count: z.number().int().min(1).max(MAX_ADMIN_INVITE_CODE_COUNT).optional().default(1),
  segment: z
    .string()
    .min(1)
    .max(8)
    .transform((value) => value.trim().toUpperCase())
    .pipe(z.string().regex(SEGMENT_PATTERN))
    .optional()
    .default('B1'),
  expiryDays: z.number().int().min(1).max(MAX_ADMIN_INVITE_EXPIRY_DAYS).optional().default(30),
});

function getMinimumAppVersion(env: AppEnv['Bindings']): string {
  const minimumVersion = env.MIN_APP_VERSION?.trim() ?? '';
  try {
    ensureSupportedVersionFormat(minimumVersion);
  } catch {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return minimumVersion;
}

function ensureAllowedOrigin(origin: string | null | undefined, env: AppEnv['Bindings']): void {
  if (!isAllowedOrigin(origin, env)) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN_ORIGIN',
      message: 'Origin not permitted.',
    });
  }
}

const inviteRoutes = new Hono<AppEnv>();
const encoder = new TextEncoder();

function readAdminToken(context: Context<AppEnv>): string {
  const authorization = context.req.header('Authorization')?.trim() ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  return (
    context.req.header('X-Offpay-Invite-Admin-Token')?.trim() ?? bearerMatch?.[1]?.trim() ?? ''
  );
}

function requireInviteAdminToken(context: Context<AppEnv>): void {
  const configuredToken = context.env.OFFPAY_INVITE_ADMIN_TOKEN?.trim() ?? '';
  if (configuredToken.length < 32) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Invite admin endpoint is not configured.',
      retryable: true,
    });
  }

  const suppliedToken = readAdminToken(context);
  if (
    suppliedToken.length === 0 ||
    !timingSafeEqual(encoder.encode(suppliedToken), encoder.encode(configuredToken))
  ) {
    throw new AppError({
      status: 403,
      code: 'SIGNATURE_INVALID',
      message: 'Invite admin token is invalid.',
    });
  }
}

function parseInvitePublicHeaders(context: Context<AppEnv>): { deviceId: string } {
  ensureAllowedOrigin(context.req.header('Origin'), context.env);

  const appVersion = context.req.header('X-App-Version')?.trim() ?? '';
  if (appVersion.length === 0 || appVersion.length > MAX_APP_VERSION_LENGTH) {
    throw new AppError({
      status: 426,
      code: 'OUTDATED_APP',
      message: 'Please update OffPay.',
    });
  }

  try {
    ensureSupportedVersionFormat(appVersion);
  } catch {
    throw new AppError({
      status: 426,
      code: 'OUTDATED_APP',
      message: 'Please update OffPay.',
    });
  }

  const minimumVersion = getMinimumAppVersion(context.env);
  if (!meetsMinVersion(appVersion, minimumVersion)) {
    throw new AppError({
      status: 426,
      code: 'OUTDATED_APP',
      message: 'Please update OffPay.',
    });
  }

  const deviceId = context.req.header('X-Device-Id')?.trim() ?? '';
  if (deviceId.length === 0 || deviceId.length > MAX_DEVICE_ID_LENGTH) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Device identifier is required.',
    });
  }

  return { deviceId };
}

inviteRoutes.post('/verify', async (context) => {
  const { deviceId } = parseInvitePublicHeaders(context);

  const body = await readJsonBody(
    context.req.raw,
    inviteVerifyBodySchema,
    'Request body is required.',
    'Malformed invite verification request body.',
  );
  const verification = await verifyInviteCodeForAccess(
    context.env,
    body.inviteCode,
    deviceId,
    body.email,
  );

  return context.json(
    {
      verified: true,
      segment: verification.segment,
      gate: verification.gate,
      email: verification.email,
    },
    200,
  );
});

inviteRoutes.post('/check-email', async (context) => {
  const { deviceId } = parseInvitePublicHeaders(context);

  const body = await readJsonBody(
    context.req.raw,
    inviteCheckEmailBodySchema,
    'Request body is required.',
    'Malformed check-email request body.',
  );

  const result = await checkInviteEmailForAccess(context.env, body.email, deviceId);

  return context.json(result, 200);
});

inviteRoutes.post('/admin/generate', async (context) => {
  requireInviteAdminToken(context);

  const body = await readJsonBody(
    context.req.raw,
    inviteAdminGenerateBodySchema,
    'Request body is required.',
    'Malformed invite admin generation request body.',
  );
  const expiresAtIso = new Date(Date.now() + body.expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await generateInviteCodesForAccess(context.env, {
    count: body.count,
    segment: body.segment,
    expiresAtIso,
  });

  context.header('Cache-Control', 'no-store');
  return context.json(
    {
      ...result,
      count: result.codes.length,
    },
    200,
  );
});

export default inviteRoutes;
