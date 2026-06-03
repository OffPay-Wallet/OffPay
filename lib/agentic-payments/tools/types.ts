import type { QueryClient } from '@tanstack/react-query';

import type { AgenticKnownWallet } from '@/lib/agentic-payments/private-send-intent';
import type { AgenticPrivacyRedaction } from '@/lib/agentic-payments/privacy-firewall';
import type { AgentToolCall, AgentToolResult, AgentToolSchema } from '@/lib/agentic-payments/types';
import type {
  AgenticChatScope,
  AgenticPrivateSendAction,
  AgenticSwapAction,
} from '@/store/agenticChatStore';
import type {
  CapabilitiesResponse,
  OffpayNetwork,
  WalletBalanceResponse,
} from '@/types/offpay-api';

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
  | 'stage_payroll';

export type AgenticTransferRoute = 'normal' | 'magicblock' | 'umbra';
export type AgenticSwapRoute = 'normal';

export interface AgenticToolRunnerContext {
  scope: AgenticChatScope;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: readonly AgenticKnownWallet[];
  redactions: readonly AgenticPrivacyRedaction[];
  /** Original user text for the turn that produced these tool calls. */
  userText: string;
  queryClient?: QueryClient;
  signal?: AbortSignal;
  walletId?: string | null;
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
  run: ToolHandler;
}

export interface PaymentDraftToolOptions {
  defaultRoute: AgenticTransferRoute;
}
