import { createRwaQuote, getRwaAssets, getWalletTransactions } from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { offpayWalletTransactionsQueryKey } from '@/lib/api/offpay-wallet-query-keys';
import { getRwaDevnetSandboxFundingRequirement } from '@/lib/rwa/devnet-sandbox-funding';
import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';

import {
  errorCodeFromUnknown,
  EMPTY_PARAMS,
  hydrateStringArg,
  isNetworkReady,
  normalizeTokenReference,
  readCappedInteger,
  readStringArg,
  requireWalletAndNetwork,
} from './helpers';
import type { AgenticToolDefinition } from './types';

import type {
  OffpayNetwork,
  RwaAsset,
  RwaQuoteResponse,
  WalletBalanceResponse,
  WalletTransactionsResponse,
} from '@/types/offpay-api';

const DEFAULT_ASSET_LIMIT = 12;
const MAX_ASSET_LIMIT = 30;
const DEFAULT_HISTORY_LIMIT = 8;
const MAX_HISTORY_LIMIT = 20;
const RWA_SETTLEMENT_DISPLAY_SYMBOL = 'RWAUSDC';

type RwaTradeSide = 'buy' | 'sell';

interface TokenBalanceMatch {
  balance: string;
  decimals: number;
  symbol: string;
}

function getSettlementDisplaySymbol(asset: Pick<RwaAsset, 'devnetSandbox' | 'settlementSymbol'>) {
  return asset.devnetSandbox ? RWA_SETTLEMENT_DISPLAY_SYMBOL : asset.settlementSymbol;
}

function readRwaAssetArg(call: Parameters<AgenticToolDefinition['run']>[0]): string {
  for (const key of ['asset', 'ticker', 'symbol', 'stock', 'rwa', 'name', 'query']) {
    const value = readStringArg(call, key);
    if (value != null && value.length > 0) return value;
  }
  return '';
}

function readRwaSideArg(call: Parameters<AgenticToolDefinition['run']>[0]): RwaTradeSide | null {
  const value = readStringArg(call, 'side')?.toLowerCase();
  if (value === 'buy' || value === 'sell') return value;
  return null;
}

function readRwaAmountArg(call: Parameters<AgenticToolDefinition['run']>[0]): string {
  for (const key of ['amount', 'cashAmount', 'quantity', 'size']) {
    const value = readStringArg(call, key);
    if (value != null && value.length > 0) return value;
  }
  return '';
}

function normalizeAssetReference(value: string): string {
  return normalizeTokenReference(
    value.replace(
      /\b(?:a|an|the|tokenized|stock|stocks|share|shares|equity|etf|rwa|xstock|xstocks)\b/gi,
      ' ',
    ),
  );
}

function assetReferenceCandidates(asset: RwaAsset): string[] {
  return [
    asset.symbol,
    asset.underlyingSymbol,
    asset.name,
    asset.id,
    asset.symbol.replace(/d$/i, ''),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeAssetReference);
}

function resolveRwaAssetReference(params: {
  assets: readonly RwaAsset[];
  value: string;
}): { ok: true; asset: RwaAsset } | { ok: false; code: string } {
  const requested = params.value.trim();
  if (requested.length === 0) return { ok: false, code: 'rwa_asset_missing' };

  const mintOrIdMatch = params.assets.find(
    (asset) => asset.mint === requested || asset.id === requested,
  );
  if (mintOrIdMatch != null) return { ok: true, asset: mintOrIdMatch };

  const normalized = normalizeAssetReference(requested);
  const exactMatches = params.assets.filter((asset) =>
    assetReferenceCandidates(asset).includes(normalized),
  );
  if (exactMatches.length === 1) return { ok: true, asset: exactMatches[0] };
  if (exactMatches.length > 1) return { ok: false, code: 'rwa_asset_ambiguous' };

  const fuzzyMatches = params.assets.filter((asset) => {
    const haystack = normalizeAssetReference(
      [asset.symbol, asset.underlyingSymbol, asset.name].filter(Boolean).join(' '),
    );
    return haystack.includes(normalized);
  });
  if (fuzzyMatches.length === 1) return { ok: true, asset: fuzzyMatches[0] };
  if (fuzzyMatches.length > 1) return { ok: false, code: 'rwa_asset_ambiguous' };
  return { ok: false, code: 'rwa_asset_unknown' };
}

