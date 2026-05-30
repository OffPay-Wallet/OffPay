/**
 * Yuga's tool catalog and on-device runner.
 *
 * The strings in this file are NOT user-facing chat replies. They are:
 *
 * 1. **Tool schemas** (the `description` fields below). These are required
 *    by the function-calling API — the model reads them to know what each
 *    tool does. The model never speaks them back. They describe behavior,
 *    not when to call the tool: that's the model's job.
 *
 * 2. **Tool results** (the objects returned by each handler). These are
 *    structured codes, never English prose. The model receives them as
 *    `functionResponse` payloads and writes the user-facing reply itself.
 *    This is why you'll see `{status: 'loading'}` instead of a sentence:
 *    the agent decides how to phrase loading, empty, error, etc.
 *
 * If you ever spot hardcoded English here, that's a bug — please file
 * one. Privacy guarantee: addresses, mints, SNS names, and exact decimal
 * amounts never appear in any tool result.
 */

import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { buildVisibleTokenHoldings, formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';
import { hydrateAgenticRedaction, type AgenticPrivacyRedaction } from '@/lib/agentic-payments/privacy-firewall';
import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { validateAgenticPrivateSendDraft } from '@/lib/agentic-payments/private-send';
import { analyzeAgenticWallet } from '@/lib/agentic-payments/wallet-analyzer';
import type { AgenticKnownWallet } from '@/lib/agentic-payments/private-send-intent';
import type {
  AgentToolCall,
  AgentToolResult,
  AgentToolSchema,
} from '@/lib/agentic-payments/types';
import type { AgenticChatScope, AgenticPrivateSendAction } from '@/store/agenticChatStore';
import type {
  CapabilitiesResponse,
  OffpayNetwork,
  WalletBalanceResponse,
} from '@/types/offpay-api';

export type AgenticToolName =
  | 'list_wallet_tokens'
  | 'get_sol_balance'
  | 'analyze_wallet'
  | 'check_private_send_ready'
  | 'draft_normal_send'
  | 'draft_private_send'
  | 'stage_payroll';

export const AGENTIC_TOOL_SCHEMAS: readonly AgentToolSchema[] = [
  {
    name: 'list_wallet_tokens',
    description: 'Returns the active wallet token holdings as `{symbol, name, balance, verified, spam}` rows. No mints or addresses.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_sol_balance',
    description: 'Returns the active wallet SOL balance as a human-readable amount and a lamport count.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_wallet',
    description: 'Returns a list of wallet insights: gas readiness, private-send readiness, stablecoin availability, unverified-token warnings, etc.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'check_private_send_ready',
    description: 'Returns whether MagicBlock private send is currently usable on the active network.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'draft_normal_send',
    description: 'Prepares an unsigned normal Solana transfer for explicit user confirmation. App validates and broadcasts.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        token: { type: 'string', description: 'Symbol or mint, e.g. USDC, SOL.' },
        recipient: {
          type: 'string',
          description: 'Address, redaction placeholder ([ADDRESS_1]), or "self" for the active wallet.',
        },
      },
      required: ['amount', 'token', 'recipient'],
    },
  },
  {
    name: 'draft_private_send',
    description: 'Prepares an unsigned MagicBlock private (shielded) stablecoin transfer for explicit user confirmation. USDC or USDT only.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        token: { type: 'string', description: 'Stablecoin symbol or mint, e.g. USDC, dUSDC.' },
        recipient: {
          type: 'string',
          description: 'Address, redaction placeholder ([ADDRESS_1]), or "self" for the active wallet.',
        },
      },
      required: ['amount', 'token', 'recipient'],
    },
  },
  {
    name: 'stage_payroll',
    description:
      'Opens the payroll intake UI so the user can upload or paste a batch of recipients and amounts for private (Umbra/MagicBlock) payroll. The app handles parsing, validation, routing, and a single confirmation client-side. Never sends payroll rows to the AI. Call this when the user asks to run payroll, pay multiple people, or do a batch payout.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'How the user wants to provide rows: "upload" (file) or "paste" (text). Defaults to paste.',
        },
      },
    },
  },
] as const;

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
}

