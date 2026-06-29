import type { AgentToolResult } from '@/lib/agentic-payments/types';
import type {
  AgenticChatToolCard,
  AgenticToolCardItem,
  AgenticToolCardRow,
  AgenticToolCardTone,
} from '@/store/agenticChatStore';

const MAX_TOOL_CARDS = 3;
const MAX_ITEMS_PER_CARD = 5;
const MAX_ROWS_PER_CARD = 5;

const BACKGROUND_TOOL_NAMES = new Set(['resolve_recipient', 'list_local_contacts']);

const DRAFT_TOOL_NAMES = new Set([
  'draft_normal_send',
  'draft_private_send',
  'draft_umbra_vault_action',
  'prepare_swap_quote',
  'stage_payroll',
  'flash_open_position',
  'flash_close_position',
  'flash_add_collateral',
  'flash_remove_collateral',
  'flash_place_trigger_order',
  'flash_edit_trigger_order',
  'flash_cancel_trigger_order',
  'flash_cancel_all_trigger_orders',
  'flash_reverse_position',
]);

const TOOL_TITLES: Record<string, string> = {
  get_client_capabilities: 'Available tools',
  get_wallet_balance: 'Portfolio',
  get_wallet_history: 'Recent activity',
  list_local_contacts: 'Saved contacts',
  get_normal_transfer_fee: 'Transfer fee',
  get_swap_tokens: 'Swap tokens',
  get_swap_price: 'Token price',
  scan_umbra_claims: 'Umbra claims',
  get_umbra_balances: 'Umbra vault',
  list_wallet_tokens: 'Wallet tokens',
  get_sol_balance: 'SOL balance',
  analyze_wallet: 'Wallet readiness',
  check_private_send_ready: 'Private routes',
  flash_get_markets: 'Flash markets',
  flash_get_positions: 'Flash positions',
  flash_get_prices: 'Flash prices',
  flash_get_orders: 'Flash orders',
};

const FEATURE_LABELS: Record<string, string> = {
  walletBalance: 'Balance',
  walletHistory: 'History',
  normalSend: 'Normal send',
  magicblockPrivateSend: 'MagicBlock',
  privateBalance: 'Private balance',
  umbraVaultBalance: 'Umbra vault',
  umbraPrivateP2p: 'Umbra P2P',
  swap: 'Swap',
  privacySwap: 'Private swap',
};

export function buildAgenticToolResultCards(
  results: readonly AgentToolResult[],
): AgenticChatToolCard[] {
  const cards: AgenticChatToolCard[] = [];
  for (const result of results) {
    const card = buildToolResultCard(result);
    if (card == null) continue;
    cards.push(card);
    if (cards.length >= MAX_TOOL_CARDS) break;
  }
  return cards;
}

function buildToolResultCard(toolResult: AgentToolResult): AgenticChatToolCard | null {
  if (BACKGROUND_TOOL_NAMES.has(toolResult.name)) return null;
  if (toolResult.error != null) return buildErrorCard(toolResult);
  if (DRAFT_TOOL_NAMES.has(toolResult.name)) return null;
  const result = asRecord(toolResult.result);
  if (result == null) return null;

  switch (toolResult.name) {
    case 'get_wallet_balance':
      return buildWalletBalanceCard(toolResult, result);
    case 'get_wallet_history':
      return buildWalletHistoryCard(toolResult, result);
    case 'get_umbra_balances':
      return buildUmbraBalanceCard(toolResult, result);
    case 'scan_umbra_claims':
      return buildUmbraClaimsCard(toolResult, result);
    case 'check_private_send_ready':
      return buildPrivateRoutesCard(toolResult, result);
    case 'list_wallet_tokens':
      return buildTokenListCard(toolResult, result, 'Wallet tokens');
    case 'get_sol_balance':
      return buildRowsCard(toolResult, 'SOL balance', [
        row('SOL', readString(result.sol) ?? '0'),
        row('Lamports', formatUnknown(result.lamports), 'default', true),
      ]);
    case 'analyze_wallet':
      return buildWalletReadinessCard(toolResult, result);
    case 'get_client_capabilities':
      return buildCapabilitiesCard(toolResult, result);
    case 'get_normal_transfer_fee':
      return buildFeeCard(toolResult, result);
    case 'get_swap_tokens':
      return buildTokenListCard(toolResult, result, 'Swap tokens');
    case 'get_swap_price':
      return buildSwapPriceCard(toolResult, result);
    case 'flash_get_markets':
      return buildFlashMarketsCard(toolResult, result);
    case 'flash_get_positions':
      return buildFlashPositionsCard(toolResult, result);
    case 'flash_get_prices':
      return buildFlashPricesCard(toolResult, result);
    case 'flash_get_orders':
      return buildFlashOrdersCard(toolResult, result);
    default:
      return buildGenericCard(toolResult, result);
  }
}

