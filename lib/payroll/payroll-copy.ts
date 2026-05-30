import type { PayrollRouteBlockReason } from '@/lib/payroll/payroll-route-readiness';
import type {
  PayrollRoutePolicy,
  PayrollRowStatus,
  PayrollRunStatus,
} from '@/lib/payroll/payroll-types';

/** Human copy for route block reasons. Pure — shared by chat card + review. */
const BLOCK_REASON_COPY: Record<PayrollRouteBlockReason, string> = {
  wallet_cannot_sign: 'This wallet cannot sign payroll. Import a signable wallet.',
  network_offline: 'You are offline. Reconnect to run payroll.',
  rpc_unavailable: 'The network RPC is unavailable right now.',
  token_unsupported: 'This token is not supported for private payroll.',
  insufficient_balance: 'Not enough balance for the full payroll total.',
  insufficient_fee_sol: 'Not enough SOL to cover network fees.',
  capabilities_loading: 'Still checking what is available. Try again in a moment.',
  umbra_prover_unavailable: 'Umbra private payments need a native build on this device.',
  umbra_capability_unavailable: 'Umbra is not available on this network right now.',
  umbra_vault_unready: 'Umbra vault is not ready for this token/network.',
  umbra_sender_not_registered: 'Set up Umbra once before running payroll.',
  umbra_recipient_not_registered: 'Recipient is not Umbra-ready.',
  magicblock_validator_missing: 'MagicBlock is not configured for this network.',
  magicblock_capability_unavailable: 'MagicBlock private payments are unavailable right now.',
};

export function payrollBlockReasonCopy(reason: PayrollRouteBlockReason): string {
  return BLOCK_REASON_COPY[reason];
}

const ROUTE_POLICY_COPY: Record<PayrollRoutePolicy, string> = {
  private_auto: 'Private (Umbra first)',
  umbra_only: 'Umbra only',
  magicblock_only: 'MagicBlock only',
};

export function payrollRoutePolicyCopy(policy: PayrollRoutePolicy): string {
  return ROUTE_POLICY_COPY[policy];
}

const ROW_STATUS_COPY: Record<PayrollRowStatus, string> = {
  parsed: 'Parsed',
  invalid: 'Invalid',
  ready: 'Ready',
  sending: 'Sending…',
  submitted: 'Sent',
  queued: 'Queued',
  deposited_unclaimed: 'Sent · recipient must claim',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function payrollRowStatusCopy(status: PayrollRowStatus): string {
  return ROW_STATUS_COPY[status];
}

/**
 * Short, sanitized spoken outcome for a finished payroll run. Returns null
 * when the terminal status has nothing worth speaking (e.g. still running).
 * Never includes addresses, amounts, or recipient detail — safe for cloud TTS
 * under `payrollMode`.
 */
export function payrollRunOutcomeSpeech(status: PayrollRunStatus): string | null {
  switch (status) {
    case 'completed':
      return 'Payroll completed.';
    case 'completed_with_claims_pending':
      return 'Payroll submitted. Some recipients still need to claim their funds.';
    case 'completed_with_errors':
      return 'Payroll finished, but some rows failed or were skipped.';
    case 'paused':
      return 'Payroll paused.';
    case 'cancelled':
      return 'Payroll cancelled.';
    case 'failed':
      return 'Payroll failed.';
    default:
      return null;
  }
}

export function shouldSpeakPayrollRunOutcome(
  previousStatus: PayrollRunStatus | null,
  nextStatus: PayrollRunStatus | null,
): boolean {
  if (nextStatus == null || payrollRunOutcomeSpeech(nextStatus) == null) return false;
  return previousStatus === 'running' || previousStatus === 'confirming';
}