function parseRwaAmount(value: string): { ok: true; amount: string } | { ok: false; code: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, code: 'amount_missing' };
  if (/^(max|all)$/i.test(trimmed)) return { ok: true, amount: 'max' };

  const normalized = trimmed.replace(/[$,]/g, '').replace(/\s+/g, ' ').trim();
  const amountMatch = normalized.match(/^(\d+(?:\.\d{1,12})?)(?:\s*(?:RWAUSDC|USDC|USD))?$/i);
  if (amountMatch == null) {
    return { ok: false, code: 'amount_invalid' };
  }

  const [whole, fraction] = amountMatch[1].split('.');
  const hasNonZeroWhole = (whole ?? '').replace(/^0+/, '').length > 0;
  const hasNonZeroFraction = fraction != null && /[1-9]/.test(fraction);
  if (!hasNonZeroWhole && !hasNonZeroFraction) return { ok: false, code: 'amount_invalid' };

  const normalizedWhole = (whole ?? '0').replace(/^0+(?=\d)/, '') || '0';
  return {
    ok: true,
    amount: fraction == null ? normalizedWhole : `${normalizedWhole}.${fraction}`,
  };
}

function getTokenBalance(
  balance: WalletBalanceResponse | null | undefined,
  mint: string,
): TokenBalanceMatch | null {
  const token = balance?.tokens.find((entry) => entry.mint === mint && !entry.spam);
  if (token == null) return null;
  return {
    balance: token.balance,
    decimals: token.decimals,
    symbol: token.symbol,
  };
}

function decimalAmountFitsBalance(params: {
  amount: string;
  fallbackDecimals: number;
  token: TokenBalanceMatch | null;
}): boolean {
  const decimals = params.token?.decimals ?? params.fallbackDecimals;
  const amountRaw = decimalInputToAtomicAmount(params.amount, decimals);
  const balanceRaw =
    params.token == null ? null : decimalInputToAtomicAmount(params.token.balance, decimals);
  if (amountRaw == null || balanceRaw == null) return false;
  return BigInt(amountRaw) <= BigInt(balanceRaw);
}

function resolveMaxTradeAmount(params: {
  asset: RwaAsset;
  balance: WalletBalanceResponse | null | undefined;
  side: RwaTradeSide;
}): string | null {
  const mint = params.side === 'buy' ? params.asset.settlementMint : params.asset.mint;
  return getTokenBalance(params.balance, mint)?.balance ?? null;
}

function summarizeAsset(asset: RwaAsset, balance: WalletBalanceResponse | null | undefined) {
  const holding = getTokenBalance(balance, asset.mint);
  return {
    id: asset.id,
    symbol: asset.symbol,
    underlyingSymbol: asset.underlyingSymbol,
    name: asset.name,
    category: asset.category,
    devnetSandbox: asset.devnetSandbox,
    logo: asset.logo,
    priceUsd: asset.priceUsd,
    change24hPct: asset.change24hPct,
    tradable: asset.tradable,
    tradingHalted: asset.tradingHalted === true,
    multiplierTransitionActive: asset.multiplierTransitionActive === true,
    buyAvailable:
      asset.execution.buy === 'jupiter_swap' || asset.execution.buy === 'devnet_sandbox',
    sellAvailable:
      asset.execution.sell === 'jupiter_swap' || asset.execution.sell === 'devnet_sandbox',
    settlementSymbol: getSettlementDisplaySymbol(asset),
    holding: holding == null ? null : holding.balance,
  };
}

