import type { AgentToolSchema } from '@/lib/agentic-payments/types';

import type { AgenticToolDefinition, AgenticToolMetadata, AgenticToolName } from './types';

const MAX_MODEL_DESCRIPTION_LENGTH = 1800;

const bothNetworks = 'devnet_and_mainnet' as const;
const mainnetOnly = 'mainnet_only' as const;

export const AGENTIC_TOOL_METADATA = {
  get_client_capabilities: {
    category: 'capability',
    networkScope: bothNetworks,
    pendingLabel: 'Checking available tools',
    parallelSafe: true,
    modelInstructions: [
      'Use this when the user asks what OffPay or Yuga can do on the active network.',
      'Report unavailable routes plainly instead of guessing from memory.',
    ],
  },
  get_wallet_balance: {
    category: 'wallet_read',
    networkScope: bothNetworks,
    pendingLabel: 'Checking wallet balance',
    parallelSafe: true,
    modelInstructions: [
      'Use for generic balance, holdings, portfolio value, token list, or "how much do I have" questions.',
      'Prefer this over list_wallet_tokens or get_sol_balance unless the user asks for a narrower view.',
    ],
  },
  get_wallet_history: {
    category: 'wallet_read',
    networkScope: bothNetworks,
    pendingLabel: 'Checking recent activity',
    parallelSafe: true,
    modelInstructions: [
      'Use for recent activity, transaction status, and "what happened recently" questions.',
      'Never ask for signatures when a recent safe summary is enough.',
    ],
  },
  resolve_recipient: {
    category: 'recipient_resolution',
    networkScope: bothNetworks,
    pendingLabel: 'Resolving recipient',
    parallelSafe: true,
    modelInstructions: [
      'Use for .sol names, @X handles, saved-wallet names, or ambiguous recipient references before drafting a send.',
      'Pass redacted placeholders exactly as provided.',
    ],
  },
  get_normal_transfer_fee: {
    category: 'fee_quote',
    networkScope: bothNetworks,
    pendingLabel: 'Estimating transfer fee',
    parallelSafe: true,
    modelInstructions: [
      'Use only when the user asks about the SOL fee for a normal/public transfer.',
      'Do not use this as a replacement for drafting a send.',
    ],
  },
  get_swap_tokens: {
    category: 'swap',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking swap tokens',
    parallelSafe: true,
    modelInstructions: [
      'Use when the user asks which tokens can be swapped.',
      'This tool is exposed only when swap is available on the active network.',
    ],
  },
  get_swap_price: {
    category: 'swap',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking token price',
    parallelSafe: true,
    modelInstructions: [
      'Use for a regular spot token price, not perpetual market prices.',
      'For Flash/perpetual prices, use flash_get_prices when available.',
    ],
  },
  prepare_swap_quote: {
    category: 'swap',
    networkScope: mainnetOnly,
    pendingLabel: 'Quoting swap',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user asks to swap, trade, or convert tokens and provides input token, output token, and amount.',
      'If private, Umbra, or MagicBlock swap routing is requested, call this with that route so route_unavailable can be explained.',
      'Do not guess missing token or amount fields; ask one short clarification instead.',
    ],
  },
  scan_umbra_claims: {
    category: 'umbra',
    networkScope: bothNetworks,
    pendingLabel: 'Scanning Umbra claims',
    parallelSafe: true,
    modelInstructions: [
      'Use only when the user explicitly asks to scan or check Umbra claims.',
      'This tool never claims funds; it only reports whether manual claiming is needed.',
    ],
  },
  get_umbra_balances: {
    category: 'umbra',
    networkScope: bothNetworks,
    pendingLabel: 'Checking Umbra vault',
    parallelSafe: true,
    modelInstructions: [
      'Use for private balance, encrypted balance, shielded balance, vault balance, Umbra balance, or Umbra vault balance.',
      'Call it Umbra vault balance in replies and do not call it MagicBlock.',
      'Do not use for explicit MagicBlock balance or MagicBlock private-payment balance requests; MagicBlock has no separate balance vault.',
    ],
  },
  list_wallet_tokens: {
    category: 'wallet_read',
    networkScope: bothNetworks,
    pendingLabel: 'Listing wallet tokens',
    parallelSafe: true,
    modelInstructions: [
      'Use only when the user specifically wants token rows instead of a portfolio balance summary.',
      'For generic balance questions, prefer get_wallet_balance.',
    ],
  },
  get_sol_balance: {
    category: 'wallet_read',
    networkScope: bothNetworks,
    pendingLabel: 'Checking SOL balance',
    parallelSafe: true,
    modelInstructions: [
      'Use only when the user specifically asks for SOL balance.',
      'For generic wallet balance questions, prefer get_wallet_balance.',
    ],
  },
  analyze_wallet: {
    category: 'wallet_read',
    networkScope: bothNetworks,
    pendingLabel: 'Reviewing wallet readiness',
    parallelSafe: true,
    modelInstructions: [
      'Use for wallet overview, readiness, gas readiness, or wallet details.',
      'Do not call it a health check unless the user uses that phrase.',
    ],
  },
  check_private_send_ready: {
    category: 'capability',
    networkScope: bothNetworks,
    pendingLabel: 'Checking private routes',
    parallelSafe: true,
    modelInstructions: [
      'Use when the user asks whether private routes are ready or which tokens MagicBlock or Umbra supports on the active network.',
      'Do not answer supported-token questions from memory.',
    ],
  },
  draft_normal_send: {
    category: 'payment_draft',
    networkScope: bothNetworks,
    pendingLabel: 'Preparing normal transfer',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants a public, normal, or direct transfer and provides recipient, amount, and token.',
      'If any required field is missing or incomprehensible, ask one short clarification instead of guessing.',
      'Use the active wallet as sender. Use recipient self only when the user explicitly asks to send to themselves.',
    ],
  },
  draft_private_send: {
    category: 'payment_draft',
    networkScope: bothNetworks,
    pendingLabel: 'Preparing private transfer',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user explicitly asks for private, shielded, MagicBlock, Umbra, or private P2P transfer.',
      'Do not choose private route for ordinary sends unless the user requested private routing.',
      'For follow-up corrections, reuse prior amount, recipient, and route only when the latest user message clearly continues that send.',
    ],
  },
  stage_payroll: {
    category: 'payroll',
    networkScope: bothNetworks,
    pendingLabel: 'Opening batch send',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants batch send, multi-send, payroll, or paying multiple people at once.',
      'Never ask the user to paste payroll rows into chat; the app opens a local upload or paste UI.',
    ],
  },
  flash_get_markets: {
    category: 'flash_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking Flash markets',
    parallelSafe: true,
    modelInstructions: [
      'Use when the user asks what perpetual markets or leverage limits are available on Flash.',
      'Flash tools are mainnet-only; on devnet explain that Flash requires mainnet.',
    ],
  },
  flash_get_positions: {
    category: 'flash_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking Flash positions',
    parallelSafe: true,
    modelInstructions: [
      'Use when the user asks about open leveraged positions, perp positions, PnL, or how trades are doing.',
      'Do not use wallet balance tools for leveraged position state.',
    ],
  },
  flash_get_prices: {
    category: 'flash_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking perp prices',
    parallelSafe: true,
    modelInstructions: [
      'Use for perpetual market prices, separate from regular token spot prices.',
      'If the user asks for a regular token price, use get_swap_price when available.',
    ],
  },
  flash_get_orders: {
    category: 'flash_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking trigger orders',
    parallelSafe: true,
    modelInstructions: [
      'Use for existing trigger orders, take-profit orders, stop-loss orders, and pending Flash orders.',
    ],
  },
  flash_open_position: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing trade preview',
    parallelSafe: false,
    modelInstructions: [
      'Use directly when market, side, leverage, collateral, input token, and market or limit order type are present.',
      'Do not call analytics first; this tool validates market data and returns the signing preview.',
      'Ask one short clarification for missing trade parameters.',
    ],
  },
  flash_close_position: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing close preview',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to close, exit, or manually take profit on an existing Flash position.',
      'For partial close, pass closeAmountUsd when the user provides it.',
    ],
  },
  flash_add_collateral: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing collateral add',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to add margin or reduce leverage on a Flash position.',
    ],
  },
  flash_remove_collateral: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing collateral removal',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to remove margin or increase leverage on a Flash position.',
      'Warn about liquidation risk in the final reply.',
    ],
  },
  flash_place_trigger_order: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing TP/SL order',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to place take-profit or stop-loss on a Flash position.',
      'Validate trigger direction: TP above entry for longs and below entry for shorts.',
    ],
  },
  flash_edit_trigger_order: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing TP/SL edit',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to change an existing take-profit or stop-loss trigger price or size.',
    ],
  },
  flash_cancel_trigger_order: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing order cancel',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to remove a specific Flash take-profit or stop-loss order.',
    ],
  },
  flash_cancel_all_trigger_orders: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing order cleanup',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to remove all Flash trigger orders for a market and side.',
    ],
  },
  flash_reverse_position: {
    category: 'flash_draft',
    networkScope: mainnetOnly,
    pendingLabel: 'Preparing position reverse',
    parallelSafe: false,
    modelInstructions: [
      'Use when the user wants to flip a Flash position from long to short or short to long.',
    ],
  },
  flash_get_pool_stats: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking Flash pools',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_funding_rates: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking funding rates',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_open_interest: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking open interest',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_liquidation_clusters: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking liquidation clusters',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_market_metrics: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking market metrics',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_portfolio_risk: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking portfolio risk',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_absorption_analysis: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking absorption',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_optimal_entry: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking optimal entry',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_position_sizing: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking position size',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_hedge_suggestions: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking hedges',
    parallelSafe: true,
    modelInstructions: ['Internal Flash analytics helper; hidden from model-facing tool lists.'],
  },
  flash_get_data_pools: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking data pools',
    parallelSafe: true,
    modelInstructions: ['Internal Flash guardrail helper; hidden from model-facing tool lists.'],
  },
  flash_validate_data_access: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking data access',
    parallelSafe: true,
    modelInstructions: ['Internal Flash guardrail helper; hidden from model-facing tool lists.'],
  },
  flash_get_rate_limits: {
    category: 'internal_read',
    networkScope: mainnetOnly,
    pendingLabel: 'Checking rate limits',
    parallelSafe: true,
    modelInstructions: ['Internal Flash guardrail helper; hidden from model-facing tool lists.'],
  },
} satisfies Record<AgenticToolName, AgenticToolMetadata>;

