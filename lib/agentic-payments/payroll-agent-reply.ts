import type { OffpayNetwork } from '@/types/offpay-api';
import type { PayrollRoutePolicy, PayrollRunStatus } from '@/lib/payroll/payroll-types';

export type PayrollAgentReplyEvent =
  | {
      kind: 'staged';
      recipientCount: number;
      blockedCount: number;
      network: OffpayNetwork;
      routePolicy: PayrollRoutePolicy;
      requiresUmbraSetup: boolean;
    }
  | {
      kind: 'mapping_required';
      network: OffpayNetwork | null;
    }
  | {
      kind: 'outcome';
      status: PayrollRunStatus;
      totalCount: number;
      sentCount: number;
      failedCount: number;
      blockedCount: number;
      claimsPending: boolean;
      network: OffpayNetwork;
    };

export function generatePayrollAgentReply(event: PayrollAgentReplyEvent): string {
  return fallbackPayrollAgentReply(event);
}

export function fallbackPayrollAgentReply(event: PayrollAgentReplyEvent): string {
  if (event.kind === 'mapping_required') {
    return 'I need one more step before staging this batch send. Map the wallet and amount columns, then I can prepare the confirmation.';
  }

  if (event.kind === 'staged') {
    if (event.recipientCount === 0 && event.blockedCount > 0) {
      return `I parsed the batch send, but all ${event.blockedCount} row${
        event.blockedCount === 1 ? '' : 's'
      } need review before they can be sent.`;
    }

    return `I prepared a batch send for ${event.recipientCount} recipient${
      event.recipientCount === 1 ? '' : 's'
    }. Review and confirm it below.`;
  }

  const sentCopy = `${event.sentCount}/${event.totalCount} payment${
    event.totalCount === 1 ? '' : 's'
  } sent`;
  if (event.status === 'completed') return `Batch send completed. ${sentCopy}.`;
  if (event.status === 'completed_with_claims_pending') {
    return `Batch send submitted. ${sentCopy}; some recipients still need to claim their funds.`;
  }
  if (event.status === 'completed_with_errors') {
    return `Batch send finished with ${event.failedCount} failed and ${event.blockedCount} blocked. ${sentCopy}.`;
  }
  if (event.status === 'paused') return `Batch send paused. ${sentCopy}.`;
  if (event.status === 'cancelled') return `Batch send cancelled. ${sentCopy}.`;
  return `Batch send failed. ${sentCopy}.`;
}