async function readRwaAssets(params: {
  network: OffpayNetwork;
  signal?: AbortSignal;
}): Promise<RwaAsset[]> {
  const response = await getRwaAssets(params.network, {
    signal: params.signal,
    requestOwner: 'agent.rwa.assets',
  });
  return response.assets;
}

function canReadRwa(params: Parameters<AgenticToolDefinition['run']>[1]): boolean {
  if (params.capabilities == null) return true;
  return isOffpayFeatureAvailable(params.capabilities, 'rwa.assets');
}

function canTradeRwa(params: Parameters<AgenticToolDefinition['run']>[1]): boolean {
  if (params.capabilities == null) return true;
  return (
    isOffpayFeatureAvailable(params.capabilities, 'rwa.assets') &&
    isOffpayFeatureAvailable(params.capabilities, 'rwa.quote') &&
    isOffpayFeatureAvailable(params.capabilities, 'rwa.execute')
  );
}

function isPositiveDecimal(value: string | null | undefined): boolean {
  if (value == null) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function buildRwaHoldings(params: {
  assets: readonly RwaAsset[];
  balance: WalletBalanceResponse | null | undefined;
}) {
  const settlementByMint = new Map<string, { symbol: string; balance: string }>();
  const holdings = [];

  for (const asset of params.assets) {
    const settlement = getTokenBalance(params.balance, asset.settlementMint);
    if (settlement != null && isPositiveDecimal(settlement.balance)) {
      settlementByMint.set(asset.settlementMint, {
        symbol: getSettlementDisplaySymbol(asset),
        balance: settlement.balance,
      });
    }

    const holding = getTokenBalance(params.balance, asset.mint);
    if (holding == null || !isPositiveDecimal(holding.balance)) continue;
    const numericBalance = Number(holding.balance);
    holdings.push({
      symbol: asset.symbol,
      underlyingSymbol: asset.underlyingSymbol,
      name: asset.name,
      category: asset.category,
      balance: holding.balance,
      priceUsd: asset.priceUsd,
      valueUsd:
        asset.priceUsd != null && Number.isFinite(numericBalance)
          ? Number((numericBalance * asset.priceUsd).toFixed(2))
          : null,
    });
  }

  return {
    settlement: [...settlementByMint.values()],
    holdings,
  };
}

function readCachedTransactions(
  context: Parameters<AgenticToolDefinition['run']>[1],
  limit: number,
): WalletTransactionsResponse | null {
  const walletAddress = context.scope.walletAddress;
  const network = context.scope.network;
  if (context.queryClient == null || walletAddress == null || network == null) return null;
  const cached = context.queryClient.getQueryData<{
    pages?: WalletTransactionsResponse[];
  }>(offpayWalletTransactionsQueryKey(walletAddress, network, limit));
  return cached?.pages?.[0] ?? null;
}

function summarizeRwaTransactions(params: {
  assets: readonly RwaAsset[];
  response: WalletTransactionsResponse;
  limit: number;
}) {
  const assetsByMint = new Map(params.assets.map((asset) => [asset.mint, asset] as const));
  const assetSymbols = new Set(
    params.assets.flatMap((asset) =>
      [asset.symbol, asset.underlyingSymbol].filter((value): value is string => value != null),
    ),
  );
  const settlementMints = new Set(params.assets.map((asset) => asset.settlementMint));
  const rows = [];

  for (const transaction of params.response.transactions) {
    const tokenMint = transaction.tokenMint ?? null;
    const tokenSymbol = transaction.tokenSymbol ?? null;
    const matchedAsset = tokenMint == null ? null : (assetsByMint.get(tokenMint) ?? null);
    const isAssetToken =
      matchedAsset != null || (tokenSymbol != null && assetSymbols.has(tokenSymbol));
    const isSettlementSwap =
      transaction.type === 'swap' && tokenMint != null && settlementMints.has(tokenMint);
    if (!isAssetToken && !isSettlementSwap) continue;

    rows.push({
      type: transaction.type,
      direction: transaction.direction ?? null,
      status: transaction.status === 'success' ? 'confirmed' : 'failed',
      timestamp: transaction.timestamp,
      amount: transaction.amount ?? null,
      tokenSymbol:
        matchedAsset?.symbol ??
        (tokenSymbol === 'USDC' && isSettlementSwap ? RWA_SETTLEMENT_DISPLAY_SYMBOL : tokenSymbol),
      assetSymbol: matchedAsset?.symbol ?? tokenSymbol,
    });
    if (rows.length >= params.limit) break;
  }

  return {
    status: rows.length === 0 ? 'empty' : 'ok',
    transactions: rows,
    count: rows.length,
    hasMore: params.response.cursor != null,
    fetchedAt: params.response.fetchedAt,
  };
}

export const getRwaAssetsTool: AgenticToolDefinition = {
  name: 'get_rwa_assets',
  schema: {
    name: 'get_rwa_assets',
    description:
      'Lists tokenized stocks, ETFs, and RWA assets available for OffPay RWA trading on the active Solana network. For a specific stock/ticker question, pass asset so the app returns that asset only. Returns sanitized ticker, price, tradability, and optional holding summaries. No mints or signatures.',
    parameters: {
      type: 'object',
      properties: {
        asset: {
          type: 'string',
          description:
            'Optional RWA ticker/name, e.g. SPY, TSLA, SpaceX, Apple, SP500. Use this for specific-stock details or availability.',
        },
        limit: {
          type: 'number',
          description: 'How many RWA assets to summarize when asset is omitted. Capped at 30.',
        },
      },
    },
  },
  run: async (call, context) => {
    if (context.scope.network == null) return { error: { code: 'network_not_selected' } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (!canReadRwa(context)) return { error: { code: 'feature_unavailable' } };

    const assetText = hydrateStringArg(
      { ...call, args: { asset: readRwaAssetArg(call) } },
      'asset',
      context.redactions,
    );
    const hasSpecificAssetRequest = assetText.trim().length > 0;
    const limit = readCappedInteger({
      call,
      key: 'limit',
      fallback: DEFAULT_ASSET_LIMIT,
      min: 1,
      max: MAX_ASSET_LIMIT,
    });

    try {
      const assets = await readRwaAssets({
        network: context.scope.network,
        signal: context.signal,
      });
      if (hasSpecificAssetRequest) {
        const resolved = resolveRwaAssetReference({ assets, value: assetText });
        if (!resolved.ok) return { error: { code: resolved.code } };
        const asset = summarizeAsset(resolved.asset, context.balance);
        return {
          result: {
            status: 'ok',
            mode: 'asset',
            network: context.scope.network,
            asset,
            assets: [asset],
            count: 1,
            truncated: false,
          },
        };
      }

      return {
        result: {
          status: assets.length === 0 ? 'empty' : 'ok',
          network: context.scope.network,
          assets: assets.slice(0, limit).map((asset) => summarizeAsset(asset, context.balance)),
          count: assets.length,
          truncated: assets.length > limit,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'rwa_assets_failed') } };
    }
  },
};

export const getRwaHoldingsTool: AgenticToolDefinition = {
  name: 'get_rwa_holdings',
  schema: {
    name: 'get_rwa_holdings',
    description:
      'Returns active wallet RWA settlement balance and tokenized-stock/ETF holdings from the current RWA catalog. No wallet address, token mints, or signatures.',
    parameters: EMPTY_PARAMS,
  },
  run: async (_call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null || context.balance == null) {
      return { result: { status: 'loading' } };
    }
    if (!canReadRwa(context)) return { error: { code: 'feature_unavailable' } };

    try {
      const assets = await readRwaAssets({ network: scope.network, signal: context.signal });
      const holdings = buildRwaHoldings({ assets, balance: context.balance });
      return {
        result: {
          status: holdings.holdings.length === 0 ? 'empty' : 'ok',
          network: scope.network,
          settlement: holdings.settlement,
          holdings: holdings.holdings,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'rwa_holdings_failed') } };
    }
  },
};

