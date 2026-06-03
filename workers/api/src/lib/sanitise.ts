const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const MAX_STRING_LENGTH = 256;
const MAX_ARRAY_ITEMS = 25;
const MAX_DEPTH = 5;

const SENSITIVE_KEY_PATTERN =
  /(secret|token|api[-_]?key|authorization|signature|ciphertext|rawtransaction|attestation|devicecheck|integrity|seed|private[-_]?key|viewing[-_]?key|hmac|body)/i;

function sanitizeString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}...`;
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }

  if (value instanceof Headers) {
    return sanitizeHeaders(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1));
  }

  if (typeof value === 'object') {
    const sanitizedEntries: Array<[string, unknown]> = [];

    for (const [key, nestedValue] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitizedEntries.push([key, REDACTED_VALUE]);
        continue;
      }

      sanitizedEntries.push([key, sanitizeForLog(nestedValue, depth + 1)]);
    }

    return Object.fromEntries(sanitizedEntries);
  }

  return TRUNCATED_VALUE;
}

function sanitizeHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const normalizedHeaders =
    headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;

  const sanitizedEntries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(normalizedHeaders)) {
    sanitizedEntries.push([
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : sanitizeString(value),
    ]);
  }

  return Object.fromEntries(sanitizedEntries);
}

function deepStripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepStripUndefined(entry)) as T;
  }

  if (value && typeof value === 'object') {
    const strippedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, deepStripUndefined(nestedValue)]);

    return Object.fromEntries(strippedEntries) as T;
  }

  return value;
}

function pickPublicFields<
  T extends Record<string, unknown>,
  K extends readonly (keyof T)[],
>(input: T, fields: K): Pick<T, K[number]> {
  const pickedEntries: Array<[K[number], T[K[number]]]> = [];

  for (const field of fields) {
    pickedEntries.push([field, input[field]]);
  }

  return Object.fromEntries(pickedEntries) as Pick<T, K[number]>;
}

export {
  REDACTED_VALUE,
  deepStripUndefined,
  pickPublicFields,
  sanitizeForLog,
  sanitizeHeaders,
};
