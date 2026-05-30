import { parsePayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';
import { inferPayrollColumns } from '@/lib/payroll/parsing/payroll-column-mapping';
import { resolvePayrollFormat } from '@/lib/payroll/parsing/payroll-formats';
import { validatePayrollRows } from '@/lib/payroll/payroll-validation';

import type { PayrollColumnMapping } from '@/lib/payroll/parsing/payroll-column-mapping';
import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';
import type {
  PayrollRoutePolicy,
  PayrollRow,
  PayrollRun,
} from '@/lib/payroll/payroll-types';
import type { OffpayNetwork } from '@/types/offpay-api';

export interface StagePayrollInput {
  fileName: string;
  mimeType?: string | null;
  /** Raw file/paste text. */
  text: string;
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  token: PayrollTokenContext;
  routePolicy: PayrollRoutePolicy;
  /** Optional caller-supplied mapping (manual mapping UI). */
  mappingOverride?: PayrollColumnMapping;
  signal?: AbortSignal;
}

export type StagePayrollResult =
  | {
      ok: true;
      run: PayrollRun;
      rows: PayrollRow[];
      needsManualMapping: boolean;
      mapping: PayrollColumnMapping;
      summary: {
        validCount: number;
        invalidCount: number;
        duplicateCount: number;
        totalAtomic: string;
        exceedsBalance: boolean;
      };
    }
  | {
      ok: false;
      /** When true, the file parsed but recipient/amount columns could not be
       * detected. The caller should open manual mapping with `headers` and a
       * small `sampleRows` preview, then re-stage with a `mappingOverride`. */
      needsManualMapping: true;
      message: string;
      headers: string[];
      sampleRows: Record<string, string>[];
      suggestedMapping: PayrollColumnMapping;
    }
  | { ok: false; needsManualMapping?: false; message: string };

function createRunId(): string {
  return `payroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Full staging pipeline: format check -> parse (chunked, lazy papaparse) ->
 * column inference -> chunked validation -> draft run + rows. Pure with
 * respect to storage — the caller persists via `usePayrollStore.createRun`.
 *
 * Heavy steps yield to the UI internally so a 5,000-row file never freezes.
 */
export async function stagePayroll(input: StagePayrollInput): Promise<StagePayrollResult> {
  const format = resolvePayrollFormat(input.fileName, input.mimeType);
  if (!format.ok || format.format == null) {
    return { ok: false, message: format.message ?? 'Unsupported file type.' };
  }

  const parsed = await parsePayrollTable({
    text: input.text,
    format: format.format,
    signal: input.signal,
  });
  if (!parsed.ok || parsed.table == null) {
    return { ok: false, message: parsed.message ?? 'Unable to parse this file.' };
  }

  const inference = inferPayrollColumns(parsed.table);
  const mapping = input.mappingOverride ?? inference.mapping;

  // Without a recipient + amount column we cannot build rows; surface manual
  // mapping (with headers + a small preview) rather than producing an
  // all-invalid run or a dead-end error.
  if (mapping.recipient == null || mapping.amount == null) {
    return {
      ok: false,
      needsManualMapping: true,
      message: 'Could not detect recipient and amount columns. Map them manually and retry.',
      headers: parsed.table.headers,
      sampleRows: parsed.table.records.slice(0, 3),
      suggestedMapping: inference.mapping,
    };
  }

  const runId = createRunId();
  const validation = await validatePayrollRows({
    runId,
    table: parsed.table,
    mapping,
    token: input.token,
    senderAddress: input.walletAddress,
    signal: input.signal,
  });

  const now = Date.now();
  const run: PayrollRun = {
    id: runId,
    walletAddress: input.walletAddress,
    walletId: input.walletId ?? null,
    network: input.network,
    status: validation.validCount > 0 ? 'ready' : 'draft',
    routePolicy: input.routePolicy,
    tokenMint: input.token.mint,
    tokenSymbol: input.token.symbol,
    tokenDecimals: input.token.decimals,
    sourceName: input.fileName,
    rowIds: validation.rows.map((row) => row.id),
    cursor: 0,
    routesDirty: false,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ok: true,
    run,
    rows: validation.rows,
    needsManualMapping: input.mappingOverride == null && inference.needsManualMapping,
    mapping,
    summary: {
      validCount: validation.validCount,
      invalidCount: validation.invalidCount,
      duplicateCount: validation.duplicateCount,
      totalAtomic: validation.totalAtomic,
      exceedsBalance: validation.exceedsBalance,
    },
  };
}
