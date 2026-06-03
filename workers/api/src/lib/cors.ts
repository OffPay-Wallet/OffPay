import type { Handler, MiddlewareHandler } from 'hono';
import type { AppEnv } from './types.js';
import { errorResponse } from './errors.js';

const ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'https://offpay.app',
];

const ALLOWED_HEADERS = [
  'Content-Type',
  'X-App-HMAC',
  'X-App-Version',
  'X-Bootstrap-Version',
  'X-Device-Id',
  'X-Network',
  'X-Signature',
  'X-Timestamp',
  'X-Wallet-Address',
];

const ALLOWED_METHODS = ['GET', 'POST', 'DELETE', 'OPTIONS'];
const EXPOSED_HEADERS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
];

function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin);
}

function buildCorsHeaders(origin: string | null | undefined): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
    'Access-Control-Max-Age': '600',
    'Access-Control-Expose-Headers': EXPOSED_HEADERS.join(', '),
    Vary: 'Origin',
  });

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function applyCorsHeaders(headers: Headers, origin: string | null | undefined): void {
  buildCorsHeaders(origin).forEach((value, key) => {
    headers.set(key, value);
  });
}

const corsMiddleware: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();
  applyCorsHeaders(context.res.headers, context.req.header('Origin'));
};

const handlePreflight: Handler<AppEnv> = (context) => {
  const origin = context.req.header('Origin');
  if (!origin || !isAllowedOrigin(origin)) {
    return errorResponse(403, 'FORBIDDEN_ORIGIN', 'Origin not permitted.');
  }

  const response = new Response(null, { status: 204 });
  applyCorsHeaders(response.headers, origin);
  return response;
};

export {
  ALLOWED_HEADERS,
  ALLOWED_METHODS,
  ALLOWED_ORIGINS,
  EXPOSED_HEADERS,
  applyCorsHeaders,
  buildCorsHeaders,
  corsMiddleware,
  handlePreflight,
  isAllowedOrigin,
};
