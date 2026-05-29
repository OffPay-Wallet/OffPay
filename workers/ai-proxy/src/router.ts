import { handleChat, handleKindDispatch } from './handlers/chat';
import { handleHealth } from './handlers/health';
import { handleVoiceSpeech, handleVoiceTranscribe } from './handlers/voice';
import {
  corsHeaders,
  errorStatus,
  isOriginAllowed,
  jsonResponse,
  normalizeError,
} from './http';
import { assertAiProxyRateLimit } from './rate-limit';
import { verifyOffpayAiSessionToken } from './auth/session-token';
import type { AiProxyEnv } from './types';

interface SessionTokenGateResult {
  ok: boolean;
  walletSubject?: string;
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

      if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/ai/health')) {
        return handleHealth(env, cors);
      }

      if (request.method !== 'POST') {
        return jsonResponse(
          { kind: 'error', code: 'METHOD_NOT_ALLOWED', message: 'Use POST for AI proxy operations.' },
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
          { kind: 'error', code: 'SESSION_TOKEN_INVALID', message: 'Yuga session token is invalid or expired.' },
          401,
          cors,
        );
      }

      assertAiProxyRateLimit(request, env, { walletSubject: tokenGate.walletSubject });

      if (url.pathname === '/api/ai/chat') {
        return await handleChat(request, env, cors);
      }

      if (url.pathname === '/api/ai/voice/transcribe') {
        return await handleVoiceTranscribe(request, env, cors);
      }

      if (url.pathname === '/api/ai/voice/speech') {
        return await handleVoiceSpeech(request, env, cors);
      }

      if (url.pathname === '/api/ai') {
        return await handleKindDispatch(request, env, cors, handleChat, handleVoiceSpeech);
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
  return { ok: true, walletSubject: result.walletAddress };
}
