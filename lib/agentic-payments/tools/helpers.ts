import { OffpayApiError } from '@/lib/api/offpay-api-client';
import {
  hydrateAgenticRedaction,
  type AgenticPrivacyRedaction,
} from '@/lib/agentic-payments/privacy-firewall';
import {
  decimalInputToAtomicAmount,
  formatAtomicAmount,
  sanitizeDecimalInput,
} from '@/lib/policy/token-amounts';

import type { AgentToolCall, AgentToolSchema } from '@/lib/agentic-payments/types';
import type { AgenticTransferRoute } from '@/lib/agentic-payments/tools/types';
import type { OffpayNetwork, SwapTokensResponse, WalletBalanceResponse } from '@/types/offpay-api';

export const EMPTY_PARAMS = {
  type: 'object',
  properties: {},
} satisfies AgentToolSchema['parameters'];

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const NATIVE_SOL_SENTINEL_MINT = 'native-sol';

export function readStringArg(call: AgentToolCall, key: string): string | null {
  const args = call.args as Record<string, unknown> | undefined;
  const value = args?.[key];
  return typeof value === 'string' ? value.trim() : null;
}

export function readNumberArg(call: AgentToolCall, key: string): number | null {
  const args = call.args as Record<string, unknown> | undefined;
  const value = args?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hydrateStringArg(
  call: AgentToolCall,
  key: string,
  redactions: readonly AgenticPrivacyRedaction[],
): string {
  return hydrateAgenticRedaction(readStringArg(call, key) ?? '', redactions);
}

export function isNetworkReady(params: {
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
}): boolean {
  return params.walletMode === 'online' && params.canUseNetwork;
}

export function requireWalletAndNetwork(params: {
  walletAddress: string | null;
  network: OffpayNetwork | null;
}): { ok: true; walletAddress: string; network: OffpayNetwork } | { ok: false; code: string } {
  if (params.walletAddress == null) return { ok: false, code: 'wallet_not_connected' };
  if (params.network == null) return { ok: false, code: 'network_not_selected' };
  return { ok: true, walletAddress: params.walletAddress, network: params.network };
}

export function errorCodeFromUnknown(error: unknown, fallback = 'tool_failed'): string {
  if (error instanceof OffpayApiError) {
    if (error.status === 0) return 'network_unavailable';
    if (error.code === 'UPSTREAM_UNAVAILABLE') return 'network_unavailable';
    if (error.code === 'INVALID_REQUEST') return 'invalid_request';
    if (error.code === 'RATE_LIMITED') return 'rate_limited';
    return error.code.toLowerCase();
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes('local signing wallet') ||
      lower.includes('privy wallets keep the signing key')
    ) {
      return 'wallet_cannot_sign';
    }
    if (lower.includes('timed out')) return 'request_timeout';
    if (lower.includes('offline mode')) return 'network_unavailable';
    if (lower.includes('wallet')) return 'wallet_unavailable';
    if (lower.includes('unsupported')) return 'feature_unavailable';
  }

  return fallback;
}

export function validatorErrorCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('connect a wallet')) return 'wallet_not_connected';
  if (lower.includes('select a supported network')) return 'network_not_selected';
  if (lower.includes('mentions ')) return 'network_mismatch';
  if (lower.includes('online wallet mode')) return 'requires_online_mode';
  if (lower.includes('capability checks')) return 'capabilities_loading';
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

