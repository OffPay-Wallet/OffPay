import {
  detectDelimiter,
  looksBinary,
  stripBom,
  type PayrollFileFormat,
} from '@/lib/payroll/parsing/payroll-formats';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';
import { createAbortError, isAbortError } from '@/lib/perf/abort';

/**
 * A normalized, header-keyed table. Cells are raw strings; downstream
 * validation handles typing/normalization. Header order is preserved.
 */
export interface PayrollTable {
  headers: string[];
  /** Each record maps header -> cell value (missing cells are ''). */
  records: Record<string, string>[];
}

export interface ParsePayrollTableParams {
  text: string;
  format: PayrollFileFormat;
  signal?: AbortSignal;
}

export interface PayrollTableResult {
  ok: boolean;
  table?: PayrollTable;
  message?: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw createAbortError('Payroll parsing was cancelled.');
  }
}

function normalizeHeader(value: string, index: number, seen: Map<string, number>): string {
  const base = value.trim().toLowerCase().replace(/\s+/g, '_');
  const key = base.length > 0 ? base : `column_${index + 1}`;
  // Disambiguate duplicate headers deterministically (e.g. amount, amount_2).
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  return count === 0 ? key : `${key}_${count + 1}`;
}

/**
 * Lazy-loads papaparse only at parse time (first file selection), keeping
 * its evaluation off the launch path. A call-time `require` is the
 * Metro-friendly form of lazy loading and avoids the async-import VM
 * constraints under test runners.
 */
let papaModule: typeof import('papaparse') | null = null;
function loadPapaParse(): typeof import('papaparse') {
  if (papaModule == null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    papaModule = require('papaparse') as typeof import('papaparse');
  }
  return papaModule;
}

async function parseDelimited(
  text: string,
  delimiter: string,
  signal?: AbortSignal,
): Promise<PayrollTable> {
  throwIfAborted(signal);
  const Papa = loadPapaParse();
  await yieldToUi();
  throwIfAborted(signal);

  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: 'greedy',
    // We do our own header normalization for duplicate-header handling.
    header: false,
  });

  const rows = (result.data as unknown as string[][]).filter(
    (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim().length > 0),
  );
  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const seen = new Map<string, number>();
  const headers = (rows[0] ?? []).map((header, index) =>
    normalizeHeader(String(header ?? ''), index, seen),
  );

  const records: Record<string, string>[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    throwIfAborted(signal);
    const row = rows[index] ?? [];
    const record: Record<string, string> = {};
    for (let column = 0; column < headers.length; column += 1) {
      record[headers[column]] = String(row[column] ?? '').trim();
    }
    records.push(record);
  }

  return { headers, records };
}

function tableFromJsonArray(values: unknown[]): PayrollTable {
  const headerSet = new Set<string>();
  const objects: Record<string, unknown>[] = [];
  for (const value of values) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JSON payroll must be an array of row objects.');
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) headerSet.add(key.trim().toLowerCase());
    objects.push(record);
  }

  const headers = Array.from(headerSet);
  const records = objects.map((object) => {
    const normalized: Record<string, string> = {};
    for (const header of headers) normalized[header] = '';
    for (const [key, raw] of Object.entries(object)) {
      const header = key.trim().toLowerCase();
      normalized[header] = raw == null ? '' : String(raw).trim();
    }
    return normalized;
  });

  return { headers, records };
}

async function parseJson(text: string, signal?: AbortSignal): Promise<PayrollTable> {
  throwIfAborted(signal);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This JSON file is not valid. Check for a trailing comma or missing bracket.');
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed != null &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;

  if (rows == null) {
    throw new Error('JSON payroll must be an array of rows, or an object with a "rows" array.');
  }

  await yieldToUi();
  return tableFromJsonArray(rows);
}

