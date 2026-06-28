import {
  buildHoldingsValueChangeSamples,
  calculateHoldingsValueChange,
  formatSignedFiatChange,
  selectHoldingsValueChangeInputs,
} from '@/hooks/useOffpayHoldingsValueChange';
import {
  resolveTokenPriceHistoryTimeframe,
  type TokenPriceHistoryView,
} from '@/hooks/useOffpayTokenPriceHistory';

import type { TokenHolding } from '@/components/features/home/TokenHoldingsCard';

function makeHolding(
  overrides: Partial<TokenHolding> & Pick<TokenHolding, 'mint' | 'symbol'>,
): TokenHolding {
  return {
    mint: overrides.mint,
    priceMint: overrides.priceMint ?? overrides.mint,
    priceSymbol: overrides.priceSymbol ?? overrides.symbol,
    symbol: overrides.symbol,
    name: overrides.name ?? overrides.symbol,
    balance: overrides.balance ?? String(overrides.balanceValue ?? 1),
    balanceValue: overrides.balanceValue ?? 1,
    logo: overrides.logo ?? null,
    usdPrice: overrides.usdPrice ?? null,
    verified: overrides.verified ?? true,
    spam: overrides.spam ?? false,
    priceChange: overrides.priceChange ?? null,
  };
}

function makeHistory(
  prices: number[],
  liveUsdPrice = prices.at(-1) ?? null,
): TokenPriceHistoryView {
  return {
    currency: 'USD',
    rate: 1,
    timeframe: '7D',
    timeframeLabel: '7D',
    interval: '1h',
    liveUsdPrice,
    livePrice: liveUsdPrice,
    unitPriceLabel: null,
    samples: prices.map((price, index) => ({
      price,
      usdPrice: price,
      timestamp: 1_700_000_000_000 + index * 60_000,
      marketCapUsd: null,
      totalVolumeUsd: null,
    })),
    change: null,
    latestMarketCapUsd: null,
    latestTotalVolumeUsd: null,
    fetchedAt: 1_700_000_120_000,
    statusMessage: null,
  };
}

describe('useOffpayHoldingsValueChange helpers', () => {
  it('keeps stablecoins local and selects only top priced non-stable histories', () => {
    const holdings = [
      makeHolding({ mint: 'usdc', symbol: 'USDC', priceSymbol: 'USDC', balanceValue: 100 }),
      makeHolding({ mint: 'sol', symbol: 'SOL', balanceValue: 2, usdPrice: 150 }),
      makeHolding({ mint: 'bonk', symbol: 'BONK', balanceValue: 1_000, usdPrice: 0.00001 }),
    ];

    const selected = selectHoldingsValueChangeInputs({
      holdings,
      maxHistoryPricedHoldings: 1,
    });

    expect(selected.inputs.map((input) => input.priceMint)).toEqual(['usdc', 'sol']);
    expect(selected.historyInputs.map((input) => input.priceMint)).toEqual(['sol']);
  });

  it('aggregates stable value plus historical token value into chart samples', () => {
    const { inputs } = selectHoldingsValueChangeInputs({
      holdings: [
        makeHolding({ mint: 'usdc', symbol: 'USDC', priceSymbol: 'USDC', balanceValue: 100 }),
        makeHolding({ mint: 'sol', symbol: 'SOL', balanceValue: 2, usdPrice: 10 }),
      ],
    });
    const samples = buildHoldingsValueChangeSamples({
      inputs,
      historiesByMint: new Map([['sol', makeHistory([10, 20], 21)]]),
      rate: 1,
      timestamp: 1_700_000_180_000,
      timeframe: resolveTokenPriceHistoryTimeframe('7D'),
    });

    expect(samples.map((sample) => sample.value)).toEqual([120, 140, 142]);
    expect(calculateHoldingsValueChange(samples)).toMatchObject({
      absolute: 22,
      usdAbsolute: 22,
      percent: (22 / 120) * 100,
      tone: 'positive',
    });
  });

  it('does not add current-only tokens to the final point when they have no history', () => {
    const { inputs } = selectHoldingsValueChangeInputs({
      holdings: [
        makeHolding({ mint: 'sol', symbol: 'SOL', balanceValue: 1, usdPrice: 10 }),
        makeHolding({ mint: 'new-token', symbol: 'NEW', balanceValue: 10, usdPrice: 100 }),
      ],
    });
    const samples = buildHoldingsValueChangeSamples({
      inputs,
      historiesByMint: new Map([['sol', makeHistory([10, 20], 21)]]),
      rate: 1,
      timestamp: 1_700_000_180_000,
      timeframe: resolveTokenPriceHistoryTimeframe('7D'),
    });

    expect(samples.map((sample) => sample.value)).toEqual([10, 20, 21]);
  });

  it('formats signed fiat changes without signed zero', () => {
    expect(formatSignedFiatChange(12.3, 'USD')).toBe('+$ 12.30');
    expect(formatSignedFiatChange(-12.3, 'USD')).toBe('-$ 12.30');
    expect(formatSignedFiatChange(-0, 'USD')).toBe('$ 0.00');
    expect(formatSignedFiatChange(0.001, 'USD')).toBe('+<$ 0.01');
  });
});
