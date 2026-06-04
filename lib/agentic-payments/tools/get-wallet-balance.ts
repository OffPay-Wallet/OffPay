import { buildVisibleTokenHoldings, formatLamportsAsSol } from '@/lib/api/offpay-wallet-data';
import { formatFiatCurrency, isUsdStablePriceSymbol } from '@/lib/currency-rates';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

const MAX_BALANCE_ROWS = 16;
const MAX_UNPRICED_SYMBOLS = 6;

function getHoldingUsdPrice(
  holding: ReturnType<typeof buildVisibleTokenHoldings>[number],
): number | null {
  if (isUsdStablePriceSymbol(holding.priceSymbol) || isUsdStablePriceSymbol(holding.symbol)) {
    return 1;
  }
  return holding.usdPrice;
}

function buildPortfolioUsdSummary(holdings: ReturnType<typeof buildVisibleTokenHoldings>): {
  portfolioValueUsd: number | null;
  portfolioValueUsdLabel: string | null;
  valuationCurrency: 'USD';
  valuationCoverage: 'complete' | 'partial' | 'unavailable';
  pricedAssetCount: number;
  unpricedAssetCount: number;
  unpricedSymbols: string[];
} {
  let totalUsd = 0;
  let pricedAssetCount = 0;
  let unpricedAssetCount = 0;
  let positiveAssetCount = 0;
  const unpricedSymbols: string[] = [];
  const unpricedSymbolSet = new Set<string>();

  for (const holding of holdings) {
    if (!Number.isFinite(holding.balanceValue) || holding.balanceValue <= 0) continue;
    positiveAssetCount += 1;

    const usdPrice = getHoldingUsdPrice(holding);
    if (usdPrice == null || !Number.isFinite(usdPrice) || usdPrice <= 0) {
      unpricedAssetCount += 1;
      if (!unpricedSymbolSet.has(holding.symbol) && unpricedSymbols.length < MAX_UNPRICED_SYMBOLS) {
        unpricedSymbolSet.add(holding.symbol);
        unpricedSymbols.push(holding.symbol);
      }
      continue;
    }

    totalUsd += holding.balanceValue * usdPrice;
    pricedAssetCount += 1;
  }

  const hasPricedAssets = pricedAssetCount > 0;
  const hasUnpricedAssets = unpricedAssetCount > 0;
  const normalizedTotal = Object.is(totalUsd, -0) ? 0 : totalUsd;
  const portfolioValueUsd =
    hasPricedAssets || positiveAssetCount === 0 ? Number(normalizedTotal.toFixed(2)) : null;

  return {
    portfolioValueUsd,
    portfolioValueUsdLabel:
      portfolioValueUsd == null ? null : formatFiatCurrency(portfolioValueUsd, 'USD'),
    valuationCurrency: 'USD',
    valuationCoverage:
      positiveAssetCount === 0
        ? 'complete'
        : hasPricedAssets
          ? hasUnpricedAssets
            ? 'partial'
            : 'complete'
          : 'unavailable',
    pricedAssetCount,
    unpricedAssetCount,
    unpricedSymbols,
  };
}

export const getWalletBalanceTool: AgenticToolDefinition = {
  name: 'get_wallet_balance',
  schema: {
    name: 'get_wallet_balance',
    description:
      'Returns the active wallet portfolio value in USD plus SOL and visible token balances as one unified summary. No wallet address or token mints.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    if (context.scope.walletAddress == null) return { error: { code: 'wallet_not_connected' } };
    if (context.scope.network == null) return { error: { code: 'network_not_selected' } };
    if (context.balance == null) return { result: { status: 'loading' } };

    const holdings = buildVisibleTokenHoldings(context.balance);
    const portfolio = buildPortfolioUsdSummary(holdings);
    const sol = formatLamportsAsSol(context.balance.solBalance, 9).replace(/\.?0+$/, '') || '0';
    return {
      result: {
        status: 'ok',
        network: context.scope.network,
        ...portfolio,
        sol,
        lamports: context.balance.solBalance,
        tokens: holdings.slice(0, MAX_BALANCE_ROWS).map((holding) => ({
          symbol: holding.symbol,
          name: holding.name,
          balance: holding.balance,
          verified: holding.verified,
          spam: holding.spam,
          usdPrice: holding.usdPrice,
        })),
        truncated: holdings.length > MAX_BALANCE_ROWS,
        fetchedAt: context.balance.fetchedAt,
      },
    };
  },
};