function splitManualLine(line: string): string[] {
  const delimiterMatch = /[,;\t|]/.exec(line);
  if (delimiterMatch != null) {
    return line
      .split(delimiterMatch[0])
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  return line
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function looksLikeAmount(value: string): boolean {
  const normalized = sanitizeDecimalInput(value, 18);
  const atomic = decimalInputToAtomicAmount(normalized, 18);
  return atomic != null && /^\d+$/.test(atomic) && BigInt(atomic) > 0n;
}

function parseManualPayrollParts(parts: string[]): Record<string, string> | null {
  if (parts.length < 2) return null;

  const recipientIndex = parts.findIndex(isValidSolanaAddress);
  if (recipientIndex < 0) return null;

  const amountIndexAfterRecipient = parts.findIndex(
    (part, index) => index > recipientIndex && looksLikeAmount(part),
  );
  const amountIndex =
    amountIndexAfterRecipient >= 0
      ? amountIndexAfterRecipient
      : parts.findIndex((part, index) => index !== recipientIndex && looksLikeAmount(part));
  if (amountIndex < 0) return null;

  const tokenIndex = parts.findIndex(
    (part, index) => index > amountIndex && /^[A-Za-z][A-Za-z0-9_-]{1,15}$/.test(part),
  );
  const token = tokenIndex >= 0 ? (parts[tokenIndex] ?? '') : '';
  const label = parts
    .filter(
      (_part, index) => index !== recipientIndex && index !== amountIndex && index !== tokenIndex,
    )
    .join(' ');

  return {
    label,
    recipient: parts[recipientIndex] ?? '',
    amount: parts[amountIndex] ?? '',
    token,
  };
}

function parseManualPayrollLine(line: string): Record<string, string> | null {
  return parseManualPayrollParts(splitManualLine(line));
}

function parseHeaderlessManualGroups(
  lines: string[],
  groupSize: 2 | 3,
): Record<string, string>[] | null {
  if (lines.length === 0 || lines.length % groupSize !== 0) return null;

  const records: Record<string, string>[] = [];
  for (let index = 0; index < lines.length; index += groupSize) {
    const firstLineParts = splitManualLine(lines[index] ?? '');
    if (!firstLineParts.some(isValidSolanaAddress)) return null;

    const parts = [
      ...firstLineParts,
      ...lines.slice(index + 1, index + groupSize).flatMap(splitManualLine),
    ];
    const record = parseManualPayrollParts(parts);
    if (record == null) return null;
    records.push(record);
  }
  return records;
}

function parseHeaderlessManualText(text: string): PayrollTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const records: Record<string, string>[] = [];
  for (const line of lines) {
    const record = parseManualPayrollLine(line);
    if (record == null) {
      if (records.length > 0) return null;
      const groupedRecords =
        parseHeaderlessManualGroups(lines, 2) ?? parseHeaderlessManualGroups(lines, 3);
      if (groupedRecords == null) return null;
      return {
        headers: ['label', 'recipient', 'amount', 'token'],
        records: groupedRecords,
      };
    }
    records.push(record);
  }

  return {
    headers: ['label', 'recipient', 'amount', 'token'],
    records,
  };
}

/**
 * Parses raw file text into a normalized table. Pure with respect to
 * storage; yields to the UI around the heavy parse step so large files do
 * not freeze the screen. Honors an AbortSignal for cancellation.
 */
export async function parsePayrollTable(
  params: ParsePayrollTableParams,
): Promise<PayrollTableResult> {
  const text = stripBom(params.text).trim();
  if (text.length === 0) {
    return { ok: false, message: 'This file is empty.' };
  }
  if (looksBinary(text)) {
    return {
      ok: false,
      message: 'This looks like a binary file. Export it as CSV or TSV and try again.',
    };
  }

  try {
    const manualTable = params.format === 'json' ? null : parseHeaderlessManualText(text);
    if (manualTable != null) {
      return { ok: true, table: manualTable };
    }

    let table: PayrollTable;
    switch (params.format) {
      case 'json':
        table = await parseJson(text, params.signal);
        break;
      case 'csv':
        table = await parseDelimited(text, ',', params.signal);
        break;
      case 'tsv':
        table = await parseDelimited(text, '\t', params.signal);
        break;
      case 'txt':
        table = await parseDelimited(text, detectDelimiter(text), params.signal);
        break;
    }

    if (table.headers.length === 0 || table.records.length === 0) {
      return {
        ok: false,
        message: 'No data rows were found. Check the file has a header and rows.',
      };
    }
    return { ok: true, table };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const message = error instanceof Error ? error.message : 'Unable to parse this file.';
    return { ok: false, message };
  }
}
