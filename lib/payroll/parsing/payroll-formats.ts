/**
 * Lightweight V1 payroll formats. Anything outside this set is rejected
 * with export-to-CSV guidance rather than parsed unreliably on-device.
 */
export type PayrollFileFormat = 'csv' | 'tsv' | 'txt' | 'json';

export const PAYROLL_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const PAYROLL_MAX_ROWS = 5000;
export const PAYROLL_ROW_SOFT_WARNING = 1000;

const EXTENSION_FORMATS: Record<string, PayrollFileFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  txt: 'txt',
  json: 'json',
};

const REJECTED_EXTENSIONS = new Set(['xlsx', 'xls', 'pdf', 'docx', 'doc', 'numbers', 'png', 'jpg', 'jpeg', 'heic']);

export const PAYROLL_EXPORT_GUIDANCE =
  'This file type is not supported. Export it as CSV or TSV and upload again.';

export interface PayrollFormatResolution {
  ok: boolean;
  format?: PayrollFileFormat;
  message?: string;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Resolves a supported format from a file name (and optional MIME type).
 * Returns a rejection with guidance for unsupported types.
 */
export function resolvePayrollFormat(
  fileName: string,
  mimeType?: string | null,
): PayrollFormatResolution {
  const extension = extensionOf(fileName);

  if (REJECTED_EXTENSIONS.has(extension)) {
    return { ok: false, message: PAYROLL_EXPORT_GUIDANCE };
  }

  const byExtension = EXTENSION_FORMATS[extension];
  if (byExtension != null) return { ok: true, format: byExtension };

  // Fall back to MIME hints for extension-less picks (some providers strip
  // the extension on copy).
  const mime = mimeType?.toLowerCase() ?? '';
  if (mime.includes('json')) return { ok: true, format: 'json' };
  if (mime.includes('tab-separated')) return { ok: true, format: 'tsv' };
  if (mime.includes('csv')) return { ok: true, format: 'csv' };
  if (mime.includes('text/plain')) return { ok: true, format: 'txt' };

  return { ok: false, message: PAYROLL_EXPORT_GUIDANCE };
}

/**
 * Detects the most likely delimiter for a `.txt` / ambiguous table by
 * comparing candidate counts on the first non-empty line. Comma, tab,
 * semicolon, and pipe are supported.
 */
export function detectDelimiter(sample: string): string {
  const firstLine =
    sample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';

  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/** Strips a UTF-8 BOM if present. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Heuristic guard against binary content masquerading as text (e.g. a
 * renamed `.xlsx`). Returns true when the sample contains NUL bytes or a
 * high ratio of non-printable characters.
 */
export function looksBinary(sample: string): boolean {
  if (sample.length === 0) return false;
  const head = sample.slice(0, 1024);
  if (head.includes('\u0000')) return true;
  let nonPrintable = 0;
  for (const char of head) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 9 || (code > 13 && code < 32)) nonPrintable += 1;
  }
  return nonPrintable / head.length > 0.1;
}