export function normalizeRecipientArg(
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

export function isSelfRecipientArg(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  return (
    lower === 'self' || lower === 'own_wallet' || lower === 'my_wallet' || lower === '[self_wallet]'
  );
}

export function readTransferRouteArg(
  call: AgentToolCall,
  defaultRoute: AgenticTransferRoute,
): AgenticTransferRoute {
  const raw = readStringArg(call, 'route')?.toLowerCase();
  if (raw === 'normal' || raw === 'magicblock' || raw === 'umbra') return raw;
  if (raw === 'auto') {
    const toolName = call.name.toLowerCase();
    if (toolName.includes('private')) return 'magicblock';
    return defaultRoute;
  }
  return defaultRoute;
}

export function isNativeSolMint(mint: string): boolean {
  const normalized = mint.trim();
  return (
    normalized === NATIVE_SOL_MINT ||
    normalized === NATIVE_SOL_SENTINEL_MINT ||
    normalized.toUpperCase() === 'SOL'
  );
}

export function buildTokenBalanceRaw(params: {
  balance: WalletBalanceResponse | null | undefined;
  mint: string;
  decimals: number;
}): string | null {
  if (params.balance == null) return null;
  if (isNativeSolMint(params.mint)) return String(params.balance.solBalance);
  const token = params.balance.tokens.find((entry) => entry.mint === params.mint);
  if (token == null) return null;
  return decimalInputToAtomicAmount(token.balance, params.decimals);
}

export function resolveSwapTokenReference(params: {
  tokens: SwapTokensResponse['tokens'];
  value: string;
}): { ok: true; token: SwapTokensResponse['tokens'][number] } | { ok: false; code: string } {
  const requested = params.value.trim();
  if (requested.length === 0) return { ok: false, code: 'token_missing' };

  const mintMatch = params.tokens.find((token) => token.mint === requested);
  if (mintMatch != null) return { ok: true, token: mintMatch };

  const normalized = normalizeTokenReference(requested);
  const matches = params.tokens.filter((token) => {
    return (
      normalizeTokenReference(token.symbol) === normalized ||
      normalizeTokenReference(token.name) === normalized
    );
  });
  if (matches.length === 1) return { ok: true, token: matches[0] };
  if (matches.length > 1) return { ok: false, code: 'token_ambiguous' };
  return { ok: false, code: 'token_unknown' };
}

export function normalizeTokenReference(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function parsePositiveAtomicAmount(params: {
  amount: string;
  decimals: number;
}): { ok: true; amount: string; rawAmount: string } | { ok: false; code: string } {
  const amount = sanitizeDecimalInput(params.amount, params.decimals);
  const rawAmount = decimalInputToAtomicAmount(amount, params.decimals);
  if (rawAmount == null || !/^\d+$/.test(rawAmount) || BigInt(rawAmount) <= 0n) {
    return { ok: false, code: 'amount_invalid' };
  }
  return { ok: true, amount, rawAmount };
}

export function rawAmountFitsBalance(rawAmount: string, balanceRaw: string | null): boolean {
  if (balanceRaw == null || !/^\d+$/.test(balanceRaw)) return false;
  return BigInt(rawAmount) <= BigInt(balanceRaw);
}

export function formatRawAmount(rawAmount: string, decimals: number): string {
  return formatAtomicAmount(rawAmount, decimals, 6);
}

export function readCappedInteger(params: {
  call: AgentToolCall;
  key: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  const value = readNumberArg(params.call, params.key);
  if (value == null) return params.fallback;
  return Math.max(params.min, Math.min(params.max, Math.trunc(value)));
}

export function isExplicitUmbraReadRequest(userText: string): boolean {
  const text = userText.trim();
  return (
    /\bumbra\b/i.test(text) ||
    /\b(private|encrypted|shielded|stealth)\s+balances?\b/i.test(text) ||
    /\b(vault|vaults)\b/i.test(text)
  );
}

export function isExplicitUmbraClaimScanRequest(userText: string): boolean {
  const text = userText.trim();
  return (
    (/\bumbra\b/i.test(text) && /\b(claim|claims)\b/i.test(text)) ||
    /\b(pending\s+claims?|claim\s+scan|scan\s+claims?|check\s+claims?)\b/i.test(text)
  );
}

export function isExplicitMagicBlockPrivateBalanceRequest(userText: string): boolean {
  const text = userText.trim();
  const hasMagicBlock = /\b(magic\s*block|magicblock)\b/i.test(text);
  const asksBalance = /\b(balance|balances|funds|holdings)\b/i.test(text);
  return (
    (hasMagicBlock && asksBalance) ||
    /\bprivate[-\s]*payment\s+balances?\b/i.test(text) ||
    /\bpayment\s+rail\s+balances?\b/i.test(text)
  );
}