export function withAgenticToolMetadata(definition: AgenticToolDefinition): AgenticToolDefinition {
  return {
    ...definition,
    metadata: AGENTIC_TOOL_METADATA[definition.name],
  };
}

export function getAgenticToolMetadata(name: string): AgenticToolMetadata | null {
  if (!isAgenticToolName(name)) return null;
  return AGENTIC_TOOL_METADATA[name];
}

export function buildModelFacingToolSchema(definition: AgenticToolDefinition): AgentToolSchema {
  const metadata = definition.metadata ?? AGENTIC_TOOL_METADATA[definition.name];
  const networkText =
    metadata.networkScope === mainnetOnly
      ? 'Network: mainnet only.'
      : 'Network: available on devnet and mainnet when capability checks pass.';
  const guidance = metadata.modelInstructions.join(' ');
  const description = [
    definition.schema.description.trim(),
    networkText,
    `Tool category: ${metadata.category}.`,
    guidance,
  ]
    .filter((part) => part.length > 0)
    .join(' ')
    .slice(0, MAX_MODEL_DESCRIPTION_LENGTH);

  return {
    ...definition.schema,
    description,
    xOffpay: {
      category: metadata.category,
      networkScope: metadata.networkScope,
      pendingLabel: metadata.pendingLabel,
      modelInstructions: metadata.modelInstructions,
    },
  };
}

export function formatAgenticToolProcessingLabel(toolCalls: readonly { name: string }[]): string {
  const labels = toolCalls
    .map((call) => getAgenticToolMetadata(call.name)?.pendingLabel)
    .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);

  if (labels.length === 0) return 'Choosing the right tool';

  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length === 1) return uniqueLabels[0];
  if (uniqueLabels.length === 2) return `${uniqueLabels[0]} and ${uniqueLabels[1].toLowerCase()}`;
  return `${uniqueLabels[0]} and ${uniqueLabels.length - 1} more checks`;
}

export function isAgenticToolParallelSafe(name: string): boolean {
  return getAgenticToolMetadata(name)?.parallelSafe === true;
}

function isAgenticToolName(name: string): name is AgenticToolName {
  return Object.prototype.hasOwnProperty.call(AGENTIC_TOOL_METADATA, name);
}
