import bs58 from 'bs58';
import { z } from 'zod';
import { AppError } from './errors.js';

const NETWORK_VALUES = ['devnet', 'mainnet'] as const;
const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/;
const DEFAULT_MAX_JSON_BODY_BYTES = 768_000;

const networkSchema = z.enum(NETWORK_VALUES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidSolanaAddress(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function isValidEd25519Signature(value: string): boolean {
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}

function parseWithSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  message = 'Invalid request.',
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
      cause: result.error,
    });
  }

  return result.data;
}

function canonicalJsonStringify(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  function normalizeForCanonicalJson(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map((entry) =>
        entry === undefined ? null : normalizeForCanonicalJson(entry),
      );
    }

    if (isPlainObject(input)) {
      const sortedEntries = Object.keys(input)
        .sort((left, right) => left.localeCompare(right))
        .flatMap((key) => {
          const nestedValue = input[key];
          if (nestedValue === undefined) {
            return [];
          }

          return [[key, normalizeForCanonicalJson(nestedValue)] as const];
        });

      return Object.fromEntries(sortedEntries);
    }

    return input;
  }

  return JSON.stringify(normalizeForCanonicalJson(value));
}

async function readJsonBody<T>(
  request: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  missingBodyMessage = 'Request body is required.',
  invalidBodyMessage = 'Malformed JSON body.',
  maxBodyBytes = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<T> {
  const contentLength = request.headers.get('content-length');
  if (contentLength != null && Number(contentLength) > maxBodyBytes) {
    throw new AppError({
      status: 413,
      code: 'INVALID_REQUEST',
      message: 'Request body is too large.',
    });
  }

  const rawBody = await request.clone().text();
  if (rawBody.trim().length === 0) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: missingBodyMessage,
    });
  }

  if (rawBody.length > maxBodyBytes) {
    throw new AppError({
      status: 413,
      code: 'INVALID_REQUEST',
      message: 'Request body is too large.',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: invalidBodyMessage,
      cause: error,
    });
  }

  return parseWithSchema(schema, parsed, invalidBodyMessage);
}

function readSearchParams<T>(
  requestUrl: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  const url = new URL(requestUrl);
  return parseWithSchema(
    schema,
    Object.fromEntries(url.searchParams.entries()),
    'Invalid query parameters.',
  );
}

function parseNetwork(value: string | null | undefined) {
  return parseWithSchema(networkSchema, value, 'Invalid network.');
}

function ensureSupportedVersionFormat(value: string, message = 'Invalid app version format.'): string {
  if (!VERSION_PATTERN.test(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }

  return value;
}

export {
  DEFAULT_MAX_JSON_BODY_BYTES,
  NETWORK_VALUES,
  VERSION_PATTERN,
  canonicalJsonStringify,
  ensureSupportedVersionFormat,
  isRecord,
  isValidEd25519Signature,
  isValidSolanaAddress,
  networkSchema,
  parseNetwork,
  parseWithSchema,
  readJsonBody,
  readSearchParams,
};