function buildErrorCard(toolResult: AgentToolResult): AgenticChatToolCard {
  return {
    id: `${toolResult.toolCallId}:error`,
    toolName: toolResult.name,
    title: titleForTool(toolResult.name),
    subtitle: 'Could not complete',
    tone: 'danger',
    rows: [row('Code', toolResult.error?.code ?? 'tool_failed', 'danger', true)],
  };
}

function buildWalletBalanceCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const tokens = arrayOfRecords(result.tokens);
  return {
    id: `${toolResult.toolCallId}:balance`,
    toolName: toolResult.name,
    title: 'Portfolio',
    subtitle: readString(result.portfolioValueUsdLabel) ?? 'Wallet balance',
    tone: result.valuationCoverage === 'partial' ? 'warning' : 'success',
    rows: [
      row('Network', readString(result.network) ?? 'Current'),
      row('SOL', readString(result.sol) ?? '0'),
      row('Assets', String(tokens.length)),
      row('Coverage', humanize(readString(result.valuationCoverage) ?? 'unknown')),
    ],
    items: tokens.slice(0, MAX_ITEMS_PER_CARD).map((token) => ({
      title: `${formatUnknown(token.balance)} ${formatUnknown(token.symbol)}`,
      detail: readString(token.name),
      tone: token.spam === true ? 'warning' : 'default',
    })),
    footer: result.truncated === true ? 'More assets hidden from this summary.' : null,
  };
}

function buildWalletHistoryCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const transactions = arrayOfRecords(result.transactions);
  const count = readNumber(result.count) ?? transactions.length;
  return {
    id: `${toolResult.toolCallId}:history`,
    toolName: toolResult.name,
    title: 'Recent activity',
    subtitle:
      count === 0 ? 'No recent activity' : `${count} recent ${count === 1 ? 'item' : 'items'}`,
    tone: count === 0 ? 'default' : 'success',
    items: transactions.slice(0, MAX_ITEMS_PER_CARD).map((transaction) => {
      const amount = readString(transaction.amount);
      const token = readString(transaction.tokenSymbol);
      const type = humanize(readString(transaction.type) ?? 'transaction');
      return {
        title: amount != null && token != null ? `${type} ${amount} ${token}` : type,
        detail: humanize(readString(transaction.status) ?? 'unknown'),
        tone: readString(transaction.status) === 'failed' ? 'danger' : 'default',
      };
    }),
    rows: [row('Source', humanize(readString(result.source) ?? 'local'))],
    footer: result.hasMore === true ? 'More activity is available in History.' : null,
  };
}

function buildUmbraBalanceCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const balances = arrayOfRecords(result.balances);
  return {
    id: `${toolResult.toolCallId}:umbra-balance`,
    toolName: toolResult.name,
    title: 'Umbra vault',
    subtitle: result.vaultRegistered === true ? 'Vault ready' : 'Vault status',
    tone: result.vaultRegistered === true ? 'success' : 'warning',
    rows: [
      row('Network', readString(result.network) ?? 'Current'),
      row(
        'Vault',
        result.vaultRegistered === true
          ? 'Registered'
          : humanize(readString(result.vaultState) ?? 'Unknown'),
      ),
      row('Shielding', result.vaultCanShield === true ? 'Ready' : 'Check setup'),
    ],
    items: balances.slice(0, MAX_ITEMS_PER_CARD).map((balance) => ({
      title: `${formatUnknown(balance.displayBalance ?? '0')} ${formatUnknown(balance.symbol)}`,
      detail: humanize(readString(balance.state) ?? 'unknown'),
      tone:
        balance.displayBalance == null && balance.state !== 'non_existent' ? 'warning' : 'default',
    })),
    footer: result.truncated === true ? 'More Umbra tokens hidden from this summary.' : null,
  };
}

function buildUmbraClaimsCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const pending = readNumber(result.pendingClaimCount) ?? 0;
  return {
    id: `${toolResult.toolCallId}:umbra-claims`,
    toolName: toolResult.name,
    title: 'Umbra claims',
    subtitle: pending === 0 ? 'No pending claims' : `${pending} pending`,
    tone: pending > 0 ? 'warning' : 'success',
    rows: [
      row('Pending', String(pending), pending > 0 ? 'warning' : 'success'),
      row('UTXOs', String(readNumber(result.pendingClaimUtxoCount) ?? 0)),
      row('Claims', humanize(readString(result.claimExecution) ?? 'manual only')),
      row('Vault', result.vaultRegistered === true ? 'Registered' : 'Not registered'),
    ],
  };
}

function buildPrivateRoutesCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const routes = asRecord(result.routes) ?? {};
  const supported = asRecord(result.supportedTokens) ?? {};
  return {
    id: `${toolResult.toolCallId}:private-routes`,
    toolName: toolResult.name,
    title: 'Private routes',
    subtitle: result.ready === true ? 'Ready' : 'Unavailable',
    tone: result.ready === true ? 'success' : 'warning',
    rows: [
      row(
        'MagicBlock',
        routes.magicblock === true ? 'Ready' : 'Unavailable',
        routes.magicblock === true ? 'success' : 'warning',
      ),
      row(
        'Umbra',
        routes.umbra === true ? 'Ready' : 'Unavailable',
        routes.umbra === true ? 'success' : 'warning',
      ),
      row('Network', readString(result.network) ?? 'Unknown'),
    ],
    items: buildSupportedTokenItems(supported),
  };
}

function buildTokenListCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
  title: string,
): AgenticChatToolCard {
  const tokens = arrayOfRecords(result.tokens);
  return {
    id: `${toolResult.toolCallId}:tokens`,
    toolName: toolResult.name,
    title,
    subtitle: tokens.length === 0 ? 'No tokens found' : `${tokens.length} shown`,
    tone: tokens.length === 0 ? 'default' : 'success',
    items: tokens.slice(0, MAX_ITEMS_PER_CARD).map((token) => ({
      title:
        token.balance != null
          ? `${formatUnknown(token.balance)} ${formatUnknown(token.symbol)}`
          : formatUnknown(token.symbol),
      detail: readString(token.name),
      tone: token.spam === true ? 'warning' : 'default',
    })),
    footer: result.truncated === true ? 'More tokens are available.' : null,
  };
}

function buildWalletReadinessCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const details = arrayOfRecords(result.details);
  const warnings = details.filter((detail) => readString(detail.severity) !== 'info');
  return {
    id: `${toolResult.toolCallId}:readiness`,
    toolName: toolResult.name,
    title: 'Wallet readiness',
    subtitle: warnings.length === 0 ? 'No warnings' : `${warnings.length} warnings`,
    tone: warnings.length === 0 ? 'success' : 'warning',
    items: details.slice(0, MAX_ITEMS_PER_CARD).map((detail) => ({
      title: humanize(readString(detail.id) ?? 'readiness'),
      detail: humanize(readString(detail.severity) ?? 'info'),
      tone: severityTone(readString(detail.severity)),
    })),
  };
}

function buildCapabilitiesCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const features = asRecord(result.features) ?? {};
  const rows = Object.entries(features)
    .slice(0, MAX_ROWS_PER_CARD)
    .map(([key, value]) => {
      const feature = asRecord(value) ?? {};
      const available = feature.available === true;
      return row(
        FEATURE_LABELS[key] ?? humanize(key),
        available ? 'Ready' : 'Unavailable',
        available ? 'success' : 'warning',
      );
    });
  return {
    id: `${toolResult.toolCallId}:capabilities`,
    toolName: toolResult.name,
    title: 'Available tools',
    subtitle: readString(result.network) ?? 'Current network',
    tone: 'success',
    rows,
    footer: Object.keys(features).length > rows.length ? 'More capabilities are available.' : null,
  };
}

function buildFeeCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  return buildRowsCard(toolResult, 'Transfer fee', [
    row('Route', humanize(readString(result.route) ?? 'normal')),
    row('Fee', readString(result.sol) != null ? `${readString(result.sol)} SOL` : 'Unavailable'),
    row('Lamports', formatUnknown(result.lamports), 'default', true),
  ]);
}

function buildSwapPriceCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  return buildRowsCard(toolResult, 'Token price', [
    row('Token', readString(result.symbol) ?? readString(result.name) ?? 'Token'),
    row(
      'Price',
      readNumber(result.price) == null
        ? 'Unavailable'
        : formatCurrency(readNumber(result.price) ?? 0, readString(result.currency) ?? 'USD'),
    ),
    row('Currency', readString(result.currency) ?? 'USD'),
  ]);
}

function buildFlashMarketsCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const markets = arrayOfRecords(result.markets);
  return {
    id: `${toolResult.toolCallId}:flash-markets`,
    toolName: toolResult.name,
    title: 'Flash markets',
    subtitle: `${readNumber(result.active) ?? markets.length} active`,
    tone: markets.length > 0 ? 'success' : 'default',
    items: markets.slice(0, MAX_ITEMS_PER_CARD).map((market) => ({
      title: formatUnknown(market.symbol),
      detail: `${formatUnknown(market.minLeverage)}-${formatUnknown(market.maxLeverage)}x leverage`,
    })),
  };
}

function buildFlashPositionsCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const positions = arrayOfRecords(result.positions);
  return {
    id: `${toolResult.toolCallId}:flash-positions`,
    toolName: toolResult.name,
    title: 'Flash positions',
    subtitle: positions.length === 0 ? 'No open positions' : `${positions.length} open`,
    tone: positions.length === 0 ? 'default' : 'success',
    items: positions.slice(0, MAX_ITEMS_PER_CARD).map((position) => ({
      title: `${humanize(readString(position.side) ?? 'position')} ${formatUnknown(position.marketSymbol)} ${formatUnknown(position.leverage)}x`,
      detail: `Size ${formatMoney(position.sizeUsd)} | PnL ${formatMoney(position.unrealizedPnlUsd)}`,
      tone: (readNumber(position.unrealizedPnlUsd) ?? 0) < 0 ? 'warning' : 'success',
    })),
  };
}

function buildFlashPricesCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const prices = arrayOfRecords(result.prices);
  return {
    id: `${toolResult.toolCallId}:flash-prices`,
    toolName: toolResult.name,
    title: 'Flash prices',
    subtitle: readString(result.warning) ?? `${prices.length} markets`,
    tone: readString(result.status) === 'stale_warning' ? 'warning' : 'success',
    items: prices.slice(0, MAX_ITEMS_PER_CARD).map((price) => ({
      title: `${formatUnknown(price.symbol)} ${formatMoney(price.price)}`,
      detail: price.isStale === true ? 'Stale price' : 'Fresh',
      tone: price.isStale === true ? 'warning' : 'default',
    })),
  };
}

function buildFlashOrdersCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard {
  const orders = arrayOfRecords(result.orders);
  return {
    id: `${toolResult.toolCallId}:flash-orders`,
    toolName: toolResult.name,
    title: 'Flash orders',
    subtitle: orders.length === 0 ? 'No open orders' : `${orders.length} open`,
    tone: orders.length === 0 ? 'default' : 'success',
    items: orders.slice(0, MAX_ITEMS_PER_CARD).map((order) => ({
      title: `${humanize(readString(order.orderType) ?? 'order')} ${formatUnknown(order.marketSymbol)}`,
      detail: `Trigger ${formatMoney(order.triggerPrice)} | Size ${formatMoney(order.sizeUsd)}`,
    })),
  };
}

