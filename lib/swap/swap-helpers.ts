/**
 * Pure helpers and constants used by the swap screen.
 *
 * Extraction goal:
 *   `app/(tabs)/swap.tsx` had ~500 lines of stateless helpers, format
 *   utilities, error classifiers, and constants mixed in with the
 *   screen's hooks, effects, and JSX. Moving them here lets the screen
 *   file focus on orchestration and render, and makes each helper
 *   easy to test in isolation if we ever add unit coverage.
 *
 * Scope:
 *   This file contains ONLY pure functions (no React, no hooks, no
 *   side effects) and the constants those functions and the screen
 *   share. Any component, hook, or function that touches React state
 *   stays in `swap.tsx` for now.
 */
import { OffpayApiError } from '@/lib/api/offpay-api-client';
import {
  formatLamportsAsSol,
  formatTokenBalance,
} from '@/lib/api/offpay-wallet-data';
import {
  decimalInputToAtomicAmount,
  formatAtomicAmount,
} from '@/lib/policy/token-amounts';

import type { SwapTokenOption } from '@/types/swap';
import type {
  CapabilityStatus,
  SwapQuoteResponse,
  SwapTokensResponse,
  WalletBalanceResponse,
} from '@/types/offpay-api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const QUOTE_DEBOUNCE_MS = 120;
export const SLIPPAGE_BPS = 50;
export const SLIPPAGE_TOLERANCE_LABEL = `${SLIPPAGE_BPS / 100}%`;
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const NETWORK_FEE_BUFFER_LAMPORTS = BigInt(5000);
export const TOKEN_ACCOUNT_RENT_BUFFER_LAMPORTS = BigInt(2_100_000);
export const SWAP_CONTENT_MAX_WIDTH = 430;
export const PRIVATE_SWAP_PROVIDER_LABEL = 'Jupiter + MagicBlock';

export const OFFLINE_SWAP_CAPABILITY: CapabilityStatus = {
  available: false,
  reason: 'temporarily_unavailable',
  message: 'Swap is online-only. Switch back online to quote and submit swaps.',
};

export const FALLBACK_SWAP_TOKENS: SwapTokenOption[] = [
  {
    symbol: 'SOL',
    name: 'Solana',
    mint: null,
    decimals: 9,
    logo: null,
    balanceValue: '0',
    balanceDisplay: '0.00',
    verified: false,
  },
  {
    symbol: 'USDC',
    name: 'USDC',
    mint: null,
    decimals: 6,
    logo: null,
    balanceValue: '0',
    balanceDisplay: '0.00',
    verified: false,
  },
];

// ---------------------------------------------------------------------------
// Local types co-located here so helpers don't need to import from the screen
// ---------------------------------------------------------------------------

/**
 * Action button feedback model used by the swap screen's "Slide to
 * review/refresh" button. Co-located with the helpers because two
 * pure helpers (`getLocalSwapFundingBlocker`,
 * `getLocalPrivateSwapFundingBlocker`) return this shape.
 */
export interface SwapButtonFeedback {
  label: string;
  tone: 'default' | 'danger';
  disabled: boolean;
}

// ---------------------------------------------------------------------------
// Tone / capability helpers
// ---------------------------------------------------------------------------

export function getSwapToastVariant(tone: SwapButtonFeedback['tone']): 'info' | 'warning' {
  return tone === 'danger' ? 'warning' : 'info';
}

