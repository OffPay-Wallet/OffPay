import { handleChat, handleKindDispatch } from './handlers/chat';
import { handleHealth } from './handlers/health';
import { handleVoiceSpeech, handleVoiceTranscribe } from './handlers/voice';
import {
  corsHeaders,
  errorStatus,
  isOriginAllowed,
  jsonResponse,
  maxChatBytes,
  normalizeError,
  readJson,
} from './http';
import { assertAiProxyRateLimit } from './rate-limit';
import {
  aiChatCreditLimitResponse,
  applyAiChatCreditHeaders,
  consumeAiChatCredit,
  getAiChatCreditStatus,
  releaseAiChatCredit,
} from './chat-credits';
import { verifyOffpayAiSessionToken } from './auth/session-token';
import type { AiProxyEnv } from './types';
import type {
  AiChatCreditIdentity,
  AiChatCreditReleaseReason,
  AiChatCreditStatus,
} from './chat-credits';

interface SessionTokenGateResult {
  ok: boolean;
  walletSubject?: string;
  deviceId?: string;
  reason?: string;
}

export default {
  async fetch(request: Request, env: AiProxyEnv): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);

      if (!isOriginAllowed(request, env)) {
        return jsonResponse(
          { kind: 'error', code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' },
          403,
          cors,
        );
      }

      if (
        request.method === 'GET' &&
        (url.pathname === '/health' || url.pathname === '/api/ai/health')
      ) {
        return handleHealth(env, cors);
      }

      if (request.method === 'GET' && url.pathname === '/api/ai/credits') {
        const tokenGate = await verifySessionToken(request, env);
        if (!tokenGate.ok) {
          return jsonResponse(
            {
              kind: 'error',
              code: 'SESSION_TOKEN_INVALID',
              message: 'Yuga session token is invalid or expired.',
            },
            401,
            cors,
          );
        }

        const credits = await getAiChatCreditStatus(request, env, {
          walletSubject: tokenGate.walletSubject,
          deviceId: tokenGate.deviceId,
        });
        const response = jsonResponse({ credits }, 200, cors);
        applyAiChatCreditHeaders(response.headers, credits);
        return response;
      }

      if (request.method !== 'POST') {
        return jsonResponse(
          {
            kind: 'error',
            code: 'METHOD_NOT_ALLOWED',
            message: 'Use POST for AI proxy operations.',
          },
          405,
          cors,
        );
      }

      // Session-token gate runs *before* rate-limit so verified callers
      // get bucket keys derived from their wallet subject (durable, not
      // IP-roundrobinable). Unverified callers fall back to the IP key
      // and a stricter rate.
      const tokenGate = await verifySessionToken(request, env);
      if (!tokenGate.ok) {
        return jsonResponse(
          {
            kind: 'error',
            code: 'SESSION_TOKEN_INVALID',
            message: 'Yuga session token is invalid or expired.',
          },
          401,
          cors,
        );
      }

      assertAiProxyRateLimit(request, env, { walletSubject: tokenGate.walletSubject });

      if (url.pathname === '/api/ai/chat') {
        return await handleCreditMeteredChat(request, env, cors, {
          walletSubject: tokenGate.walletSubject,
          deviceId: tokenGate.deviceId,
        });
      }

      if (url.pathname === '/api/ai/voice/transcribe') {
        return await handleVoiceTranscribe(request, env, cors);
      }

      if (url.pathname === '/api/ai/voice/speech') {
        return await handleVoiceSpeech(request, env, cors);
      }

      if (url.pathname === '/api/ai') {
        return await handleKindDispatch(
          request,
          env,
          cors,
          (chatRequest, chatEnv, chatCors) =>
            handleCreditMeteredChat(chatRequest, chatEnv, chatCors, {
              walletSubject: tokenGate.walletSubject,
              deviceId: tokenGate.deviceId,
            }),
          handleVoiceSpeech,
        );
      }

      return jsonResponse(
        { kind: 'error', code: 'NOT_FOUND', message: 'AI proxy endpoint not found.' },
        404,
        cors,
      );
    } catch (error) {
      return jsonResponse(normalizeError(error), errorStatus(error), cors);
    }
  },
};

async function handleCreditMeteredChat(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
  identity: AiChatCreditIdentity,
): Promise<Response> {
  const creditResult = await consumeAiChatCredit(request, env, identity);
  if (!creditResult.allowed) {
    return aiChatCreditLimitResponse(creditResult.status, cors);
  }

  try {
    return await handleChat(request, env, cors, { credits: creditResult.status });
  } catch (error) {
    let credits: AiChatCreditStatus = creditResult.status;
    let creditReleased = false;
    if (creditResult.charged) {
      try {
        credits = await releaseAiChatCredit(
          request,
          env,
          identity,
          creditReleaseReasonForError(error),
        );
        creditReleased = true;
      } catch (releaseError) {
        console.warn('aiProxy.chatCredits.releaseFailed', {
          message: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
    }

    const normalizedError = normalizeError(error);
    if (creditReleased) {
      normalizedError.message = creditPreservedMessage(error, normalizedError.message);
    }
    const response = jsonResponse(
      {
        ...normalizedError,
        credits,
      },
      errorStatus(error),
      cors,
    );
    applyAiChatCreditHeaders(response.headers, credits);
    return response;
  }
}

function creditPreservedMessage(error: unknown, fallback: unknown): string {
  if (errorStatus(error) === 504) {
    return 'The AI provider timed out. Your credit was not used. Try again.';
  }
  const message = typeof fallback === 'string' ? fallback : 'Yuga could not complete that request.';
  return `${message} Your credit was not used.`;
}

function creditReleaseReasonForError(error: unknown): AiChatCreditReleaseReason {
  const status = errorStatus(error);
  if (status === 504) return 'provider_timeout';
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return 'provider_error';
  }
  return 'proxy_error';
}

async function verifySessionToken(
  request: Request,
  env: AiProxyEnv,
): Promise<SessionTokenGateResult> {
  const required = env.AI_PROXY_REQUIRE_SESSION_TOKEN === 'true';
  const sharedSecret = env.AI_PROXY_SESSION_SECRET?.trim() ?? '';
  const tokenHeader = request.headers.get('x-offpay-ai-session')?.trim() ?? '';

  // Soft mode: no secret configured at all. Behave as before so existing
  // deploys keep working until the rollout completes. Logs a single line
  // so a misconfigured prod is easy to spot.
  if (sharedSecret.length === 0) {
    if (required) {
      return { ok: false, reason: 'Shared secret is not configured.' };
    }
    return { ok: true };
  }

  if (tokenHeader.length === 0) {
    return required ? { ok: false, reason: 'Missing session token.' } : { ok: true };
  }

  const result = await verifyOffpayAiSessionToken(tokenHeader, { sharedSecret });
  if (!result.ok) {
    return required ? { ok: false, reason: result.reason } : { ok: true };
  }
  return { ok: true, walletSubject: result.walletAddress, deviceId: result.deviceId };
}
