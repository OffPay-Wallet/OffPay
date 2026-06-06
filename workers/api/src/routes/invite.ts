import { Hono } from 'hono';
import { z } from 'zod';

import { meetsMinVersion } from '../lib/auth.js';
import { isAllowedOrigin } from '../lib/cors.js';
import { AppError } from '../lib/errors.js';
import { verifyInviteCodeForAccess } from '../lib/invite-access.js';
import type { AppEnv } from '../lib/types.js';
import { ensureSupportedVersionFormat, readJsonBody } from '../lib/validation.js';

const MAX_APP_VERSION_LENGTH = 32;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_INVITE_CODE_LENGTH = 64;

const inviteVerifyBodySchema = z.object({
  inviteCode: z.string().min(1).max(MAX_INVITE_CODE_LENGTH),
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

inviteRoutes.post('/verify', async (context) => {
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

  const body = await readJsonBody(
    context.req.raw,
    inviteVerifyBodySchema,
    'Request body is required.',
    'Malformed invite verification request body.',
  );
  const verification = await verifyInviteCodeForAccess(context.env, body.inviteCode, deviceId);

  return context.json(
    {
      verified: true,
      segment: verification.segment,
      gate: verification.gate,
    },
    200,
  );
});

export default inviteRoutes;