export type AgenticToolDraft =
  | {
      kind: 'normal_send' | 'private_send';
      route: 'normal' | 'magicblock';
      draft: Omit<
        AgenticPrivateSendAction,
        'id' | 'kind' | 'status' | 'route' | 'createdAt' | 'updatedAt'
      >;
    };

export interface AgenticToolRun {
  results: AgentToolResult[];
  drafts: AgenticToolDraft[];
  /** Client-side UI intents (e.g. open payroll intake). Never leave device. */
  payrollIntents: PayrollStageIntent[];
}

/** Signals the chat UI to open payroll intake. Carries no payroll data. */
export interface PayrollStageIntent {
  toolCallId: string;
  source: 'upload' | 'paste';
}

export function runAgenticTools(
  toolCalls: readonly AgentToolCall[],
  context: AgenticToolRunnerContext,
): AgenticToolRun {
  const results: AgentToolResult[] = [];
  const drafts: AgenticToolDraft[] = [];
  const payrollIntents: PayrollStageIntent[] = [];

  for (const call of toolCalls) {
    const handler = TOOL_HANDLERS[call.name as AgenticToolName] ?? unknownToolHandler;
    const outcome = handler(call, context);
    results.push({
      toolCallId: call.id,
      name: call.name,
      ...(outcome.error != null ? { error: outcome.error } : { result: outcome.result }),
    });
    if (outcome.draft != null) {
      drafts.push(outcome.draft);
    }
    if (outcome.payrollIntent != null) {
      payrollIntents.push({ toolCallId: call.id, source: outcome.payrollIntent.source });
    }
  }

  return { results, drafts, payrollIntents };
}

interface ToolHandlerOutcome {
  /**
   * Structured codes only — never English sentences. The model reads this
   * and writes the user-facing reply.
   */
  result?: unknown;
  error?: { code: string };
  draft?: AgenticToolDraft;
  payrollIntent?: { source: 'upload' | 'paste' };
}

type ToolHandler = (
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
) => ToolHandlerOutcome;

const TOOL_HANDLERS: Record<AgenticToolName, ToolHandler> = {
  list_wallet_tokens: (_call, context) => {
    if (context.balance == null) return { result: { status: 'loading' } };
    const holdings = buildVisibleTokenHoldings(context.balance);
    if (holdings.length === 0) return { result: { status: 'empty' } };
    return {
      result: {
        status: 'ok',
        tokens: holdings.map((holding) => ({
          symbol: holding.symbol,
          name: holding.name,
          balance: holding.balance,
          verified: holding.verified,
          spam: holding.spam,
        })),
      },
    };
  },
  get_sol_balance: (_call, context) => {
    if (context.balance == null) return { result: { status: 'loading' } };
    return {
      result: {
        status: 'ok',
        sol: formatLamportsAsSol(context.balance.solBalance, 9).replace(/\.?0+$/, ''),
        lamports: context.balance.solBalance,
      },
    };
  },
  analyze_wallet: (_call, context) => {
    const analysis = analyzeAgenticWallet({
      walletAddress: context.scope.walletAddress,
      walletMode: context.walletMode,
      canUseNetwork: context.canUseNetwork,
      balance: context.balance,
      capabilities: context.capabilities,
    });
    return {
      result: {
        status: 'ok',
        insights: analysis.insights.map((insight) => ({
          id: insight.id,
          severity: insight.severity,
        })),
      },
    };
  },
  check_private_send_ready: (_call, context) => {
    const ready =
      isOffpayFeatureAvailable(context.capabilities ?? null, 'payment.privateInitMint') &&
      isOffpayFeatureAvailable(context.capabilities ?? null, 'payment.privateSend') &&
      isOffpayFeatureAvailable(context.capabilities ?? null, 'payment.rpcBroadcast');
    return {
      result: {
        status: 'ok',
        ready,
        network: context.scope.network ?? null,
        walletMode: context.walletMode,
        canUseNetwork: context.canUseNetwork,
      },
    };
  },
  draft_normal_send: (call, context) => buildPaymentDraft(call, context, 'normal'),
  draft_private_send: (call, context) => buildPaymentDraft(call, context, 'magicblock'),
  stage_payroll: (call) => {
    const source = readStringArg(call, 'source') === 'upload' ? 'upload' : 'paste';
    return {
      result: { status: 'opening_payroll_intake', source },
      payrollIntent: { source },
    };
  },
};

