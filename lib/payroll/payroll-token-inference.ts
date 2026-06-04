import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { inferPayrollColumns } from '@/lib/payroll/parsing/payroll-column-mapping';
import { resolvePayrollFormat } from '@/lib/payroll/parsing/payroll-formats';
import { parsePayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';

import type { PayrollColumnMapping } from '@/lib/payroll/parsing/payroll-column-mapping';

export interface InferPayrollTokenIdentifierParams {
  fileName: string;
  mimeType?: string | null;
  text: string;
  mappingOverride?: PayrollColumnMapping;
  signal?: AbortSignal;
}

function normalizeTokenCell(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (isValidSolanaAddress(trimmed)) return trimmed;
  if (/^(d?usdc|d?usdt)$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

export async function inferPayrollTokenIdentifier(
  params: InferPayrollTokenIdentifierParams,
): Promise<string | null> {
  const format = resolvePayrollFormat(params.fileName, params.mimeType);
  if (!format.ok || format.format == null) return null;

  const parsed = await parsePayrollTable({
    text: params.text,
    format: format.format,
    signal: params.signal,
  });
  if (!parsed.ok || parsed.table == null) return null;

  const mapping = params.mappingOverride ?? inferPayrollColumns(parsed.table).mapping;
  if (mapping.token == null) return null;

  const values = new Set<string>();
  for (const record of parsed.table.records) {
    const normalized = normalizeTokenCell(record[mapping.token] ?? '');
    if (normalized != null) values.add(normalized);
    if (values.size > 1) return null;
  }

  return values.size === 1 ? [...values][0] : null;
}