export function capabilityWithLaunchError(
  fallback: CapabilityStatus,
  hasCapabilityError: boolean,
  errorMessage: string,
): CapabilityStatus {
  if (!hasCapabilityError) return fallback;

  return {
    available: false,
    reason: 'temporarily_unavailable',
    message: errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Token model helpers
// ---------------------------------------------------------------------------

export function buildSwapTokenOption(params: {
  apiToken: SwapTokensResponse['tokens'][number];
  balance: WalletBalanceResponse | undefined;
}): SwapTokenOption {
  const isNativeSol =
    params.apiToken.mint === NATIVE_SOL_MINT ||
    params.apiToken.symbol.trim().toUpperCase() === 'SOL';
  const walletToken =
    params.balance?.tokens.find((token) => !token.spam && token.mint === params.apiToken.mint) ??
    null;

  if (isNativeSol) {
    return {
      symbol: params.apiToken.symbol,
      name: params.apiToken.name,
      mint: params.apiToken.mint,
      decimals: params.apiToken.decimals,
      logo: params.apiToken.logo,
      balanceValue:
        params.balance != null ? formatAtomicAmount(String(params.balance.solBalance), 9, 9) : '0',
      balanceDisplay:
        params.balance != null ? formatLamportsAsSol(params.balance.solBalance) : '0.00',
      verified: params.apiToken.verified,
    };
  }

  return {
    symbol: params.apiToken.symbol,
    name: params.apiToken.name,
    mint: params.apiToken.mint,
    decimals: params.apiToken.decimals,
    logo: params.apiToken.logo ?? walletToken?.logo ?? null,
    balanceValue: walletToken?.balance ?? '0',
    balanceDisplay: walletToken != null ? formatTokenBalance(walletToken.balance) : '0.00',
    verified: params.apiToken.verified,
  };
}

export function findPreferredToken(
  tokens: SwapTokenOption[],
  symbols: string[],
  excludedMint?: string | null,
): SwapTokenOption | undefined {
  const symbolSet = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  return tokens.find(
    (token) => token.mint !== excludedMint && symbolSet.has(token.symbol.trim().toUpperCase()),
  );
}

export function getSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

export function findRouteToken(
  tokens: SwapTokenOption[],
  mint: string | null,
  symbol: string | null,
): SwapTokenOption | null {
  const normalizedSymbol = symbol?.trim().toUpperCase() ?? null;

  return (
    tokens.find((token) => {
      if (mint != null && token.mint === mint) return true;
      if (normalizedSymbol == null) return false;
      return token.symbol.trim().toUpperCase() === normalizedSymbol;
    }) ?? null
  );
}

export function isNativeSolToken(token: SwapTokenOption): boolean {
  return token.mint === NATIVE_SOL_MINT || token.symbol.trim().toUpperCase() === 'SOL';
}

export function walletHasTokenAccount(
  balance: WalletBalanceResponse | undefined,
  token: SwapTokenOption,
): boolean {
  if (isNativeSolToken(token)) return true;
  if (token.mint == null) return false;

  return (
    balance?.tokens.some((walletToken) => !walletToken.spam && walletToken.mint === token.mint) ??
    false
  );
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function formatRateLabel(params: {
  payAmount: string;
  receiveAmount: string;
  payToken: SwapTokenOption;
  receiveToken: SwapTokenOption;
  payPrice: number | null;
  receivePrice: number | null;
}): string {
  const payAmountNumber = Number.parseFloat(params.payAmount);
  const receiveAmountNumber = Number.parseFloat(params.receiveAmount);

  if (
    Number.isFinite(payAmountNumber) &&
    payAmountNumber > 0 &&
    Number.isFinite(receiveAmountNumber) &&
    receiveAmountNumber > 0
  ) {
    return `1 ${params.payToken.symbol} ≈ ${formatTokenBalance(
      String(receiveAmountNumber / payAmountNumber),
    )} ${params.receiveToken.symbol}`;
  }

  if (
    params.payPrice != null &&
    params.receivePrice != null &&
    Number.isFinite(params.payPrice) &&
    Number.isFinite(params.receivePrice) &&
    params.receivePrice > 0
  ) {
    return `1 ${params.payToken.symbol} ≈ ${formatTokenBalance(
      String(params.payPrice / params.receivePrice),
    )} ${params.receiveToken.symbol}`;
  }

  return 'Enter an amount to fetch a quote';
}

export function formatPriceImpactLabel(value: unknown): string {
  if (value == null) return '—';

  const impact =
    typeof value === 'number' ? value : Number.parseFloat(String(value).replace('%', '').trim());

  if (!Number.isFinite(impact)) return `${String(value)}%`;

  return `${impact.toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(impact) >= 1 ? 2 : 4,
    minimumFractionDigits: 0,
  })}%`;
}

export function formatSlippagePercent(value: number): string {
  return `${(value / 100).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}%`;
}

export function formatQuoteSlippageLabel(quote: SwapQuoteResponse | null): string {
  const slippageBps =
    quote?.slippageBps != null && Number.isFinite(quote.slippageBps) ? quote.slippageBps : null;
  const percentLabel =
    slippageBps == null ? SLIPPAGE_TOLERANCE_LABEL : formatSlippagePercent(slippageBps);
  const modeLabel = quote?.slippageMode === 'manual' ? 'Manual' : 'Auto';

  return `${modeLabel} · ${percentLabel} tolerance`;
}

// ---------------------------------------------------------------------------
// Amount / balance helpers
// ---------------------------------------------------------------------------

export function parseAtomicAmount(value: string | null | undefined): bigint | null {
  if (value == null) return null;

  const normalized = value.replace(/[^\d]/g, '');
  if (normalized.length === 0) return null;

  return BigInt(normalized);
}

export function getTokenAtomicBalance(token: SwapTokenOption): bigint | null {
  if (token.decimals == null) return null;

  return parseAtomicAmount(decimalInputToAtomicAmount(token.balanceValue || '0', token.decimals));
}

// ---------------------------------------------------------------------------
// Funding-blocker helpers (local pre-quote checks before the API call)
// ---------------------------------------------------------------------------

export function getLocalSwapFundingBlocker(params: {
  amountAtomic: string | null;
  payToken: SwapTokenOption;
  receiveToken: SwapTokenOption;
  balance: WalletBalanceResponse | undefined;
}): SwapButtonFeedback | null {
  const inputAtomic = parseAtomicAmount(params.amountAtomic);
  if (inputAtomic == null || inputAtomic === BigInt(0)) return null;
  if (params.balance == null) return null;

  const payBalanceAtomic = getTokenAtomicBalance(params.payToken);
  if (payBalanceAtomic == null) {
    return { label: 'Unable to verify amount', tone: 'danger', disabled: true };
  }
  if (payBalanceAtomic < inputAtomic) {
    return {
      label: `Insufficient ${params.payToken.symbol}`,
      tone: 'danger',
      disabled: true,
    };
  }

  const solBalanceAtomic = BigInt(Math.max(0, Math.trunc(params.balance.solBalance)));
  const paysWithSol = isNativeSolToken(params.payToken);
  const needsReceiveTokenAccount = !walletHasTokenAccount(params.balance, params.receiveToken);
  const requiredSolForFees =
    (paysWithSol ? inputAtomic : BigInt(0)) +
    NETWORK_FEE_BUFFER_LAMPORTS +
    (needsReceiveTokenAccount ? TOKEN_ACCOUNT_RENT_BUFFER_LAMPORTS : BigInt(0));

  if (solBalanceAtomic < requiredSolForFees) {
    return {
      label: needsReceiveTokenAccount
        ? 'Insufficient SOL for setup fee'
        : 'Insufficient SOL for network fee',
      tone: 'danger',
      disabled: true,
    };
  }

  return null;
}

export function getLocalPrivateSwapFundingBlocker(params: {
  amountAtomic: string | null;
  payToken: SwapTokenOption;
  balance: WalletBalanceResponse | undefined;
}): SwapButtonFeedback | null {
  const inputAtomic = parseAtomicAmount(params.amountAtomic);
  if (inputAtomic == null || inputAtomic === BigInt(0)) return null;
  if (params.balance == null) return null;

  const payBalanceAtomic = getTokenAtomicBalance(params.payToken);
  if (payBalanceAtomic == null) {
    return { label: 'Unable to verify amount', tone: 'danger', disabled: true };
  }
  if (payBalanceAtomic < inputAtomic) {
    return {
      label: `Insufficient ${params.payToken.symbol}`,
      tone: 'danger',
      disabled: true,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Error classifiers
// ---------------------------------------------------------------------------

export function getConciseSwapErrorLabel(error: unknown): string {
  if (error instanceof OffpayApiError && error.code === 'QUOTE_EXPIRED') {
    return 'Quote expired. Slide to refresh';
  }

  const message = error instanceof Error ? error.message : 'Unable to execute swap.';
  if (/minimum.*\$?\d+.*gasless/i.test(message)) {
    return 'Swap amount is below provider minimum';
  }
  if (
    error instanceof OffpayApiError &&
    error.code === 'INVALID_REQUEST' &&
    /failed to get quotes|no route|route not found|unable to build/i.test(message)
  ) {
    return 'No executable route for this swap';
  }
  if (/insufficient.*(fee|sol)|network fee|rent|gas/i.test(message)) {
    return 'Insufficient SOL for network fee';
  }
  if (/insufficient|custom program error:\s*0x1|attempt to debit/i.test(message)) {
    return 'Insufficient funds';
  }

  return message;
}

export function getExactSwapErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to execute swap.';
}

export function isRetryableSwapQuoteError(error: unknown): boolean {
  if (error instanceof OffpayApiError) {
    if (error.retryable) return true;
    if (error.status === 408 || error.status === 409 || error.status === 429) return true;
    if (error.status >= 500) return true;
    if (error.status >= 400 && error.status < 500) return false;

    return /failed to get quotes|temporarily|timeout|unavailable|rate/i.test(error.message);
  }

  return error instanceof Error && /network|timeout|failed to fetch/i.test(error.message);
}

export function getSwapQuoteRetryDelay(failureAttempt: number, error: unknown): number {
  if (error instanceof OffpayApiError && error.retryAfterMs > 0) {
    return Math.min(error.retryAfterMs, 4000);
  }

  return Math.min(4000, 650 * 2 ** Math.max(0, failureAttempt - 1));
}

export function shouldRefreshSwapExecution(error: unknown): boolean {
  if (!(error instanceof OffpayApiError)) return false;
  if (error.code === 'QUOTE_EXPIRED') return true;

  return (
    error.code === 'INVALID_REQUEST' && /unavailable|expired|stale|order|quote/i.test(error.message)
  );
}

export function isRefreshableSwapActionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  if (/slippage|tolerance exceeded|price moved|price impact/i.test(message)) return true;
  if (!(error instanceof OffpayApiError)) return false;

  return (
    error.code === 'QUOTE_EXPIRED' ||
    (error.code === 'INVALID_REQUEST' &&
      /unavailable|expired|stale|order|quote/i.test(error.message))
  );
}