function readStringArg(call: AgentToolCall, key: string): string | null {
  const args = call.args as Record<string, unknown> | undefined;
  const value = args?.[key];
  return typeof value === 'string' ? value.trim() : null;
}

function buildPaymentDraft(
  call: AgentToolCall,
  context: AgenticToolRunnerContext,
  route: 'normal' | 'magicblock',
): ToolHandlerOutcome {
  const args = call.args ?? {};
  const recipientRaw = stringField(args.recipient);
  const recipient = normalizeRecipientArg(recipientRaw, context.redactions);
  const validationInput = {
    input: {
      recipient,
      amount: hydrateAgenticRedaction(stringField(args.amount), context.redactions),
      token: hydrateAgenticRedaction(stringField(args.token), context.redactions),
    },
    userText: context.userText,
    knownWallets: [...context.knownWallets],
    walletAddress: context.scope.walletAddress,
    network: context.scope.network as OffpayNetwork | null,
    walletMode: context.walletMode,
    canUseNetwork: context.canUseNetwork,
    balance: context.balance,
    capabilities: context.capabilities,
    allowSelfRecipient: isSelfRecipientArg(recipientRaw),
  };

  const validation =
    route === 'normal'
      ? validateAgenticNormalSendDraft(validationInput)
      : validateAgenticPrivateSendDraft(validationInput);
  if (!validation.ok) {
    // The validator's `message` is privacy-safe and the model will rephrase
    // it for the user. We forward it as part of the structured error so
    // the model knows *why* it was rejected without us inventing copy.
    return { error: { code: validatorErrorCode(validation.message) } };
  }

  return {
    result: {
      status: 'drafted',
      route,
      amount: validation.draft.amount,
      tokenSymbol: validation.draft.tokenSymbol,
      tokenName: validation.draft.tokenName,
      network: validation.draft.network,
      // Recipient deliberately omitted from the model-visible result. The
      // confirmation card on-device shows the full address.
    },
    draft: {
      kind: route === 'normal' ? 'normal_send' : 'private_send',
      route,
      draft: validation.draft,
    },
  };
}

function unknownToolHandler(_call: AgentToolCall): ToolHandlerOutcome {
  return { error: { code: 'unknown_tool' } };
}

/**
 * Map the validator's specific rejection sentence to a stable structured
 * code. The model uses these codes to phrase the user-facing reply
 * without us hardcoding the prose.
 */
function validatorErrorCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('connect a wallet')) return 'wallet_not_connected';
  if (lower.includes('select a supported network')) return 'network_not_selected';
  if (lower.includes('mentions ')) return 'network_mismatch';
  if (lower.includes('online wallet mode')) return 'requires_online_mode';
  if (lower.includes('private send capability')) return 'capabilities_loading';
  if (lower.includes('not available on the current network')) return 'feature_unavailable';
  if (lower.includes('balance is still loading')) return 'balance_loading';
  if (lower.includes('full solana wallet address')) return 'recipient_invalid';
  if (lower.includes('recipient wallet address')) return 'recipient_missing';
  if (lower.includes('amount to send')) return 'amount_missing';
  if (lower.includes('whether to send usdc')) return 'token_missing';
  if (lower.includes('which token')) return 'token_missing';
  if (lower.includes('could not find ')) return 'token_unknown';
  if (lower.includes('only supports usdc or usdt')) return 'token_not_stablecoin';
  if (lower.includes('multiple tokens matching')) return 'token_ambiguous';
  if (lower.includes('amount greater than zero')) return 'amount_invalid';
  if (lower.includes('insufficient ')) return 'amount_exceeds_balance';
  return 'draft_rejected';
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRecipientArg(
  raw: string,
  redactions: readonly AgenticPrivacyRedaction[],
): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower === 'self' ||
    lower === 'own_wallet' ||
    lower === 'my_wallet' ||
    lower === '[self_wallet]'
  ) {
    return '';
  }
  return hydrateAgenticRedaction(trimmed, redactions);
}

function isSelfRecipientArg(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return (
    lower === 'self' ||
    lower === 'own_wallet' ||
    lower === 'my_wallet' ||
    lower === '[self_wallet]'
  );
}
