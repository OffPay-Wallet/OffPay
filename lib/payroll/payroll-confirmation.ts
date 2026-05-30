import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import { PAYROLL_ROW_SOFT_WARNING } from '@/lib/payroll/parsing/payroll-formats';

import type { PayrollRouteSplit } from '@/lib/payroll/payroll-route-assignment';
import type { OffpayNetwork } from '@/types/offpay-api';
import type { PayrollRoutePolicy, PayrollRow } from '@/lib/payroll/payroll-types';

/** Threshold above which a typed confirmation is required. */
export const PAYROLL_TYPED_CONFIRMATION_THRESHOLD = 25;

export interface PayrollStartGate {
  /** Whether the start control may be enabled. */
  canStart: boolean;
  /** Whether the blocked-rows acknowledgment must be shown/checked. */
  needsBlockedAck: boolean;
}

/**
 * Pure gating for the confirmation card's "Start payroll" control. Keeps the
 * money-flow rule — never silently pay a subset when rows are blocked — in
 * one testable place. A run with blocked/invalid rows requires explicit
 * acknowledgment; a run needing Umbra setup or a typed confirmation cannot
 * start until those are satisfied.
 */
export function resolvePayrollStartGate(params: {
  summary: PayrollConfirmationSummary;
  typedConfirmationOk: boolean;
  blockedAcknowledged: boolean;
  busy: boolean;
}): PayrollStartGate {
  const { summary } = params;
  const needsBlockedAck = summary.invalidCount > 0;
  const blockedAck = !needsBlockedAck || params.blockedAcknowledged;
  const typedOk = !summary.requiresTypedConfirmation || params.typedConfirmationOk;
  const canStart =
    summary.recipientCount > 0 &&
    typedOk &&
    blockedAck &&
    !summary.requiresUmbraSetup &&
    !params.busy;
  return { canStart, needsBlockedAck };
}

export interface PayrollConfirmationSummary {
  walletAddress: string;
  network: OffpayNetwork;
  tokenSymbol: string;
  tokenMint: string;
  recipientCount: number;
  totalAtomic: string;
  totalDisplay: string;
  routePolicy: PayrollRoutePolicy;
  split: PayrollRouteSplit;
  invalidCount: number;
  skippedCount: number;
  claimRequiredCount: number;
  /** True when a one-time mainnet Umbra setup step is needed first. */
  requiresUmbraSetup: boolean;
  requiresTypedConfirmation: boolean;
  /** Soft warning shown above 1,000 rows. */
  showLargeBatchWarning: boolean;
  /**
   * Recipients beyond the Umbra registration probe cap that were not checked
   * for Umbra-readiness. They route via MagicBlock (shared-mint networks) or
   * are blocked (devnet). Surfaced so the user knows some recipients were not
   * evaluated for the Umbra route.
   */
  unprobedRecipientCount: number;
}

export interface BuildConfirmationParams {
  walletAddress: string;
  network: OffpayNetwork;
  tokenSymbol: string;
  tokenMint: string;
  tokenDecimals: number;
  rows: PayrollRow[];
  routePolicy: PayrollRoutePolicy;
  split: PayrollRouteSplit;
  requiresUmbraSetup: boolean;
  unprobedRecipientCount?: number;
}

export function buildPayrollConfirmationSummary(
  params: BuildConfirmationParams,
): PayrollConfirmationSummary {
  let totalAtomic = 0n;
  let recipientCount = 0;
  let invalidCount = 0;
  let skippedCount = 0;

  for (const row of params.rows) {
    if (row.status === 'ready') {
      recipientCount += 1;
      if (/^\d+$/.test(row.amountAtomic)) totalAtomic += BigInt(row.amountAtomic);
    } else if (row.status === 'invalid') {
      invalidCount += 1;
    } else if (row.status === 'skipped') {
      skippedCount += 1;
    }
  }

  return {
    walletAddress: params.walletAddress,
    network: params.network,
    tokenSymbol: params.tokenSymbol,
    tokenMint: params.tokenMint,
    recipientCount,
    totalAtomic: totalAtomic.toString(),
    totalDisplay: formatAtomicAmount(totalAtomic.toString(), params.tokenDecimals),
    routePolicy: params.routePolicy,
    split: params.split,
    invalidCount,
    skippedCount,
    claimRequiredCount: params.split.claimRequired,
    requiresUmbraSetup: params.requiresUmbraSetup,
    requiresTypedConfirmation: recipientCount >= PAYROLL_TYPED_CONFIRMATION_THRESHOLD,
    showLargeBatchWarning: recipientCount > PAYROLL_ROW_SOFT_WARNING,
    unprobedRecipientCount: params.unprobedRecipientCount ?? 0,
  };
}

/**
 * Verifies a typed confirmation. Accepts either the exact recipient count or
 * the displayed total (whitespace/commas ignored). Voice transcripts can be
 * passed here too, but UI gates large batches behind manual typing.
 */
export function isTypedConfirmationValid(
  summary: PayrollConfirmationSummary,
  typed: string,
): boolean {
  const normalized = typed.trim().replace(/[\s,]/g, '');
  if (normalized.length === 0) return false;
  if (normalized === String(summary.recipientCount)) return true;
  return normalized === summary.totalDisplay.replace(/[\s,]/g, '');
}
