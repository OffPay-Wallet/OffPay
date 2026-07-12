import {
  type RwaSwapReviewScreenDetailRow,
  type RwaSwapReviewScreenPhase,
  type RwaSwapReviewScreenTokenLeg,
} from '@/components/features/rwa/RwaSwapReviewScreen';
import {
  formatRwaDevnetSandboxBalanceError,
  type RwaTradeSide,
} from '@/lib/rwa/rwa-trade-execution';

import type { OffpayNetwork, RwaAsset, RwaQuoteResponse } from '@/types/offpay-api';

export const RWA_CASH_AMOUNT_MAX_LENGTH = 48;
export const RWA_CASH_AMOUNT_DECIMALS = 12;
export const RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL = 'RWAUSDC';

const XSTOCKS_LOGO_BASE_URL = 'https://xstocks-metadata.backed.fi/logos/tokens';

export { formatRwaDevnetSandboxBalanceError };
export type { RwaTradeSide };

export const RWA_CATEGORY_LABELS: Record<RwaAsset['category'], string> = {
  equity: 'Equity',
  etf: 'ETF',
  treasury: 'Treasury',
  commodity: 'Commodity',
  unknown: 'RWA',
};

export interface ParsedRwaCashAmount {
  amount: string | null;
  message: string | null;
}

export interface RwaQuoteReviewState {
  asset: RwaAsset;
  side: RwaTradeSide;
  inputAmount: string;
  quote: RwaQuoteResponse;
  network: OffpayNetwork;
  walletAddress: string;
  walletId: string | null;
}

export interface RwaTradeDraftState {
  assetId: string;
  side: RwaTradeSide;
  amountInput: string;
}

export interface RwaProcessResultState {
  variant: Extract<RwaSwapReviewScreenPhase, 'success' | 'error'>;
  tokenLegs: RwaSwapReviewScreenTokenLeg[];
  detailRows: RwaSwapReviewScreenDetailRow[];
  repeatTradeDraft: RwaTradeDraftState;
}

interface WalletBalanceLike {
  tokens: {
    balance?: string | null;
    mint: string;
    spam?: boolean;
  }[];
}

export function formatUsd(value: number | null): string {
  if (value == null) return 'Price unavailable';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 10 ? 2 : 4,
  }).format(value);
}

export function formatRwaChangeLabel(change: number | null | undefined): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const normalized = Object.is(change, -0) ? 0 : change;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(normalized) >= 1 ? 2 : 3,
    minimumFractionDigits: 0,
  })}%`;
}

export function formatRwaAssetDisplayName(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'name' | 'symbol'>,
): string {
  if (!asset.devnetSandbox) return asset.name;
  const cleaned = asset.name
    .replace(/\s+Sandbox(?:\s+RWA)?$/i, '')
    .replace(/\s+RWA$/i, '')
    .trim();
  return cleaned.length > 0 ? cleaned : asset.symbol;
}

export function getRwaSettlementDisplaySymbol(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'settlementSymbol'>,
): string {
  return asset.devnetSandbox ? RWA_DEVNET_SETTLEMENT_DISPLAY_SYMBOL : asset.settlementSymbol;
}

function normalizeXStocksLogoBaseSymbol(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .replace(/[^A-Za-z0-9.]/g, '')
    .toUpperCase();
  return normalized != null && normalized.length > 0 ? normalized : null;
}

function getXStocksLogoUri(baseSymbol: string | null | undefined): string | null {
  const normalized = normalizeXStocksLogoBaseSymbol(baseSymbol);
  return normalized == null ? null : `${XSTOCKS_LOGO_BASE_URL}/${normalized}x.png`;
}

export function getRwaAssetLogoUri(
  asset: Pick<RwaAsset, 'devnetSandbox' | 'logo' | 'symbol' | 'underlyingSymbol'>,
): string | null {
  const explicitLogo = asset.logo?.trim();
  if (explicitLogo != null && explicitLogo.length > 0) return explicitLogo;

  if (asset.underlyingSymbol != null) return getXStocksLogoUri(asset.underlyingSymbol);
  if (!asset.devnetSandbox && /x$/i.test(asset.symbol)) {
    return getXStocksLogoUri(asset.symbol.replace(/x$/i, ''));
  }
  return null;
}

export function hasPositiveDecimalAmount(value: string | null | undefined): boolean {
  if (value == null || value.trim().length === 0) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function findWalletTokenBalance(
  balance: WalletBalanceLike | null | undefined,
  mint: string | null | undefined,
): string | null {
  if (balance == null || mint == null || mint.trim().length === 0) return null;
  const token = balance.tokens.find((entry) => !entry.spam && entry.mint === mint);
  return hasPositiveDecimalAmount(token?.balance) ? token!.balance! : null;
}

export function findWalletTokenHolding(
  balance: WalletBalanceLike | null | undefined,
  mint: string | null | undefined,
): string | null {
  if (balance == null || mint == null || mint.trim().length === 0) return null;
  const token = balance.tokens.find((entry) => !entry.spam && entry.mint === mint);
  return token?.balance ?? '0';
}

export function sanitizeTradeAmountInput(value: string): string {
  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const [whole = '', ...fractionParts] = normalized.split('.');
  const fraction = fractionParts.join('').slice(0, RWA_CASH_AMOUNT_DECIMALS);
  const candidate = fractionParts.length > 0 ? `${whole}.${fraction}` : whole;
  return candidate.slice(0, RWA_CASH_AMOUNT_MAX_LENGTH);
}

export function parseRwaTradeAmount(input: string, label: string): ParsedRwaCashAmount {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { amount: null, message: null };
  if (trimmed.length > RWA_CASH_AMOUNT_MAX_LENGTH) {
    return { amount: null, message: 'Amount is too long.' };
  }
  if (!/^\d+(?:\.\d{1,12})?$/.test(trimmed)) {
    return { amount: null, message: `Enter a positive ${label}.` };
  }

  const [whole, fraction] = trimmed.split('.');
  const nonZeroWhole = whole.replace(/^0+/, '');
  const hasNonZeroFraction = fraction != null && /[1-9]/.test(fraction);
  if (nonZeroWhole.length === 0 && !hasNonZeroFraction) {
    return { amount: null, message: `Enter a positive ${label}.` };
  }

  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  return {
    amount: fraction == null ? normalizedWhole : `${normalizedWhole}.${fraction}`,
    message: null,
  };
}

export function getRwaErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    if (/transaction simulation failed/i.test(error.message)) {
      const detail = error.message.replace(/^.*transaction simulation failed[:.]?\s*/i, '').trim();
      return detail.length > 0
        ? `RWA settlement failed: ${detail}`
        : 'RWA settlement simulation failed. Request a fresh quote and try again.';
    }

    return error.message;
  }
  return 'RWA swap failed.';
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
    minimumFractionDigits: 0,
  })}%`;
}