export const getRwaHistoryTool: AgenticToolDefinition = {
  name: 'get_rwa_history',
  schema: {
    name: 'get_rwa_history',
    description:
      'Returns a capped safe summary of historic RWA-related wallet transactions. Never returns signatures, counterparties, token mints, or full raw history.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many recent RWA rows to summarize. Capped at 20.',
        },
      },
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (
      !canReadRwa(context) ||
      !isOffpayFeatureAvailable(context.capabilities, 'wallet.transactions')
    ) {
      return { error: { code: 'feature_unavailable' } };
    }

    const limit = readCappedInteger({
      call,
      key: 'limit',
      fallback: DEFAULT_HISTORY_LIMIT,
      min: 1,
      max: MAX_HISTORY_LIMIT,
    });

    try {
      const [assets, response] = await Promise.all([
        readRwaAssets({ network: scope.network, signal: context.signal }),
        readCachedTransactions(context, limit) ??
          getWalletTransactions(scope.walletAddress, scope.network, {
            limit: Math.max(limit, DEFAULT_HISTORY_LIMIT),
            signal: context.signal,
            requestOwner: 'agent.rwa.history',
          }),
      ]);
      return {
        result: {
          ...summarizeRwaTransactions({ assets, response, limit }),
          source: readCachedTransactions(context, limit) == null ? 'network' : 'cache',
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'rwa_history_failed') } };
    }
  },
};

