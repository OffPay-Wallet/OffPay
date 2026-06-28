import type { QueryClient } from '@tanstack/react-query';

import type { AgenticKnownWallet } from '@/lib/agentic-payments/private-send-intent';
import type { AgenticPrivacyRedaction } from '@/lib/agentic-payments/privacy-firewall';
import type { AgentToolCall, AgentToolResult, AgentToolSchema } from '@/lib/agentic-payments/types';
import type {
  AgenticChatScope,
  AgenticPrivateSendAction,
  AgenticSwapAction,
  AgenticFlashPositionAction,
} from '@/store/agenticChatStore';
import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

export type AgenticToolName =
  | 'get_client_capabilities'
  | 'get_wallet_balance'
  | 'get_wallet_history'
  | 'resolve_recipient'
  | 'get_normal_transfer_fee'
  | 'get_swap_tokens'
  | 'get_swap_price'
  | 'prepare_swap_quote'
  | 'get_private_payment_balance'
  | 'scan_umbra_claims'
  | 'get_umbra_balances'
  | 'list_wallet_tokens'
  | 'get_sol_balance'
  | 'analyze_wallet'
  | 'check_private_send_ready'
  | 'draft_normal_send'
  | 'draft_private_send'
  | 'stage_payroll'
  | 'flash_get_markets'
  | 'flash_get_positions'
  | 'flash_get_prices'
  | 'flash_get_orders'
  | 'flash_open_position'
  | 'flash_close_position'
  | 'flash_add_collateral'
  | 'flash_remove_collateral'
  | 'flash_place_trigger_order'
  | 'flash_edit_trigger_order'
  | 'flash_cancel_trigger_order'
  | 'flash_cancel_all_trigger_orders'
  | 'flash_reverse_position'
  | 'flash_get_pool_stats'
  | 'flash_get_funding_rates'
  | 'flash_get_open_interest'
  | 'flash_get_liquidation_clusters'
  | 'flash_get_market_metrics'
  | 'flash_get_portfolio_risk'
  | 'flash_get_absorption_analysis'
  | 'flash_get_optimal_entry'
  | 'flash_get_position_sizing'
  | 'flash_get_hedge_suggestions'
  | 'flash_get_data_pools'
  | 'flash_validate_data_access'
  | 'flash_get_rate_limits';

export type AgenticTransferRoute = 'normal' | 'magicblock' | 'umbra';
export type AgenticSwapRoute = 'normal';
export type AgenticToolCategory =
  | 'capability'
  | 'wallet_read'
  | 'recipient_resolution'
  | 'fee_quote'
  | 'payment_draft'
  | 'swap'
  | 'private_balance'
  | 'umbra'
  | 'payroll'
  | 'flash_read'
  | 'flash_draft'
  | 'internal_read';
export type AgenticToolNetworkScope = 'devnet_and_mainnet' | 'mainnet_only';

export interface AgenticToolMetadata {
  category: AgenticToolCategory;
  networkScope: AgenticToolNetworkScope;
  pendingLabel: string;
  parallelSafe: boolean;
  modelInstructions: string[];
}

export interface AgenticPortfolioValuationSnapshot {
  currency: string;
  totalUsd: number;
  total: number;
  pricedCount: number;
  expectedCount: number;
  fetchedAt: number;
  unitUsdPrices: Readonly<Record<string, number>>;
}

export interface AgenticToolRunnerContext {
  scope: AgenticChatScope;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  portfolioValuation?: AgenticPortfolioValuationSnapshot | null;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: readonly AgenticKnownWallet[];
  redactions: readonly AgenticPrivacyRedaction[];
  /** Original user text for the turn that produced these tool calls. */
  userText: string;
  queryClient?: QueryClient;
  signal?: AbortSignal;
  walletId?: string | null;
  walletImportMethod?: WalletImportMethod | null;
}

export type AgenticToolDraft =
  | {
      kind: 'normal_send' | 'private_send';
      route: AgenticTransferRoute;
      draft: Omit<
        AgenticPrivateSendAction,
        'id' | 'kind' | 'status' | 'route' | 'createdAt' | 'updatedAt'
      >;
    }
  | {
      kind: 'swap';
      route: AgenticSwapRoute;
      draft: Omit<
        AgenticSwapAction,
        'id' | 'kind' | 'status' | 'route' | 'createdAt' | 'updatedAt'
      >;
    }
  | {
      kind: 'flash_position';
      draft: Omit<AgenticFlashPositionAction, 'id' | 'kind' | 'status' | 'createdAt' | 'updatedAt'>;
    };

export interface PayrollStageIntent {
  toolCallId: string;
  source: 'upload' | 'paste';
}

export interface AgenticToolRun {
  toolCalls: AgentToolCall[];
  results: AgentToolResult[];
  drafts: AgenticToolDraft[];
  /** Client-side UI intents (e.g. open payroll intake). Never leave device. */
  payrollIntents: PayrollStageIntent[];
}

export interface ToolHandlerOutcome {
  /**
   * Structured codes only where possible. The model reads this and writes the
   * user-facing reply.
   */
  result?: unknown;
  error?: { code: string };
  draft?: AgenticToolDraft;
  payrollIntent?: { source: 'upload' | 'paste' };
}

export type ToolHandler = (
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
) => ToolHandlerOutcome | Promise<ToolHandlerOutcome>;

export interface AgenticToolDefinition {
  name: AgenticToolName;
  schema: AgentToolSchema;
  metadata?: AgenticToolMetadata;
  run: ToolHandler;
}

export interface PaymentDraftToolOptions {
  defaultRoute: AgenticTransferRoute;
}
