import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import { PAYROLL_ROW_SOFT_WARNING } from '@/lib/payroll/parsing/payroll-formats';

import type { PayrollRouteSplit } from '@/lib/payroll/payroll-route-assignment';
import type { OffpayNetwork } from '@/types/offpay-api';
import type { PayrollRoutePolicy, PayrollRow } from '@/lib/payroll/payroll-types';

/** Threshold above which a typed confirmation is required. */
export const PAYROLL_TYPED_CONFIRMATION_THRESHOLD = 25;

export interface PayrollTokenTotal {
  tokenSymbol: string;
  tokenMint: string;
  tokenDecimals: number;
  recipientCount: number;
  totalAtomic: string;
  totalDisplay: string;
}

export interface PayrollStartGate {
  /** Whether the start control may be enabled. */
  canStart: boolean;
  /** Whether the blocked-rows acknowledgment must be shown/checked. */
  needsBlockedAck: boolean;
}

/**
 * Pure gating for the confirmation card's "Start batch send" control. Keeps the
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
    summary.hasSufficientBalanceForRun &&
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
  totalLabel: string;
  tokenBreakdown: PayrollTokenTotal[];
  isMixedTokenRun: boolean;
  routePolicy: PayrollRoutePolicy;
  split: PayrollRouteSplit;
  invalidCount: number;
  skippedCount: number;
  claimRequiredCount: number;
  /** True when a one-time mainnet Umbra setup step is needed first. */
  requiresUmbraSetup: boolean;
  /** Confirmation-level balance check; never turns parsed rows invalid. */
  hasSufficientBalanceForRun: boolean;
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
  hasSufficientBalanceForRun?: boolean;
  unprobedRecipientCount?: number;
}

export function buildPayrollConfirmationSummary(
  params: BuildConfirmationParams,
): PayrollConfirmationSummary {
  let recipientCount = 0;
  let invalidCount = 0;
  let skippedCount = 0;
  const totalsByMint = new Map<
    string,
    {
      tokenSymbol: string;
      tokenMint: string;
      tokenDecimals: number;
      recipientCount: number;
      totalAtomic: bigint;
    }
  >();

  for (const row of params.rows) {
    if (row.status === 'ready') {
      recipientCount += 1;
      if (/^\d+$/.test(row.amountAtomic)) {
        const existing = totalsByMint.get(row.tokenMint);
        if (existing == null) {
          totalsByMint.set(row.tokenMint, {
            tokenSymbol: row.tokenSymbol,
            tokenMint: row.tokenMint,
            tokenDecimals: row.tokenDecimals,
            recipientCount: 1,
            totalAtomic: BigInt(row.amountAtomic),
          });
        } else {
          existing.recipientCount += 1;
          existing.totalAtomic += BigInt(row.amountAtomic);
        }
      }
    } else if (row.status === 'invalid') {
      invalidCount += 1;
    } else if (row.status === 'skipped') {
      skippedCount += 1;
    }
  }

  const tokenBreakdown = [...totalsByMint.values()].map((entry) => ({
    tokenSymbol: entry.tokenSymbol,
    tokenMint: entry.tokenMint,
    tokenDecimals: entry.tokenDecimals,
    recipientCount: entry.recipientCount,
    totalAtomic: entry.totalAtomic.toString(),
    totalDisplay: formatAtomicAmount(entry.totalAtomic.toString(), entry.tokenDecimals),
  }));
  const firstTotal = tokenBreakdown[0];
  const isMixedTokenRun = tokenBreakdown.length > 1;
  const displaySymbol = firstTotal?.tokenSymbol ?? params.tokenSymbol;
  const totalAtomic = isMixedTokenRun ? '0' : (firstTotal?.totalAtomic ?? '0');
  const totalDisplay = isMixedTokenRun
    ? tokenBreakdown.map((entry) => `${entry.totalDisplay} ${entry.tokenSymbol}`).join(' + ')
    : (firstTotal?.totalDisplay ?? '0');
  const totalLabel = isMixedTokenRun ? totalDisplay : `${totalDisplay} ${displaySymbol}`;

  return {
    walletAddress: params.walletAddress,
    network: params.network,
    tokenSymbol: isMixedTokenRun ? 'mixed' : (firstTotal?.tokenSymbol ?? params.tokenSymbol),
    tokenMint: isMixedTokenRun ? 'mixed' : (firstTotal?.tokenMint ?? params.tokenMint),
    recipientCount,
    totalAtomic,
    totalDisplay,
    totalLabel,
    tokenBreakdown,
    isMixedTokenRun,
    routePolicy: params.routePolicy,
    split: params.split,
    invalidCount,
    skippedCount,
    claimRequiredCount: params.split.claimRequired,
    requiresUmbraSetup: params.requiresUmbraSetup,
    hasSufficientBalanceForRun: params.hasSufficientBalanceForRun ?? true,
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
  return (
    normalized === summary.totalDisplay.replace(/[\s,]/g, '') ||
    normalized === summary.totalLabel.replace(/[\s,]/g, '')
  );
}