export const prepareRwaTradeTool: AgenticToolDefinition = {
  name: 'prepare_rwa_trade',
  schema: {
    name: 'prepare_rwa_trade',
    description:
      'Prepares a tokenized-stock/RWA buy or sell quote for explicit in-app confirmation. Use for stocks, ETFs, xStocks, or RWAs, not regular token swaps. Buy amount is settlement cash (RWAUSDC/USDC); sell amount is RWA token quantity. This tool never submits or signs.',
    parameters: {
      type: 'object',
      properties: {
        asset: {
          type: 'string',
          description: 'RWA ticker/name, e.g. SPY, TSLA, Apple, SP500, or a catalog symbol.',
        },
        side: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'Whether to buy or sell the RWA asset.',
        },
        amount: {
          type: 'string',
          description:
            'For buys, settlement cash amount. For sells, RWA token quantity. Use "max" only when the user explicitly asks to sell all or use max.',
        },
      },
      required: ['asset', 'side', 'amount'],
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (!canTradeRwa(context)) return { error: { code: 'feature_unavailable' } };
    if (context.walletId == null) return { error: { code: 'wallet_cannot_sign' } };
    if (context.balance == null) return { result: { status: 'loading' } };

    const assetText = hydrateStringArg(
      { ...call, args: { asset: readRwaAssetArg(call) } },
      'asset',
      context.redactions,
    );
    const side = readRwaSideArg(call);
    if (side == null) return { error: { code: 'rwa_side_missing' } };

    const parsedAmount = parseRwaAmount(
      hydrateStringArg(
        { ...call, args: { amount: readRwaAmountArg(call) } },
        'amount',
        context.redactions,
      ),
    );
    if (!parsedAmount.ok) return { error: { code: parsedAmount.code } };

    try {
      const assets = await readRwaAssets({ network: scope.network, signal: context.signal });
      const resolved = resolveRwaAssetReference({ assets, value: assetText });
      if (!resolved.ok) return { error: { code: resolved.code } };
      const { asset } = resolved;

      if (asset.tradingHalted === true) return { error: { code: 'rwa_trading_halted' } };
      if (asset.multiplierTransitionActive === true) {
        return { error: { code: 'rwa_multiplier_transition' } };
      }
      if (!asset.tradable) return { error: { code: 'rwa_not_tradable' } };
      if (asset.execution[side] !== 'jupiter_swap' && asset.execution[side] !== 'devnet_sandbox') {
        return { error: { code: 'rwa_side_unavailable' } };
      }

      const amount =
        parsedAmount.amount === 'max'
          ? resolveMaxTradeAmount({ asset, balance: context.balance, side })
          : parsedAmount.amount;
      if (amount == null) return { error: { code: 'amount_exceeds_balance' } };

      const spendToken =
        side === 'buy'
          ? getTokenBalance(context.balance, asset.settlementMint)
          : getTokenBalance(context.balance, asset.mint);
      const fallbackDecimals = side === 'buy' ? 6 : (asset.decimals ?? 6);
      if (!decimalAmountFitsBalance({ amount, fallbackDecimals, token: spendToken })) {
        return { error: { code: 'amount_exceeds_balance' } };
      }

      const quote = await createRwaQuote(
        {
          assetMint: asset.mint,
          cashAmount: side === 'buy' ? amount : undefined,
          quantity: side === 'sell' ? amount : undefined,
          side,
          network: scope.network,
        },
        { signal: context.signal },
      );
      const hasUnsignedSequence =
        quote.unsignedTransactions != null && quote.unsignedTransactions.length > 0;
      if (quote.unsignedTransaction.trim().length === 0 && !hasUnsignedSequence) {
        return { error: { code: 'quote_invalid' } };
      }

      const requirement = getRwaDevnetSandboxFundingRequirement({
        asset,
        inputAmount: amount,
        network: scope.network,
        quote,
        side,
        walletBalance: context.balance,
      });
      if (requirement != null && !requirement.hasEnough) {
        return { error: { code: 'amount_exceeds_balance' } };
      }

      return buildRwaDraftOutcome({
        asset,
        amount,
        quote,
        scope,
        side,
        walletId: context.walletId,
      });
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'rwa_quote_failed') } };
    }
  },
};

