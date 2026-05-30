import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';
import { yieldToUiIfNeeded } from '@/lib/perf/ui-work-scheduler';
import { createAbortError } from '@/lib/perf/abort';
import { PAYROLL_MAX_ROWS } from '@/lib/payroll/parsing/payroll-formats';

import type { PayrollColumnMapping } from '@/lib/payroll/parsing/payroll-column-mapping';
import type { PayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';
import type { PayrollRow } from '@/lib/payroll/payroll-types';

export interface PayrollTokenContext {
  mint: string;
  symbol: string;
  decimals: number;
  /** Atomic balance available for the whole run, for an early total check. */
  balanceAtomic: string | null;
}

export interface ValidatePayrollParams {
  runId: string;
  table: PayrollTable;
  mapping: PayrollColumnMapping;
  token: PayrollTokenContext;
  /** Active wallet address — used to flag self-payment rows. */
  senderAddress: string;
  signal?: AbortSignal;
}

export interface PayrollValidationResult {
  rows: PayrollRow[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  /** Atomic sum of all valid rows. */
  totalAtomic: string;
  /** True when valid total exceeds the supplied balance. */
  exceedsBalance: boolean;
}

const VALIDATION_BATCH = 100;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw createAbortError('Payroll validation was cancelled.');
  }
}

function idempotencyKey(runId: string, recipient: string, amountAtomic: string, mint: string): string {
  return `${runId}:${recipient}:${mint}:${amountAtomic}`;
}

/**
 * Whether a row's token cell agrees with the run's selected token. A row may
 * name the token by symbol (USDC), an alias the symbol normalizes to, or the
 * exact mint. An empty cell is treated as "use the run token" (allowed). A
 * non-empty cell that names a different token is rejected to prevent paying
 * a `USDT` row out of a `USDC` run.
 */
function tokenCellMatchesRun(cell: string, token: PayrollTokenContext): boolean {
  const normalized = cell.trim();
  if (normalized.length === 0) return true;
  if (normalized === token.mint) return true;
  return normalized.toUpperCase() === token.symbol.toUpperCase();
}

/**
 * Counts the fraction digits in a normalized-but-untruncated amount string.
 * Used to reject over-precise payroll amounts instead of silently slicing
 * them (e.g. `1.1234567` against a 6-decimal token).
 */
function fractionDigitCount(amount: string): number {
  const dot = amount.indexOf('.');
  if (dot < 0) return 0;
  return amount.slice(dot + 1).replace(/[^\d]/g, '').length;
}

