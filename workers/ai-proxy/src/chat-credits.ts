import { ProviderError, safeJson } from './http';

import type { AiProxyEnv } from './types';

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

export interface AiChatCreditIdentity {
  walletSubject?: string | null;
  deviceId?: string | null;
}

export interface AiChatCreditConsumptionResult {
  allowed: boolean;
  status: AiChatCreditStatus;
}

interface AiChatCreditServiceRequest {
  walletSubject?: string | null;
  fallbackSubjectKey: string;
  turnId?: string | null;
}

const MAX_TURN_ID_LENGTH = 96;

export async function getAiChatCreditStatus(
  request: Request,
  env: AiProxyEnv,
  identity: AiChatCreditIdentity,
): Promise<AiChatCreditStatus> {
  const payload = await buildCreditServiceRequest(request, identity, false);
  const service = getCreditService(env);

  try {
    return normalizeCreditStatus(await service.getStatus(payload));
  } catch (error) {
    throw serviceUnavailable(error, 'status');
  }
}

export async function consumeAiChatCredit(
  request: Request,
  env: AiProxyEnv,
  identity: AiChatCreditIdentity,
): Promise<AiChatCreditConsumptionResult> {
  const payload = await buildCreditServiceRequest(request, identity, true);
  const service = getCreditService(env);

  try {
    return normalizeConsumptionResult(await service.consume(payload));
  } catch (error) {
    throw serviceUnavailable(error, 'consume');
  }
}

export function aiChatCreditLimitResponse(status: AiChatCreditStatus, cors: HeadersInit): Response {
  const retryAfterMs = Math.max(1_000, status.retryAfterMs ?? status.resetAtMs - Date.now());
  const response = new Response(
    JSON.stringify({
      kind: 'error',
      code: 'RATE_LIMITED',
      message: 'Yuga credits are used for this hour.',
      retryAfterMs,
      credits: {
        ...status,
        retryAfterMs,
      },
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...cors,
      },
    },
  );
  applyAiChatCreditHeaders(response.headers, { ...status, retryAfterMs });
  response.headers.set('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
  return response;
}

export function applyAiChatCreditHeaders(headers: Headers, status?: AiChatCreditStatus): void {
  if (status == null) return;
  headers.set('X-Offpay-AI-Credits-Limit', status.limit.toString());
  headers.set('X-Offpay-AI-Credits-Used', status.used.toString());
  headers.set('X-Offpay-AI-Credits-Remaining', status.remaining.toString());
  headers.set('X-Offpay-AI-Credits-Reset', Math.ceil(status.resetAtMs / 1000).toString());
}

async function buildCreditServiceRequest(
  request: Request,
  identity: AiChatCreditIdentity,
  includeTurnId: boolean,
): Promise<AiChatCreditServiceRequest> {
  return {
    walletSubject: identity.walletSubject ?? null,
    fallbackSubjectKey: await sha256Hex(readFallbackIdentifier(request, identity)),
    ...(includeTurnId ? { turnId: readTurnId(request) } : {}),
  };
}

function readFallbackIdentifier(request: Request, identity: AiChatCreditIdentity): string {
  const deviceId = identity.deviceId?.trim();
  if (deviceId != null && deviceId.length > 0) return `device:${deviceId}`;

  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp != null && cfIp.length > 0) return `ip:${cfIp}`;

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor != null && forwardedFor.length > 0) return `ip:${forwardedFor}`;

  const origin = request.headers.get('origin')?.trim() ?? 'native';
  const userAgent = request.headers.get('user-agent')?.trim() ?? 'unknown';
  return `fallback:${origin}:${userAgent}`;
}

function readTurnId(request: Request): string {
  const rawTurnId = request.headers.get('x-offpay-ai-turn-id')?.trim() ?? '';
  if (
    rawTurnId.length > 0 &&
    rawTurnId.length <= MAX_TURN_ID_LENGTH &&
    /^[A-Za-z0-9:_-]+$/.test(rawTurnId)
  ) {
    return rawTurnId;
  }

  return `request:${crypto.randomUUID()}`;
}

function getCreditService(env: AiProxyEnv): NonNullable<AiProxyEnv['OFFPAY_API_AI_CREDITS']> {
  if (env.OFFPAY_API_AI_CREDITS == null) {
    throw new ProviderError('proxy', 503, 'Yuga credit service binding is not configured.');
  }
  return env.OFFPAY_API_AI_CREDITS;
}

function serviceUnavailable(error: unknown, operation: 'status' | 'consume'): ProviderError {
  console.warn(
    'aiProxy.chatCredits.serviceError',
    safeJson(
      {
        operation,
        message: error instanceof Error ? error.message : String(error),
      },
      800,
    ),
  );
  return new ProviderError('proxy', 503, 'Yuga credit tracking is temporarily unavailable.');
}

function normalizeConsumptionResult(value: unknown): AiChatCreditConsumptionResult {
  if (typeof value !== 'object' || value == null) {
    throw new Error('AI credit service returned an invalid consumption response.');
  }
  const result = value as Partial<AiChatCreditConsumptionResult>;
  return {
    allowed: result.allowed === true,
    status: normalizeCreditStatus(result.status),
  };
}

function normalizeCreditStatus(value: unknown): AiChatCreditStatus {
  if (typeof value !== 'object' || value == null) {
    throw new Error('AI credit service returned an invalid status response.');
  }

  const status = value as Partial<AiChatCreditStatus>;
  if (status.kind !== 'ai_chat_credits') {
    throw new Error('AI credit service returned an unexpected status kind.');
  }

  const limit = positiveInt(status.limit);
  const used = positiveInt(status.used);
  const remaining = positiveInt(status.remaining);
  const resetAtMs = positiveInt(status.resetAtMs);
  const windowMs = positiveInt(status.windowMs);
  if (limit == null || used == null || remaining == null || resetAtMs == null || windowMs == null) {
    throw new Error('AI credit service returned incomplete status fields.');
  }

  return {
    kind: 'ai_chat_credits',
    limit,
    used,
    remaining,
    resetAtMs,
    windowMs,
    subjectType: status.subjectType === 'wallet' ? 'wallet' : 'fallback',
    ...(status.retryAfterMs == null
      ? {}
      : { retryAfterMs: positiveInt(status.retryAfterMs) ?? undefined }),
  };
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (entry) => entry.toString(16).padStart(2, '0')).join(
    '',
  );
}
