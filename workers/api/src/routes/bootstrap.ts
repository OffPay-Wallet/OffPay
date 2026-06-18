import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  TIMESTAMP_FUTURE_SKEW_MS,
  TIMESTAMP_MAX_AGE_MS,
  deriveDeviceSecretHex,
  meetsMinVersion,
} from '../lib/auth.js';
import {
  consumeBootstrapNonce,
  issueBootstrapNonce,
  verifyBootstrapWalletSignature,
} from '../lib/bootstrap.js';
import { isAllowedOrigin } from '../lib/cors.js';
import { AppError, errorResponse } from '../lib/errors.js';
import { ensureInviteAccessForBootstrap } from '../lib/invite-access.js';
import { applyRateLimitHeaders, checkRateLimit } from '../lib/ratelimit.js';
import type { AppEnv } from '../lib/types.js';
import {
  ensureSupportedVersionFormat,
  isValidEd25519Signature,
  isValidSolanaAddress,
  readJsonBody,
  readSearchParams,
} from '../lib/validation.js';
import type { AttestationVerificationInput } from '../lib/attestation.js';

const BOOTSTRAP_ROUTE_PATH = '/api/bootstrap/provision';
const MAX_WALLET_ADDRESS_LENGTH = 64;
const MAX_SIGNATURE_LENGTH = 128;
const MAX_APP_VERSION_LENGTH = 32;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_ATTESTATION_TOKEN_LENGTH = 32_000;
const MAX_ATTESTATION_KEY_ID_LENGTH = 256;
const MAX_INVITE_CODE_LENGTH = 64;

const bootstrapGetQuerySchema = z.object({
  wallet: z.string().min(1).max(MAX_WALLET_ADDRESS_LENGTH),
});

const bootstrapPostBodySchema = z.object({
  walletAddress: z.string().min(1).max(MAX_WALLET_ADDRESS_LENGTH),
  nonce: z.string().uuid(),
  attestationToken: z.string().max(MAX_ATTESTATION_TOKEN_LENGTH).optional().default(''),
  walletSignature: z.string().min(1).max(MAX_SIGNATURE_LENGTH).optional(),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().min(1).max(MAX_APP_VERSION_LENGTH),
  deviceId: z.string().min(1).max(MAX_DEVICE_ID_LENGTH),
  attestationKeyId: z.string().min(1).max(MAX_ATTESTATION_KEY_ID_LENGTH).optional(),
  inviteCode: z.string().max(MAX_INVITE_CODE_LENGTH).optional(),
  email: z.string().max(320).optional(),
});

interface BootstrapPublicHeaders {
  appVersion: string;
  deviceId: string;
}

interface BootstrapProvisionHeaders extends BootstrapPublicHeaders {
  timestamp: number;
  walletAddress?: string;
  signature?: string;
}

function getRequiredBinding(env: AppEnv['Bindings'], key: keyof AppEnv['Bindings']): string {
  const rawValue = env[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return value;
}

function getBootstrapSecretVersion(env: AppEnv['Bindings']): number {
  const bootstrapVersion = getRequiredBinding(env, 'BOOTSTRAP_SECRET_VERSION');
  if (!/^\d+$/.test(bootstrapVersion)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return Number(bootstrapVersion);
}

function getMinimumAppVersion(env: AppEnv['Bindings']): string {
  const minimumVersion = getRequiredBinding(env, 'MIN_APP_VERSION');
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

function parseBootstrapPublicHeaders(context: Context<AppEnv>): BootstrapPublicHeaders {
  ensureAllowedOrigin(context.req.header('Origin'), context.env);

  const appVersion = context.req.header('X-App-Version')?.trim() ?? '';
  if (!appVersion) {
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

  const deviceId = context.req.header('X-Device-Id')?.trim() ?? '';
  if (deviceId.length === 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Device identifier is required.',
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

  return {
    appVersion,
    deviceId,
  };
}

function parseBootstrapProvisionHeaders(context: Context<AppEnv>): BootstrapProvisionHeaders {
  const publicHeaders = parseBootstrapPublicHeaders(context);
  const timestampRaw = context.req.header('X-Timestamp')?.trim() ?? '';
  const timestamp = Number(timestampRaw);

  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const now = Date.now();
  if (timestamp < now - TIMESTAMP_MAX_AGE_MS || timestamp > now + TIMESTAMP_FUTURE_SKEW_MS) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const walletAddress = context.req.header('X-Wallet-Address')?.trim() ?? '';
  if (walletAddress && !isValidSolanaAddress(walletAddress)) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const signature = context.req.header('X-Signature')?.trim() ?? '';
  if (signature && !isValidEd25519Signature(signature)) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  return {
    ...publicHeaders,
    timestamp,
    ...(walletAddress ? { walletAddress } : {}),
    ...(signature ? { signature } : {}),
  };
}

function resolveBootstrapWalletSignature(
  bodySignature: string | undefined,
  headerSignature: string | undefined,
): string {
  if (bodySignature && headerSignature && bodySignature !== headerSignature) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Bootstrap request signature does not match the provided header.',
    });
  }

  const signature = bodySignature ?? headerSignature;
  if (!signature || !isValidEd25519Signature(signature)) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  return signature;
}

function ensureWalletMatch(bodyWallet: string, headerWallet: string | undefined): void {
  if (!isValidSolanaAddress(bodyWallet)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
    });
  }

  if (headerWallet && headerWallet !== bodyWallet) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Bootstrap wallet address does not match the provided header.',
    });
  }
}

async function verifyBootstrapAttestationOnDemand(
  bindings: AppEnv['Bindings'],
  input: AttestationVerificationInput,
): Promise<void> {
  await import('reflect-metadata');
  const { verifyBootstrapAttestation } = await import('../lib/attestation.js');
  await verifyBootstrapAttestation(bindings, input);
}