function buildRowsCard(
  toolResult: AgentToolResult,
  title: string,
  rows: AgenticToolCardRow[],
): AgenticChatToolCard {
  return {
    id: `${toolResult.toolCallId}:${toolResult.name}`,
    toolName: toolResult.name,
    title,
    tone: 'success',
    rows,
  };
}

function buildGenericCard(
  toolResult: AgentToolResult,
  result: Record<string, unknown>,
): AgenticChatToolCard | null {
  const scalarRows = Object.entries(result)
    .filter(([, value]) => isScalar(value))
    .slice(0, MAX_ROWS_PER_CARD)
    .map(([key, value]) => row(humanize(key), formatUnknown(value)));
  const listEntry = Object.entries(result).find(([, value]) => Array.isArray(value));
  const items = Array.isArray(listEntry?.[1])
    ? listEntry[1]
        .slice(0, MAX_ITEMS_PER_CARD)
        .map(genericItem)
        .filter((item): item is AgenticToolCardItem => item != null)
    : [];
  if (scalarRows.length === 0 && items.length === 0) return null;
  return {
    id: `${toolResult.toolCallId}:generic`,
    toolName: toolResult.name,
    title: titleForTool(toolResult.name),
    subtitle: readString(result.status) != null ? humanize(readString(result.status) ?? '') : null,
    tone: statusTone(readString(result.status)),
    rows: scalarRows,
    items,
  };
}

function genericItem(value: unknown): AgenticToolCardItem | null {
  if (!isRecord(value)) return null;
  const title =
    readString(value.title) ??
    readString(value.symbol) ??
    readString(value.marketSymbol) ??
    readString(value.name) ??
    readString(value.type) ??
    readString(value.status);
  if (title == null) return null;
  const detail =
    readString(value.detail) ??
    readString(value.status) ??
    readString(value.side) ??
    readString(value.orderType) ??
    null;
  return {
    title,
    detail: detail === title ? null : detail,
    tone: statusTone(readString(value.status)),
  };
}

function buildSupportedTokenItems(supported: Record<string, unknown>): AgenticToolCardItem[] {
  const items: AgenticToolCardItem[] = [];
  const magicblock = Array.isArray(supported.magicblock) ? supported.magicblock : [];
  if (magicblock.length > 0) {
    items.push({
      title: 'MagicBlock tokens',
      detail: magicblock.map(formatUnknown).join(', '),
    });
  }
  const umbra = Array.isArray(supported.umbra) ? supported.umbra : [];
  if (umbra.length > 0) {
    items.push({
      title: 'Umbra tokens',
      detail: umbra
        .map((entry) => {
          const record = asRecord(entry);
          return record == null ? formatUnknown(entry) : formatUnknown(record.symbol);
        })
        .join(', '),
    });
  }
  return items;
}

function titleForTool(name: string): string {
  return TOOL_TITLES[name] ?? humanize(name);
}

function row(
  label: string,
  value: string,
  tone: AgenticToolCardTone = 'default',
  mono = false,
): AgenticToolCardRow {
  return { label, value, tone, mono };
}

function severityTone(value: string | null | undefined): AgenticToolCardTone {
  if (value === 'danger' || value === 'error') return 'danger';
  if (value === 'warning') return 'warning';
  if (value === 'success') return 'success';
  return 'default';
}

function statusTone(value: string | null | undefined): AgenticToolCardTone {
  if (value === 'ok') return 'success';
  if (value === 'stale_warning' || value === 'loading') return 'warning';
  if (value === 'failed' || value === 'error') return 'danger';
  return 'default';
}

function formatMoney(value: unknown): string {
  const number = readNumber(value);
  if (number == null) return '--';
  return formatCurrency(number, 'USD');
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: value >= 1 ? 2 : 6,
    }).format(value);
  } catch {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}`;
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value == null) return '--';
  return String(value);
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isScalar(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value == null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
