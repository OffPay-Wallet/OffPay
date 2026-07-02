import { handleChat, handleKindDispatch } from './handlers/chat';
import { handleHealth } from './handlers/health';
import { handleVoiceSpeech, handleVoiceTranscribe } from './handlers/voice';
import { corsHeaders, errorStatus, isOriginAllowed, jsonResponse, normalizeError } from './http';
import { assertAiProxyRateLimit } from './rate-limit';
import {
  aiChatCreditLimitResponse,
  applyAiChatCreditHeaders,
  consumeAiChatCredit,
  getAiChatCreditStatus,
  releaseAiChatCredit,
} from './chat-credits';
import { verifyOffpayAiSessionToken } from './auth/session-token';
import {
  applyAiProxyTimingHeaders,
  createAiProxyTimingContext,
  timeAiProxyStage,
  type AiProxyTimingContext,
} from './timing';
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
    const timing = createAiProxyTimingContext(request);
    const finalize = (response: Response): Response => applyAiProxyTimingHeaders(response, timing);

    if (request.method === 'OPTIONS') {
      return finalize(new Response(null, { status: 204, headers: cors }));
    }

    try {
      const url = new URL(request.url);

      if (!isOriginAllowed(request, env)) {
        return finalize(
          jsonResponse(
            { kind: 'error', code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' },
            403,
            cors,
          ),
        );
      }

      if (
        request.method === 'GET' &&
        (url.pathname === '/health' || url.pathname === '/api/ai/health')
      ) {
        return finalize(handleHealth(env, cors));
      }

      if (request.method === 'GET' && url.pathname === '/api/ai/credits') {
        const tokenGate = await timeAiProxyStage(timing, 'session', () =>
          verifySessionToken(request, env),
        );
        if (!tokenGate.ok) {
          return finalize(
            jsonResponse(
              {
                kind: 'error',
                code: 'SESSION_TOKEN_INVALID',
                message: 'Yuga session token is invalid or expired.',
              },
              401,
              cors,
            ),
          );
        }

        const credits = await timeAiProxyStage(timing, 'credit_status', () =>
          getAiChatCreditStatus(request, env, {
            walletSubject: tokenGate.walletSubject,
            deviceId: tokenGate.deviceId,
          }),
        );
        const response = jsonResponse({ credits }, 200, cors);
        applyAiChatCreditHeaders(response.headers, credits);
        return finalize(response);
      }

      if (request.method !== 'POST') {
        return finalize(
          jsonResponse(
            {
              kind: 'error',
              code: 'METHOD_NOT_ALLOWED',
              message: 'Use POST for AI proxy operations.',
            },
            405,
            cors,
          ),
        );
      }

      // Session-token gate runs *before* rate-limit so verified callers
      // get bucket keys derived from their wallet subject (durable, not
      // IP-roundrobinable). Unverified callers fall back to the IP key
      // and a stricter rate.
      const tokenGate = await timeAiProxyStage(timing, 'session', () =>
        verifySessionToken(request, env),
      );
      if (!tokenGate.ok) {
        return finalize(
          jsonResponse(
            {
              kind: 'error',
              code: 'SESSION_TOKEN_INVALID',
              message: 'Yuga session token is invalid or expired.',
            },
            401,
            cors,
          ),
        );
      }

      await timeAiProxyStage(timing, 'rate_limit', () =>
        assertAiProxyRateLimit(request, env, { walletSubject: tokenGate.walletSubject }),
      );

      if (url.pathname === '/api/ai/chat') {
        return finalize(
          await handleCreditMeteredChat(
            request,
            env,
            cors,
            {
              walletSubject: tokenGate.walletSubject,
              deviceId: tokenGate.deviceId,
            },
            timing,
          ),
        );
      }

      if (url.pathname === '/api/ai/voice/transcribe') {
        return finalize(await handleVoiceTranscribe(request, env, cors));
      }

      if (url.pathname === '/api/ai/voice/speech') {
        return finalize(await handleVoiceSpeech(request, env, cors));
      }

      if (url.pathname === '/api/ai') {
        return finalize(
          await handleKindDispatch(
            request,
            env,
            cors,
            (chatRequest, chatEnv, chatCors) =>
              handleCreditMeteredChat(
                chatRequest,
                chatEnv,
                chatCors,
                {
                  walletSubject: tokenGate.walletSubject,
                  deviceId: tokenGate.deviceId,
                },
                timing,
              ),
            handleVoiceSpeech,
          ),
        );
      }

      return finalize(
        jsonResponse(
          { kind: 'error', code: 'NOT_FOUND', message: 'AI proxy endpoint not found.' },
          404,
          cors,
        ),
      );
    } catch (error) {
      return finalize(jsonResponse(normalizeError(error), errorStatus(error), cors));
    }
  },
};

async function handleCreditMeteredChat(
  request: Request,
  env: AiProxyEnv,
  cors: HeadersInit,
  identity: AiChatCreditIdentity,
  timing: AiProxyTimingContext,
): Promise<Response> {
  const creditResult = await timeAiProxyStage(timing, 'credit_consume', () =>
    consumeAiChatCredit(request, env, identity),
  );
  if (!creditResult.allowed) {
    return aiChatCreditLimitResponse(creditResult.status, cors);
  }

  try {
    return await timeAiProxyStage(timing, 'chat', () =>
      handleChat(request, env, cors, {
        credits: creditResult.status,
        releaseCreditOnStreamError: (error) =>
          releaseCreditAfterStreamError(request, env, identity, creditResult.charged, error),
      }),
    );
  } catch (error) {
    let credits: AiChatCreditStatus = creditResult.status;
    let creditReleased = false;
    if (creditResult.charged) {
      try {
        credits = await timeAiProxyStage(timing, 'credit_release', () =>
          releaseAiChatCredit(request, env, identity, creditReleaseReasonForError(error)),
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

async function releaseCreditAfterStreamError(
  request: Request,
  env: AiProxyEnv,
  identity: AiChatCreditIdentity,
  charged: boolean,
  error: unknown,
): Promise<AiChatCreditStatus> {
  if (!charged) {
    return getAiChatCreditStatus(request, env, identity);
  }
  return releaseAiChatCredit(request, env, identity, creditReleaseReasonForError(error));
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
