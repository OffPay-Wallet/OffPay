import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';
import { isKnownStablecoinMint } from '@/lib/policy/stablecoin-policy';
import {
  resolvePayrollRoute,
  type PayrollRecipientFacts,
  type PayrollRouteBlockReason,
  type PayrollRouteFacts,
} from '@/lib/payroll/payroll-route-readiness';

import type { OffpayNetwork } from '@/types/offpay-api';
import type { PayrollRoute, PayrollRoutePolicy, PayrollRow } from '@/lib/payroll/payroll-types';

/**
 * Whether a single mint is valid for BOTH Umbra and MagicBlock on the
 * network. When true, a `private_auto` fallback from Umbra to MagicBlock
 * keeps the same on-chain mint. When false (e.g. devnet Umbra dUSDC vs
 * MagicBlock devnet USDC), a silent fallback would change the mint and is
 * therefore blocked.
 */
export function routesShareMint(network: OffpayNetwork, mint: string): boolean {
  return isKnownStablecoinMint(network, mint) && getUmbraTokenByMint(network, mint) != null;
}

export interface AssignPayrollRoutesParams {
  rows: PayrollRow[];
  policy: PayrollRoutePolicy;
  facts: PayrollRouteFacts;
  mint: string;
  /** Per-recipient facts keyed by recipient address. Missing = not ready. */
  recipientFactsByAddress: Record<string, PayrollRecipientFacts>;
}

export interface PayrollRouteAssignmentRow {
  rowId: string;
  route: PayrollRoute | null;
  blockedReasons: PayrollRouteBlockReason[];
}

export interface PayrollRouteSplit {
  umbra: number;
  magicblock: number;
  blocked: number;
  /** Rows routed via Umbra that will require recipient claim. */
  claimRequired: number;
}

export interface PayrollRouteAssignment {
  rows: PayrollRouteAssignmentRow[];
  split: PayrollRouteSplit;
  mintWouldChangeOnFallback: boolean;
}

const DEFAULT_RECIPIENT_FACTS: PayrollRecipientFacts = {
  isSelf: false,
  umbraRecipientRegistered: false,
};

export const PAYROLL_ROUTE_UNAVAILABLE_MESSAGE = 'No private route is ready for this recipient.';

/**
 * Assigns a route to every sendable row and aggregates a run-level split for
 * the confirmation card. Only rows currently in `ready` are routed; invalid /
 * settled rows are ignored here.
 */
export function assignPayrollRoutes(
  params: AssignPayrollRoutesParams,
): PayrollRouteAssignment {
  const shareMint = routesShareMint(params.facts.network, params.mint);
  const rows: PayrollRouteAssignmentRow[] = [];
  const split: PayrollRouteSplit = { umbra: 0, magicblock: 0, blocked: 0, claimRequired: 0 };

  for (const row of params.rows) {
    if (row.status !== 'ready') continue;

    const recipient =
      params.recipientFactsByAddress[row.recipient] ?? DEFAULT_RECIPIENT_FACTS;
    const decision = resolvePayrollRoute({
      policy: params.policy,
      facts: params.facts,
      recipient,
      routesShareMint: shareMint,
    });

    rows.push({ rowId: row.id, route: decision.route, blockedReasons: decision.blockedReasons });

    if (decision.route === 'umbra') {
      split.umbra += 1;
      if (!recipient.isSelf) split.claimRequired += 1;
    } else if (decision.route === 'magicblock') {
      split.magicblock += 1;
    } else {
      split.blocked += 1;
    }
  }

  return {
    rows,
    split,
    mintWouldChangeOnFallback: !shareMint && params.facts.umbraTokenSupported,
  };
}

/**
 * Applies a computed assignment back onto rows, returning new row objects
 * with `route` and (for Umbra) `requiresRecipientClaim` set. Rows that could
 * not be routed are marked `invalid` with a blocking reason so they cannot be
 * confirmed.
 */
export function applyRouteAssignment(
  rows: PayrollRow[],
  assignment: PayrollRouteAssignment,
  recipientFactsByAddress: Record<string, PayrollRecipientFacts>,
): PayrollRow[] {
  const byRowId = new Map(assignment.rows.map((entry) => [entry.rowId, entry]));
  const now = Date.now();

  return rows.map((row) => {
    const entry = byRowId.get(row.id);
    if (entry == null) return row;

    if (entry.route == null) {
      return {
        ...row,
        route: null,
        status: 'invalid',
        validationError: PAYROLL_ROUTE_UNAVAILABLE_MESSAGE,
        updatedAt: now,
      };
    }

    const recipient = recipientFactsByAddress[row.recipient] ?? DEFAULT_RECIPIENT_FACTS;
    return {
      ...row,
      route: entry.route,
      requiresRecipientClaim: entry.route === 'umbra' && !recipient.isSelf,
      updatedAt: now,
    };
  });
}