function buildRow(params: {
  runId: string;
  sourceRow: number;
  label: string | null;
  recipient: string;
  amountAtomic: string;
  amountDisplay: string;
  token: PayrollTokenContext;
  status: PayrollRow['status'];
  validationError: string | null;
  now: number;
}): PayrollRow {
  return {
    id: `${params.runId}-row-${params.sourceRow}`,
    sourceRow: params.sourceRow,
    label: params.label,
    recipient: params.recipient,
    tokenMint: params.token.mint,
    tokenSymbol: params.token.symbol,
    tokenDecimals: params.token.decimals,
    amountAtomic: params.amountAtomic,
    amountDisplay: params.amountDisplay,
    route: null,
    status: params.status,
    requiresRecipientClaim: false,
    validationError: params.validationError,
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: idempotencyKey(
      params.runId,
      params.recipient,
      params.amountAtomic,
      params.token.mint,
    ),
    retryCount: 0,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

/**
 * Validates and normalizes mapped table records into payroll rows.
 *
 * Runs in batches of 100 with `yieldToUiIfNeeded` so a 5,000-row file never
 * blocks the JS thread. Enforces single-token (the run's mint), positive
 * amounts within decimals, valid recipients, and duplicate detection
 * (same recipient appears more than once -> later rows flagged).
 */
export async function validatePayrollRows(
  params: ValidatePayrollParams,
): Promise<PayrollValidationResult> {
  const { table, mapping, token, runId } = params;
  const now = Date.now();
  const rows: PayrollRow[] = [];
  const seenRecipients = new Set<string>();
  let duplicateCount = 0;
  let validCount = 0;
  let invalidCount = 0;
  let totalAtomic = 0n;

  const limit = Math.min(table.records.length, PAYROLL_MAX_ROWS);
  let budgetStartedAt = Date.now();

  for (let index = 0; index < limit; index += 1) {
    throwIfAborted(params.signal);
    const record = table.records[index];
    const sourceRow = index + 2; // +1 for 1-based, +1 for header line
    const recipientRaw = mapping.recipient != null ? (record[mapping.recipient] ?? '') : '';
    const amountRaw = mapping.amount != null ? (record[mapping.amount] ?? '') : '';
    const tokenRaw = mapping.token != null ? (record[mapping.token] ?? '') : '';
    const label =
      mapping.label != null && record[mapping.label]?.trim().length > 0
        ? record[mapping.label].trim()
        : null;

    const recipient = recipientRaw.trim();
    const invalid = (message: string): void => {
      rows.push(
        buildRow({
          runId,
          sourceRow,
          label,
          recipient,
          amountAtomic: '0',
          amountDisplay: amountRaw.trim(),
          token,
          status: 'invalid',
          validationError: message,
          now,
        }),
      );
      invalidCount += 1;
    };

    if (!isValidSolanaAddress(recipient)) {
      invalid('Recipient is not a valid Solana wallet address.');
    } else if (recipient === params.senderAddress) {
      invalid('Self-payment is not allowed in payroll.');
    } else if (!tokenCellMatchesRun(tokenRaw, token)) {
      invalid(
        `Row token "${tokenRaw.trim()}" does not match the payroll token ${token.symbol}.`,
      );
    } else if (amountRaw.trim().length === 0) {
      invalid('Missing amount.');
    } else if (fractionDigitCount(sanitizeDecimalInput(amountRaw, token.decimals + 2)) > token.decimals) {
      // Reject over-precise amounts instead of silently truncating. We
      // sanitize with extra fraction headroom first so a value like
      // `1.1234567` is preserved long enough to be detected as too precise
      // for a 6-decimal token.
      invalid(`Amount has more than ${token.decimals} decimal places for ${token.symbol}.`);
    } else {
      const display = sanitizeDecimalInput(amountRaw, token.decimals);
      const atomic = decimalInputToAtomicAmount(display, token.decimals);
      if (atomic == null || !/^\d+$/.test(atomic) || BigInt(atomic) <= 0n) {
        invalid('Amount must be greater than zero.');
      } else if (seenRecipients.has(recipient)) {
        duplicateCount += 1;
        rows.push(
          buildRow({
            runId,
            sourceRow,
            label,
            recipient,
            amountAtomic: atomic,
            amountDisplay: display,
            token,
            status: 'invalid',
            validationError: 'Duplicate recipient — remove or merge this row.',
            now,
          }),
        );
        invalidCount += 1;
      } else {
        seenRecipients.add(recipient);
        totalAtomic += BigInt(atomic);
        validCount += 1;
        rows.push(
          buildRow({
            runId,
            sourceRow,
            label,
            recipient,
            amountAtomic: atomic,
            amountDisplay: display,
            token,
            status: 'ready',
            validationError: null,
            now,
          }),
        );
      }
    }

    if ((index + 1) % VALIDATION_BATCH === 0) {
      budgetStartedAt = await yieldToUiIfNeeded(budgetStartedAt);
    }
  }

  const exceedsBalance =
    token.balanceAtomic != null && /^\d+$/.test(token.balanceAtomic)
      ? totalAtomic > BigInt(token.balanceAtomic)
      : false;

  return {
    rows,
    validCount,
    invalidCount,
    duplicateCount,
    totalAtomic: totalAtomic.toString(),
    exceedsBalance,
  };
}
