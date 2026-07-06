const DEFAULT_SOLANA_RETRY_ATTEMPTS = 9;
const DEFAULT_SOLANA_RPC_READ_PACE_MS = 300;
const DEFAULT_SOLANA_TRANSACTION_PACE_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;

export const DEFAULT_JUPITER_RETRY_ATTEMPTS = 6;

export function readPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitterDelay(ms) {
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.min(Math.ceil(ms * jitter), MAX_RETRY_DELAY_MS);
}

function parseRetryAfterMs(value) {
  if (!value) return null;

  const numeric = Number.parseFloat(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.min(Math.ceil(numeric * 1000), MAX_RETRY_DELAY_MS);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(0, dateMs - Date.now()), MAX_RETRY_DELAY_MS);
  }

  return null;
}

export function readRateLimitDelayMs(headers) {
  const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'));
  if (retryAfterMs != null) return retryAfterMs;

  const resetHeader = headers.get('x-ratelimit-reset');
  const resetSeconds = resetHeader == null ? NaN : Number(resetHeader);
  if (!Number.isFinite(resetSeconds)) return null;
  return Math.min(Math.max(0, resetSeconds * 1000 - Date.now()), MAX_RETRY_DELAY_MS);
}

function isRateLimitError(error) {
  return /\b429\b|too many requests|rate limit/i.test(errorMessage(error));
}

function isRetryableUpstreamError(error) {
  return (
    isRateLimitError(error) ||
    /\b5\d\d\b|timed out|timeout|ECONNRESET|ETIMEDOUT/i.test(errorMessage(error))
  );
}

export async function withRetry(label, operation, options = {}) {
  const attempts =
    options.attempts ??
    readPositiveIntegerEnv(
      'OFFPAY_RWA_DEVNET_RPC_RETRY_ATTEMPTS',
      readPositiveIntegerEnv('OFFPAY_RWA_SOLANA_RETRY_ATTEMPTS', DEFAULT_SOLANA_RETRY_ATTEMPTS),
    );
  const baseDelayMs = options.baseDelayMs ?? 1_000;

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableUpstreamError(error)) throw error;

      const retryAfterMs =
        typeof error?.retryAfterMs === 'number'
          ? Math.min(Math.max(0, error.retryAfterMs), MAX_RETRY_DELAY_MS)
          : parseRetryAfterMs(error?.retryAfter);
      const delayMs =
        retryAfterMs ?? jitterDelay(Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS));
      console.warn(
        `${label}: ${errorMessage(error)}. Retrying in ${delayMs}ms (${attempt}/${attempts})...`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function createPacer(envName, fallbackMs) {
  let lastCallAt = 0;
  return async function pace() {
    const paceMs = readPositiveIntegerEnv(envName, fallbackMs);
    const waitMs = lastCallAt + paceMs - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
  };
}

export const paceSolanaRpcRead = createPacer(
  'OFFPAY_RWA_DEVNET_RPC_READ_PACE_MS',
  DEFAULT_SOLANA_RPC_READ_PACE_MS,
);

export const paceSolanaTransaction = createPacer(
  'OFFPAY_RWA_DEVNET_RPC_PACE_MS',
  DEFAULT_SOLANA_TRANSACTION_PACE_MS,
);
