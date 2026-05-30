import {
  detectDelimiter,
  looksBinary,
  stripBom,
  type PayrollFileFormat,
} from '@/lib/payroll/parsing/payroll-formats';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';

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
    throw new DOMException('Payroll parsing was cancelled.', 'AbortError');
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
    : parsed != null && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
      ? ((parsed as { rows: unknown[] }).rows)
      : null;

  if (rows == null) {
    throw new Error('JSON payroll must be an array of rows, or an object with a "rows" array.');
  }

  await yieldToUi();
  return tableFromJsonArray(rows);
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
      return { ok: false, message: 'No data rows were found. Check the file has a header and rows.' };
    }
    return { ok: true, table };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : 'Unable to parse this file.';
    return { ok: false, message };
  }
}