function ensureDeviceMatch(bodyDeviceId: string, headerDeviceId: string): void {
  if (bodyDeviceId !== headerDeviceId) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Bootstrap device identifier does not match the provided header.',
    });
  }
}

function ensureVersionMatch(bodyVersion: string, headerVersion: string): void {
  try {
    ensureSupportedVersionFormat(bodyVersion);
  } catch {
    throw new AppError({
      status: 426,
      code: 'OUTDATED_APP',
      message: 'Please update OffPay.',
    });
  }

  if (bodyVersion !== headerVersion) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Bootstrap app version does not match the provided header.',
    });
  }
}

function buildBootstrapRateLimitIdentifier(walletAddress: string, deviceId: string): string {
  return `${walletAddress}:${deviceId}`;
}

const bootstrapRoutes = new Hono<AppEnv>();

bootstrapRoutes.get('/provision', async (context) => {
  const headers = parseBootstrapPublicHeaders(context);
  const query = readSearchParams(context.req.url, bootstrapGetQuerySchema);

  if (!isValidSolanaAddress(query.wallet)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
    });
  }

  const rateLimit = await checkRateLimit(context.env, {
    method: 'GET',
    path: BOOTSTRAP_ROUTE_PATH,
    identifier: buildBootstrapRateLimitIdentifier(query.wallet, headers.deviceId),
  });

  if (rateLimit.degraded) {
    const response = errorResponse(
      503,
      'UPSTREAM_UNAVAILABLE',
      'Rate limit storage is temporarily unavailable.',
      {
        retryable: true,
        retryAfterMs: rateLimit.retryAfterSec * 1000,
      },
    );
    applyRateLimitHeaders(response.headers, rateLimit);
    response.headers.set('Retry-After', rateLimit.retryAfterSec.toString());
    return response;
  }

  if (!rateLimit.allowed) {
    const response = errorResponse(429, 'RATE_LIMITED', 'Too many requests.', {
      retryable: true,
      retryAfterMs: rateLimit.retryAfterSec * 1000,
    });
    applyRateLimitHeaders(response.headers, rateLimit);
    return response;
  }

  const payload = await issueBootstrapNonce(context.env, query.wallet, headers.deviceId);
  const response = context.json(payload, 200);
  applyRateLimitHeaders(response.headers, rateLimit);
  return response;
});

bootstrapRoutes.post('/provision', async (context) => {
  const headers = parseBootstrapProvisionHeaders(context);
  const body = await readJsonBody(
    context.req.raw,
    bootstrapPostBodySchema,
    'Request body is required.',
    'Malformed bootstrap request body.',
  );

  ensureWalletMatch(body.walletAddress, headers.walletAddress);
  ensureDeviceMatch(body.deviceId, headers.deviceId);
  ensureVersionMatch(body.appVersion, headers.appVersion);

  const signature = resolveBootstrapWalletSignature(body.walletSignature, headers.signature);
  const walletSignatureValid = await verifyBootstrapWalletSignature(
    body.walletAddress,
    body.nonce,
    signature,
  );
  if (!walletSignatureValid) {
    throw new AppError({
      status: 401,
      code: 'SIGNATURE_INVALID',
      message: 'Request signature invalid or expired.',
    });
  }

  const rateLimit = await checkRateLimit(context.env, {
    method: 'POST',
    path: BOOTSTRAP_ROUTE_PATH,
    identifier: buildBootstrapRateLimitIdentifier(body.walletAddress, body.deviceId),
  });

  if (rateLimit.degraded) {
    const response = errorResponse(
      503,
      'UPSTREAM_UNAVAILABLE',
      'Rate limit storage is temporarily unavailable.',
      {
        retryable: true,
        retryAfterMs: rateLimit.retryAfterSec * 1000,
      },
    );
    applyRateLimitHeaders(response.headers, rateLimit);
    response.headers.set('Retry-After', rateLimit.retryAfterSec.toString());
    return response;
  }

  if (!rateLimit.allowed) {
    const response = errorResponse(429, 'RATE_LIMITED', 'Too many requests.', {
      retryable: true,
      retryAfterMs: rateLimit.retryAfterSec * 1000,
    });
    applyRateLimitHeaders(response.headers, rateLimit);
    return response;
  }

  const consumedNonce = await consumeBootstrapNonce(context.env, body.nonce);

  if (
    !consumedNonce ||
    consumedNonce.walletAddress !== body.walletAddress ||
    consumedNonce.deviceId !== body.deviceId
  ) {
    throw new AppError({
      status: 400,
      code: 'INVALID_NONCE',
      message: 'Bootstrap nonce is invalid or expired.',
    });
  }

  await verifyBootstrapAttestationOnDemand(context.env, {
    platform: body.platform,
    attestationToken: body.attestationToken ?? '',
    challengeNonce: body.nonce,
    ...(body.attestationKeyId ? { attestationKeyId: body.attestationKeyId } : {}),
  });

  await ensureInviteAccessForBootstrap(context.env, {
    walletAddress: body.walletAddress,
    deviceId: body.deviceId,
    inviteCode: body.inviteCode,
    email: body.email,
  });

  const bootstrapVersion = getBootstrapSecretVersion(context.env);
  const secret = await deriveDeviceSecretHex(
    getRequiredBinding(context.env, 'OFFPAY_BOOTSTRAP_SECRET'),
    body.walletAddress,
    body.deviceId,
  );
  const response = context.json(
    {
      secret,
      issuedAt: Date.now(),
      bootstrapVersion,
    },
    200,
  );
  applyRateLimitHeaders(response.headers, rateLimit);
  return response;
});

export default bootstrapRoutes;
