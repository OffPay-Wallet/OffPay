import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Private-only batch-send routes. There is intentionally no `normal`/public
 * route: batch send never falls back to a transparent transfer.
 */
export type PayrollRoute = 'umbra' | 'magicblock';

/**
 * Route policy chosen for a run.
 *  - `private_auto`: Umbra first, MagicBlock only when route/mint/network
 *    rules allow it.
 *  - `umbra_only` / `magicblock_only`: explicit user override.
 */
export type PayrollRoutePolicy = 'private_auto' | 'umbra_only' | 'magicblock_only';

/**
 * Lifecycle of a whole batch-send run.
 *  - `completed_with_claims_pending`: every row landed, but one or more
 *    Umbra rows are `deposited_unclaimed` and await recipient claim.
 *  - `completed_with_errors`: run finished but some rows failed.
 */
export type PayrollRunStatus =
  | 'draft'
  | 'validating'
  | 'ready'
  | 'confirming'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_claims_pending'
  | 'completed_with_errors'
  | 'cancelled'
  | 'failed';

/**
 * Per-row lifecycle.
 *  - `submitted`: MagicBlock broadcast succeeded (recipient credited).
 *  - `queued`: MagicBlock signed tx queued for later settlement.
 *  - `deposited_unclaimed`: Umbra deposit landed; recipient must claim
 *    before funds are spendable. This is a terminal *success* for the
 *    sender but NOT equivalent to `submitted`.
 *  - `skipped`: intentionally excluded (e.g. duplicate, user removed).
 */
export type PayrollRowStatus =
  | 'parsed'
  | 'invalid'
  | 'ready'
  | 'sending'
  | 'submitted'
  | 'queued'
  | 'deposited_unclaimed'
  | 'failed'
  | 'skipped';

export interface PayrollRow {
  /** Stable client id, unique within the run. */
  id: string;
  /** 1-based line number from the source file, for error reporting. */
  sourceRow: number;
  /** Optional human label (employee name / id) — never sent to AI. */
  label: string | null;
  recipient: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenDecimals: number;
  /** Atomic (integer string) amount in the token's smallest unit. */
  amountAtomic: string;
  /** Human display amount, normalized. */
  amountDisplay: string;
  route: PayrollRoute | null;
  status: PayrollRowStatus;
  /** True for Umbra rows whose recipient must claim to receive funds. */
  requiresRecipientClaim: boolean;
  validationError: string | null;
  signature: string | null;
  txId: string | null;
  initSignature: string | null;
  /**
   * Stable idempotency key derived from run + recipient + amount + mint.
   * Used to guarantee a row is never paid twice across resume/retry.
   */
  idempotencyKey: string;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PayrollRun {
  id: string;
  walletAddress: string;
  /**
   * Wallet record used to stage/sign this run. Older persisted runs may not
   * have it, so execution falls back to the active wallet only when absent.
   */
  walletId?: string | null;
  network: OffpayNetwork;
  status: PayrollRunStatus;
  routePolicy: PayrollRoutePolicy;
  /** Single mint enforced across the run (no mixed tokens). */
  tokenMint: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  sourceName: string | null;
  rowIds: string[];
  /** Index of the next row to attempt during sequential execution. */
  cursor: number;
  /**
   * True when row-level edits (skip/restore) changed the set of payable rows
   * and route assignment/confirmation summary must be refreshed before start.
   */
  routesDirty?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Terminal row statuses that must never be re-sent. */
export const PAYROLL_SETTLED_ROW_STATUSES: readonly PayrollRowStatus[] = [
  'submitted',
  'queued',
  'deposited_unclaimed',
];

export function isPayrollRowSettled(status: PayrollRowStatus): boolean {
  return PAYROLL_SETTLED_ROW_STATUSES.includes(status);
}

/**
 * A row is safe to (re)send only when it has no on-chain artifact. Any
 * signature / tx id / deposit signature locks the row against resend even
 * if its status looks retryable, defending against double-pay.
 */
export function isPayrollRowSendable(row: Pick<PayrollRow,
  'status' | 'signature' | 'txId' | 'initSignature'>): boolean {
  if (row.signature != null || row.txId != null || row.initSignature != null) return false;
  return row.status === 'ready' || row.status === 'failed';
}