export function formatQuoteExpiry(expiresAt: number | null): string {
  if (expiresAt == null) return 'Provider managed';
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isRwaQuoteStale(quote: RwaQuoteResponse): boolean {
  return quote.expiresAt != null && quote.expiresAt <= Date.now() + 2500;
}

export function buildRwaReviewTokenLegs(review: RwaQuoteReviewState): {
  payLeg: RwaSwapReviewScreenTokenLeg;
  receiveLeg: RwaSwapReviewScreenTokenLeg;
} {
  const payAmount =
    review.side === 'buy'
      ? (review.quote.cashAmount ?? review.inputAmount)
      : (review.quote.quantity ?? review.inputAmount);
  const paySymbol =
    review.side === 'buy' ? getRwaSettlementDisplaySymbol(review.asset) : review.asset.symbol;
  const receiveAmount =
    review.side === 'buy' ? (review.quote.quantity ?? '—') : (review.quote.cashAmount ?? '—');
  const receiveSymbol =
    review.side === 'buy' ? review.asset.symbol : getRwaSettlementDisplaySymbol(review.asset);
  const assetName = formatRwaAssetDisplayName(review.asset);
  const assetLogo = getRwaAssetLogoUri(review.asset);

  return {
    payLeg: {
      label: 'You pay',
      amount: payAmount,
      symbol: paySymbol,
      name: review.side === 'buy' ? paySymbol : assetName,
      logo: review.side === 'buy' ? null : assetLogo,
    },
    receiveLeg: {
      label: 'You receive',
      amount: receiveAmount,
      symbol: receiveSymbol,
      name: review.side === 'buy' ? assetName : receiveSymbol,
      logo: review.side === 'buy' ? assetLogo : null,
    },
  };
}

export function buildRwaReviewDetailRows(
  review: RwaQuoteReviewState,
): RwaSwapReviewScreenDetailRow[] {
  return [
    { label: 'Impact', value: formatPercent(review.quote.priceImpactPct) },
    {
      label: 'Expires',
      value: formatQuoteExpiry(review.quote.expiresAt),
      expiresAt: review.quote.expiresAt,
    },
  ];
}

export function buildRwaProcessResult({
  review,
  variant,
  extraRows = [],
}: {
  review: RwaQuoteReviewState;
  variant: Extract<RwaSwapReviewScreenPhase, 'success' | 'error'>;
  extraRows?: RwaSwapReviewScreenDetailRow[];
}): RwaProcessResultState {
  const legs = buildRwaReviewTokenLegs(review);
  const paidLabel = variant === 'success' ? 'Paid' : 'You pay';
  const receivedLabel = variant === 'success' ? 'Received' : 'You receive';

  return {
    variant,
    repeatTradeDraft: {
      assetId: review.asset.id,
      side: review.side,
      amountInput: review.inputAmount,
    },
    tokenLegs: [
      { ...legs.payLeg, label: paidLabel },
      { ...legs.receiveLeg, label: receivedLabel },
    ],
    detailRows: [
      { label: 'Impact', value: formatPercent(review.quote.priceImpactPct) },
      ...extraRows,
    ],
  };
}