function buildRwaDraftOutcome(params: {
  asset: RwaAsset;
  amount: string;
  quote: RwaQuoteResponse;
  scope: { walletAddress: string; network: OffpayNetwork };
  side: RwaTradeSide;
  walletId: string;
}) {
  const settlementSymbol = getSettlementDisplaySymbol(params.asset);
  const payAmount =
    params.side === 'buy'
      ? (params.quote.cashAmount ?? params.amount)
      : (params.quote.quantity ?? params.amount);
  const receiveAmount =
    params.side === 'buy' ? (params.quote.quantity ?? '0') : (params.quote.cashAmount ?? '0');
  const paySymbol = params.side === 'buy' ? settlementSymbol : params.asset.symbol;
  const receiveSymbol = params.side === 'buy' ? params.asset.symbol : settlementSymbol;

  return {
    result: {
      status: 'drafted',
      side: params.side,
      assetSymbol: params.asset.symbol,
      assetName: params.asset.name,
      payAmount,
      paySymbol,
      receiveAmount,
      receiveSymbol,
      priceUsd: params.quote.priceUsd,
      priceImpactPct: params.quote.priceImpactPct,
      fee: params.quote.fee,
      expiresAt: params.quote.expiresAt,
      magicBlockIntent: params.quote.sandboxIntent?.magicBlock?.enabled === true,
    },
    draft: {
      kind: 'rwa_trade' as const,
      draft: {
        walletAddress: params.scope.walletAddress,
        network: params.scope.network,
        asset: params.asset,
        side: params.side,
        inputAmount: params.amount,
        cashAmount: params.quote.cashAmount,
        quantity: params.quote.quantity,
        settlementSymbol,
        payAmount,
        paySymbol,
        receiveAmount,
        receiveSymbol,
        priceUsd: params.quote.priceUsd,
        priceImpactPct: params.quote.priceImpactPct,
        fee: params.quote.fee,
        routeSummary: params.quote.routeSummary,
        slippageBps: params.quote.slippageBps,
        quoteId: params.quote.quoteId,
        unsignedTransaction: params.quote.unsignedTransaction,
        unsignedTransactions: params.quote.unsignedTransactions,
        expiresAt: params.quote.expiresAt,
        provider: params.quote.provider,
        providerEnvironment: params.quote.providerEnvironment,
        walletId: params.walletId,
        signature: null,
        signatures: null,
        errorMessage: null,
      },
    },
  };
}
