/**
 * Pure helpers shared by the agentic chat UI. Kept in a small module so
 * unit tests do not have to import the React Native screen tree.
 */

import { AgenticPaymentsProxyError } from '@/lib/agentic-payments/ai-proxy-client';
import {
  AGENTIC_NORMAL_SEND_TOOL_NAME,
  AGENTIC_NORMAL_SEND_TOOL_SCHEMA,
} from '@/lib/agentic-payments/normal-send-tool';
import {
  AGENTIC_PRIVATE_SEND_TOOL_NAME,
  AGENTIC_PRIVATE_SEND_TOOL_SCHEMA,
} from '@/lib/agentic-payments/private-send-tool';

import type { AgenticChatMessage, AgenticPrivateSendAction } from '@/store/agenticChatStore';

export function createAgenticId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getProxyErrorMessage(error: unknown): string {
  if (error instanceof AgenticPaymentsProxyError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Yuga could not complete that request.';
}

export function formatPrivateSendStatus(status: AgenticPrivateSendAction['status']): string {
  if (status === 'needs_confirmation') return 'Needs confirmation';
  if (status === 'submitting') return 'Submitting';
  if (status === 'submitted') return 'Submitted';
  if (status === 'queued') return 'Queued';
  if (status === 'cancelled') return 'Cancelled';
  return 'Failed';
}

export function isFinalPrivateSendStatus(status: AgenticPrivateSendAction['status']): boolean {
  return status === 'submitted' || status === 'queued' || status === 'cancelled';
}

/**
 * Build a Solscan transaction URL with the correct cluster query for devnet
 * vs. mainnet. Mirrors the helpers used elsewhere in the app
 * (TransactionDetailsScreen, PrivatePaymentSendFlow, SwapExecutionStatusCard).
 */
export function buildSolscanTxUrl(
  signature: string,
  network: AgenticPrivateSendAction['network'],
): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

/**
 * If the prompt clearly asks for a specific route, return the matching tool
 * name so we can prefer that draft when the AI emits both. Returns null
 * when the user did not commit to a route — in that case the first matching
 * tool call wins.
 */
export function pickPreferredToolName(prompt: string): string | null {
  const normalized = prompt.toLowerCase();
  const mentionsPrivate =
    /\b(magicblock|magic\s*block|private\s+(?:send|route|payment|transfer)|shielded|stealth)\b/.test(
      normalized,
    );
  const mentionsNormal =
    /\b(normal\s+(?:send|route|transfer)|public\s+(?:send|route|transfer)|direct\s+transfer)\b/.test(
      normalized,
    );

  if (mentionsPrivate && !mentionsNormal) return AGENTIC_PRIVATE_SEND_TOOL_NAME;
  if (mentionsNormal && !mentionsPrivate) return AGENTIC_NORMAL_SEND_TOOL_NAME;
  return null;
}

export function formatConversationTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function getConversationPreview(
  conversationId: string,
  messages: readonly AgenticChatMessage[],
): string {
  const message = messages
    .filter((item) => item.conversationId === conversationId && item.pending !== true)
    .sort((left, right) => right.createdAt - left.createdAt)
    .find((item) => item.text.trim().length > 0);

  return message?.text.replace(/\s+/g, ' ').trim() ?? 'No messages yet';
}

/** Re-exported tool constants so consumers don't need three imports. */
export const AGENTIC_TOOL_SCHEMAS = [
  AGENTIC_NORMAL_SEND_TOOL_SCHEMA,
  AGENTIC_PRIVATE_SEND_TOOL_SCHEMA,
] as const;

export { AGENTIC_NORMAL_SEND_TOOL_NAME, AGENTIC_PRIVATE_SEND_TOOL_NAME };
