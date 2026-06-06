type ErrorCode =
  | 'ATTESTATION_FAILED'
  | 'FORBIDDEN_ORIGIN'
  | 'HMAC_INVALID'
  | 'INTERNAL_ERROR'
  | 'INVITE_ALREADY_USED'
  | 'INVITE_EXPIRED'
  | 'INVITE_REQUIRED'
  | 'INVITE_REVOKED'
  | 'INVALID_NETWORK'
  | 'INVALID_INVITE_CODE'
  | 'INVALID_NONCE'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'OUTDATED_APP'
  | 'QUOTE_EXPIRED'
  | 'RATE_LIMITED'
  | 'SESSION_EXPIRED'
  | 'SECRET_ROTATED'
  | 'SIGNATURE_INVALID'
  | 'TRIGGER_AUTH_REQUIRED'
  | 'UPSTREAM_UNAVAILABLE';

interface ErrorDetail {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs: number;
}

interface ErrorEnvelope {
  error: ErrorDetail;
}

interface AppErrorOptions {
  status: number;
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
  headers?: HeadersInit;
  cause?: unknown;
}

class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number;
  readonly headers: HeadersInit | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.headers = options.headers;
  }
}

function createErrorEnvelope(
  code: ErrorCode,
  message: string,
  retryable = false,
  retryAfterMs = 0,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      retryable,
      retryAfterMs,
    },
  };
}

function appendHeaders(target: Headers, headers?: HeadersInit): void {
  if (!headers) {
    return;
  }

  new Headers(headers).forEach((value, key) => {
    target.set(key, value);
  });
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  options: Omit<AppErrorOptions, 'status' | 'code' | 'message'> = {},
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Error-Code': code,
  });

  appendHeaders(headers, options.headers);

  const retryAfterMs = options.retryAfterMs ?? 0;
  if (retryAfterMs > 0) {
    headers.set('Retry-After', Math.max(1, Math.ceil(retryAfterMs / 1000)).toString());
  }

  return new Response(
    JSON.stringify(
      createErrorEnvelope(code, message, options.retryable ?? false, retryAfterMs),
    ),
    {
      status,
      headers,
    },
  );
}

function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  return new AppError({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    retryable: false,
    retryAfterMs: 0,
    cause: error,
  });
}

function errorResponseFromAppError(error: AppError): Response {
  const responseOptions: Omit<AppErrorOptions, 'status' | 'code' | 'message'> = {
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
  };

  if (error.headers) {
    responseOptions.headers = error.headers;
  }

  return errorResponse(error.status, error.code, error.message, responseOptions);
}

export {
  AppError,
  createErrorEnvelope,
  errorResponse,
  errorResponseFromAppError,
  isAppError,
  toAppError,
  type ErrorCode,
  type ErrorDetail,
  type ErrorEnvelope,
};
