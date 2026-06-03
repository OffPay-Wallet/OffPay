import type { AgentToolCall } from '@/lib/agentic-payments/types';

import { analyzeWalletTool } from './analyze-wallet';
import { checkPrivateSendReadyTool } from './check-private-send-ready';
import { draftNormalSendTool, draftPrivateSendTool } from './payment-drafts';
import { getClientCapabilitiesTool } from './get-client-capabilities';
import { getNormalTransferFeeTool } from './get-normal-transfer-fee';
import { getPrivatePaymentBalanceTool } from './get-private-payment-balance';
import { getSolBalanceTool } from './get-sol-balance';
import { getSwapPriceTool } from './get-swap-price';
import { getSwapTokensTool } from './get-swap-tokens';
import { getUmbraBalancesTool } from './get-umbra-balances';
import { getWalletBalanceTool } from './get-wallet-balance';
import { getWalletHistoryTool } from './get-wallet-history';
import { listWalletTokensTool } from './list-wallet-tokens';
import { prepareSwapQuoteTool } from './prepare-swap-quote';
import { resolveRecipientTool } from './resolve-recipient';
import { scanUmbraClaimsTool } from './scan-umbra-claims';
import { stagePayrollTool } from './stage-payroll';
import type {
  AgenticToolDefinition,
  AgenticToolName,
  AgenticToolRunnerContext,
  ToolHandlerOutcome,
} from './types';

export const AGENTIC_TOOL_DEFINITIONS: readonly AgenticToolDefinition[] = [
  getClientCapabilitiesTool,
  getWalletBalanceTool,
  getWalletHistoryTool,
  resolveRecipientTool,
  getNormalTransferFeeTool,
  getSwapTokensTool,
  getSwapPriceTool,
  prepareSwapQuoteTool,
  getPrivatePaymentBalanceTool,
  scanUmbraClaimsTool,
  getUmbraBalancesTool,
  listWalletTokensTool,
  getSolBalanceTool,
  analyzeWalletTool,
  checkPrivateSendReadyTool,
  draftNormalSendTool,
  draftPrivateSendTool,
  stagePayrollTool,
] as const;

export const AGENTIC_TOOL_SCHEMAS = AGENTIC_TOOL_DEFINITIONS.map((definition) => definition.schema);

const TOOL_HANDLERS = new Map<AgenticToolName, AgenticToolDefinition>(
  AGENTIC_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export async function runToolHandler(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
): Promise<ToolHandlerOutcome> {
  const handler = TOOL_HANDLERS.get(call.name as AgenticToolName);
  if (handler == null) return { error: { code: 'unknown_tool' } };
  return handler.run(call, context);
}
