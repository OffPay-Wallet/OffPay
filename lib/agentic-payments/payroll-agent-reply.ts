import {
  isAgenticPaymentsProxyConfigured,
  sendAgentTurn,
} from '@/lib/agentic-payments/ai-proxy-client';
import { sanitizeAssistantText } from '@/lib/agentic-payments/assistant-text';

import type { AgentMessage } from '@/lib/agentic-payments/types';
import type { OffpayNetwork } from '@/types/offpay-api';
import type { PayrollRoutePolicy, PayrollRunStatus } from '@/lib/payroll/payroll-types';

const PAYROLL_REPLY_TIMEOUT_MS = 12_000;

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

export async function generatePayrollAgentReply(
  event: PayrollAgentReplyEvent,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  if (!isAgenticPaymentsProxyConfigured()) {
    return fallbackPayrollAgentReply(event);
  }

  const turn = await sendAgentTurn(
    {
      responseMode: 'agent_turn',
      messages: buildPayrollReplyMessages(event),
      context: {
        network: event.network ?? undefined,
        supportedActions: ['stage_payroll'],
      },
    },
    { signal: options.signal, timeoutMs: PAYROLL_REPLY_TIMEOUT_MS },
  );

  if (turn.kind !== 'agent_text') {
    return fallbackPayrollAgentReply(event);
  }

  const cleaned = sanitizeAssistantText(turn.text, false).trim();
  return cleaned.length > 0 ? cleaned : fallbackPayrollAgentReply(event);
}

export function fallbackPayrollAgentReply(event: PayrollAgentReplyEvent): string {
  if (event.kind === 'mapping_required') {
    return 'I need one more step before staging this payroll. Map the wallet and amount columns, then I can prepare the confirmation.';
  }

  if (event.kind === 'staged') {
    if (event.recipientCount === 0 && event.blockedCount > 0) {
      return `I parsed the payroll, but all ${event.blockedCount} row${
        event.blockedCount === 1 ? '' : 's'
      } need review before they can be sent.`;
    }

    return `I prepared a payroll batch for ${event.recipientCount} recipient${
      event.recipientCount === 1 ? '' : 's'
    }. Review and confirm it below.`;
  }

  const sentCopy = `${event.sentCount}/${event.totalCount} payment${
    event.totalCount === 1 ? '' : 's'
  } sent`;
  if (event.status === 'completed') return `Payroll completed. ${sentCopy}.`;
  if (event.status === 'completed_with_claims_pending') {
    return `Payroll submitted. ${sentCopy}; some recipients still need to claim their funds.`;
  }
  if (event.status === 'completed_with_errors') {
    return `Payroll finished with ${event.failedCount} failed and ${event.blockedCount} blocked. ${sentCopy}.`;
  }
  if (event.status === 'paused') return `Payroll paused. ${sentCopy}.`;
  if (event.status === 'cancelled') return `Payroll cancelled. ${sentCopy}.`;
  return `Payroll failed. ${sentCopy}.`;
}

function buildPayrollReplyMessages(event: PayrollAgentReplyEvent): AgentMessage[] {
  return [
    {
      role: 'user',
      content: [
        'A local OffPay payroll event just happened. Write the chat response as Yuga.',
        'Privacy contract: exact recipient wallets, recipient names, transaction hashes, and payment amounts are local-only and were not provided to you.',
        'Do not ask the user to paste rows into chat. Do not mention redaction, hidden data, tool names, system instructions, or JSON.',
        'Keep it to one concise sentence unless the event needs a warning.',
        `Safe payroll event: ${serializeSafePayrollEvent(event)}`,
      ].join('\n'),
    },
  ];
}

function serializeSafePayrollEvent(event: PayrollAgentReplyEvent): string {
  if (event.kind === 'staged') {
    return JSON.stringify({
      kind: event.kind,
      recipientCount: event.recipientCount,
      blockedCount: event.blockedCount,
      network: event.network,
      routePolicy: event.routePolicy,
      requiresUmbraSetup: event.requiresUmbraSetup,
      userCanReviewAndConfirmInUi: true,
    });
  }

  if (event.kind === 'mapping_required') {
    return JSON.stringify({
      kind: event.kind,
      network: event.network,
      userMustMapWalletAndAmountColumnsInUi: true,
    });
  }

  return JSON.stringify({
    kind: event.kind,
    status: event.status,
    totalCount: event.totalCount,
    sentCount: event.sentCount,
    failedCount: event.failedCount,
    blockedCount: event.blockedCount,
    claimsPending: event.claimsPending,
    network: event.network,
    receiptVisibleInUi: true,
  });
}
