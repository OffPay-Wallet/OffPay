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
import {
  flashGetMarketsTool,
  flashGetPositionsTool,
  flashGetPricesTool,
  flashGetOrdersTool,
  flashOpenPositionTool,
  flashClosePositionTool,
  flashAddCollateralTool,
  flashRemoveCollateralTool,
  flashPlaceTriggerOrderTool,
  flashEditTriggerOrderTool,
  flashCancelTriggerOrderTool,
  flashCancelAllTriggerOrdersTool,
  flashReversePositionTool,
  flashGetPoolStatsTool,
  flashGetFundingRatesTool,
  flashGetOpenInterestTool,
  flashGetLiquidationClustersTool,
  flashGetMarketMetricsTool,
  flashGetPortfolioRiskTool,
  flashGetAbsorptionAnalysisTool,
  flashGetOptimalEntryTool,
  flashGetPositionSizingTool,
  flashGetHedgeSuggestionsTool,
  flashGetDataPoolsTool,
  flashValidateDataAccessTool,
  flashGetRateLimitsTool,
} from './flash-trade';
import type {
  AgenticToolDefinition,
  AgenticToolName,
  AgenticToolRunnerContext,
  ToolHandlerOutcome,
} from './types';

const MODEL_HIDDEN_TOOL_NAMES = new Set<AgenticToolName>([
  'flash_get_pool_stats',
  'flash_get_funding_rates',
  'flash_get_open_interest',
  'flash_get_liquidation_clusters',
  'flash_get_market_metrics',
  'flash_get_portfolio_risk',
  'flash_get_absorption_analysis',
  'flash_get_optimal_entry',
  'flash_get_position_sizing',
  'flash_get_hedge_suggestions',
  'flash_get_data_pools',
  'flash_validate_data_access',
  'flash_get_rate_limits',
]);

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
  flashGetMarketsTool,
  flashGetPositionsTool,
  flashGetPricesTool,
  flashGetOrdersTool,
  flashOpenPositionTool,
  flashClosePositionTool,
  flashAddCollateralTool,
  flashRemoveCollateralTool,
  flashPlaceTriggerOrderTool,
  flashEditTriggerOrderTool,
  flashCancelTriggerOrderTool,
  flashCancelAllTriggerOrdersTool,
  flashReversePositionTool,
  flashGetPoolStatsTool,
  flashGetFundingRatesTool,
  flashGetOpenInterestTool,
  flashGetLiquidationClustersTool,
  flashGetMarketMetricsTool,
  flashGetPortfolioRiskTool,
  flashGetAbsorptionAnalysisTool,
  flashGetOptimalEntryTool,
  flashGetPositionSizingTool,
  flashGetHedgeSuggestionsTool,
  flashGetDataPoolsTool,
  flashValidateDataAccessTool,
  flashGetRateLimitsTool,
] as const;

export const AGENTIC_MODEL_TOOL_DEFINITIONS = AGENTIC_TOOL_DEFINITIONS.filter(
  (definition) => !MODEL_HIDDEN_TOOL_NAMES.has(definition.name),
);

export const AGENTIC_TOOL_SCHEMAS = AGENTIC_MODEL_TOOL_DEFINITIONS.map(
  (definition) => definition.schema,
);

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
